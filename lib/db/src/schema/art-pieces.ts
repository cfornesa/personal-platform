import { mysqlTable, varchar, datetime, int, text, index } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { usersTable } from "./users.ts";

export const artPieceEngineSchema = z.enum(["p5", "c2", "three"]);
export type ArtPieceEngine = z.infer<typeof artPieceEngineSchema>;

export const artPieceStatusSchema = z.enum(["active", "archived"]);
export type ArtPieceStatus = z.infer<typeof artPieceStatusSchema>;

export const artPiecesTable = mysqlTable(
  "art_pieces",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: varchar("owner_user_id", { length: 191 })
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    prompt: text("prompt").notNull(),
    engine: varchar("engine", { length: 16 }).notNull().default("p5"),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    currentVersionId: int("current_version_id"),
    thumbnailUrl: varchar("thumbnail_url", { length: 2048 }),
    description: text("description"),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => ({
    ownerIdx: index("art_pieces_owner_idx").on(table.ownerUserId),
    statusIdx: index("art_pieces_status_idx").on(table.status),
  }),
);

export const artPieceVersionsTable = mysqlTable(
  "art_piece_versions",
  {
    id: int("id").autoincrement().primaryKey(),
    artPieceId: int("art_piece_id")
      .notNull()
      .references(() => artPiecesTable.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    structuredSpec: text("structured_spec"),
    htmlCode: text("html_code"),
    cssCode: text("css_code"),
    generatedCode: text("generated_code").notNull(),
    engine: varchar("engine", { length: 16 }).notNull().default("p5"),
    generationVendor: varchar("generation_vendor", { length: 64 }),
    generationModel: varchar("generation_model", { length: 191 }),
    validationStatus: varchar("validation_status", { length: 32 }).notNull().default("validated"),
    generationAttemptCount: int("generation_attempt_count").notNull().default(1),
    notes: text("notes"),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => ({
    artPieceIdx: index("art_piece_versions_art_piece_idx").on(table.artPieceId),
  }),
);

export type ArtPiece = typeof artPiecesTable.$inferSelect;
export type InsertArtPiece = typeof artPiecesTable.$inferInsert;
export type ArtPieceVersion = typeof artPieceVersionsTable.$inferSelect;
export type InsertArtPieceVersion = typeof artPieceVersionsTable.$inferInsert;
