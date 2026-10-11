import type { UIEvent } from "react";

/**
 * onScroll guard for the mobile swipe containers (`.jk-swipe-clip`, see
 * index.css): they only ever move their contents via transform, so any
 * scroll offset they pick up is a bug - snap it straight back. Needed where
 * `overflow: clip` isn't supported (iOS < 16) and a programmatic scroll can
 * still reach an `overflow: hidden` box.
 */
export function resetSwipeScroll(e: UIEvent<HTMLElement>): void {
  const el = e.currentTarget;
  if (el.scrollLeft !== 0) el.scrollLeft = 0;
  if (el.scrollTop !== 0) el.scrollTop = 0;
}
