import { createForumPost, getForumTags } from "@jorkonvo/matrix-core";
import { type FormEvent, useState } from "react";
import { useTranslation } from "../../i18n";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { Modal, ModalField, modalInputClass, ModalPrimaryButton } from "../Modal";

/**
 * Modal for creating a new forum post (thread root) in a forum channel, with
 * optional tag selection from the room's configured forum tags.
 *
 * @param roomId - Matrix room ID of the forum channel to post in.
 */
export function CreateForumPostModal({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const close = useModalStore((s) => s.close);

  const room = client.getRoom(roomId);
  const tags = room ? getForumTags(room) : [];

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleTag(id: string) {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createForumPost(client, roomId, title.trim(), body.trim() || title.trim(), tagIds);
      close();
      // The post is a thread root - opening the thread panel for it (once
      // its local echo lands) matches how you'd naturally check on it right
      // after posting. It's fine if the echo hasn't landed by then; the
      // panel just shows nothing until it has.
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("createForum.title")} onClose={close}>
      <form onSubmit={handleSubmit}>
        <ModalField label={t("createForum.titleLabel")}>
          <input
            className={modalInputClass()}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("createForum.titlePlaceholder")}
            autoFocus
          />
        </ModalField>
        <ModalField label={t("createForum.bodyLabel")}>
          <textarea
            className={`${modalInputClass()} min-h-[80px] resize-y`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("createForum.bodyPlaceholder")}
          />
        </ModalField>
        {tags.length > 0 && (
          <div className="mb-3">
            <span className="mb-1 block text-xs font-bold uppercase text-muted">{t("createForum.tagsLabel")}</span>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => {
                const active = tagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleTag(tag.id)}
                    className="rounded-full border px-2.5 py-1 text-xs font-medium transition"
                    style={{
                      borderColor: tag.color,
                      color: active ? "#fff" : tag.color,
                      backgroundColor: active ? tag.color : "transparent",
                    }}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {error && <p className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
        <ModalPrimaryButton type="submit" disabled={!title.trim() || busy}>
          {busy ? t("createForum.posting") : t("createForum.post")}
        </ModalPrimaryButton>
      </form>
    </Modal>
  );
}
