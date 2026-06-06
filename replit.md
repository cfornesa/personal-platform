# CreatrWeb

An author-owned microblogging platform for one canonical publisher, with authenticated visitors participating through comments and reactions.

## Run & Operate

- `npm run typecheck`: Type-check all packages.
- `npm run build`: Type-check and build all packages.
- `npm run contracts:sync`: Regenerate API hooks and Zod schemas, then verify generated contract wiring.
- `npm run push-force --workspace=@workspace/db`: Force-push DB schema changes for manual inspection only; normal startup reconciliation happens through `ensureTables()`.
- `npm run dev`: One-port development run, serving frontend and API/Auth routes from the API server.
- `npm run dev:hot`: Two-port hot-reload workflow for API server and Vite frontend.
- `npm run list-users --workspace=@workspace/scripts`: List local users.
- `npm run promote-owner --workspace=@workspace/scripts -- --email you@example.com`: Manual recovery-only owner promotion tool.

**Required Environment Variables:**
- `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`: MySQL connection details.
- `DB_SSL=true`: Required for most hosted MySQL providers (Hostinger, Railway, etc.).
- `ALLOWED_ORIGINS`: Comma-separated origins for CORS. Must match your deployment domain. Also used by the admin UI to generate OAuth callback URLs for platform syndication setup.
- `AUTH_SECRET`, `SESSION_SECRET`: Long random strings for session signing.
- `OWNER_EMAILS`: Comma-separated allowlist for first-owner auto-claim on a fresh database.
- `GITHUB_ID`, `GITHUB_SECRET` OR `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: OAuth credentials for sign-in (at least one provider required).
- `AI_SETTINGS_ENCRYPTION_KEY`: 32-byte secret (base64 or hex) for encrypting AI API keys and platform OAuth app credentials at rest. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- `CRON_SECRET`: Required if using the GitHub Actions scheduled feed refresh.

## CMS Shell Notes

- Treat the repo as a replaceable executable shell and MySQL as the durable site state.
- `npm install`, `npm run build`, and `npm run dev` are the supported lifecycle commands for both fresh and replacement deployments.
- Existing populated databases should render immediately after a shell replacement.
- Empty databases should route the allowed first owner into `/admin/setup` after sign-in.
- For sibling repos, replace the full shell rather than only `artifacts/` and `lib/`; the root `scripts/` directory is part of the lifecycle contract used by `npm run build` and `npm run dev`.

## Stack

- **Monorepo**: npm workspaces
- **Node.js**: 24
- **TypeScript**: 5.9
- **API**: Express 5
- **Database**: MySQL (mysql2) + Drizzle ORM
- **Validation**: Zod (v3), drizzle-zod
- **API Codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild
- **Auth**: Auth.js (GitHub, Google OAuth, local sessions)
- **Frontend**: React + Vite (Tailwind CSS)

## Where things live

- `artifacts/api-server/`: Express API server.
- `artifacts/microblog/`: React + Vite frontend.
- `lib/db/`: Drizzle schema and DB client.
  - Source-of-truth: `lib/db/src/schema/` (DB schema), `lib/db/install.sql` (full DB install script).
- `lib/api-spec/`: OpenAPI 3.1 spec and Orval codegen config.
  - Source-of-truth: `lib/api-spec/openapi.yaml` (API contracts).
- `lib/api-client-react/`: Generated React Query hooks.
- `lib/api-zod/`: Generated Zod request/response schemas.
- `artifacts/microblog/src/index.css`: Theme styles.
- `artifacts/microblog/src/lib/site-themes.ts`: Catalog of themes and palettes.

## Architecture decisions

- **Monorepo Structure**: Uses npm workspaces for a unified development environment for multiple packages, enhancing code sharing and consistency.
- **Single-Runnable Deployment**: The application is deployed as a single runnable to ensure correct routing order for all API endpoints, including feeds, avoiding issues with static asset edge handlers.
- **Host-Agnostic Feed URLs**: Feed URL generation (`feeds.ts`, `feeds-catalog.ts`) derives the origin from `x-forwarded-proto`/`x-forwarded-host` (or the raw Express host as fallback). `PUBLIC_SITE_URL` is intentionally not used for feed URLs so the correct host is reflected across local, Replit dev, and Replit production environments.
- **Replit Webview Proxy Limitation**: The Replit dev proxy only forwards `/api/*` paths to Express; all other paths are served as the SPA (`index.html`), regardless of file extension. This affects both the `*.replit.dev` webview URL and any custom domain CNAMEd to `*.replit.dev` (including `platform.creatrweb.com` while it points to the dev URL). **Fix**: feed content routes and the catalog URL generation were moved into the API router (under `/api`) in `feeds-catalog.ts`. The primary feed URLs are now `/api/feeds/atom`, `/api/feeds/json`, `/api/feeds/mf2`, `/api/categories/:slug/feeds/atom`, `/api/categories/:slug/feeds/json`, `/api/p/:slug/feeds/atom`, and `/api/p/:slug/feeds/json`. The original extension-based routes (`/feed.xml`, `/feed.json`, `/atom`, `/jsonfeed`, etc.) are kept as backward-compatible aliases in `feeds.ts`.
- **Port Setup**: The Replit workflow sets `PORT=5000` inline (`PORT=5000 npm run dev`). `externalPort = 80` maps to `localPort = 5000` for the default webview URL. `externalPort = 5000` also maps to `localPort = 5000` for direct port access. `.env` has `PORT=4000` for local development — macOS's AirPlay Receiver occupies port 5000, so local dev uses 4000 while Replit overrides to 5000 via the workflow.
- **HTML Sanitization**: All HTML feed bodies are sanitized server-side to prevent XSS attacks, stripping dangerous markup while preserving necessary microformats2 markers.
- **Measurement-based Navbar**: The header dynamically adjusts inline navigation links and search bar visibility based on available width, using a `ResizeObserver` to optimize layout across various desktop screen sizes without a fixed hamburger.
- **Dedicated `content_text` column for Full-Text Search**: A separate, automatically populated `content_text` column on the `posts` table ensures that the MySQL FULLTEXT index is always synchronized with the rendered post body, providing consistent and accurate search results.
- **Denormalized Avatar Columns With Reconciliation**: `posts.author_image_url` stores the avatar shown on post cards for fast feed/profile rendering. Updates to human profile photos and feed-source profile photos intentionally cascade to existing post rows, and startup reconciliation backfills rows from `users.image` and `feed_sources.image_url`.

## Product

- **Microblogging**: The owner can create, edit, and syndicate canonical posts; signed-in members can comment and edit their own comments.
- **User Profiles**: Authenticated users can manage their public identity, including name, username, bio, website, and social links.
- **Profile Photos**: Every authenticated user can upload a profile photo from Settings. Member uploads are stored as database-backed profile-only assets (`profile_photo_assets`, served from `/api/profile-photos/:fileName`) and do not appear in the Image Library. Owner uploads use the reusable Image Library path (`media_assets`, served from `/api/media/:fileName`), and owners can also select an existing Image Library image. Human profile photo changes update `users.image` and cascade to existing owner-authored post avatars.
- **Site Customization**: Owners can customize site-wide identity, theme, color palette, and individual colors.
- **Per-User Profile Theming**: Signed-in users can personalize their individual profile page's theme, palette, and colors, which applies only to their profile content.
- **Rich Post Editor**: Provides owners with a WYSIWYG editor for posts, supporting text formatting, image uploads, and embedded media (YouTube, generic iframes).
- **Interactive Pieces**: Owners can generate and manage reusable `p5`, `c2`, and `three` pieces. AI generation returns mandatory HTML/CSS/JS code blocks, the API preflights drafts before display, and embed snippets resolve the current piece version live at `/embed/pieces/:id`. Piece generation is restricted to OpenCode Zen, OpenCode Go, Google, Mistral AI, Mistral Vibe, and DeepSeek (`PIECE_GENERATION_VENDORS` in `ai-settings.ts`). DeepSeek and OpenCode Go/Zen art-piece chat-completions requests use non-thinking mode so the provider is more likely to return final HTML/CSS/JS blocks instead of reasoning-only content. Piece-generation provider requests share the 20-minute generation budget across up to 5 attempts, retry retryable provider failures, and surface provider failure stages such as `provider_upstream_http` and `provider_timeout`; ordinary text rewriting keeps the normal provider request shape. Text generation supports all configured vendors. Image alt text uses a separate image-description allowlist and excludes DeepSeek until official API image-input support is documented or live-verified. The "Piece" mode option in the post editor is hidden unless at least one piece-capable vendor is enabled and configured.
- **Immersive Viewer**: Local images, saved interactive pieces, and exhibits expose a lower-right immersive affordance that opens a dedicated route (`/immersive/images/:encodedRef`, `/immersive/pieces/:id`, `/immersive/exhibits/:slug`). Three.js pieces use viewer-managed OrbitControls with floor click-to-navigate and arrow key translation; p5 and c2 pieces use the browser-only Three.js gallery shell. Image, piece, and exhibit routes all share the same fullscreen expand/contract interaction model. Exhibit walls progressively run only a small device-based budget of interactive pieces live at once, while inactive pieces show persisted thumbnails or session snapshots. Immersive routes are additive — existing post, page, and embed URLs are unchanged.
- **Exhibits**: Owner-managed named collections of pieces and images. Each exhibit renders as a multi-frame Three.js museum wall at `/immersive/exhibits/:slug`. The wall shows configurable rows×columns of frames with per-frame canvas-texture title/engine labels, a lower-right fullscreen control, persisted current-version thumbnails for inactive pieces, a dark metadata section (`ImmersiveMetadataCard`) for name/description/artist statement/biography, and per-item detail cards that render each piece's saved description or each image's saved alt text. Managed from `/admin/exhibits`; pieces and images are assigned via `ExhibitMultiSelect` in their respective admin pages, images can also be assigned from the Image Library detail dialog, and missing active-piece thumbnails are backfilled sequentially from owner admin or owner exhibit views.
- **Inbound Feeds (PESOS)**: Owners can subscribe to external RSS/Atom feeds, review imported items, manage their publication status, and maintain a profile page for each source. Feed sources support username, bio, site URL, and an owner-managed profile photo selected from or uploaded into the Image Library. Feed-source photo changes cascade to all existing posts imported from that source, and new imports use the source photo as their avatar.
- **Outbound Feeds**: The site publishes Atom (`/api/feeds/atom`), JSON Feed (`/api/feeds/json`), and Microformats2 export (`/api/feeds/mf2`). Per-category and per-page variants follow the same pattern (e.g. `/api/categories/:slug/feeds/atom`, `/api/p/:slug/feeds/atom`). The legacy extension-based and extension-free routes (`/feed.xml`, `/feed.json`, `/atom`, `/jsonfeed`, etc.) are kept as backward-compatible aliases.
- **Full-Text Search**: Provides a search interface for posts with filters for categories, sources, author, and content format.
- **Category Management**: Owners can create, rename, and delete categories for posts.

## User preferences

- _Populate as you build_

## Gotchas

- **MySQL DATETIME**: Use `formatMysqlDateTime()` for app-managed MySQL `DATETIME(3)` writes, not `toISOString()`, to prevent timezone-related display issues.
- **Codegen Drift**: After any change to `lib/api-spec/openapi.yaml`, run `npm run codegen --workspace=@workspace/api-spec` to regenerate API clients and Zod schemas to avoid type errors.
- **Profile Photo Storage Split**: Member profile photos are DB-backed profile-only assets in `profile_photo_assets` and are served through `/api/profile-photos/:fileName`; owner and feed-source profile photos use `media_assets` so they appear in the Image Library. Do not let member uploads browse or write through the Image Library selection path.
- **Phantom Git Parents**: If `git push` fails with "did not receive expected object", use `git fast-export --all --reference-excluded-parents | git fast-import` into a temporary repo, then force-push to `origin/main` to resolve dangling parent references.
- **Auth.js `AUTH_URL`**: Do not set `AUTH_URL` or `NEXTAUTH_URL` in `.env`; the application derives these values dynamically to prevent OAuth redirect mismatches.
- **Three.js `renderer.setSize`**: Always pass `false` as the third argument — `renderer.setSize(width, height, false)`. Without it, Three.js overrides `canvas.style.width/height` with explicit pixel values, which overflows the iframe container and makes the scene invisible in the default post-view embed. Use `width`/`height` from the runtime object, not `window.innerWidth`/`window.innerHeight`.
- **Three.js container ID**: The normal-view runtime auto-mounts the managed canvas inside elements with known IDs (`#container`, `#canvas-container`, `#sketch-container`) or falls back to the first `<div>` child of `<body>`. Custom IDs (`#book-container`, `#app`, `#root`) previously caused a blank preview — the canvas was appended to `<body>` after the styled container, hidden by `overflow: hidden`. Fixed at the runtime level in `art-piece-runtime.ts` (`getThreeMount()`); generated pieces should still use `id="container"` as specified in the generation prompt.
- **AI vendor capability allowlists**: Text generation, image descriptions, and piece generation use separate capability allowlists. Piece generation (`POST /art-pieces/generate`) is restricted server-side to `opencode-zen`, `opencode-go`, `google`, `mistral`, `mistral-vibe`, and `deepseek`; image descriptions exclude `deepseek` and return `422 vision_not_supported` if it is requested directly. DeepSeek and OpenCode Go/Zen art-piece chat-completions calls send `thinking: { type: "disabled" }`; Opencode Go/Zen also receive an explicit no-`<think>` system directive. Provider diagnostics distinguish truncation, filtering, upstream resource limits, reasoning-only responses, upstream HTTP failures, and local provider timeouts. Piece-generation provider requests share the 20-minute generation budget across up to 5 attempts. The constants in `artifacts/api-server/src/lib/ai-settings.ts` are the backend source of truth; mirrored constants in the frontend drive task-specific dropdown filtering.
- **Admin AI settings React Query cache**: After saving in `admin-ai.tsx`, `onSuccess` calls `queryClient.setQueryData(key, data)` only — no `invalidateQueries`. `setQueryData` resets the `updatedAt` timestamp, keeping the entry fresh for `staleTime: 60_000` ms. Any `invalidateQueries` call (even with `refetchType: 'none'`) sets `isInvalidated: true`, which causes `refetchOnMount` to fire a background refetch on the next page mount, creating a race that can revert preference dropdowns to old values.

## Pointers

- **Creatrweb Framework**: [https://github.com/cfornesa/creatrweb](https://github.com/cfornesa/creatrweb)
- **OpenAPI Specification**: [https://spec.openapis.org/oas/v3.1.0](https://spec.openapis.org/oas/v3.1.0)
- **Drizzle ORM**: [https://orm.drizzle.team/](https://orm.drizzle.team/)
- **Auth.js Documentation**: [https://authjs.dev/](https://authjs.dev/)
- **React Documentation**: [https://react.dev/](https://react.dev/)
- **Vite Documentation**: [https://vitejs.dev/](https://vitejs.dev/)
