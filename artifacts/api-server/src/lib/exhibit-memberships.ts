import type { RowDataPacket } from "mysql2/promise";
import { mysqlPool } from "@workspace/db";

type JoinTableName = "piece_exhibits" | "media_asset_exhibits";
type ExhibitJoinColumn = "exhibit_id" | "gallery_id";

type MembershipRow = RowDataPacket & {
  owner_id: number;
  exhibit_id: number;
};

type CountRow = RowDataPacket & {
  exhibit_id: number;
  count: number;
};

type OwnerRow = RowDataPacket & {
  owner_id: number;
};

const joinColumnCache = new Map<JoinTableName, ExhibitJoinColumn>();

function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replaceAll("`", "``")}\``;
}

export async function getExhibitJoinColumn(tableName: JoinTableName): Promise<ExhibitJoinColumn> {
  const cached = joinColumnCache.get(tableName);
  if (cached) {
    return cached;
  }

  const [rows] = await mysqlPool.query<RowDataPacket[]>(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME IN ('exhibit_id', 'gallery_id')
      ORDER BY FIELD(COLUMN_NAME, 'exhibit_id', 'gallery_id')
      LIMIT 1
    `,
    [tableName],
  );

  const column = rows[0]?.["COLUMN_NAME"];
  const resolved: ExhibitJoinColumn = column === "exhibit_id" ? "exhibit_id" : "gallery_id";
  joinColumnCache.set(tableName, resolved);
  return resolved;
}

export async function loadExhibitMembershipMap(input: {
  tableName: JoinTableName;
  ownerColumn: string;
  ownerIds: number[];
}): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (input.ownerIds.length === 0) {
    return map;
  }

  const exhibitColumn = await getExhibitJoinColumn(input.tableName);
  const ownerColumnSql = quoteIdentifier(input.ownerColumn);
  const exhibitColumnSql = quoteIdentifier(exhibitColumn);
  const tableNameSql = quoteIdentifier(input.tableName);
  const placeholders = input.ownerIds.map(() => "?").join(", ");

  const [rows] = await mysqlPool.query<MembershipRow[]>(
    `
      SELECT ${ownerColumnSql} AS owner_id, ${exhibitColumnSql} AS exhibit_id
      FROM ${tableNameSql}
      WHERE ${ownerColumnSql} IN (${placeholders})
      ORDER BY created_at ASC
    `,
    input.ownerIds,
  );

  for (const row of rows) {
    const list = map.get(row.owner_id) ?? [];
    list.push(row.exhibit_id);
    map.set(row.owner_id, list);
  }

  return map;
}

export async function replaceExhibitMemberships(input: {
  tableName: JoinTableName;
  ownerColumn: string;
  ownerId: number;
  exhibitIds: number[];
}): Promise<void> {
  const exhibitColumn = await getExhibitJoinColumn(input.tableName);
  const ownerColumnSql = quoteIdentifier(input.ownerColumn);
  const exhibitColumnSql = quoteIdentifier(exhibitColumn);
  const tableNameSql = quoteIdentifier(input.tableName);

  await mysqlPool.query(
    `DELETE FROM ${tableNameSql} WHERE ${ownerColumnSql} = ?`,
    [input.ownerId],
  );

  if (input.exhibitIds.length === 0) {
    return;
  }

  const valuesSql = input.exhibitIds.map(() => "(?, ?)").join(", ");
  const params = input.exhibitIds.flatMap((exhibitId) => [exhibitId, input.ownerId]);
  await mysqlPool.query(
    `
      INSERT INTO ${tableNameSql} (${exhibitColumnSql}, ${ownerColumnSql})
      VALUES ${valuesSql}
    `,
    params,
  );
}

export async function countMembershipsByExhibit(input: {
  tableName: JoinTableName;
  exhibitIds: number[];
}): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (input.exhibitIds.length === 0) {
    return counts;
  }

  const exhibitColumn = await getExhibitJoinColumn(input.tableName);
  const exhibitColumnSql = quoteIdentifier(exhibitColumn);
  const tableNameSql = quoteIdentifier(input.tableName);
  const placeholders = input.exhibitIds.map(() => "?").join(", ");

  const [rows] = await mysqlPool.query<CountRow[]>(
    `
      SELECT ${exhibitColumnSql} AS exhibit_id, COUNT(*) AS count
      FROM ${tableNameSql}
      WHERE ${exhibitColumnSql} IN (${placeholders})
      GROUP BY ${exhibitColumnSql}
    `,
    input.exhibitIds,
  );

  for (const row of rows) {
    counts.set(row.exhibit_id, Number(row.count ?? 0));
  }

  return counts;
}

export async function listOwnersForExhibit(input: {
  tableName: JoinTableName;
  ownerColumn: string;
  exhibitId: number;
}): Promise<number[]> {
  const exhibitColumn = await getExhibitJoinColumn(input.tableName);
  const ownerColumnSql = quoteIdentifier(input.ownerColumn);
  const exhibitColumnSql = quoteIdentifier(exhibitColumn);
  const tableNameSql = quoteIdentifier(input.tableName);

  const [rows] = await mysqlPool.query<OwnerRow[]>(
    `
      SELECT ${ownerColumnSql} AS owner_id
      FROM ${tableNameSql}
      WHERE ${exhibitColumnSql} = ?
      ORDER BY created_at ASC
    `,
    [input.exhibitId],
  );

  return rows.map((row) => row.owner_id);
}

export function clearExhibitJoinColumnCache() {
  joinColumnCache.clear();
}
