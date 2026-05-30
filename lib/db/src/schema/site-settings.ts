import { mysqlTable, varchar, text, int, datetime } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const siteSettingsTable = mysqlTable("site_settings", {
  id: int("id").primaryKey().default(1),

  theme: varchar("theme", { length: 32 }).notNull().default("bauhaus"),
  palette: varchar("palette", { length: 32 }).notNull().default("bauhaus"),

  siteTitle: varchar("site_title", { length: 255 }).notNull(),
  heroHeading: varchar("hero_heading", { length: 255 }).notNull(),
  heroSubheading: text("hero_subheading").notNull(),
  aboutHeading: varchar("about_heading", { length: 255 }).notNull(),
  aboutBody: text("about_body").notNull(),
  copyrightLine: varchar("copyright_line", { length: 255 }).notNull(),
  footerCredit: varchar("footer_credit", { length: 255 }).notNull(),
  ctaLabel: varchar("cta_label", { length: 255 }).notNull(),
  ctaHref: varchar("cta_href", { length: 2048 }).notNull(),

  colorBackground: varchar("color_background", { length: 64 }).notNull(),
  colorForeground: varchar("color_foreground", { length: 64 }).notNull(),
  colorBackgroundDark: varchar("color_background_dark", { length: 64 }).notNull(),
  colorForegroundDark: varchar("color_foreground_dark", { length: 64 }).notNull(),
  colorPrimary: varchar("color_primary", { length: 64 }).notNull(),
  colorPrimaryForeground: varchar("color_primary_foreground", { length: 64 }).notNull(),
  colorSecondary: varchar("color_secondary", { length: 64 }).notNull(),
  colorSecondaryForeground: varchar("color_secondary_foreground", { length: 64 }).notNull(),
  colorAccent: varchar("color_accent", { length: 64 }).notNull(),
  colorAccentForeground: varchar("color_accent_foreground", { length: 64 }).notNull(),
  colorMuted: varchar("color_muted", { length: 64 }).notNull(),
  colorMutedForeground: varchar("color_muted_foreground", { length: 64 }).notNull(),
  colorDestructive: varchar("color_destructive", { length: 64 }).notNull(),
  colorDestructiveForeground: varchar("color_destructive_foreground", { length: 64 }).notNull(),

  logoUrl: varchar("logo_url", { length: 2048 }),
  logoDarkUrl: varchar("logo_dark_url", { length: 2048 }),
  logoLayout: varchar("logo_layout", { length: 32 }).notNull().default("text_only"),
  defaultThemeMode: varchar("default_theme_mode", { length: 32 }).notNull().default("system"),

  colorPrimaryDark: varchar("color_primary_dark", { length: 64 }),
  colorPrimaryForegroundDark: varchar("color_primary_foreground_dark", { length: 64 }),
  colorSecondaryDark: varchar("color_secondary_dark", { length: 64 }),
  colorSecondaryForegroundDark: varchar("color_secondary_foreground_dark", { length: 64 }),
  colorAccentDark: varchar("color_accent_dark", { length: 64 }),
  colorAccentForegroundDark: varchar("color_accent_foreground_dark", { length: 64 }),
  colorMutedDark: varchar("color_muted_dark", { length: 64 }),
  colorMutedForegroundDark: varchar("color_muted_foreground_dark", { length: 64 }),
  colorDestructiveDark: varchar("color_destructive_dark", { length: 64 }),
  colorDestructiveForegroundDark: varchar("color_destructive_foreground_dark", { length: 64 }),

  updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
});

export type SiteSettings = typeof siteSettingsTable.$inferSelect;
export type InsertSiteSettings = typeof siteSettingsTable.$inferInsert;

// Forker-facing defaults. These mirror the seed `INSERT IGNORE` in
// `lib/db/install.sql` and `lib/db/site_settings_install.sql`. The
// `<<PLACEHOLDER>>` strings (double angle brackets, ALL CAPS) are
// deliberately ugly so a fresh fork displays an obviously-unset value
// instead of someone else's personal copy. Replace via `/settings`
// after first owner login, or by editing the row directly in SQL.
// Keep these three sources in sync (this file, install.sql,
// site_settings_install.sql) — that's our canonical default copy.
export const siteSettingsDefaults = {
  theme: "bauhaus",
  palette: "bauhaus",

  siteTitle: "<<SITE_TITLE>>",
  heroHeading: "<<HERO_HEADING>>",
  heroSubheading: "<<HERO_SUBHEADING>>",
  aboutHeading: "About This Platform",
  aboutBody: "<<ABOUT_BODY>>",
  copyrightLine: "<<YOUR_NAME>>",
  footerCredit: "<<FOOTER_CREDIT>>",
  ctaLabel: "<<CTA_LABEL>>",
  ctaHref: "/users/@<<YOUR_USERNAME>>",

  colorBackground: "0 0% 100%",
  colorForeground: "0 0% 0%",
  colorBackgroundDark: "0 0% 0%",
  colorForegroundDark: "0 0% 100%",
  colorPrimary: "0 100% 50%",
  colorPrimaryForeground: "0 0% 100%",
  colorSecondary: "240 100% 50%",
  colorSecondaryForeground: "0 0% 100%",
  colorAccent: "60 100% 50%",
  colorAccentForeground: "0 0% 0%",
  colorMuted: "60 100% 50%",
  colorMutedForeground: "0 0% 0%",
  colorDestructive: "0 100% 50%",
  colorDestructiveForeground: "0 0% 100%",

  logoUrl: "",
  logoDarkUrl: "",
  logoLayout: "text_only",
  defaultThemeMode: "system",

  colorPrimaryDark: "",
  colorPrimaryForegroundDark: "",
  colorSecondaryDark: "",
  colorSecondaryForegroundDark: "",
  colorAccentDark: "",
  colorAccentForegroundDark: "",
  colorMutedDark: "",
  colorMutedForegroundDark: "",
  colorDestructiveDark: "",
  colorDestructiveForegroundDark: "",
} as const;
