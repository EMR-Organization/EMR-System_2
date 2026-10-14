import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { env } from "@/server/env";
import { ValidationError } from "@/server/errors";

// Photos live on disk, not in the database (spec: Photo). Every upload is
// checked by its actual bytes and re-encoded, so what's stored is always a
// plain JPEG with no metadata (no GPS, no camera serial), whatever was sent.

const FILE_NAME = /^[0-9a-f-]{36}\.jpg$/;

/** Which image format the bytes actually are (ignoring the file name and the browser's claim). */
export function sniffImage(bytes: Uint8Array): "jpeg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

function photosDir(): string {
  return env().PHOTOS_DIR;
}

function resolveFile(fileName: string): string {
  // Names are always our own random UUIDs, but never trust a path from the database blindly.
  if (!FILE_NAME.test(fileName)) throw new Error("Invalid photo file name");
  const dir = path.resolve(photosDir());
  const full = path.resolve(dir, fileName);
  if (path.dirname(full) !== dir) throw new Error("Invalid photo path");
  return full;
}

/** Validates and re-encodes an upload, writes it under a random name, and returns the name and size. */
export async function storePhoto(bytes: Uint8Array): Promise<{ fileName: string; sizeBytes: number }> {
  if (!sniffImage(bytes)) throw new ValidationError({ photo: ["photoType"] });

  let jpeg: Buffer;
  try {
    jpeg = await sharp(bytes, { limitInputPixels: 50_000_000, failOn: "error" })
      .rotate() // apply the camera's orientation before the metadata is dropped
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer(); // sharp strips metadata unless asked to keep it
  } catch {
    throw new ValidationError({ photo: ["photoUnreadable"] });
  }

  await mkdir(photosDir(), { recursive: true });
  const fileName = `${randomUUID()}.jpg`;
  await writeFile(resolveFile(fileName), jpeg, { flag: "wx" });
  return { fileName, sizeBytes: jpeg.length };
}

export function readPhoto(fileName: string): Promise<Buffer> {
  return readFile(resolveFile(fileName));
}

/** Best-effort cleanup when the database write after storePhoto fails. */
export async function removePhoto(fileName: string): Promise<void> {
  await unlink(resolveFile(fileName)).catch(() => undefined);
}
