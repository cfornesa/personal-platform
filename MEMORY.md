<!-- Agent reads this file at every session start. Surface any entry marked PENDING CONFIRMATION
to the human before proceeding. Do not act on a pending entry — wait for explicit confirmation
or rejection. -->

2026-04-28 · PRODUCT · The project direction is an author-owned microblog where only the site owner publishes canonical posts, while signed-in visitors can comment and react.
    [Verified from CONSTRAINTS.md and DECISIONS.md.]

2026-04-28 · AUTH · The repo direction is a migration away from Clerk toward Auth.js with GitHub and Google as the initial OAuth providers.
    [Verified from DECISIONS.md, docs/auth-setup.md, and untracked auth migration files.]

2026-04-28 · ROLES · The initial local capability model is `owner` plus `member`, with owner bootstrap handled by manual promotion after the owner's first successful login.
    [Verified from CONSTRAINTS.md and docs/auth-setup.md.]

2026-04-28 · DEV SETUP · Local development expects separate frontend and backend processes, with the frontend on `http://localhost:3000`, the backend on `http://localhost:8080`, and frontend proxying for `/api/*` and `/auth/*`.
    [Verified from docs/auth-setup.md and DECISIONS.md.]

2026-04-28 · STACK · The current repo is an npm workspaces TypeScript monorepo with an Express 5 API, a React 19 + Vite frontend, and MySQL via Drizzle ORM.
    [Verified from package.json and DECISIONS.md.]

2026-04-29 · RECOVERY NOTE · Shared memory was repopulated from repo evidence after discovering that MEMORY.md had not been filled in, while DECISIONS.md and CONSTRAINTS.md already contained substantial project history.
    [Verified from the current repository state, docs, and recent git history on 2026-04-29.]

2026-04-29 · AUTHORING · Owner-authored posts now support rich editing with sanitized HTML storage, local image uploads, and owner-trusted `https:` iframe embeds, while legacy plain-text posts still remain renderable.
    [Verified from DECISIONS.md, docs/dependencies.md, and the current post editor/backend route structure.]

2026-04-29 · EMBEDS · The owner is now the trust boundary for iframe embeds, so rich posts may render any `https:` iframe source rather than a server-maintained host allowlist.
    [Verified from DECISIONS.md and the current sanitizer behavior.]

2026-04-29 · COMMENTS · Signed-in users can edit their own plain-text comments inline, while post publishing remains owner-only.
    [Verified from DECISIONS.md, CONSTRAINTS.md, and the current frontend/backend comment flow.]

2026-04-29 · FEEDS · The site now publishes public standardized feeds at `GET /feed.xml` (Atom), `GET /feed.json` (JSON Feed 1.1), and `GET /export/json` (mf2-JSON), while preserving `GET /export.json` as a compatibility alias.
    [Verified from DECISIONS.md and the current route surface.]

2026-04-29 · HOMEPAGE UX · The owner post composer is collapsed by default, and the home feed now includes client-side sort/filter controls for browsing posts.
    [Verified from DECISIONS.md and the current homepage component structure.]

2026-04-29 · DATASTORE · MySQL is now the canonical datastore for both local authoring and deployed publishing, while SQLite is retained only as legacy import material during the migration away from build-coupled storage.
    [Verified from DECISIONS.md, the current DB runtime code, and the successful local MySQL-backed publishing behavior observed in session.]

2026-04-29 · DEPLOY SAFETY · The Hostinger build-scoped SQLite workflow proved capable of replacing deployed content, so future continuity and publishing decisions should assume MySQL is the authoritative persistence layer.
    [Verified from session evidence and the new MySQL-first repository state.]

2026-05-02 · POST UX · Posts in the feed now support a "Maximize" (Expand) action to view the post detail page and a "Code" (Embed) action to copy a frameless iframe snippet for external use.
    [Verified from the current PostCard hover actions and the new /embed/posts/:id route.]

2026-05-02 · AUTH · Auth.js routing has been restored to the default `/api/auth` path to ensure compatibility with existing OAuth provider configurations.
    [Verified from the updated app.ts mount point and the requirement for a full URL in AUTH_URL.]

2026-05-02 · USER PROFILES · Users can now customize their profile with a username, bio, website, and social links via a new Settings page, with the UI supporting @username routing and rich profile displays.
    [Verified from the new SettingsPage, updated UserProfile layout, and the backend /users routes.]

2026-05-02 · ENGAGEMENT · Unauthenticated visitors are now directed to "Learn More About Me" linking to the author's profile, rather than being prompted to sign in for comments, aligning with the author-centric focus.
    [Verified from the updated Home page hero and Sign Up view.]

2026-05-03 · DEPLOY · Deployment is configured in `.replit` for `autoscale` with `build = ["npm","run","build"]` and `run = ["node","--enable-source-maps","artifacts/api-server/dist/index.mjs"]`. The API server serves the built frontend statically and `/api/*` on the same port. All artifact configs use `npm run … --workspace=@workspace/X`; no `pnpm` invocations remain.
    [Verified from `.replit`, all three `artifacts/*/.replit-artifact/artifact.toml` files, and a local end-to-end run of `npm run build` + `node artifacts/api-server/dist/index.mjs` (frontend `/` 200, `/api/healthz` 200, clean SIGTERM exit 0).]

2026-05-03 · DEV SERVER · The API server traps `SIGTERM`/`SIGINT` for idempotent graceful shutdown with a 5s force-exit safeguard. The microblog Vite dev server reads `FRONTEND_PORT ?? PORT ?? 3000` for its own port and uses `API_PORT` (not `PORT`) when defaulting `API_ORIGIN`, which fixes the proxy-to-self failure when the Replit artifact sets `PORT`.
    [Verified from `artifacts/api-server/src/index.ts`, `artifacts/microblog/vite.config.ts`, and a clean restart of both workflows on the live preview.]

2026-05-05 · BASELINE · The current working tree is now the documentation and schema baseline, superseding the earlier reduced-schema cleanup snapshot as the intended runtime shape.
    [Verified from the user's explicit choice to use the current tree as the forward path and the active schema/runtime files under `lib/db/src/` and `artifacts/api-server/src/`.]

2026-05-05 · DATABASE · The current canonical MySQL schema includes not only auth, posts, comments, and reactions, but also `user_ai_vendor_settings`, `feed_sources`, `feed_items_seen`, `categories`, `post_categories`, `pages`, `nav_links`, and `site_settings`.
    [Verified from `lib/db/src/migrate.ts`, `lib/db/src/schema/index.ts`, and the active route surface that reads and writes those tables.]

2026-05-15 · DATABASE · The canonical MySQL schema now also includes `art_pieces`, `art_piece_versions` (interactive piece authoring), `platform_connections` (per-user POSSE OAuth tokens), `platform_oauth_apps` (site-wide OAuth client credentials for WordPress.com and Blogger), and `post_syndications` (per-post syndication dispatch log).  `posts` additionally has `scheduled_at` (nullable datetime for deferred publish) and `pending_platform_ids` (JSON array of platform_connection IDs to syndicate to at publish time).  `posts.status` now has four confirmed values: `published`, `pending`, `draft`, `scheduled`.
    [Verified from `lib/db/src/migrate.ts` ensureTables() calls and `lib/db/src/schema/` files.]

2026-05-05 · AUTH · Auth.js is mounted at `/api/auth`, and the repo's docs should treat that path as the canonical OAuth callback base rather than `/auth`.
    [Verified from `artifacts/api-server/src/app.ts` and `artifacts/api-server/src/auth/config.ts`.]

2026-05-05 · DEV SETUP · The default local workflow is now single-port `npm run dev`, while `npm run dev:hot` is the optional two-port mode for Vite hot reload.
    [Verified from the root `package.json`, `scripts/serve.mjs`, and `docs/auth-setup.md` updates requested in this session.]

2026-05-05 · CMS · The current product baseline includes owner-managed site settings, CMS-style pages at `/p/:slug`, system and page-backed nav items, category pages, and a public `/feeds` catalog in addition to post feeds.
    [Verified from `artifacts/api-server/src/routes/site-settings.ts`, `pages.ts`, `nav-links.ts`, `categories.ts`, and `feeds-catalog.ts`.]

2026-05-05 · FEEDS · Feed ingestion is part of the intended runtime again: feed sources can be stored locally, refreshed, deduplicated through `feed_items_seen`, and imported posts enter a pending moderation flow instead of publishing automatically.
    [Verified from `artifacts/api-server/src/routes/feed-sources.ts`, `pending-posts.ts`, and the `posts.status` / `posts.source_*` schema fields.]

2026-05-05 · SEARCH · Public post search depends on the `posts.content_text` shadow column and its FULLTEXT index, so those are required parts of the current schema rather than cleanup leftovers.
    [Verified from `artifacts/api-server/src/routes/posts.ts`, `lib/db/src/migrate.ts`, and `lib/db/src/schema/posts.ts`.]

2026-05-05 · AI · Owner-only AI writing assistance is now a first-class optional feature, with per-vendor encrypted API-key settings stored in `user_ai_vendor_settings` and text-processing routed through vendor adapters.
    [Verified from `artifacts/api-server/src/routes/ai.ts`, `artifacts/api-server/src/lib/ai-settings.ts`, and `docs/dependencies.md`.]

2026-05-06 · FEED SOURCES · Feed sources now support an optional `authorName` column. During ingestion, attribution priority is: `source.authorName > feed_item.originalAuthor > source.name`. PostCard shows the blog name (`sourceFeedName`) in the byline for imported posts, and renders "by &lt;individual&gt; via &lt;blog&gt;" when the individual author differs from the blog name.
    [Verified from `lib/db/src/schema/feeds.ts`, `artifacts/api-server/src/routes/feed-sources.ts`, and `artifacts/microblog/src/components/post/PostCard.tsx`.]

2026-05-06 · HOME FEED · The home timeline now supports server-side category and source filtering. Category can be a slug, "uncategorized" (posts with no assigned category), or "all". Source can be "original" (owner-authored posts), a numeric feed source ID, or "all". These drive new `?category` and `?source` query params on `GET /posts`.
    [Verified from `artifacts/microblog/src/pages/home.tsx` and `artifacts/api-server/src/routes/posts.ts`.]

2026-05-06 · FEEDS CATALOG · The `/feeds` endpoint now always returns Atom + JSON feeds for every published category without requiring `?category=<slug>`. The former `?category` param is kept for backward compatibility but is now a no-op. `PUBLIC_SITE_URL` env var is used as the canonical origin for all feed and catalog links when set, falling back to `x-forwarded-host` then the request host.
    [Verified from `artifacts/api-server/src/routes/feeds-catalog.ts` and `artifacts/api-server/src/routes/feeds.ts`.]

2026-05-06 · PROFILES · `PATCH /users/me` now syncs the updated display `name` to `authorName` on all posts authored by that user, keeping post bylines in sync when the owner or a member renames themselves.
    [Verified from `artifacts/api-server/src/routes/users.ts`.]

2026-05-06 · ENV VARS · `.env.example` now documents `AI_SETTINGS_ENCRYPTION_KEY`, `PUBLIC_SITE_URL`, `SITE_TITLE`, `SITE_DESCRIPTION`, and `SITE_AUTHOR_NAME`. `AUTH_URL` has been removed from the example (it caused confusion; Auth.js derives the URL from the request when `AUTH_TRUST_HOST` is set or the `AUTH_URL` is set explicitly where needed). `ALLOWED_ORIGINS` defaults to just `http://localhost:8080` in single-port mode.
    [Verified from `.env.example` diff.]

2026-05-15 · FEEDS · The primary outbound feed URLs are now under `/api/`: `/api/feeds/atom`, `/api/feeds/json`, `/api/feeds/mf2`. Per-category variants follow `/api/categories/:slug/feeds/atom` and `/api/categories/:slug/feeds/json`; per-page variants follow `/api/p/:slug/feeds/atom` and `/api/p/:slug/feeds/json`. The earlier extension-based routes (`/feed.xml`, `/feed.json`, `/atom`, `/jsonfeed`, `/export/json`, `/export.json`) are kept as backward-compatible aliases. The move under `/api/` was required to work around the Replit dev proxy, which only forwards `/api/*` paths to Express.
    [Verified from `replit.md` architecture notes and `artifacts/api-server/src/routes/feeds.ts` + `feeds-catalog.ts`.]

2026-05-15 · INTERACTIVE PIECES · The owner can create, version, and embed reusable interactive art pieces using `p5`, `c2`, or `three` engines. AI-generated pieces are mandatory HTML/CSS/JS code-block responses; the API preflights drafts before showing a preview. Saved pieces are embedded via `/embed/pieces/:id` (resolves the current version live). Pieces are managed at `/admin/pieces` and stored in `art_pieces` / `art_piece_versions` tables.
    [Verified from `lib/db/src/schema/art-pieces.ts`, `artifacts/api-server/src/routes/art-pieces.ts`, and `replit.md` product section.]

2026-05-15 · POSSE SYNDICATION · The owner can publish posts to WordPress.com, WordPress self-hosted, Medium, Blogger, Substack, Bluesky, LinkedIn, and Meta (Facebook Page + Instagram Business/Creator) via POSSE. OAuth app credentials (client ID + secret) are stored encrypted in `platform_oauth_apps`; per-user access tokens are stored in `platform_connections`. Syndication dispatch records live in `post_syndications`. Posts can be syndicated at publish time (by supplying `platformConnectionIds` when creating/publishing a post) or scheduled for later via `scheduledAt`. A post scheduler runs every 60s and auto-publishes due scheduled posts, dispatching syndication as part of the flip. Medium uses a personal self-integration token (no env-var OAuth); Bluesky uses an App Password (no developer account required). `MEDIUM_CLIENT_ID`/`MEDIUM_CLIENT_SECRET` env vars are NOT used.
    [Verified from `lib/db/src/schema/platform-connections.ts`, `platform-oauth-apps.ts`, `post-syndications.ts`, `artifacts/api-server/src/lib/post-scheduler.ts`, `artifacts/api-server/src/lib/syndication/`, and `docs/dependencies.md`.]

2026-05-30 · DEV PORT · The default local development port is `4000` (not 8080). macOS AirPlay Receiver occupies port 5000, so local `.env` uses `PORT=4000`. Replit overrides to `PORT=5000` via the workflow. Callback URLs for GitHub/Google OAuth in local development use `localhost:4000`.
    [Verified from `docs/auth-setup.md` and `replit.md`.]

2026-05-30 · BOOTSTRAP · First-owner auto-claim is handled via `OWNER_EMAILS` env var. When no owner exists and an incoming sign-in email matches `OWNER_EMAILS`, the account is promoted automatically and redirected to `/admin/setup`. The setup wizard captures display name, username, site title, hero copy, and about body; "Complete setup and go live" lifts the public setup gate. Tracked in `site_bootstrap_state` table. Existing populated databases bypass the gate automatically.
    [Verified from `artifacts/api-server/src/lib/bootstrap.ts`, `artifacts/api-server/src/routes/bootstrap.ts`, `lib/db/src/schema/site-bootstrap-state.ts`, and `docs/auth-setup.md`.]

2026-05-30 · ENV VARS · Active runtime env vars now include `SESSION_SECRET` and `OWNER_EMAILS` (required for bootstrap). `AUTH_URL` and `NEXTAUTH_URL` must NOT be set — the app deletes them at startup to avoid OAuth redirect mismatches. `SITE_URL` is a legacy alias that `post-scheduler.ts` still reads as fallback after `PUBLIC_SITE_URL`.
    [Verified from `artifacts/api-server/src/auth/config.ts`, `artifacts/api-server/src/lib/bootstrap.ts`, and `artifacts/api-server/src/lib/post-scheduler.ts`.]

2026-05-30 · INTERACTIVE PIECES · Owner can create, version, and embed reusable interactive art pieces (`p5`, `c2`, `three`). Managed at `/admin/pieces`. Embed at `/embed/pieces/:id` (resolves current version live). Piece generation is restricted to OpenCode Zen, OpenCode Go, Google, Mistral AI, Mistral Vibe, and DeepSeek server-side. Text generation supports all configured vendors. Image alt-text excludes DeepSeek. Stored in `art_pieces` / `art_piece_versions`.
    [Verified from `lib/db/src/schema/art-pieces.ts`, `artifacts/api-server/src/routes/art-pieces.ts`, `artifacts/api-server/src/lib/ai-settings.ts`, and `replit.md`.]

2026-05-30 · EXHIBITS · Owner-managed named collections of pieces and images. Each exhibit renders as a multi-frame Three.js museum wall at `/immersive/exhibits/:slug`. Managed from `/admin/exhibits`. Stored in `exhibits`, `piece_exhibits`, `media_asset_exhibits`. Soft-deletable via recycle bin.
    [Verified from `lib/db/src/schema/exhibits.ts`, `artifacts/api-server/src/routes/exhibits.ts`, and `artifacts/microblog/src/pages/admin/admin-exhibits.tsx`.]

2026-05-30 · IMMERSIVE VIEWER · Local images, saved pieces, and exhibits all expose an immersive fullscreen viewer. Routes: `/immersive/images/:encodedRef`, `/immersive/pieces/:id`, `/immersive/exhibits/:slug`. All three share the same fullscreen expand/contract model. Immersive routes are additive — existing post, page, and embed URLs are unchanged.
    [Verified from `artifacts/microblog/src/App.tsx` route registrations and `artifacts/microblog/src/pages/immersive-*.tsx`.]

2026-05-30 · RECYCLE BIN · Soft-delete is supported for posts, pieces, media assets, exhibits, pages, and categories. Owner restores or permanently deletes from `/admin/recycle-bin`. API: `GET /recycle-bin`, `POST /recycle-bin/:type/:id/restore`, `DELETE /recycle-bin/:type/:id`. All entity types including exhibits and pages are covered.
    [Verified from `artifacts/api-server/src/routes/recycle-bin.ts`.]

2026-05-30 · MEDIA LIBRARY · Owner-managed Image Library backed by `media_assets`. Supports direct file uploads and URL imports (8 MB cap, magic-byte validated). Used for post images, featured images, feed-source profile photos, and exhibit items. Served from `/api/media/:fileName`. Member profile-only photos are separate: `profile_photo_assets` table, served from `/api/profile-photos/:fileName`. Photo changes cascade to post avatar rows.
    [Verified from `lib/db/src/schema/media-assets.ts`, `lib/db/src/schema/profile-photo-assets.ts`, `artifacts/api-server/src/routes/media.ts`, and `docs/dependencies.md`.]

2026-05-30 · SITE ASSETS · Bundled site assets (favicon etc.) are seeded into MySQL-backed `site_assets` table on first boot and served from DB-backed routes. This keeps the shell replaceable without losing site identity artifacts.
    [Verified from `lib/db/src/schema/site-assets.ts` and `artifacts/api-server/src/lib/site-assets.ts`.]

2026-05-30 · AI VENDORS · Full current vendor list: OpenCode Zen (`opencode-zen`), OpenCode Go (`opencode-go`), Google Gemini (`google`), OpenRouter (`openrouter`), Mistral AI (`mistral`), Mistral Vibe (`mistral-vibe`), DeepSeek (`deepseek`). Vendor capability allowlists in `artifacts/api-server/src/lib/ai-settings.ts` are the backend source of truth. Piece generation excludes OpenRouter. Image descriptions exclude DeepSeek.
    [Verified from `artifacts/api-server/src/lib/ai-settings.ts` and `docs/dependencies.md`.]

2026-05-30 · SCHEMA TABLES · Complete active table list: `users`, `accounts`, `sessions`, `verification_tokens`, `user_ai_vendor_settings`, `posts`, `comments`, `reactions`, `profile_photo_assets`, `feed_sources`, `feed_items_seen`, `categories`, `post_categories`, `pages`, `nav_links`, `site_settings`, `platform_connections`, `platform_oauth_apps`, `post_syndications`, `media_assets`, `media_asset_exhibits`, `art_pieces`, `art_piece_versions`, `exhibits`, `piece_exhibits`, `site_assets`, `site_bootstrap_state`.
    [Verified from `lib/db/src/schema/` directory listing and `docs/db-cleanup-report.md`.]
