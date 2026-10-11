/**
 * The app is a fixed-viewport shell: html/body are `overflow: hidden` and
 * every scrollable region manages its own overflow (index.css). So the
 * document itself should never have a scroll offset. iOS WKWebView breaks
 * that when the keyboard closes: it scrolls the page to reveal a focused
 * input, and after the input loses focus (especially if it is removed from
 * the DOM, e.g. switching rooms) it can leave the page scrolled - and with
 * overflow: hidden there is no gesture that scrolls it back, so the whole
 * layout stays shifted until the app is restarted.
 *
 * Reset on `focusout` only - never while an input is focused, because that
 * is exactly when iOS is legitimately keeping the field above the keyboard.
 */
export function installDocumentScrollGuard(): void {
  document.addEventListener("focusout", () => {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.matches('input, textarea, [contenteditable="true"]')) return;
      const root = document.scrollingElement;
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
      if (root && (root.scrollTop !== 0 || root.scrollLeft !== 0)) {
        root.scrollTop = 0;
        root.scrollLeft = 0;
      }
    });
  });
}
