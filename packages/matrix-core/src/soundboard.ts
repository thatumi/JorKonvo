import { type MatrixClient, MatrixEventEvent, type MatrixEvent, type Room, RoomEvent } from "matrix-js-sdk";

/**
 * Discord-style soundboard for voice/stage channels - short clips any
 * connected member can trigger, heard by everyone in the call. There's no
 * real way for a pure Matrix client to inject audio into the actual
 * LiveKit media stream (that would need a server-side mixing component
 * this app doesn't have), so this uses the same trick as the voice-channel
 * "who's in" heartbeat: a lightweight, non-state timeline event just says
 * "play this sound now", and every connected client (including the
 * sender) downloads and plays the clip LOCALLY, roughly in sync - not a
 * true mixed audio stream, but close enough for short sting/meme sounds,
 * and it's the only version of this feature a pure client can actually
 * deliver.
 */

const SOUNDBOARD_CONFIG_EVENT = "io.jorkonvo.soundboard";
const SOUNDBOARD_PLAY_EVENT = "io.jorkonvo.soundboard.play";

export interface SoundboardSound {
  id: string;
  name: string;
  mxcUrl: string;
}

interface SoundboardContent {
  sounds?: SoundboardSound[];
}

type LooseSendStateEvent = (roomId: string, eventType: string, content: unknown, stateKey?: string) => Promise<unknown>;
type LooseSendEvent = (roomId: string, eventType: string, content: unknown) => Promise<unknown>;

function getContent(room: Room): SoundboardContent {
  return (room.currentState.getStateEvents(SOUNDBOARD_CONFIG_EVENT, "")?.getContent() as SoundboardContent | undefined) ?? {};
}

export function getSoundboardSounds(room: Room): SoundboardSound[] {
  return getContent(room).sounds ?? [];
}

export function canManageSoundboard(room: Room, userId: string): boolean {
  return room.currentState.maySendStateEvent(SOUNDBOARD_CONFIG_EVENT, userId);
}

/** Anyone who can send a normal message can trigger a sound - a soundboard button is meant to be a low-friction, everyone-can-use feature, unlike adding/removing the sounds themselves. */
export function canPlaySoundboard(room: Room, userId: string): boolean {
  return room.currentState.maySendEvent("m.room.message", userId);
}

export async function addSoundboardSound(client: MatrixClient, roomId: string, name: string, file: File): Promise<void> {
  const room = client.getRoom(roomId);
  const content = room ? getContent(room) : {};
  const upload = await client.uploadContent(file, { type: file.type });
  const id = `sound_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sound: SoundboardSound = { id, name, mxcUrl: upload.content_uri };
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(
    roomId,
    SOUNDBOARD_CONFIG_EVENT,
    { ...content, sounds: [...(content.sounds ?? []), sound] },
    "",
  );
}

export async function removeSoundboardSound(client: MatrixClient, roomId: string, soundId: string): Promise<void> {
  const room = client.getRoom(roomId);
  const content = room ? getContent(room) : {};
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(
    roomId,
    SOUNDBOARD_CONFIG_EVENT,
    { ...content, sounds: (content.sounds ?? []).filter((s) => s.id !== soundId) },
    "",
  );
}

/** Broadcasts "play this sound" - a plain (non-state) event, same as the voice-presence heartbeat, so a rank-and-file member (not just a moderator) can trigger it. */
export async function playSoundboardSound(client: MatrixClient, roomId: string, soundId: string): Promise<void> {
  await (client.sendEvent as unknown as LooseSendEvent)(roomId, SOUNDBOARD_PLAY_EVENT, { soundId });
}

/**
 * Watches for soundboard "play" broadcasts across every joined room and
 * resolves them to a playable mxc:// URL, handing that off to the caller
 * (which does the actual `new Audio(...).play()` - a browser API, so it
 * belongs in apps/web, not here). Same background-decryption handling as
 * every other live watcher in this package (E2EE rooms encrypt this event
 * type too).
 */
export function watchSoundboardPlays(
  client: MatrixClient,
  onPlay: (roomId: string, sound: SoundboardSound, senderId: string) => void,
): () => void {
  const liveCandidates = new Set<string>();

  function maybePlay(event: MatrixEvent, room: Room) {
    if (event.getType() !== SOUNDBOARD_PLAY_EVENT) return;
    const soundId = event.getContent()?.soundId;
    const senderId = event.getSender();
    if (typeof soundId !== "string" || !senderId) return;
    const sound = getSoundboardSounds(room).find((s) => s.id === soundId);
    if (sound) onPlay(room.roomId, sound, senderId);
  }

  function onTimeline(
    event: MatrixEvent,
    room: Room | undefined,
    toStartOfTimeline: boolean | undefined,
    removed: boolean,
    data: { liveEvent?: boolean },
  ) {
    if (!data?.liveEvent || toStartOfTimeline || removed || !room) return;
    if (event.getType() === "m.room.encrypted") {
      const id = event.getId();
      if (id !== undefined) liveCandidates.add(id);
      return;
    }
    maybePlay(event, room);
  }

  function onDecrypted(event: MatrixEvent) {
    const id = event.getId();
    if (id === undefined || !liveCandidates.has(id)) return;
    liveCandidates.delete(id);
    const room = client.getRoom(event.getRoomId() ?? "");
    if (room) maybePlay(event, room);
  }

  client.on(RoomEvent.Timeline, onTimeline);
  client.on(MatrixEventEvent.Decrypted, onDecrypted);
  return () => {
    client.removeListener(RoomEvent.Timeline, onTimeline);
    client.removeListener(MatrixEventEvent.Decrypted, onDecrypted);
  };
}
