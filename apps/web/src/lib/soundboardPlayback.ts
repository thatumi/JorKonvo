import { getUserCallPrefs, type MatrixClient, watchSoundboardPlays } from "@jorkonvo/matrix-core";
import { useGroupCallStore } from "../state/groupCallStore";
import { getSoundboardVolume, isSoundboardPlaybackEnabled } from "./soundboardPrefs";

/**
 * Bridges soundboard.ts's room-wide "play this sound" broadcasts into an
 * actual local `<audio>` playback - but ONLY when this account is
 * currently connected to THAT room's call (watchSoundboardPlays itself is
 * global, across every joined room, since a plain timeline event has no
 * concept of "only deliver this to people in the call" - filtering by the
 * live groupCallStore state is what keeps a soundboard trigger in a room
 * you're not even in from suddenly blasting audio at you).
 */
export function wireSoundboardPlayback(client: MatrixClient): () => void {
  return watchSoundboardPlays(client, (roomId, sound, senderId) => {
    if (useGroupCallStore.getState().matrixRoomId !== roomId) return;
    if (!isSoundboardPlaybackEnabled()) return;
    if (getUserCallPrefs(client, senderId).mutedSoundboard) return;
    const url = client.mxcUrlToHttp(sound.mxcUrl);
    if (!url) return;
    const audio = new Audio(url);
    // HTMLMediaElement.volume is clamped to [0, 1] by the browser - the
    // per-user volume's >100% headroom only really applies to live mic
    // audio (via LiveKit's WebAudio gain path), not this local playback.
    audio.volume = Math.min(1, (getSoundboardVolume() / 100) * (getUserCallPrefs(client, senderId).volume / 100));
    void audio.play().catch(() => undefined); // autoplay policy etc. - a missed sound is never worth surfacing as an error
  });
}
