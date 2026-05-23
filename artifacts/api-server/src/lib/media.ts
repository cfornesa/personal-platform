import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { fileTypeFromBuffer } from "file-type";
import { fileURLToPath } from "node:url";
import { db, mediaAssetsTable, eq, isNull } from "@workspace/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MEDIA_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "data", "uploads");
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const MAX_MEDIA_MB = MAX_MEDIA_BYTES / 1024 / 1024;
const REMOTE_IMPORT_TIMEOUT_MS = 15_000;
const MAX_REMOTE_REDIRECTS = 5;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};

export function ensureMediaRoot() {
  if (!fs.existsSync(MEDIA_ROOT)) {
    fs.mkdirSync(MEDIA_ROOT, { recursive: true });
  }
}

export function getMediaPath(fileName: string) {
  return path.join(MEDIA_ROOT, path.basename(fileName));
}

function humanizeFileStem(value: string) {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }
  decoded = decoded.replace(/\.[a-z0-9]{1,8}$/i, "");
  const words = decoded
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return words ? words.slice(0, 255) : "Untitled image";
}

export function deriveMediaTitle(input?: string | null) {
  const value = input?.trim();
  if (!value) {
    return "Untitled image";
  }

  try {
    const url = new URL(value);
    const basename = path.posix.basename(url.pathname);
    return humanizeFileStem(basename || url.hostname);
  } catch {
    return humanizeFileStem(path.basename(value));
  }
}

export async function storeUploadedImage(buffer: Buffer, title?: string | null) {
  const detectedType = await fileTypeFromBuffer(buffer);
  if (!detectedType || !ALLOWED_MIME_TYPES.has(detectedType.mime)) {
    throw new Error("Unsupported media type");
  }

  const extension = MIME_EXTENSION_MAP[detectedType.mime] ?? `.${detectedType.ext}`;
  const fileName = `${randomUUID()}${extension}`;
  const url = `/api/media/${fileName}`;

  await db.insert(mediaAssetsTable).values({
    url,
    filename: fileName,
    title: title?.trim().slice(0, 255) || "Untitled image",
    mimeType: detectedType.mime,
    fileData: buffer,
  });

  return {
    fileName,
    mimeType: detectedType.mime,
    title: title?.trim().slice(0, 255) || "Untitled image",
    url,
  };
}

export class RemoteMediaImportError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

function isBlockedIpv4(address: string) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && b === 168 ||
    a === 100 && b >= 64 && b <= 127 ||
    a === 198 && (b === 18 || b === 19) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string) {
  const lower = address.toLowerCase();
  const mappedIpv4 = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) {
    return isBlockedIpv4(mappedIpv4);
  }
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("::ffff:")
  );
}

function isBlockedAddress(address: string) {
  const ipVersion = net.isIP(address);
  if (ipVersion === 4) return isBlockedIpv4(address);
  if (ipVersion === 6) return isBlockedIpv6(address);
  return true;
}

async function assertPublicHttpUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RemoteMediaImportError("Enter a valid image URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new RemoteMediaImportError("Image URL must start with http:// or https://.");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new RemoteMediaImportError("Image URL must point to a public host.");
  }

  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await dns.lookup(hostname, { all: true }).catch(() => {
        throw new RemoteMediaImportError("Could not resolve image URL host.");
      });

  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new RemoteMediaImportError("Image URL must point to a public host.");
  }

  return url;
}

async function readResponseBodyWithLimit(response: Response) {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_MEDIA_BYTES) {
    throw new RemoteMediaImportError(`Imported images must be ${MAX_MEDIA_MB} MB or smaller.`, 413);
  }
  if (!response.body) {
    throw new RemoteMediaImportError("Image URL returned an empty response.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_MEDIA_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new RemoteMediaImportError(`Imported images must be ${MAX_MEDIA_MB} MB or smaller.`, 413);
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}

export async function fetchRemoteImageForImport(rawUrl: string) {
  let url = await assertPublicHttpUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_IMPORT_TIMEOUT_MS);

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REMOTE_REDIRECTS; redirectCount += 1) {
      const response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1",
        },
      }).catch((error) => {
        if (error instanceof Error && error.name === "AbortError") {
          throw new RemoteMediaImportError("Image import timed out.");
        }
        throw new RemoteMediaImportError("Could not fetch image URL.");
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          throw new RemoteMediaImportError("Image URL redirected without a destination.");
        }
        url = await assertPublicHttpUrl(new URL(location, url).toString());
        continue;
      }

      if (!response.ok) {
        throw new RemoteMediaImportError(`Image URL returned HTTP ${response.status}.`);
      }

      return await readResponseBodyWithLimit(response);
    }
  } finally {
    clearTimeout(timeout);
  }

  throw new RemoteMediaImportError("Image URL redirected too many times.");
}

export async function getMediaBuffer(fileName: string): Promise<Buffer | null> {
  const [row] = await db
    .select({ fileData: mediaAssetsTable.fileData })
    .from(mediaAssetsTable)
    .where(eq(mediaAssetsTable.filename, fileName))
    .limit(1);

  const data = row?.fileData;
  if (!data) return null;
  return Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
}

export async function backfillMediaAssetsFromFilesystem(): Promise<void> {
  // Phase 1: insert DB records for any disk files that have no record yet.
  if (fs.existsSync(MEDIA_ROOT)) {
    const files = fs.readdirSync(MEDIA_ROOT).filter((f) => !f.startsWith("."));

    for (const fileName of files) {
      const existing = await db
        .select({ id: mediaAssetsTable.id })
        .from(mediaAssetsTable)
        .where(eq(mediaAssetsTable.filename, fileName))
        .limit(1);

      if (existing.length === 0) {
        const filePath = getMediaPath(fileName);
        const fileBuffer = await fs.promises.readFile(filePath);
        const detected = await fileTypeFromBuffer(fileBuffer);
        const mimeType = detected?.mime ?? "application/octet-stream";

        await db.insert(mediaAssetsTable).values({
          url: `/api/media/${fileName}`,
          filename: fileName,
          title: deriveMediaTitle(fileName),
          mimeType,
          fileData: fileBuffer,
        });
      }
    }
  }

  // Phase 2: for any existing DB record with no fileData, populate from disk.
  const missingBlob = await db
    .select({ id: mediaAssetsTable.id, filename: mediaAssetsTable.filename })
    .from(mediaAssetsTable)
    .where(isNull(mediaAssetsTable.fileData));

  for (const row of missingBlob) {
    const filePath = getMediaPath(row.filename);
    if (fs.existsSync(filePath)) {
      const data = await fs.promises.readFile(filePath);
      await db
        .update(mediaAssetsTable)
        .set({ fileData: data })
        .where(eq(mediaAssetsTable.id, row.id));
    }
  }
}
