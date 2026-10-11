import { getOwningSpace, getSortedJoinedRooms, isSpaceRoom, type Room } from "@jorkonvo/matrix-core";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useMatrixStore } from "../state/matrixStore";
import { useUiStore } from "../state/uiStore";
import { Avatar } from "./Avatar";
import { useTranslation } from "../i18n";

/** Discord-style Ctrl/Cmd+K "jump to room" switcher, available anywhere in the app. */
export function QuickSwitcher() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client);
  useMatrixStore((s) => s.syncTick);
  const selectRoom = useUiStore((s) => s.selectRoom);
  const selectSpace = useUiStore((s) => s.selectSpace);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const optionId = (i: number) => `${listboxId}-option-${i}`;

  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const rooms = useMemo(
    () => (client ? getSortedJoinedRooms(client).filter((r) => !isSpaceRoom(r)) : []),
    [client, open],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? rooms.filter((r) => r.name.toLowerCase().includes(q)) : rooms;
    return matches.slice(0, 20);
  }, [rooms, query]);

  if (!open || !client) return null;

  function pick(room: Room) {
    if (!client) return;
    const owningSpace = getOwningSpace(client, room.roomId);
    selectSpace(owningSpace ? owningSpace.roomId : null);
    selectRoom(room.roomId);
    setOpen(false);
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[index]) pick(filtered[index]);
    }
  }

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-24 backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
    >
      <div
        className="animate-scale-in w-full max-w-lg overflow-hidden rounded-lg bg-bg-secondary shadow-xl ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          role="combobox"
          aria-expanded={filtered.length > 0}
          aria-controls={filtered.length > 0 ? listboxId : undefined}
          aria-activedescendant={filtered.length > 0 ? optionId(index) : undefined}
          aria-label={t("quickSwitcher.placeholder")}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder={t("quickSwitcher.placeholder")}
          className="w-full border-b border-border bg-transparent px-4 py-3 text-[15px] text-normal outline-none placeholder:text-muted"
        />
        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted">{t("sidebar.noResults")}</div>
          ) : (
            <div role="listbox" id={listboxId} aria-label={t("quickSwitcher.placeholder")}>
              {filtered.map((room, i) => (
                <button
                  key={room.roomId}
                  type="button"
                  role="option"
                  id={optionId(i)}
                  aria-selected={i === index}
                  onClick={() => pick(room)}
                  onMouseEnter={() => setIndex(i)}
                  className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm ${
                    i === index ? "bg-bg-modifier-hover" : ""
                  }`}
                >
                  <Avatar url={room.getAvatarUrl(client.baseUrl, 24, 24, "crop", false)} name={room.name || "?"} size={24} />
                  <span className="truncate text-normal">{room.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
