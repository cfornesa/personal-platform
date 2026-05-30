# Codebase State Audit

Date: 2026-05-30

Purpose: capture the current codebase state after several implementation commits landed without matching markdown records. Future documentation edits should treat this file as the evidence ledger, then update the public-facing docs from here.

## Scope

This audit covers recent committed changes through `146a235` on `main` plus the current uncommitted immersive-route working tree changes observed during this pass.

It is documentation-only. No runtime code, schema, route, or URL decision was changed by this audit.

## Primary Evidence

Recent feature commits reviewed:

- `8fa9575` - MySQL schema support for interactive art pieces and POSSE syndication.
- `348873a` - social post drafts, featured images across platforms, and expanded syndication adapters.
- `5a542c8` - media library management and expanded AI settings.
- `052f49a` - immersive image and immersive piece routes.
- `bb9d0fb` - Mistral AI and Mistral Vibe vendors.
- `0438332` - DeepSeek vendor.
- `a966fb6` - immersive piece, embed, metadata, and canonical origin handling.
- `9084660` - fallback origin update and OrbitControls interaction handling.
- `c4b7b86` - exhibit API endpoints, database schema, and frontend management.
- `56ac118` - exhibit library dialog and post embed support.
- `686df8a` - immersive exhibit and thumbnail management refinements.

Current uncommitted files reviewed:

- `artifacts/microblog/src/components/immersive/ImmersiveRouteShell.tsx`
- `artifacts/microblog/src/components/immersive/__tests__/ImmersiveRouteShell.test.tsx`
- `artifacts/microblog/src/lib/immersive-gallery.ts`
- `artifacts/microblog/src/pages/immersive-exhibit-wall.tsx`
- `artifacts/microblog/src/pages/immersive-image.tsx`
- `artifacts/microblog/src/pages/immersive-piece.tsx`

## Current Product Surface

The project is no longer only a microblog with feeds and comments. The current app surface includes:

- owner-only canonical publishing with signed-in member comments
- rich post editing with sanitized HTML, uploaded media, YouTube, generic iframe embeds, art piece embeds, and exhibit embeds
- local media library with direct uploads, URL imports, featured-image selection, and media-to-exhibit assignment
- owner-managed interactive art pieces using `p5`, `c2`, or `three`
- immersive routes for images, art pieces, and exhibits
- exhibit management with mixed image and piece walls
- feed import moderation and server-side timeline filters
- public feed/export routes under `/api/feeds/*` plus backward-compatible aliases
- POSSE syndication across article-style and social targets
- owner-only AI assistance for rewriting, alt text where supported, and interactive piece generation
- CMS-style pages, categories, navigation, site settings, user profiles, search, and theming

## Runtime Routes

Frontend routes registered in `artifacts/microblog/src/App.tsx` now include:

- `/embed/pieces/:id`
- `/immersive/images/:encodedRef`
- `/immersive/pieces/:id`
- `/immersive/exhibits/:slug`
- `/admin/ai`
- `/admin/pieces`
- `/admin/library`
- `/admin/platforms`
- `/admin/exhibits`

API routers registered in `artifacts/api-server/src/routes/index.ts` include:

- posts, pending posts, comments, users, categories, pages, navigation, site settings
- media
- AI
- art pieces
- exhibits
- feed sources and public feed catalog
- platform connections, platform OAuth, and platform OAuth app settings

## Database State

The current schema exports include:

- auth and identity: `users`, `accounts`, `sessions`, `verification_tokens`
- publishing and interaction: `posts`, `comments`, `reactions`
- structure and discovery: `site_settings`, `categories`, `post_categories`, `nav_links`, `pages`
- feed ingestion: `feed_sources`, `feed_items_seen`
- AI settings: `user_ai_vendor_settings`
- POSSE: `platform_connections`, `platform_oauth_apps`, `post_syndications`
- interactive art: `art_pieces`, `art_piece_versions`
- media: `media_assets`
- exhibits: `exhibits`, `piece_exhibits`, `media_asset_exhibits`

`lib/db/src/migrate.ts` also includes compatibility logic to rename older `galleries`, `piece_galleries`, and `media_asset_galleries` tables to the exhibit naming.

## Canonical Origin Behavior

`artifacts/api-server/src/lib/origin.ts` currently resolves canonical origin in this order:

1. first origin from `ALLOWED_ORIGINS`
2. `PUBLIC_SITE_URL`
3. incoming request protocol/host, honoring forwarded headers
4. fallback `https://chrisfornesa.com`

Documentation that says feed URLs intentionally avoid `PUBLIC_SITE_URL` is stale. Documentation that says `PUBLIC_SITE_URL` is the only or first canonical origin is also incomplete. Future docs should describe `ALLOWED_ORIGINS` as the primary operator-selected public origin, with `PUBLIC_SITE_URL` retained as the next fallback.

The comment in `origin.ts` still says the final fallback is `platform.creatrweb.com`, but the actual code returns `https://chrisfornesa.com`. That comment should be corrected in a later code cleanup pass.

## Public Feed And Export Guarantees

The stable public feed/export surface remains:

- `GET /api/feeds/atom`
- `GET /api/feeds/json`
- `GET /api/feeds/mf2`
- `GET /feed.xml`
- `GET /feed.json`
- `GET /export/json`
- `GET /export.json`

Per AGENTS.md, `GET /export.json`, `GET /feed.xml`, and `GET /feed.json` must remain functional. The `/api/feeds/*` routes are the primary Replit-compatible feed paths.

## POSSE And Platform State

The confirmed platform connection enum in schema comments is:

- `wordpress_com`
- `wordpress_self`
- `medium`
- `blogger`
- `substack`
- `bluesky`
- `linkedin`
- `facebook`
- `instagram`

Adapters exist under `artifacts/api-server/src/lib/syndication/` for all of the above.

Current connection flows:

- WordPress.com: OAuth using saved app credentials or env fallback.
- Blogger: Google OAuth using saved app credentials or env fallback.
- LinkedIn: OAuth using saved app credentials or env fallback.
- Facebook and Instagram: shared Meta OAuth flow; creates Facebook connection and, when available, Instagram connection.
- Bluesky: app-password based direct connect endpoint.
- WordPress self-hosted, Medium, and Substack: credential-based connection handling through platform connections.

`docs/dependencies.md` already contains entries for the expanded platform dependencies. Later docs should make sure README and setup docs list the same supported platforms and callback requirements.

## AI Vendor State

Current AI settings support includes:

- OpenCode Zen
- OpenCode Go
- Google Gemini
- OpenRouter
- Mistral AI
- Mistral Vibe
- DeepSeek

DeepSeek is supported for text rewriting and validated interactive piece generation, but not image alt-text generation. The code and `docs/ai-vendor-verification.md` both reflect that limitation.

Mistral AI and Mistral Vibe use Mistral-compatible chat completions with distinct vendor IDs. `docs/dependencies.md` and `docs/ai-vendor-verification.md` already contain vendor-specific notes.

## Media Library State

The media library now stores uploaded and owner-imported assets in `media_assets`.

Observed capabilities:

- direct image uploads
- URL import with local storage
- file signature validation
- 8 MB upload/import cap
- featured-image selection
- alt text/title metadata
- media assignment to exhibits through `media_asset_exhibits`
- immersive image opening from post cards, post content, media grid, and featured-image picker

Future README updates should distinguish local media storage from post HTML embeds and from remote third-party syndication payloads.

## Interactive Pieces And Immersive Routes

Interactive pieces are saved in `art_pieces` and `art_piece_versions`. Saved pieces can be embedded with `/embed/pieces/:id` and opened in immersive mode through `/immersive/pieces/:id`.

The current immersive implementation includes:

- normalized presentation surfaces for non-Three pieces
- live Three.js immersive rendering for compatible Three pieces
- generated embed HTML helpers
- runtime preflight for AI-generated pieces
- thumbnail generation/persistence for current piece versions
- immersive expand controls added around images and embedded pieces in rendered posts

Current uncommitted changes add or refine:

- document scroll, overscroll, and touch-action locking while in embed or fullscreen immersive modes
- native fullscreen requests for first-party immersive routes where available
- visual viewport CSS vars for fullscreen sizing
- resize handling that preserves camera position instead of resetting camera framing on every resize
- tests for immersive fullscreen behavior and viewport handling

## Exhibits State

Exhibits are mixed collections of interactive pieces and media assets.

Database tables:

- `exhibits`
- `piece_exhibits`
- `media_asset_exhibits`

Important exhibit fields:

- `slug`
- `name`
- `description`
- `artist_statement`
- `biography`
- `rows`
- `cols`

API behavior:

- public exhibit list with image and piece counts
- owner-only create/update/delete
- public single-exhibit lookup by slug
- public exhibit wall payload at `/api/exhibits/:slug/items`
- owner-only replacement of piece and media exhibit memberships

Frontend behavior:

- admin exhibit management at `/admin/exhibits`
- art piece exhibit assignment
- media asset exhibit assignment
- immersive exhibit wall at `/immersive/exhibits/:slug`
- static embed form for posts using `/immersive/exhibits/:slug?embed=1&static=1`
- post content normalization that rewrites exhibit iframe origins to the canonical current origin

URL caution: exhibit slugs produce public URLs. Future slug or route changes are irreversible decisions and require explicit sign-off.

## Documentation Drift Found

Known stale or incomplete markdown:

- `replit.md` says `PUBLIC_SITE_URL` is intentionally not used for feed URLs. Current origin code does use it after `ALLOWED_ORIGINS`.
- `README.md` does not fully describe exhibits, immersive routes, `media_assets`, or the expanded POSSE platform set.
- `README.md` says outbound syndication covers WordPress.com, self-hosted WordPress, and Blogger, but current code also supports Medium, Substack, Bluesky, LinkedIn, Facebook, and Instagram.
- `README.md` schema summary is missing `art_pieces`, `art_piece_versions`, `media_assets`, `exhibits`, `piece_exhibits`, and `media_asset_exhibits`.
- `docs/auth-setup.md` platform callback section only mentions WordPress.com and Blogger. It should add LinkedIn and Meta/Facebook callback expectations.
- `MEMORY.md` contains current high-level state through 2026-05-15, but lacks explicit entries for media library expansion, Mistral/DeepSeek, immersive image/piece routes, exhibits, and expanded social POSSE targets.
- `DECISIONS.md` lacks a recent dated record for the exhibit/immersive work and the expanded POSSE/AI/media work.

## Later Documentation Update Plan

Recommended order for follow-up documentation edits:

1. Update `DECISIONS.md` with dated entries for media library, AI vendors, immersive routes, exhibits, canonical origin behavior, and expanded POSSE targets.
2. Propose `MEMORY.md` entries for the same stable facts and wait for confirmation before writing them.
3. Update `README.md` product surface, route list, schema list, and feature sections from this audit.
4. Update `replit.md` canonical origin and product sections.
5. Update `docs/auth-setup.md` platform callback sections for LinkedIn and Meta/Facebook/Instagram.
6. Re-check `docs/dependencies.md` against platform and AI adapter code; it is mostly current but should be kept aligned with setup docs.
7. Run typecheck and targeted route/feed tests before treating the refreshed docs as release-ready.

## Verification Performed

This audit used local repository inspection only:

- `git log --oneline`
- `git show --stat`
- `git diff`
- `rg`
- direct reads of route, schema, dependency, and markdown files

No build, typecheck, or runtime smoke test was run during this documentation audit.
