-- Migration: 2026-06-01-ai-vendor-profiles
--
-- Converts the single-row-per-vendor AI settings model to a named profile
-- model so users can have multiple configs per vendor (e.g. two Opencode Go
-- profiles pointing at different endpoints). Also adds an explicit
-- endpoint_kind field so new Opencode models don't require code changes.
--
-- Run order: after 2026-05-24-rename-codestral-to-mistral-vibe.sql

-- --------------------------------------------------------------------------
-- 1. Restructure user_ai_vendor_settings
--    Drop the composite PK, add auto-increment id as the new PK,
--    add profile_name and endpoint_kind columns.
-- --------------------------------------------------------------------------
ALTER TABLE user_ai_vendor_settings
  DROP PRIMARY KEY,
  ADD COLUMN `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST,
  ADD COLUMN `profile_name` VARCHAR(128) NOT NULL DEFAULT 'Default' AFTER `vendor`,
  ADD COLUMN `endpoint_kind` VARCHAR(32) NULL AFTER `profile_name`,
  ADD UNIQUE INDEX `uq_user_vendor_profile` (`user_id`, `vendor`, `profile_name`);

-- --------------------------------------------------------------------------
-- 2. One-time rename: give every existing row a meaningful profile name
--    using the pattern "{vendor} - {model}". Falls back to just the vendor
--    slug when no model has been saved yet.
-- --------------------------------------------------------------------------
UPDATE user_ai_vendor_settings
SET profile_name = CASE
  WHEN model IS NOT NULL AND model != '' THEN CONCAT(vendor, ' - ', model)
  ELSE vendor
END;

-- --------------------------------------------------------------------------
-- 3. Add profile-ID preference columns to users.
--    These replace the old vendor-string preference columns.
-- --------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN `preferred_art_piece_profile_id`  INT NULL AFTER `preferred_vendor_alt_text`,
  ADD COLUMN `preferred_text_improve_profile_id` INT NULL AFTER `preferred_art_piece_profile_id`,
  ADD COLUMN `preferred_alt_text_profile_id`   INT NULL AFTER `preferred_text_improve_profile_id`;

-- --------------------------------------------------------------------------
-- 4. Migrate existing vendor-string preferences to profile IDs.
--    Each user had at most one row per vendor, so the JOIN is unambiguous.
-- --------------------------------------------------------------------------
UPDATE users u
  JOIN user_ai_vendor_settings s
    ON s.user_id = u.id AND s.vendor = u.preferred_art_piece_vendor
SET u.preferred_art_piece_profile_id = s.id
WHERE u.preferred_art_piece_vendor IS NOT NULL;

UPDATE users u
  JOIN user_ai_vendor_settings s
    ON s.user_id = u.id AND s.vendor = u.preferred_vendor_text_improve
SET u.preferred_text_improve_profile_id = s.id
WHERE u.preferred_vendor_text_improve IS NOT NULL;

UPDATE users u
  JOIN user_ai_vendor_settings s
    ON s.user_id = u.id AND s.vendor = u.preferred_vendor_alt_text
SET u.preferred_alt_text_profile_id = s.id
WHERE u.preferred_vendor_alt_text IS NOT NULL;

-- --------------------------------------------------------------------------
-- 5. Drop the superseded vendor-string preference columns.
-- --------------------------------------------------------------------------
ALTER TABLE users
  DROP COLUMN `preferred_art_piece_vendor`,
  DROP COLUMN `preferred_vendor_text_improve`,
  DROP COLUMN `preferred_vendor_alt_text`;
