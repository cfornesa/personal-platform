import { mysqlTable, varchar, datetime, int, uniqueIndex, timestamp, text, json } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const userRoles = ["owner", "member"] as const;
export const userStatuses = ["active", "blocked"] as const;

export const usersTable = mysqlTable(
  "users",
  {
    id: varchar("id", { length: 191 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: varchar("name", { length: 255 }),
    username: varchar("username", { length: 255 }),
    email: varchar("email", { length: 191 }),
    emailVerified: timestamp("email_verified", { mode: "date", fsp: 3 }),
    image: varchar("image", { length: 2048 }),
    bio: text("bio"),
    website: varchar("website", { length: 2048 }),
    socialLinks: json("social_links").$type<Record<string, string>>(),
    role: varchar("role", { length: 32 }).notNull().default("member"),
    status: varchar("status", { length: 32 }).notNull().default("active"),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    lastLoginAt: datetime("last_login_at", { mode: "string", fsp: 3 }),
    postCount: int("post_count").notNull().default(0),

    // Per-user profile-page theming. All nullable so an unset user falls
    // back to the site owner's theme. Mirrors the 16 fields on
    // `site_settings` (theme + palette + 14 colors).
    theme: varchar("theme", { length: 32 }),
    palette: varchar("palette", { length: 32 }),
    colorBackground: varchar("color_background", { length: 64 }),
    colorForeground: varchar("color_foreground", { length: 64 }),
    colorBackgroundDark: varchar("color_background_dark", { length: 64 }),
    colorForegroundDark: varchar("color_foreground_dark", { length: 64 }),
    colorPrimary: varchar("color_primary", { length: 64 }),
    colorPrimaryForeground: varchar("color_primary_foreground", { length: 64 }),
    colorSecondary: varchar("color_secondary", { length: 64 }),
    colorSecondaryForeground: varchar("color_secondary_foreground", { length: 64 }),
    colorAccent: varchar("color_accent", { length: 64 }),
    colorAccentForeground: varchar("color_accent_foreground", { length: 64 }),
    colorMuted: varchar("color_muted", { length: 64 }),
    colorMutedForeground: varchar("color_muted_foreground", { length: 64 }),
    colorDestructive: varchar("color_destructive", { length: 64 }),
    colorDestructiveForeground: varchar("color_destructive_foreground", { length: 64 }),
    preferredArtPieceVendor: varchar("preferred_art_piece_vendor", { length: 64 }),
    preferredVendorTextImprove: varchar("preferred_vendor_text_improve", { length: 64 }),
    preferredVendorAltText: varchar("preferred_vendor_alt_text", { length: 64 }),
  },
  (table) => ({
    emailIdx: uniqueIndex("users_email_unique").on(table.email),
    usernameIdx: uniqueIndex("users_username_unique").on(table.username),
  }),
);

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
