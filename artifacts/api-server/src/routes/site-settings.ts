import { Router, type IRouter, type Request, type Response } from "express";
import { db, siteSettingsTable, siteSettingsDefaults, usersTable, eq, formatMysqlDateTime } from "@workspace/db";
import { requireAuth, requireOwner } from "../middlewares/auth";
import { UpdateSiteSettingsBody } from "@workspace/api-zod";
import { parseSocialLinks } from "./users";
import { DEFAULT_SITE_ASSET_URLS } from "../lib/site-assets";

const router: IRouter = Router();

async function loadOrSeedSettings() {
  // Race-safe: single MySQL `INSERT IGNORE` then SELECT. Two concurrent first-hits
  // cannot duplicate-key here — the second one is silently ignored.
  await db
    .insert(siteSettingsTable)
    .ignore()
    .values({ id: 1, ...siteSettingsDefaults });

  const rows = await db
    .select()
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, 1))
    .limit(1);
  return rows[0]!;
}

function serialize(row: Awaited<ReturnType<typeof loadOrSeedSettings>>) {
  const { id: _id, updatedAt: _updatedAt, ...rest } = row;
  return {
    ...rest,
    logoUrl:
      typeof rest.logoUrl === "string" && rest.logoUrl.trim().length > 0
        ? rest.logoUrl
        : DEFAULT_SITE_ASSET_URLS.logoLight,
    logoDarkUrl:
      typeof rest.logoDarkUrl === "string" && rest.logoDarkUrl.trim().length > 0
        ? rest.logoDarkUrl
        : DEFAULT_SITE_ASSET_URLS.logoDark,
  };
}

/**
 * Looks up the single owner user (`role = 'owner'`) and pulls out the two
 * fields the sitewide footer needs: `social_links` (JSON map) and
 * `website` (string). Returns sensible defaults when no owner exists yet
 * — e.g. on a brand-new install where the first sign-up hasn't been
 * promoted yet — so the response stays well-typed and the footer
 * silently renders without a social row.
 */
async function loadOwnerPublicProfile(): Promise<{
  ownerSocialLinks: Record<string, string>;
  ownerWebsite: string | null;
}> {
  const rows = await db
    .select({
      socialLinks: usersTable.socialLinks,
      website: usersTable.website,
    })
    .from(usersTable)
    .where(eq(usersTable.role, "owner"))
    .limit(1);
  const row = rows[0];
  if (!row) return { ownerSocialLinks: {}, ownerWebsite: null };

  const parsed = parseSocialLinks(row.socialLinks) ?? {};
  // Only forward string-valued entries; defensive against legacy bad data.
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === "string" && v.trim().length > 0) cleaned[k] = v;
  }
  const website =
    typeof row.website === "string" && row.website.trim().length > 0
      ? row.website
      : null;
  return { ownerSocialLinks: cleaned, ownerWebsite: website };
}

const allowedOrigins: string[] = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : [];

router.get("/site-settings", async (_req: Request, res: Response) => {
  try {
    const [row, owner] = await Promise.all([
      loadOrSeedSettings(),
      loadOwnerPublicProfile(),
    ]);
    return res.json({ ...serialize(row), ...owner, allowedOrigins });
  } catch (err) {
    console.error("Failed to fetch site settings:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.patch(
  "/site-settings",
  requireAuth,
  requireOwner,
  async (req: Request, res: Response) => {
    try {
      const parsed = UpdateSiteSettingsBody.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid request body", details: parsed.error.format() });
      }

      await loadOrSeedSettings();

      const updates = Object.fromEntries(
        Object.entries(parsed.data).filter(([, v]) => v !== undefined),
      );

      if (Object.keys(updates).length > 0) {
        await db
          .update(siteSettingsTable)
          .set({ ...updates, updatedAt: formatMysqlDateTime() })
          .where(eq(siteSettingsTable.id, 1));
      }

      const [row, owner] = await Promise.all([
        loadOrSeedSettings(),
        loadOwnerPublicProfile(),
      ]);
      return res.json({ ...serialize(row), ...owner, allowedOrigins });
    } catch (err) {
      console.error("Failed to update site settings:", err);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

export default router;
