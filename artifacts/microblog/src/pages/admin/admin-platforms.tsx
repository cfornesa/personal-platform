import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPlatformConnections,
  getListPlatformConnectionsQueryKey,
  useCreatePlatformConnection,
  useUpdatePlatformConnection,
  useDeletePlatformConnection,
  useListPlatformOAuthApps,
  getListPlatformOAuthAppsQueryKey,
  useUpsertPlatformOAuthApp,
  useGetSiteSettings,
  type PlatformConnection,
  type PlatformConnectionPlatform,
} from "@workspace/api-client-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { ExternalLink, Copy, Check } from "lucide-react";

// ─── Static platform definitions ─────────────────────────────────────────────

type PlatformDef = {
  id: PlatformConnectionPlatform;
  label: string;
  description: string;
  setupInstruction: string;
  setupHref: string;
  // OAuth platforms need CLIENT_ID/SECRET saved before the Connect button.
  oauthAppPlatform?: "wordpress_com" | "blogger" | "linkedin" | "facebook";
  // OAuth redirect platforms: clicking Connect goes to this URL.
  oauthPath?: string;
  // Credential-entry platforms: open the credential dialog instead.
  credentialKind?: "wordpress_self" | "substack" | "bluesky";
};

const PLATFORMS: PlatformDef[] = [
  {
    id: "wordpress_com",
    label: "WordPress.com",
    description: "Publish to your hosted WordPress.com blog via OAuth.",
    setupInstruction: "Register a new OAuth app to get your Client ID and Client Secret.",
    setupHref: "https://developer.wordpress.com/apps/new/",
    oauthAppPlatform: "wordpress_com",
    oauthPath: "/api/platform-oauth/wordpress-com/start",
  },
  {
    id: "wordpress_self",
    label: "WordPress (self-hosted)",
    description: "Publish to a self-hosted WordPress site using an application password.",
    setupInstruction: "Generate an Application Password in your WordPress dashboard under Users → Profile.",
    setupHref: "https://wordpress.org/documentation/article/application-passwords/",
    credentialKind: "wordpress_self",
  },
  {
    id: "blogger",
    label: "Blogger",
    description: "Publish to your Blogger blog via Google OAuth (separate project from sign-in).",
    setupInstruction: "Create OAuth 2.0 credentials in Google Cloud Console with the Blogger API scope.",
    setupHref: "https://console.cloud.google.com/apis/credentials",
    oauthAppPlatform: "blogger",
    oauthPath: "/api/platform-oauth/blogger/start",
  },
  {
    id: "substack",
    label: "Substack",
    description: "Publish directly to your Substack publication using your stored session cookie.",
    setupInstruction: "Copy your Substack connect.sid cookie and publication ID from your own account.",
    setupHref: "https://substack.com/",
    credentialKind: "substack",
  },
  {
    id: "bluesky",
    label: "Bluesky",
    description: "Publish short POSSE posts to Bluesky with an AT Protocol App Password.",
    setupInstruction: "Create an App Password in Bluesky Settings → App Passwords.",
    setupHref: "https://bsky.app/settings/app-passwords",
    credentialKind: "bluesky",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    description: "Publish to your LinkedIn profile via OAuth and the LinkedIn Posts API.",
    setupInstruction: "Create a LinkedIn Developer app associated with a LinkedIn Page, then enable Share on LinkedIn and Sign In with LinkedIn using OpenID Connect.",
    setupHref: "https://www.linkedin.com/developers/apps/",
    oauthAppPlatform: "linkedin",
    oauthPath: "/api/platform-oauth/linkedin/start",
  },
  {
    id: "facebook",
    label: "Facebook Page",
    description: "Publish to a managed Facebook Page via the Meta Graph API.",
    setupInstruction: "Create a Meta Developer app with Facebook Login and Page publishing permissions.",
    setupHref: "https://developers.facebook.com/apps/",
    oauthAppPlatform: "facebook",
    oauthPath: "/api/platform-oauth/facebook/start",
  },
  {
    id: "instagram",
    label: "Instagram",
    description: "Publish image posts to an Instagram Business or Creator account linked to your Facebook Page.",
    setupInstruction: "Use the same Meta app as Facebook; connect through the Facebook OAuth flow.",
    setupHref: "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/",
    oauthAppPlatform: "facebook",
    oauthPath: "/api/platform-oauth/facebook/start",
  },
];

function parseConnectionMeta(raw: PlatformConnection["metadata"]): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") {
    return raw as Record<string, unknown>;
  }
  return {};
}

// ─── Shared: copyable URL row ─────────────────────────────────────────────────

function UrlRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1 rounded bg-muted px-2 py-1">
        <code className="flex-1 text-xs break-all">{value}</code>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

// ─── OAuth App Credentials dialog (WordPress.com / Blogger) ──────────────────

function OAuthAppCredentialsDialog({
  open,
  onClose,
  platform,
  label,
  setupHref,
  oauthPath,
  initialBlogUrl,
  hasSavedCredentials,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  platform: "wordpress_com" | "blogger" | "linkedin" | "facebook";
  label: string;
  setupHref: string;
  oauthPath: string;
  initialBlogUrl?: string | null;
  hasSavedCredentials: boolean;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({ clientId: "", clientSecret: "", blogUrl: initialBlogUrl ?? "" });
  const upsertApp = useUpsertPlatformOAuthApp();
  const { data: siteSettings } = useGetSiteSettings();
  const callbackSlug = platform === "wordpress_com" ? "wordpress-com" : platform;
  const callbackSuffix = `/api/platform-oauth/${callbackSlug}/callback`;
  const usesBlogUrl = platform === "wordpress_com" || platform === "blogger";

  // Use ALLOWED_ORIGINS from server config; fall back to the current browser origin.
  const origins: string[] =
    siteSettings?.allowedOrigins && siteSettings.allowedOrigins.length > 0
      ? siteSettings.allowedOrigins
      : [window.location.origin];

  const blogUrlPlaceholder = platform === "wordpress_com"
    ? "https://yourblog.wordpress.com"
    : "https://yourblog.blogspot.com";

  useEffect(() => {
    if (!open) return;
    setForm({ clientId: "", clientSecret: "", blogUrl: initialBlogUrl ?? "" });
  }, [initialBlogUrl, open]);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    upsertApp.mutate(
      {
        platform,
        data: {
          clientId: form.clientId,
          clientSecret: form.clientSecret,
          blogUrl: usesBlogUrl ? form.blogUrl || undefined : undefined,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "App credentials saved", description: `Connecting to ${label}…` });
          setForm({ clientId: "", clientSecret: "", blogUrl: "" });
          onSaved();
          onClose();
          window.location.href = oauthPath;
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to save credentials. Try again.", variant: "destructive" });
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] grid-rows-[auto_1fr_auto] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Connect {label}</DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto min-h-0 space-y-4">
          <DialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              {hasSavedCredentials ? (
                <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400">
                  Saved app credentials already exist for this platform. If autofill saved the wrong values, replace them here before continuing the connection.
                </div>
              ) : null}
              {platform === "wordpress_com" ? (
                <>
                  <p>
                    Register a new app at{" "}
                    <a href={setupHref} target="_blank" rel="noopener noreferrer"
                       className="inline-flex items-center gap-0.5 text-primary hover:underline">
                      developer.wordpress.com/apps/new <ExternalLink className="h-3 w-3" />
                    </a>
                    . Use these values when filling in the form:
                  </p>
                  <div className="space-y-2">
                    {origins.map((o) => (
                      <div key={o} className="space-y-2">
                        <UrlRow label="Website URL" value={o} />
                        <UrlRow label="Redirect URLs" value={`${o}${callbackSuffix}`} />
                      </div>
                    ))}
                  </div>
                  <p>Leave JavaScript Origins blank. After creating the app, copy the Client ID and Client Secret below.</p>
                </>
              ) : platform === "blogger" ? (
                <>
                  <p>
                    Open{" "}
                    <a href={setupHref} target="_blank" rel="noopener noreferrer"
                       className="inline-flex items-center gap-0.5 text-primary hover:underline">
                      Google Cloud Console → Credentials <ExternalLink className="h-3 w-3" />
                    </a>
                    . Click <strong>Create Credentials → OAuth client ID</strong>, choose <strong>Web application</strong>, and use these values:
                  </p>
                  <div className="space-y-2">
                    {origins.map((o) => (
                      <div key={o} className="space-y-2">
                        <UrlRow label="Authorized JavaScript origins" value={o} />
                        <UrlRow label="Authorized redirect URIs" value={`${o}${callbackSuffix}`} />
                      </div>
                    ))}
                  </div>
                  <p>In the same project, go to <strong>APIs &amp; Services → Library</strong> and enable the <strong>Blogger API v3</strong>. Without this step publishing will fail with a 403 error even after a successful connection.</p>
                  <p>Go to <strong>APIs &amp; Services → OAuth consent screen → Scopes → Add or remove scopes</strong> and add <code className="rounded bg-muted px-1 py-0.5 text-xs">https://www.googleapis.com/auth/blogger</code>. If this scope is missing, Google will issue a token without Blogger access and all API calls will fail.</p>
                  <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400 space-y-1.5">
                    <p className="font-medium">Testing mode vs. Production mode</p>
                    <p>New Google Cloud projects start in <strong>Testing</strong> mode. In this mode only accounts you explicitly add as test users can complete the OAuth flow. Go to <strong>OAuth consent screen → Test users</strong> and add the Gmail address you will use to connect. Without this, Google will block the flow regardless of any other setting.</p>
                    <p>To remove the test-user restriction entirely, publish your app to <strong>Production</strong> mode on the consent screen. Production mode requires Google verification for sensitive scopes, but Blogger is a non-sensitive scope and can usually be published without a review.</p>
                  </div>
                  <p>Once all of the above are in place, paste the Client ID and Secret below.</p>
                </>
              ) : platform === "linkedin" ? (
                <>
                  <p>
                    Open{" "}
                    <a href={setupHref} target="_blank" rel="noopener noreferrer"
                       className="inline-flex items-center gap-0.5 text-primary hover:underline">
                      LinkedIn Developers <ExternalLink className="h-3 w-3" />
                    </a>
                    , create an app associated with a LinkedIn Page, and add these products:
                  </p>
                  <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400 space-y-1.5">
                    <p className="font-medium">LinkedIn app requirement</p>
                    <p>LinkedIn requires Developer apps to be associated with an existing LinkedIn Page. This app association does not make CreatrWeb post to that Page; the current integration posts to the personal profile that completes OAuth.</p>
                  </div>
                  <ul className="list-disc space-y-1 pl-5">
                    <li><strong>Share on LinkedIn</strong> for <code className="rounded bg-muted px-1 py-0.5 text-xs">w_member_social</code>.</li>
                    <li><strong>Sign In with LinkedIn using OpenID Connect</strong> for <code className="rounded bg-muted px-1 py-0.5 text-xs">openid profile email</code>.</li>
                  </ul>
                  <div className="space-y-2">
                    {origins.map((o) => (
                      <div key={o} className="space-y-2">
                        <UrlRow label="Authorized redirect URL" value={`${o}${callbackSuffix}`} />
                      </div>
                    ))}
                  </div>
                  <p>After enabling those products, paste the Client ID and Client Secret below. If OpenID Connect is missing, LinkedIn returns <code className="rounded bg-muted px-1 py-0.5 text-xs">unauthorized_scope_error</code> for the <code className="rounded bg-muted px-1 py-0.5 text-xs">openid</code> scope.</p>
                </>
              ) : (
                <>
                  <p>
                    Open{" "}
                    <a href={setupHref} target="_blank" rel="noopener noreferrer"
                       className="inline-flex items-center gap-0.5 text-primary hover:underline">
                      Meta for Developers <ExternalLink className="h-3 w-3" />
                    </a>
                    , create an app, and configure Facebook Login with these redirect URLs:
                  </p>
                  <div className="space-y-2">
                    {origins.map((o) => (
                      <div key={o} className="space-y-2">
                        <UrlRow label="Valid OAuth Redirect URI" value={`${o}${callbackSuffix}`} />
                      </div>
                    ))}
                  </div>
                  <p>Facebook publishing requires a managed Page. Instagram publishing requires a Business or Creator account linked to that Page; one Meta OAuth flow can connect both.</p>
                  <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400">
                    Production use requires Meta app review for Page publishing and Instagram content publishing permissions.
                  </div>
                </>
              )}
            </div>
          </DialogDescription>
          <form id="oauth-credentials-form" onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`${platform}-client-id`}>Client ID</Label>
              <Input
                id={`${platform}-client-id`}
                name={`${platform}-oauth-client-id`}
                placeholder="your-client-id"
                value={form.clientId}
                onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
                required
                autoComplete="new-password"
                data-1p-ignore="true"
                data-lpignore="true"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${platform}-client-secret`}>Client Secret</Label>
              <Input
                id={`${platform}-client-secret`}
                name={`${platform}-oauth-client-secret`}
                type="password"
                placeholder="your-client-secret"
                value={form.clientSecret}
                onChange={(e) => setForm((f) => ({ ...f, clientSecret: e.target.value }))}
                required
                autoComplete="new-password"
                data-1p-ignore="true"
                data-lpignore="true"
              />
            </div>
            {usesBlogUrl ? (
            <div className="space-y-2">
              <Label htmlFor={`${platform}-blog-url`}>Your blog URL</Label>
              <Input
                id={`${platform}-blog-url`}
                name={`${platform}-oauth-blog-url`}
                type="url"
                placeholder={blogUrlPlaceholder}
                value={form.blogUrl}
                onChange={(e) => setForm((f) => ({ ...f, blogUrl: e.target.value }))}
                autoComplete="url"
              />
              <p className="text-xs text-muted-foreground">
                {platform === "wordpress_com"
                  ? "Scopes the OAuth token to this blog, so the correct blog ID is used when posting."
                  : "Used to look up your Blogger blog ID directly, bypassing the account-level discovery that can fail in testing mode."}
              </p>
            </div>
            ) : null}
          </form>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="oauth-credentials-form" disabled={upsertApp.isPending}>
            {upsertApp.isPending ? "Saving…" : hasSavedCredentials ? "Replace saved credentials & connect" : "Save & connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── WordPress self-hosted credential dialog ──────────────────────────────────

function WordPressSelfDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createConnection = useCreatePlatformConnection({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListPlatformConnectionsQueryKey() }),
    },
  });
  const [form, setForm] = useState({ siteUrl: "", username: "", appPassword: "" });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createConnection.mutate(
      { data: { platform: "wordpress_self", credentials: { siteUrl: form.siteUrl, username: form.username, appPassword: form.appPassword } } },
      {
        onSuccess: () => {
          toast({ title: "Connected", description: "Self-hosted WordPress connected." });
          onClose();
          setForm({ siteUrl: "", username: "", appPassword: "" });
        },
        onError: (err) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const msg = (err as any)?.response?.data?.error ?? "Failed to save credentials. Check them and try again.";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect self-hosted WordPress</DialogTitle>
          <DialogDescription>
            Enter your site URL and an Application Password (create one in WordPress under
            Users → Profile → Application Passwords).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wp-site-url">Site URL</Label>
            <Input id="wp-site-url" type="url" placeholder="https://yourblog.example.com" value={form.siteUrl}
              onChange={(e) => setForm((f) => ({ ...f, siteUrl: e.target.value }))} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wp-username">Username</Label>
            <Input id="wp-username" placeholder="your-wp-username" value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wp-app-password">Application Password</Label>
            <Input id="wp-app-password" type="password" placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
              value={form.appPassword} onChange={(e) => setForm((f) => ({ ...f, appPassword: e.target.value }))} required />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createConnection.isPending}>
              {createConnection.isPending ? "Saving…" : "Save & connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubstackDialog({
  open,
  onClose,
  initialPublicationId,
  initialPublicationHost,
}: {
  open: boolean;
  onClose: () => void;
  initialPublicationId?: string | null;
  initialPublicationHost?: string | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createConnection = useCreatePlatformConnection({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListPlatformConnectionsQueryKey() }),
    },
  });
  const [form, setForm] = useState({
    sessionCookie: "",
    publicationId: initialPublicationId ?? "",
    publicationHost: initialPublicationHost ?? "",
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      sessionCookie: "",
      publicationId: initialPublicationId ?? "",
      publicationHost: initialPublicationHost ?? "",
    });
  }, [initialPublicationHost, initialPublicationId, open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createConnection.mutate(
      {
        data: {
          platform: "substack",
          credentials: {
            sessionCookie: form.sessionCookie,
            publicationId: form.publicationId,
            publicationHost: form.publicationHost,
          },
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Connected", description: "Substack connected." });
          onClose();
          setForm({ sessionCookie: "", publicationId: "", publicationHost: "" });
        },
        onError: (err) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const msg = (err as any)?.response?.data?.error ?? "Failed to save credentials. Check them and try again.";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect Substack</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400">
                WARNING: Unofficial API. Credentials stored in the MySQL platform connections record.
              </div>
              <p>
                Enter your Substack <code className="rounded bg-muted px-1 py-0.5 text-xs">connect.sid</code> session cookie
                , publication ID, and publication hostname for the newsletter you want to publish to.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="substack-session-cookie">Session cookie</Label>
            <Input
              id="substack-session-cookie"
              name="substack-session-cookie"
              type="password"
              placeholder="connect.sid value"
              value={form.sessionCookie}
              onChange={(e) => setForm((f) => ({ ...f, sessionCookie: e.target.value }))}
              required
              autoComplete="new-password"
              data-1p-ignore="true"
              data-lpignore="true"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="substack-publication-id">Publication ID</Label>
            <Input
              id="substack-publication-id"
              name="substack-publication-id"
              placeholder="123456"
              value={form.publicationId}
              onChange={(e) => setForm((f) => ({ ...f, publicationId: e.target.value }))}
              required
              inputMode="numeric"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="substack-publication-host">Publication hostname</Label>
            <Input
              id="substack-publication-host"
              name="substack-publication-host"
              placeholder="yourpublication.substack.com"
              value={form.publicationHost}
              onChange={(e) => setForm((f) => ({ ...f, publicationHost: e.target.value }))}
              required
              autoComplete="url"
            />
            <p className="text-xs text-muted-foreground">
              Used for Substack&apos;s publication-scoped draft and publish endpoints. You can update this later from the same card.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createConnection.isPending}>
              {createConnection.isPending ? "Saving…" : "Save & connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BlueskyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ handle: "", appPassword: "" });
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    try {
      const res = await fetch("/api/platform-oauth/bluesky/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          handle: form.handle,
          appPassword: form.appPassword,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to connect Bluesky account.");
      }

      await queryClient.invalidateQueries({ queryKey: getListPlatformConnectionsQueryKey() });
      toast({ title: "Connected", description: "Bluesky connected." });
      setForm({ handle: "", appPassword: "" });
      onClose();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to connect Bluesky account.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect Bluesky</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                Create an App Password in Bluesky Settings, then enter your handle and that password here.
                Do not use your main account password.
              </p>
              <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400">
                This sends selected posts to Bluesky through the AT Protocol. Each syndicated copy should still point back to the canonical post on this site.
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bluesky-handle">Handle</Label>
            <Input
              id="bluesky-handle"
              placeholder="you.bsky.social"
              value={form.handle}
              onChange={(e) => setForm((f) => ({ ...f, handle: e.target.value }))}
              required
              autoComplete="username"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bluesky-app-password">App Password</Label>
            <Input
              id="bluesky-app-password"
              type="password"
              placeholder="xxxx-xxxx-xxxx-xxxx"
              value={form.appPassword}
              onChange={(e) => setForm((f) => ({ ...f, appPassword: e.target.value }))}
              required
              autoComplete="new-password"
              data-1p-ignore="true"
              data-lpignore="true"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : "Save & connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Platform card ─────────────────────────────────────────────────────────────

function PlatformCard({
  platform,
  connection,
  appConfigured,
  appBlogUrl,
  onAppSaved,
}: {
  platform: PlatformDef;
  connection: PlatformConnection | undefined;
  appConfigured: boolean;
  appBlogUrl?: string | null;
  onAppSaved: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListPlatformConnectionsQueryKey() });

  const toggleConnection = useUpdatePlatformConnection({ mutation: { onSuccess: invalidate } });
  const deleteConnection = useDeletePlatformConnection({ mutation: { onSuccess: invalidate } });
  const [showDialog, setShowDialog] = useState(false);

  const isConnected = Boolean(connection?.configured);
  const hasSavedAppOnly = Boolean(platform.oauthAppPlatform && appConfigured && !isConnected);
  const meta = parseConnectionMeta(connection?.metadata);
  const substackAuthExpired =
    platform.id === "substack" && meta.authStatus === "expired";
  const substackStatusMessage =
    typeof meta.statusMessage === "string" ? meta.statusMessage : "";
  const substackPublicationId =
    typeof meta.publicationId === "string" ? meta.publicationId : null;
  const substackPublicationHost =
    typeof meta.publicationHost === "string" ? meta.publicationHost : null;

  function handleConnect() {
    if (platform.oauthAppPlatform) {
      if (appConfigured) {
        // Credentials already in DB — go straight to OAuth.
        window.location.href = platform.oauthPath!;
      } else {
        // Prompt for CLIENT_ID/SECRET first, then redirect.
        setShowDialog(true);
      }
    } else if (platform.credentialKind) {
      setShowDialog(true);
    }
  }

  function handleDisconnect() {
    if (!connection) return;
    deleteConnection.mutate({ id: connection.id }, {
      onSuccess: () => toast({ title: "Disconnected", description: `${platform.label} disconnected.` }),
      onError: () => toast({ title: "Error", description: "Failed to disconnect.", variant: "destructive" }),
    });
  }

  function handleToggle(checked: boolean) {
    if (!connection) return;
    toggleConnection.mutate({ id: connection.id, data: { enabled: checked } }, {
      onError: () => toast({ title: "Error", description: "Failed to update.", variant: "destructive" }),
    });
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-2">
          <div>
            <CardTitle className="text-base">{platform.label}</CardTitle>
            <CardDescription className="mt-1">{platform.description}</CardDescription>
          </div>
          <Badge variant={isConnected ? "default" : "secondary"}>
            {isConnected ? "Connected" : hasSavedAppOnly ? "App saved" : "Not connected"}
          </Badge>
        </CardHeader>
        <CardContent>
          {substackAuthExpired ? (
            <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              {substackStatusMessage || "Substack session expired. Update your credentials to reconnect."}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-4">
            {isConnected ? (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={connection?.enabled ?? false}
                  onCheckedChange={(v) => handleToggle(v === true)}
                  disabled={toggleConnection.isPending}
                />
                Show in post composer
              </label>
            ) : hasSavedAppOnly ? (
              <span className="text-sm text-muted-foreground">Saved app settings found. Review or replace them before reconnecting.</span>
            ) : (
              <span className="text-sm text-muted-foreground">Connect to use in the post composer.</span>
            )}
            <div className="flex gap-2">
              {platform.oauthAppPlatform && appConfigured ? (
                <Button variant="ghost" size="sm" onClick={() => setShowDialog(true)}>
                  {isConnected ? "Update app settings" : "Edit saved app settings"}
                </Button>
              ) : null}
              {platform.credentialKind && isConnected ? (
                <Button variant="ghost" size="sm" onClick={() => setShowDialog(true)}>
                  Update credentials
                </Button>
              ) : null}
              {isConnected ? (
                <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={deleteConnection.isPending}>
                  {deleteConnection.isPending ? "Removing…" : "Disconnect"}
                </Button>
              ) : (
                <Button size="sm" onClick={handleConnect}>Connect</Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {platform.oauthAppPlatform && platform.oauthPath && (
        <OAuthAppCredentialsDialog
          open={showDialog}
          onClose={() => setShowDialog(false)}
          platform={platform.oauthAppPlatform}
          label={platform.label}
          setupHref={platform.setupHref}
          oauthPath={platform.oauthPath}
          initialBlogUrl={appBlogUrl}
          hasSavedCredentials={appConfigured}
          onSaved={onAppSaved}
        />
      )}
      {platform.credentialKind === "wordpress_self" && (
        <WordPressSelfDialog open={showDialog} onClose={() => setShowDialog(false)} />
      )}
      {platform.credentialKind === "substack" && (
        <SubstackDialog
          open={showDialog}
          onClose={() => setShowDialog(false)}
          initialPublicationId={substackPublicationId}
          initialPublicationHost={substackPublicationHost}
        />
      )}
      {platform.credentialKind === "bluesky" && (
        <BlueskyDialog open={showDialog} onClose={() => setShowDialog(false)} />
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPlatformsPage() {
  const { isOwner } = useCurrentUser();
  const { toast } = useToast();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const queryClient = useQueryClient();

  const connections = useListPlatformConnections({
    query: { enabled: isOwner, queryKey: getListPlatformConnectionsQueryKey() },
  });
  const oauthApps = useListPlatformOAuthApps({
    query: { enabled: isOwner, queryKey: getListPlatformOAuthAppsQueryKey() },
  });

  const [shownParam, setShownParam] = useState<string | null>(null);
  const connectedParam = params.get("connected");
  const errorParam = params.get("error");
  const notifyParam = connectedParam ?? errorParam;

  if (notifyParam && notifyParam !== shownParam) {
    setShownParam(notifyParam);
    if (connectedParam) {
      const label = connectedParam
        .split(",")
        .map((platformId) => PLATFORMS.find((p) => p.id === platformId)?.label ?? platformId)
        .join(" + ");
      toast({ title: "Connected", description: `${label} connected successfully.` });
    } else if (errorParam) {
      const ERROR_MESSAGES: Record<string, string> = {
        wordpress_com_denied: "WordPress.com authorization was cancelled.",
        wordpress_com_not_configured: "WordPress.com app credentials not configured.",
        wordpress_com_failed: "WordPress.com connection failed. Check the server logs.",
        wordpress_com_no_blog: "Connected to WordPress.com but no blog was found on this account. Make sure your account has at least one WordPress.com site, then try again.",
        blogger_denied: "Blogger authorization was cancelled.",
        blogger_not_configured: "Blogger app credentials not configured.",
        blogger_failed: "Blogger connection failed. Check the server logs.",
        blogger_no_blog: "Connected to Google but no Blogger blog was found. Make sure your account has a Blogger blog and that your Google account is added as a test user in the OAuth consent screen, then try again.",
        linkedin_denied: "LinkedIn authorization was cancelled.",
        linkedin_authorization_failed: "LinkedIn did not issue an authorization code. Check that the app has both Share on LinkedIn and Sign In with LinkedIn using OpenID Connect enabled, then check server logs for LinkedIn's exact error.",
        linkedin_not_configured: "LinkedIn app credentials not configured.",
        linkedin_token_failed: "LinkedIn token exchange failed. Check the server logs.",
        linkedin_no_profile: "Connected to LinkedIn but could not read the member profile identifier.",
        linkedin_failed: "LinkedIn connection failed. Check the server logs.",
        facebook_denied: "Meta authorization was cancelled.",
        facebook_not_configured: "Meta app credentials not configured.",
        facebook_token_failed: "Meta token exchange failed. Check the server logs.",
        facebook_no_pages: "Connected to Meta but no managed Facebook Pages were available for publishing.",
        facebook_failed: "Meta connection failed. Check the server logs.",
      };
      const msg = ERROR_MESSAGES[errorParam] ?? "The platform denied the request or an error occurred.";
      toast({ title: "Connection failed", description: msg, variant: "destructive" });
    }
  }

  const connectionMap = new Map(
    (connections.data?.connections ?? []).map((c) => [c.platform, c]),
  );
  const appMap = new Map(
    (oauthApps.data?.apps ?? []).map((a) => [a.platform, a]),
  );

  const invalidateApps = () =>
    queryClient.invalidateQueries({ queryKey: getListPlatformOAuthAppsQueryKey() });

  return (
    <AdminLayout
      title="Platforms"
      description="Connect external publishing platforms. Enabled connections appear in the post composer's Share to dropdown."
    >
      <div className="space-y-4">
        {PLATFORMS.map((platform) => (
          <PlatformCard
            key={platform.id}
            platform={platform}
            connection={connectionMap.get(platform.id)}
            appConfigured={platform.oauthAppPlatform ? (appMap.get(platform.oauthAppPlatform)?.configured ?? false) : false}
            appBlogUrl={platform.oauthAppPlatform ? (appMap.get(platform.oauthAppPlatform)?.blogUrl ?? null) : null}
            onAppSaved={invalidateApps}
          />
        ))}
      </div>
    </AdminLayout>
  );
}
