import {
  getPersonalStickers,
  type PersonalSticker,
  removePersonalSticker,
  savePersonalSticker,
  sendPersonalSticker,
  sendSticker,
} from "@jorkonvo/matrix-core";
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "../../i18n";
import { useAuthedMedia } from "../../lib/authedMedia";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { Modal, ModalField, modalInputClass, ModalPrimaryButton } from "../Modal";

function PersonalStickerButton({
  sticker,
  onClick,
  onDelete,
  disabled,
  managing,
  tDelete,
}: {
  sticker: PersonalSticker;
  onClick: () => void;
  onDelete: () => void;
  disabled: boolean;
  managing: boolean;
  tDelete: string;
}) {
  const url = useAuthedMedia(sticker.url, { width: 128, height: 128, method: "scale" });
  return (
    <div className="group/st relative">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        title={sticker.body}
        className="flex aspect-square w-full items-center justify-center rounded bg-bg-darkest p-1.5 hover:bg-bg-modifier-hover disabled:opacity-50"
      >
        {url ? (
          <img src={url} alt={sticker.body} className="max-h-full max-w-full" />
        ) : (
          <div className="h-full w-full animate-pulse rounded bg-bg-secondary" />
        )}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title={tDelete}
        aria-label={tDelete}
        className={`absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-dnd text-white transition ${
          managing ? "opacity-100" : "opacity-0 group-hover/st:opacity-100"
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
          <path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.3 19.7 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.29-6.3Z" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Sticker picker + uploader for a room: send a personal sticker from the
 * saved collection, or upload a new image (optionally saving it to the
 * collection) and send it. A manage mode reveals per-sticker delete buttons.
 *
 * @param roomId - ID of the room the chosen sticker is sent to.
 */
export function SendStickerModal({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const bumpTick = useMatrixStore((s) => s.bumpTick);
  const close = useModalStore((s) => s.close);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [saveToCollection, setSaveToCollection] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [managing, setManaging] = useState(false);
  useMatrixStore((s) => s.syncTick);
  const personal = getPersonalStickers(client);

  async function handleDeleteSticker(sticker: PersonalSticker) {
    try {
      await removePersonalSticker(client, sticker.url);
      bumpTick();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function pickFile(f: File) {
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function handleSendExisting(sticker: PersonalSticker) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendPersonalSticker(client, roomId, sticker);
      close();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendSticker(client, roomId, file, description);
      if (saveToCollection) {
        // The collection always stores a plain (unencrypted) copy so it can be
        // sent into any room later - re-upload one regardless of this room's
        // encryption. Best-effort: a failed save shouldn't undo a sent sticker.
        try {
          const upload = await client.uploadContent(file, { type: file.type || "image/png" });
          await savePersonalSticker(client, {
            body: description.trim() || file.name,
            url: upload.content_uri,
          });
          bumpTick();
        } catch (saveErr) {
          console.error("failed to save sticker to collection", saveErr);
        }
      }
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("sticker.title")} onClose={close}>
      {personal.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-muted">{t("sticker.mine")}</span>
            <button
              type="button"
              onClick={() => setManaging((v) => !v)}
              aria-pressed={managing}
              className="text-xs font-medium text-link hover:underline"
            >
              {managing ? t("sticker.manageDone") : t("sticker.manage")}
            </button>
          </div>
          <div className="grid max-h-52 grid-cols-4 gap-2 overflow-y-auto p-1">
            {personal.map((sticker) => (
              <PersonalStickerButton
                key={sticker.url}
                sticker={sticker}
                disabled={busy}
                managing={managing}
                tDelete={t("sticker.deleteOne")}
                onClick={() => {
                  if (managing) void handleDeleteSticker(sticker);
                  else void handleSendExisting(sticker);
                }}
                onDelete={() => void handleDeleteSticker(sticker)}
              />
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <span className="mb-2 block text-xs font-bold uppercase text-muted">
          {t(personal.length > 0 ? "sticker.new" : "sticker.title")}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pickFile(f);
          }}
        />
        {preview ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label={t("sticker.pickImage")}
            className="mb-3 flex items-center justify-center rounded bg-bg-darkest p-3"
          >
            <img src={preview} alt="" className="max-h-32 max-w-32" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mb-3 w-full rounded border border-dashed border-border py-6 text-sm text-muted hover:text-normal"
          >
            {t("sticker.pickImage")}
          </button>
        )}
        <ModalField label={t("sticker.description")}>
          <input
            className={modalInputClass()}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("sticker.descriptionPlaceholder")}
          />
        </ModalField>
        <label className="mb-3 flex items-center gap-2 text-sm text-normal">
          <input
            type="checkbox"
            checked={saveToCollection}
            onChange={(e) => setSaveToCollection(e.target.checked)}
            className="h-4 w-4"
          />
          {t("sticker.saveToCollection")}
        </label>
        {error && <p role="alert" className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
        <ModalPrimaryButton type="submit" disabled={!file || busy}>
          {busy ? t("sticker.sending") : t("sticker.send")}
        </ModalPrimaryButton>
      </form>
    </Modal>
  );
}
