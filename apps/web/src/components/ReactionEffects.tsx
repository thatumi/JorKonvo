import { type MatrixEvent, type Room, resolveSuperReactions, RoomEvent } from "@jorkonvo/matrix-core";
import { useEffect, useRef, useState } from "react";
import { useMatrixStore } from "../state/matrixStore";

/**
 * Discord "Super Reactions", the free version: when someone reacts to a
 * message with one of a small celebratory set, a short burst of that emoji
 * floats up from the bottom of the chat for everyone who's looking at the
 * room. Purely cosmetic and CSS-animated.
 *
 * Anti-spam is deliberately strict - a burst covers the whole message area,
 * so one determined person spam-reacting must never be able to strobe or
 * wall off everyone else's screen:
 *   - a single sender can trigger at most one burst per PER_SENDER_COOLDOWN
 *   - room-wide, at most one burst per GLOBAL_COOLDOWN and MAX_BURSTS_PER_MIN
 *     per rolling minute; blowing the per-minute cap mutes bursts entirely
 *     for MUTE_MS
 *   - only genuinely fresh reactions on live events count (no backlog storm,
 *     no reacting to ancient messages to farm bursts)
 *   - at most MAX_CONCURRENT bursts on screen at once
 */
const PARTICLES_PER_BURST = 12;
/** Room-wide floor between any two bursts. */
const GLOBAL_COOLDOWN_MS = 2500;
/** One person can set off at most one burst this often. */
const PER_SENDER_COOLDOWN_MS = 15_000;
/** Rolling-minute ceiling on bursts before the room goes quiet. */
const MAX_BURSTS_PER_MIN = 5;
/** How long bursts stay muted after the per-minute cap is hit. */
const MUTE_MS = 30_000;
/** Ignore reactions older than this - stops a burst storm when a room's backlog loads. */
const FRESH_WINDOW_MS = 8_000;
/** Hard cap on simultaneous on-screen bursts. */
const MAX_CONCURRENT = 3;
/** Keep the per-sender map from growing without bound in a busy room. */
const SENDER_MAP_CAP = 256;

interface Burst {
  id: number;
  emoji: string;
}

/**
 * Purely decorative overlay (always aria-hidden) that renders super-reaction
 * bursts as CSS-animated emoji particles floating up from the bottom of the
 * chat, following the anti-spam rules described in the module notes above.
 *
 * @param room - The room whose live `m.reaction` events are watched.
 */
export function ReactionEffects({ room }: { room: Room }) {
  const client = useMatrixStore((s) => s.client);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const lastBurstAt = useRef(0);
  const nextId = useRef(0);
  const senderLastBurst = useRef(new Map<string, number>());
  const recentBurstTimes = useRef<number[]>([]);
  const mutedUntil = useRef(0);
  const seenEventIds = useRef(new Set<string>());

  useEffect(() => {
    if (!client) return;

    const onTimeline = (
      ev: MatrixEvent,
      evRoom: Room | undefined,
      toStartOfTimeline: boolean | undefined,
      removed: boolean,
      data: { liveEvent?: boolean },
    ) => {
      if (!data?.liveEvent || toStartOfTimeline || removed) return;
      if (evRoom?.roomId !== room.roomId || ev.getType() !== "m.reaction") return;

      const now = Date.now();
      if (now - ev.getTs() > FRESH_WINDOW_MS) return;
      if (now < mutedUntil.current) return;

      // The timeline can surface the same event more than once (decryption,
      // pagination overlap) - only ever react to a given reaction once.
      const evId = ev.getId();
      if (evId) {
        if (seenEventIds.current.has(evId)) return;
        seenEventIds.current.add(evId);
        if (seenEventIds.current.size > 512) seenEventIds.current.clear();
      }

      const key = ev.getContent()?.["m.relates_to"]?.key;
      if (typeof key !== "string" || !resolveSuperReactions(client, room).includes(key)) return;

      if (now - lastBurstAt.current < GLOBAL_COOLDOWN_MS) return;

      const sender = ev.getSender() ?? "";
      const senderLast = senderLastBurst.current.get(sender) ?? 0;
      if (now - senderLast < PER_SENDER_COOLDOWN_MS) return;

      // Rolling-minute ceiling: prune, count, and if we're at the cap, go
      // quiet for a while rather than letting a group pile-on strobe.
      const cutoff = now - 60_000;
      recentBurstTimes.current = recentBurstTimes.current.filter((ts) => ts > cutoff);
      if (recentBurstTimes.current.length >= MAX_BURSTS_PER_MIN) {
        mutedUntil.current = now + MUTE_MS;
        return;
      }

      lastBurstAt.current = now;
      recentBurstTimes.current.push(now);
      senderLastBurst.current.set(sender, now);
      if (senderLastBurst.current.size > SENDER_MAP_CAP) {
        // Drop the oldest half.
        const entries = [...senderLastBurst.current.entries()].sort((a, b) => a[1] - b[1]);
        senderLastBurst.current = new Map(entries.slice(entries.length >> 1));
      }

      const id = nextId.current++;
      setBursts((b) => [...b, { id, emoji: key }].slice(-MAX_CONCURRENT));
      // Longest particle lives ~2.6s; clear a touch after that.
      setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 2800);
    };

    client.on(RoomEvent.Timeline, onTimeline);
    return () => {
      client.removeListener(RoomEvent.Timeline, onTimeline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, room.roomId]);

  if (bursts.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-16 z-20 h-0 overflow-visible" aria-hidden>
      {bursts.map((burst) =>
        Array.from({ length: PARTICLES_PER_BURST }, (_, i) => {
          const drift = (Math.random() - 0.5) * 60; // vw
          const spin = (Math.random() - 0.5) * 720; // deg
          const dur = 1800 + Math.random() * 900;
          return (
            <span
              key={`${burst.id}-${i}`}
              className="jk-reaction-particle absolute text-2xl"
              style={
                {
                  left: `${10 + Math.random() * 80}%`,
                  animationDelay: `${Math.random() * 250}ms`,
                  "--jk-drift": `${drift}vw`,
                  "--jk-spin": `${spin}deg`,
                  "--jk-dur": `${dur}ms`,
                } as React.CSSProperties
              }
            >
              {burst.emoji}
            </span>
          );
        }),
      )}
    </div>
  );
}
