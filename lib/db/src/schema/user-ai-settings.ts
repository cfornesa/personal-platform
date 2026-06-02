import { mysqlTable, varchar, datetime, int, text, uniqueIndex } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users.ts";

export const userAiVendorSettingsTable = mysqlTable(
  "user_ai_vendor_settings",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 191 })
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    vendor: varchar("vendor", { length: 64 }).notNull(),
    profileName: varchar("profile_name", { length: 128 }).notNull().default("Default"),
    endpointKind: varchar("endpoint_kind", { length: 32 }),
    enabled: int("enabled").notNull().default(0),
    model: varchar("model", { length: 191 }),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => ({
    uqUserVendorProfile: uniqueIndex("uq_user_vendor_profile").on(table.userId, table.vendor, table.profileName),
  }),
);

export type UserAiVendorSettings = typeof userAiVendorSettingsTable.$inferSelect;
export type InsertUserAiVendorSettings = typeof userAiVendorSettingsTable.$inferInsert;

export const userAiVendorKeysTable = mysqlTable(
  "user_ai_vendor_keys",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 191 })
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    vendor: varchar("vendor", { length: 64 }).notNull(),
    encryptedApiKey: text("encrypted_api_key").notNull(),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => ({
    uqUserVendorKey: uniqueIndex("uq_user_vendor_key").on(table.userId, table.vendor),
  }),
);

export type UserAiVendorKey = typeof userAiVendorKeysTable.$inferSelect;
export type InsertUserAiVendorKey = typeof userAiVendorKeysTable.$inferInsert;
