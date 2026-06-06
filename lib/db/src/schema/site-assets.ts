import { mysqlTable, varchar, int, datetime, uniqueIndex, customType } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

const mediumBlob = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "MEDIUMBLOB";
  },
});

export const siteAssetsTable = mysqlTable(
  "site_assets",
  {
    id: int("id").autoincrement().primaryKey(),
    assetKey: varchar("asset_key", { length: 64 }).notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 64 }).notNull(),
    fileData: mediumBlob("file_data").notNull(),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => ({
    assetKeyUnique: uniqueIndex("site_assets_asset_key_unique").on(t.assetKey),
  }),
);

export type SiteAsset = typeof siteAssetsTable.$inferSelect;
export type InsertSiteAsset = typeof siteAssetsTable.$inferInsert;
