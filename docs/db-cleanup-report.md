# Database Cleanup Report

This file is now historical only.

## Current Status

Do not use the old cleanup guidance in this document against the current shipped app.

As of `2026-05-30`, the live app and the deployed runtime expect the following tables to exist:

- `users`, `accounts`, `sessions`, `verification_tokens`
- `user_ai_vendor_settings`
- `posts`, `comments`, `reactions`, `profile_photo_assets`
- `feed_sources`, `feed_items_seen`
- `categories`, `post_categories`
- `pages`, `nav_links`, `site_settings`
- `media_assets`, `media_asset_exhibits`, `site_assets`
- `art_pieces`, `art_piece_versions`, `exhibits`, `piece_exhibits`
- `site_bootstrap_state`

They also expect the richer `users` and `posts` column sets that support:

- per-user theme customization
- owner AI vendor settings
- inbound feed ingestion and pending moderation
- public search backed by `posts.content_text`
- database-backed member profile photos
- Image Library-backed owner and feed-source profile photos
- avatar backfills from `users.image` and `feed_sources.image_url` into `posts.author_image_url`
- site settings, categories, pages, and nav management
- DB-backed seeded site identity assets and first-owner bootstrap state

## Why This Was Superseded

An earlier branch of project history produced cleanup guidance that treated several now-live tables and columns as dead code. That guidance is no longer safe for the current product surface and no longer reflects the deployed Replit app.

## Current Schema Truth

For current operations, use these sources instead:

- [lib/db/src/migrate.ts](../lib/db/src/migrate.ts)
- [lib/db/install.sql](../lib/db/install.sql)
- [README.md](../README.md)
- [replit.md](../replit.md)

If you need to reconcile a database, reconcile it forward to the current shipped schema rather than trimming it back to the older reduced schema described in the superseded report.
