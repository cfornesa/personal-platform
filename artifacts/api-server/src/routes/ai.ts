import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  eq,
  and,
  inArray,
  mysqlPool,
  userAiVendorSettingsTable,
  userAiVendorKeysTable,
  usersTable,
} from "@workspace/db";
import {
  GetMyAiSettingsResponse,
  ProcessAiTextBody,
  ProcessAiTextResponse,
  UpdateMyAiSettingsBody,
} from "@workspace/api-zod";
import { requireAuth, requireOwner } from "../middlewares/auth";
import {
  decryptAiApiKey,
  encryptAiApiKey,
  getAiVendorLabel,
  isImageDescriptionVendor,
  isAiVendor,
  isPieceGenerationVendor,
  isTextGenerationVendor,
  normalizeAiProfileInput,
  normalizeOptionalString,
  toSafeAiSettingsResponse,
  validateAiProfileInput,
  type AiVendor,
} from "../lib/ai-settings";
import { fileTypeFromBuffer } from "file-type";
import { stripHtmlToText } from "../lib/html";
import { AiProviderError, AiVisionNotSupportedError, processImageWithProvider, processTextWithProvider } from "../lib/ai-providers";
import { getMediaBuffer } from "../lib/media";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const AI_SYSTEM_PROMPT =
  "Improve the quality and expand this text while maintaining the original author's voice. Respond with properly formatted HTML using tags like <h2>, <h3>, <p>, <strong>, <em>, <ul>, <li> as appropriate. Return only the HTML content, no surrounding explanation or markdown fences.";

const AI_PLAIN_TEXT_SYSTEM_PROMPT =
  "You are improving a description of a visual or interactive artwork. " +
  "If the input contains JSON, comma-separated tags, or technical parameters " +
  "(such as aspect_ratio, resolution, or style tags), extract the key visual " +
  "concepts and rewrite them as a clear, natural English description of what " +
  "the piece looks or feels like. If the input is already natural language prose, " +
  "refine and polish it for clarity. " +
  "Return only the plain text result with no HTML, markdown, JSON, or surrounding explanation.";

const AI_ALT_TEXT_SYSTEM_PROMPT =
  "Generate a concise, descriptive alt text (maximum 125 characters) for an image. Return only the alt text itself, with no punctuation prefix, quotes, or explanation.";
const AI_NO_STORE_CACHE_CONTROL = "no-store, max-age=0";

function setAiNoStoreHeaders(res: Response) {
  res.setHeader("Cache-Control", AI_NO_STORE_CACHE_CONTROL);
}

async function loadUserAiProfiles(userId: string) {
  return db
    .select()
    .from(userAiVendorSettingsTable)
    .where(eq(userAiVendorSettingsTable.userId, userId));
}

async function loadProfileById(userId: string, profileId: number) {
  const rows = await db
    .select()
    .from(userAiVendorSettingsTable)
    .where(and(eq(userAiVendorSettingsTable.id, profileId), eq(userAiVendorSettingsTable.userId, userId)));
  return rows[0] ?? null;
}

async function loadVendorKeyMap(userId: string): Promise<Map<AiVendor, boolean>> {
  const rows = await db
    .select()
    .from(userAiVendorKeysTable)
    .where(eq(userAiVendorKeysTable.userId, userId));
  return new Map(rows.map((r) => [r.vendor as AiVendor, true]));
}

async function loadVendorKey(userId: string, vendor: AiVendor): Promise<string | null> {
  const rows = await db
    .select()
    .from(userAiVendorKeysTable)
    .where(and(eq(userAiVendorKeysTable.userId, userId), eq(userAiVendorKeysTable.vendor, vendor)));
  return rows[0]?.encryptedApiKey ?? null;
}

// GET /users/me/ai-settings
router.get("/users/me/ai-settings", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    setAiNoStoreHeaders(res);
    const [profiles, vendorKeyMap] = await Promise.all([
      loadUserAiProfiles(req.currentUser!.id),
      loadVendorKeyMap(req.currentUser!.id),
    ]);
    const user = req.currentUser!;
    const safeData = toSafeAiSettingsResponse(
      profiles,
      vendorKeyMap,
      user.preferredArtPieceProfileId ?? null,
      user.preferredTextImproveProfileId ?? null,
      user.preferredAltTextProfileId ?? null,
    );
    const parsed = GetMyAiSettingsResponse.safeParse(safeData);
    if (!parsed.success) {
      logger.error({ err: parsed.error, data: JSON.stringify(safeData) }, "AI settings GET: Zod validation failed");
      return res.status(500).json({ error: "Server error" });
    }
    return res.json(parsed.data);
  } catch (err) {
    logger.error({ err }, "AI settings GET: unexpected error");
    return res.status(500).json({ error: "Server error" });
  }
});

// PATCH /users/me/ai-settings
router.patch("/users/me/ai-settings", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    setAiNoStoreHeaders(res);
    const parsed = UpdateMyAiSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request body",
        details: parsed.error.format(),
      });
    }

    const currentUser = req.currentUser!;
    const existingProfiles = await loadUserAiProfiles(currentUser.id);
    const existingById = new Map(existingProfiles.map((row) => [row.id, row]));

    // Save vendor API keys
    for (const keyEntry of parsed.data.vendorKeys ?? []) {
      const vendor = keyEntry.vendor.trim();
      if (!isAiVendor(vendor)) continue;
      const encryptedApiKey = encryptAiApiKey(keyEntry.apiKey);
      await mysqlPool.query(
        `INSERT INTO user_ai_vendor_keys (user_id, vendor, encrypted_api_key, created_at, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE encrypted_api_key = VALUES(encrypted_api_key), updated_at = CURRENT_TIMESTAMP(3)`,
        [currentUser.id, vendor, encryptedApiKey],
      );
    }

    // Load fresh key map after saving vendor keys
    const vendorKeyMap = await loadVendorKeyMap(currentUser.id);

    // Handle profile upserts
    for (const item of parsed.data.profiles ?? []) {
      const normalized = normalizeAiProfileInput(item);
      if (!normalized) {
        return res.status(400).json({ error: `Invalid profile data (vendor "${item.vendor}" not supported)` });
      }

      if (normalized.id !== undefined) {
        const existing = existingById.get(normalized.id);
        if (!existing) {
          return res.status(404).json({ error: `Profile ${normalized.id} not found` });
        }

        const nextEnabled = normalized.enabled ?? (existing.enabled === 1);
        const nextModel = normalized.model ?? normalizeOptionalString(existing.model) ?? null;
        const nextEndpointKind = normalized.endpointKind !== undefined ? normalized.endpointKind : existing.endpointKind;
        const nextProfileName = normalized.profileName;
        const vendorLabel = getAiVendorLabel(normalized.vendor) ?? normalized.vendor;
        const hasVendorKey = vendorKeyMap.get(normalized.vendor) ?? false;

        const validationError = validateAiProfileInput({
          vendorLabel,
          profileName: nextProfileName,
          enabled: nextEnabled,
          hasVendorKey,
          model: nextModel,
        });
        if (validationError) {
          return res.status(400).json({ error: validationError });
        }

        await mysqlPool.query(
          `UPDATE user_ai_vendor_settings
           SET profile_name = ?, endpoint_kind = ?, enabled = ?, model = ?, updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND user_id = ?`,
          [nextProfileName, nextEndpointKind ?? null, nextEnabled ? 1 : 0, nextModel, normalized.id, currentUser.id],
        );
      } else {
        const nextEnabled = normalized.enabled ?? false;
        const nextModel = normalized.model ?? null;
        const nextEndpointKind = normalized.endpointKind ?? null;
        const vendorLabel = getAiVendorLabel(normalized.vendor) ?? normalized.vendor;
        const hasVendorKey = vendorKeyMap.get(normalized.vendor) ?? false;

        const validationError = validateAiProfileInput({
          vendorLabel,
          profileName: normalized.profileName,
          enabled: nextEnabled,
          hasVendorKey,
          model: nextModel,
        });
        if (validationError) {
          return res.status(400).json({ error: validationError });
        }

        await mysqlPool.query(
          `INSERT INTO user_ai_vendor_settings
             (user_id, vendor, profile_name, endpoint_kind, enabled, model, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
          [currentUser.id, normalized.vendor, normalized.profileName, nextEndpointKind, nextEnabled ? 1 : 0, nextModel],
        );
      }
    }

    // Handle deletions
    const deletedIds = parsed.data.deletedProfileIds ?? [];
    if (deletedIds.length > 0) {
      const ownedIds = deletedIds.filter((id) => existingById.has(id));
      if (ownedIds.length > 0) {
        await db
          .delete(userAiVendorSettingsTable)
          .where(and(inArray(userAiVendorSettingsTable.id, ownedIds), eq(userAiVendorSettingsTable.userId, currentUser.id)));
      }
    }

    // Resolve preference updates
    const freshProfiles = await loadUserAiProfiles(currentUser.id);
    const freshById = new Set(freshProfiles.map((r) => r.id));

    const userPrefsUpdate: Partial<{
      preferredArtPieceProfileId: number | null;
      preferredTextImproveProfileId: number | null;
      preferredAltTextProfileId: number | null;
    }> = {};

    if (Object.prototype.hasOwnProperty.call(parsed.data, "preferredArtPieceProfileId")) {
      const id = parsed.data.preferredArtPieceProfileId ?? null;
      if (id !== null) {
        const profile = freshProfiles.find((r) => r.id === id);
        if (!profile) return res.status(400).json({ error: `Profile ${id} not found for art piece preference` });
        if (!isPieceGenerationVendor(profile.vendor)) {
          return res.status(400).json({ error: `Profile ${id} vendor "${profile.vendor}" is not supported for art piece generation` });
        }
      }
      userPrefsUpdate.preferredArtPieceProfileId = id;
    }

    if (Object.prototype.hasOwnProperty.call(parsed.data, "preferredTextImproveProfileId")) {
      const id = parsed.data.preferredTextImproveProfileId ?? null;
      if (id !== null) {
        const profile = freshProfiles.find((r) => r.id === id);
        if (!profile) return res.status(400).json({ error: `Profile ${id} not found for text improve preference` });
        if (!isTextGenerationVendor(profile.vendor)) {
          return res.status(400).json({ error: `Profile ${id} vendor "${profile.vendor}" is not supported for text generation` });
        }
      }
      userPrefsUpdate.preferredTextImproveProfileId = id;
    }

    if (Object.prototype.hasOwnProperty.call(parsed.data, "preferredAltTextProfileId")) {
      const id = parsed.data.preferredAltTextProfileId ?? null;
      if (id !== null) {
        const profile = freshProfiles.find((r) => r.id === id);
        if (!profile) return res.status(400).json({ error: `Profile ${id} not found for alt text preference` });
        if (!isImageDescriptionVendor(profile.vendor)) {
          return res.status(400).json({ error: `Profile ${id} vendor "${profile.vendor}" is not supported for image description` });
        }
      }
      userPrefsUpdate.preferredAltTextProfileId = id;
    }

    // Clear preferences that point to deleted profiles
    const currentPrefs = {
      preferredArtPieceProfileId: currentUser.preferredArtPieceProfileId ?? null,
      preferredTextImproveProfileId: currentUser.preferredTextImproveProfileId ?? null,
      preferredAltTextProfileId: currentUser.preferredAltTextProfileId ?? null,
    };
    if (currentPrefs.preferredArtPieceProfileId !== null && !freshById.has(currentPrefs.preferredArtPieceProfileId)) {
      userPrefsUpdate.preferredArtPieceProfileId = null;
    }
    if (currentPrefs.preferredTextImproveProfileId !== null && !freshById.has(currentPrefs.preferredTextImproveProfileId)) {
      userPrefsUpdate.preferredTextImproveProfileId = null;
    }
    if (currentPrefs.preferredAltTextProfileId !== null && !freshById.has(currentPrefs.preferredAltTextProfileId)) {
      userPrefsUpdate.preferredAltTextProfileId = null;
    }

    if (Object.keys(userPrefsUpdate).length > 0) {
      await db.update(usersTable).set(userPrefsUpdate).where(eq(usersTable.id, currentUser.id));
    }

    const resolvedPrefs = {
      preferredArtPieceProfileId: userPrefsUpdate.preferredArtPieceProfileId ?? currentUser.preferredArtPieceProfileId ?? null,
      preferredTextImproveProfileId: userPrefsUpdate.preferredTextImproveProfileId ?? currentUser.preferredTextImproveProfileId ?? null,
      preferredAltTextProfileId: userPrefsUpdate.preferredAltTextProfileId ?? currentUser.preferredAltTextProfileId ?? null,
    };

    const freshVendorKeyMap = await loadVendorKeyMap(currentUser.id);
    const safeData = toSafeAiSettingsResponse(
      freshProfiles,
      freshVendorKeyMap,
      resolvedPrefs.preferredArtPieceProfileId,
      resolvedPrefs.preferredTextImproveProfileId,
      resolvedPrefs.preferredAltTextProfileId,
    );
    const responseParsed = GetMyAiSettingsResponse.safeParse(safeData);
    if (!responseParsed.success) {
      logger.error({ err: responseParsed.error }, "AI settings PATCH: response Zod validation failed");
      return res.status(500).json({ error: "Server error" });
    }
    return res.json(responseParsed.data);
  } catch (err) {
    logger.error({ err }, "AI settings PATCH: unexpected error");
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /ai/process
router.post("/ai/process", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    setAiNoStoreHeaders(res);
    const parsed = ProcessAiTextBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request body",
        details: parsed.error.format(),
      });
    }

    const userId = req.currentUser!.id;
    const profile = await loadProfileById(userId, parsed.data.profileId);
    if (!profile) {
      return res.status(404).json({ error: "AI profile not found" });
    }

    const model = normalizeOptionalString(profile.model);
    if (profile.enabled !== 1 || !model) {
      return res.status(409).json({
        error: `AI profile "${profile.profileName}" is not enabled and configured`,
      });
    }

    if (!isTextGenerationVendor(profile.vendor)) {
      return res.status(422).json({ error: `Vendor "${profile.vendor}" is not supported for text generation` });
    }

    const encryptedApiKey = await loadVendorKey(userId, profile.vendor as AiVendor);
    if (!encryptedApiKey) {
      return res.status(409).json({
        error: `No API key saved for ${getAiVendorLabel(profile.vendor) ?? profile.vendor}. Add one in Admin → AI.`,
      });
    }

    const isPlainMode = parsed.data.mode === "text";
    const inputText = isPlainMode ? parsed.data.content.trim() : stripHtmlToText(parsed.data.content);
    if (!inputText) {
      return res.status(400).json({ error: "Content must contain visible text" });
    }

    const apiKey = decryptAiApiKey(encryptedApiKey);
    const text = await processTextWithProvider({
      vendor: profile.vendor as AiVendor,
      model,
      apiKey,
      endpointKind: profile.endpointKind,
      plainText: inputText,
      systemPrompt: isPlainMode ? AI_PLAIN_TEXT_SYSTEM_PROMPT : AI_SYSTEM_PROMPT,
    });

    const response = ProcessAiTextResponse.parse({
      text,
      vendor: profile.vendor,
      vendorLabel: getAiVendorLabel(profile.vendor) ?? profile.vendor,
      profileName: profile.profileName,
      model,
    });

    return res.json(response);
  } catch (error) {
    if (error instanceof AiProviderError) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    return res.status(500).json({ error: "Server error" });
  }
});

// POST /ai/describe-image
router.post("/ai/describe-image", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    setAiNoStoreHeaders(res);

    const { imageUrl, profileId, existingAltText } = req.body as {
      imageUrl?: unknown;
      profileId?: unknown;
      existingAltText?: unknown;
    };
    if (typeof imageUrl !== "string" || !imageUrl.trim()) {
      return res.status(400).json({ error: "imageUrl is required" });
    }
    if (typeof profileId !== "number" || !Number.isInteger(profileId)) {
      return res.status(400).json({ error: "profileId is required and must be an integer" });
    }

    const userId = req.currentUser!.id;
    const profile = await loadProfileById(userId, profileId);
    if (!profile) {
      return res.status(404).json({ error: "AI profile not found" });
    }

    if (!isAiVendor(profile.vendor)) {
      return res.status(400).json({ error: `Unsupported AI vendor "${profile.vendor}"` });
    }
    if (!isImageDescriptionVendor(profile.vendor)) {
      return res.status(422).json({
        error: `${getAiVendorLabel(profile.vendor) ?? "Selected AI vendor"} is not supported for image description.`,
        code: "vision_not_supported",
      });
    }

    const model = normalizeOptionalString(profile.model);
    if (profile.enabled !== 1 || !model) {
      return res.status(409).json({
        error: `AI profile "${profile.profileName}" is not enabled and configured`,
      });
    }

    const encryptedApiKey = await loadVendorKey(userId, profile.vendor as AiVendor);
    if (!encryptedApiKey) {
      return res.status(409).json({
        error: `No API key saved for ${getAiVendorLabel(profile.vendor) ?? profile.vendor}. Add one in Admin → AI.`,
      });
    }

    const trimmedUrl = imageUrl.trim();
    const mediaPrefix = "/api/media/";
    if (!trimmedUrl.startsWith(mediaPrefix)) {
      return res.status(400).json({ error: "Only locally uploaded images (/api/media/...) can be described by AI." });
    }
    const filename = trimmedUrl.slice(mediaPrefix.length).split("?")[0] ?? "";
    if (!filename || filename.includes("/") || filename.includes("..")) {
      return res.status(400).json({ error: "Invalid image filename." });
    }

    const fileBuffer = await getMediaBuffer(filename);
    if (!fileBuffer) {
      return res.status(404).json({ error: "Image file not found on server." });
    }

    const fileType = await fileTypeFromBuffer(fileBuffer);
    if (!fileType || !fileType.mime.startsWith("image/")) {
      return res.status(400).json({ error: "File is not a supported image type." });
    }

    const imageBase64 = fileBuffer.toString("base64");
    const imageMimeType = fileType.mime;

    const contextNote =
      typeof existingAltText === "string" && existingAltText.trim()
        ? ` Current description: "${existingAltText.trim()}". Refine or replace it based on the actual image content.`
        : "";

    const apiKey = decryptAiApiKey(encryptedApiKey);
    const altText = await processImageWithProvider({
      vendor: profile.vendor as AiVendor,
      model,
      apiKey,
      endpointKind: profile.endpointKind,
      imageBase64,
      imageMimeType,
      plainText: `Describe this image for use as alt text.${contextNote}`,
      systemPrompt: AI_ALT_TEXT_SYSTEM_PROMPT,
    });

    return res.json({ altText: altText.trim().slice(0, 125) });
  } catch (error) {
    if (error instanceof AiVisionNotSupportedError) {
      return res.status(422).json({ error: error.message, code: "vision_not_supported" });
    }
    if (error instanceof AiProviderError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return res.status(500).json({ error: "Server error" });
  }
});

export { loadVendorKey };
export default router;
