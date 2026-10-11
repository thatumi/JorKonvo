import type { MatrixClient } from "@jorkonvo/matrix-core";

/**
 * Client-side image handling for uploads:
 *  - downscale + re-encode large images to WebP (keeps alpha, compresses well),
 *    so a phone photo doesn't go up as a 6 MB file
 *  - report the effective max upload size (the smaller of the homeserver's
 *    `m.upload.size` and any admin-set per-space soft cap) so the composer can
 *    reject an over-limit file with a clear message instead of a 413
 */

const MAX_DIMENSION = 2560;
const WEBP_QUALITY = 0.85;
/** Below this, compression rarely helps enough to bother (unless it's over the cap). */
const COMPRESS_THRESHOLD = 900_000;

/**
 * Removes metadata segments from a JPEG's byte stream without touching the
 * image data - so a small photo that isn't worth recompressing still doesn't
 * upload the camera's embedded GPS coordinates, timestamp and serial number.
 * (Matches what Signal / WhatsApp / Element do; the recompression path below
 * already drops metadata as a side effect of re-encoding.)
 *
 * Keeps APP0 (JFIF) and APP2 (ICC colour profile - needed for accurate
 * colour); strips APP1 (EXIF/XMP, where GPS lives), the other APPn, and COM
 * comment segments. Returns the original bytes unchanged if anything looks
 * off, so a parser quirk can never corrupt an upload.
 */
function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const kept: number[][] = [[0xff, 0xd8]];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return bytes; // not where a marker should be - bail
    const marker = bytes[i + 1]!;
    // Start of scan (FFDA): everything from here on is entropy-coded image
    // data, copy the rest verbatim and stop.
    if (marker === 0xda) {
      kept.push(Array.from(bytes.subarray(i)));
      return concatChunks(kept);
    }
    // Standalone markers (no length): RSTn, SOI, EOI, TEM.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      kept.push([0xff, marker]);
      i += 2;
      continue;
    }
    const segLen = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (segLen < 2 || i + 2 + segLen > bytes.length) return bytes;
    const isMetadata =
      marker === 0xe1 || // APP1  - EXIF / XMP (GPS, camera, timestamps)
      (marker >= 0xe3 && marker <= 0xef) || // APP3..APP15 - IPTC, misc
      marker === 0xfe; // COM   - free-text comment
    if (!isMetadata) {
      kept.push(Array.from(bytes.subarray(i, i + 2 + segLen)));
    }
    i += 2 + segLen;
  }
  return bytes;
}

function concatChunks(chunks: number[][]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Returns a copy of the file with embedded metadata removed, or the original
 * if it's not a format we strip (only JPEG for now - it's where camera GPS
 * EXIF actually lives; PNG/WebP screenshots essentially never carry it, and
 * anything that gets recompressed below loses metadata anyway).
 */
async function stripMetadata(file: File): Promise<File> {
  if (file.type !== "image/jpeg" && file.type !== "image/jpg") return file;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const stripped = stripJpegMetadata(bytes);
    if (stripped.length === bytes.length) return file; // nothing removed
    // Copy into a plain ArrayBuffer-backed view for a clean BlobPart type.
    const out = new Uint8Array(stripped.length);
    out.set(stripped);
    return new File([out], file.name, { type: file.type, lastModified: file.lastModified });
  } catch {
    return file;
  }
}

let cachedServerLimit: number | null | undefined;

/** The homeserver's hard upload limit in bytes, or null if it doesn't advertise one. Cached for the session. */
export async function getServerUploadLimit(client: MatrixClient): Promise<number | null> {
  if (cachedServerLimit !== undefined) return cachedServerLimit;
  try {
    const cfg = await client.getMediaConfig();
    cachedServerLimit = typeof cfg["m.upload.size"] === "number" ? cfg["m.upload.size"] : null;
  } catch {
    cachedServerLimit = null;
  }
  return cachedServerLimit;
}

/** The effective max upload size in bytes: the stricter of the server limit and the space's admin cap. */
export async function getEffectiveUploadLimit(
  client: MatrixClient,
  spaceMaxMb: number | null,
): Promise<number | null> {
  const server = await getServerUploadLimit(client);
  const admin = spaceMaxMb != null ? spaceMaxMb * 1024 * 1024 : null;
  if (server != null && admin != null) return Math.min(server, admin);
  return server ?? admin;
}

/**
 * Returns a downscaled/recompressed WebP copy of an image when that would help,
 * otherwise the original file unchanged. Never touches GIFs (would kill the
 * animation) or non-images.
 */
export async function maybeCompressImage(
  file: File,
  opts: { enabled: boolean; softMaxBytes: number | null },
): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;

  // Metadata stripping is a privacy measure, not a size optimisation - it
  // happens for every JPEG regardless of the space's `compress_images`
  // setting or how small the file is.
  file = await stripMetadata(file);

  if (!opts.enabled) return file;

  const overCap = opts.softMaxBytes != null && file.size > opts.softMaxBytes;
  if (file.size < COMPRESS_THRESHOLD && !overCap) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    // willReadFrequently forces a CPU-backed (not GPU-accelerated) canvas surface.
    // Without it, some GPU drivers corrupt the toBlob() WebP encode with green
    // stripe artifacts (a known Chromium canvas-readback race) instead of
    // encoding the drawn frame - readable in DevTools recordings but not
    // reproducible in software-rendered/headless testing.
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", WEBP_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;

    const newName = file.name.replace(/\.[^./\\]+$/, "") + ".webp";
    return new File([blob], newName, { type: "image/webp", lastModified: Date.now() });
  } catch {
    return file;
  }
}

export function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
