import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus } from "lucide-react";
import {
  useDeleteMedia,
  useDescribeImage,
  useListMedia,
  useUpdateMediaAltText,
  useSetMediaExhibits,
  getListMediaQueryKey,
  type MediaAsset,
} from "@workspace/api-client-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { FeaturedImagePicker } from "@/components/media/FeaturedImagePicker";
import { MediaGrid } from "@/components/media/MediaGrid";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/use-toast";
import { useOwnerAiVendors } from "@/hooks/use-owner-ai-vendors";

export default function AdminLibraryPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddImageOpen, setIsAddImageOpen] = useState(false);
  const { imageDescriptionProfiles, preferredAltTextProfileId } = useOwnerAiVendors();

  const { data: assets = [], isLoading } = useListMedia({
    query: { queryKey: getListMediaQueryKey() },
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
  const { mutateAsync: setMediaExhibits } = useSetMediaExhibits();

  const aiProfileId = preferredAltTextProfileId ?? imageDescriptionProfiles[0]?.id ?? null;

  async function handleSaveDetails(asset: MediaAsset, values: { title: string; altText: string; exhibitIds: number[] }) {
    await Promise.all([
      updateAltText({
        fileName: asset.filename,
        data: {
          title: values.title.trim() || null,
          altText: values.altText.trim() || null,
        },
      }),
      setMediaExhibits({ fileName: asset.filename, data: { exhibitIds: values.exhibitIds } }),
    ]);
  }

  async function handleGenerateAltText(asset: MediaAsset, currentAltText?: string): Promise<string> {
    if (aiProfileId === null) {
      toast({ title: "No AI profile configured", description: "Go to Admin → AI to add an image description profile.", variant: "destructive" });
      return asset.altText ?? "";
    }
    try {
      const result = await describeImage({
        data: {
          imageUrl: asset.url,
          profileId: aiProfileId,
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
        aiProfileId={aiProfileId}
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
          onGenerateAltText={handleGenerateAltText}
        />
      )}
    </AdminLayout>
  );
}
