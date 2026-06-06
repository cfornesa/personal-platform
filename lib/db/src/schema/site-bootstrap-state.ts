import { mysqlTable, varchar, int, datetime } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const siteBootstrapStateTable = mysqlTable("site_bootstrap_state", {
  id: int("id").primaryKey().default(1),
  ownerClaimedByUserId: varchar("owner_claimed_by_user_id", { length: 191 }),
  ownerClaimedAt: datetime("owner_claimed_at", { mode: "string", fsp: 3 }),
  setupCompletedByUserId: varchar("setup_completed_by_user_id", { length: 191 }),
  setupCompletedAt: datetime("setup_completed_at", { mode: "string", fsp: 3 }),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
});

export type SiteBootstrapState = typeof siteBootstrapStateTable.$inferSelect;
export type InsertSiteBootstrapState = typeof siteBootstrapStateTable.$inferInsert;
