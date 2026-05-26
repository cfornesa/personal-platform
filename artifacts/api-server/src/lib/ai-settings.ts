import type { UserAiVendorSettings } from "@workspace/db";
import { encryptSecret, decryptSecret } from "./crypto";

export const AI_VENDOR_OPTIONS = [
  { id: "openrouter", label: "OpenRouter" },
  { id: "opencode-zen", label: "Opencode Zen" },
  { id: "opencode-go", label: "Opencode Go" },
  { id: "google", label: "Google" },
  { id: "mistral", label: "Mistral AI" },
  { id: "mistral-vibe", label: "Mistral Vibe" },
  { id: "deepseek", label: "DeepSeek" },
] as const;

export type AiVendor = (typeof AI_VENDOR_OPTIONS)[number]["id"];

export const TEXT_GENERATION_VENDORS = [
  "openrouter",
  "opencode-zen",
  "opencode-go",
  "google",
  "mistral",
  "mistral-vibe",
  "deepseek",
] as const;
export type TextGenerationVendor = (typeof TEXT_GENERATION_VENDORS)[number];

export const IMAGE_DESCRIPTION_VENDORS = [
  "openrouter",
  "opencode-zen",
  "opencode-go",
  "google",
  "mistral",
  "mistral-vibe",
] as const;
export type ImageDescriptionVendor = (typeof IMAGE_DESCRIPTION_VENDORS)[number];

export const PIECE_GENERATION_VENDORS = ["google", "mistral", "mistral-vibe", "deepseek"] as const;
export type PieceGenerationVendor = (typeof PIECE_GENERATION_VENDORS)[number];

export function isTextGenerationVendor(vendor: string): vendor is TextGenerationVendor {
  return (TEXT_GENERATION_VENDORS as readonly string[]).includes(vendor);
}

export function isPieceGenerationVendor(vendor: string): vendor is PieceGenerationVendor {
  return (PIECE_GENERATION_VENDORS as readonly string[]).includes(vendor);
}

export function isImageDescriptionVendor(vendor: string): vendor is ImageDescriptionVendor {
  return (IMAGE_DESCRIPTION_VENDORS as readonly string[]).includes(vendor);
}

export type SafeAiVendorSetting = {
  vendor: AiVendor;
  vendorLabel: string;
  enabled: boolean;
  configured: boolean;
  model: string | null;
};

export type SafeAiSettingsResponse = {
  availableVendors: readonly { id: AiVendor; label: string }[];
  settings: SafeAiVendorSetting[];
  preferredArtPieceVendor: AiVendor | null;
  preferredVendorTextImprove: AiVendor | null;
  preferredVendorAltText: AiVendor | null;
};

export type NormalizedAiVendorSettingsInput = {
  vendor: AiVendor;
  enabled?: boolean;
  model?: string;
  apiKey?: string;
};

export function isAiVendor(value: string): value is AiVendor {
  return AI_VENDOR_OPTIONS.some((option) => option.id === value);
}

export function getAiVendorLabel(vendor: string | null | undefined): string | null {
  if (!vendor || !isAiVendor(vendor)) {
    return null;
  }

  return AI_VENDOR_OPTIONS.find((option) => option.id === vendor)?.label ?? null;
}

export function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeAiVendorSettingsInput(input: {
  vendor: string;
  enabled?: boolean;
  model?: string;
  apiKey?: string;
}): NormalizedAiVendorSettingsInput | null {
  const vendor = input.vendor.trim();
  if (!isAiVendor(vendor)) {
    return null;
  }

  const normalized: NormalizedAiVendorSettingsInput = { vendor };

  if (typeof input.enabled === "boolean") {
    normalized.enabled = input.enabled;
  }

  const model = normalizeOptionalString(input.model);
  if (model) {
    normalized.model = model;
  }

  const apiKey = normalizeOptionalString(input.apiKey);
  if (apiKey) {
    normalized.apiKey = apiKey;
  }

  return normalized;
}

export function validateAiVendorSettingsInput(input: {
  vendorLabel: string;
  enabled: boolean;
  model: string | null;
  encryptedApiKey: string | null;
}): string | null {
  if (!input.enabled) {
    return null;
  }
  if (!input.model) {
    return `${input.vendorLabel} requires a model before it can be enabled`;
  }
  if (!input.encryptedApiKey) {
    return `${input.vendorLabel} requires an API key before it can be enabled`;
  }
  return null;
}

function normalizePreferredVendor(value?: string | null): AiVendor | null {
  return typeof value === "string" && isAiVendor(value) ? value : null;
}

export function toSafeAiSettingsResponse(
  rows: Array<Pick<UserAiVendorSettings, "vendor" | "enabled" | "model" | "encryptedApiKey">>,
  preferredArtPieceVendor?: string | null,
  preferredVendorTextImprove?: string | null,
  preferredVendorAltText?: string | null,
): SafeAiSettingsResponse {
  const byVendor = new Map<string, Pick<UserAiVendorSettings, "vendor" | "enabled" | "model" | "encryptedApiKey">>();
  for (const row of rows) {
    byVendor.set(row.vendor, row);
  }

  return {
    availableVendors: AI_VENDOR_OPTIONS,
    settings: AI_VENDOR_OPTIONS.map((option) => {
      const row = byVendor.get(option.id);
      const model = normalizeOptionalString(row?.model);
      const enabled = row?.enabled === 1;
      const configured = Boolean(model && normalizeOptionalString(row?.encryptedApiKey));

      return {
        vendor: option.id,
        vendorLabel: option.label,
        enabled,
        configured,
        model,
      };
    }),
    preferredArtPieceVendor: normalizePreferredVendor(preferredArtPieceVendor),
    preferredVendorTextImprove: normalizePreferredVendor(preferredVendorTextImprove),
    preferredVendorAltText: normalizePreferredVendor(preferredVendorAltText),
  };
}

export function encryptAiApiKey(apiKey: string): string {
  return encryptSecret(apiKey);
}

export function decryptAiApiKey(payload: string): string {
  return decryptSecret(payload);
}
