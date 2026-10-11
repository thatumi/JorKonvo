import { type ReactNode, useEffect, useId, useRef } from "react";
import { useTranslation } from "../i18n";
import { scrollBehavior } from "../lib/displayPrefs";
import { useDragToDismiss } from "../lib/dragToDismiss";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * The app's base overlay dialog: a centred panel that traps Tab focus, closes
 * on Escape or backdrop click, and moves focus in on open / back to the
 * trigger on close. On a touch screen it also swipes down to dismiss (while
 * its body is scrolled to the top), which together with the ✕ is what makes
 * every modal one-handed escapable on a phone. All other modals compose this
 * primitive.
 *
 * @param title - Dialog heading; also the dialog's accessible name (via aria-labelledby).
 * @param onClose - Invoked on Escape or backdrop click; the dialog unmounts and focus is restored.
 * @param children - Body content, rendered inside the dialog's internal scroll region.
 * @param wide - Widens the dialog (max-w-2xl instead of max-w-md) for content that needs more horizontal room, e.g. a two-pane editor.
 */
export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Widens the dialog (max-w-2xl instead of max-w-md) for content that needs more horizontal room, e.g. a two-pane editor. */
  wide?: boolean;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  // The card's own scroll region - a swipe-down may only claim the gesture
  // while it is scrolled back to the top, or it would fight the scroll.
  const scrollRef = useRef<HTMLDivElement>(null);

  // Swipe-down-to-dismiss, the sheet gesture iOS users expect from a floating
  // panel. A touch screen has no Escape key, and the card's backdrop band is
  // only a few px wide on a phone, so this drag (plus the ✕) is what makes
  // every modal in the app reliably escapable one-handed. Claims the gesture
  // only while the body is scrolled to the top, and only once the drag
  // actually moves the card - an upward drag from the top must keep scrolling.
  const { ref: dragRef, dragging } = useDragToDismiss<HTMLDivElement>({
    axis: "y",
    onDismiss: onClose,
    shouldEngage: () => (scrollRef.current?.scrollTop ?? 0) <= 0,
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Focus trap: keep Tab / Shift+Tab cycling inside the dialog so a
      // keyboard user can't tab into the (inert-looking but still live)
      // app behind the overlay.
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
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    // Move focus into the dialog on open, restore it to the trigger on close.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const root = dialogRef.current;
    const target = root?.querySelector<HTMLElement>(FOCUSABLE) ?? root;
    target?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        ref={(node) => {
          // One node, two consumers: the focus trap needs the element to query
          // and focus, the swipe-down drag needs to attach its listeners.
          dialogRef.current = node;
          dragRef(node);
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="modal"
        tabIndex={-1}
        style={{
          // The swipe-down drag owns `transform` (written imperatively by
          // attachDragToDismiss, never via the style prop); the transition is
          // only suspended while a drag is live so the release snap-back eases.
          transition: dragging ? "none" : "transform 240ms cubic-bezier(0.16, 1, 0.3, 1)",
          willChange: dragging ? "transform" : "auto",
        }}
        className={`animate-scale-in flex max-h-[85vh] w-full flex-col rounded-lg bg-bg-primary shadow-xl outline-none ring-1 ring-white/5 ${wide ? "max-w-2xl" : "max-w-md"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between px-6 pt-6">
          <h2 id={titleId} className="text-lg font-semibold text-header">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            data-testid="modal-close"
            className="rounded p-1 text-muted hover:bg-bg-modifier-hover hover:text-normal"
          >
            ✕
          </button>
        </div>
        {/* Some settings modals (room/user settings) have grown well past a
            single viewport's worth of sections - without its own scroll
            region here, content past the fold becomes entirely unreachable
            (no page-level scroll exists behind a fixed-position overlay). */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">{children}</div>
      </div>
    </div>
  );
}

/**
 * Category quick-jump for the settings modals (user/room/space): each has a
 * sticky search+category-chip header pinned to the top of this scroll
 * region (see the `.sticky` div these modals render as their first child).
 * A plain `scrollIntoView({block: "start"})` aligns the target with the
 * scroll container's own top edge, which is exactly where that sticky
 * header sits - so the section's own heading ends up hidden behind it,
 * making the category look like it starts further down than it really
 * does. Scrolling manually and subtracting the header's actual (not
 * guessed) current height fixes that regardless of how tall the header
 * happens to be at the time (e.g. chips wrapping to a second line).
 */
export function scrollToModalSection(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  const container = target.closest<HTMLElement>(".overflow-y-auto");
  if (!container) {
    target.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    return;
  }
  const header = container.querySelector<HTMLElement>(".sticky");
  const headerHeight = header?.getBoundingClientRect().height ?? 0;
  const targetTop = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
  container.scrollTo({ top: Math.max(0, targetTop - headerHeight - 8), behavior: scrollBehavior() });
}

export function ModalField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="mb-3 block">
      {/* Scope the label styling to the label itself - ModalField children
          include help text and hint paragraphs that must not inherit
          `uppercase`. */}
      <span className="mb-1 block text-xs font-bold uppercase text-muted">{label}</span>
      {children}
    </label>
  );
}

export function modalInputClass(): string {
  return "mt-1 w-full rounded bg-bg-darkest px-3 py-2.5 text-normal outline-none focus:ring-2 focus:ring-brand";
}

export function ModalPrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="w-full rounded bg-brand py-2.5 font-medium text-white transition hover:bg-brand-hover disabled:opacity-60"
    >
      {children}
    </button>
  );
}
