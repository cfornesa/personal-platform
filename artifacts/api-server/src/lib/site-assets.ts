import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Response } from "express";
import { db, eq, mysqlPool, siteAssetsTable, siteSettingsDefaults, siteSettingsTable } from "@workspace/db";
import { logger } from "./logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SITE_ASSET_ROOT_CANDIDATES = [
  path.resolve(__dirname, "..", "..", "..", "artifacts", "microblog", "public"),
  path.resolve(__dirname, "..", "..", "..", "microblog", "public"),
  path.resolve(process.cwd(), "artifacts", "microblog", "public"),
];

function resolveDefaultSiteAssetPath(filename: string): string {
  for (const root of DEFAULT_SITE_ASSET_ROOT_CANDIDATES) {
    const candidate = path.join(root, filename);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.join(DEFAULT_SITE_ASSET_ROOT_CANDIDATES[0], filename);
}

export const DEFAULT_SITE_ASSET_URLS = {
  favicon: "/favicon.svg",
  logoLight: "/api/site-assets/logo-light",
  logoDark: "/api/site-assets/logo-dark",
} as const;

type SiteAssetKey = "favicon" | "logo-light" | "logo-dark";

type SiteAssetDefinition = {
  assetKey: SiteAssetKey;
  filename: string;
  mimeType: string;
  sourcePath: string;
};

const DEFAULT_SITE_ASSETS: SiteAssetDefinition[] = [
  {
    assetKey: "favicon",
    filename: "favicon.svg",
    mimeType: "image/svg+xml",
    sourcePath: resolveDefaultSiteAssetPath("favicon.svg"),
  },
  {
    assetKey: "logo-light",
    filename: "logo.svg",
    mimeType: "image/svg+xml",
    sourcePath: resolveDefaultSiteAssetPath("logo.svg"),
  },
  {
    assetKey: "logo-dark",
    filename: "logo.svg",
    mimeType: "image/svg+xml",
    sourcePath: resolveDefaultSiteAssetPath("logo.svg"),
  },
];

const assetBufferCache = new Map<string, Buffer>();

function getDefaultSiteAssetDefinition(assetKey: string): SiteAssetDefinition | null {
  return DEFAULT_SITE_ASSETS.find((asset) => asset.assetKey === assetKey) ?? null;
}

async function readDefaultAssetBuffer(definition: SiteAssetDefinition): Promise<Buffer | null> {
  const cached = assetBufferCache.get(definition.assetKey);
  if (cached) {
    return cached;
  }

  if (!fs.existsSync(definition.sourcePath)) {
    return null;
  }

  const buffer = await fs.promises.readFile(definition.sourcePath);
  assetBufferCache.set(definition.assetKey, buffer);
  return buffer;
}

async function loadSiteAsset(assetKey: SiteAssetKey) {
  const rows = await db
    .select()
    .from(siteAssetsTable)
    .where(eq(siteAssetsTable.assetKey, assetKey))
    .limit(1);

  return rows[0] ?? null;
}

export async function ensureDefaultSiteAssets(): Promise<void> {
  for (const definition of DEFAULT_SITE_ASSETS) {
    const fileData = await readDefaultAssetBuffer(definition);
    if (!fileData) {
      logger.warn(
        { assetKey: definition.assetKey, sourcePath: definition.sourcePath },
        "Default site asset missing on disk",
      );
      continue;
    }

    await db
      .insert(siteAssetsTable)
      .ignore()
      .values({
        assetKey: definition.assetKey,
        filename: definition.filename,
        mimeType: definition.mimeType,
        fileData,
      });
  }

  await db
    .insert(siteSettingsTable)
    .ignore()
    .values({ id: 1, ...siteSettingsDefaults });

  await mysqlPool.query(
    `
      UPDATE site_settings
      SET
        logo_url = CASE
          WHEN logo_url IS NULL OR logo_url = '' THEN ?
          ELSE logo_url
        END,
        logo_dark_url = CASE
          WHEN logo_dark_url IS NULL OR logo_dark_url = '' THEN ?
          ELSE logo_dark_url
        END
      WHERE id = 1
        AND (
          logo_url IS NULL OR logo_url = ''
          OR logo_dark_url IS NULL OR logo_dark_url = ''
        )
    `,
    [DEFAULT_SITE_ASSET_URLS.logoLight, DEFAULT_SITE_ASSET_URLS.logoDark],
  );
}

export async function sendSiteAssetResponse(
  res: Response,
  assetKey: string,
): Promise<boolean> {
  const definition = getDefaultSiteAssetDefinition(assetKey);
  if (!definition) {
    return false;
  }

  const asset = await loadSiteAsset(definition.assetKey);
  if (asset?.fileData) {
    res.type(asset.mimeType).send(asset.fileData);
    return true;
  }

  const fallback = await readDefaultAssetBuffer(definition);
  if (!fallback) {
    return false;
  }

  res.type(definition.mimeType).send(fallback);
  return true;
}
