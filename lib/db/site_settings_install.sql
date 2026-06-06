-- ============================================================================
--  Microblog — `site_settings` table only (narrow upgrade script)
--
--  WHO THIS IS FOR
--  ---------------
--  You already have a Microblog database that pre-dates the `site_settings`
--  table (or pre-dates the `theme` / `palette` columns), and you want to
--  add JUST that table without touching the rest of your schema.
--
--  IF YOU ARE STARTING FROM SCRATCH, USE `install.sql` INSTEAD — it has
--  every table including this one, plus a long list of helpful queries
--  and detailed phpMyAdmin import steps.
--
--  HOW TO IMPORT IN phpMyAdmin
--  ---------------------------
--  1. Open phpMyAdmin and click your existing database in the left sidebar.
--  2. Click the "Import" tab in the top menu.
--  3. Under "File to import", click "Choose file" and pick THIS file
--     (`site_settings_install.sql`).
--  4. Leave the format set to "SQL" and the character set to "utf-8".
--  5. Click "Go" at the bottom. You should see a green
--     "Import has been successfully finished" banner.
--  6. Click your database name in the sidebar — `site_settings` should now
--     appear in the table list with one row (id = 1) holding the seed
--     placeholders below.
--
--  PLACEHOLDER CONVENTION
--  ----------------------
--  Anywhere you see `<<SOMETHING_LIKE_THIS>>` (double angle brackets, ALL
--  CAPS) you should replace with your own value BEFORE importing. Suggested
--  workflow: open this file in a text editor, do a Find-and-Replace for
--  each placeholder, save, then upload to phpMyAdmin. Or accept the
--  placeholders for now and edit them via /settings after you sign in as
--  the owner — the running app uses the same backing table either way.
--
--  RE-RUNNING IS SAFE
--  ------------------
--  `CREATE TABLE IF NOT EXISTS` and `INSERT IGNORE` mean re-running this
--  script never drops or modifies an existing row. The `ALTER TABLE … ADD
--  COLUMN IF NOT EXISTS` block backfills the `theme` / `palette` columns
--  on databases that pre-date them.
--
--  WHEN TO RUN `install.sql` INSTEAD
--  ---------------------------------
--  If your database does not yet have `users`, `posts`, `comments`,
--  `accounts`, etc., this narrow script alone is NOT enough — sign-in,
--  posting, and commenting will all 500 because the tables they read
--  from don't exist. Use `lib/db/install.sql` for a full install.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `site_settings` (
  `id`                            INT NOT NULL PRIMARY KEY DEFAULT 1,           -- always 1; this is a singleton
  `theme`                         VARCHAR(32) NOT NULL DEFAULT 'bauhaus',       -- structural theme name
  `palette`                       VARCHAR(32) NOT NULL DEFAULT 'bauhaus',       -- color palette name
  `site_title`                    VARCHAR(255) NOT NULL,                        -- navbar wordmark + browser tab title
  `hero_heading`                  VARCHAR(255) NOT NULL,                        -- big headline on the home page
  `hero_subheading`               TEXT NOT NULL,                                -- supporting text under the headline
  `about_heading`                 VARCHAR(255) NOT NULL,                        -- "About This Platform" card title
  `about_body`                    TEXT NOT NULL,                                -- "About" card body
  `copyright_line`                VARCHAR(255) NOT NULL,                        -- "© 2025 <copyright_line>" in the footer
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

-- Backfill columns on databases created before they shipped.
-- Safe no-op if the columns already exist.
ALTER TABLE `site_settings`
  ADD COLUMN IF NOT EXISTS `theme`   VARCHAR(32) NOT NULL DEFAULT 'bauhaus';
ALTER TABLE `site_settings`
  ADD COLUMN IF NOT EXISTS `palette` VARCHAR(32) NOT NULL DEFAULT 'bauhaus';
ALTER TABLE `site_settings`
  ADD COLUMN IF NOT EXISTS `logo_url`                           VARCHAR(2048) NULL,
  ADD COLUMN IF NOT EXISTS `logo_dark_url`                      VARCHAR(2048) NULL,
  ADD COLUMN IF NOT EXISTS `logo_layout`                        VARCHAR(32) NOT NULL DEFAULT 'text_only',
  ADD COLUMN IF NOT EXISTS `default_theme_mode`                 VARCHAR(32) NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS `color_primary_dark`                 VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `color_primary_foreground_dark`      VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `color_secondary_dark`               VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `color_secondary_foreground_dark`    VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `color_accent_dark`                  VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `color_accent_foreground_dark`       VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `color_muted_dark`                   VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `color_muted_foreground_dark`        VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `color_destructive_dark`             VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `color_destructive_foreground_dark`  VARCHAR(64) NULL;

-- ---- Seed the singleton row. Edit BEFORE importing, or after via /settings. --
-- INSERT IGNORE means re-running never overwrites existing edits.
-- The placeholders you most likely want to change are:
--   <<YOUR_USERNAME>>  — the URL handle the hero CTA links to (e.g. 'chris'
--                         resolves to '/users/@chris'); must match the
--                         `username` you set on your `users` row after
--                         signing in (see install.sql, query #1).
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
  '<<HERO_HEADING>>',                           -- the big headline on the home page
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
  '/api/site-assets/logo-light', '/api/site-assets/logo-dark', 'text_only', 'system', -- logo_url, logo_dark_url, logo_layout, default_theme_mode
  '',              '',                           -- primary dark / on-primary dark
  '',              '',                           -- secondary dark / on-secondary dark
  '',              '',                           -- accent dark / on-accent dark
  '',              '',                           -- muted dark / on-muted dark
  '',              ''                            -- destructive dark / on-destructive dark
);
