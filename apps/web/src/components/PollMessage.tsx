import { endPoll, parsePollEvent, type Room, tallyPoll, voteInPoll } from "@jorkonvo/matrix-core";
import clsx from "clsx";
import { type MatrixEvent } from "matrix-js-sdk";
import { useState } from "react";
import { useTranslation } from "../i18n";
import { uiConfirm } from "../lib/dialogs";
import { useMatrixStore } from "../state/matrixStore";

/**
 * Interactive poll message: one toggle button per answer (single- or
 * multi-select depending on the poll's config), a results bar overlay with
 * per-answer counts whenever the poll is disclosed or ended, and a
 * "close poll" action for the poll's owner.
 *
 * @param ev - The poll start event to render.
 * @param room - The room the poll lives in (votes are tallied from it).
 */
export function PollMessage({ ev, room }: { ev: MatrixEvent; room: Room }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const [busy, setBusy] = useState(false);

  const eventId = ev.getId();
  if (!eventId) return null;

  const poll = parsePollEvent(ev);
  const tally = tallyPoll(room, eventId, client.getUserId() ?? "");
  if (!poll || !tally) return null;

  const isOwner = poll.senderId === client.getUserId();
  const totalVotes = Object.values(tally.votesByAnswer).reduce((a, b) => a + b, 0);
  // An undisclosed poll hides the running tally until it's ended - only
  // disclosed polls (or an ended poll, either way) show live results.
  const showResults = poll.disclosed || tally.ended;

  async function handleVote(answerId: string) {
    if (busy || tally!.ended) return;
    setBusy(true);
    try {
      const current = tally!.myVote ?? [];
      let next: string[];
      if (poll!.maxSelections <= 1) {
        next = current.includes(answerId) ? [] : [answerId];
      } else if (current.includes(answerId)) {
        next = current.filter((id) => id !== answerId);
      } else if (current.length >= poll!.maxSelections) {
        next = current;
      } else {
        next = [...current, answerId];
      }
      await voteInPoll(client, room.roomId, eventId!, next);
    } finally {
      setBusy(false);
    }
  }

  async function handleEnd() {
    if (!(await uiConfirm(t("poll.closeConfirm")))) return;
    setBusy(true);
    try {
      await endPoll(client, room.roomId, eventId!);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1 max-w-md rounded-lg border border-border bg-bg-secondary p-3">
      <div className="mb-2 flex items-start gap-2">
        <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-brand" fill="currentColor" aria-hidden="true">
          <path d="M3 13h4v8H3v-8Zm7-9h4v17h-4V4Zm7 5h4v12h-4V9Z" />
        </svg>
        <span className="font-medium text-header">{poll.question}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {poll.answers.map((answer) => {
          const count = tally.votesByAnswer[answer.id] ?? 0;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const selected = tally.myVote?.includes(answer.id) ?? false;
          return (
            <button
              key={answer.id}
              type="button"
              disabled={busy || tally.ended}
              aria-pressed={selected}
              onClick={() => void handleVote(answer.id)}
              className={clsx(
                "relative overflow-hidden rounded border px-2.5 py-1.5 text-left text-sm transition disabled:cursor-default",
                selected ? "border-brand" : "border-border",
              )}
            >
              {showResults && (
                <div className="absolute inset-y-0 left-0 bg-brand/15" style={{ width: `${pct}%` }} aria-hidden />
              )}
              <div className="relative flex items-center justify-between gap-2">
                <span className={clsx("truncate", selected ? "font-medium text-header" : "text-normal")}>
                  {selected && "✓ "}
                  {answer.text}
                </span>
                {showResults && (
                  <span className="shrink-0 text-xs text-muted">
                    {count} · {pct}%
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span aria-live="polite">
          {showResults
            ? t("poll.voteCount", { count: tally.totalVoters })
            : t("poll.hiddenUntilClose")}{" "}
          {poll.maxSelections > 1 ? t("poll.maxAnswers", { count: poll.maxSelections }) : ""}
          {tally.ended && ` · ${t("poll.closedTag")}`}
        </span>
        {isOwner && !tally.ended && (
          <button type="button" onClick={() => void handleEnd()} disabled={busy} className="font-medium text-link hover:underline">
            {t("poll.close")}
          </button>
        )}
      </div>
    </div>
  );
}
