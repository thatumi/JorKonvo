import { PERSONAL_EMOJI_SOURCE_ID, type RoomEmoji } from "@jorkonvo/matrix-core";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../i18n";
import {
  EMOJI_PICKER_GROUPS,
  searchUnicodeEmoji,
  UNICODE_EMOJI,
  type UnicodeEmoji,
} from "../lib/unicodeEmoji";
import { AuthedImg } from "./AuthedImg";

/** What the picker hands back: a Unicode character, or a custom emoji (shortcode + mxc). */
export type EmojiPick = { char: string } | { shortcode: string; mxcUrl: string };

const PICKER_WIDTH = 288;
const PICKER_MAX_HEIGHT = 360;

const GROUP_LABEL_KEY: Record<string, string> = {
  smileys: "emoji.groupSmileys",
  people: "emoji.groupPeople",
  nature: "emoji.groupNature",
  food: "emoji.groupFood",
  activities: "emoji.groupActivities",
  travel: "emoji.groupTravel",
  objects: "emoji.groupObjects",
  symbols: "emoji.groupSymbols",
};

const BY_GROUP = EMOJI_PICKER_GROUPS.map((g) => ({
  group: g,
  emoji: UNICODE_EMOJI.filter((e) => e.group === g),
}));

/**
 * Portal-rendered emoji picker popover anchored to a trigger element: a search
 * box over the built-in Unicode set, plus custom room/space/personal emoji
 * packs grouped by source. Flips above the anchor when there's no room below;
 * closes on outside pointer-down or Escape.
 *
 * @param anchorEl - Trigger element the popover is positioned against.
 * @param onPick - Called with the picked Unicode char, or a custom emoji (shortcode + mxc).
 * @param onClose - Called when the picker is dismissed (outside click / Escape).
 * @param customEmoji - Usable custom emoji; when non-empty, a "Custom" section is shown first.
 */
export function EmojiPicker({
  anchorEl,
  onPick,
  onClose,
  customEmoji = [],
}: {
  anchorEl: HTMLElement;
  onPick: (pick: EmojiPick) => void;
  onClose: () => void;
  /** When non-empty, a "Custom" section is shown first. */
  customEmoji?: RoomEmoji[];
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  const [query, setQuery] = useState("");

  useEffect(() => {
    const rect = anchorEl.getBoundingClientRect();
    const spaceAbove = rect.top;
    const openUpward = spaceAbove > PICKER_MAX_HEIGHT || spaceAbove > window.innerHeight - rect.bottom;
    let left = rect.right - PICKER_WIDTH;
    left = Math.max(8, Math.min(left, window.innerWidth - PICKER_WIDTH - 8));
    const top = openUpward
      ? Math.max(8, rect.top - 8)
      : Math.min(rect.bottom + 8, window.innerHeight - 8);
    setStyle({
      position: "fixed",
      left,
      top,
      transform: openUpward ? "translateY(-100%)" : undefined,
      maxHeight: PICKER_MAX_HEIGHT,
    });
  }, [anchorEl]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node) && e.target !== anchorEl) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, anchorEl]);

  const filteredCustom = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? customEmoji.filter((e) => e.shortcode.toLowerCase().includes(q))
      : customEmoji;
  }, [customEmoji, query]);

  // Grouped by source room/space (or the personal pack) so it's clear which
  // server a given custom emoji belongs to, instead of one big mixed grid -
  // preserving first-seen order (getAllUsableEmojis already puts the
  // current room/space first).
  const customGroups = useMemo(() => {
    const order: string[] = [];
    const bySource = new Map<string, { name: string; emoji: RoomEmoji[] }>();
    for (const e of filteredCustom) {
      let group = bySource.get(e.sourceId);
      if (!group) {
        const name = e.sourceId === PERSONAL_EMOJI_SOURCE_ID ? t("emoji.groupPersonal") : e.sourceName;
        group = { name, emoji: [] };
        bySource.set(e.sourceId, group);
        order.push(e.sourceId);
      }
      group.emoji.push(e);
    }
    return order.map((id) => bySource.get(id)!);
  }, [filteredCustom, t]);

  const searchResults: UnicodeEmoji[] = query.trim() ? searchUnicodeEmoji(query, 60) : [];

  return createPortal(
    <div
      ref={ref}
      style={style}
      className="z-50 flex w-72 flex-col overflow-hidden rounded-lg border border-border bg-bg-secondary shadow-xl"
    >
      <div className="shrink-0 border-b border-border p-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("emoji.search")}
          aria-label={t("emoji.search")}
          className="w-full rounded bg-bg-darkest px-2.5 py-1.5 text-sm text-normal outline-none focus:ring-1 focus:ring-brand"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {customGroups.length > 0 && (
          <div className="mb-2">
            <div className="mb-1 text-[11px] font-bold uppercase text-muted">{t("emoji.groupCustom")}</div>
            {customGroups.map((group) => (
              <div key={group.name} className="mb-1.5 last:mb-0">
                {customGroups.length > 1 && (
                  <div className="mb-0.5 truncate text-[10px] font-medium text-muted/70">{group.name}</div>
                )}
                <div className="grid grid-cols-8 gap-0.5">
                  {group.emoji.map((e) => (
                    <button
                      key={e.shortcode}
                      type="button"
                      title={`:${e.shortcode}:`}
                      aria-label={`:${e.shortcode}:`}
                      onClick={() => onPick({ shortcode: e.shortcode, mxcUrl: e.mxcUrl })}
                      className="flex h-7 w-7 items-center justify-center rounded hover:bg-bg-modifier-hover"
                    >
                      <AuthedImg mxc={e.mxcUrl} alt={e.shortcode} width={24} height={24} className="h-5 w-5" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {query.trim() ? (
          searchResults.length === 0 && filteredCustom.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted">{t("emoji.noResults")}</p>
          ) : (
            <div className="grid grid-cols-8 gap-0.5">
              {searchResults.map((e) => (
                <button
                  key={e.code}
                  type="button"
                  title={`:${e.code}:`}
                  aria-label={`:${e.code}:`}
                  onClick={() => onPick({ char: e.char })}
                  className="flex h-7 w-7 items-center justify-center rounded text-lg hover:bg-bg-modifier-hover"
                >
                  {e.char}
                </button>
              ))}
            </div>
          )
        ) : (
          BY_GROUP.map(({ group, emoji }) => (
            <div key={group} className="mb-2 last:mb-0">
              <div className="mb-1 text-[11px] font-bold uppercase text-muted">
                {t(GROUP_LABEL_KEY[group] ?? group)}
              </div>
              <div className="grid grid-cols-8 gap-0.5">
                {emoji.map((e) => (
                  <button
                    key={e.code}
                    type="button"
                    title={`:${e.code}:`}
                    aria-label={`:${e.code}:`}
                    onClick={() => onPick({ char: e.char })}
                    className="flex h-7 w-7 items-center justify-center rounded text-lg hover:bg-bg-modifier-hover"
                  >
                    {e.char}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>,
    document.body,
  );
}
