import { mysqlTable, varchar, int, datetime, index, customType } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

const mediumBlob = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "MEDIUMBLOB";
  },
});

export const mediaAssetsTable = mysqlTable(
  "media_assets",
  {
    id: int("id").autoincrement().primaryKey(),
    url: varchar("url", { length: 2048 }).notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    title: varchar("title", { length: 255 }),
    mimeType: varchar("mime_type", { length: 64 }).notNull(),
    uploadedAt: datetime("uploaded_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    altText: varchar("alt_text", { length: 500 }),
    fileData: mediumBlob("file_data"),
  },
  (t) => ({
    uploadedAtIdx: index("media_assets_uploaded_at_idx").on(t.uploadedAt),
  }),
);

export type MediaAsset = typeof mediaAssetsTable.$inferSelect;
export type InsertMediaAsset = typeof mediaAssetsTable.$inferInsert;
