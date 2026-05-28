import { beforeEach, describe, expect, it, vi } from "vitest";

const mysqlPoolQuery = vi.fn();

vi.mock("@workspace/db", () => ({
  mysqlPool: {
    query: mysqlPoolQuery,
  },
}));

const {
  clearExhibitJoinColumnCache,
  countMembershipsByExhibit,
  getExhibitJoinColumn,
  listOwnersForExhibit,
  loadExhibitMembershipMap,
  replaceExhibitMemberships,
} = await import("./exhibit-memberships");

describe("exhibit-memberships compatibility helpers", () => {
  beforeEach(() => {
    mysqlPoolQuery.mockReset();
    clearExhibitJoinColumnCache();
  });

  it("prefers exhibit_id when the normalized column exists", async () => {
    mysqlPoolQuery.mockResolvedValueOnce([[{ COLUMN_NAME: "exhibit_id" }]]);

    await expect(getExhibitJoinColumn("piece_exhibits")).resolves.toBe("exhibit_id");
    expect(mysqlPoolQuery).toHaveBeenCalledTimes(1);
  });

  it("falls back to gallery_id for legacy renamed tables", async () => {
    mysqlPoolQuery.mockResolvedValueOnce([[{ COLUMN_NAME: "gallery_id" }]]);

    await expect(getExhibitJoinColumn("media_asset_exhibits")).resolves.toBe("gallery_id");
  });

  it("loads exhibit memberships from legacy gallery_id tables", async () => {
    mysqlPoolQuery
      .mockResolvedValueOnce([[{ COLUMN_NAME: "gallery_id" }]])
      .mockResolvedValueOnce([
        [
          { owner_id: 9, exhibit_id: 3 },
          { owner_id: 9, exhibit_id: 5 },
          { owner_id: 10, exhibit_id: 8 },
        ],
      ]);

    const map = await loadExhibitMembershipMap({
      tableName: "piece_exhibits",
      ownerColumn: "art_piece_id",
      ownerIds: [9, 10],
    });

    expect(map.get(9)).toEqual([3, 5]);
    expect(map.get(10)).toEqual([8]);
    expect(String(mysqlPoolQuery.mock.calls[1]?.[0])).toContain("`gallery_id` AS exhibit_id");
  });

  it("replaces memberships using normalized exhibit_id tables", async () => {
    mysqlPoolQuery
      .mockResolvedValueOnce([[{ COLUMN_NAME: "exhibit_id" }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);

    await replaceExhibitMemberships({
      tableName: "media_asset_exhibits",
      ownerColumn: "media_asset_id",
      ownerId: 4,
      exhibitIds: [2, 6],
    });

    expect(String(mysqlPoolQuery.mock.calls[1]?.[0])).toContain("DELETE FROM `media_asset_exhibits`");
    expect(mysqlPoolQuery.mock.calls[1]?.[1]).toEqual([4]);
    expect(String(mysqlPoolQuery.mock.calls[2]?.[0])).toContain("(`exhibit_id`, `media_asset_id`)");
    expect(mysqlPoolQuery.mock.calls[2]?.[1]).toEqual([2, 4, 6, 4]);
  });

  it("counts memberships and lists owner ids against legacy tables", async () => {
    mysqlPoolQuery
      .mockResolvedValueOnce([[{ COLUMN_NAME: "gallery_id" }]])
      .mockResolvedValueOnce([[{ exhibit_id: 7, count: 2 }]])
      .mockResolvedValueOnce([[{ owner_id: 11 }, { owner_id: 12 }]]);

    const counts = await countMembershipsByExhibit({
      tableName: "piece_exhibits",
      exhibitIds: [7],
    });
    const owners = await listOwnersForExhibit({
      tableName: "piece_exhibits",
      ownerColumn: "art_piece_id",
      exhibitId: 7,
    });

    expect(counts.get(7)).toBe(2);
    expect(owners).toEqual([11, 12]);
    expect(String(mysqlPoolQuery.mock.calls[1]?.[0])).toContain("`gallery_id` AS exhibit_id");
    expect(String(mysqlPoolQuery.mock.calls[2]?.[0])).toContain("WHERE `gallery_id` = ?");
  });
});
