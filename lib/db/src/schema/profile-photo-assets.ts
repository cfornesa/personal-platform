import { mysqlTable, varchar, int, datetime, index, customType } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users.ts";

const mediumBlob = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "MEDIUMBLOB";
  },
});

export const profilePhotoAssetsTable = mysqlTable(
  "profile_photo_assets",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 191 })
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    url: varchar("url", { length: 2048 }).notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 64 }).notNull(),
    uploadedAt: datetime("uploaded_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    fileData: mediumBlob("file_data").notNull(),
  },
  (t) => ({
    userIdIdx: index("profile_photo_assets_user_id_idx").on(t.userId),
    uploadedAtIdx: index("profile_photo_assets_uploaded_at_idx").on(t.uploadedAt),
  }),
);

export type ProfilePhotoAsset = typeof profilePhotoAssetsTable.$inferSelect;
export type InsertProfilePhotoAsset = typeof profilePhotoAssetsTable.$inferInsert;
