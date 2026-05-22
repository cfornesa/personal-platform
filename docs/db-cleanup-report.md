# Database Cleanup Report

This file is now historical only.

## Current Status

Do not use the old cleanup guidance in this document against the current shipped app.

As of `2026-05-05`, the live app and the deployed Replit runtime expect the following tables to exist:

- `users`, `accounts`, `sessions`, `verification_tokens`
- `user_ai_vendor_settings`
- `posts`, `comments`, `reactions`
- `feed_sources`, `feed_items_seen`
- `categories`, `post_categories`
- `pages`, `nav_links`, `site_settings`

They also expect the richer `users` and `posts` column sets that support:

- per-user theme customization
- owner AI vendor settings
- inbound feed ingestion and pending moderation
- public search backed by `posts.content_text`
- site settings, categories, pages, and nav management

## Why This Was Superseded

An earlier branch of project history produced cleanup guidance that treated several now-live tables and columns as dead code. That guidance is no longer safe for the current product surface and no longer reflects the deployed Replit app.

## Current Schema Truth

For current operations, use these sources instead:

- [lib/db/src/migrate.ts](/Users/Fornesus/Code/fornesus-platform/lib/db/src/migrate.ts:100)
- [lib/db/install.sql](/Users/Fornesus/Code/fornesus-platform/lib/db/install.sql:1)
- [README.md](/Users/Fornesus/Code/fornesus-platform/README.md:1)
- [replit.md](/Users/Fornesus/Code/fornesus-platform/replit.md:1)

If you need to reconcile a database, reconcile it forward to the current shipped schema rather than trimming it back to the older reduced schema described in the superseded report.
