import type { Room } from "@jorkonvo/matrix-core";
import { useTranslation } from "../i18n";
import { useMatrixStore } from "../state/matrixStore";

/**
 * Shows "X is typing…" below the timeline for the given room, driven by the
 * sync tick. Reserved-height placeholder keeps the layout stable when idle.
 *
 * @param room - the room whose typing members are shown.
 */
export function TypingIndicator({ room }: { room: Room }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client);
  useMatrixStore((s) => s.syncTick);
  if (!client) return null;

  const ownUserId = client.getUserId();
  const typingNames = room
    .getMembers()
    .filter((m) => m.typing && m.userId !== ownUserId)
    .map((m) => m.name);

  if (typingNames.length === 0) return <div className="h-5 px-4" />;

  const text =
    typingNames.length === 1
      ? t("typing.one", { name: typingNames[0]! })
      : typingNames.length === 2
        ? t("typing.two", { a: typingNames[0]!, b: typingNames[1]! })
        : t("typing.many", { count: typingNames.length });

  return (
    <div role="log" aria-live="polite" className="flex h-5 items-center gap-1.5 px-4 text-xs text-muted">
      <span className="flex gap-0.5">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
      </span>
      {text}
    </div>
  );
}
