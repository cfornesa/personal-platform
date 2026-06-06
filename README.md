# CreatrWeb

CreatrWeb is an author-owned social publishing platform. One site owner publishes canonical posts on their own domain, while signed-in visitors participate through comments. The app combines a personal-site publishing model with social-feed affordances, public feed/export formats, local authorization, feed import moderation, and optional owner-only AI drafting tools.

## Overview

This repository is a TypeScript npm-workspaces monorepo with three main layers:

- `artifacts/microblog`: React 19 + Vite frontend
- `artifacts/api-server`: Express 5 API server
- `lib/db`: shared MySQL schema and Drizzle runtime

The current product surface includes:

- owner-only post publishing and editing (plain text or rich HTML)
- authenticated member comments and comment editing
- rich post authoring with sanitized HTML, WYSIWYG toolbar, heading levels, YouTube insertion, and image uploads
- local media uploads via the owner-managed Image Library
- owner-trusted `https:` iframe embeds
- dynamic post Open Graph image generation
- public search backed by `posts.content_text`
- owner-managed site settings and theming (site-wide and per-user profile theming)
- public user profiles with per-user customization and profile photo uploads
- categories and category pages
- CMS-style pages at `/p/:slug`
- owner-managed navigation items and page-backed nav
- feed-source ingestion with pending moderation (PESOS)
- outbound POSSE syndication to WordPress.com, self-hosted WordPress, Blogger, Medium, Substack, Bluesky, LinkedIn, and Meta (Facebook + Instagram)
- public feed/export endpoints plus a `/feeds` discovery page and `/api/feeds` catalog
- optional owner-only AI writing assistance with per-vendor encrypted settings (OpenCode Zen, OpenCode Go, Google Gemini, OpenRouter, Mistral AI, Mistral Vibe, DeepSeek)
- interactive art pieces (`p5`, `c2`, `three`) with AI-assisted generation and embed route
- exhibits: named owner-managed collections of pieces and images with an immersive Three.js museum wall
- immersive fullscreen viewer for local images, pieces, and exhibits
- owner recycle bin for soft-deleted posts, pieces, media, exhibits, pages, and categories
- database-backed site assets (favicon etc.) with first-owner auto-claim bootstrap flow

## Product Model

### Roles

- `owner`: can create, edit, and delete posts; manage categories, pages, navigation, feeds, pending imports, platforms, uploads, site settings, AI settings, pieces, exhibits, and the recycle bin
- `member`: can sign in, comment, edit their own comments, manage their profile, and upload a profile photo
- unauthenticated visitors: can read the public site, browse categories/pages, search posts, and subscribe to feeds

Publishing authority is local to the app. Authentication does not grant publishing rights by itself.

### Content Types

- posts: the main timeline content, stored as plain text or sanitized HTML
- pages: standalone CMS-style documents addressed at `/p/:slug`
- categories: reusable taxonomy for grouping posts
- art pieces: owner-authored interactive `p5`/`c2`/`three` pieces with versioning
- exhibits: named collections of pieces and images rendered as an immersive gallery wall
- imported feed items: remote RSS/Atom items staged as `pending` until approved by the owner

## Public Surface

### Frontend Routes

- `/`: home timeline with sort/filter controls and owner composer
- `/posts/:id`: post detail
- `/embed/posts/:id`: minimal post embed view
- `/embed/pieces/:id`: interactive piece embed (resolves current version live)
- `/immersive/images/:encodedRef`: fullscreen immersive image viewer
- `/immersive/pieces/:id`: fullscreen immersive piece viewer
- `/immersive/exhibits/:slug`: immersive Three.js exhibit wall
- `/users/:userId`: public profile
- `/categories`: category index
- `/categories/:slug`: category detail page
- `/p/:slug`: published page
- `/search`: public post search
- `/feeds`: human-facing feed index
- `/sign-in`, `/sign-up`
- `/settings`: authenticated user profile and photo settings
- `/admin/*`: owner-only admin area (setup, site, posts, AI, pieces, library, platforms, exhibits, categories, navigation, pages, recycle bin)

### Feed And Export Endpoints

- `GET /api/feeds`: machine-readable feed catalog used by the `/feeds` page
- `GET /api/feeds/atom`: site-wide Atom feed
- `GET /api/feeds/json`: site-wide JSON Feed 1.1
- `GET /api/feeds/mf2`: site-wide mf2-JSON export
- `GET /feed.xml` and `GET /atom`: site-wide Atom aliases
- `GET /feed.json` and `GET /jsonfeed`: site-wide JSON Feed aliases
- `GET /export/json` and `GET /export.json`: mf2-JSON export and compatibility alias
- `GET /api/categories/:slug/feeds/atom`: category Atom feed
- `GET /api/categories/:slug/feeds/json`: category JSON Feed
- `GET /categories/:slug/feed.xml` and `GET /categories/:slug/atom`: category Atom aliases
- `GET /categories/:slug/feed.json` and `GET /categories/:slug/jsonfeed`: category JSON Feed aliases
- `GET /api/p/:slug/feeds/atom`: single-page Atom feed
- `GET /api/p/:slug/feeds/json`: single-page JSON Feed
- `GET /p/:slug/feed.xml` and `GET /p/:slug/atom`: page Atom aliases
- `GET /p/:slug/feed.json` and `GET /p/:slug/jsonfeed`: page JSON Feed aliases
- `GET /api/feeds?page=<slug>`: appends per-page feeds to the feed catalog when the page is published

These routes are part of the stable public surface and should not be broken casually.

## Tech Stack

- npm workspaces
- TypeScript
- React 19 + Vite (Tailwind CSS)
- Express 5
- Auth.js (GitHub and Google OAuth, database-backed sessions)
- Drizzle ORM
- MySQL via `mysql2`
- Zod plus generated API schemas (Orval)
- esbuild (API server bundler)

## Repository Layout

```text
artifacts/
  api-server/        Express API and Auth.js runtime
  microblog/         React frontend
lib/
  db/                Shared schema, db client, and runtime bootstrap
  api-spec/          OpenAPI source
  api-client-react/  Generated React Query client
  api-zod/           Generated Zod request/response schemas
scripts/             Maintenance and developer scripts
docs/                Setup, dependency, and operational notes
```

## Local Development

### Default Single-Port Mode

Use this for the normal local app flow:

```bash
npm run dev
```

This builds the frontend and serves the app, API, and auth routes from one origin:

- app, API, and auth: `http://localhost:4000` by default (configured via `PORT` in `.env`)

### Optional Hot-Reload Split Mode

Use this when you specifically want Vite hot reload:

```bash
npm run dev:hot
```

In hot mode:

- frontend: `http://localhost:3000`
- backend/API/Auth: `http://localhost:4000` (or the value of `PORT`)

The Vite dev server proxies `/api/*` and feed endpoints back to the API server.

## Common Commands

```bash
npm run dev
npm run dev:hot
npm run build
npm run typecheck
npm run start
npm run contracts:sync
```

Useful workspace-specific commands:

```bash
npm run list-users --workspace=@workspace/scripts
npm run promote-owner --workspace=@workspace/scripts -- --email you@example.com
npm run import-sqlite-to-mysql --workspace=@workspace/scripts
```

## Environment Variables

Core setup is documented in [docs/auth-setup.md](docs/auth-setup.md). The main active variables are:

- `PORT`
- `FRONTEND_PORT`
- `API_ORIGIN`
- `ALLOWED_ORIGINS`
- `AUTH_SECRET`
- `SESSION_SECRET`
- `OWNER_EMAILS`
- `GITHUB_ID`
- `GITHUB_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASS`
- `DB_SSL`
- `SQLITE_IMPORT_PATH`
- `AI_SETTINGS_ENCRYPTION_KEY`
- `CRON_SECRET`
- `PUBLIC_SITE_URL`
- `SITE_TITLE`
- `SITE_DESCRIPTION`
- `SITE_AUTHOR_NAME`
- `WORDPRESS_COM_CLIENT_ID`
- `WORDPRESS_COM_CLIENT_SECRET`
- `BLOGGER_GOOGLE_CLIENT_ID`
- `BLOGGER_GOOGLE_CLIENT_SECRET`
- `LOG_LEVEL`

`MEDIUM_CLIENT_ID` and `MEDIUM_CLIENT_SECRET` are not used — Medium syndication uses a personal self-integration token stored encrypted in the database, not environment-variable OAuth credentials.

## Authentication

- Auth.js is mounted at `/api/auth`
- GitHub and Google are the current sign-in providers
- Sessions are database-backed
- Authorization remains local to the app
- `OWNER_EMAILS` is a comma-separated allowlist for first-owner auto-claim: when no owner exists and an incoming sign-in matches, that account is promoted automatically and redirected to `/admin/setup`

Typical local callback URLs (default `PORT=4000`):

- GitHub: `http://localhost:4000/api/auth/callback/github`
- Google: `http://localhost:4000/api/auth/callback/google`

Do not set `AUTH_URL` or `NEXTAUTH_URL` in `.env`; the app derives the origin dynamically.

## Database

MySQL is the canonical datastore for both deployed publishing and local authoring. SQLite is legacy import material only.

The active schema includes:

- auth and identity: `users`, `accounts`, `sessions`, `verification_tokens`
- publishing and interaction: `posts`, `comments`, `reactions`
- member profile photos: `profile_photo_assets`
- feed ingestion: `feed_sources`, `feed_items_seen`
- structure and discovery: `categories`, `post_categories`, `pages`, `nav_links`, `site_settings`
- syndication: `platform_connections`, `platform_oauth_apps`, `post_syndications`
- owner AI settings: `user_ai_vendor_settings`
- media library: `media_assets`, `media_asset_exhibits`
- interactive pieces: `art_pieces`, `art_piece_versions`
- exhibits: `exhibits`, `piece_exhibits`
- site identity: `site_assets`, `site_bootstrap_state`

Important current-schema notes:

- `posts.content_text` is required for public search (FULLTEXT index)
- `posts.status` supports `published`, `pending`, `draft`, `scheduled`
- `posts.source_*` fields support feed-import moderation
- `posts.author_image_url` is a denormalized avatar column; human profile photo and feed-source photo changes cascade to post rows, and startup reconciliation backfills from `users.image` and `feed_sources.image_url`
- `users.username`, `bio`, `website`, `social_links`, and theme fields are active application fields
- `site_settings` seeds a singleton row on first use
- `site_bootstrap_state` tracks first-owner auto-claim and `/admin/setup` completion
- `feed_sources.author_name` is an optional attribution override with priority `source.authorName > item.originalAuthor > source.name`
- `posts.scheduled_at` supports deferred publish; `posts.pending_platform_ids` is a JSON array of platform connection IDs to syndicate at publish time
- Member profile photos are stored in `profile_photo_assets` (served from `/api/profile-photos/:fileName`) and do not appear in the Image Library; owner and feed-source profile photos use `media_assets`

The runtime bootstrap logic lives in [lib/db/src/migrate.ts](lib/db/src/migrate.ts).

## Fresh Database Bootstrap

For a fresh database:

1. Set `OWNER_EMAILS` in `.env` to the owner's email address.
2. Start the app:

```bash
npm install
npm run build
npm run dev
```

3. Sign in with the allowed email. The app promotes that account automatically and redirects to `/admin/setup`.
4. Complete setup (display name, username, site title, hero copy, about body).
5. Choose **Complete setup and go live** to lift the public setup gate.

Legacy recovery path (if auto-claim is unavailable):

```bash
npm run list-users --workspace=@workspace/scripts
npm run promote-owner --workspace=@workspace/scripts -- --email you@example.com
```

## Feature Areas

### Posts

- plain-text and rich-HTML post support
- local media uploads via the Image Library
- owner-trusted `https:` iframe embeds
- dynamic OG image generation at `GET /api/og/posts/:id`
- public search backed by `content_text`
- category assignment
- embed route for posts at `/embed/posts/:id`
- `GET /api/posts` accepts `?category=<slug|uncategorized|all>` and `?source=<original|feedId|all>` for server-side timeline filtering
- imported posts display attribution as `by <individual> via <blog>` when both values are present
- draft, scheduled, and pending post statuses; post scheduler runs every 60 s to auto-publish due scheduled posts

### Interactive Pieces And Exhibits

- owner-managed reusable interactive pieces using `p5`, `c2`, or `three` engines
- AI-assisted generation with server-side preflight validation
- embed route at `/embed/pieces/:id` (resolves current version live)
- managed from `/admin/pieces`; stored in `art_pieces` / `art_piece_versions`
- exhibits are named owner-managed collections of pieces and images
- each exhibit renders as a multi-frame Three.js museum wall at `/immersive/exhibits/:slug`
- managed from `/admin/exhibits`; stored in `exhibits`, `piece_exhibits`, `media_asset_exhibits`

### Immersive Viewer

- local images, saved pieces, and exhibits expose a lower-right immersive affordance
- dedicated routes: `/immersive/images/:encodedRef`, `/immersive/pieces/:id`, `/immersive/exhibits/:slug`
- all three share the same fullscreen expand/contract interaction model
- immersive routes are additive — existing post, page, and embed URLs are unchanged

### Media Library

- owner-managed Image Library backed by `media_assets`
- direct file uploads and URL imports (capped at 8 MB, magic-byte validated)
- used for post images, featured images, feed-source profile photos, and exhibit items
- served from `/api/media/:fileName`
- member profile-only photos are separate: stored in `profile_photo_assets`, served from `/api/profile-photos/:fileName`

### Recycle Bin

- soft-delete for posts, pieces, media assets, exhibits, pages, and categories
- owner can restore or permanently delete items from `/admin/recycle-bin`
- API: `GET /recycle-bin`, `POST /recycle-bin/:type/:id/restore`, `DELETE /recycle-bin/:type/:id`

### Pages And Navigation

- owner-managed pages at `/p/:slug`
- automatic page-backed nav items
- system nav items for built-in site routes
- reorderable navigation in the admin UI

### Categories

- owner-managed categories
- category detail pages
- category-scoped feed discovery

### Feed Ingestion (PESOS)

- owner-managed RSS/Atom sources
- per-source optional `authorName` override
- cadence scheduling for future refresh windows
- dedup ledger in `feed_items_seen`
- refresh authorization via owner session or `X-Cron-Secret`
- imported posts enter a pending review flow before publication
- bulk approval from the admin feeds UI
- feed-source profile photos cascade to imported post avatars

### Outbound Syndication (POSSE)

- owner-managed platform setup at `/admin/platforms`
- encrypted-at-rest OAuth app credentials for WordPress.com and Blogger, stored in the database unless env vars are supplied
- **supported connection types:**
  - WordPress.com (OAuth)
  - self-hosted WordPress (application password)
  - Blogger (Google OAuth with Blogger scope)
  - Medium (personal self-integration token; no env-var OAuth required)
  - Substack (session cookie auth; unofficial API)
  - Bluesky (AT Protocol; App Password, no developer account required)
  - LinkedIn (OAuth 2.0, `w_member_social` scope)
  - Meta / Facebook Page + Instagram Business/Creator (Meta Developer App, App Review required for production)
- post composer support for selecting enabled syndication targets at publish time
- async syndication history persisted per post/connection pair in `post_syndications`
- all article-style targets append a visible source line: `Original source at {Site Title}: {Canonical URL}`

### Site Settings And Profiles

- owner-managed site title, hero copy, CTA, palette, and nav branding
- owner social links surfaced through site settings responses
- per-user profile customization, theming, and profile photo uploads
- display name changes via `PATCH /api/users/me` automatically sync to all posts authored by that user
- `PUBLIC_SITE_URL` pins the canonical origin used in syndication source lines and social metadata

### AI Assistance

- owner-only AI settings at `GET/PATCH /api/users/me/ai-settings` (admin UI: `/admin/ai`)
- supported vendors: OpenCode Zen, OpenCode Go, Google Gemini, OpenRouter, Mistral AI, Mistral Vibe, DeepSeek
- per-vendor enabled/model/api-key configuration; API keys encrypted before storage
- text processing endpoint at `POST /api/ai/process`
- interactive piece generation at `POST /api/art-pieces/generate` (restricted to OpenCode Zen, OpenCode Go, Google, Mistral AI, Mistral Vibe, DeepSeek)
- image alt-text generation uses a separate capability allowlist (excludes DeepSeek until official image-input support is live)

### Bootstrap And Setup Gate

- first-owner auto-claim via `OWNER_EMAILS` env var; triggers `/admin/setup` redirect
- setup gate hides the public site until the owner completes the onboarding wizard
- tracked in `site_bootstrap_state`; existing populated databases bypass the gate automatically

## Related Docs

- [docs/auth-setup.md](docs/auth-setup.md)
- [docs/dependencies.md](docs/dependencies.md)
- [docs/ai-vendor-verification.md](docs/ai-vendor-verification.md)
- [docs/db-cleanup-report.md](docs/db-cleanup-report.md)
