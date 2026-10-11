import { decryptAttachment, encryptAttachment } from "matrix-encrypt-attachment";
import { EventType, type MatrixClient, type MatrixEvent } from "matrix-js-sdk";
import type { EncryptedFile } from "matrix-js-sdk/lib/@types/media.js";

/**
 * Stickers (m.sticker) - unlike custom per-room emoji (MSC2545, deliberately
 * skipped elsewhere in this codebase for still being genuinely unstable),
 * m.sticker is a plain, long-stable spec event type: a single image sent as
 * its own event rather than as an m.room.message attachment, so clients can
 * render it without the usual message chrome (no reply/edit, etc.) and other
 * clients know at a glance it's decorative, not a file share. There's no
 * spec-defined sticker PACK/PICKER mechanism here (that lives in the
 * separate, integration-manager-based "widget" ecosystem) - this is the
 * simplest honest MVP: pick any image and send it as a sticker, the same
 * upload/encrypt path media.ts already uses for image messages.
 */

type LooseSendEvent = (roomId: string, eventType: string, content: unknown) => Promise<unknown>;
type LooseGetAccountData = (eventType: string) => MatrixEvent | undefined;
type LooseSetAccountData = (eventType: string, content: unknown) => Promise<unknown>;

export function isStickerEvent(ev: MatrixEvent): boolean {
  return ev.getType() === EventType.Sticker;
}

/** Uploads an image and sends it as a sticker (m.sticker, not m.room.message). */
export async function sendSticker(
  client: MatrixClient,
  roomId: string,
  file: File,
  description: string,
): Promise<void> {
  const mimetype = file.type || "image/png";
  const isEncrypted = (await client.getCrypto()?.isEncryptionEnabledInRoom(roomId)) ?? false;

  const dims = await (async () => {
    try {
      const bitmap = await createImageBitmap(file);
      const d = { w: bitmap.width, h: bitmap.height };
      bitmap.close();
      return d;
    } catch {
      return null;
    }
  })();
  const info: Record<string, unknown> = { mimetype, size: file.size, ...dims };
  const body = description.trim() || file.name;

  if (isEncrypted) {
    const buffer = await file.arrayBuffer();
    const { data, info: encInfo } = await encryptAttachment(buffer);
    const upload = await client.uploadContent(new Blob([data]), {
      type: "application/octet-stream",
      includeFilename: false,
    });
    const file_: EncryptedFile = {
      url: upload.content_uri,
      key: encInfo.key,
      iv: encInfo.iv,
      hashes: encInfo.hashes?.sha256 ? { sha256: encInfo.hashes.sha256 } : {},
      v: encInfo.v ?? "v2",
    };
    await (client.sendEvent as unknown as LooseSendEvent)(roomId, EventType.Sticker, { body, info, file: file_ });
  } else {
    const upload = await client.uploadContent(file, { type: mimetype });
    await (client.sendEvent as unknown as LooseSendEvent)(roomId, EventType.Sticker, {
      body,
      info,
      url: upload.content_uri,
    });
  }
}

/**
 * Personal sticker collection - "favourites" a user builds up so they can
 * re-send a sticker without re-uploading it every time. There's no spec
 * sticker-pack format that clients agree on (see the module comment above),
 * so this is a private per-account list in account data, namespaced like the
 * app's other custom data. Stored plaintext-referenced (`mxc://` + `info`):
 * saving a sticker that arrived encrypted downloads and re-uploads it
 * unencrypted first, since a saved sticker has to be sendable into any room.
 */
export const PERSONAL_STICKERS_EVENT = "io.jorkonvo.stickers";

export interface PersonalSticker {
  /** Plain (unencrypted) mxc:// URL. */
  url: string;
  body: string;
  info?: Record<string, unknown>;
}

interface PersonalStickersContent {
  stickers?: PersonalSticker[];
}

export function getPersonalStickers(client: MatrixClient): PersonalSticker[] {
  const content = (client.getAccountData as unknown as LooseGetAccountData)(
    PERSONAL_STICKERS_EVENT,
  )?.getContent() as PersonalStickersContent | undefined;
  return (content?.stickers ?? []).filter((s) => typeof s.url === "string" && s.url.startsWith("mxc://"));
}

async function writePersonalStickers(client: MatrixClient, stickers: PersonalSticker[]): Promise<void> {
  await (client.setAccountData as unknown as LooseSetAccountData)(PERSONAL_STICKERS_EVENT, { stickers });
}

/**
 * Adds a sticker (as it appears on an `m.sticker` event) to the personal
 * collection. Encrypted stickers are downloaded, decrypted and re-uploaded
 * unencrypted so the saved copy is portable to any room. No-op if a sticker
 * with the same resolved URL is already saved.
 */
export async function savePersonalSticker(
  client: MatrixClient,
  content: { body?: string; info?: Record<string, unknown>; url?: string; file?: EncryptedFile },
): Promise<void> {
  const body = (content.body ?? "matrica").toString();
  const info = content.info;
  let plainUrl = content.url;

  if (!plainUrl && content.file) {
    const httpUrl = client.mxcUrlToHttp(content.file.url, undefined, undefined, undefined, false, false, true);
    if (!httpUrl) throw new Error("Nem sikerült feloldani a matrica URL-jét");
    const token = client.getAccessToken();
    const res = await fetch(httpUrl, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
    if (!res.ok) throw new Error(`Matrica letöltése sikertelen (${res.status})`);
    const decrypted = await decryptAttachment(await res.arrayBuffer(), content.file);
    const mimetype = (info?.mimetype as string | undefined) ?? "image/png";
    const upload = await client.uploadContent(new Blob([decrypted], { type: mimetype }), { type: mimetype });
    plainUrl = upload.content_uri;
  }

  if (!plainUrl) throw new Error("Ehhez a matricához nincs kép");

  const existing = getPersonalStickers(client);
  if (existing.some((s) => s.url === plainUrl)) return;
  await writePersonalStickers(client, [...existing, { url: plainUrl, body, info }]);
}

export async function removePersonalSticker(client: MatrixClient, url: string): Promise<void> {
  await writePersonalStickers(
    client,
    getPersonalStickers(client).filter((s) => s.url !== url),
  );
}

/** Sends an already-saved personal sticker into a room (re-encrypting for E2EE rooms). */
export async function sendPersonalSticker(
  client: MatrixClient,
  roomId: string,
  sticker: PersonalSticker,
): Promise<void> {
  const isEncrypted = (await client.getCrypto()?.isEncryptionEnabledInRoom(roomId)) ?? false;
  const info = sticker.info ?? {};
  const body = sticker.body || "matrica";

  if (!isEncrypted) {
    await (client.sendEvent as unknown as LooseSendEvent)(roomId, EventType.Sticker, {
      body,
      info,
      url: sticker.url,
    });
    return;
  }

  // E2EE room: fetch our own plaintext copy, encrypt it for this room.
  const httpUrl = client.mxcUrlToHttp(sticker.url, undefined, undefined, undefined, false, false, true);
  if (!httpUrl) throw new Error("Nem sikerült feloldani a matrica URL-jét");
  const token = client.getAccessToken();
  const res = await fetch(httpUrl, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!res.ok) throw new Error(`Matrica letöltése sikertelen (${res.status})`);
  const { data, info: encInfo } = await encryptAttachment(await res.arrayBuffer());
  const upload = await client.uploadContent(new Blob([data]), {
    type: "application/octet-stream",
    includeFilename: false,
  });
  const file_: EncryptedFile = {
    url: upload.content_uri,
    key: encInfo.key,
    iv: encInfo.iv,
    hashes: encInfo.hashes?.sha256 ? { sha256: encInfo.hashes.sha256 } : {},
    v: encInfo.v ?? "v2",
  };
  await (client.sendEvent as unknown as LooseSendEvent)(roomId, EventType.Sticker, { body, info, file: file_ });
}
