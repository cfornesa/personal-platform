import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import { db, mysqlPool, platformOAuthAppsTable, eq, formatMysqlDateTime } from "@workspace/db";
import { requireAuth, requireOwner } from "../middlewares/auth";
import { encryptSecret } from "../lib/crypto";
import { getOrigin } from "./feeds";
import { logger } from "../lib/logger";
import { getOAuthAppCredentials } from "../lib/oauth-app-credentials";

const router: IRouter = Router();

// Server-side OAuth state store. Keyed by the random state token; value holds
// the expiry timestamp, the optional blog URL, and an optional PKCE code verifier.
// Consumed on first use so each token is one-shot.
const oauthStateStore = new Map<string, { expiry: number; blogUrl?: string; codeVerifier?: string }>();
const STATE_TTL_MS = 10 * 60 * 1000;

function generateState(blogUrl?: string, codeVerifier?: string): string {
  const state = crypto.randomBytes(16).toString("hex");
  oauthStateStore.set(state, { expiry: Date.now() + STATE_TTL_MS, blogUrl, codeVerifier });
  setTimeout(() => oauthStateStore.delete(state), STATE_TTL_MS);
  return state;
}

function verifyState(req: Request): { ok: boolean; blogUrl?: string; codeVerifier?: string } {
  const paramState = req.query.state as string | undefined;
  if (!paramState) return { ok: false };
  const entry = oauthStateStore.get(paramState);
  oauthStateStore.delete(paramState);
  if (!entry || Date.now() > entry.expiry) return { ok: false };
  return { ok: true, blogUrl: entry.blogUrl, codeVerifier: entry.codeVerifier };
}



// Extracts the Blogger blog ID from the public HTML of a Blogger blog.
// Every Blogger blog embeds the Atom feed URL in a <link> element in the <head>:
//   href="https://www.blogger.com/feeds/{blogId}/posts/default"
// This works for custom-domain Blogger blogs and requires no API access.
async function extractBloggerBlogIdFromHtml(
  blogUrl: string,
): Promise<{ blogId: string; blogUrl: string } | null> {
  try {
    const res = await fetch(blogUrl, {
      headers: { "User-Agent": "CreatrWebSyndication/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/blogger\.com\/feeds\/(\d+)\/posts\/default/);
    if (!match) return null;
    return { blogId: match[1], blogUrl };
  } catch {
    return null;
  }
}

async function upsertConnection(
  userId: string,
  platform: string,
  encryptedAccessToken: string,
  encryptedRefreshToken: string | null,
  expiresAt: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  const now = formatMysqlDateTime(new Date());
  await mysqlPool.query(
    `INSERT INTO platform_connections
       (user_id, platform, encrypted_access_token, encrypted_refresh_token,
        expires_at, metadata, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON DUPLICATE KEY UPDATE
       encrypted_access_token = VALUES(encrypted_access_token),
       encrypted_refresh_token = VALUES(encrypted_refresh_token),
       expires_at = VALUES(expires_at),
       metadata = VALUES(metadata),
       updated_at = VALUES(updated_at)`,
    [userId, platform, encryptedAccessToken, encryptedRefreshToken, expiresAt, JSON.stringify(metadata), now, now],
  );
}

// ─── WordPress.com ────────────────────────────────────────────────────────────

// GET /platform-oauth/wordpress-com/start
router.get("/platform-oauth/wordpress-com/start", requireAuth, requireOwner, async (req: Request, res: Response) => {
  const creds = await getOAuthAppCredentials("wordpress_com", process.env.WORDPRESS_COM_CLIENT_ID, process.env.WORDPRESS_COM_CLIENT_SECRET);
  if (!creds) {
    return res.status(503).json({
      error: "WordPress.com OAuth app not configured. Enter your Client ID and Secret in Admin → Platforms.",
    });
  }

  // Fetch the saved blog URL so the OAuth token is scoped to the right blog.
  const appRows = await db
    .select({ blogUrl: platformOAuthAppsTable.blogUrl })
    .from(platformOAuthAppsTable)
    .where(eq(platformOAuthAppsTable.platform, "wordpress_com"))
    .limit(1);
  const savedBlogUrl = appRows[0]?.blogUrl ?? undefined;

  const origin = getOrigin(req);
  const redirectUri = `${origin}/api/platform-oauth/wordpress-com/callback`;
  const state = generateState(savedBlogUrl);

  const url = new URL("https://public-api.wordpress.com/oauth2/authorize");
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "global");
  url.searchParams.set("state", state);
  if (savedBlogUrl) {
    url.searchParams.set("blog", savedBlogUrl);
  }

  return res.redirect(url.toString());
});

// GET /platform-oauth/wordpress-com/callback
router.get("/platform-oauth/wordpress-com/callback", requireAuth, requireOwner, async (req: Request, res: Response) => {
  const stateResult = verifyState(req);
  if (!stateResult.ok) {
    return res.status(400).send("Invalid OAuth state. Please try connecting again.");
  }

  const code = req.query.code as string | undefined;
  if (!code) {
    return res.redirect("/admin/platforms?error=wordpress_com_denied");
  }

  try {
    const creds = await getOAuthAppCredentials("wordpress_com", process.env.WORDPRESS_COM_CLIENT_ID, process.env.WORDPRESS_COM_CLIENT_SECRET);
    if (!creds) {
      return res.redirect("/admin/platforms?error=wordpress_com_not_configured");
    }

    const origin = getOrigin(req);
    const redirectUri = `${origin}/api/platform-oauth/wordpress-com/callback`;

    const tokenRes = await fetch("https://public-api.wordpress.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: redirectUri,
        code,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed: ${tokenRes.status}`);
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      blog_id?: string | number;
    };

    let blogId = tokens.blog_id ? String(tokens.blog_id) : null;
    let blogUrl: string | null = null;

    if (!blogId) {
      const sitesRes = await fetch("https://public-api.wordpress.com/rest/v1.1/me/sites", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (sitesRes.ok) {
        const data = (await sitesRes.json()) as { sites?: Array<{ ID: number; URL: string }> };
        const first = data.sites?.[0];
        if (first) {
          blogId = String(first.ID);
          blogUrl = first.URL;
        }
      } else {
        logger.warn({ status: sitesRes.status }, "WordPress.com me/sites fetch failed");
      }
    }

    if (!blogId) {
      logger.error({}, "WordPress.com OAuth: could not determine blog ID — no sites on account");
      return res.redirect("/admin/platforms?error=wordpress_com_no_blog");
    }

    const expiresAt = tokens.expires_in
      ? formatMysqlDateTime(new Date(Date.now() + tokens.expires_in * 1000))
      : null;

    await upsertConnection(
      req.currentUser!.id,
      "wordpress_com",
      encryptSecret(tokens.access_token),
      tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
      expiresAt,
      { blogId, blogUrl },
    );

    return res.redirect("/admin/platforms?connected=wordpress_com");
  } catch (err) {
    logger.error({ err }, "WordPress.com OAuth callback error");
    return res.redirect("/admin/platforms?error=wordpress_com_failed");
  }
});

// ─── Blogger (Google OAuth with blogger scope) ────────────────────────────────

// GET /platform-oauth/blogger/start
router.get("/platform-oauth/blogger/start", requireAuth, requireOwner, async (req: Request, res: Response) => {
  const creds = await getOAuthAppCredentials("blogger", process.env.BLOGGER_GOOGLE_CLIENT_ID, process.env.BLOGGER_GOOGLE_CLIENT_SECRET);
  if (!creds) {
    return res.status(503).json({
      error: "Blogger OAuth app not configured. Enter your Client ID and Secret in Admin → Platforms.",
    });
  }

  const appRows = await db
    .select({ blogUrl: platformOAuthAppsTable.blogUrl })
    .from(platformOAuthAppsTable)
    .where(eq(platformOAuthAppsTable.platform, "blogger"))
    .limit(1);
  const savedBlogUrl = appRows[0]?.blogUrl ?? undefined;

  const origin = getOrigin(req);
  const redirectUri = `${origin}/api/platform-oauth/blogger/callback`;
  const state = generateState(savedBlogUrl);

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/blogger");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  return res.redirect(url.toString());
});

// GET /platform-oauth/blogger/callback
router.get("/platform-oauth/blogger/callback", requireAuth, requireOwner, async (req: Request, res: Response) => {
  const stateResult = verifyState(req);
  if (!stateResult.ok) {
    return res.status(400).send("Invalid OAuth state. Please try connecting again.");
  }

  const code = req.query.code as string | undefined;
  if (!code) {
    return res.redirect("/admin/platforms?error=blogger_denied");
  }

  try {
    const creds = await getOAuthAppCredentials("blogger", process.env.BLOGGER_GOOGLE_CLIENT_ID, process.env.BLOGGER_GOOGLE_CLIENT_SECRET);
    if (!creds) {
      return res.redirect("/admin/platforms?error=blogger_not_configured");
    }

    const origin = getOrigin(req);
    const redirectUri = `${origin}/api/platform-oauth/blogger/callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`Blogger token exchange failed: ${tokenRes.status}`);
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    let blogId: string | null = null;
    let blogUrl: string | null = null;

    // Primary: parse the blog ID from the public HTML — works even when the
    // Blogger API is not enabled or the scope wasn't granted on the consent screen.
    // Blogger embeds the feed URL (which contains the numeric blog ID) in every page.
    if (stateResult.blogUrl) {
      const extracted = await extractBloggerBlogIdFromHtml(stateResult.blogUrl);
      if (extracted) {
        blogId = extracted.blogId;
        blogUrl = extracted.blogUrl;
        logger.info({ blogId, blogUrl }, "Blogger blog ID extracted from public HTML");
      }
    }

    // Fallback 1: blogs/byurl API (works when the Blogger API is enabled and
    // the scope is on the consent screen).
    if (!blogId && stateResult.blogUrl) {
      const byUrlRes = await fetch(
        `https://www.googleapis.com/blogger/v3/blogs/byurl?url=${encodeURIComponent(stateResult.blogUrl)}`,
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      );
      if (byUrlRes.ok) {
        const blog = (await byUrlRes.json()) as { id: string; url: string };
        blogId = blog.id;
        blogUrl = blog.url;
      } else {
        const errBody = await byUrlRes.text().catch(() => "");
        logger.warn(
          { status: byUrlRes.status, blogUrl: stateResult.blogUrl, errBody: errBody.slice(0, 500) },
          "Blogger blogs/byurl fetch failed",
        );
      }
    }

    // Fallback 2: users/self/blogs API.
    if (!blogId) {
      const blogsRes = await fetch(
        "https://www.googleapis.com/blogger/v3/users/self/blogs",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      );
      if (blogsRes.ok) {
        const blogs = (await blogsRes.json()) as {
          items?: Array<{ id: string; url: string; name: string }>;
        };
        const first = blogs.items?.[0];
        if (first) {
          blogId = first.id;
          blogUrl = first.url;
        }
      } else {
        const errBody = await blogsRes.text().catch(() => "");
        logger.warn(
          { status: blogsRes.status, errBody: errBody.slice(0, 500) },
          "Blogger users/self/blogs fetch failed",
        );
      }
    }

    if (!blogId) {
      logger.error({}, "Blogger OAuth: could not determine blog ID — no blogs on account or access denied");
      return res.redirect("/admin/platforms?error=blogger_no_blog");
    }

    const expiresAt = tokens.expires_in
      ? formatMysqlDateTime(new Date(Date.now() + tokens.expires_in * 1000))
      : null;

    await upsertConnection(
      req.currentUser!.id,
      "blogger",
      encryptSecret(tokens.access_token),
      tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
      expiresAt,
      { blogId, blogUrl },
    );

    return res.redirect("/admin/platforms?connected=blogger");
  } catch (err) {
    logger.error({ err }, "Blogger OAuth callback error");
    return res.redirect("/admin/platforms?error=blogger_failed");
  }
});

// ─── Bluesky (AT Protocol App Password) ──────────────────────────────────────
// No OAuth redirect — the user enters their handle and an App Password from
// their Bluesky Settings → App Passwords page.

// POST /platform-oauth/bluesky/connect
router.post("/platform-oauth/bluesky/connect", requireAuth, requireOwner, async (req: Request, res: Response) => {
  const { handle, appPassword } = req.body as { handle?: string; appPassword?: string };
  if (!handle?.trim() || !appPassword?.trim()) {
    return res.status(400).json({ error: "handle and appPassword are required" });
  }

  try {
    // Verify credentials by creating a session
    const sessionRes = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: handle.trim(), password: appPassword.trim() }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!sessionRes.ok) {
      const errBody = await sessionRes.text().catch(() => "");
      logger.warn({ status: sessionRes.status, errBody: errBody.slice(0, 300) }, "Bluesky session verification failed");
      return res.status(401).json({ error: "Invalid Bluesky handle or App Password" });
    }

    await upsertConnection(
      req.currentUser!.id,
      "bluesky",
      encryptSecret(appPassword.trim()),
      null,
      null,
      { handle: handle.trim() },
    );

    return res.json({ connected: true });
  } catch (err) {
    logger.error({ err }, "Bluesky connect error");
    return res.status(500).json({ error: "Failed to connect Bluesky account" });
  }
});

// ─── Meta (Facebook Page + Instagram Business) ────────────────────────────────
// Single OAuth flow creates/updates both a `facebook` and `instagram` connection
// when the authorized Page has a linked Instagram Business/Creator account.

// GET /platform-oauth/facebook/start
router.get("/platform-oauth/facebook/start", requireAuth, requireOwner, async (req: Request, res: Response) => {
  const creds = await getOAuthAppCredentials("facebook", process.env.META_CLIENT_ID, process.env.META_CLIENT_SECRET);
  if (!creds) {
    return res.status(503).json({
      error: "Meta OAuth app not configured. Enter your Client ID and Secret in Admin → Platforms.",
    });
  }

  const origin = getOrigin(req);
  const redirectUri = `${origin}/api/platform-oauth/facebook/callback`;
  const state = generateState();

  const url = new URL("https://www.facebook.com/dialog/oauth");
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "pages_manage_posts,pages_read_engagement,instagram_content_publish,instagram_basic");
  url.searchParams.set("state", state);

  return res.redirect(url.toString());
});

// GET /platform-oauth/facebook/callback
router.get("/platform-oauth/facebook/callback", requireAuth, requireOwner, async (req: Request, res: Response) => {
  const stateResult = verifyState(req);
  if (!stateResult.ok) {
    return res.status(400).send("Invalid OAuth state. Please try connecting again.");
  }

  const code = req.query.code as string | undefined;
  if (!code) {
    return res.redirect("/admin/platforms?error=facebook_denied");
  }

  try {
    const creds = await getOAuthAppCredentials("facebook", process.env.META_CLIENT_ID, process.env.META_CLIENT_SECRET);
    if (!creds) {
      return res.redirect("/admin/platforms?error=facebook_not_configured");
    }

    const origin = getOrigin(req);
    const redirectUri = `${origin}/api/platform-oauth/facebook/callback`;

    // Exchange code for short-lived user token
    const tokenRes = await fetch("https://graph.facebook.com/v20.0/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text().catch(() => "");
      logger.error({ status: tokenRes.status, errBody: errBody.slice(0, 500) }, "Facebook token exchange failed");
      return res.redirect("/admin/platforms?error=facebook_token_failed");
    }

    const tokens = (await tokenRes.json()) as { access_token: string; expires_in?: number };
    const userAccessToken = tokens.access_token;

    // Exchange short-lived for long-lived user token
    const longLivedRes = await fetch(
      `https://graph.facebook.com/v20.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${creds.clientId}&client_secret=${creds.clientSecret}&fb_exchange_token=${userAccessToken}`,
    );
    const longLived = longLivedRes.ok
      ? ((await longLivedRes.json()) as { access_token: string; expires_in?: number })
      : null;
    const effectiveUserToken = longLived?.access_token ?? userAccessToken;

    // Fetch managed Pages with Instagram business account info
    const accountsRes = await fetch(
      `https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token,username,instagram_business_account{id,username}&access_token=${effectiveUserToken}`,
    );

    if (!accountsRes.ok) {
      const errBody = await accountsRes.text().catch(() => "");
      logger.error({ status: accountsRes.status, errBody: errBody.slice(0, 500) }, "Facebook me/accounts fetch failed");
      return res.redirect("/admin/platforms?error=facebook_no_pages");
    }

    const accountsData = (await accountsRes.json()) as {
      data?: Array<{
        id: string;
        name: string;
        access_token: string;
        username?: string;
        instagram_business_account?: { id: string; username?: string };
      }>;
    };

    const pages = accountsData.data ?? [];
    if (pages.length === 0) {
      logger.error({}, "Facebook OAuth: no managed Pages on account");
      return res.redirect("/admin/platforms?error=facebook_no_pages");
    }

    // Use first Page (single-page accounts are the common case)
    const page = pages[0];
    const pageAccessToken = page.access_token;

    await upsertConnection(
      req.currentUser!.id,
      "facebook",
      encryptSecret(pageAccessToken),
      null,
      null, // Page Access Tokens don't expire while the user authorizes the app
      { pageId: page.id, pageName: page.name, username: page.username ?? null },
    );

    // If the Page has a linked Instagram Business account, wire that up too
    const igAccount = page.instagram_business_account;
    if (igAccount?.id) {
      await upsertConnection(
        req.currentUser!.id,
        "instagram",
        encryptSecret(pageAccessToken), // Same Page token used for IG Content Publishing API
        null,
        null,
        { igUserId: igAccount.id, igUsername: igAccount.username ?? null, linkedPageId: page.id },
      );
      return res.redirect("/admin/platforms?connected=facebook,instagram");
    }

    return res.redirect("/admin/platforms?connected=facebook");
  } catch (err) {
    logger.error({ err }, "Facebook OAuth callback error");
    return res.redirect("/admin/platforms?error=facebook_failed");
  }
});

// ─── LinkedIn ─────────────────────────────────────────────────────────────────

// GET /platform-oauth/linkedin/start
router.get("/platform-oauth/linkedin/start", requireAuth, requireOwner, async (req: Request, res: Response) => {
  const creds = await getOAuthAppCredentials("linkedin", process.env.LINKEDIN_CLIENT_ID, process.env.LINKEDIN_CLIENT_SECRET);
  if (!creds) {
    return res.status(503).json({
      error: "LinkedIn OAuth app not configured. Enter your Client ID and Secret in Admin → Platforms.",
    });
  }

  const origin = getOrigin(req);
  const redirectUri = `${origin}/api/platform-oauth/linkedin/callback`;
  const state = generateState();

  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "w_member_social openid profile email");
  url.searchParams.set("state", state);

  return res.redirect(url.toString());
});

// GET /platform-oauth/linkedin/callback
router.get("/platform-oauth/linkedin/callback", requireAuth, requireOwner, async (req: Request, res: Response) => {
  const linkedInError = req.query.error as string | undefined;
  const linkedInErrorDescription = req.query.error_description as string | undefined;
  if (linkedInError || linkedInErrorDescription) {
    logger.warn(
      {
        error: linkedInError,
        errorDescription: linkedInErrorDescription,
      },
      "LinkedIn OAuth callback returned an error without an authorization code",
    );
    return res.redirect("/admin/platforms?error=linkedin_authorization_failed");
  }

  const stateResult = verifyState(req);
  if (!stateResult.ok) {
    return res.status(400).send("Invalid OAuth state. Please try connecting again.");
  }

  const code = req.query.code as string | undefined;
  if (!code) {
    return res.redirect("/admin/platforms?error=linkedin_denied");
  }

  try {
    const creds = await getOAuthAppCredentials("linkedin", process.env.LINKEDIN_CLIENT_ID, process.env.LINKEDIN_CLIENT_SECRET);
    if (!creds) {
      return res.redirect("/admin/platforms?error=linkedin_not_configured");
    }

    const origin = getOrigin(req);
    const redirectUri = `${origin}/api/platform-oauth/linkedin/callback`;

    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text().catch(() => "");
      logger.error({ status: tokenRes.status, errBody: errBody.slice(0, 500) }, "LinkedIn token exchange failed");
      return res.redirect("/admin/platforms?error=linkedin_token_failed");
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      expires_in?: number;
    };

    // Fetch person ID via OIDC userinfo endpoint
    const userRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userRes.ok) {
      logger.error({ status: userRes.status }, "LinkedIn userinfo fetch failed");
      return res.redirect("/admin/platforms?error=linkedin_no_profile");
    }

    const userInfo = (await userRes.json()) as { sub: string; name?: string; picture?: string };
    const personId = userInfo.sub;

    const expiresAt = tokens.expires_in
      ? formatMysqlDateTime(new Date(Date.now() + tokens.expires_in * 1000))
      : null;

    await upsertConnection(
      req.currentUser!.id,
      "linkedin",
      encryptSecret(tokens.access_token),
      null,
      expiresAt,
      { personId, name: userInfo.name ?? null },
    );

    return res.redirect("/admin/platforms?connected=linkedin");
  } catch (err) {
    logger.error({ err }, "LinkedIn OAuth callback error");
    return res.redirect("/admin/platforms?error=linkedin_failed");
  }
});

export default router;
