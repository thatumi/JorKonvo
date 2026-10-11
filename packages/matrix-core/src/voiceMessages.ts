import { encryptAttachment } from "matrix-encrypt-attachment";
import type { MatrixClient, MatrixEvent } from "matrix-js-sdk";
import { MsgType } from "matrix-js-sdk";
import type { RoomMessageEventContent } from "matrix-js-sdk/lib/@types/events.js";
import type { EncryptedFile } from "matrix-js-sdk/lib/@types/media.js";

/**
 * Discord-style push-to-record voice messages, built on the (long-deployed
 * via Element, treated here as stable enough to build on) voice-message
 * extension to m.audio: MSC1767 ("org.matrix.msc1767.audio", duration +
 * waveform) plus the MSC3245 flag ("org.matrix.msc3245.voice_message")
 * that tells clients to render a waveform/scrubber widget instead of a
 * generic audio-file attachment.
 */
export const VOICE_MESSAGE_FLAG = "org.matrix.msc3245.voice_message";
const AUDIO_DETAILS_KEY = "org.matrix.msc1767.audio";

export interface VoiceMessageContent {
  durationMs: number;
  /** 0-1024 normalized amplitude samples, per MSC1767. */
  waveform: number[];
}

export function isVoiceMessageEvent(ev: MatrixEvent): boolean {
  const content = ev.getContent();
  return content.msgtype === MsgType.Audio && VOICE_MESSAGE_FLAG in content;
}

export function parseVoiceMessage(ev: MatrixEvent): VoiceMessageContent | null {
  if (!isVoiceMessageEvent(ev)) return null;
  const audio = ev.getContent()[AUDIO_DETAILS_KEY] as { duration?: number; waveform?: number[] } | undefined;
  return {
    durationMs: audio?.duration ?? 0,
    waveform: audio?.waveform ?? [],
  };
}

/** Downsamples decoded PCM peaks to `buckets` amplitude samples in 0-1024, per MSC1767. */
export async function computeWaveform(blob: Blob, buckets = 100): Promise<number[]> {
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channel = buffer.getChannelData(0);
    const samplesPerBucket = Math.max(1, Math.floor(channel.length / buckets));
    const waveform: number[] = [];
    for (let i = 0; i < buckets; i++) {
      const start = i * samplesPerBucket;
      let peak = 0;
      for (let j = start; j < Math.min(start + samplesPerBucket, channel.length); j++) {
        peak = Math.max(peak, Math.abs(channel[j] ?? 0));
      }
      waveform.push(Math.round(Math.min(1, peak) * 1024));
    }
    return waveform;
  } finally {
    void ctx.close();
  }
}

/** Uploads + sends a recorded voice clip. Mirrors sendFileMessage's E2EE attachment handling. */
export async function sendVoiceMessage(
  client: MatrixClient,
  roomId: string,
  blob: Blob,
  durationMs: number,
  waveform: number[],
): Promise<void> {
  const mimetype = blob.type || "audio/ogg";
  const isEncrypted = (await client.getCrypto()?.isEncryptionEnabledInRoom(roomId)) ?? false;

  const info: Record<string, unknown> = { mimetype, size: blob.size, duration: durationMs };
  const extra = {
    [AUDIO_DETAILS_KEY]: { duration: durationMs, waveform },
    [VOICE_MESSAGE_FLAG]: {},
  };

  if (isEncrypted) {
    const buffer = await blob.arrayBuffer();
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
    await client.sendMessage(roomId, {
      msgtype: MsgType.Audio,
      body: "Hangüzenet",
      info,
      file: file_,
      ...extra,
    } as RoomMessageEventContent);
  } else {
    const upload = await client.uploadContent(blob, { type: mimetype });
    await client.sendMessage(roomId, {
      msgtype: MsgType.Audio,
      body: "Hangüzenet",
      info,
      url: upload.content_uri,
      ...extra,
    } as RoomMessageEventContent);
  }
}
