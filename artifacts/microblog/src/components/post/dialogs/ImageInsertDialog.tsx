import { useState } from "react";
import { FeaturedImagePicker } from "@/components/media/FeaturedImagePicker";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preferred AI profile ID for alt text generation. */
  aiProfileId?: number | null;
  onInsert: (src: string, altText?: string) => void;
};

/**
 * Wraps FeaturedImagePicker to let the user pick a content image (not featured).
 * The selected URL and alt text are passed to onInsert so the caller can insert them into the editor.
 */
export function ImageInsertDialog({ open, onOpenChange, aiProfileId, onInsert }: Props) {
  return (
    <FeaturedImagePicker
      open={open}
      onOpenChange={onOpenChange}
      aiProfileId={aiProfileId}
      onSelect={(url, altText) => {
        onInsert(url, altText);
        onOpenChange(false);
      }}
    />
  );
}
