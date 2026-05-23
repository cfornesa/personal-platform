import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  eq,
  mysqlPool,
  userAiVendorSettingsTable,
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
  isAiVendor,
  normalizeAiVendorSettingsInput,
  normalizeOptionalString,
  toSafeAiSettingsResponse,
  validateAiVendorSettingsInput,
  type AiVendor,
} from "../lib/ai-settings";
import { fileTypeFromBuffer } from "file-type";
import { stripHtmlToText } from "../lib/html";
import { AiProviderError, AiVisionNotSupportedError, processImageWithProvider, processTextWithProvider } from "../lib/ai-providers";
import { getMediaBuffer } from "../lib/media";

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

async function loadUserAiSettings(userId: string) {
  return db
    .select()
    .from(userAiVendorSettingsTable)
    .where(eq(userAiVendorSettingsTable.userId, userId));
}

function indexRowsByVendor(
  rows: Awaited<ReturnType<typeof loadUserAiSettings>>,
) {
  return new Map(rows.map((row) => [row.vendor, row] as const));
}

// GET /users/me/ai-settings
router.get("/users/me/ai-settings", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    setAiNoStoreHeaders(res);
    const rows = await loadUserAiSettings(req.currentUser!.id);
    const user = req.currentUser!;
    const response = GetMyAiSettingsResponse.parse(
      toSafeAiSettingsResponse(rows, user.preferredArtPieceVendor, user.preferredVendorTextImprove, user.preferredVendorAltText),
    );
    return res.json(response);
  } catch {
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
    const existingRows = await loadUserAiSettings(currentUser.id);
    const existingByVendor = indexRowsByVendor(existingRows);
    let preferredArtPieceVendor = currentUser.preferredArtPieceVendor ?? null;
    let preferredVendorTextImprove = currentUser.preferredVendorTextImprove ?? null;
    let preferredVendorAltText = currentUser.preferredVendorAltText ?? null;

    const userPrefsUpdate: Partial<{ preferredArtPieceVendor: string | null; preferredVendorTextImprove: string | null; preferredVendorAltText: string | null }> = {};

    if (Object.prototype.hasOwnProperty.call(parsed.data, "preferredArtPieceVendor")) {
      const requested = parsed.data.preferredArtPieceVendor;
      if (typeof requested === "string" && !isAiVendor(requested)) {
        return res.status(400).json({ error: `Unsupported AI vendor "${requested}"` });
      }
      preferredArtPieceVendor = requested ?? null;
      userPrefsUpdate.preferredArtPieceVendor = preferredArtPieceVendor;
    }

    if (Object.prototype.hasOwnProperty.call(parsed.data, "preferredVendorTextImprove")) {
      const requested = (parsed.data as { preferredVendorTextImprove?: string | null }).preferredVendorTextImprove;
      if (typeof requested === "string" && !isAiVendor(requested)) {
        return res.status(400).json({ error: `Unsupported AI vendor "${requested}"` });
      }
      preferredVendorTextImprove = requested ?? null;
      userPrefsUpdate.preferredVendorTextImprove = preferredVendorTextImprove;
    }

    if (Object.prototype.hasOwnProperty.call(parsed.data, "preferredVendorAltText")) {
      const requested = (parsed.data as { preferredVendorAltText?: string | null }).preferredVendorAltText;
      if (typeof requested === "string" && !isAiVendor(requested)) {
        return res.status(400).json({ error: `Unsupported AI vendor "${requested}"` });
      }
      preferredVendorAltText = requested ?? null;
      userPrefsUpdate.preferredVendorAltText = preferredVendorAltText;
    }

    if (Object.keys(userPrefsUpdate).length > 0) {
      await db
        .update(usersTable)
        .set(userPrefsUpdate)
        .where(eq(usersTable.id, currentUser.id));
    }

    for (const item of parsed.data.settings) {
      const normalized = normalizeAiVendorSettingsInput(item);
      if (!normalized) {
        return res.status(400).json({ error: `Unsupported AI vendor "${item.vendor}"` });
      }

      const existing = existingByVendor.get(normalized.vendor);
      const nextEnabled = normalized.enabled ?? (existing?.enabled === 1);
      const nextModel = normalized.model ?? normalizeOptionalString(existing?.model) ?? null;
      const nextEncryptedApiKey = normalized.apiKey
        ? encryptAiApiKey(normalized.apiKey)
        : normalizeOptionalString(existing?.encryptedApiKey) ?? null;
      const vendorLabel = getAiVendorLabel(normalized.vendor) ?? normalized.vendor;

      const validationError = validateAiVendorSettingsInput({
        vendorLabel,
        enabled: nextEnabled,
        model: nextModel,
        encryptedApiKey: nextEncryptedApiKey,
      });

      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      await mysqlPool.query(
        `INSERT INTO user_ai_vendor_settings
           (user_id, vendor, enabled, model, encrypted_api_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
           enabled = VALUES(enabled),
           model = VALUES(model),
           encrypted_api_key = VALUES(encrypted_api_key),
           updated_at = CURRENT_TIMESTAMP(3)`,
        [
          currentUser.id,
          normalized.vendor,
          nextEnabled ? 1 : 0,
          nextModel,
          nextEncryptedApiKey,
        ],
      );
    }

    const rows = await loadUserAiSettings(currentUser.id);
    const response = GetMyAiSettingsResponse.parse(
      toSafeAiSettingsResponse(rows, preferredArtPieceVendor, preferredVendorTextImprove, preferredVendorAltText),
    );
    return res.json(response);
  } catch {
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

    const rows = await loadUserAiSettings(req.currentUser!.id);
    const selected = rows.find((row) => row.vendor === parsed.data.vendor);
    const model = normalizeOptionalString(selected?.model);
    const encryptedApiKey = normalizeOptionalString(selected?.encryptedApiKey);

    if (selected?.enabled !== 1 || !model || !encryptedApiKey) {
      return res.status(409).json({
        error: `${getAiVendorLabel(parsed.data.vendor) ?? "Selected AI vendor"} is not enabled and configured for this user`,
      });
    }

    const isPlainMode = parsed.data.mode === "text";
    const inputText = isPlainMode ? parsed.data.content.trim() : stripHtmlToText(parsed.data.content);
    if (!inputText) {
      return res.status(400).json({ error: "Content must contain visible text" });
    }

    const apiKey = decryptAiApiKey(encryptedApiKey);
    const text = await processTextWithProvider({
      vendor: parsed.data.vendor as AiVendor,
      model,
      apiKey,
      plainText: inputText,
      systemPrompt: isPlainMode ? AI_PLAIN_TEXT_SYSTEM_PROMPT : AI_SYSTEM_PROMPT,
    });

    const response = ProcessAiTextResponse.parse({
      text,
      vendor: parsed.data.vendor,
      vendorLabel: getAiVendorLabel(parsed.data.vendor) ?? parsed.data.vendor,
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

    const { imageUrl, vendor, existingAltText } = req.body as {
      imageUrl?: unknown;
      vendor?: unknown;
      existingAltText?: unknown;
    };
    if (typeof imageUrl !== "string" || !imageUrl.trim()) {
      return res.status(400).json({ error: "imageUrl is required" });
    }
    if (typeof vendor !== "string" || !vendor.trim()) {
      return res.status(400).json({ error: "vendor is required" });
    }

    const rows = await loadUserAiSettings(req.currentUser!.id);
    const selected = rows.find((row) => row.vendor === vendor);
    const model = normalizeOptionalString(selected?.model);
    const encryptedApiKey = normalizeOptionalString(selected?.encryptedApiKey);

    if (selected?.enabled !== 1 || !model || !encryptedApiKey) {
      return res.status(409).json({
        error: `${getAiVendorLabel(vendor) ?? "Selected AI vendor"} is not enabled and configured for this user`,
      });
    }

    // Read image from filesystem (only local /api/media/ URLs are supported)
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
      vendor: vendor as AiVendor,
      model,
      apiKey,
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

export default router;
