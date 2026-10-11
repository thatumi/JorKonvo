import { Capacitor } from "@capacitor/core";

/**
 * One shared "are we inside the Capacitor native shell?" check. The web
 * implementation answers false in every browser (including a phone's
 * Safari/Chrome), the iOS/Android WKWebView/WebView shells answer true.
 *
 * Keyboard shortcuts are a desktop-only concept - a phone has no hardware
 * keyboard to rebind - so everything keybind-flavoured (the global listener
 * layer, the shortcuts help overlay, the Keybinds settings pane) gates
 * itself off behind this instead of shipping dead UI on mobile.
 */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}
