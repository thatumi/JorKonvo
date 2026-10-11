import { getPinnedEventIds, isStickerEvent, stripReplyFallback, unpinMessage } from "@jorkonvo/matrix-core";
import type { MatrixEvent } from "matrix-js-sdk";
import { useTranslation } from "../../i18n";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { Avatar } from "../Avatar";
import { MediaAttachment } from "../MediaAttachment";
import { Modal } from "../Modal";
import { StickerMessage } from "../StickerMessage";

const MEDIA_MSGTYPES = new Set(["m.image", "m.video", "m.audio", "m.file"]);

/** Renders a pinned event's content properly - image thumbnail, sticker,
 *  file card, etc. - not just its `body` string (which for an image is only
 *  the filename). */
function PinnedContent({ ev }: { ev: MatrixEvent }) {
  const { t } = useTranslation();
  if (isStickerEvent(ev)) return <StickerMessage ev={ev} />;
  const msgtype = ev.getContent().msgtype as string | undefined;
  if (msgtype && MEDIA_MSGTYPES.has(msgtype)) return <MediaAttachment ev={ev} />;
  return (
    <p className="whitespace-pre-wrap break-words text-sm text-normal">
      {stripReplyFallback((ev.getContent().body as string) ?? "") || (
        <span className="text-muted">{t("pinned.emptyMessage")}</span>
      )}
    </p>
  );
}

/** Lists a room's pinned messages with rendered content (`PinnedContent`) and an unpin action per message. */
export function PinnedMessagesModal({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const close = useModalStore((s) => s.close);

  const room = client.getRoom(roomId);
  if (!room) return null;

  const pinnedIds = getPinnedEventIds(room);
  const events = pinnedIds
    .map((id) => room.findEventById(id))
    .filter((ev): ev is NonNullable<typeof ev> => !!ev);

  return (
    <Modal title={t("pinned.title")} onClose={close}>
      {events.length === 0 && <p className="text-sm text-muted">{t("pinned.empty")}</p>}
      <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
        {events.map((ev) => {
          const member = room.getMember(ev.getSender() ?? "");
          return (
            <div key={ev.getId()} className="flex items-start gap-2.5 rounded bg-bg-secondary p-2.5">
              <Avatar
                url={member?.getAvatarUrl(client.baseUrl, 28, 28, "crop", false, false) ?? null}
                name={member?.name ?? ev.getSender() ?? "?"}
                size={28}
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-header">{member?.name ?? ev.getSender()}</div>
                <PinnedContent ev={ev} />
              </div>
              <button
                type="button"
                onClick={() => void unpinMessage(client, roomId, ev.getId()!)}
                title={t("pinned.unpin")}
                aria-label={t("pinned.unpin")}
                className="shrink-0 rounded p-1 text-muted hover:text-dnd"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
