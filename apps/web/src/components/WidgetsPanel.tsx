import { buildWidgetUrl, canManageWidgets, getRoomWidgets, removeWidget, type Room } from "@jorkonvo/matrix-core";
import { useState } from "react";
import { useTranslation } from "../i18n";
import { uiConfirm } from "../lib/dialogs";
import { useMatrixStore } from "../state/matrixStore";
import { useModalStore } from "../state/modalStore";
import { useThemeStore } from "../state/themeStore";
import { useUiStore } from "../state/uiStore";

/**
 * Full-width widget view (replaces the timeline/composer while open, like
 * Element's own widget UI) rather than a cramped sidebar strip - a widget
 * is usually a real embedded app (Etherpad, a whiteboard, a dashboard) that
 * wants actual screen space.
 */
export function WidgetsPanel({ room }: { room: Room }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const theme = useThemeStore((s) => s.effective);
  const openModal = useModalStore((s) => s.open);
  const toggleWidgetsPanel = useUiStore((s) => s.toggleWidgetsPanel);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);

  const widgets = getRoomWidgets(room);
  const mayManage = canManageWidgets(room, client.getUserId() ?? "");
  const activeWidget = widgets.find((w) => w.id === selectedWidgetId) ?? widgets[0] ?? null;

  async function handleRemove(widgetId: string) {
    if (!(await uiConfirm(t("widgets.removeConfirm"), { danger: true }))) return;
    await removeWidget(client, room.roomId, widgetId);
    setSelectedWidgetId(null);
  }

  return (
    <div className="flex h-full flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-bg-primary px-3 py-2">
        <button
          type="button"
          onClick={toggleWidgetsPanel}
          title={t("widgets.backToChat")}
          aria-label={t("widgets.backToChat")}
          className="shrink-0 rounded p-1.5 text-muted hover:bg-bg-modifier-hover hover:text-normal"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M20 11H7.83l4.88-4.88L11.29 4.7 3.99 12l7.3 7.29 1.42-1.41L7.83 13H20v-2Z" />
          </svg>
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {widgets.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setSelectedWidgetId(w.id)}
              aria-pressed={activeWidget?.id === w.id}
              className={`shrink-0 rounded px-3 py-1.5 text-sm font-medium transition ${
                activeWidget?.id === w.id ? "bg-brand text-white" : "text-muted hover:bg-bg-modifier-hover"
              }`}
            >
              {w.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => openModal({ type: "addWidget", roomId: room.roomId })}
          title={t("widgets.add")}
          aria-label={t("widgets.add")}
          className="shrink-0 rounded p-1.5 text-muted hover:bg-bg-modifier-hover hover:text-normal"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
          </svg>
        </button>
        {activeWidget && mayManage && (
          <button
            type="button"
            onClick={() => void handleRemove(activeWidget.id)}
            title={t("widgets.remove")}
            aria-label={t("widgets.remove")}
            className="shrink-0 rounded p-1.5 text-muted hover:bg-dnd/10 hover:text-dnd"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M6 7h12l-1 14H7L6 7Zm3-4h6l1 2h4v2H4V5h4l1-2Z" />
            </svg>
          </button>
        )}
      </div>

      {activeWidget ? (
        // allow-scripts + allow-same-origin together let embedded content
        // lift its own sandbox via script - a well-known combination to
        // avoid for UNTRUSTED content, but standard (and necessary) for
        // widgets: the same trade-off Element's own widget host makes.
        // What keeps this safe isn't the sandbox attribute, it's that only
        // someone with room-state permission can ADD a widget in the first
        // place (canManageWidgets) - a random message can never embed one.
        <iframe
          key={activeWidget.id}
          src={buildWidgetUrl(activeWidget, client, room, theme)}
          className="min-h-0 w-full flex-1 border-0"
          allow="microphone; camera; encrypted-media; autoplay; clipboard-write; fullscreen"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
          title={activeWidget.name}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted">
          <p>{t("widgets.empty")}</p>
          <button
            type="button"
            onClick={() => openModal({ type: "addWidget", roomId: room.roomId })}
            className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
          >
            {t("widgets.add")}
          </button>
        </div>
      )}
    </div>
  );
}
