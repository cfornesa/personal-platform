import { useState } from "react";
import { FeaturedImagePicker } from "@/components/media/FeaturedImagePicker";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preferred vendor for AI alt text generation. */
  altTextVendor?: string | null;
  onInsert: (src: string, altText?: string) => void;
};

/**
 * Wraps FeaturedImagePicker to let the user pick a content image (not featured).
 * The selected URL and alt text are passed to onInsert so the caller can insert them into the editor.
 */
export function ImageInsertDialog({ open, onOpenChange, altTextVendor, onInsert }: Props) {
  return (
    <FeaturedImagePicker
      open={open}
      onOpenChange={onOpenChange}
      altTextVendor={altTextVendor}
      onSelect={(url, altText) => {
        onInsert(url, altText);
        onOpenChange(false);
      }}
    />
  );
}
