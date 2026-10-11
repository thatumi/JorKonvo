import { startWatchTogether } from "@jorkonvo/matrix-core";
import { type FormEvent, useState } from "react";
import { useTranslation } from "../../i18n";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { parseYouTubeVideoId } from "../RichEmbed";
import { Modal, ModalField, modalInputClass, ModalPrimaryButton } from "../Modal";

/**
 * Modal for starting a Watch Together session in a room: paste a YouTube URL,
 * which is validated client-side before the session state is sent.
 *
 * @param roomId - Matrix room ID of the room the session starts in.
 */
export function StartWatchTogetherModal({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const close = useModalStore((s) => s.close);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoId = parseYouTubeVideoId(url.trim());

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!videoId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await startWatchTogether(client, roomId, videoId);
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("watchTogether.startTitle")} onClose={close}>
      <form onSubmit={handleSubmit}>
        <ModalField label={t("watchTogether.urlLabel")}>
          <input
            className={modalInputClass()}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            autoFocus
          />
        </ModalField>
        {url.trim() && !videoId && <p className="mb-3 text-xs text-dnd">{t("watchTogether.invalidUrl")}</p>}
        <p className="mb-4 text-xs text-muted">{t("watchTogether.startHint")}</p>
        {error && <p className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
        <ModalPrimaryButton type="submit" disabled={!videoId || busy}>
          {busy ? t("watchTogether.starting") : t("watchTogether.start")}
        </ModalPrimaryButton>
      </form>
    </Modal>
  );
}
