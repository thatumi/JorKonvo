import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  /** Draw a divider above this item. */
  separator?: boolean;
  submenu?: MenuItem[];
  /**
   * Custom content (e.g. a slider) shown in place of a submenu's button
   * list, opened the same way (hover) - for a control that doesn't fit the
   * "list of clickable rows" shape. Mutually exclusive with `submenu`.
   */
  panel?: () => React.ReactNode;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

const CheckMark = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
    <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" />
  </svg>
);

/** A rectangle a submenu should open next to (a hovered parent row). */
interface Anchor {
  top: number;
  left: number;
  right: number;
}

/*
 * env(safe-area-inset-top) isn't readable from JS directly, so measure it
 * with a one-shot probe element instead. Context menus are position:fixed
 * panels placed at the pointer and clamped to an 8px margin - without this,
 * one opened near the top edge (long-press in a header) would sit under the
 * Dynamic Island / notch, where its first rows can't be tapped. 0 everywhere
 * the device has no safe area (desktop, most Androids).
 */
function safeAreaTopPx(): number {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none;";
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h;
}

/** Minimum top offset for a fixed-positioned menu: normal margin, but never inside the status bar area. */
function menuTopMargin(): number {
  return Math.max(8, safeAreaTopPx());
}

/**
 * A submenu-shaped floating panel that renders arbitrary content (e.g. a
 * slider) instead of a list of MenuItem buttons - see MenuItem.panel.
 * `data-context-menu` keeps interacting with it (dragging a range input)
 * from being treated as "clicked outside the menu" by useContextMenu.
 */
function CustomPanel({ anchor, children }: { anchor: Anchor; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: anchor.right, y: anchor.top });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const M = 8;
    const T = menuTopMargin();

    let nx = anchor.right - 4;
    if (nx + r.width > vw - M) nx = anchor.left + 4 - r.width;
    if (nx < M) nx = M;
    let ny = anchor.top - 4;
    if (ny + r.height > vh - M) ny = Math.max(M, vh - r.height - M);
    if (ny < T) ny = T;
    setPos({ x: nx, y: ny });
  }, [anchor]);

  return createPortal(
    <div
      ref={ref}
      data-context-menu=""
      style={{ position: "fixed", left: pos.x, top: pos.y }}
      className="animate-scale-in z-[80] w-56 rounded-lg border border-border bg-bg-floating p-3 shadow-xl ring-1 ring-white/5"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

function MenuPanel({
  x,
  y,
  anchor,
  items,
  onClose,
}: {
  /** Preferred top-left corner (used when there's no `anchor`, e.g. the root menu). */
  x: number;
  y: number;
  /** When set, this panel is a submenu that should sit beside `anchor`. */
  anchor?: Anchor;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [openSub, setOpenSub] = useState<number | null>(null);
  const [subAnchor, setSubAnchor] = useState<Anchor | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const M = 8;
    const T = menuTopMargin();

    let nx: number;
    let ny: number;
    if (anchor) {
      // Submenu: open to the right of the parent row, flipping to the left
      // if it wouldn't fit; align vertically with the row, nudged up a touch.
      nx = anchor.right - 4;
      if (nx + r.width > vw - M) nx = anchor.left + 4 - r.width;
      if (nx < M) nx = M;
      ny = anchor.top - 4;
    } else {
      nx = x;
      ny = y;
      if (nx + r.width > vw - M) nx = Math.max(M, vw - r.width - M);
    }
    if (ny + r.height > vh - M) ny = Math.max(M, vh - r.height - M);
    if (ny < T) ny = T;
    setPos({ x: nx, y: ny });
  }, [x, y, anchor]);

  const panel = (
    <div
      ref={ref}
      data-context-menu=""
      role="menu"
      style={{ position: "fixed", left: pos.x, top: pos.y }}
      className="animate-scale-in z-[80] min-w-[190px] rounded-lg border border-border bg-bg-floating py-1 text-sm shadow-xl ring-1 ring-white/5"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        // Arrow-key navigation among this panel's enabled items (Escape and
        // outside-interaction closing live in useContextMenu). Recursion keeps
        // each panel (root + submenus) handling its own item list.
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const items = [
          ...(ref.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not([disabled])') ?? []),
        ];
        if (items.length === 0) return;
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          e.key === "ArrowDown"
            ? (current + 1) % items.length
            : current <= 0
              ? items.length - 1
              : current - 1;
        items[next]?.focus();
      }}
    >
      {items.map((item, i) => {
        if (!item.submenu && !item.panel && !item.onClick) return null;
        return (
          <div key={i}>
            {item.separator && <div className="my-1 h-px bg-border" />}
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onMouseEnter={(e) => {
                if (item.submenu || item.panel) {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setSubAnchor({ top: r.top, left: r.left, right: r.right });
                  setOpenSub(i);
                } else {
                  setOpenSub(null);
                }
              }}
              onClick={() => {
                if (item.submenu || item.panel) return;
                item.onClick?.();
                onClose();
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition disabled:opacity-40 ${
                item.danger
                  ? "text-dnd hover:bg-dnd/15"
                  : "text-normal hover:bg-bg-modifier-hover hover:text-header"
              }`}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted">
                {item.checked ? CheckMark : item.icon}
              </span>
              <span className="flex-1 truncate">{item.label}</span>
              {(item.submenu || item.panel) && <span className="shrink-0 text-muted">›</span>}
            </button>
            {item.submenu && openSub === i && subAnchor && (
              <MenuPanel
                x={subAnchor.right}
                y={subAnchor.top}
                anchor={subAnchor}
                items={item.submenu}
                onClose={onClose}
              />
            )}
            {item.panel && openSub === i && subAnchor && <CustomPanel anchor={subAnchor}>{item.panel()}</CustomPanel>}
          </div>
        );
      })}
    </div>
  );

  // Every panel - including submenus - is portaled straight to <body>, so a
  // parent panel's `transform` (the scale-in animation) never becomes the
  // containing block for a child's `position: fixed`, which was making
  // submenus land in random / off-screen places.
  return createPortal(panel, document.body);
}

/**
 * Right-click / context menu. Usage:
 *   const { open, menu } = useContextMenu();
 *   <div onContextMenu={(e) => open(e, [{ label: "…", onClick: … }])}>
 *   {menu}
 */
export function useContextMenu() {
  const [state, setState] = useState<MenuState | null>(null);

  const close = () => setState(null);

  function open(e: React.MouseEvent, items: MenuItem[]) {
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY, items });
  }

  useEffect(() => {
    if (!state) return;
    // pointerdown fires before click; without this guard a press on a menu
    // item would close the menu (unmounting the button) before its onClick
    // ever ran - which is exactly "the menu shows but the buttons do nothing".
    const insideMenu = (target: EventTarget | null) =>
      target instanceof Element && target.closest("[data-context-menu]") !== null;
    const onDown = (ev: PointerEvent | MouseEvent) => {
      if (!insideMenu(ev.target)) close();
    };
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && close();
    const onScroll = (ev: Event) => {
      if (!insideMenu(ev.target)) close();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [state]);

  // MenuPanel portals itself to <body>, so no wrapping createPortal here.
  const menu = state ? (
    <MenuPanel x={state.x} y={state.y} items={state.items} onClose={close} />
  ) : null;

  return { open, close, menu };
}
