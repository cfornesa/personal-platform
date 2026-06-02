import { beforeEach, describe, expect, it } from "vitest";
import {
  AI_VENDOR_OPTIONS,
  decryptAiApiKey,
  encryptAiApiKey,
  getAiVendorLabel,
  IMAGE_DESCRIPTION_VENDORS,
  isImageDescriptionVendor,
  isPieceGenerationVendor,
  PIECE_GENERATION_VENDORS,
  normalizeAiProfileInput,
  TEXT_GENERATION_VENDORS,
  toSafeAiSettingsResponse,
  validateAiProfileInput,
  type AiVendor,
} from "./ai-settings";

describe("ai-settings", () => {
  beforeEach(() => {
    process.env.AI_SETTINGS_ENCRYPTION_KEY = "12345678901234567890123456789012";
  });

  it("exposes the stable vendor set with human-readable labels", () => {
    expect(AI_VENDOR_OPTIONS).toEqual([
      { id: "openrouter", label: "OpenRouter" },
      { id: "opencode-zen", label: "Opencode Zen" },
      { id: "opencode-go", label: "Opencode Go" },
      { id: "google", label: "Google" },
      { id: "mistral", label: "Mistral AI" },
      { id: "mistral-vibe", label: "Mistral Vibe" },
      { id: "deepseek", label: "DeepSeek" },
    ]);
  });

  it("exposes vendor capability arrays", () => {
    expect(TEXT_GENERATION_VENDORS).toContain("openrouter");
    expect(IMAGE_DESCRIPTION_VENDORS).toContain("google");
    expect(PIECE_GENERATION_VENDORS).toContain("opencode-zen");
    expect(isImageDescriptionVendor("google")).toBe(true);
    expect(isImageDescriptionVendor("deepseek")).toBe(false);
    expect(isPieceGenerationVendor("opencode-go")).toBe(true);
    expect(isPieceGenerationVendor("openrouter")).toBe(false);
  });

  it("normalizes and trims incoming profile input", () => {
    expect(
      normalizeAiProfileInput({
        vendor: " opencode-zen ",
        profileName: " My Profile ",
        enabled: true,
        model: " big-pickle ",
      }),
    ).toEqual({
      vendor: "opencode-zen",
      profileName: "My Profile",
      enabled: true,
      model: "big-pickle",
      endpointKind: null,
    });
  });

  it("rejects profiles with unknown vendors", () => {
    expect(normalizeAiProfileInput({ vendor: "not-real", profileName: "x" })).toBeNull();
  });

  it("requires a model before enabling a profile", () => {
    expect(
      validateAiProfileInput({
        vendorLabel: "Opencode Zen",
        profileName: "My Profile",
        enabled: true,
        hasVendorKey: true,
        model: null,
      }),
    ).toBe('Opencode Zen profile "My Profile" requires a model before it can be enabled');
  });

  it("requires a vendor API key before enabling a profile", () => {
    expect(
      validateAiProfileInput({
        vendorLabel: "Opencode Zen",
        profileName: "My Profile",
        enabled: true,
        hasVendorKey: false,
        model: "big-pickle",
      }),
    ).toContain("requires an API key");
  });

  it("returns empty profile list and all-false vendor keys when no rows are provided", () => {
    const response = toSafeAiSettingsResponse([], new Map());
    expect(response.profiles).toEqual([]);
    expect(response.vendorKeys.every((vk) => !vk.hasKey)).toBe(true);
    expect(response.preferredArtPieceProfileId).toBeNull();
    expect(response.preferredTextImproveProfileId).toBeNull();
    expect(response.preferredAltTextProfileId).toBeNull();
  });

  it("sets configured=true when vendor has a key and profile has a model", () => {
    const vendorKeyMap = new Map<AiVendor, boolean>([["openrouter", true]]);
    const response = toSafeAiSettingsResponse(
      [
        {
          id: 1,
          vendor: "openrouter",
          profileName: "openrouter - anthropic/claude-sonnet-4.5",
          endpointKind: null,
          enabled: 1,
          model: "anthropic/claude-sonnet-4.5",
        },
      ],
      vendorKeyMap,
      1, 1, null,
    );

    expect(response.profiles[0]).toEqual({
      id: 1,
      vendor: "openrouter",
      vendorLabel: "OpenRouter",
      profileName: "openrouter - anthropic/claude-sonnet-4.5",
      enabled: true,
      configured: true,
      model: "anthropic/claude-sonnet-4.5",
      endpointKind: null,
    });
    expect(response.vendorKeys.find((vk) => vk.vendor === "openrouter")?.hasKey).toBe(true);
    expect(response.preferredArtPieceProfileId).toBe(1);
    expect(response.preferredTextImproveProfileId).toBe(1);
    expect(response.preferredAltTextProfileId).toBeNull();
    expect("encryptedApiKey" in response.profiles[0]!).toBe(false);
  });

  it("encrypts and decrypts api keys round-trip", () => {
    const encrypted = encryptAiApiKey("my-real-api-key");
    expect(encrypted).not.toContain("my-real-api-key");
    expect(decryptAiApiKey(encrypted)).toBe("my-real-api-key");
  });

  it("maps stable vendor ids to frontend labels", () => {
    expect(getAiVendorLabel("opencode-go")).toBe("Opencode Go");
    expect(getAiVendorLabel("openrouter")).toBe("OpenRouter");
    expect(getAiVendorLabel("deepseek")).toBe("DeepSeek");
    expect(getAiVendorLabel("not-real")).toBeNull();
  });
});
