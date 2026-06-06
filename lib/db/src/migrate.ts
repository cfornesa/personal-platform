import type { RowDataPacket, PoolConnection } from "mysql2/promise";
import { mysqlPool } from "./index.ts";

type ColumnRow = RowDataPacket & {
  COLUMN_NAME: string;
  IS_NULLABLE?: "YES" | "NO";
};

async function getColumnNames(tableName: string): Promise<Set<string>> {
  const [rows] = await mysqlPool.query<ColumnRow[]>(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
    `,
    [tableName],
  );

  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function getColumnMetadata(
  tableName: string,
  columnName: string,
): Promise<ColumnRow | null> {
  const [rows] = await mysqlPool.query<ColumnRow[]>(
    `
      SELECT COLUMN_NAME, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [tableName, columnName],
  );

  return rows[0] ?? null;
}

async function ensureColumn(
  tableName: string,
  columnName: string,
  definition: string,
): Promise<void> {
  const columns = await getColumnNames(tableName);
  if (columns.has(columnName)) {
    return;
  }

  await mysqlPool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${definition}`);
}

async function ensureNullableColumn(
  tableName: string,
  columnName: string,
  definition: string,
): Promise<void> {
  const column = await getColumnMetadata(tableName, columnName);
  if (!column) {
    await mysqlPool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${definition}`);
    return;
  }

  if (column.IS_NULLABLE === "YES") {
    return;
  }

  await mysqlPool.query(`ALTER TABLE \`${tableName}\` MODIFY COLUMN ${definition}`);
}

type IndexRow = RowDataPacket & { INDEX_NAME: string };

async function getIndexNames(tableName: string): Promise<Set<string>> {
  const [rows] = await mysqlPool.query<IndexRow[]>(
    `
      SELECT DISTINCT INDEX_NAME
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
    `,
    [tableName],
  );
  return new Set(rows.map((row) => row.INDEX_NAME));
}

async function ensureIndex(
  tableName: string,
  indexName: string,
  createSql: string,
): Promise<void> {
  const indexes = await getIndexNames(tableName);
  if (indexes.has(indexName)) {
    return;
  }
  await mysqlPool.query(createSql);
}

async function tryEnsureIndex(
  tableName: string,
  indexName: string,
  createSql: string,
): Promise<void> {
  try {
    await ensureIndex(tableName, indexName, createSql);
  } catch (err) {
    console.error(`[migrate] Non-fatal: could not create index ${indexName} on ${tableName}:`, err);
  }
}

type ConstraintRow = RowDataPacket & { CONSTRAINT_NAME: string };

async function getConstraintNames(tableName: string): Promise<Set<string>> {
  const [rows] = await mysqlPool.query<ConstraintRow[]>(
    `
      SELECT CONSTRAINT_NAME
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
    `,
    [tableName],
  );
  return new Set(rows.map((row) => row.CONSTRAINT_NAME));
}

/**
 * Add a FOREIGN KEY only if it isn't already present. The `addSql`
 * argument is the body of the `ALTER TABLE … ADD CONSTRAINT <name> …`
 * statement (e.g. `"FOREIGN KEY (source_feed_id) REFERENCES …"`).
 *
 * The check is by constraint name rather than by column tuple because
 * MySQL allows multiple FKs on the same column with different names —
 * naming our FK explicitly is what makes the migration idempotent.
 */
async function ensureForeignKey(
  tableName: string,
  constraintName: string,
  addSql: string,
): Promise<void> {
  const constraints = await getConstraintNames(tableName);
  if (constraints.has(constraintName)) {
    return;
  }
  await mysqlPool.query(
    `ALTER TABLE \`${tableName}\` ADD CONSTRAINT \`${constraintName}\` ${addSql}`,
  );
}

async function dropForeignKeyIfExists(
  tableName: string,
  constraintName: string,
): Promise<void> {
  const constraints = await getConstraintNames(tableName);
  if (!constraints.has(constraintName)) {
    return;
  }

  await mysqlPool.query(
    `ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${constraintName}\``,
  );
}

async function dropIndexIfExists(
  tableName: string,
  indexName: string,
): Promise<void> {
  if (indexName === "PRIMARY") {
    return;
  }

  const indexes = await getIndexNames(tableName);
  if (!indexes.has(indexName)) {
    return;
  }

  await mysqlPool.query(`ALTER TABLE \`${tableName}\` DROP INDEX \`${indexName}\``);
}

async function normalizeLegacyExhibitJoinTable(input: {
  tableName: "piece_exhibits" | "media_asset_exhibits";
  ownerColumn: "art_piece_id" | "media_asset_id";
  desiredOwnerIndexName: string;
  desiredExhibitIndexName: string;
  desiredOwnerFkName: string;
  desiredExhibitFkName: string;
  ownerTable: "art_pieces" | "media_assets";
}) {
  const columns = await getColumnNames(input.tableName);
  if (!columns.has("gallery_id") || columns.has("exhibit_id")) {
    return;
  }

  const legacyExhibitFkName =
    input.tableName === "piece_exhibits"
      ? "piece_galleries_gallery_id_fk"
      : "media_asset_galleries_gallery_id_fk";
  const legacyOwnerFkName =
    input.tableName === "piece_exhibits"
      ? "piece_galleries_art_piece_id_fk"
      : "media_asset_galleries_media_asset_id_fk";
  const legacyExhibitIndexName =
    input.tableName === "piece_exhibits"
      ? "piece_galleries_gallery_idx"
      : "media_asset_galleries_gallery_idx";
  const legacyOwnerIndexName =
    input.tableName === "piece_exhibits"
      ? "piece_galleries_art_piece_id_fk"
      : "media_asset_galleries_media_asset_id_fk";

  await dropForeignKeyIfExists(input.tableName, legacyExhibitFkName);
  await dropForeignKeyIfExists(input.tableName, legacyOwnerFkName);
  await dropForeignKeyIfExists(input.tableName, input.desiredExhibitFkName);
  await dropForeignKeyIfExists(input.tableName, input.desiredOwnerFkName);

  await dropIndexIfExists(input.tableName, legacyExhibitIndexName);
  await dropIndexIfExists(input.tableName, legacyOwnerIndexName);
  await dropIndexIfExists(input.tableName, input.desiredExhibitIndexName);
  await dropIndexIfExists(input.tableName, input.desiredOwnerIndexName);

  await mysqlPool.query(
    `ALTER TABLE \`${input.tableName}\` CHANGE COLUMN \`gallery_id\` \`exhibit_id\` INT NOT NULL`,
  );

  await ensureIndex(
    input.tableName,
    input.desiredExhibitIndexName,
    `CREATE INDEX ${input.desiredExhibitIndexName} ON \`${input.tableName}\` (\`exhibit_id\`)`,
  );
  await ensureIndex(
    input.tableName,
    input.desiredOwnerIndexName,
    `CREATE INDEX ${input.desiredOwnerIndexName} ON \`${input.tableName}\` (\`${input.ownerColumn}\`)`,
  );

  await ensureForeignKey(
    input.tableName,
    input.desiredExhibitFkName,
    "FOREIGN KEY (`exhibit_id`) REFERENCES `exhibits`(`id`) ON DELETE CASCADE",
  );
  await ensureForeignKey(
    input.tableName,
    input.desiredOwnerFkName,
    `FOREIGN KEY (\`${input.ownerColumn}\`) REFERENCES \`${input.ownerTable}\`(\`id\`) ON DELETE CASCADE`,
  );
}

export async function ensureTables(): Promise<void> {
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(191) PRIMARY KEY,
      name VARCHAR(255) NULL,
      email VARCHAR(191) NULL,
      email_verified TIMESTAMP(3) NULL,
      image VARCHAR(2048) NULL,
      role VARCHAR(32) NOT NULL DEFAULT 'member',
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      last_login_at DATETIME(3) NULL,
      post_count INT NOT NULL DEFAULT 0,
      preferred_art_piece_vendor VARCHAR(64) NULL,
      UNIQUE KEY users_email_unique (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS user_ai_vendor_settings (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      vendor VARCHAR(64) NOT NULL,
      profile_name VARCHAR(128) NOT NULL DEFAULT 'Default',
      endpoint_kind VARCHAR(32) NULL,
      enabled INT NOT NULL DEFAULT 0,
      model VARCHAR(191) NULL,
      encrypted_api_key TEXT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_user_vendor_profile (user_id, vendor, profile_name),
      CONSTRAINT user_ai_vendor_settings_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS profile_photo_assets (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      url VARCHAR(2048) NOT NULL,
      filename VARCHAR(255) NOT NULL,
      mime_type VARCHAR(64) NOT NULL,
      uploaded_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      file_data MEDIUMBLOB NOT NULL,
      CONSTRAINT profile_photo_assets_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureIndex(
    "profile_photo_assets",
    "profile_photo_assets_user_id_idx",
    "CREATE INDEX profile_photo_assets_user_id_idx ON profile_photo_assets (user_id)",
  );
  await ensureIndex(
    "profile_photo_assets",
    "profile_photo_assets_uploaded_at_idx",
    "CREATE INDEX profile_photo_assets_uploaded_at_idx ON profile_photo_assets (uploaded_at)",
  );

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS art_pieces (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      owner_user_id VARCHAR(191) NOT NULL,
      title VARCHAR(255) NOT NULL,
      prompt TEXT NOT NULL,
      engine VARCHAR(16) NOT NULL DEFAULT 'p5',
      status VARCHAR(16) NOT NULL DEFAULT 'active',
      current_version_id INT NULL,
      thumbnail_url VARCHAR(2048) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      CONSTRAINT art_pieces_owner_user_id_fk
        FOREIGN KEY (owner_user_id) REFERENCES users(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS art_piece_versions (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      art_piece_id INT NOT NULL,
      prompt TEXT NOT NULL,
      structured_spec TEXT NULL,
      generated_code TEXT NOT NULL,
      engine VARCHAR(16) NOT NULL DEFAULT 'p5',
      generation_vendor VARCHAR(64) NULL,
      generation_model VARCHAR(191) NULL,
      validation_status VARCHAR(32) NOT NULL DEFAULT 'validated',
      generation_attempt_count INT NOT NULL DEFAULT 1,
      notes TEXT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      CONSTRAINT art_piece_versions_art_piece_id_fk
        FOREIGN KEY (art_piece_id) REFERENCES art_pieces(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureIndex(
    "art_pieces",
    "art_pieces_owner_idx",
    "CREATE INDEX art_pieces_owner_idx ON art_pieces (owner_user_id)",
  );
  await ensureIndex(
    "art_pieces",
    "art_pieces_status_idx",
    "CREATE INDEX art_pieces_status_idx ON art_pieces (status)",
  );
  await ensureIndex(
    "art_piece_versions",
    "art_piece_versions_art_piece_idx",
    "CREATE INDEX art_piece_versions_art_piece_idx ON art_piece_versions (art_piece_id)",
  );
  await ensureNullableColumn("art_piece_versions", "structured_spec", "structured_spec TEXT NULL");
  await ensureColumn("art_piece_versions", "html_code", "html_code TEXT NULL");
  await ensureColumn("art_piece_versions", "css_code", "css_code TEXT NULL");
  await ensureColumn(
    "art_piece_versions",
    "validation_status",
    "validation_status VARCHAR(32) NOT NULL DEFAULT 'validated'",
  );
  await ensureColumn(
    "art_piece_versions",
    "generation_attempt_count",
    "generation_attempt_count INT NOT NULL DEFAULT 1",
  );
  await mysqlPool.query(`
    UPDATE art_piece_versions
    SET structured_spec = JSON_OBJECT(
      'version', 1,
      'canvas', JSON_OBJECT('width', 640, 'height', 420, 'frameRate', 30),
      'background', '#f5f5f5',
      'elements', JSON_ARRAY()
    )
    WHERE structured_spec IS NULL
  `);
  // A-Frame generation/rendering was intentionally rolled back. Remove any
  // saved A-Frame versions, then re-point affected parent pieces to their
  // newest remaining version or delete the piece if no supported versions remain.
  await mysqlPool.query(`
    DELETE FROM art_piece_versions
    WHERE engine = 'aframe'
  `);
  await mysqlPool.query(`
    UPDATE art_pieces ap
    LEFT JOIN (
      SELECT art_piece_id, MAX(id) AS latest_version_id
      FROM art_piece_versions
      GROUP BY art_piece_id
    ) latest ON latest.art_piece_id = ap.id
    LEFT JOIN art_piece_versions latest_version ON latest_version.id = latest.latest_version_id
    LEFT JOIN art_piece_versions current_version ON current_version.id = ap.current_version_id
    SET ap.current_version_id = latest.latest_version_id,
        ap.engine = COALESCE(latest_version.engine, ap.engine)
    WHERE ap.engine = 'aframe'
       OR ap.current_version_id IS NULL
       OR current_version.id IS NULL
  `);
  await mysqlPool.query(`
    DELETE ap
    FROM art_pieces ap
    LEFT JOIN art_piece_versions apv ON apv.art_piece_id = ap.id
    WHERE apv.id IS NULL
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      user_id VARCHAR(191) NOT NULL,
      type VARCHAR(64) NOT NULL,
      provider VARCHAR(191) NOT NULL,
      provider_account_id VARCHAR(191) NOT NULL,
      refresh_token TEXT NULL,
      access_token TEXT NULL,
      expires_at INT NULL,
      token_type VARCHAR(64) NULL,
      scope TEXT NULL,
      id_token TEXT NULL,
      session_state VARCHAR(255) NULL,
      PRIMARY KEY (provider, provider_account_id),
      CONSTRAINT accounts_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_token VARCHAR(191) PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      expires TIMESTAMP(3) NOT NULL,
      CONSTRAINT sessions_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await tryEnsureIndex(
    "sessions",
    "sessions_user_id_idx",
    "CREATE INDEX sessions_user_id_idx ON sessions (user_id)",
  );

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS verification_tokens (
      identifier VARCHAR(191) NOT NULL,
      token VARCHAR(191) NOT NULL,
      expires TIMESTAMP(3) NOT NULL,
      PRIMARY KEY (identifier, token)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      author_id VARCHAR(191) NOT NULL,
      author_user_id VARCHAR(191) NULL,
      author_name VARCHAR(255) NOT NULL,
      author_image_url VARCHAR(2048) NULL,
      content TEXT NOT NULL,
      content_format VARCHAR(16) NOT NULL DEFAULT 'plain',
      status VARCHAR(16) NOT NULL DEFAULT 'published',
      source_feed_id INT NULL,
      source_guid VARCHAR(1024) NULL,
      source_canonical_url VARCHAR(2048) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      CONSTRAINT posts_author_user_id_fk
        FOREIGN KEY (author_user_id) REFERENCES users(id)
        ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      post_id INT NOT NULL,
      author_id VARCHAR(191) NOT NULL,
      author_user_id VARCHAR(191) NULL,
      author_name VARCHAR(255) NOT NULL,
      author_image_url VARCHAR(2048) NULL,
      content TEXT NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      CONSTRAINT comments_post_id_fk
        FOREIGN KEY (post_id) REFERENCES posts(id)
        ON DELETE CASCADE,
      CONSTRAINT comments_author_user_id_fk
        FOREIGN KEY (author_user_id) REFERENCES users(id)
        ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureColumn(
    "posts",
    "author_user_id",
    "author_user_id VARCHAR(191) NULL",
  );

  await ensureColumn(
    "posts",
    "content_format",
    "content_format VARCHAR(16) NOT NULL DEFAULT 'plain'",
  );

  // Feed-ingest / pending-review columns. All nullable so existing
  // owner-authored rows are unaffected. `status` defaults to
  // 'published' so any legacy row (and any direct INSERT that omits
  // the column) lands on the public timeline as before.
  await ensureColumn(
    "posts",
    "status",
    "status VARCHAR(16) NOT NULL DEFAULT 'published'",
  );
  await ensureColumn(
    "posts",
    "source_feed_id",
    "source_feed_id INT NULL",
  );
  await ensureColumn(
    "posts",
    "source_guid",
    "source_guid VARCHAR(1024) NULL",
  );
  await ensureColumn(
    "posts",
    "source_canonical_url",
    "source_canonical_url VARCHAR(2048) NULL",
  );

  // Optional post title. Null for title-less microblog posts (existing
  // behavior preserved). Set when owner writes a long-form post or
  // retroactively titles an existing post via the edit flow.
  await ensureColumn("posts", "title", "title VARCHAR(500) NULL");

  // Scheduled publishing columns. Confirmed by owner on 2026-05-14.
  // `scheduled_at` is only set when status='scheduled'; the in-process
  // post-scheduler checks every 60s and transitions overdue rows to
  // 'published'. `pending_platform_ids` stores JSON-encoded platform
  // connection IDs to syndicate at publish time (avoids early dispatch).
  await ensureColumn("posts", "scheduled_at", "scheduled_at DATETIME(3) NULL");
  await ensureColumn(
    "posts",
    "pending_platform_ids",
    "pending_platform_ids TEXT NULL",
  );
  await ensureIndex(
    "posts",
    "posts_scheduled_idx",
    "CREATE INDEX posts_scheduled_idx ON posts (status, scheduled_at)",
  );

  // Plain-text shadow of `content`, populated by every write path that
  // touches `content`. Backs the FULLTEXT index that powers
  // `/api/posts/search`. Nullable so adding the column on an existing
  // deploy doesn't reject existing rows; legacy rows are backfilled
  // by `backfillPostContentText` in the API server's startup, which
  // calls the same `computeContentText` helper used at write time so
  // there is exactly one HTML-to-text implementation.
  await ensureColumn("posts", "content_text", "content_text TEXT NULL");

  // Index on status so the very common "published only" filter on the
  // public timeline does not table-scan as the queue grows.
  await ensureIndex(
    "posts",
    "posts_status_idx",
    "CREATE INDEX posts_status_idx ON posts (status)",
  );
  await ensureIndex(
    "posts",
    "posts_source_feed_idx",
    "CREATE INDEX posts_source_feed_idx ON posts (source_feed_id)",
  );

  // FULLTEXT index over the stripped-text shadow column. InnoDB-native;
  // self-maintaining on insert/update/delete so deletions need no
  // separate reindex pass. The accompanying search endpoint uses
  // `MATCH(content_text) AGAINST(? IN BOOLEAN MODE)` for relevance
  // ranking. Created via the same `ensureIndex` shim that handles
  // BTREE/UNIQUE — `CREATE FULLTEXT INDEX` is idempotent here because
  // the helper short-circuits when an index of that name already exists.
  await ensureIndex(
    "posts",
    "posts_content_text_fulltext",
    "CREATE FULLTEXT INDEX posts_content_text_fulltext ON posts (content_text)",
  );

  await tryEnsureIndex(
    "posts",
    "posts_author_id_idx",
    "CREATE INDEX posts_author_id_idx ON posts (author_id)",
  );
  await tryEnsureIndex(
    "posts",
    "posts_status_created_idx",
    "CREATE INDEX posts_status_created_idx ON posts (status, created_at)",
  );

  // Featured image URL for social sharing and og:image. Nullable so existing
  // posts are unaffected; social adapters require this to post images.
  await ensureColumn("posts", "featured_image_url", "featured_image_url VARCHAR(2048) NULL");

  // JSON-encoded per-platform social post text { bluesky?, linkedin?, facebook?, instagram? }.
  // Stored separately from post content so the owner can tailor each caption.
  await ensureColumn("posts", "social_post_drafts", "social_post_drafts TEXT NULL");

  await ensureColumn(
    "comments",
    "author_user_id",
    "author_user_id VARCHAR(191) NULL",
  );

  // App-owned profile fields not in the original Auth.js-derived
  // `CREATE TABLE`. All nullable so existing rows stay valid; the
  // username unique index lands after the column does.
  await ensureColumn("users", "username", "username VARCHAR(255) NULL");
  await ensureColumn("users", "bio", "bio TEXT NULL");
  await ensureColumn("users", "website", "website VARCHAR(2048) NULL");
  await ensureColumn("users", "social_links", "social_links JSON NULL");
  await ensureIndex(
    "users",
    "users_username_unique",
    "CREATE UNIQUE INDEX users_username_unique ON users (username)",
  );

  // Per-user theming columns. All nullable so an unset user falls back to
  // the site owner's theme. Mirrors the 16 fields on `site_settings`.
  await ensureColumn("users", "theme", "theme VARCHAR(32) NULL");
  await ensureColumn("users", "palette", "palette VARCHAR(32) NULL");
  await ensureColumn("users", "color_background", "color_background VARCHAR(64) NULL");
  await ensureColumn("users", "color_foreground", "color_foreground VARCHAR(64) NULL");
  await ensureColumn(
    "users",
    "color_background_dark",
    "color_background_dark VARCHAR(64) NULL",
  );
  await ensureColumn(
    "users",
    "color_foreground_dark",
    "color_foreground_dark VARCHAR(64) NULL",
  );
  await ensureColumn("users", "color_primary", "color_primary VARCHAR(64) NULL");
  await ensureColumn(
    "users",
    "color_primary_foreground",
    "color_primary_foreground VARCHAR(64) NULL",
  );
  await ensureColumn("users", "color_secondary", "color_secondary VARCHAR(64) NULL");
  await ensureColumn(
    "users",
    "color_secondary_foreground",
    "color_secondary_foreground VARCHAR(64) NULL",
  );
  await ensureColumn("users", "color_accent", "color_accent VARCHAR(64) NULL");
  await ensureColumn(
    "users",
    "color_accent_foreground",
    "color_accent_foreground VARCHAR(64) NULL",
  );
  await ensureColumn("users", "color_muted", "color_muted VARCHAR(64) NULL");
  await ensureColumn(
    "users",
    "color_muted_foreground",
    "color_muted_foreground VARCHAR(64) NULL",
  );
  await ensureColumn(
    "users",
    "color_destructive",
    "color_destructive VARCHAR(64) NULL",
  );
  await ensureColumn(
    "users",
    "color_destructive_foreground",
    "color_destructive_foreground VARCHAR(64) NULL",
  );
  // preferred_art_piece_vendor / preferred_vendor_text_improve / preferred_vendor_alt_text
  // are intentionally absent here — they were replaced by profile ID integer columns in the
  // AI vendor profile migration below. Adding them here would re-create them after the
  // migration drops them, causing an infinite add/drop loop on every startup.

  // Keep denormalized post avatars aligned with the current user profile
  // photo. This corrects rows written before profile-photo updates cascaded
  // to posts, while leaving feed-imported rows alone.
  await mysqlPool.query(`
    UPDATE posts p
    INNER JOIN users u
      ON p.author_user_id = u.id
      OR (p.author_user_id IS NULL AND p.author_id = u.id)
    SET p.author_image_url = u.image
    WHERE p.source_feed_id IS NULL
      AND u.image IS NOT NULL
      AND (p.author_image_url IS NULL OR p.author_image_url <> u.image)
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id INT NOT NULL PRIMARY KEY DEFAULT 1,
      theme VARCHAR(32) NOT NULL DEFAULT 'bauhaus',
      palette VARCHAR(32) NOT NULL DEFAULT 'bauhaus',
      site_title VARCHAR(255) NOT NULL,
      hero_heading VARCHAR(255) NOT NULL,
      hero_subheading TEXT NOT NULL,
      about_heading VARCHAR(255) NOT NULL,
      about_body TEXT NOT NULL,
      copyright_line VARCHAR(255) NOT NULL,
      footer_credit VARCHAR(255) NOT NULL,
      cta_label VARCHAR(255) NOT NULL,
      cta_href VARCHAR(2048) NOT NULL,
      color_background VARCHAR(64) NOT NULL,
      color_foreground VARCHAR(64) NOT NULL,
      color_background_dark VARCHAR(64) NOT NULL,
      color_foreground_dark VARCHAR(64) NOT NULL,
      color_primary VARCHAR(64) NOT NULL,
      color_primary_foreground VARCHAR(64) NOT NULL,
      color_secondary VARCHAR(64) NOT NULL,
      color_secondary_foreground VARCHAR(64) NOT NULL,
      color_accent VARCHAR(64) NOT NULL,
      color_accent_foreground VARCHAR(64) NOT NULL,
      color_muted VARCHAR(64) NOT NULL,
      color_muted_foreground VARCHAR(64) NOT NULL,
      color_destructive VARCHAR(64) NOT NULL,
      color_destructive_foreground VARCHAR(64) NOT NULL,
      logo_url VARCHAR(2048) NULL,
      logo_dark_url VARCHAR(2048) NULL,
      logo_layout VARCHAR(32) NOT NULL DEFAULT 'text_only',
      default_theme_mode VARCHAR(32) NOT NULL DEFAULT 'system',
      color_primary_dark VARCHAR(64) NULL,
      color_primary_foreground_dark VARCHAR(64) NULL,
      color_secondary_dark VARCHAR(64) NULL,
      color_secondary_foreground_dark VARCHAR(64) NULL,
      color_accent_dark VARCHAR(64) NULL,
      color_accent_foreground_dark VARCHAR(64) NULL,
      color_muted_dark VARCHAR(64) NULL,
      color_muted_foreground_dark VARCHAR(64) NULL,
      color_destructive_dark VARCHAR(64) NULL,
      color_destructive_foreground_dark VARCHAR(64) NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS site_assets (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      asset_key VARCHAR(64) NOT NULL,
      filename VARCHAR(255) NOT NULL,
      mime_type VARCHAR(64) NOT NULL,
      file_data MEDIUMBLOB NOT NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY site_assets_asset_key_unique (asset_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS site_bootstrap_state (
      id INT NOT NULL PRIMARY KEY DEFAULT 1,
      owner_claimed_by_user_id VARCHAR(191) NULL,
      owner_claimed_at DATETIME(3) NULL,
      setup_completed_by_user_id VARCHAR(191) NULL,
      setup_completed_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await mysqlPool.query(`
    INSERT IGNORE INTO site_bootstrap_state (id)
    VALUES (1)
  `);

  await ensureColumn(
    "site_settings",
    "theme",
    "theme VARCHAR(32) NOT NULL DEFAULT 'bauhaus'",
  );

  await ensureColumn(
    "site_settings",
    "palette",
    "palette VARCHAR(32) NOT NULL DEFAULT 'bauhaus'",
  );

  await ensureColumn(
    "site_settings",
    "logo_url",
    "logo_url VARCHAR(2048) NULL",
  );

  await ensureColumn(
    "site_settings",
    "logo_dark_url",
    "logo_dark_url VARCHAR(2048) NULL",
  );

  await ensureColumn(
    "site_settings",
    "logo_layout",
    "logo_layout VARCHAR(32) NOT NULL DEFAULT 'text_only'",
  );

  await ensureColumn(
    "site_settings",
    "default_theme_mode",
    "default_theme_mode VARCHAR(32) NOT NULL DEFAULT 'system'",
  );

  await ensureColumn(
    "site_settings",
    "color_primary_dark",
    "color_primary_dark VARCHAR(64) NULL",
  );

  await ensureColumn(
    "site_settings",
    "color_primary_foreground_dark",
    "color_primary_foreground_dark VARCHAR(64) NULL",
  );

  await ensureColumn(
    "site_settings",
    "color_secondary_dark",
    "color_secondary_dark VARCHAR(64) NULL",
  );

  await ensureColumn(
    "site_settings",
    "color_secondary_foreground_dark",
    "color_secondary_foreground_dark VARCHAR(64) NULL",
  );

  await ensureColumn(
    "site_settings",
    "color_accent_dark",
    "color_accent_dark VARCHAR(64) NULL",
  );

  await ensureColumn(
    "site_settings",
    "color_accent_foreground_dark",
    "color_accent_foreground_dark VARCHAR(64) NULL",
  );

  await ensureColumn(
    "site_settings",
    "color_muted_dark",
    "color_muted_dark VARCHAR(64) NULL",
  );

  await ensureColumn(
    "site_settings",
    "color_muted_foreground_dark",
    "color_muted_foreground_dark VARCHAR(64) NULL",
  );

  await ensureColumn(
    "site_settings",
    "color_destructive_dark",
    "color_destructive_dark VARCHAR(64) NULL",
  );

  await ensureColumn(
    "site_settings",
    "color_destructive_foreground_dark",
    "color_destructive_foreground_dark VARCHAR(64) NULL",
  );

  await mysqlPool.query(
    `
    INSERT IGNORE INTO site_settings (
      id, theme, palette,
      site_title, hero_heading, hero_subheading, about_heading, about_body,
      copyright_line, footer_credit, cta_label, cta_href,
      color_background, color_foreground, color_background_dark, color_foreground_dark,
      color_primary, color_primary_foreground,
      color_secondary, color_secondary_foreground,
      color_accent, color_accent_foreground,
      color_muted, color_muted_foreground,
      color_destructive, color_destructive_foreground,
      logo_url, logo_dark_url, logo_layout, default_theme_mode,
      color_primary_dark, color_primary_foreground_dark,
      color_secondary_dark, color_secondary_foreground_dark,
      color_accent_dark, color_accent_foreground_dark,
      color_muted_dark, color_muted_foreground_dark,
      color_destructive_dark, color_destructive_foreground_dark
    ) VALUES (
      1, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?
    )
    `,
    // Forker-facing seed for the `site_settings` singleton. Runs ONCE
    // on a fresh database (INSERT IGNORE makes it a no-op once the row
    // exists). The `<<PLACEHOLDER>>` text strings are deliberately ugly
    // so a fresh fork's home page visibly says "edit me" instead of
    // shipping someone else's identity. Owner edits via /settings
    // overwrite these immediately. Keep in sync with `siteSettingsDefaults`
    // in `lib/db/src/schema/site-settings.ts` and the matching INSERT
    // IGNORE blocks in `lib/db/install.sql` + `site_settings_install.sql`.
    [
      "bauhaus",                   // theme
      "bauhaus",                   // palette
      "<<SITE_TITLE>>",            // site_title — navbar wordmark + browser tab
      "<<HERO_HEADING>>",          // hero_heading — big home-page headline
      "<<HERO_SUBHEADING>>",       // hero_subheading — supporting text
      "About This Platform",       // about_heading — usually fine to leave as-is
      "<<ABOUT_BODY>>",            // about_body — one paragraph describing the site
      "<<YOUR_NAME>>",             // copyright_line — "© 2025 <name>" in the footer
      "<<FOOTER_CREDIT>>",         // footer_credit — "Built with …"
      "<<CTA_LABEL>>",             // cta_label — hero button text
      "/users/@<<YOUR_USERNAME>>", // cta_href — defaults to your own profile page
      // ---- Bauhaus tricolor defaults (red / blue / yellow). HSL components only. ----
      "0 0% 100%",     // color_background      (light)
      "0 0% 0%",       // color_foreground      (light)
      "0 0% 0%",       // color_background_dark
      "0 0% 100%",     // color_foreground_dark
      "0 100% 50%",    // color_primary         (red)
      "0 0% 100%",     // color_primary_foreground   (white)
      "240 100% 50%",  // color_secondary       (blue)
      "0 0% 100%",     // color_secondary_foreground (white)
      "60 100% 50%",   // color_accent          (yellow)
      "0 0% 0%",       // color_accent_foreground    (black)
      "60 100% 50%",   // color_muted
      "0 0% 0%",       // color_muted_foreground
      "0 100% 50%",    // color_destructive     (red)
      "0 0% 100%",     // color_destructive_foreground (white)
      "/api/site-assets/logo-light", // logo_url
      "/api/site-assets/logo-dark",  // logo_dark_url
      "text_only",     // logo_layout
      "system",        // default_theme_mode
      "",              // color_primary_dark
      "",              // color_primary_foreground_dark
      "",              // color_secondary_dark
      "",              // color_secondary_foreground_dark
      "",              // color_accent_dark
      "",              // color_accent_foreground_dark
      "",              // color_muted_dark
      "",              // color_muted_foreground_dark
      "",              // color_destructive_dark
      "",              // color_destructive_foreground_dark
    ],
  );

  // RSS / Atom inbound feeds (PESOS pattern). The owner subscribes to
  // external sources here; the ingest worker fans new items into
  // `posts` rows with status='pending' until an owner approves them.
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS feed_sources (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      feed_url VARCHAR(2048) NOT NULL,
      site_url VARCHAR(2048) NULL,
      cadence VARCHAR(16) NOT NULL DEFAULT 'daily',
      enabled INT NOT NULL DEFAULT 1,
      last_fetched_at DATETIME(3) NULL,
      next_fetch_at DATETIME(3) NULL,
      last_status VARCHAR(32) NULL,
      last_error TEXT NULL,
      items_imported INT NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // `next_fetch_at` was added after the initial migration. Keep the
  // ensure-column shim so any pre-existing deploy upgrades in place.
  await ensureColumn(
    "feed_sources",
    "next_fetch_at",
    "next_fetch_at DATETIME(3) NULL",
  );
  await ensureColumn(
    "feed_sources",
    "author_name",
    "author_name VARCHAR(255) NULL",
  );
  await ensureColumn(
    "feed_sources",
    "image_url",
    "image_url VARCHAR(2048) NULL",
  );
  await ensureColumn(
    "feed_sources",
    "username",
    "username VARCHAR(100) NULL",
  );
  await ensureColumn(
    "feed_sources",
    "bio",
    "bio TEXT NULL",
  );

  await mysqlPool.query(`
    UPDATE posts p
    INNER JOIN feed_sources fs ON p.source_feed_id = fs.id
    SET p.author_image_url = fs.image_url
    WHERE fs.image_url IS NOT NULL
      AND (p.author_image_url IS NULL OR p.author_image_url <> fs.image_url)
  `);

  // FK from `posts.source_feed_id` → `feed_sources.id`. Has to live
  // here (after both tables exist) rather than inline on the posts
  // CREATE TABLE because feed_sources is created later in this file.
  // ON DELETE SET NULL so unsubscribing from a source preserves the
  // already-imported posts but lets the orphan rows survive without a
  // dangling pointer. Pre-existing deployments that already had the
  // nullable column without the constraint pick up the FK on next boot.
  await ensureForeignKey(
    "posts",
    "posts_source_feed_id_fk",
    "FOREIGN KEY (source_feed_id) REFERENCES feed_sources(id) ON DELETE SET NULL",
  );

  // Dedup ledger. `guid_hash` is the lowercase hex SHA-256 of the
  // feed item's stable id (or, fallback, of `link\ntitle`). The unique
  // (source_id, guid_hash) key is what makes "ingest is idempotent
  // and may be retried" true — a re-fetch of the same source never
  // duplicates rows.
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS feed_items_seen (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      source_id INT NOT NULL,
      guid_hash CHAR(64) NOT NULL,
      seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      post_id INT NULL,
      UNIQUE KEY feed_items_seen_source_guid_unique (source_id, guid_hash),
      KEY feed_items_seen_source_idx (source_id),
      CONSTRAINT feed_items_seen_source_fk
        FOREIGN KEY (source_id) REFERENCES feed_sources(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Owner-managed taxonomy. `categories` holds the canonical slug+name+description;
  // `post_categories` is the many-to-many join. Inserted before reactions so
  // any FK from a future cross-feature table can rely on the table existing.
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(191) NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY categories_slug_unique (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS post_categories (
      post_id INT NOT NULL,
      category_id INT NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (post_id, category_id),
      KEY post_categories_category_idx (category_id),
      CONSTRAINT post_categories_post_id_fk
        FOREIGN KEY (post_id) REFERENCES posts(id)
        ON DELETE CASCADE,
      CONSTRAINT post_categories_category_id_fk
        FOREIGN KEY (category_id) REFERENCES categories(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Owner-managed external navigation links rendered in the sitewide navbar.
  // Flat list (no nesting); ordered by `sort_order` ascending. Index on
  // `sort_order` so the public list query never table-scans as the list
  // grows. `open_in_new_tab` defaults to true since these are external.
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS nav_links (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      label VARCHAR(64) NOT NULL,
      url VARCHAR(2048) NOT NULL,
      open_in_new_tab TINYINT(1) NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY nav_links_sort_order_idx (sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Standalone CMS pages (Task #25). Addressed at `/p/:slug`,
  // orthogonal to `posts` (no FK reuse, never in feeds/search).
  // `slug` is the URL key; `title` is the display label that also
  // populates the auto-generated nav row when `show_in_nav=true`.
  // `author_user_id` ON DELETE SET NULL — deleting the author leaves
  // the page in place so existing URLs survive a user deletion.
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS pages (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(96) NOT NULL,
      title VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      content_format VARCHAR(16) NOT NULL DEFAULT 'html',
      content_text TEXT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'draft',
      author_user_id VARCHAR(191) NULL,
      show_in_nav TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY pages_slug_unique (slug),
      CONSTRAINT pages_author_user_id_fk
        FOREIGN KEY (author_user_id) REFERENCES users(id)
        ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Task #25 additive nav_links extension. Existing rows from #24
  // backfill to kind='external'. `page_id` is the optional FK to
  // pages — only set when kind='page'. `visible=false` hides the row
  // from the public navbar without deleting it (preserves sort_order
  // if toggled back on).
  await ensureColumn(
    "nav_links",
    "kind",
    "kind VARCHAR(16) NOT NULL DEFAULT 'external'",
  );
  await ensureColumn("nav_links", "page_id", "page_id INT NULL");
  await ensureColumn(
    "nav_links",
    "visible",
    "visible TINYINT(1) NOT NULL DEFAULT 1",
  );
  // `url` was NOT NULL in #24. For kind='page' we may want it empty;
  // we keep it NOT NULL but allow empty string — application code
  // resolves the real href via the page join. (Avoiding a
  // schema-breaking ALTER COLUMN.)
  await ensureForeignKey(
    "nav_links",
    "nav_links_page_id_fk",
    "FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE",
  );

  // Seed the system "Feeds" nav row. Idempotent: keyed on (kind,url)
  // tuple — re-running the migration won't insert duplicates because
  // we skip when a kind='system' row pointing at /feeds already
  // exists.
  await mysqlPool.query(
    `
      INSERT INTO nav_links (label, url, open_in_new_tab, sort_order, kind, visible)
      SELECT 'Feeds', '/feeds', 0, 1000, 'system', 1
      FROM DUAL
      WHERE NOT EXISTS (
        SELECT 1 FROM nav_links WHERE kind = 'system' AND url = '/feeds'
      )
    `,
  );

  // Seed the system "Categories" nav row alongside the "Feeds" row.
  // Same idempotency rule: keyed on (kind='system' AND url) tuple so
  // re-running this migration never duplicates the row.
  await mysqlPool.query(
    `
      INSERT INTO nav_links (label, url, open_in_new_tab, sort_order, kind, visible)
      SELECT 'Categories', '/categories', 0, 1010, 'system', 1
      FROM DUAL
      WHERE NOT EXISTS (
        SELECT 1 FROM nav_links WHERE kind = 'system' AND url = '/categories'
      )
    `,
  );

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS reactions (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      post_id INT NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      type VARCHAR(32) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      CONSTRAINT reactions_post_id_fk
        FOREIGN KEY (post_id) REFERENCES posts(id)
        ON DELETE CASCADE,
      CONSTRAINT reactions_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE,
      UNIQUE KEY reactions_post_user_type_unique (post_id, user_id, type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // POSSE outbound syndication. `platform_connections` stores one OAuth
  // or credential-based connection per (user, platform) pair; tokens are
  // AES-256-GCM encrypted at rest using AI_SETTINGS_ENCRYPTION_KEY.
  // Confirmed platform enum: wordpress_com | wordpress_self | medium | blogger | substack
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS platform_connections (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      platform VARCHAR(32) NOT NULL,
      encrypted_access_token TEXT NULL,
      encrypted_refresh_token TEXT NULL,
      expires_at DATETIME(3) NULL,
      metadata JSON NULL,
      enabled INT NOT NULL DEFAULT 1,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY platform_connections_user_platform_unique (user_id, platform),
      KEY platform_connections_user_idx (user_id),
      CONSTRAINT platform_connections_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Tracks the result of each async syndication attempt per post+connection.
  // Confirmed status enum: pending | success | failed
  // The unique key on (post_id, platform_connection_id) makes the async
  // dispatcher idempotent — INSERT … ON DUPLICATE KEY UPDATE is safe to
  // retry if the dispatcher fires more than once for the same post.
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS post_syndications (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      post_id INT NOT NULL,
      platform_connection_id INT NOT NULL,
      external_id VARCHAR(512) NULL,
      external_url VARCHAR(2048) NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      error_message TEXT NULL,
      synced_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY post_syndications_post_connection_unique (post_id, platform_connection_id),
      KEY post_syndications_post_idx (post_id),
      KEY post_syndications_connection_idx (platform_connection_id),
      CONSTRAINT post_syndications_post_id_fk
        FOREIGN KEY (post_id) REFERENCES posts(id)
        ON DELETE CASCADE,
      CONSTRAINT post_syndications_connection_id_fk
        FOREIGN KEY (platform_connection_id) REFERENCES platform_connections(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Site-wide OAuth app credentials (CLIENT_ID + CLIENT_SECRET) for OAuth
  // platforms. One row per platform, not per-user. Stored encrypted with
  // AI_SETTINGS_ENCRYPTION_KEY. Survives user disconnects; separate from
  // platform_connections which holds per-user access tokens.
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS platform_oauth_apps (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      platform VARCHAR(32) NOT NULL,
      encrypted_client_id TEXT NULL,
      encrypted_client_secret TEXT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY platform_oauth_apps_platform_unique (platform)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Blog URL entered by the owner in the credentials dialog. Used to scope
  // the WordPress.com OAuth token (blog= parameter) and to look up the
  // Blogger blog ID via blogs/byurl instead of users/self/blogs.
  await ensureColumn(
    "platform_oauth_apps",
    "blog_url",
    "blog_url VARCHAR(500) NULL",
  );

  // Media asset registry. Every file written to /data/uploads gets a row
  // here so the library UI can list, preview, and hard-delete uploads without
  // scanning the filesystem. Uploaded_at is indexed for the default
  // newest-first sort order used by the library picker.
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS media_assets (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      url VARCHAR(2048) NOT NULL,
      filename VARCHAR(255) NOT NULL,
      mime_type VARCHAR(64) NOT NULL,
      uploaded_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX media_assets_uploaded_at_idx (uploaded_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureColumn(
    "media_assets",
    "title",
    "title VARCHAR(255) NULL",
  );

  await ensureColumn(
    "media_assets",
    "alt_text",
    "alt_text VARCHAR(500) NULL",
  );

  await ensureColumn(
    "media_assets",
    "file_data",
    "file_data MEDIUMBLOB NULL",
  );


  // Rename old "galleries" tables to "exhibits" if they still exist under the old names.
  // Each rename is wrapped in a silent try/catch: it's a no-op if the source is missing
  // or the target already exists (covers both first-run and already-migrated installs).
  try { await mysqlPool.query(`RENAME TABLE piece_galleries TO piece_exhibits`); } catch { /* already renamed or never existed */ }
  try { await mysqlPool.query(`RENAME TABLE media_asset_galleries TO media_asset_exhibits`); } catch { /* already renamed or never existed */ }
  try { await mysqlPool.query(`RENAME TABLE galleries TO exhibits`); } catch { /* already renamed or never existed */ }

  // Exhibits — owner-curated collections of art pieces and images,
  // displayed as a Three.js museum-style wall at /immersive/exhibits/:slug.
  // Separate from post `categories` so the two taxonomies remain distinct.
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS exhibits (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(191) NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY exhibits_slug_unique (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS piece_exhibits (
      exhibit_id INT NOT NULL,
      art_piece_id INT NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (exhibit_id, art_piece_id),
      KEY piece_exhibits_exhibit_idx (exhibit_id),
      CONSTRAINT piece_exhibits_exhibit_id_fk
        FOREIGN KEY (exhibit_id) REFERENCES exhibits(id)
        ON DELETE CASCADE,
      CONSTRAINT piece_exhibits_art_piece_id_fk
        FOREIGN KEY (art_piece_id) REFERENCES art_pieces(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS media_asset_exhibits (
      exhibit_id INT NOT NULL,
      media_asset_id INT NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (exhibit_id, media_asset_id),
      KEY media_asset_exhibits_exhibit_idx (exhibit_id),
      CONSTRAINT media_asset_exhibits_exhibit_id_fk
        FOREIGN KEY (exhibit_id) REFERENCES exhibits(id)
        ON DELETE CASCADE,
      CONSTRAINT media_asset_exhibits_media_asset_id_fk
        FOREIGN KEY (media_asset_id) REFERENCES media_assets(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await normalizeLegacyExhibitJoinTable({
    tableName: "piece_exhibits",
    ownerColumn: "art_piece_id",
    desiredOwnerIndexName: "piece_exhibits_art_piece_idx",
    desiredExhibitIndexName: "piece_exhibits_exhibit_idx",
    desiredOwnerFkName: "piece_exhibits_art_piece_id_fk",
    desiredExhibitFkName: "piece_exhibits_exhibit_id_fk",
    ownerTable: "art_pieces",
  });
  await normalizeLegacyExhibitJoinTable({
    tableName: "media_asset_exhibits",
    ownerColumn: "media_asset_id",
    desiredOwnerIndexName: "media_asset_exhibits_media_asset_idx",
    desiredExhibitIndexName: "media_asset_exhibits_exhibit_idx",
    desiredOwnerFkName: "media_asset_exhibits_media_asset_id_fk",
    desiredExhibitFkName: "media_asset_exhibits_exhibit_id_fk",
    ownerTable: "media_assets",
  });

  await ensureColumn("exhibits", "rows", "`rows` TINYINT NOT NULL DEFAULT 1");
  await ensureColumn("exhibits", "cols", "`cols` TINYINT NOT NULL DEFAULT 1");
  await ensureColumn("exhibits", "artist_statement", "`artist_statement` TEXT NULL");
  await ensureColumn("exhibits", "biography", "`biography` TEXT NULL");
  await ensureColumn("art_pieces", "description", "`description` TEXT NULL");

  // Rename the legacy 'codestral' vendor slug to 'mistral-vibe' everywhere it
  // still appears. The manual migration docs/migrations/2026-05-24-rename-codestral-to-mistral-vibe.sql
  // was intended for this but was never baked into ensureTables(). Running the
  // UPDATE here is idempotent: if no 'codestral' rows exist it is a silent no-op.
  await mysqlPool.query(`
    UPDATE user_ai_vendor_settings SET vendor = 'mistral-vibe' WHERE vendor = 'codestral'
  `);
  // Fix profile_names stamped with the old slug only after that column exists.
  // Some sibling repos may still be migrating from the pre-profile schema, where
  // `profile_name` is added later by the AI Vendor Profile Migration below.
  const aiVendorColsForCodestralRename = await getColumnNames("user_ai_vendor_settings");
  if (aiVendorColsForCodestralRename.has("profile_name")) {
    // UPDATE IGNORE skips any row where the renamed value would violate the
    // UNIQUE (user_id, vendor, profile_name) constraint — which happens when the
    // user already has a fresh mistral-vibe row with the same resulting name.
    // After the IGNORE pass, delete whatever codestral-origin rows remain (they
    // are superseded by the fresh rows).
    await mysqlPool.query(`
      UPDATE IGNORE user_ai_vendor_settings
      SET profile_name = CONCAT('mistral-vibe', SUBSTR(profile_name, LENGTH('codestral') + 1))
      WHERE vendor = 'mistral-vibe' AND profile_name LIKE 'codestral%'
    `);
    await mysqlPool.query(`
      DELETE FROM user_ai_vendor_settings
      WHERE vendor = 'mistral-vibe' AND profile_name LIKE 'codestral%'
    `);
  }
  // If the old preference columns still exist, rename any 'codestral' values too.
  const colsForCodestralRename = await getColumnNames("users");
  if (colsForCodestralRename.has("preferred_art_piece_vendor")) {
    await mysqlPool.query(`UPDATE users SET preferred_art_piece_vendor = 'mistral-vibe' WHERE preferred_art_piece_vendor = 'codestral'`);
  }
  if (colsForCodestralRename.has("preferred_vendor_text_improve")) {
    await mysqlPool.query(`UPDATE users SET preferred_vendor_text_improve = 'mistral-vibe' WHERE preferred_vendor_text_improve = 'codestral'`);
  }
  if (colsForCodestralRename.has("preferred_vendor_alt_text")) {
    await mysqlPool.query(`UPDATE users SET preferred_vendor_alt_text = 'mistral-vibe' WHERE preferred_vendor_alt_text = 'codestral'`);
  }

  // -------------------------------------------------------------------------
  // AI Vendor Profile Migration (2026-06-01)
  //
  // Converts the single-row-per-vendor AI settings model to a named profile
  // model. The `user_ai_vendor_settings` table gains an auto-increment PK,
  // a `profile_name` column, and an `endpoint_kind` column. The three
  // vendor-string preference columns on `users` are replaced with integer
  // profile-ID columns that reference the new PK.
  //
  // Every step is individually idempotent: it checks the current schema state
  // before acting. This handles partial migrations from failed earlier attempts.
  // The old encrypted_api_key, model, and enabled values are NEVER modified —
  // only new columns are added and the primary key is restructured.
  // -------------------------------------------------------------------------

  // Step A: Add `id` as a nullable INT if it doesn't exist yet.
  // NO FIRST or AFTER clause — positional hints during a MySQL table rebuild
  // can silently null TEXT columns that appear after the insertion point on
  // some MySQL 5.7 variants. The column lands at the end of the table, which
  // is semantically equivalent (application code references columns by name).
  const aiVendorColsA = await getColumnNames("user_ai_vendor_settings");
  console.log("[migrate] user_ai_vendor_settings columns:", [...aiVendorColsA].join(", "));
  if (!aiVendorColsA.has("id")) {
    console.log("[migrate] Step A: adding id column");
    await mysqlPool.query(`
      ALTER TABLE user_ai_vendor_settings ADD COLUMN id INT NULL
    `);
    console.log("[migrate] Step A: done");
  }

  // Step B: Fill any NULL id values with sequential integers.
  // Uses a dedicated connection so the session variable (@ai_id) is visible
  // to both the SET and the UPDATE on the same connection.
  const [[nullCheck]] = await mysqlPool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS cnt FROM user_ai_vendor_settings WHERE id IS NULL",
  );
  console.log("[migrate] Step B: rows with null id =", (nullCheck as RowDataPacket & { cnt: number }).cnt);
  if ((nullCheck as RowDataPacket & { cnt: number }).cnt > 0) {
    let conn: PoolConnection | null = null;
    try {
      conn = await mysqlPool.getConnection();
      await conn.query(
        "SET @ai_id := (SELECT COALESCE(MAX(id), 0) FROM user_ai_vendor_settings)",
      );
      await conn.query(`
        UPDATE user_ai_vendor_settings
        SET id = (@ai_id := @ai_id + 1)
        WHERE id IS NULL
        ORDER BY user_id, vendor
      `);
    } finally {
      conn?.release();
    }
  }

  // Step C: Make `id` NOT NULL (prerequisite for becoming the PK).
  const idMeta = await getColumnMetadata("user_ai_vendor_settings", "id");
  if (idMeta?.IS_NULLABLE === "YES") {
    await mysqlPool.query(`
      ALTER TABLE user_ai_vendor_settings MODIFY COLUMN id INT NOT NULL
    `);
  }

  // The legacy composite PRIMARY KEY (user_id, vendor) also served as the
  // supporting index for the user_id foreign key. Add an explicit replacement
  // before dropping that PK, otherwise InnoDB rejects the table rebuild on
  // older databases with "Foreign key constraint is incorrectly formed".
  await ensureIndex(
    "user_ai_vendor_settings",
    "user_ai_vendor_settings_user_id_idx",
    "CREATE INDEX user_ai_vendor_settings_user_id_idx ON user_ai_vendor_settings (user_id)",
  );

  // Step D: Swap the primary key from (user_id, vendor) to id with AUTO_INCREMENT.
  // Detect whether the old composite PK still owns the primary key slot by checking
  // if user_id appears in the PRIMARY constraint.
  console.log("[migrate] Step D: checking primary key");
  const [[pkRow]] = await mysqlPool.query<RowDataPacket[]>(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'user_ai_vendor_settings'
      AND CONSTRAINT_NAME = 'PRIMARY'
      AND COLUMN_NAME = 'user_id'
    LIMIT 1
  `);
  console.log("[migrate] Step D: user_id in PRIMARY KEY?", Boolean(pkRow));
  if (pkRow) {
    console.log("[migrate] Step D: swapping PK");
    await mysqlPool.query(`
      ALTER TABLE user_ai_vendor_settings
        DROP PRIMARY KEY,
        MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT,
        ADD PRIMARY KEY (id)
    `);
    console.log("[migrate] Step D: done");
  }

  // Step E: Add profile_name and endpoint_kind columns.
  await ensureColumn(
    "user_ai_vendor_settings",
    "profile_name",
    "profile_name VARCHAR(128) NOT NULL DEFAULT 'Default'",
  );
  await ensureColumn(
    "user_ai_vendor_settings",
    "endpoint_kind",
    "endpoint_kind VARCHAR(32) NULL",
  );

  // Step F: Add the unique index on (user_id, vendor, profile_name).
  await tryEnsureIndex(
    "user_ai_vendor_settings",
    "uq_user_vendor_profile",
    "CREATE UNIQUE INDEX uq_user_vendor_profile ON user_ai_vendor_settings (user_id, vendor, profile_name)",
  );

  // Step G: One-time rename — give every row that still has the default 'Default'
  // name a human-readable name: "{vendor} - {model}" or just "{vendor}".
  console.log("[migrate] Step G: renaming default profiles");
  await mysqlPool.query(`
    UPDATE user_ai_vendor_settings
    SET profile_name = CASE
      WHEN model IS NOT NULL AND model != '' THEN CONCAT(vendor, ' - ', model)
      ELSE vendor
    END
    WHERE profile_name = 'Default'
  `);

  // Diagnostic: log current state of all AI vendor profiles
  const settingsCols = await getColumnNames("user_ai_vendor_settings");
  let diagQuery = "";
  if (settingsCols.has("encrypted_api_key")) {
    diagQuery = "SELECT id, user_id, vendor, profile_name, enabled, model IS NOT NULL AS has_model, encrypted_api_key IS NOT NULL AS has_key FROM user_ai_vendor_settings";
  } else {
    diagQuery = `
      SELECT s.id, s.user_id, s.vendor, s.profile_name, s.enabled, s.model IS NOT NULL AS has_model, k.encrypted_api_key IS NOT NULL AS has_key
      FROM user_ai_vendor_settings s
      LEFT JOIN user_ai_vendor_keys k ON s.user_id = k.user_id AND s.vendor = k.vendor
    `;
  }
  const [diagRows] = await mysqlPool.query<RowDataPacket[]>(diagQuery);
  console.log("[migrate] AI vendor profiles after migration:", JSON.stringify(diagRows));

  // Add profile-ID preference columns to users (new names, integer type).
  await ensureColumn(
    "users",
    "preferred_art_piece_profile_id",
    "preferred_art_piece_profile_id INT NULL",
  );
  await ensureColumn(
    "users",
    "preferred_text_improve_profile_id",
    "preferred_text_improve_profile_id INT NULL",
  );
  await ensureColumn(
    "users",
    "preferred_alt_text_profile_id",
    "preferred_alt_text_profile_id INT NULL",
  );

  // Migrate vendor-string preferences → profile IDs, then drop the old columns.
  // Each block is a no-op once the source column no longer exists.
  const userColumnsForMigration = await getColumnNames("users");

  if (userColumnsForMigration.has("preferred_art_piece_vendor")) {
    await mysqlPool.query(`
      UPDATE users u
      JOIN user_ai_vendor_settings s
        ON s.user_id = u.id AND s.vendor = u.preferred_art_piece_vendor
      SET u.preferred_art_piece_profile_id = s.id
      WHERE u.preferred_art_piece_vendor IS NOT NULL
        AND u.preferred_art_piece_profile_id IS NULL
    `);
    await mysqlPool.query(`ALTER TABLE users DROP COLUMN preferred_art_piece_vendor`);
  }

  if (userColumnsForMigration.has("preferred_vendor_text_improve")) {
    await mysqlPool.query(`
      UPDATE users u
      JOIN user_ai_vendor_settings s
        ON s.user_id = u.id AND s.vendor = u.preferred_vendor_text_improve
      SET u.preferred_text_improve_profile_id = s.id
      WHERE u.preferred_vendor_text_improve IS NOT NULL
        AND u.preferred_text_improve_profile_id IS NULL
    `);
    await mysqlPool.query(`ALTER TABLE users DROP COLUMN preferred_vendor_text_improve`);
  }

  if (userColumnsForMigration.has("preferred_vendor_alt_text")) {
    await mysqlPool.query(`
      UPDATE users u
      JOIN user_ai_vendor_settings s
        ON s.user_id = u.id AND s.vendor = u.preferred_vendor_alt_text
      SET u.preferred_alt_text_profile_id = s.id
      WHERE u.preferred_vendor_alt_text IS NOT NULL
        AND u.preferred_alt_text_profile_id IS NULL
    `);
    await mysqlPool.query(`ALTER TABLE users DROP COLUMN preferred_vendor_alt_text`);
  }

  // -------------------------------------------------------------------------
  // Recycle Bin Migration (2026-06-03)
  //
  // Adds a nullable `deleted_at` column to posts, art_pieces, and media_assets
  // so deletions can be soft-deleted (moved to a recoverable Recycle Bin) instead
  // of immediately and permanently removed. Items with a non-null `deleted_at`
  // are hidden from all normal read paths and surfaced only through
  // GET /api/recycle-bin. Restoring sets the column back to NULL; permanent
  // deletion is a real SQL DELETE.
  //
  // No FIRST or AFTER positional clauses — see the AI Vendor Profile Migration
  // notes above for why these cause silent data loss on some MySQL 5.7 variants.
  // -------------------------------------------------------------------------
  await ensureColumn("posts", "deleted_at", "deleted_at DATETIME(3) NULL");
  await ensureColumn("art_pieces", "deleted_at", "deleted_at DATETIME(3) NULL");
  await ensureColumn("media_assets", "deleted_at", "deleted_at DATETIME(3) NULL");
  await ensureColumn("exhibits", "deleted_at", "deleted_at DATETIME(3) NULL");
  await ensureColumn("pages", "deleted_at", "deleted_at DATETIME(3) NULL");
  await ensureColumn("categories", "deleted_at", "deleted_at DATETIME(3) NULL");

  // -------------------------------------------------------------------------
  // AI Vendor Keys Migration (2026-06-01 v2)
  //
  // Moves encrypted_api_key out of per-profile rows into a new
  // user_ai_vendor_keys table (one key per vendor per user). This lets the
  // same API key be shared across all profiles for a vendor without
  // re-entering it for each profile.
  // -------------------------------------------------------------------------

  // Create the new table idempotently.
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS user_ai_vendor_keys (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      vendor VARCHAR(64) NOT NULL,
      encrypted_api_key TEXT NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_user_vendor_key (user_id, vendor),
      CONSTRAINT user_ai_vendor_keys_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Migrate existing per-profile keys → per-vendor keys.
  // Pick the key from the profile with the highest id (most recently created)
  // per (user_id, vendor). INSERT IGNORE keeps existing rows in user_ai_vendor_keys
  // intact on re-runs.
  const aiSettingsCols = await getColumnNames("user_ai_vendor_settings");
  if (aiSettingsCols.has("encrypted_api_key")) {
    await mysqlPool.query(`
      INSERT IGNORE INTO user_ai_vendor_keys (user_id, vendor, encrypted_api_key, created_at, updated_at)
      SELECT s.user_id, s.vendor, s.encrypted_api_key, NOW(3), NOW(3)
      FROM user_ai_vendor_settings s
      INNER JOIN (
        SELECT user_id, vendor, MAX(id) AS latest_id
        FROM user_ai_vendor_settings
        WHERE encrypted_api_key IS NOT NULL AND encrypted_api_key != ''
        GROUP BY user_id, vendor
      ) latest
        ON s.user_id = latest.user_id
        AND s.vendor = latest.vendor
        AND s.id = latest.latest_id
    `);

    // Drop the column from profiles — keys now live exclusively in user_ai_vendor_keys.
    await mysqlPool.query(`
      ALTER TABLE user_ai_vendor_settings DROP COLUMN encrypted_api_key
    `);
    console.log("[migrate] AI vendor keys migration complete: keys moved to user_ai_vendor_keys");
  }
}
