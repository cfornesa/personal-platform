import {
  getGetMyAiSettingsQueryKey,
  useGetMyAiSettings,
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
const PIECE_GENERATION_VENDORS = ["opencode-zen", "opencode-go", "google", "mistral", "mistral-vibe", "deepseek"] as const;

export type AiProfile = {
  id: number;
  vendor: string;
  vendorLabel: string;
  profileName: string;
  label: string;
};

function filterProfiles(
  profiles: AiProfile[],
  allowlist: readonly string[],
): AiProfile[] {
  return profiles.filter((p) => allowlist.includes(p.vendor));
}

function keepPreferredProfile(
  profileId: number | null | undefined,
  profiles: AiProfile[],
): number | null {
  if (profileId == null) return null;
  return profiles.some((p) => p.id === profileId) ? profileId : null;
}

export function useOwnerAiVendors() {
  const { currentUser, isOwner } = useCurrentUser();
  const aiSettings = useGetMyAiSettings({
    query: {
      queryKey: getGetMyAiSettingsQueryKey(),
      enabled: Boolean(currentUser && isOwner),
    },
  });

  // configured = vendor has a saved key AND profile has a model (server derives this)
  const allProfiles: AiProfile[] = (aiSettings.data?.profiles ?? [])
    .filter((p) => p.enabled && p.configured && Boolean(p.model))
    .map((p) => ({
      id: p.id,
      vendor: p.vendor,
      vendorLabel: p.vendorLabel,
      profileName: p.profileName,
      label: p.profileName,
    }));

  const textProfiles = filterProfiles(allProfiles, TEXT_GENERATION_VENDORS);
  const imageDescriptionProfiles = filterProfiles(allProfiles, IMAGE_DESCRIPTION_VENDORS);
  const pieceProfiles = filterProfiles(allProfiles, PIECE_GENERATION_VENDORS);

  const preferredArtPieceProfileId = keepPreferredProfile(
    aiSettings.data?.preferredArtPieceProfileId,
    pieceProfiles,
  );
  const preferredTextImproveProfileId = keepPreferredProfile(
    aiSettings.data?.preferredTextImproveProfileId,
    textProfiles,
  );
  const preferredAltTextProfileId = keepPreferredProfile(
    aiSettings.data?.preferredAltTextProfileId,
    imageDescriptionProfiles,
  );

  return {
    allProfiles,
    textProfiles,
    imageDescriptionProfiles,
    pieceProfiles,
    isLoading: aiSettings.isLoading,
    preferredArtPieceProfileId,
    preferredTextImproveProfileId,
    preferredAltTextProfileId,
  };
}
