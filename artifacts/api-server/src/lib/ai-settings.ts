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

export const PIECE_GENERATION_VENDORS = ["opencode-zen", "opencode-go", "google", "mistral", "mistral-vibe", "deepseek"] as const;
export type PieceGenerationVendor = (typeof PIECE_GENERATION_VENDORS)[number];

export const ENDPOINT_KIND_OPTIONS = [
  { id: "chat-completions", label: "OpenAI Chat Completions" },
  { id: "anthropic-messages", label: "Anthropic Messages" },
  { id: "openai-responses", label: "OpenAI Responses" },
  { id: "google-generate", label: "Google Generate Content" },
] as const;
export type EndpointKind = (typeof ENDPOINT_KIND_OPTIONS)[number]["id"];

export const OPENCODE_GO_ENDPOINT_KINDS: readonly EndpointKind[] = ["chat-completions", "anthropic-messages"];
export const OPENCODE_ZEN_ENDPOINT_KINDS: readonly EndpointKind[] = ["chat-completions", "openai-responses", "anthropic-messages", "google-generate"];

export function isTextGenerationVendor(vendor: string): vendor is TextGenerationVendor {
  return (TEXT_GENERATION_VENDORS as readonly string[]).includes(vendor);
}

export function isPieceGenerationVendor(vendor: string): vendor is PieceGenerationVendor {
  return (PIECE_GENERATION_VENDORS as readonly string[]).includes(vendor);
}

export function isImageDescriptionVendor(vendor: string): vendor is ImageDescriptionVendor {
  return (IMAGE_DESCRIPTION_VENDORS as readonly string[]).includes(vendor);
}

export type SafeVendorKey = {
  vendor: AiVendor;
  vendorLabel: string;
  hasKey: boolean;
};

export type SafeAiVendorProfile = {
  id: number;
  vendor: AiVendor;
  vendorLabel: string;
  profileName: string;
  enabled: boolean;
  configured: boolean; // vendor has a key AND profile has a model
  model: string | null;
  endpointKind: string | null;
};

export type SafeAiSettingsResponse = {
  availableVendors: readonly { id: AiVendor; label: string }[];
  vendorKeys: SafeVendorKey[];
  profiles: SafeAiVendorProfile[];
  preferredArtPieceProfileId: number | null;
  preferredTextImproveProfileId: number | null;
  preferredAltTextProfileId: number | null;
};

export type NormalizedAiProfileInput = {
  id?: number;
  vendor: AiVendor;
  profileName: string;
  enabled?: boolean;
  model?: string;
  endpointKind?: string | null;
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

export function normalizeAiProfileInput(input: {
  id?: number;
  vendor: string;
  profileName: string;
  enabled?: boolean;
  model?: string;
  endpointKind?: string | null;
}): NormalizedAiProfileInput | null {
  const vendor = input.vendor.trim();
  if (!isAiVendor(vendor)) {
    return null;
  }

  const profileName = normalizeOptionalString(input.profileName);
  if (!profileName) {
    return null;
  }

  const normalized: NormalizedAiProfileInput = { vendor, profileName };

  if (typeof input.id === "number") {
    normalized.id = input.id;
  }

  if (typeof input.enabled === "boolean") {
    normalized.enabled = input.enabled;
  }

  const model = normalizeOptionalString(input.model);
  if (model) {
    normalized.model = model;
  }

  const endpointKind = normalizeOptionalString(input.endpointKind);
  normalized.endpointKind = endpointKind;

  return normalized;
}

export function validateAiProfileInput(input: {
  vendorLabel: string;
  profileName: string;
  enabled: boolean;
  hasVendorKey: boolean;
  model: string | null;
}): string | null {
  if (!input.enabled) {
    return null;
  }
  if (!input.model) {
    return `${input.vendorLabel} profile "${input.profileName}" requires a model before it can be enabled`;
  }
  if (!input.hasVendorKey) {
    return `${input.vendorLabel} requires an API key. Add one in the "AI API Keys" section above.`;
  }
  return null;
}

export function toSafeAiSettingsResponse(
  rows: Array<Pick<UserAiVendorSettings, "id" | "vendor" | "profileName" | "endpointKind" | "enabled" | "model">>,
  vendorKeyMap: Map<AiVendor, boolean>,
  preferredArtPieceProfileId?: number | null,
  preferredTextImproveProfileId?: number | null,
  preferredAltTextProfileId?: number | null,
): SafeAiSettingsResponse {
  return {
    availableVendors: AI_VENDOR_OPTIONS,
    vendorKeys: AI_VENDOR_OPTIONS.map((option) => ({
      vendor: option.id,
      vendorLabel: option.label,
      hasKey: vendorKeyMap.get(option.id) ?? false,
    })),
    profiles: rows
      .filter((row) => {
        if (!isAiVendor(row.vendor)) {
          console.warn(`[ai-settings] Skipping profile with unknown vendor slug "${row.vendor}" (id=${row.id})`);
          return false;
        }
        return true;
      })
      .map((row) => {
        const model = normalizeOptionalString(row.model);
        const enabled = row.enabled === 1;
        const hasKey = vendorKeyMap.get(row.vendor as AiVendor) ?? false;
        const configured = hasKey && Boolean(model);
        const vendorLabel = getAiVendorLabel(row.vendor) ?? row.vendor;

        return {
          id: row.id,
          vendor: row.vendor as AiVendor,
          vendorLabel,
          profileName: row.profileName,
          enabled,
          configured,
          model,
          endpointKind: normalizeOptionalString(row.endpointKind),
        };
      }),
    preferredArtPieceProfileId: preferredArtPieceProfileId ?? null,
    preferredTextImproveProfileId: preferredTextImproveProfileId ?? null,
    preferredAltTextProfileId: preferredAltTextProfileId ?? null,
  };
}

export function encryptAiApiKey(apiKey: string): string {
  return encryptSecret(apiKey);
}

export function decryptAiApiKey(payload: string): string {
  return decryptSecret(payload);
}
