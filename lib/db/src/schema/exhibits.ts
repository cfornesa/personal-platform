import { mysqlTable, varchar, text, int, tinyint, datetime, uniqueIndex, primaryKey, index } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { artPiecesTable } from "./art-pieces.ts";
import { mediaAssetsTable } from "./media-assets.ts";

export const exhibitsTable = mysqlTable(
  "exhibits",
  {
    id: int("id").autoincrement().primaryKey(),
    slug: varchar("slug", { length: 191 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    artistStatement: text("artist_statement"),
    biography: text("biography"),
    rows: tinyint("rows").notNull().default(1),
    cols: tinyint("cols").notNull().default(1),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => ({
    slugUnique: uniqueIndex("exhibits_slug_unique").on(t.slug),
  }),
);

export type Exhibit = typeof exhibitsTable.$inferSelect;
export type InsertExhibit = typeof exhibitsTable.$inferInsert;

export const pieceExhibitsTable = mysqlTable(
  "piece_exhibits",
  {
    exhibitId: int("exhibit_id").notNull().references(() => exhibitsTable.id, { onDelete: "cascade" }),
    artPieceId: int("art_piece_id").notNull().references(() => artPiecesTable.id, { onDelete: "cascade" }),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.exhibitId, t.artPieceId] }),
    byExhibit: index("piece_exhibits_exhibit_idx").on(t.exhibitId),
  }),
);

export type PieceExhibit = typeof pieceExhibitsTable.$inferSelect;
export type InsertPieceExhibit = typeof pieceExhibitsTable.$inferInsert;

export const mediaAssetExhibitsTable = mysqlTable(
  "media_asset_exhibits",
  {
    exhibitId: int("exhibit_id").notNull().references(() => exhibitsTable.id, { onDelete: "cascade" }),
    mediaAssetId: int("media_asset_id").notNull().references(() => mediaAssetsTable.id, { onDelete: "cascade" }),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.exhibitId, t.mediaAssetId] }),
    byExhibit: index("media_asset_exhibits_exhibit_idx").on(t.exhibitId),
  }),
);

export type MediaAssetExhibit = typeof mediaAssetExhibitsTable.$inferSelect;
export type InsertMediaAssetExhibit = typeof mediaAssetExhibitsTable.$inferInsert;
