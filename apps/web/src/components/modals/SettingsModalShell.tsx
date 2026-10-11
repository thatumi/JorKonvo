import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../i18n";
import { useDragToDismiss } from "../../lib/dragToDismiss";
import { modalInputClass } from "../Modal";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Tailwind's `sm` breakpoint: below it this shell is a full-screen sheet (the sm: classes in the markup), so the edge-swipe close applies. */
const FULLSCREEN_QUERY = "(max-width: 639.9px)";

/** A drag only counts as an edge-swipe when the touch starts this close to the left edge. */
const EDGE_ZONE_PX = 40;

export interface SettingsPane {
  id: string;
  /** Nav label (already translated). */
  label: string;
  /** Optional leading glyph/icon for the nav row. */
  icon?: ReactNode;
  /** Extra searchable text (synonyms, both languages) - not shown. */
  keywords?: string;
  /** Render the nav row in the danger colour (Leave / Delete etc.). */
  danger?: boolean;
  /**
   * The pane body. Called only while the pane is active, so keep hooks out
   * of it. Optional when the shell is driven by a `children` render prop
   * instead (the caller then keys its own content off the active id).
   */
  render?: () => ReactNode;
}

/**
 * Discord-style settings layout: a category rail on the left, and only the
 * selected category's content on the right. Replaces the old
 * one-long-scroll-with-jump-chips pattern that every settings modal had
 * grown. On a narrow screen the rail is the first screen and picking a
 * category slides in its content with a back arrow.
 *
 * Callers gate panes by permission themselves (build the array
 * conditionally); this component just lays out whatever it's handed.
 */
export function SettingsModalShell({
  title,
  onClose,
  panes,
  initialPaneId,
  children,
  activePaneId,
  onPaneChange,
}: {
  title: string;
  onClose: () => void;
  panes: SettingsPane[];
  initialPaneId?: string;
  /**
   * Alternative to per-pane `render`: one render prop handed the active
   * pane id. Handy for a modal whose sections are physically interleaved
   * and just want `{active === "x" && …}` guards.
   */
  children?: (activeId: string) => ReactNode;
  /**
   * Lets the caller own which pane is active instead of the shell's own
   * state - needed when a pane's own content wants to jump to a DIFFERENT
   * pane (e.g. a "Manage roles" button inside the Members pane switching to
   * a dedicated Roles pane). Pass both together; omit both for the default
   * self-contained behaviour.
   */
  activePaneId?: string;
  onPaneChange?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const [internalActiveId, setInternalActiveId] = useState(initialPaneId ?? panes[0]?.id ?? "");
  const activeId = activePaneId ?? internalActiveId;
  const [showContentMobile, setShowContentMobile] = useState(false);

  // Mobile edge-swipe close, the same gesture the thread/threads-list/search
  // panels got (ChatArea), via the shared drag-to-dismiss hook: a rightward
  // drag from the left edge moves the sheet 1:1 with the finger and, past a
  // threshold on release, goes back one level - out of a sub-pane to the
  // category rail, or from the rail out of the modal entirely.
  // Deliberately EDGE-restricted (unlike the chat panels, which take a drag
  // anywhere): these panes are dense with horizontally draggable content -
  // appearance sliders, the caret drag in the search field - that an
  // anywhere-drag would hijack. The rail/sub-pane switch can race a drag, so
  // the release reads the current view through a ref, not a render-scoped
  // closure value.
  const showContentRef = useRef(false);
  showContentRef.current = showContentMobile;
  const sheetDrag = useDragToDismiss<HTMLDivElement>({
    axis: "x",
    edgeZonePx: EDGE_ZONE_PX,
    // Full-screen sheet only - the sm+ centred card is not a drag surface.
    shouldEngage: () => window.matchMedia(FULLSCREEN_QUERY).matches,
    onDismiss: () => {
      if (showContentRef.current) setShowContentMobile(false);
      else onClose();
    },
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Focus trap: keep Tab / Shift+Tab cycling inside the dialog so a
      // keyboard user can't tab into the app behind the overlay (same
      // behaviour as the shared Modal wrapper, which this shell doesn't use).
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    // Move focus into the dialog on open, restore it to the trigger on close.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const root = dialogRef.current;
    // Skip visually-hidden matches (e.g. the mobile-only close button on
    // desktop) - focusing a display:none element is a silent no-op.
    const target =
      [...(root?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].find((el) => el.offsetParent !== null) ?? root;
    target?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? panes.filter((p) => `${p.label} ${p.keywords ?? ""}`.toLowerCase().includes(q))
        : panes,
    [panes, q],
  );

  // While a search is narrowing the rail, follow it: if the current pane
  // isn't in the results, preview the first match instead of a stale pane.
  const active =
    filtered.find((p) => p.id === activeId) ??
    filtered[0] ??
    panes.find((p) => p.id === activeId) ??
    panes[0];

  function pick(id: string) {
    if (onPaneChange) onPaneChange(id);
    else setInternalActiveId(id);
    setShowContentMobile(true);
  }

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-0 backdrop-blur-[2px] sm:p-4"
      onClick={onClose}
    >
      <div
        ref={(node) => {
          // One node, two consumers: the focus trap queries and focuses the
          // dialog, the edge-swipe drag attaches its listeners to it.
          dialogRef.current = node;
          sheetDrag.ref(node);
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-testid="settings-modal"
        style={{
          // The edge-swipe drag owns `transform` (written imperatively by
          // attachDragToDismiss, never via the style prop); the transition is
          // only suspended while a drag is live so the release snap-back eases
          // instead of teleporting.
          transition: sheetDrag.dragging ? "none" : "transform 240ms cubic-bezier(0.16, 1, 0.3, 1)",
          willChange: sheetDrag.dragging ? "transform" : "auto",
        }}
        className="animate-scale-in flex h-full w-full flex-col overflow-hidden bg-bg-primary pt-[env(safe-area-inset-top)] shadow-xl ring-1 ring-white/5 sm:h-[85vh] sm:max-h-[85vh] sm:max-w-3xl sm:flex-row sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Category rail */}
        <nav
          className={`${
            showContentMobile ? "hidden" : "flex"
          } w-full flex-1 shrink-0 flex-col gap-0.5 overflow-y-auto border-border bg-bg-secondary p-3 sm:flex sm:w-56 sm:flex-none sm:border-r`}
        >
          <div className="mb-2 flex items-center justify-between sm:hidden">
            <h2 className="text-base font-semibold text-header">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="rounded p-1 text-muted hover:bg-bg-modifier-hover hover:text-normal"
            >
              ✕
            </button>
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("settings.searchPlaceholder")}
            className={`${modalInputClass()} mb-2 mt-0`}
          />
          {filtered.map((p) => {
            const isActive = p.id === active?.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => pick(p.id)}
                data-testid={`settings-nav-${p.id}`}
                className={`flex items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm font-medium transition ${
                  isActive
                    ? "bg-bg-modifier-selected text-header"
                    : p.danger
                      ? "text-dnd hover:bg-dnd/10"
                      : "text-muted hover:bg-bg-modifier-hover hover:text-normal"
                }`}
              >
                {p.icon && <span className="shrink-0 text-base leading-none">{p.icon}</span>}
                <span className="truncate">{p.label}</span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-muted">{t("settings.searchNoMatch")}</p>
          )}
        </nav>

        {/* Content pane */}
        <div className={`${showContentMobile ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col sm:flex`}>
          <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3.5 sm:px-6">
            <button
              type="button"
              onClick={() => setShowContentMobile(false)}
              className="rounded p-1 text-muted hover:bg-bg-modifier-hover hover:text-normal sm:hidden"
              aria-label={t("common.back")}
            >
              ‹
            </button>
            <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-header">
              {active?.label ?? title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="hidden rounded p-1 text-muted hover:bg-bg-modifier-hover hover:text-normal sm:block"
            >
              ✕
            </button>
          </header>
          {/* Sections carry their own top divider/margin for the old single
              scroll; strip it off whichever one lands first in a pane. */}
          <div
            key={active?.id}
            data-testid="settings-pane-content"
            className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 [&>*:first-child]:mt-0 [&>*:first-child]:border-t-0 [&>*:first-child]:pt-0"
          >
            {children ? children(active?.id ?? "") : active?.render?.()}
          </div>
        </div>
      </div>
    </div>
  );
}
