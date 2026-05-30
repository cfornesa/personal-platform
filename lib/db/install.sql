-- ============================================================================
--  Microblog — full database install script (SQL schema for forkers)
--
--  WHO THIS IS FOR
--  ---------------
--  You forked this repo and want to host your own Microblog. Run this script
--  ONCE on a fresh, empty MySQL 8.0+ or MariaDB 10.5+ database to create
--  every table the app expects.
--
--  YOU DO NOT NEED THIS SCRIPT IF…
--  -------------------------------
--  …you are running on Replit, or anywhere else that boots `npm run dev:api`.
--  In those environments the same tables are created automatically by
--  `ensureTables()` in `lib/db/src/migrate.ts` the first time the API server
--  starts. This script is for shared hosts (e.g. Hostinger) where the only
--  tool you have is phpMyAdmin and you cannot run Node migrations directly.
--
--  HOW TO IMPORT IN phpMyAdmin
--  ---------------------------
--  1. Log in to phpMyAdmin and select your empty database in the left sidebar
--     (the database name itself, NOT the server root).
--  2. Click the "Import" tab in the top menu.
--  3. Under "File to import", click "Choose file" and pick THIS file
--     (`install.sql`).
--  4. Leave the format set to "SQL" and the character set to "utf-8".
--  5. Scroll to the bottom and click "Go". You should see a green
--     "Import has been successfully finished" banner.
--  6. Click the database name again — you should now see all 13 tables
--     listed: `users`, `accounts`, `sessions`, `verification_tokens`,
--     `feed_sources`, `feed_items_seen`, `posts`, `comments`, `reactions`,
--     `categories`, `post_categories`, `nav_links`, `site_settings`. The `site_settings`
--     table will already contain one row (id = 1) with the placeholder copy
--     seeded below.
--
--  PLACEHOLDER CONVENTION
--  ----------------------
--  Anywhere you see `<<SOMETHING_LIKE_THIS>>` (double angle brackets, ALL
--  CAPS) you should replace it with your own value BEFORE running the
--  script. The placeholders are deliberately ugly so they fail loudly
--  if you forget to substitute one. Suggested workflow: open this file
--  in a text editor, do a Find-and-Replace for each placeholder, save,
--  then upload to phpMyAdmin.
--
--  RE-RUNNING IS SAFE
--  ------------------
--  Every CREATE TABLE uses `IF NOT EXISTS` and the seed `INSERT IGNORE`s
--  on conflict, so re-running this script will NEVER drop or modify
--  existing rows. If you want to start fresh, drop the tables manually
--  in phpMyAdmin first.
--
--  TABLE ORDER MATTERS
--  -------------------
--  Foreign keys mean tables must be created in the right order:
--    1. users                                       (no FKs)
--    2. accounts, sessions, verification_tokens     (Auth.js — depend on users)
--    3. feed_sources, feed_items_seen               (PESOS feed subscriptions)
--    4. posts                                       (depends on users + feed_sources)
--    5. comments, reactions                         (depend on posts + users)
--    6. categories, post_categories                 (taxonomy; join depends on posts)
--    7. site_settings                               (singleton, no FKs)
--
--  AFTER THE IMPORT — THREE THINGS TO DO
--  -------------------------------------
--  (A) Pick the username you want for the site owner — e.g. `chris` for
--      someone whose handle is "chris". Pick something short, lowercase,
--      and ASCII-only — it shows up in URLs and bylines, and the URL of
--      your profile page will be `/users/@<your-handle>`.
--
--      The chosen handle must appear in TWO PLACES that match exactly,
--      using the same literal string in both:
--
--        1. `site_settings.cta_href` — the seed at the bottom of THIS
--           file links the hero CTA at `/users/@<<YOUR_USERNAME>>`.
--           Substitute the placeholder BEFORE you import (Find-and-
--           Replace `<<YOUR_USERNAME>>` in this file), or accept the
--           placeholder for now and edit `cta_href` in the /settings UI
--           after you complete step (C) below — the /settings page is
--           owner-gated, so signing in alone is NOT enough; your row
--           in `users` must also have `role = 'owner'`.
--
--        2. `users.username` — the column on your own user row. Set it
--           with the maintenance query labeled #1 at the bottom of this
--           file, AFTER you complete step (C) and your row exists in
--           `users`:
--
--             UPDATE `users` SET `username` = '<<YOUR_USERNAME>>'
--               WHERE `email` = '<<YOUR_EMAIL>>';
--
--      Both values MUST be the same literal string (e.g. both `chris`)
--      or the hero CTA button on the home page will link to a 404.
--      Until the step-(C)-and-then-#1 sequence runs, no user row carries
--      that username yet, so the hero CTA link is **expected to 404 on a
--      freshly-imported install** — that resolves itself the moment you
--      run maintenance query #1.
--
--      You only do this once. The frontend's /settings page can edit
--      `cta_href` later if you change your mind, and you can change
--      `username` with another `UPDATE users SET username = …`.
--
--  (B) Configure OAuth in your `.env` (or your host's secrets panel).
--      You need at minimum a GitHub OR Google OAuth app — see
--      `docs/auth-setup.md` and the env-var table in `replit.md`.
--
--  (C) Sign in once via OAuth at `https://<your-domain>/auth/signin`.
--      That creates your row in the `users` table. Then promote yourself
--      to the owner role (the role that unlocks /settings, /admin/feeds,
--      and /admin/pending) with one of:
--
--        UPDATE `users` SET `role` = 'owner'
--          WHERE `email` = '<<YOUR_EMAIL>>';
--
--      …or, if you have shell access to the repo:
--
--        npm run promote-owner --workspace=@workspace/scripts -- \
--          --email <<YOUR_EMAIL>>
-- ============================================================================

SET NAMES utf8mb4;

-- ----------------------------------------------------------------------------
--   Task #25 additions for forkers upgrading from a Task #24 install.
--   ----------------------------------------------------------------
--   This file is the canonical, fresh-install script: the CREATE TABLE
--   statements below already include the new `pages` table and the
--   extended `nav_links` columns (kind / page_id / visible). If you are
--   importing this file into a brand-new database you can ignore the
--   following note. If instead you imported a previous version of this
--   file before Task #25 landed, run the four ALTER / INSERT statements
--   in the section labeled "[Task #25] forker upgrade path" at the
--   bottom of this file once — those statements are idempotent and
--   wrapped in IF-NOT-EXISTS-style probes via INFORMATION_SCHEMA so
--   re-running them is harmless.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1. `users` — local accounts.
--    Combines (a) the Auth.js-required columns (id, name, email,
--    email_verified, image), (b) app-owned profile fields (username, bio,
--    website, social_links, role, status, post_count), and (c) optional
--    per-user profile-page theming (theme + palette + 14 color overrides,
--    all NULL by default which means "fall back to the site default").
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id`               VARCHAR(191) NOT NULL PRIMARY KEY,            -- UUID generated by the app at signup
  `name`             VARCHAR(255),                                  -- display name from the OAuth provider
  `username`         VARCHAR(255),                                  -- chosen handle; URL is /users/@<username>
  `email`            VARCHAR(191),                                  -- from OAuth provider; unique
  `email_verified`   TIMESTAMP(3) NULL DEFAULT NULL,                -- set by Auth.js when email is verified
  `image`            VARCHAR(2048),                                 -- avatar URL from the OAuth provider
  `bio`              TEXT,                                          -- short profile description
  `website`          VARCHAR(2048),                                 -- personal site URL
  `social_links`     JSON,                                          -- {"twitter":"@…","mastodon":"…",…}
  `role`             VARCHAR(32) NOT NULL DEFAULT 'member',         -- 'owner' | 'member'
  `status`           VARCHAR(32) NOT NULL DEFAULT 'active',         -- 'active' | 'blocked'
  `created_at`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_login_at`    DATETIME(3),                                   -- updated on every successful sign-in
  `post_count`       INT NOT NULL DEFAULT 0,                        -- denormalized for /users/@handle pages

  -- ---- Per-user profile-page theme. NULL == use site-wide default. ----
  `theme`                        VARCHAR(32),                       -- e.g. 'bauhaus', 'minimalist', …
  `palette`                      VARCHAR(32),                       -- e.g. 'bauhaus', 'ocean', …
  `color_background`             VARCHAR(64),                       -- HSL components, e.g. '0 0% 100%'
  `color_foreground`             VARCHAR(64),
  `color_background_dark`        VARCHAR(64),
  `color_foreground_dark`        VARCHAR(64),
  `color_primary`                VARCHAR(64),
  `color_primary_foreground`     VARCHAR(64),
  `color_secondary`              VARCHAR(64),
  `color_secondary_foreground`   VARCHAR(64),
  `color_accent`                 VARCHAR(64),
  `color_accent_foreground`      VARCHAR(64),
  `color_muted`                  VARCHAR(64),
  `color_muted_foreground`       VARCHAR(64),
  `color_destructive`            VARCHAR(64),
  `color_destructive_foreground` VARCHAR(64),
  `preferred_art_piece_vendor`   VARCHAR(64),
  `preferred_vendor_text_improve` VARCHAR(64),
  `preferred_vendor_alt_text`    VARCHAR(64),

  UNIQUE KEY `users_email_unique`    (`email`),                     -- one account per OAuth email
  UNIQUE KEY `users_username_unique` (`username`)                   -- one /users/@<handle> per username
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2. Owner AI settings. One row per supported vendor so the owner can
--    keep credentials on file for multiple AI gateways at once.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_ai_vendor_settings` (
  `user_id`            VARCHAR(191) NOT NULL,                       -- FK -> users.id
  `vendor`             VARCHAR(64) NOT NULL,                        -- stable backend slug, e.g. 'opencode-zen'
  `enabled`            INT NOT NULL DEFAULT 0,                      -- 0 = off, 1 = on for this vendor
  `model`              VARCHAR(191),                                -- user-supplied vendor model slug
  `encrypted_api_key`  TEXT,                                        -- encrypted at rest with AI_SETTINGS_ENCRYPTION_KEY
  `created_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`, `vendor`),
  CONSTRAINT `user_ai_vendor_settings_user_id_fk`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3. Reusable interactive art pieces. The supported engine contract is
--    `p5` | `c2` | `three`, and saved embeds render through the app-owned
--    /embed/pieces/:id surface without executing code in the main post DOM.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `art_pieces` (
  `id`                 INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `owner_user_id`      VARCHAR(191) NOT NULL,                      -- FK -> users.id
  `title`              VARCHAR(255) NOT NULL,                      -- owner-facing library title
  `prompt`             TEXT NOT NULL,                              -- canonical generation prompt
  `engine`             VARCHAR(16) NOT NULL DEFAULT 'p5',         -- confirmed enum: 'p5' | 'c2' | 'three'
  `status`             VARCHAR(16) NOT NULL DEFAULT 'active',     -- 'active' | 'archived'
  `current_version_id` INT,                                        -- points at art_piece_versions.id (soft link)
  `thumbnail_url`      VARCHAR(2048),                              -- reserved for future preview snapshots
  `created_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `art_pieces_owner_idx`  (`owner_user_id`),
  KEY `art_pieces_status_idx` (`status`),
  CONSTRAINT `art_pieces_owner_user_id_fk`
    FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `art_piece_versions` (
  `id`                INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `art_piece_id`      INT NOT NULL,                                -- FK -> art_pieces.id
  `prompt`            TEXT NOT NULL,                               -- prompt used for this specific version
  `structured_spec`   TEXT,                                        -- optional normalized structured sketch spec as JSON
  `generated_code`    TEXT NOT NULL,                               -- validated p5 sketch function source
  `engine`            VARCHAR(16) NOT NULL DEFAULT 'p5',          -- confirmed enum: 'p5'
  `generation_vendor` VARCHAR(64),                                 -- AI vendor slug used for generation
  `generation_model`  VARCHAR(191),                                -- vendor model slug used for generation
  `validation_status` VARCHAR(32) NOT NULL DEFAULT 'validated',    -- currently always 'validated'
  `generation_attempt_count` INT NOT NULL DEFAULT 1,               -- model calls consumed to reach this version
  `notes`             TEXT,                                        -- optional AI rationale / summary
  `created_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `art_piece_versions_art_piece_idx` (`art_piece_id`),
  CONSTRAINT `art_piece_versions_art_piece_id_fk`
    FOREIGN KEY (`art_piece_id`) REFERENCES `art_pieces` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 4. Auth.js tables: `accounts`, `sessions`, `verification_tokens`.
--    These three exactly match what `@auth/drizzle-adapter` expects;
--    do NOT rename columns or you will break sign-in.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `accounts` (
  `user_id`              VARCHAR(191) NOT NULL,                     -- FK -> users.id
  `type`                 VARCHAR(64)  NOT NULL,                     -- 'oauth' | 'email' | …
  `provider`             VARCHAR(191) NOT NULL,                     -- 'github' | 'google' | …
  `provider_account_id`  VARCHAR(191) NOT NULL,                     -- the user's id at the OAuth provider
  `refresh_token`        TEXT,                                      -- OAuth refresh token (provider-specific)
  `access_token`         TEXT,                                      -- OAuth access token
  `expires_at`           INT,                                       -- unix seconds, when access_token expires
  `token_type`           VARCHAR(64),
  `scope`                TEXT,
  `id_token`             TEXT,                                      -- JWT id_token (OIDC providers)
  `session_state`        VARCHAR(255),
  PRIMARY KEY (`provider`, `provider_account_id`),                  -- one row per OAuth identity
  CONSTRAINT `accounts_user_id_fk`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sessions` (
  `session_token` VARCHAR(191) NOT NULL PRIMARY KEY,                -- random token stored in cookie
  `user_id`       VARCHAR(191) NOT NULL,                            -- FK -> users.id
  `expires`       TIMESTAMP(3) NOT NULL,                            -- when the cookie/session expires
  CONSTRAINT `sessions_user_id_fk`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `verification_tokens` (
  `identifier` VARCHAR(191) NOT NULL,                               -- typically the email being verified
  `token`      VARCHAR(191) NOT NULL,                               -- one-time token sent in the email link
  `expires`    TIMESTAMP(3) NOT NULL,
  PRIMARY KEY (`identifier`, `token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 5. Inbound feeds (PESOS): `feed_sources` (subscriptions) +
--    `feed_items_seen` (per-source dedup ledger). Both empty after install
--    — populate them through the /admin/feeds UI as the owner.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `feed_sources` (
  `id`               INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `name`             VARCHAR(255)  NOT NULL,                        -- display name (e.g. "Jane's Blog")
  `username`         VARCHAR(100),                                  -- optional /users/@<handle> profile URL
  `bio`              TEXT,                                          -- profile description
  `author_name`      VARCHAR(255),                                  -- byline override
  `image_url`        VARCHAR(2048),                                 -- profile photo
  `feed_url`         VARCHAR(2048) NOT NULL,                        -- the actual RSS/Atom URL
  `site_url`         VARCHAR(2048),                                 -- optional homepage of the source
  `cadence`          VARCHAR(16) NOT NULL DEFAULT 'daily',          -- 'daily' | 'weekly' | 'monthly'
  `enabled`          INT NOT NULL DEFAULT 1,                        -- 1 = poll on schedule, 0 = paused
  `last_fetched_at`  DATETIME(3),                                   -- last successful fetch
  `next_fetch_at`    DATETIME(3),                                   -- NULL means "due now"
  `last_status`      VARCHAR(32),                                   -- 'ok' | 'error' | …
  `last_error`       TEXT,                                          -- last error message, if any
  `items_imported`   INT NOT NULL DEFAULT 0,                        -- running counter
  `created_at`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `feed_items_seen` (
  `id`         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `source_id`  INT NOT NULL,                                        -- FK -> feed_sources.id
  `guid_hash`  CHAR(64) NOT NULL,                                   -- lowercase hex SHA-256 of the item GUID
  `seen_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `post_id`    INT,                                                 -- back-pointer to posts.id (soft link)
  UNIQUE KEY `feed_items_seen_source_guid_unique` (`source_id`, `guid_hash`),  -- dedup key
  KEY `feed_items_seen_source_idx` (`source_id`),                   -- "everything from source X" lookup
  CONSTRAINT `feed_items_seen_source_fk`
    FOREIGN KEY (`source_id`) REFERENCES `feed_sources` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 5. `posts` — every post on the site, owner-authored AND feed-imported.
--    The FULLTEXT index on `content_text` powers `/api/posts/search`.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `posts` (
  `id`                    INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `author_id`             VARCHAR(191) NOT NULL,                    -- 'feed:<sourceId>' for imported posts
  `author_user_id`        VARCHAR(191),                             -- FK -> users.id (NULL for imports)
  `author_name`           VARCHAR(255) NOT NULL,                    -- byline shown on the post
  `author_image_url`      VARCHAR(2048),                            -- byline avatar
  `content`               TEXT NOT NULL,                            -- canonical body (HTML or plain text)
  `content_text`          TEXT,                                     -- stripped/plain shadow for FULLTEXT
  `content_format`        VARCHAR(16) NOT NULL DEFAULT 'plain',     -- 'plain' | 'html'
  `status`                VARCHAR(16) NOT NULL DEFAULT 'published', -- 'published' | 'pending' (mod queue)
  `source_feed_id`        INT,                                      -- FK -> feed_sources.id (NULL for owner posts)
  `source_guid`           VARCHAR(1024),                            -- original feed item id (for traceability)
  `source_canonical_url`  VARCHAR(2048),                            -- original article URL
  `created_at`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `posts_status_idx`        (`status`),                         -- speeds the "WHERE status='published'" filter
  KEY `posts_source_feed_idx`   (`source_feed_id`),                 -- "everything from source X" lookup
  FULLTEXT KEY `posts_content_text_fulltext` (`content_text`),      -- powers MATCH(...) AGAINST(...)
  CONSTRAINT `posts_author_user_id_fk`
    FOREIGN KEY (`author_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `posts_source_feed_id_fk`
    FOREIGN KEY (`source_feed_id`) REFERENCES `feed_sources` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 6. `comments` + `reactions`. Visitors must be signed in to use either.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `comments` (
  `id`                INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `post_id`           INT NOT NULL,                                 -- FK -> posts.id
  `author_id`         VARCHAR(191) NOT NULL,                        -- mirrors users.id (or external for imports)
  `author_user_id`    VARCHAR(191),                                 -- FK -> users.id (NULL if user deleted)
  `author_name`       VARCHAR(255) NOT NULL,                        -- byline
  `author_image_url`  VARCHAR(2048),                                -- byline avatar
  `content`           TEXT NOT NULL,
  `created_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `comments_post_id_fk`
    FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE,        -- delete post = delete its comments
  CONSTRAINT `comments_author_user_id_fk`
    FOREIGN KEY (`author_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL -- delete user = orphan their comments
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 6b. `nav_links` — owner-managed external navigation links rendered in the
--     sitewide navbar. Flat list (no nesting), ordered ascending by
--     `sort_order`. The owner adds entries from /settings; fresh installs
--     start with zero rows so the navbar shows just the logo + auth control.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `nav_links` (
  `id`               INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `label`            VARCHAR(64)   NOT NULL,                              -- short navbar label
  `url`              VARCHAR(2048) NOT NULL,                              -- absolute external URL
  `open_in_new_tab`  TINYINT(1)    NOT NULL DEFAULT 1,                    -- defaults to true for external links
  `sort_order`       INT           NOT NULL DEFAULT 0,                    -- lower numbers appear first
  `created_at`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY `nav_links_sort_order_idx` (`sort_order`)                           -- powers the public list query
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reactions` (
  `id`         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `post_id`    INT NOT NULL,                                        -- FK -> posts.id
  `user_id`    VARCHAR(191) NOT NULL,                               -- FK -> users.id
  `type`       VARCHAR(32) NOT NULL,                                -- 'like' is the only value today
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY `reactions_post_user_type_unique` (`post_id`, `user_id`, `type`),  -- one like per user per post
  CONSTRAINT `reactions_post_id_fk`
    FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `reactions_user_id_fk`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 7. `categories` + `post_categories` — owner-managed taxonomy. Each post may
--    belong to zero or more categories. Slugs are the canonical addressable
--    identifier (`/categories/:slug`); names are the human label shown in chips.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `categories` (
  `id`          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `slug`        VARCHAR(191) NOT NULL,                                -- URL identifier, e.g. 'long-form'
  `name`        VARCHAR(255) NOT NULL,                                -- human label shown in chips / UI
  `description` TEXT,                                                 -- optional longer description
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `categories_slug_unique` (`slug`)                        -- one row per addressable slug
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `post_categories` (
  `post_id`     INT NOT NULL,                                         -- FK -> posts.id
  `category_id` INT NOT NULL,                                         -- FK -> categories.id
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`post_id`, `category_id`),                             -- a post can't be tagged twice with the same category
  KEY `post_categories_category_idx` (`category_id`),                 -- powers /categories/:slug/posts and search filter
  CONSTRAINT `post_categories_post_id_fk`
    FOREIGN KEY (`post_id`)     REFERENCES `posts` (`id`)      ON DELETE CASCADE,
  CONSTRAINT `post_categories_category_id_fk`
    FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 7. `site_settings` — one-row table (id = 1) holding every owner-editable
--    site identity field plus the active theme + palette + 14 colors.
--    The seed at the end of this section is what visitors see BEFORE you
--    sign in and customize via /settings. Replace each `<<PLACEHOLDER>>`
--    with your own value, or accept the defaults and edit them in the UI.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `site_settings` (
  `id`                            INT NOT NULL PRIMARY KEY DEFAULT 1,           -- always 1; this is a singleton
  `theme`                         VARCHAR(32) NOT NULL DEFAULT 'bauhaus',       -- structural theme name
  `palette`                       VARCHAR(32) NOT NULL DEFAULT 'bauhaus',       -- color palette name
  `site_title`                    VARCHAR(255) NOT NULL,                        -- navbar wordmark + browser tab
  `hero_heading`                  VARCHAR(255) NOT NULL,                        -- big headline on the home page
  `hero_subheading`               TEXT NOT NULL,                                -- supporting text under the headline
  `about_heading`                 VARCHAR(255) NOT NULL,                        -- "About This Platform" card title
  `about_body`                    TEXT NOT NULL,                                -- "About" card body
  `copyright_line`                VARCHAR(255) NOT NULL,                        -- "© 2025 <copyright_line>"
  `footer_credit`                 VARCHAR(255) NOT NULL,                        -- "Built with …" footer line
  `cta_label`                     VARCHAR(255) NOT NULL,                        -- hero CTA button text
  `cta_href`                      VARCHAR(2048) NOT NULL,                       -- hero CTA destination URL
  `color_background`              VARCHAR(64) NOT NULL,                         -- HSL components, e.g. '0 0% 100%'
  `color_foreground`              VARCHAR(64) NOT NULL,
  `color_background_dark`         VARCHAR(64) NOT NULL,
  `color_foreground_dark`         VARCHAR(64) NOT NULL,
  `color_primary`                 VARCHAR(64) NOT NULL,
  `color_primary_foreground`      VARCHAR(64) NOT NULL,
  `color_secondary`               VARCHAR(64) NOT NULL,
  `color_secondary_foreground`    VARCHAR(64) NOT NULL,
  `color_accent`                  VARCHAR(64) NOT NULL,
  `color_accent_foreground`       VARCHAR(64) NOT NULL,
  `color_muted`                   VARCHAR(64) NOT NULL,
  `color_muted_foreground`        VARCHAR(64) NOT NULL,
  `color_destructive`             VARCHAR(64) NOT NULL,
  `color_destructive_foreground`  VARCHAR(64) NOT NULL,
  `logo_url`                      VARCHAR(2048) NULL,
  `logo_dark_url`                 VARCHAR(2048) NULL,
  `logo_layout`                   VARCHAR(32) NOT NULL DEFAULT 'text_only',
  `default_theme_mode`            VARCHAR(32) NOT NULL DEFAULT 'system',
  `color_primary_dark`                 VARCHAR(64) NULL,
  `color_primary_foreground_dark`      VARCHAR(64) NULL,
  `color_secondary_dark`               VARCHAR(64) NULL,
  `color_secondary_foreground_dark`    VARCHAR(64) NULL,
  `color_accent_dark`                  VARCHAR(64) NULL,
  `color_accent_foreground_dark`       VARCHAR(64) NULL,
  `color_muted_dark`                   VARCHAR(64) NULL,
  `color_muted_foreground_dark`        VARCHAR(64) NULL,
  `color_destructive_dark`             VARCHAR(64) NULL,
  `color_destructive_foreground_dark`  VARCHAR(64) NULL,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- Seed the singleton row. Edit BEFORE importing, or after via /settings. --
-- INSERT IGNORE means re-running this script will not overwrite your edits.
-- Replace every `<<PLACEHOLDER>>` below with your own value. The placeholders
-- you most likely want to change are:
--   <<YOUR_USERNAME>>  — the URL handle the hero CTA links to (e.g. 'chris'
--                         results in '/users/@chris'); must match the
--                         `username` you'll set on your `users` row after
--                         signing in.
--   <<YOUR_NAME>>      — your display name in the copyright line.
--   <<SITE_TITLE>>     — the wordmark in the navbar / browser tab.
INSERT IGNORE INTO `site_settings` (
  `id`, `theme`, `palette`,
  `site_title`, `hero_heading`, `hero_subheading`,
  `about_heading`, `about_body`,
  `copyright_line`, `footer_credit`,
  `cta_label`, `cta_href`,
  `color_background`,        `color_foreground`,
  `color_background_dark`,   `color_foreground_dark`,
  `color_primary`,           `color_primary_foreground`,
  `color_secondary`,         `color_secondary_foreground`,
  `color_accent`,            `color_accent_foreground`,
  `color_muted`,             `color_muted_foreground`,
  `color_destructive`,       `color_destructive_foreground`,
  `logo_url`,                `logo_dark_url`,               `logo_layout`,                 `default_theme_mode`,
  `color_primary_dark`,                 `color_primary_foreground_dark`,
  `color_secondary_dark`,               `color_secondary_foreground_dark`,
  `color_accent_dark`,                  `color_accent_foreground_dark`,
  `color_muted_dark`,                   `color_muted_foreground_dark`,
  `color_destructive_dark`,             `color_destructive_foreground_dark`
) VALUES (
  1,                                            -- id (always 1; singleton)
  'bauhaus',                                    -- theme — pick one of: bauhaus, traditional, minimalist, academic, airy, nature, comfort, audacious, artistic
  'bauhaus',                                    -- palette — pick one of: bauhaus, monochrome, newsprint, ocean, forest, sunset, sepia, high-contrast, pastel
  '<<SITE_TITLE>>',                             -- e.g. 'Jane Doe' or 'Jane''s Notebook' (escape apostrophes by doubling them)
  '<<HERO_HEADING>>',                           -- e.g. 'Welcome!' — the big headline on the home page
  '<<HERO_SUBHEADING>>',                        -- one or two sentences under the headline
  'About This Platform',                        -- about_heading — usually fine to leave as-is
  '<<ABOUT_BODY>>',                             -- one paragraph describing the site
  '<<YOUR_NAME>>',                              -- copyright_line — shown in the footer as "© 2025 <name>"
  '<<FOOTER_CREDIT>>',                          -- e.g. 'Built with the Microblog template.'
  '<<CTA_LABEL>>',                              -- hero button text — e.g. 'Learn more about me'
  '/users/@<<YOUR_USERNAME>>',                  -- hero button link — defaults to your own profile page
  -- ---- Bauhaus tricolor defaults (red / blue / yellow). Each value is the ----
  -- ---- HSL components portion of `hsl(...)`, e.g. '0 100% 50%' === pure red. --
  '0 0% 100%',     '0 0% 0%',                    -- background (light) / foreground (light)
  '0 0% 0%',       '0 0% 100%',                  -- background (dark)  / foreground (dark)
  '0 100% 50%',    '0 0% 100%',                  -- primary (red)      / on-primary (white)
  '240 100% 50%',  '0 0% 100%',                  -- secondary (blue)   / on-secondary (white)
  '60 100% 50%',   '0 0% 0%',                    -- accent (yellow)    / on-accent (black)
  '60 100% 50%',   '0 0% 0%',                    -- muted              / on-muted
  '0 100% 50%',    '0 0% 100%',                  -- destructive (red)  / on-destructive (white)
  '',              '',            'text_only',   'system',     -- logo_url, logo_dark_url, logo_layout, default_theme_mode
  '',              '',                           -- primary dark / on-primary dark
  '',              '',                           -- secondary dark / on-secondary dark
  '',              '',                           -- accent dark / on-accent dark
  '',              '',                           -- muted dark / on-muted dark
  '',              ''                            -- destructive dark / on-destructive dark
);

-- ============================================================================
-- Useful queries for forkers — paste into phpMyAdmin's "SQL" tab as needed.
-- A mix of read (SELECT) and write (UPDATE / DELETE) statements; uncomment
-- the line(s) you want to run, replace any `<<PLACEHOLDER>>` first, and read
-- carefully before executing — the writes are not undoable without a backup.
-- ============================================================================

-- 1. Set your chosen username AFTER signing in for the first time. This is
--    what `/users/@<<YOUR_USERNAME>>` will resolve to. Pick something short,
--    lowercase, and ASCII-only — it shows up in URLs and bylines.
-- UPDATE `users` SET `username` = '<<YOUR_USERNAME>>'
--   WHERE `email`    = '<<YOUR_EMAIL>>';

-- 2. Promote yourself to the owner role. The owner is the only role that
--    sees /settings, /admin/feeds, and /admin/pending. Run this once after
--    you've signed in via OAuth at least once.
-- UPDATE `users` SET `role` = 'owner'
--   WHERE `email`    = '<<YOUR_EMAIL>>';

-- 3. List every user with their role + signup time (sanity check after
--    you sign in: confirms your row exists).
-- SELECT id, email, username, role, status, created_at, last_login_at
--   FROM users
--   ORDER BY created_at DESC;

-- 4. Demote, or block, another user.
-- UPDATE `users` SET `role`   = 'member'  WHERE `email` = '<<TARGET_EMAIL>>';
-- UPDATE `users` SET `status` = 'blocked' WHERE `email` = '<<TARGET_EMAIL>>';

-- 5. Re-customize the site identity directly (faster than the UI for bulk
--    edits, e.g. after copying the install seed verbatim).
-- UPDATE `site_settings` SET
--     site_title      = '<<NEW_SITE_TITLE>>',
--     hero_heading    = '<<NEW_HERO_HEADING>>',
--     hero_subheading = '<<NEW_HERO_SUBHEADING>>',
--     copyright_line  = '<<YOUR_NAME>>',
--     cta_href        = '/users/@<<YOUR_USERNAME>>'
--   WHERE id = 1;

-- 6. List feed subscriptions and how many items each one has imported so far.
-- SELECT id, name, feed_url, cadence, enabled,
--        last_fetched_at, next_fetch_at, items_imported, last_status
--   FROM feed_sources
--   ORDER BY name;

-- 7. Pause a feed source without unsubscribing (stops the scheduled refresh
--    but keeps already-imported posts). Replace `?` with the source's id.
-- UPDATE `feed_sources` SET `enabled` = 0 WHERE `id` = ?;

-- 8. Show the moderation queue (posts waiting for owner approval).
-- SELECT p.id, p.created_at, p.author_name, fs.name AS source,
--        LEFT(p.content_text, 120) AS preview
--   FROM posts p
--   LEFT JOIN feed_sources fs ON fs.id = p.source_feed_id
--   WHERE p.status = 'pending'
--   ORDER BY p.created_at DESC;

-- 9. Approve, or reject, a single pending post by id. Replace `?` with the id.
-- UPDATE `posts` SET `status` = 'published' WHERE `id` = ? AND `status` = 'pending';
-- DELETE FROM `posts`                      WHERE `id` = ? AND `status` = 'pending';

-- 10. Find imported posts whose `content_text` shadow column is NULL (these
--     are picked up by the automatic backfill at server startup; this query
--     just shows you which rows are pending).
-- SELECT id, created_at, author_name FROM posts
--   WHERE content_text IS NULL ORDER BY id DESC LIMIT 50;

-- 11. Most-commented published posts (top 20 — handy for an "About" page
--     or a "popular" list).
-- SELECT p.id, p.author_name, COUNT(c.id) AS comment_count, p.created_at
--   FROM posts p
--   LEFT JOIN comments c ON c.post_id = p.id
--   WHERE p.status = 'published'
--   GROUP BY p.id
--   ORDER BY comment_count DESC, p.created_at DESC
--   LIMIT 20;

-- 12. Word-count stats by author for published posts (rough — counts spaces
--     in the FULLTEXT shadow column rather than tokenizing).
-- SELECT author_name,
--        COUNT(*)                                                    AS posts,
--        SUM(CHAR_LENGTH(content_text)
--              - CHAR_LENGTH(REPLACE(content_text, ' ', '')) + 1)    AS approx_words
--   FROM posts
--   WHERE status = 'published'
--   GROUP BY author_name
--   ORDER BY posts DESC;

-- 13. Same FULLTEXT query the search endpoint uses, for the phrase
--     "<<SEARCH_PHRASE>>" (boolean mode, prefix-matched). Replace the
--     placeholder, then duplicate the term-list shape: each word becomes
--     `+word*` joined by spaces.
-- SELECT id, author_name, created_at,
--        MATCH(content_text) AGAINST ('+<<SEARCH_PHRASE>>*' IN BOOLEAN MODE) AS score
--   FROM posts
--   WHERE status = 'published'
--     AND MATCH(content_text) AGAINST ('+<<SEARCH_PHRASE>>*' IN BOOLEAN MODE)
--   ORDER BY score DESC
--   LIMIT 20;

-- 14. Vacuum check: rows in `feed_items_seen` whose linked post no longer
--     exists. Safe to delete — a re-fetch will create a fresh seen row + post.
-- SELECT s.id, s.source_id, s.guid_hash, s.post_id
--   FROM feed_items_seen s
--   LEFT JOIN posts p ON p.id = s.post_id
--   WHERE s.post_id IS NOT NULL AND p.id IS NULL;
-- DELETE s FROM feed_items_seen s
--   LEFT JOIN posts p ON p.id = s.post_id
--   WHERE s.post_id IS NOT NULL AND p.id IS NULL;

-- 15. Reset `next_fetch_at` for every enabled source (forces a refresh on
--     the next scheduled run; useful after manual edits to cadence).
-- UPDATE `feed_sources` SET `next_fetch_at` = NULL WHERE `enabled` = 1;

-- 16. List every category with how many published posts use it (handy
--     sanity check after seeding the taxonomy). The status filter
--     lives on the post LEFT JOIN, so we count `p.id` (NULL when the
--     row didn't survive the filter) rather than `pc.post_id`, which
--     would also count links to non-published posts.
-- SELECT c.id, c.slug, c.name,
--        COUNT(p.id) AS published_post_count, c.created_at
--   FROM categories c
--   LEFT JOIN post_categories pc ON pc.category_id = c.id
--   LEFT JOIN posts p            ON p.id = pc.post_id AND p.status = 'published'
--   GROUP BY c.id
--   ORDER BY published_post_count DESC, c.name ASC;

-- 17. List the owner-managed navbar links in render order. Lower `sort_order`
--     values appear first; ties keep their relative insertion order.
-- SELECT id, label, url, open_in_new_tab, sort_order, kind, page_id, visible, updated_at
--   FROM nav_links
--   ORDER BY sort_order ASC, id ASC;

-- 17b. List standalone pages (Task #25), most-recently-updated first.
-- SELECT id, slug, title, status, show_in_nav, updated_at
--   FROM pages ORDER BY updated_at DESC;

-- 17c. Hide the system "Feeds" nav row without deleting it (toggle back
--      on by setting `visible = 1`). Useful if you want the /feeds index
--      to exist but not show in the navbar.
-- UPDATE `nav_links` SET `visible` = 0 WHERE `kind` = 'system' AND `url` = '/feeds';

-- ============================================================================
--  [Task #25] forker upgrade path
--  ------------------------------
--  These statements are ONLY needed if you imported an older copy of
--  install.sql before Task #25. Fresh imports of THIS file already have
--  the `pages` table and the extended `nav_links` columns. Each block
--  uses an INFORMATION_SCHEMA probe so re-running is harmless.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `pages` (
  `id`              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `slug`            VARCHAR(96)  NOT NULL,
  `title`           VARCHAR(255) NOT NULL,
  `content`         TEXT         NOT NULL,
  `content_format`  VARCHAR(16)  NOT NULL DEFAULT 'html',
  `content_text`    TEXT         NULL,
  `status`          VARCHAR(16)  NOT NULL DEFAULT 'draft',
  `author_user_id`  VARCHAR(191) NULL,
  `show_in_nav`     TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `pages_slug_unique` (`slug`),
  CONSTRAINT `pages_author_user_id_fk`
    FOREIGN KEY (`author_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add the three new nav_links columns if they don't exist yet. Wrapped
-- in a stored-procedure trick because MySQL does not have a portable
-- "ADD COLUMN IF NOT EXISTS" — we use INFORMATION_SCHEMA + a DELIMITER
-- block to keep this script idempotent under phpMyAdmin re-imports.
DROP PROCEDURE IF EXISTS `task25_add_nav_columns`;
DELIMITER //
CREATE PROCEDURE `task25_add_nav_columns`()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nav_links' AND COLUMN_NAME = 'kind') THEN
    ALTER TABLE `nav_links` ADD COLUMN `kind` VARCHAR(16) NOT NULL DEFAULT 'external';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nav_links' AND COLUMN_NAME = 'page_id') THEN
    ALTER TABLE `nav_links` ADD COLUMN `page_id` INT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nav_links' AND COLUMN_NAME = 'visible') THEN
    ALTER TABLE `nav_links` ADD COLUMN `visible` TINYINT(1) NOT NULL DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nav_links' AND CONSTRAINT_NAME = 'nav_links_page_id_fk') THEN
    ALTER TABLE `nav_links` ADD CONSTRAINT `nav_links_page_id_fk`
      FOREIGN KEY (`page_id`) REFERENCES `pages` (`id`) ON DELETE CASCADE;
  END IF;
END//
DELIMITER ;
CALL `task25_add_nav_columns`();
DROP PROCEDURE IF EXISTS `task25_add_nav_columns`;

-- Seed the system "Feeds" nav row. Idempotent: keyed on (kind='system'
-- AND url='/feeds') so re-running this script never duplicates the row.
INSERT INTO `nav_links` (`label`, `url`, `open_in_new_tab`, `sort_order`, `kind`, `page_id`, `visible`)
SELECT 'Feeds', '/feeds', 0, 1000, 'system', NULL, 1
WHERE NOT EXISTS (
  SELECT 1 FROM `nav_links` WHERE `kind` = 'system' AND `url` = '/feeds'
);

-- Seed the system "Categories" nav row. Same idempotency rule as
-- the Feeds row above: keyed on (kind='system' AND url='/categories')
-- so re-running this script never duplicates the row. The owner can
-- hide it from the navbar via `UPDATE ... SET visible = 0 ...` or
-- the /admin/navigation UI; system rows can never be deleted.
INSERT INTO `nav_links` (`label`, `url`, `open_in_new_tab`, `sort_order`, `kind`, `page_id`, `visible`)
SELECT 'Categories', '/categories', 0, 1010, 'system', NULL, 1
WHERE NOT EXISTS (
  SELECT 1 FROM `nav_links` WHERE `kind` = 'system' AND `url` = '/categories'
);

-- Media asset registry. Every uploaded file gets a row so the library UI
-- can list, preview, and hard-delete uploads without scanning the filesystem.
CREATE TABLE IF NOT EXISTS `media_assets` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `url` VARCHAR(2048) NOT NULL,
  `filename` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(64) NOT NULL,
  `alt_text` VARCHAR(500) NULL,
  `uploaded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `media_assets_uploaded_at_idx` (`uploaded_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Profile-only photo storage for regular members. Owner profile uploads use
-- media_assets instead so they appear in the Image Library.
CREATE TABLE IF NOT EXISTS `profile_photo_assets` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id` VARCHAR(191) NOT NULL,
  `url` VARCHAR(2048) NOT NULL,
  `filename` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(64) NOT NULL,
  `uploaded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `file_data` MEDIUMBLOB NOT NULL,
  INDEX `profile_photo_assets_user_id_idx` (`user_id`),
  INDEX `profile_photo_assets_uploaded_at_idx` (`uploaded_at`),
  CONSTRAINT `profile_photo_assets_user_id_fk`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 18. Hard-reset per-user theme on a single user (snaps them back to the
--     site default everywhere). Replace `<<TARGET_EMAIL>>` first.
-- UPDATE `users` SET
--     theme = NULL, palette = NULL,
--     color_background = NULL, color_foreground = NULL,
--     color_background_dark = NULL, color_foreground_dark = NULL,
--     color_primary = NULL, color_primary_foreground = NULL,
--     color_secondary = NULL, color_secondary_foreground = NULL,
--     color_accent = NULL, color_accent_foreground = NULL,
--     color_muted = NULL, color_muted_foreground = NULL,
--     color_destructive = NULL, color_destructive_foreground = NULL
--   WHERE email = '<<TARGET_EMAIL>>';
