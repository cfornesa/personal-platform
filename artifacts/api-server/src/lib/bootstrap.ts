import { db, usersTable, siteSettingsTable, siteBootstrapStateTable, postsTable, pagesTable, mediaAssetsTable, feedSourcesTable, eq, count, and, asc, formatMysqlDateTime, mysqlPool } from "@workspace/db";
import type { ResultSetHeader } from "mysql2/promise";

const SETUP_PATH = "/admin/setup";

type BootstrapChecklist = {
  ownerDisplayNameReady: boolean;
  ownerUsernameReady: boolean;
  siteTitleReady: boolean;
  heroHeadingReady: boolean;
  heroSubheadingReady: boolean;
  aboutBodyReady: boolean;
};

export type BootstrapStatus = {
  hasOwner: boolean;
  isSetupComplete: boolean;
  requiresSetup: boolean;
  currentUserCanSetup: boolean;
  currentUserNeedsSetup: boolean;
  ownerAutoClaimEnabled: boolean;
  setupPath: string;
  checklist: BootstrapChecklist;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function getConfiguredOwnerEmails(): Set<string> {
  const raw = process.env.OWNER_EMAILS?.trim();
  if (!raw) {
    return new Set();
  }

  return new Set(
    raw
      .split(",")
      .map((value) => normalizeEmail(value))
      .filter(Boolean),
  );
}

export async function ensureBootstrapStateRow(): Promise<void> {
  await db.insert(siteBootstrapStateTable).ignore().values({ id: 1 });
}

function isPlaceholderValue(value: string | null | undefined): boolean {
  if (!value) {
    return true;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.startsWith("<<");
}

function buildChecklist(input: {
  ownerName?: string | null;
  ownerUsername?: string | null;
  siteTitle?: string | null;
  heroHeading?: string | null;
  heroSubheading?: string | null;
  aboutBody?: string | null;
}): BootstrapChecklist {
  return {
    ownerDisplayNameReady: !isPlaceholderValue(input.ownerName),
    ownerUsernameReady: !isPlaceholderValue(input.ownerUsername),
    siteTitleReady: !isPlaceholderValue(input.siteTitle),
    heroHeadingReady: !isPlaceholderValue(input.heroHeading),
    heroSubheadingReady: !isPlaceholderValue(input.heroSubheading),
    aboutBodyReady: !isPlaceholderValue(input.aboutBody),
  };
}

function isChecklistComplete(checklist: BootstrapChecklist): boolean {
  return Object.values(checklist).every(Boolean);
}

async function loadBootstrapStateRow() {
  await ensureBootstrapStateRow();
  const rows = await db
    .select()
    .from(siteBootstrapStateTable)
    .where(eq(siteBootstrapStateTable.id, 1))
    .limit(1);
  return rows[0]!;
}

async function loadOwnerUser() {
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.role, "owner"))
    .orderBy(asc(usersTable.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function loadSiteSettingsRow() {
  const rows = await db
    .select()
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, 1))
    .limit(1);
  return rows[0] ?? null;
}

async function loadLegacyContentSignal() {
  const [postsResult, pagesResult, mediaResult, feedSourcesResult] = await Promise.all([
    db.select({ total: count() }).from(postsTable).limit(1),
    db.select({ total: count() }).from(pagesTable).limit(1),
    db.select({ total: count() }).from(mediaAssetsTable).limit(1),
    db.select({ total: count() }).from(feedSourcesTable).limit(1),
  ]);

  return (
    (postsResult[0]?.total ?? 0) > 0 ||
    (pagesResult[0]?.total ?? 0) > 0 ||
    (mediaResult[0]?.total ?? 0) > 0 ||
    (feedSourcesResult[0]?.total ?? 0) > 0
  );
}

function buildStatus(input: {
  owner: typeof usersTable.$inferSelect | null;
  settings: typeof siteSettingsTable.$inferSelect | null;
  bootstrap: typeof siteBootstrapStateTable.$inferSelect;
  currentUser: typeof usersTable.$inferSelect | null;
  legacyContentExists: boolean;
}): BootstrapStatus {
  const checklist = buildChecklist({
    ownerName: input.owner?.name,
    ownerUsername: input.owner?.username,
    siteTitle: input.settings?.siteTitle,
    heroHeading: input.settings?.heroHeading,
    heroSubheading: input.settings?.heroSubheading,
    aboutBody: input.settings?.aboutBody,
  });

  const ownerAutoClaimEnabled = getConfiguredOwnerEmails().size > 0;
  const isSetupComplete =
    Boolean(input.bootstrap.setupCompletedAt) ||
    Boolean(input.owner && (isChecklistComplete(checklist) || input.legacyContentExists));
  const hasOwner = Boolean(input.owner);
  const currentUserCanSetup = input.currentUser?.role === "owner";
  const currentUserNeedsSetup = currentUserCanSetup && !isSetupComplete;

  return {
    hasOwner,
    isSetupComplete,
    requiresSetup: !isSetupComplete,
    currentUserCanSetup,
    currentUserNeedsSetup,
    ownerAutoClaimEnabled,
    setupPath: SETUP_PATH,
    checklist,
  };
}

export async function loadBootstrapStatus(currentUser: typeof usersTable.$inferSelect | null): Promise<BootstrapStatus> {
  const [bootstrap, owner, settings, legacyContentExists] = await Promise.all([
    loadBootstrapStateRow(),
    loadOwnerUser(),
    loadSiteSettingsRow(),
    loadLegacyContentSignal(),
  ]);

  return buildStatus({
    owner,
    settings,
    bootstrap,
    currentUser,
    legacyContentExists,
  });
}

export async function repairBootstrapState(): Promise<void> {
  const [bootstrap, owner, settings, legacyContentExists] = await Promise.all([
    loadBootstrapStateRow(),
    loadOwnerUser(),
    loadSiteSettingsRow(),
    loadLegacyContentSignal(),
  ]);

  if (owner && !bootstrap.ownerClaimedByUserId) {
    await db
      .update(siteBootstrapStateTable)
      .set({
        ownerClaimedByUserId: owner.id,
        ownerClaimedAt: bootstrap.ownerClaimedAt ?? formatMysqlDateTime(),
        updatedAt: formatMysqlDateTime(),
      })
      .where(eq(siteBootstrapStateTable.id, 1));
  }

  if (!owner && bootstrap.ownerClaimedByUserId) {
    await db
      .update(siteBootstrapStateTable)
      .set({
        ownerClaimedByUserId: null,
        ownerClaimedAt: null,
        updatedAt: formatMysqlDateTime(),
      })
      .where(eq(siteBootstrapStateTable.id, 1));
  }

  const status = buildStatus({
    owner,
    settings,
    bootstrap,
    currentUser: owner,
    legacyContentExists,
  });

  if (owner && !bootstrap.setupCompletedAt && status.isSetupComplete) {
    await db
      .update(siteBootstrapStateTable)
      .set({
        setupCompletedByUserId: owner.id,
        setupCompletedAt: formatMysqlDateTime(),
        updatedAt: formatMysqlDateTime(),
      })
      .where(eq(siteBootstrapStateTable.id, 1));
  }
}

export async function autoClaimOwnerIfEligible(input: {
  userId: string;
  email: string | null | undefined;
}): Promise<boolean> {
  if (!input.email) {
    return false;
  }

  const allowedEmails = getConfiguredOwnerEmails();
  if (!allowedEmails.has(normalizeEmail(input.email))) {
    return false;
  }

  await ensureBootstrapStateRow();

  const [ownerRows] = await Promise.all([
    db
      .select({ total: count() })
      .from(usersTable)
      .where(eq(usersTable.role, "owner"))
      .limit(1),
  ]);

  if ((ownerRows[0]?.total ?? 0) > 0) {
    return false;
  }

  const [result] = await mysqlPool.query<ResultSetHeader>(
    `
      UPDATE site_bootstrap_state
      SET
        owner_claimed_by_user_id = ?,
        owner_claimed_at = COALESCE(owner_claimed_at, CURRENT_TIMESTAMP(3)),
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = 1
        AND owner_claimed_by_user_id IS NULL
    `,
    [input.userId],
  );

  const affectedRows = Number(result.affectedRows ?? 0);

  if (affectedRows === 0) {
    return false;
  }

  await db
    .update(usersTable)
    .set({
      role: "owner",
      updatedAt: formatMysqlDateTime(),
    })
    .where(and(eq(usersTable.id, input.userId), eq(usersTable.role, "member")));

  return true;
}

export async function completeBootstrapSetup(userId: string): Promise<BootstrapStatus> {
  const [owner, settings] = await Promise.all([
    loadOwnerUser(),
    loadSiteSettingsRow(),
  ]);

  if (!owner || owner.id !== userId) {
    throw new Error("Only the current owner can complete setup.");
  }

  const checklist = buildChecklist({
    ownerName: owner.name,
    ownerUsername: owner.username,
    siteTitle: settings?.siteTitle,
    heroHeading: settings?.heroHeading,
    heroSubheading: settings?.heroSubheading,
    aboutBody: settings?.aboutBody,
  });

  if (!isChecklistComplete(checklist)) {
    throw new Error("Finish the required owner profile and site identity fields before completing setup.");
  }

  await ensureBootstrapStateRow();
  await db
    .update(siteBootstrapStateTable)
    .set({
      ownerClaimedByUserId: owner.id,
      ownerClaimedAt: formatMysqlDateTime(),
      setupCompletedByUserId: userId,
      setupCompletedAt: formatMysqlDateTime(),
      updatedAt: formatMysqlDateTime(),
    })
    .where(eq(siteBootstrapStateTable.id, 1));

  return loadBootstrapStatus(owner);
}
