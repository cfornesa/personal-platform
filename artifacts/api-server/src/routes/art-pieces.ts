import { Router, type IRouter, type Request, type Response } from "express";
import {
  artPieceEngineSchema as dbArtPieceEngineSchema,
  artPiecesTable,
  artPieceVersionsTable,
  db,
  desc,
  eq,
  inArray,
  mysqlPool,
  userAiVendorSettingsTable,
  type ArtPiece,
  type ArtPieceVersion,
} from "@workspace/db";
import { z } from "zod/v4";
import { requireAuth, requireOwner } from "../middlewares/auth";
import { loadExhibitMembershipMap } from "../lib/exhibit-memberships";
import {
  ArtPieceGenerationError,
  StructuredArtPieceParseError,
  buildArtPieceRepairPrompt,
  buildInteractivePieceIframeHtml,
  extractCodeBlocks,
  consumeValidatedDraftToken,
  getArtPieceGenerationSystemPrompt,
  getArtPieceGenerationLimits,
  issueValidatedDraftToken,
  parseStructuredArtPieceSpec,
  preflightCompiledArtPieceCode,
  serializeArtPiece,
  serializeArtPieceVersion,
  validateArtPieceEngine,
  validateArtPieceStatus,
} from "../lib/art-pieces";
import {
  decryptAiApiKey,
  getAiVendorLabel,
  isPieceGenerationVendor,
  normalizeOptionalString,
  type AiVendor,
} from "../lib/ai-settings";
import { AiProviderError, processTextWithProvider } from "../lib/ai-providers";
import { isValidArtPieceThumbnailUrl } from "../lib/art-piece-thumbnail-url";

const router: IRouter = Router();

const artPieceEngineSchema = dbArtPieceEngineSchema;
const artPieceStatusSchema = z.enum(["active", "archived"]);
const aiVendorSchema = z.enum(["openrouter", "opencode-zen", "opencode-go", "google", "mistral", "mistral-vibe", "deepseek"]);
const thumbnailUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(isValidArtPieceThumbnailUrl, "Thumbnail URL must be a local media URL or an absolute URL.");

const GenerateArtPieceBody = z.object({
  prompt: z.string().trim().min(1).max(4000),
  engine: artPieceEngineSchema,
  vendor: aiVendorSchema,
});

const CreateArtPieceBody = z.object({
  draftToken: z.string().trim().min(1).max(191).optional(),
  title: z.string().trim().min(1).max(255).optional(),
  prompt: z.string().trim().min(1).max(4000).optional(),
  engine: artPieceEngineSchema.optional(),
  htmlCode: z.string().nullable().optional(),
  cssCode: z.string().nullable().optional(),
  generatedCode: z.string().optional(),
  thumbnailUrl: thumbnailUrlSchema.optional(),
});

const UpdateArtPieceBody = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  prompt: z.string().trim().min(1).max(4000).optional(),
  status: artPieceStatusSchema.optional(),
  thumbnailUrl: thumbnailUrlSchema.nullable().optional(),
  description: z.string().nullable().optional(),
});

const CreateArtPieceVersionBody = z.object({
  draftToken: z.string().trim().min(1).max(191).optional(),
  htmlCode: z.string().nullable().optional(),
  cssCode: z.string().nullable().optional(),
  generatedCode: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(255).optional(),
  prompt: z.string().trim().min(1).max(4000).optional(),
  makeCurrent: z.boolean().optional(),
});

const PieceIdParams = z.object({
  id: z.coerce.number().int().positive(),
});

const PieceEmbedQuery = z.object({
  version: z.coerce.number().int().positive().optional(),
});

async function attachExhibitIds<T extends { id: number }>(
  items: T[],
): Promise<Array<T & { exhibitIds: number[] }>> {
  if (items.length === 0) return items.map((i) => ({ ...i, exhibitIds: [] }));
  const map = await loadExhibitMembershipMap({
    tableName: "piece_exhibits",
    ownerColumn: "art_piece_id",
    ownerIds: items.map((i) => i.id),
  });
  return items.map((i) => ({ ...i, exhibitIds: map.get(i.id) ?? [] }));
}

async function loadOwnerAiSettings(userId: string) {
  return db
    .select()
    .from(userAiVendorSettingsTable)
    .where(eq(userAiVendorSettingsTable.userId, userId));
}

async function loadPiecesWithVersions(ownerUserId: string) {
  const pieces = await db
    .select()
    .from(artPiecesTable)
    .where(eq(artPiecesTable.ownerUserId, ownerUserId))
    .orderBy(desc(artPiecesTable.updatedAt));

  return attachCurrentVersions(pieces);
}

async function attachCurrentVersions(pieces: ArtPiece[]) {
  const versionIds = pieces
    .map((piece) => piece.currentVersionId)
    .filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0);

  if (versionIds.length === 0) {
    return pieces.map((piece) => serializeArtPiece(piece, null));
  }

  const versions = await db
    .select()
    .from(artPieceVersionsTable)
    .where(inArray(artPieceVersionsTable.id, versionIds));
  const byId = new Map(versions.map((version) => [version.id, version] as const));

  return pieces.map((piece) => serializeArtPiece(piece, byId.get(piece.currentVersionId ?? -1) ?? null));
}

async function loadPieceOwnedByUser(id: number, ownerUserId: string) {
  const rows = await db
    .select()
    .from(artPiecesTable)
    .where(eq(artPiecesTable.id, id))
    .limit(1);
  const piece = rows[0] ?? null;
  if (!piece || piece.ownerUserId !== ownerUserId) {
    return null;
  }
  return piece;
}

async function loadVersionById(id: number) {
  const rows = await db
    .select()
    .from(artPieceVersionsTable)
    .where(eq(artPieceVersionsTable.id, id))
    .limit(1);
  return rows[0] ?? null;
}

function createGenerationAbortController(req: Request) {
  const controller = new AbortController();
  const { timeoutMs } = getArtPieceGenerationLimits();
  const timeout = setTimeout(() => controller.abort("timed_out"), timeoutMs);
  const cancel = () => controller.abort("cancelled");

  req.on("aborted", cancel);
  req.on("close", cancel);

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      req.off("aborted", cancel);
      req.off("close", cancel);
    },
  };
}

function throwIfGenerationAborted(signal: AbortSignal, attemptCount: number) {
  if (!signal.aborted) {
    return;
  }

  const reason = signal.reason === "timed_out" ? "timed_out" : "cancelled";
  throw new ArtPieceGenerationError(
    reason === "timed_out"
      ? "Piece generation timed out before a validated draft was produced."
      : "Piece generation was cancelled before a validated draft was produced.",
    {
      statusCode: reason === "timed_out" ? 504 : 499,
      attemptCount,
      timedOut: reason === "timed_out",
      cancelled: reason !== "timed_out",
      failureStage: reason,
    },
  );
}

function classifyGenerationFailureStage(message: string): string {
  if (message.includes("```javascript code block")) {
    return "code_extraction";
  }
  if (message.includes("valid JSON")) {
    return "json_parse";
  }
  if (message.includes("did not match the art piece schema") || message.includes("expected")) {
    return "schema_validation";
  }
  if (message.includes("did not parse")) {
    return "code_parse";
  }
  if (message.includes("server preflight")) {
    return "runtime_preflight";
  }
  if (message.includes("is not enabled and configured")) {
    return "vendor_configuration";
  }
  return "generation_validation";
}

async function generateValidatedDraft(input: {
  ownerUserId: string;
  prompt: string;
  engine: z.infer<typeof artPieceEngineSchema>;
  vendor: z.infer<typeof aiVendorSchema>;
  model: string;
  apiKey: string;
  signal: AbortSignal;
}) {
  const { maxAttempts } = getArtPieceGenerationLimits();
  let attemptCount = 0;
  let previousRawResponse: string | null = null;
  let previousFailureMessage = "The previous attempt did not pass validation.";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfGenerationAborted(input.signal, attemptCount);
    attemptCount = attempt;

    const plainText = attempt === 1
      ? input.prompt
      : buildArtPieceRepairPrompt({
          engine: input.engine,
          originalPrompt: input.prompt,
          previousRawResponse,
          failureMessage: previousFailureMessage,
        });

    try {
      const responseText = await processTextWithProvider({
        vendor: input.vendor as AiVendor,
        model: input.model,
        apiKey: input.apiKey,
        plainText,
        systemPrompt: getArtPieceGenerationSystemPrompt(input.engine),
        intent: "art-piece",
        signal: input.signal,
      });

      previousRawResponse = responseText;
      let { htmlCode, cssCode, generatedCode: rawJsCode } = extractCodeBlocks(responseText);

      // Provide sensible defaults if the AI omitted them
      if (!htmlCode) {
        htmlCode = input.engine === "p5" ? '<div id="canvas-container"></div>' : '<div id="container"></div>';
      }
      if (!cssCode) {
        cssCode = "body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }";
      }

      const generatedCode = preflightCompiledArtPieceCode(input.engine, rawJsCode);

      const draftToken = issueValidatedDraftToken({
        ownerUserId: input.ownerUserId,
        title: input.prompt.slice(0, 80),
        prompt: input.prompt,
        engine: input.engine,
        htmlCode,
        cssCode,
        generatedCode,
        structuredSpec: null,
        notes: null,
        generationVendor: input.vendor,
        generationModel: input.model,
        validationStatus: "validated",
        attemptCount,
        maxAttempts,
        vendorLabel: getAiVendorLabel(input.vendor) ?? input.vendor,
        createdAt: Date.now(),
      });

      return {
        draftToken,
        title: input.prompt.slice(0, 80),
        engine: input.engine,
        htmlCode,
        cssCode,
        generatedCode,
        structuredSpec: null,
        notes: null,
        vendor: input.vendor,
        vendorLabel: getAiVendorLabel(input.vendor) ?? input.vendor,
        model: input.model,
        validationStatus: "validated" as const,
        attemptCount,
        maxAttempts,
        timedOut: false,
        cancelled: false,
        wasRepaired: attemptCount > 1,
      };
    } catch (error) {
      if (input.signal.aborted) {
        throwIfGenerationAborted(input.signal, attemptCount);
      }
      if (error instanceof AiProviderError && attemptCount >= maxAttempts) {
        throw new ArtPieceGenerationError(error.message, {
          statusCode: error.statusCode,
          attemptCount,
          maxAttempts,
          engine: input.engine,
          failureStage: "provider_request",
          rawResponsePreview: error.rawResponsePreview?.slice(0, 600) ?? previousRawResponse?.slice(0, 600) ?? null,
        });
      }

      previousFailureMessage = error instanceof Error
        ? error.message
        : "The generated draft did not pass validation.";

      const failureStage = classifyGenerationFailureStage(previousFailureMessage);
      const parseError = error instanceof StructuredArtPieceParseError ? error : null;
      console.warn("Art piece generation attempt failed", {
        engine: input.engine,
        vendor: input.vendor,
        model: input.model,
        attemptCount,
        maxAttempts,
        failureStage,
        failureMessage: previousFailureMessage,
        rawResponsePreview: previousRawResponse?.slice(0, 600) ?? null,
        normalizedResponsePreview: parseError?.normalizedResponse?.slice(0, 600) ?? null,
        normalizationApplied: parseError?.normalizationApplied ?? false,
        normalizationSummary: parseError?.normalizationSummary ?? null,
        issuePath: parseError?.issuePath ?? [],
        entityType: parseError?.entityType ?? null,
      });

      if (attemptCount >= maxAttempts) {
        throw new ArtPieceGenerationError(previousFailureMessage, {
          statusCode: 422,
          attemptCount,
          maxAttempts,
          engine: input.engine,
          failureStage,
          rawResponsePreview: previousRawResponse?.slice(0, 600) ?? null,
        });
      }
    }
  }

  throw new ArtPieceGenerationError("Piece generation exhausted its attempt budget.", {
    statusCode: 422,
    attemptCount: maxAttempts,
    maxAttempts,
    engine: input.engine,
    failureStage: "attempt_budget_exhausted",
    rawResponsePreview: previousRawResponse?.slice(0, 600) ?? null,
  });
}

router.get("/art-pieces", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const serialized = await loadPiecesWithVersions(req.currentUser!.id);
    const pieces = await attachExhibitIds(serialized);
    return res.json({ pieces });
  } catch (error) {
    console.error("Failed to list art pieces:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/art-pieces/:id", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const params = PieceIdParams.safeParse(req.params);
    if (!params.success) {
      return res.status(404).json({ error: "Not found" });
    }

    const piece = await loadPieceOwnedByUser(params.data.id, req.currentUser!.id);
    if (!piece) {
      return res.status(404).json({ error: "Not found" });
    }
    const currentVersion = piece.currentVersionId ? await loadVersionById(piece.currentVersionId) : null;
    const versions = await db
      .select()
      .from(artPieceVersionsTable)
      .where(eq(artPieceVersionsTable.artPieceId, piece.id))
      .orderBy(desc(artPieceVersionsTable.createdAt));

    const [withGalleries] = await attachExhibitIds([serializeArtPiece(piece, currentVersion)]);
    return res.json({
      ...withGalleries,
      versions: versions.map(serializeArtPieceVersion),
    });
  } catch (error) {
    console.error("Failed to get art piece:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/art-pieces/:id", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const params = PieceIdParams.safeParse(req.params);
    if (!params.success) {
      return res.status(404).json({ error: "Not found" });
    }

    const pieceRows = await db
      .select()
      .from(artPiecesTable)
      .where(eq(artPiecesTable.id, params.data.id))
      .limit(1);
    const piece = pieceRows[0] ?? null;
    if (!piece) {
      return res.status(404).json({ error: "Not found" });
    }
    if (piece.ownerUserId !== req.currentUser!.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await db.delete(artPiecesTable).where(eq(artPiecesTable.id, params.data.id));
    return res.status(204).send();
  } catch (err) {
    return res.status(400).json({ error: "Invalid request" });
  }
});

router.get("/art-pieces/:id/embed", async (req: Request, res: Response) => {
  try {
    const params = PieceIdParams.safeParse(req.params);
    const query = PieceEmbedQuery.safeParse(req.query);
    if (!params.success || !query.success) {
      return res.status(404).json({ error: "Not found" });
    }

    const pieceRows = await db
      .select()
      .from(artPiecesTable)
      .where(eq(artPiecesTable.id, params.data.id))
      .limit(1);
    const piece = pieceRows[0] ?? null;
    if (!piece) {
      return res.status(404).json({ error: "Not found" });
    }

    const versionId = query.data.version ?? piece.currentVersionId;
    if (!versionId) {
      return res.status(404).json({ error: "Not found" });
    }

    const version = await loadVersionById(versionId);
    if (!version || version.artPieceId !== piece.id) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json({
      id: piece.id,
      title: piece.title,
      engine: piece.engine,
      version: serializeArtPieceVersion(version),
    });
  } catch (error) {
    console.error("Failed to get embed art piece:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/art-pieces/generate", requireAuth, requireOwner, async (req: Request, res: Response) => {
  const generation = createGenerationAbortController(req);

  try {
    const parsed = GenerateArtPieceBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request body",
        details: parsed.error.format(),
      });
    }

    const rows = await loadOwnerAiSettings(req.currentUser!.id);
    const selected = rows.find((row) => row.vendor === parsed.data.vendor);
    const model = normalizeOptionalString(selected?.model);
    const encryptedApiKey = normalizeOptionalString(selected?.encryptedApiKey);

    if (selected?.enabled !== 1 || !model || !encryptedApiKey) {
      return res.status(409).json({
        error: `${getAiVendorLabel(parsed.data.vendor) ?? "Selected AI vendor"} is not enabled and configured for this user`,
      });
    }

    if (!isPieceGenerationVendor(parsed.data.vendor)) {
      return res.status(422).json({
        error: `${getAiVendorLabel(parsed.data.vendor) ?? "Selected AI vendor"} is not supported for piece generation. Use Google, Mistral AI, Mistral Vibe, or DeepSeek.`,
      });
    }

    const apiKey = decryptAiApiKey(encryptedApiKey);
    const draft = await generateValidatedDraft({
      ownerUserId: req.currentUser!.id,
      prompt: parsed.data.prompt,
      engine: parsed.data.engine,
      vendor: parsed.data.vendor,
      model,
      apiKey,
      signal: generation.signal,
    });

    return res.json(draft);
  } catch (error) {
    if (error instanceof ArtPieceGenerationError) {
      return res.status(error.statusCode).json({
        error: error.message,
        engine: error.engine,
        failureStage: error.failureStage,
        rawResponsePreview: error.rawResponsePreview,
        attemptCount: error.attemptCount,
        maxAttempts: error.maxAttempts,
        timedOut: error.timedOut,
        cancelled: error.cancelled,
      });
    }
    if (error instanceof AiProviderError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    if (error instanceof Error) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: "Server error" });
  } finally {
    generation.cleanup();
  }
});

router.post("/art-pieces", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const parsed = CreateArtPieceBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request body",
        details: parsed.error.format(),
      });
    }

    let draftPrompt = "";
    let draftHtmlCode: string | null = null;
    let draftCssCode: string | null = null;
    let draftGeneratedCode = "";
    let draftStructuredSpec: string | null = null;
    let draftVendor: string | null = null;
    let draftModel: string | null = null;
    let draftAttemptCount = 1;
    let draftNotes: string | null = null;
    let engine: "p5" | "c2" | "three" = "p5";
    let draftTitle = "";

    if (parsed.data.draftToken) {
      const draft = consumeValidatedDraftToken(parsed.data.draftToken, req.currentUser!.id);
      if (!draft) {
        return res.status(409).json({
          error: "This validated draft is no longer available. Generate the piece again before saving.",
        });
      }
      const validatedEngine = validateArtPieceEngine(draft.engine);
      if (!validatedEngine) {
        return res.status(400).json({ error: "Unsupported art piece engine" });
      }
      engine = validatedEngine;
      draftPrompt = draft.prompt;
      draftHtmlCode = draft.htmlCode;
      draftCssCode = draft.cssCode;
      draftGeneratedCode = draft.generatedCode;
      draftStructuredSpec = draft.structuredSpec ? JSON.stringify(draft.structuredSpec) : null;
      draftVendor = draft.generationVendor;
      draftModel = draft.generationModel;
      draftAttemptCount = draft.attemptCount;
      draftNotes = draft.notes;
      draftTitle = draft.title;
    } else {
      // Manual creation
      if (!parsed.data.engine) {
        return res.status(400).json({ error: "Engine is required for manual piece creation" });
      }
      const manualEngine = validateArtPieceEngine(parsed.data.engine);
      if (!manualEngine) {
        return res.status(400).json({ error: "Invalid engine provided" });
      }
      if (!parsed.data.generatedCode) {
        return res.status(400).json({ error: "JavaScript code is required for manual piece creation" });
      }
      engine = manualEngine;
      draftPrompt = parsed.data.prompt || "";
      draftHtmlCode = parsed.data.htmlCode || null;
      draftCssCode = parsed.data.cssCode || null;
      draftGeneratedCode = preflightCompiledArtPieceCode(engine, parsed.data.generatedCode);
      draftTitle = parsed.data.title || "Untitled Piece";
    }

    const now = new Date().toISOString().slice(0, 23).replace("T", " ");

    const insertPiece = await db
      .insert(artPiecesTable)
      .values({
        ownerUserId: req.currentUser!.id,
        title: parsed.data.title || draftTitle,
        prompt: draftPrompt,
        engine,
        status: "active",
        thumbnailUrl: parsed.data.thumbnailUrl,
        createdAt: now,
        updatedAt: now,
      })
      .$returningId();

    const pieceId = insertPiece[0]?.id;
    if (!pieceId) {
      return res.status(500).json({ error: "Failed to create art piece" });
    }

    const insertVersion = await db
      .insert(artPieceVersionsTable)
      .values({
        artPieceId: pieceId,
        prompt: draftPrompt,
        structuredSpec: draftStructuredSpec,
        htmlCode: draftHtmlCode,
        cssCode: draftCssCode,
        generatedCode: draftGeneratedCode,
        engine,
        generationVendor: draftVendor,
        generationModel: draftModel,
        validationStatus: "validated",
        generationAttemptCount: draftAttemptCount,
        notes: draftNotes,
      })
      .$returningId();
    const versionId = insertVersion[0]?.id;

    if (!versionId) {
      return res.status(500).json({ error: "Failed to create art piece version" });
    }

    await mysqlPool.query(
      `UPDATE art_pieces
          SET current_version_id = ?, updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?`,
      [versionId, pieceId],
    );

    const piece = await loadPieceOwnedByUser(pieceId, req.currentUser!.id);
    const version = await loadVersionById(versionId);
    if (!piece || !version) {
      return res.status(500).json({ error: "Failed to load created art piece" });
    }

    return res.status(201).json({
      ...serializeArtPiece(piece, version),
      iframeHtml: buildInteractivePieceIframeHtml({
        origin: `${req.protocol}://${req.get("host") ?? ""}`,
        pieceId,
        versionId,
        title: piece.title,
      }),
    });
  } catch (error) {
    if (error instanceof Error) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: "Server error" });
  }
});

router.patch("/art-pieces/:id", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const params = PieceIdParams.safeParse(req.params);
    const parsed = UpdateArtPieceBody.safeParse(req.body);
    if (!params.success) {
      return res.status(404).json({ error: "Not found" });
    }
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request body",
        details: parsed.error.format(),
      });
    }

    const piece = await loadPieceOwnedByUser(params.data.id, req.currentUser!.id);
    if (!piece) {
      return res.status(404).json({ error: "Not found" });
    }

    const updates: Partial<ArtPiece> = {};
    if (typeof parsed.data.title === "string") {
      updates.title = parsed.data.title;
    }
    if (typeof parsed.data.prompt === "string") {
      updates.prompt = parsed.data.prompt;
    }
    if (typeof parsed.data.status === "string") {
      const status = validateArtPieceStatus(parsed.data.status);
      if (!status) {
        return res.status(400).json({ error: "Unsupported art piece status" });
      }
      updates.status = status;
    }
    if (Object.prototype.hasOwnProperty.call(parsed.data, "thumbnailUrl")) {
      updates.thumbnailUrl = parsed.data.thumbnailUrl ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(parsed.data, "description")) {
      updates.description = parsed.data.description ?? null;
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date().toISOString().slice(0, 23).replace("T", " ");
      await db.update(artPiecesTable).set(updates).where(eq(artPiecesTable.id, piece.id));
    }

    const nextPiece = await loadPieceOwnedByUser(piece.id, req.currentUser!.id);
    const currentVersion = nextPiece?.currentVersionId ? await loadVersionById(nextPiece.currentVersionId) : null;
    if (!nextPiece) {
      return res.status(404).json({ error: "Not found" });
    }
    return res.json(serializeArtPiece(nextPiece, currentVersion));
  } catch (error) {
    console.error("Failed to update art piece:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/art-pieces/:id/versions", requireAuth, requireOwner, async (req: Request, res: Response) => {
  try {
    const params = PieceIdParams.safeParse(req.params);
    const parsed = CreateArtPieceVersionBody.safeParse(req.body);
    if (!params.success) {
      return res.status(404).json({ error: "Not found" });
    }
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request body",
        details: parsed.error.format(),
      });
    }

    const piece = await loadPieceOwnedByUser(params.data.id, req.currentUser!.id);
    if (!piece) {
      return res.status(404).json({ error: "Not found" });
    }

    let draftPrompt = "";
    let draftHtmlCode: string | null = null;
    let draftCssCode: string | null = null;
    let draftGeneratedCode = "";
    let draftStructuredSpec: string | null = null;
    let draftVendor: string | null = null;
    let draftModel: string | null = null;
    let draftAttemptCount = 1;
    let draftNotes: string | null = null;
    let engine = validateArtPieceEngine(piece.engine) || "p5";

    if (parsed.data.draftToken) {
      const draft = consumeValidatedDraftToken(parsed.data.draftToken, req.currentUser!.id);
      if (!draft) {
        return res.status(409).json({
          error: "This validated draft is no longer available. Generate the piece again before saving.",
        });
      }
      const validatedEngine = validateArtPieceEngine(draft.engine);
      if (!validatedEngine) {
        return res.status(400).json({ error: "Unsupported art piece engine" });
      }
      engine = validatedEngine;
      draftPrompt = draft.prompt;
      draftHtmlCode = draft.htmlCode;
      draftCssCode = draft.cssCode;
      draftGeneratedCode = draft.generatedCode;
      draftStructuredSpec = draft.structuredSpec ? JSON.stringify(draft.structuredSpec) : null;
      draftVendor = draft.generationVendor;
      draftModel = draft.generationModel;
      draftAttemptCount = draft.attemptCount;
      draftNotes = draft.notes;
    } else if (parsed.data.generatedCode) {
      // Manual save
      draftGeneratedCode = preflightCompiledArtPieceCode(engine, parsed.data.generatedCode);
      draftHtmlCode = parsed.data.htmlCode || null;
      draftCssCode = parsed.data.cssCode || null;
      draftPrompt = piece.prompt;
    } else {
      return res.status(400).json({ error: "Either draftToken or generatedCode must be provided." });
    }

    const versionInsert = await db
      .insert(artPieceVersionsTable)
      .values({
        artPieceId: piece.id,
        prompt: draftPrompt,
        structuredSpec: draftStructuredSpec,
        htmlCode: draftHtmlCode,
        cssCode: draftCssCode,
        generatedCode: draftGeneratedCode,
        engine,
        generationVendor: draftVendor,
        generationModel: draftModel,
        validationStatus: "validated",
        generationAttemptCount: draftAttemptCount,
        notes: draftNotes,
      })
      .$returningId();

    const versionId = versionInsert[0]?.id;
    if (!versionId) {
      return res.status(500).json({ error: "Failed to create art piece version" });
    }

    const shouldMakeCurrent = parsed.data.makeCurrent !== false;
    const updates: Partial<ArtPiece> = {
      updatedAt: new Date().toISOString().slice(0, 23).replace("T", " "),
    };
    if (typeof parsed.data.title === "string") {
      updates.title = parsed.data.title;
    }
    if (typeof parsed.data.prompt === "string") {
      updates.prompt = parsed.data.prompt;
    }
    if (shouldMakeCurrent) {
      updates.currentVersionId = versionId;
      updates.engine = engine;
    }

    await db.update(artPiecesTable).set(updates).where(eq(artPiecesTable.id, piece.id));

    const version = await loadVersionById(versionId);
    const nextPiece = await loadPieceOwnedByUser(piece.id, req.currentUser!.id);
    if (!version || !nextPiece) {
      return res.status(500).json({ error: "Failed to load saved art piece version" });
    }

    return res.status(201).json({
      piece: serializeArtPiece(
        nextPiece,
        nextPiece.currentVersionId ? await loadVersionById(nextPiece.currentVersionId) : null,
      ),
      version: serializeArtPieceVersion(version),
      iframeHtml: buildInteractivePieceIframeHtml({
        origin: `${req.protocol}://${req.get("host") ?? ""}`,
        pieceId: nextPiece.id,
        versionId: version.id,
        title: nextPiece.title,
      }),
    });
  } catch (error) {
    if (error instanceof Error) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
