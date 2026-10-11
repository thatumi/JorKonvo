import type { MatrixClient, MatrixEvent } from "matrix-js-sdk";
import type { RoomEmoji } from "./roomEmoji.js";

/**
 * A user's OWN custom emoji pack - Discord has no equivalent (custom emoji
 * there are always per-server), but the user explicitly asked for it: emoji
 * that follow the PERSON, usable in any room, subject to each space being
 * able to turn that off (spaceSettings.ts `allow_personal_emoji`) the same
 * way a Discord-style permission would gate it.
 *
 * Stored as account data (this is MY OWN pack, synced across my own devices,
 * same reasoning as friends.ts/spacePrivacy.ts) rather than room state -
 * there's no single room that would "own" it.
 */
export const PERSONAL_EMOTES_EVENT = "io.jorkonvo.personal_emotes";

/** Sentinel `RoomEmoji.sourceId` marking an emoji as coming from the personal pack rather than any room/space - callers group/label by this instead of resolving a room. */
export const PERSONAL_EMOJI_SOURCE_ID = "__personal__";

interface PersonalEmotesContent {
  images?: Record<string, { url?: string }>;
}

type LooseGetAccountData = (eventType: string) => MatrixEvent | undefined;
type LooseSetAccountData = (eventType: string, content: unknown) => Promise<unknown>;

function getContent(client: MatrixClient): PersonalEmotesContent {
  return (
    (client.getAccountData as unknown as LooseGetAccountData)(PERSONAL_EMOTES_EVENT)?.getContent<PersonalEmotesContent>() ??
    {}
  );
}

export function getPersonalEmojis(client: MatrixClient): RoomEmoji[] {
  const images = getContent(client).images ?? {};
  return Object.entries(images)
    .filter((entry): entry is [string, { url: string }] => typeof entry[1]?.url === "string")
    .map(([shortcode, { url }]) => ({ shortcode, mxcUrl: url, sourceId: PERSONAL_EMOJI_SOURCE_ID, sourceName: "" }));
}

export async function addPersonalEmoji(client: MatrixClient, shortcode: string, file: File): Promise<void> {
  const content = getContent(client);
  const upload = await client.uploadContent(file, { type: file.type });
  const nextImages = { ...content.images, [shortcode]: { url: upload.content_uri } };
  await (client.setAccountData as unknown as LooseSetAccountData)(PERSONAL_EMOTES_EVENT, { ...content, images: nextImages });
}

export async function removePersonalEmoji(client: MatrixClient, shortcode: string): Promise<void> {
  const content = getContent(client);
  const nextImages = { ...content.images };
  delete nextImages[shortcode];
  await (client.setAccountData as unknown as LooseSetAccountData)(PERSONAL_EMOTES_EVENT, { ...content, images: nextImages });
}
