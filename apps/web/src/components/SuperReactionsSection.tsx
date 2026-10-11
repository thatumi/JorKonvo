import {
  clearSuperReactions,
  getOwningSpace,
  getSuperReactionsConfig,
  resolveSuperReactions,
  setSuperReactions,
} from "@jorkonvo/matrix-core";
import { useRef, useState } from "react";
import { useTranslation } from "../i18n";
import { UNICODE_EMOJI } from "../lib/unicodeEmoji";
import { useMatrixStore } from "../state/matrixStore";
import { EmojiPicker } from "./EmojiPicker";

/** Shortcode lookup so super-reaction buttons get a real name ("heart", not "❤"). */
const CODE_BY_CHAR = new Map(UNICODE_EMOJI.map((e) => [e.char, e.code]));

/**
 * Editor for a room's or space's "super reaction" list (see ReactionEffects /
 * superReactions.ts). Shown in Room settings and Space settings for anyone
 * who can send the state event.
 */
export function SuperReactionsSection({ targetId, scope }: { targetId: string; scope: "room" | "space" }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const room = client.getRoom(targetId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);

  if (!room) return null;

  const ownList = getSuperReactionsConfig(room);
  const effective = resolveSuperReactions(client, room);
  const hasOwnSpace =
    scope === "room" && getOwningSpace(client, targetId) !== null && getOwningSpace(client, targetId)?.roomId !== targetId;

  const sourceKey =
    ownList !== null
      ? scope === "space"
        ? "superReact.usingCustomSpace"
        : "superReact.usingCustom"
      : hasOwnSpace && getSuperReactionsConfig(getOwningSpace(client, targetId)!) !== null
        ? "superReact.usingSpace"
        : "superReact.usingDefault";

  const list = ownList ?? effective;

  function save(next: string[]) {
    void setSuperReactions(client, targetId, next);
  }

  return (
    <div>
      <h3 className="mb-1 text-xs font-bold uppercase text-muted">{t("superReact.title")}</h3>
      <p className="mb-2 text-xs text-muted">{t("superReact.hint")}</p>
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        {list.map((emoji) => {
          const code = CODE_BY_CHAR.get(emoji);
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => save(list.filter((e) => e !== emoji))}
              title={emoji}
              aria-label={t("common.removeEmoji", { emoji: code ? `:${code}:` : emoji })}
              className="flex h-8 w-8 items-center justify-center rounded bg-bg-darkest text-lg transition hover:bg-dnd/20"
            >
              {emoji}
            </button>
          );
        })}
        <button
          ref={addRef}
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="flex h-8 items-center rounded border border-dashed border-border px-2 text-xs font-medium text-muted hover:border-muted hover:text-normal"
        >
          + {t("superReact.add")}
        </button>
        {pickerOpen && addRef.current && (
          <EmojiPicker
            anchorEl={addRef.current}
            onPick={(pick) => {
              if ("char" in pick && !list.includes(pick.char)) save([...list, pick.char]);
              setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted">
        <span>{t(sourceKey)}</span>
        {ownList !== null && ownList.length === 0 && <span>{t("superReact.disabledNote")}</span>}
        {ownList !== null && (
          <button
            type="button"
            onClick={() => void clearSuperReactions(client, targetId)}
            className="font-medium text-link hover:underline"
          >
            {t("superReact.reset")}
          </button>
        )}
      </div>
    </div>
  );
}
