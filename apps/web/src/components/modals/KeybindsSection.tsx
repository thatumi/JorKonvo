import { useEffect, useState } from "react";
import { useTranslation } from "../../i18n";
import {
  comboFromEvent,
  describeCombo,
  type KeybindActionId,
  KEYBIND_DEFAULTS,
  useKeybindsStore,
} from "../../state/keybindsStore";

const ACTION_LABEL: Record<KeybindActionId, string> = {
  toggleMute: "keybind.toggleMute",
  toggleDeafen: "keybind.toggleDeafen",
  toggleMemberList: "keybind.toggleMemberList",
  navChannelPrev: "keybind.navChannelPrev",
  navChannelNext: "keybind.navChannelNext",
  toggleSearch: "keybind.toggleSearch",
  markRead: "keybind.markRead",
  toggleHelp: "keybind.toggleHelp",
};

/**
 * Keyboard-shortcut settings: lists every rebindable action with its current
 * combo. Clicking a binding starts global key capture (Escape cancels); a
 * per-row button restores the default combo.
 */
export function KeybindsSection() {
  const { t } = useTranslation();
  const bindings = useKeybindsStore((s) => s.bindings);
  const setBinding = useKeybindsStore((s) => s.setBinding);
  const resetBinding = useKeybindsStore((s) => s.resetBinding);
  const [capturing, setCapturing] = useState<KeybindActionId | null>(null);

  useEffect(() => {
    if (!capturing) return;
    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return; // bare modifier - keep waiting
      setBinding(capturing!, combo);
      setCapturing(null);
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [capturing, setBinding]);

  return (
    <div>
      <h3 className="mb-2 text-xs font-bold uppercase text-muted">{t("settings.catKeybinds")}</h3>
      <p className="mb-3 text-xs text-muted">{t("keybind.hint")}</p>
      <div className="flex flex-col divide-y divide-border">
        {KEYBIND_DEFAULTS.map(({ id }) => {
          const isDefault =
            JSON.stringify(bindings[id]) === JSON.stringify(KEYBIND_DEFAULTS.find((d) => d.id === id)!.combo);
          return (
            <div key={id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-normal">{t(ACTION_LABEL[id])}</span>
              <div className="flex shrink-0 items-center gap-1.5">
                {!isDefault && (
                  <button
                    type="button"
                    onClick={() => resetBinding(id)}
                    className="text-xs text-muted hover:text-normal"
                    title={t("keybind.reset")}
                    aria-label={t("keybind.reset")}
                  >
                    ↺
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setCapturing(id)}
                  aria-pressed={capturing === id}
                  className={`min-w-[7rem] rounded border px-2 py-1 text-center font-mono text-xs transition ${
                    capturing === id
                      ? "border-brand bg-brand/10 text-header"
                      : "border-border text-normal hover:bg-bg-modifier-hover"
                  }`}
                >
                  {capturing === id ? t("keybind.pressKeys") : describeCombo(bindings[id])}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
