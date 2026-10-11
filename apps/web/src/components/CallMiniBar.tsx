import { useTranslation } from "../i18n";
export const MinimizeIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
    <path d="M6 19h12v2H6z" />
  </svg>
);

const ExpandIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
    <path d="M4 4h7v2H6v5H4V4Zm9 0h7v7h-2V6h-5V4ZM4 13h2v5h5v2H4v-7Zm16 0v7h-7v-2h5v-5h2Z" />
  </svg>
);

/**
 * The docked mini control bar the call screens (1:1 and group) collapse to when
 * minimised, so you can keep using the rest of the app - or the tab you're
 * screen-sharing - while still one click from mute / stop-share / hang-up.
 */
export function MiniCallBar({
  title,
  subtitle,
  onExpand,
  children,
}: {
  title: string;
  subtitle?: string;
  onExpand: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    // Bottom-fixed interactive bar, so it carries the home-indicator inset
    // itself (nothing else keeps a bottom inset - scrolling content runs to
    // the edge; see #root / MainLayout shell comments).
    <div className="animate-slide-in-up fixed bottom-[calc(1rem_+_env(safe-area-inset-bottom))] right-[calc(1rem_+_env(safe-area-inset-right))] z-[60] flex items-center gap-3 rounded-xl border border-white/10 bg-bg-secondary/95 px-3 py-2 shadow-xl ring-1 ring-white/5 backdrop-blur">
      <button type="button" onClick={onExpand} title={t("call.open")} aria-label={t("call.open")} className="flex min-w-0 items-center gap-2 text-left">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-online/20 text-online">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.24.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2Z" />
          </svg>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-header">{title}</span>
          {subtitle && <span className="block truncate text-xs text-muted">{subtitle}</span>}
        </span>
      </button>
      <div className="flex items-center gap-1.5">{children}</div>
      <button
        type="button"
        onClick={onExpand}
        title={t("call.expand")}
        aria-label={t("call.expand")}
        className="rounded p-1.5 text-muted hover:bg-bg-modifier-hover hover:text-normal"
      >
        {ExpandIcon}
      </button>
    </div>
  );
}

/** A small round control for the mini bar. */
export function MiniControl({
  onClick,
  active,
  danger,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
        danger
          ? "bg-dnd text-white hover:bg-red-600"
          : active
            ? "bg-bg-modifier-selected text-header"
            : "bg-bg-darkest text-normal hover:bg-bg-modifier-hover"
      }`}
    >
      {children}
    </button>
  );
}
