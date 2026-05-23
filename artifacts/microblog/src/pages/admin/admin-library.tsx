import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus } from "lucide-react";
import {
  useDeleteMedia,
  useDescribeImage,
  useListMedia,
  useUpdateMediaAltText,
  getListMediaQueryKey,
  type MediaAsset,
} from "@workspace/api-client-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { FeaturedImagePicker } from "@/components/media/FeaturedImagePicker";
import { MediaGrid } from "@/components/media/MediaGrid";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/use-toast";
import { useGetMyAiSettings, getGetMyAiSettingsQueryKey } from "@workspace/api-client-react";
import { useCurrentUser } from "@/hooks/use-current-user";

export default function AdminLibraryPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isOwner } = useCurrentUser();
  const [isAddImageOpen, setIsAddImageOpen] = useState(false);

  const { data: assets = [], isLoading } = useListMedia({
    query: { queryKey: getListMediaQueryKey() },
  });

  const { data: aiSettings } = useGetMyAiSettings({
    query: { queryKey: getGetMyAiSettingsQueryKey(), enabled: isOwner },
  });

  const { mutate: deleteMedia, isPending: isDeleting } = useDeleteMedia({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMediaQueryKey() });
        toast({ title: "Image deleted" });
      },
      onError: () => {
        toast({ title: "Delete failed", description: "Could not delete the image.", variant: "destructive" });
      },
    },
  });

  const { mutateAsync: updateAltText } = useUpdateMediaAltText({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMediaQueryKey() });
        toast({ title: "Alt text saved" });
      },
      onError: () => {
        toast({ title: "Save failed", description: "Could not save alt text.", variant: "destructive" });
      },
    },
  });

  const { mutateAsync: describeImage } = useDescribeImage();

  const preferredVendor = aiSettings?.preferredVendorAltText ?? null;
  const firstEnabledVendor = aiSettings?.settings.find((s) => s.enabled && s.configured)?.vendor ?? null;
  const altTextVendor = preferredVendor ?? firstEnabledVendor;

  async function handleSaveDetails(asset: MediaAsset, values: { title: string; altText: string }) {
    await updateAltText({
      fileName: asset.filename,
      data: {
        title: values.title.trim() || null,
        altText: values.altText.trim() || null,
      },
    });
  }

  async function handleGenerateAltText(asset: MediaAsset, currentAltText?: string): Promise<string> {
    if (!altTextVendor) {
      toast({ title: "No AI vendor configured", description: "Enable a vendor in Admin → AI first.", variant: "destructive" });
      return asset.altText ?? "";
    }
    try {
      const result = await describeImage({
        data: {
          imageUrl: asset.url,
          vendor: altTextVendor,
          ...(currentAltText?.trim() ? { existingAltText: currentAltText.trim() } : {}),
        },
      });
      return result.altText;
    } catch (error: any) {
      const code = error?.data?.code ?? error?.response?.data?.code;
      if (code === "vision_not_supported") {
        toast({
          title: "Vision not supported",
          description: "This AI model does not support image analysis. Choose a vision-capable model in Admin → AI → Task Preferences.",
          variant: "destructive",
        });
      } else {
        toast({ title: "AI failed", description: "Could not generate alt text.", variant: "destructive" });
      }
      return asset.altText ?? "";
    }
  }

  return (
    <AdminLayout
      title="Image Library"
      description={assets.length > 0 ? `${assets.length} image${assets.length === 1 ? "" : "s"}` : undefined}
    >
      <div className="mb-4 flex justify-end">
        <Button
          type="button"
          onClick={() => setIsAddImageOpen(true)}
          className="gap-2"
        >
          <ImagePlus className="h-4 w-4" />
          Upload or import image
        </Button>
      </div>
      <FeaturedImagePicker
        open={isAddImageOpen}
        onOpenChange={setIsAddImageOpen}
        dialogTitle="Add Image to Library"
        finalActionLabel="Done"
        closeWarningDescription="You have selected an image or started an upload/import, but have not finished adding it to the library."
        altTextVendor={altTextVendor}
        onSelect={() => {
          queryClient.invalidateQueries({ queryKey: getListMediaQueryKey() });
          setIsAddImageOpen(false);
          toast({ title: "Image added to library" });
        }}
      />
      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : (
        <MediaGrid
          assets={assets}
          mode="manage"
          isDeleting={isDeleting}
          onDelete={(asset) => {
            const fileName = asset.filename;
            deleteMedia({ fileName });
          }}
          onSaveDetails={handleSaveDetails}
          onGenerateAltText={altTextVendor ? handleGenerateAltText : undefined}
        />
      )}
    </AdminLayout>
  );
}
