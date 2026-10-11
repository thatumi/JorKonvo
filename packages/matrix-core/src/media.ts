import { decryptAttachment, encryptAttachment } from "matrix-encrypt-attachment";
import type { MatrixClient } from "matrix-js-sdk";
import { MsgType } from "matrix-js-sdk";
import type { RoomMessageEventContent } from "matrix-js-sdk/lib/@types/events.js";
import type { EncryptedFile } from "matrix-js-sdk/lib/@types/media.js";

export interface UploadProgress {
  loaded: number;
  total: number;
}

type UploadableMsgType = MsgType.Image | MsgType.File | MsgType.Audio | MsgType.Video;

function inferMsgType(mimetype: string): UploadableMsgType {
  if (mimetype.startsWith("image/")) return MsgType.Image;
  if (mimetype.startsWith("video/")) return MsgType.Video;
  if (mimetype.startsWith("audio/")) return MsgType.Audio;
  return MsgType.File;
}

async function getImageDimensions(file: File): Promise<{ w: number; h: number } | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const dims = { w: bitmap.width, h: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    return null;
  }
}

/**
 * Uploads a file and sends it as a message. Transparently encrypts the
 * attachment (per the Matrix spec's "Sending encrypted attachments") when
 * the room is encrypted, so the media server never sees plaintext content.
 */
export async function sendFileMessage(
  client: MatrixClient,
  roomId: string,
  file: File,
  onProgress?: (progress: UploadProgress) => void,
): Promise<void> {
  const mimetype = file.type || "application/octet-stream";
  const msgtype = inferMsgType(mimetype);
  const dims = await getImageDimensions(file);
  const isEncrypted = (await client.getCrypto()?.isEncryptionEnabledInRoom(roomId)) ?? false;

  const info: Record<string, unknown> = { mimetype, size: file.size };
  if (dims) {
    info.w = dims.w;
    info.h = dims.h;
  }

  if (isEncrypted) {
    const buffer = await file.arrayBuffer();
    const { data, info: encInfo } = await encryptAttachment(buffer);
    const upload = await client.uploadContent(new Blob([data]), {
      type: "application/octet-stream",
      includeFilename: false,
      progressHandler: onProgress,
    });
    const file_: EncryptedFile = {
      url: upload.content_uri,
      key: encInfo.key,
      iv: encInfo.iv,
      hashes: encInfo.hashes?.sha256 ? { sha256: encInfo.hashes.sha256 } : {},
      v: encInfo.v ?? "v2",
    };
    await client.sendMessage(roomId, {
      msgtype,
      body: file.name,
      info,
      file: file_,
    } as RoomMessageEventContent);
  } else {
    const upload = await client.uploadContent(file, {
      type: mimetype,
      progressHandler: onProgress,
    });
    await client.sendMessage(roomId, {
      msgtype,
      body: file.name,
      info,
      url: upload.content_uri,
    } as RoomMessageEventContent);
  }
}

/**
 * Resolves an `m.image`/`m.file`/etc message's attachment (encrypted or
 * not) to a local blob: URL suitable for `<img src>` / downloads. Always
 * fetches with the user's access token, since modern homeservers may
 * require authenticated media (MSC3916) - a plain `<img src>` to the mxc
 * HTTP URL can silently 403 on those servers.
 *
 * Caller is responsible for revoking the returned URL (`URL.revokeObjectURL`)
 * when it's no longer displayed.
 */
export async function resolveAttachmentUrl(
  client: MatrixClient,
  content: { url?: string; file?: EncryptedFile; info?: { mimetype?: string } },
): Promise<string> {
  const mxcUrl = content.file?.url ?? content.url;
  if (!mxcUrl) throw new Error("Nincs csatolt média ehhez az üzenethez");

  const httpUrl = client.mxcUrlToHttp(mxcUrl, undefined, undefined, undefined, false, false, true);
  if (!httpUrl) throw new Error("Nem sikerült feloldani a média URL-t");

  const accessToken = client.getAccessToken();
  const res = await fetch(httpUrl, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });
  if (!res.ok) throw new Error(`Média letöltése sikertelen (${res.status})`);
  const buffer = await res.arrayBuffer();

  const plainBuffer = content.file ? await decryptAttachment(buffer, content.file) : buffer;
  const type = content.info?.mimetype || undefined;
  return URL.createObjectURL(new Blob([plainBuffer], type ? { type } : undefined));
}

export interface UrlPreview {
  title: string | null;
  description: string | null;
  imageMxcUrl: string | null;
}

const urlPreviewCache = new Map<string, UrlPreview | null>();

/**
 * Fetches an OpenGraph-style link preview for a URL via the homeserver's
 * media repo (server-side fetch, no CORS/client-side scraping involved).
 * Returns null if the server has no preview (disabled, fetch failed, etc).
 * Results are cached in-memory for the lifetime of the page.
 */
export async function getUrlPreview(client: MatrixClient, url: string): Promise<UrlPreview | null> {
  if (urlPreviewCache.has(url)) return urlPreviewCache.get(url)!;
  try {
    const res = await client.getUrlPreview(url, Date.now());
    const preview: UrlPreview = {
      title: res["og:title"] ?? null,
      description: res["og:description"] ?? null,
      imageMxcUrl: res["og:image"] ?? null,
    };
    if (!preview.title && !preview.description && !preview.imageMxcUrl) {
      urlPreviewCache.set(url, null);
      return null;
    }
    urlPreviewCache.set(url, preview);
    return preview;
  } catch {
    urlPreviewCache.set(url, null);
    return null;
  }
}
