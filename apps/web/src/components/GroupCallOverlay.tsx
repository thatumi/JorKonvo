import { useTranslation } from "../i18n";
import { useGroupCallStore } from "../state/groupCallStore";
import { useMatrixStore } from "../state/matrixStore";
import { GroupCallScreen } from "./GroupCallScreen";

/** Resolves the active group call's Matrix room and renders the call screen. */
export function GroupCallOverlay() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client);
  const room = useGroupCallStore((s) => s.room);
  const matrixRoomId = useGroupCallStore((s) => s.matrixRoomId);
  const connecting = useGroupCallStore((s) => s.connecting);
  const error = useGroupCallStore((s) => s.error);
  const clearError = useGroupCallStore((s) => s.clearError);

  if (!room || !client || !matrixRoomId) {
    if (error) {
      return (
        <div role="alert" className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-dnd px-4 pb-2 pt-[calc(0.5rem_+_env(safe-area-inset-top))] text-center text-sm text-white">
          <span>{error === "voiceChannelFull" ? t("call.channelFull") : error}</span>
          <button type="button" onClick={clearError} aria-label={t("common.close")} className="font-bold hover:underline">
            ✕
          </button>
        </div>
      );
    }
    // getLivekitConnectionInfo + room.connect() + publishing the mic can take
    // a real moment (permission prompt, media negotiation) - without this,
    // clicking a voice channel visibly does nothing until it either succeeds
    // (the call screen appears) or fails (the error banner above), which
    // reads as the click not having registered at all.
    if (connecting) {
      return (
        <div aria-live="polite" className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-bg-floating px-4 pb-2 pt-[calc(0.5rem_+_env(safe-area-inset-top))] text-center text-sm text-normal shadow-md">
          <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin text-brand" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span>{t("call.connectingToVoice")}</span>
        </div>
      );
    }
    return null;
  }

  const matrixRoom = client.getRoom(matrixRoomId);
  if (!matrixRoom) return null;

  return <GroupCallScreen matrixRoom={matrixRoom} />;
}
