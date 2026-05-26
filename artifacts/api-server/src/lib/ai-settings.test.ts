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
  normalizeAiVendorSettingsInput,
  TEXT_GENERATION_VENDORS,
  toSafeAiSettingsResponse,
  validateAiVendorSettingsInput,
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

  it("exposes task capability allowlists", () => {
    expect(TEXT_GENERATION_VENDORS).toContain("deepseek");
    expect(PIECE_GENERATION_VENDORS).toContain("deepseek");
    expect(IMAGE_DESCRIPTION_VENDORS).not.toContain("deepseek");
    expect(isPieceGenerationVendor("deepseek")).toBe(true);
    expect(isImageDescriptionVendor("deepseek")).toBe(false);
  });

  it("normalizes and trims incoming vendor settings input", () => {
    expect(
      normalizeAiVendorSettingsInput({
        vendor: " opencode-zen ",
        enabled: true,
        model: " big-pickle ",
        apiKey: " sk-123 ",
      }),
    ).toEqual({
      vendor: "opencode-zen",
      enabled: true,
      model: "big-pickle",
      apiKey: "sk-123",
    });
  });

  it("requires a model and api key when a vendor is enabled", () => {
    expect(
      validateAiVendorSettingsInput({
        vendorLabel: "OpenCode Zen",
        enabled: true,
        model: null,
        encryptedApiKey: null,
      }),
    ).toBe("OpenCode Zen requires a model before it can be enabled");
    expect(
      validateAiVendorSettingsInput({
        vendorLabel: "OpenCode Zen",
        enabled: true,
        model: "big-pickle",
        encryptedApiKey: null,
      }),
    ).toBe("OpenCode Zen requires an API key before it can be enabled");
  });

  it("returns disabled-by-default safe settings for every supported vendor", () => {
    expect(toSafeAiSettingsResponse([])).toEqual({
      availableVendors: AI_VENDOR_OPTIONS,
      preferredArtPieceVendor: null,
      preferredVendorTextImprove: null,
      preferredVendorAltText: null,
      settings: [
        {
          vendor: "openrouter",
          vendorLabel: "OpenRouter",
          enabled: false,
          configured: false,
          model: null,
        },
        {
          vendor: "opencode-zen",
          vendorLabel: "Opencode Zen",
          enabled: false,
          configured: false,
          model: null,
        },
        {
          vendor: "opencode-go",
          vendorLabel: "Opencode Go",
          enabled: false,
          configured: false,
          model: null,
        },
        {
          vendor: "google",
          vendorLabel: "Google",
          enabled: false,
          configured: false,
          model: null,
        },
        {
          vendor: "mistral",
          vendorLabel: "Mistral AI",
          enabled: false,
          configured: false,
          model: null,
        },
        {
          vendor: "mistral-vibe",
          vendorLabel: "Mistral Vibe",
          enabled: false,
          configured: false,
          model: null,
        },
        {
          vendor: "deepseek",
          vendorLabel: "DeepSeek",
          enabled: false,
          configured: false,
          model: null,
        },
      ],
    });
  });

  it("never exposes encrypted api keys in the safe response", () => {
    const response = toSafeAiSettingsResponse([
      {
        vendor: "openrouter",
        enabled: 1,
        model: "anthropic/claude-sonnet-4.5",
        encryptedApiKey: "secret-payload",
      },
    ], "openrouter", "openrouter", "google");

    expect(response.settings[0]).toEqual({
      vendor: "openrouter",
      vendorLabel: "OpenRouter",
      enabled: true,
      configured: true,
      model: "anthropic/claude-sonnet-4.5",
    });
    expect(response.preferredArtPieceVendor).toBe("openrouter");
    expect(response.preferredVendorTextImprove).toBe("openrouter");
    expect(response.preferredVendorAltText).toBe("google");
    expect("encryptedApiKey" in response.settings[0]!).toBe(false);
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
