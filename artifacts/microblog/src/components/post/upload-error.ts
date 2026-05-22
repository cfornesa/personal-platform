import { ApiError } from "@workspace/api-client-react";

export function getUploadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const data = error.data;
    if (data && typeof data === "object") {
      const message = (data as Record<string, unknown>).error;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }
    return error.message;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Failed to upload image";
}
