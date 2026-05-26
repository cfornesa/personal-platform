import {
  getGetMyAiSettingsQueryKey,
  useGetMyAiSettings,
  type ProcessAiTextBodyVendor,
} from "@workspace/api-client-react";
import { useCurrentUser } from "@/hooks/use-current-user";

const TEXT_GENERATION_VENDORS = [
  "openrouter",
  "opencode-zen",
  "opencode-go",
  "google",
  "mistral",
  "mistral-vibe",
  "deepseek",
] as const;
const IMAGE_DESCRIPTION_VENDORS = [
  "openrouter",
  "opencode-zen",
  "opencode-go",
  "google",
  "mistral",
  "mistral-vibe",
] as const;
const PIECE_GENERATION_VENDORS = ["google", "mistral", "mistral-vibe", "deepseek"] as const;

function filterVendors(
  vendors: Array<{ id: ProcessAiTextBodyVendor; label: string }>,
  allowlist: readonly string[],
) {
  return vendors.filter((v) => allowlist.includes(v.id));
}

function keepPreferredVendor(
  vendor: ProcessAiTextBodyVendor | null | undefined,
  vendors: Array<{ id: ProcessAiTextBodyVendor; label: string }>,
) {
  return vendor && vendors.some((v) => v.id === vendor) ? vendor : null;
}

export function useOwnerAiVendors() {
  const { currentUser, isOwner } = useCurrentUser();
  const aiSettings = useGetMyAiSettings({
    query: {
      queryKey: getGetMyAiSettingsQueryKey(),
      enabled: Boolean(currentUser && isOwner),
    },
  });

  const aiVendors = (aiSettings.data?.settings ?? [])
    .filter((setting) => setting.enabled && setting.configured)
    .map((setting) => ({
      id: setting.vendor as ProcessAiTextBodyVendor,
      label: setting.vendorLabel,
    }));

  const textVendors = filterVendors(aiVendors, TEXT_GENERATION_VENDORS);
  const imageDescriptionVendors = filterVendors(aiVendors, IMAGE_DESCRIPTION_VENDORS);
  const pieceVendors = filterVendors(aiVendors, PIECE_GENERATION_VENDORS);

  const preferredArtPieceVendor = keepPreferredVendor(
    aiSettings.data?.preferredArtPieceVendor as ProcessAiTextBodyVendor | null | undefined,
    pieceVendors,
  );
  const preferredVendorTextImprove = keepPreferredVendor(
    aiSettings.data?.preferredVendorTextImprove as ProcessAiTextBodyVendor | null | undefined,
    textVendors,
  );
  const preferredVendorAltText = keepPreferredVendor(
    aiSettings.data?.preferredVendorAltText as ProcessAiTextBodyVendor | null | undefined,
    imageDescriptionVendors,
  );

  return {
    aiVendors: textVendors,
    textVendors,
    imageDescriptionVendors,
    pieceVendors,
    isLoading: aiSettings.isLoading,
    preferredArtPieceVendor,
    preferredVendorTextImprove,
    preferredVendorAltText,
  };
}
