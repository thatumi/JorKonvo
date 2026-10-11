import {
  addPersonalEmoji,
  addRoomEmoji,
  getPersonalEmojis,
  getRoomEmojis,
  removePersonalEmoji,
  removeRoomEmoji,
} from "@jorkonvo/matrix-core";
import { useRef, useState } from "react";
import { useTranslation } from "../i18n";
import { useMatrixStore } from "../state/matrixStore";
import { modalInputClass } from "./Modal";
import { AuthedImg } from "./AuthedImg";

/**
 * The `im.ponies.room_emotes` pack editor for one room, one space, or (scope
 * "personal") the current account's own pack (personalEmoji.ts) - the only
 * one of the three that isn't a room-state event, so it needs no `targetId`.
 * Shared by RoomSettingsModal (per-channel), SpaceSettingsModal
 * (server-wide) and UserSettingsModal (personal).
 */
export function EmojiPackManager({ targetId, scope }: { targetId?: string; scope: "room" | "space" | "personal" }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const target = scope !== "personal" && targetId ? client.getRoom(targetId) : null;
  const emojis = scope === "personal" ? getPersonalEmojis(client) : target ? getRoomEmojis(target) : [];

  const [shortcode, setShortcode] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function add() {
    const code = shortcode.trim().replace(/^:|:$/g, "");
    if (!code || !file) return;
    setBusy(true);
    setError(null);
    try {
      if (scope === "personal") await addPersonalEmoji(client, code, file);
      else await addRoomEmoji(client, targetId!, code, file);
      setShortcode("");
      setFile(null);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(code: string) {
    setBusy(true);
    setError(null);
    try {
      if (scope === "personal") await removePersonalEmoji(client, code);
      else await removeRoomEmoji(client, targetId!, code);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3 className="mb-1 text-xs font-bold uppercase text-muted">
        {scope === "space"
          ? t("emojiPack.serverTitle")
          : scope === "personal"
            ? t("emojiPack.personalTitle")
            : t("emojiPack.roomTitle")}
      </h3>
      <p className="mb-2 text-xs text-muted">{t("emojiPack.hint")}</p>
      {emojis.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {emojis.map((e) => (
            <span
              key={e.shortcode}
              className="flex items-center gap-1.5 rounded-full bg-bg-darkest py-1 pl-1 pr-2 text-xs text-normal"
            >
              <AuthedImg mxc={e.mxcUrl} alt={e.shortcode} width={20} height={20} className="h-5 w-5" />
              :{e.shortcode}:
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(e.shortcode)}
                title={t("common.remove")}
                aria-label={t("common.removeEmoji", { emoji: `:${e.shortcode}:` })}
                className="text-muted hover:text-dnd disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
                  <path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.3 19.7 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.29-6.3Z" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border hover:bg-bg-modifier-hover"
          title={t("emojiPack.pickImage")}
          aria-label={t("emojiPack.pickImage")}
        >
          {preview ? <img src={preview} alt="" className="h-6 w-6 object-contain" /> : "🙂"}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={pickFile} />
        <input
          className={modalInputClass()}
          value={shortcode}
          onChange={(e) => setShortcode(e.target.value.replace(/[^A-Za-z0-9_-]/g, ""))}
          placeholder={t("emojiPack.shortcodePlaceholder")}
        />
        <button
          type="button"
          disabled={busy || !shortcode.trim() || !file}
          onClick={() => void add()}
          className="shrink-0 rounded bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
        >
          {t("common.add")}
        </button>
      </div>
      {error && <p className="mt-2 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
    </div>
  );
}
