import type { MatrixClient, RoomEmoji, RoomMember, SpaceRole } from "@jorkonvo/matrix-core";
import { useTranslation } from "../i18n";
import { useEffect, useRef } from "react";
import { AuthedImg } from "./AuthedImg";
import { Avatar } from "./Avatar";

export type MentionCandidate =
  | { kind: "member"; member: RoomMember }
  | { kind: "room" }
  | { kind: "here" }
  | { kind: "spaceRole"; role: SpaceRole }
  | { kind: "customEmoji"; emoji: RoomEmoji }
  | { kind: "unicodeEmoji"; code: string; char: string };

function candidateKey(c: MentionCandidate): string {
  if (c.kind === "member") return c.member.userId;
  if (c.kind === "spaceRole") return `@role:${c.role.id}`;
  if (c.kind === "customEmoji") return `:${c.emoji.shortcode}:`;
  if (c.kind === "unicodeEmoji") return `:${c.code}:`;
  return `@${c.kind}`;
}

/**
 * The autocomplete popup above the composer (members, @room/@here, roles,
 * custom/unicode emoji). Purely mouse-interactive by design - keyboard focus
 * stays in the textarea, which acts as a combobox driving `activeIndex`
 * (see MessageComposer's handleKeyDown) and points aria-activedescendant at
 * this listbox's options.
 *
 * @param candidates - already filtered (by query) and capped candidate list, in display order.
 * @param client - Matrix client, used for member avatars.
 * @param activeIndex - index of the currently highlighted candidate.
 * @param onHover - called with a candidate index on mouse hover.
 * @param onPick - called with the candidate when one is activated.
 */
export function MentionAutocomplete({
  candidates,
  client,
  activeIndex,
  onHover,
  onPick,
}: {
  /** Already filtered (by query) and capped candidate list, in display order. */
  candidates: MentionCandidate[];
  client: MatrixClient;
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (candidate: MentionCandidate) => void;
}) {
  const { t } = useTranslation();
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (candidates.length === 0) return null;

  return (
    <div
      id="jk-mention-listbox"
      role="listbox"
      className="absolute bottom-full left-0 mb-1 max-h-56 w-64 overflow-y-auto rounded-lg border border-border bg-bg-secondary py-1 shadow-lg"
    >
      {candidates.map((c, i) => (
        <button
          key={candidateKey(c)}
          id={`jk-mention-opt-${i}`}
          ref={i === activeIndex ? activeRef : undefined}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(c);
          }}
          onMouseEnter={() => onHover(i)}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
            i === activeIndex ? "bg-bg-modifier-hover" : ""
          }`}
        >
          {c.kind === "room" ? (
            <>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-dnd/20 text-[11px] font-bold text-dnd">
                @
              </span>
              <div className="min-w-0">
                <div className="truncate text-normal">room</div>
                <div className="truncate text-[11px] text-muted">{t("mention.roomHint")}</div>
              </div>
            </>
          ) : c.kind === "here" ? (
            <>
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-online)]/20 text-[11px] font-bold"
                style={{ color: "var(--color-online)" }}
              >
                @
              </span>
              <div className="min-w-0">
                <div className="truncate text-normal">here</div>
                <div className="truncate text-[11px] text-muted">{t("mention.hereHint")}</div>
              </div>
            </>
          ) : c.kind === "spaceRole" ? (
            <>
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                style={{ backgroundColor: `${c.role.color}33`, color: c.role.color }}
              >
                @
              </span>
              <div className="min-w-0">
                <div className="truncate font-medium" style={{ color: c.role.color }}>
                  {c.role.name}
                </div>
                <div className="truncate text-[11px] text-muted">{t("mention.roleHint")}</div>
              </div>
            </>
          ) : c.kind === "customEmoji" ? (
            <>
              <AuthedImg
                mxc={c.emoji.mxcUrl}
                alt={`:${c.emoji.shortcode}:`}
                width={20}
                height={20}
                className="h-5 w-5 shrink-0"
              />
              <span className="truncate text-normal">:{c.emoji.shortcode}:</span>
            </>
          ) : c.kind === "unicodeEmoji" ? (
            <>
              <span className="w-5 shrink-0 text-center text-lg leading-none">{c.char}</span>
              <span className="truncate text-normal">:{c.code}:</span>
            </>
          ) : (
            <>
              <Avatar
                url={c.member.getAvatarUrl(client.baseUrl, 20, 20, "crop", false, false)}
                name={c.member.name}
                size={20}
              />
              <span className="truncate text-normal">{c.member.name}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
