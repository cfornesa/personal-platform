import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { db, platformOAuthAppsTable, eq, formatMysqlDateTime } from "@workspace/db";
import { requireAuth, requireOwner } from "../middlewares/auth";
import { encryptSecret } from "../lib/crypto";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Platforms that use server-side OAuth apps (CLIENT_ID + CLIENT_SECRET).
// Medium is excluded — it uses self-integration tokens, not OAuth apps.
const OAUTH_APP_PLATFORMS = new Set(["wordpress_com", "blogger", "linkedin", "facebook"]);

function serializeApp(row: { platform: string; encryptedClientId: string | null; encryptedClientSecret: string | null; blogUrl?: string | null }) {
  return {
    platform: row.platform,
    configured: Boolean(row.encryptedClientId && row.encryptedClientSecret),
    blogUrl: row.blogUrl ?? null,
  };
}

// GET /platform-oauth-apps — list all known platforms with configured status
router.get("/platform-oauth-apps", requireAuth, requireOwner, async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(platformOAuthAppsTable);
    const rowMap = new Map(rows.map((r) => [r.platform, r]));

    // Return a row for every supported OAuth-app platform, even if not yet saved.
    const apps = [...OAUTH_APP_PLATFORMS].map((platform) => {
      const row = rowMap.get(platform);
      return {
        platform,
        configured: Boolean(row?.encryptedClientId && row?.encryptedClientSecret),
        blogUrl: row?.blogUrl ?? null,
      };
    });

    return res.json({ apps });
  } catch (err) {
    logger.error({ err }, "GET /platform-oauth-apps error");
    return res.status(500).json({ error: "Server error" });
  }
});

const UpsertOAuthAppBody = z.object({
  clientId: z.string().min(1).max(512),
  clientSecret: z.string().min(1).max(512),
  blogUrl: z.string().max(500).optional(),
});

// PUT /platform-oauth-apps/:platform — save CLIENT_ID + CLIENT_SECRET
router.put("/platform-oauth-apps/:platform", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const platform = String(req.params.platform);
    if (!OAUTH_APP_PLATFORMS.has(platform)) {
      return res.status(400).json({ error: `Unsupported OAuth app platform: ${platform}` });
    }

    const parsed = UpsertOAuthAppBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: parsed.error.format() });
    }

    const { clientId, clientSecret, blogUrl } = parsed.data;
    const now = formatMysqlDateTime(new Date());
    const encId = encryptSecret(clientId);
    const encSecret = encryptSecret(clientSecret);
    const normalizedBlogUrl = blogUrl?.trim() || null;

    const existing = await db
      .select()
      .from(platformOAuthAppsTable)
      .where(eq(platformOAuthAppsTable.platform, platform))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(platformOAuthAppsTable)
        .set({ encryptedClientId: encId, encryptedClientSecret: encSecret, blogUrl: normalizedBlogUrl, updatedAt: now })
        .where(eq(platformOAuthAppsTable.platform, platform));
    } else {
      await db.insert(platformOAuthAppsTable).values({
        platform,
        encryptedClientId: encId,
        encryptedClientSecret: encSecret,
        blogUrl: normalizedBlogUrl,
        createdAt: now,
        updatedAt: now,
      });
    }

    return res.json({ platform, configured: true, blogUrl: normalizedBlogUrl });
  } catch (err) {
    logger.error({ err }, "PUT /platform-oauth-apps/:platform error");
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
