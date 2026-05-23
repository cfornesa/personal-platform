import {
  getGetMyAiSettingsQueryKey,
  useGetMyAiSettings,
  type ProcessAiTextBodyVendor,
} from "@workspace/api-client-react";
import { useCurrentUser } from "@/hooks/use-current-user";

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

  return {
    aiVendors,
    isLoading: aiSettings.isLoading,
    preferredArtPieceVendor:
      (aiSettings.data?.preferredArtPieceVendor as ProcessAiTextBodyVendor | null | undefined) ?? null,
    preferredVendorTextImprove:
      (aiSettings.data?.preferredVendorTextImprove as ProcessAiTextBodyVendor | null | undefined) ?? null,
    preferredVendorAltText:
      (aiSettings.data?.preferredVendorAltText as ProcessAiTextBodyVendor | null | undefined) ?? null,
  };
}
