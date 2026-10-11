import { type MatrixClient, type MatrixEvent, RelationType, type Room } from "matrix-js-sdk";

/**
 * Matrix polls per MSC3381 (org.matrix.msc3381.poll.*) - unstable (not yet
 * merged into the spec) but widely deployed for years via Element, so
 * treated here as stable enough to build on, unlike custom emoji (MSC2545,
 * genuinely still in flux - see formatting.ts's comment on that decision).
 */

export const POLL_START_EVENT = "org.matrix.msc3381.poll.start";
export const POLL_RESPONSE_EVENT = "org.matrix.msc3381.poll.response";
export const POLL_END_EVENT = "org.matrix.msc3381.poll.end";

const TEXT_KEY = "org.matrix.msc1767.text";

export interface PollAnswer {
  id: string;
  text: string;
}

export interface PollData {
  eventId: string;
  senderId: string;
  question: string;
  answers: PollAnswer[];
  maxSelections: number;
  disclosed: boolean;
  ts: number;
}

export interface PollTally {
  poll: PollData;
  votesByAnswer: Record<string, number>;
  totalVoters: number;
  myVote: string[] | null;
  ended: boolean;
}

type LooseSendEvent = (roomId: string, eventType: string, content: unknown) => Promise<unknown>;

export function isPollStartEvent(ev: MatrixEvent): boolean {
  return ev.getType() === POLL_START_EVENT;
}

export function parsePollEvent(ev: MatrixEvent): PollData | null {
  const eventId = ev.getId();
  if (!eventId) return null;
  const content = ev.getContent()[POLL_START_EVENT] as
    | {
        question?: { [TEXT_KEY]?: string };
        answers?: { id: string; [TEXT_KEY]?: string }[];
        max_selections?: number;
        kind?: string;
      }
    | undefined;
  if (!content) return null;

  return {
    eventId,
    senderId: ev.getSender() ?? "",
    question: content.question?.[TEXT_KEY] ?? "",
    answers: (content.answers ?? []).map((a) => ({ id: a.id, text: a[TEXT_KEY] ?? "" })),
    maxSelections: content.max_selections ?? 1,
    disclosed: content.kind === "org.matrix.msc3381.poll.disclosed",
    ts: ev.getTs(),
  };
}

export async function createPoll(
  client: MatrixClient,
  roomId: string,
  question: string,
  answers: string[],
  opts: { maxSelections?: number; disclosed?: boolean } = {},
): Promise<void> {
  const answerObjs = answers.map((text, i) => ({ id: `opt${i}`, [TEXT_KEY]: text }));
  const content = {
    [POLL_START_EVENT]: {
      question: { [TEXT_KEY]: question },
      kind: opts.disclosed ? "org.matrix.msc3381.poll.disclosed" : "org.matrix.msc3381.poll.undisclosed",
      max_selections: opts.maxSelections ?? 1,
      answers: answerObjs,
    },
    [TEXT_KEY]: `${question}\n${answers.map((a, i) => `${i + 1}. ${a}`).join("\n")}`,
  };
  await (client.sendEvent as unknown as LooseSendEvent)(roomId, POLL_START_EVENT, content);
}

export async function voteInPoll(
  client: MatrixClient,
  roomId: string,
  pollEventId: string,
  answerIds: string[],
): Promise<void> {
  const content = {
    [POLL_RESPONSE_EVENT]: { answers: answerIds },
    "m.relates_to": { rel_type: RelationType.Reference, event_id: pollEventId },
  };
  await (client.sendEvent as unknown as LooseSendEvent)(roomId, POLL_RESPONSE_EVENT, content);
}

export async function endPoll(client: MatrixClient, roomId: string, pollEventId: string): Promise<void> {
  const content = {
    [POLL_END_EVENT]: {},
    [TEXT_KEY]: "A szavazás lezárva.",
    "m.relates_to": { rel_type: RelationType.Reference, event_id: pollEventId },
  };
  await (client.sendEvent as unknown as LooseSendEvent)(roomId, POLL_END_EVENT, content);
}

/** Tallies a poll's votes from the room's already-loaded timeline (same manual-scan pattern used throughout this package). */
export function tallyPoll(room: Room, pollEventId: string, ownUserId: string): PollTally | null {
  const pollEvent = room.findEventById(pollEventId);
  const poll = pollEvent ? parsePollEvent(pollEvent) : null;
  if (!poll) return null;

  const latestBySender = new Map<string, { answers: string[]; ts: number }>();
  let ended = false;

  for (const ev of room.getLiveTimeline().getEvents()) {
    const relates = ev.getContent()?.["m.relates_to"];
    if (relates?.rel_type !== RelationType.Reference || relates.event_id !== pollEventId) continue;

    if (ev.getType() === POLL_RESPONSE_EVENT) {
      const sender = ev.getSender();
      if (!sender) continue;
      const answers = ((ev.getContent()[POLL_RESPONSE_EVENT] as { answers?: string[] } | undefined)?.answers ?? []).filter(
        (id) => poll.answers.some((a) => a.id === id),
      );
      const existing = latestBySender.get(sender);
      if (!existing || ev.getTs() >= existing.ts) latestBySender.set(sender, { answers, ts: ev.getTs() });
    } else if (ev.getType() === POLL_END_EVENT) {
      ended = true;
    }
  }

  const votesByAnswer: Record<string, number> = {};
  for (const a of poll.answers) votesByAnswer[a.id] = 0;
  for (const { answers } of latestBySender.values()) {
    for (const id of answers) votesByAnswer[id]++;
  }

  return {
    poll,
    votesByAnswer,
    totalVoters: [...latestBySender.values()].filter((v) => v.answers.length > 0).length,
    myVote: latestBySender.get(ownUserId)?.answers ?? null,
    ended,
  };
}
