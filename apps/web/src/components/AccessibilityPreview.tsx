import { useTranslation } from "../i18n";
import { Avatar } from "./Avatar";

/**
 * A static, fake message rendered with the SAME classes real messages use
 * (jk-message-text, text-link, reaction-pill shape, avatar) so every
 * Accessibility toggle above it - density, font/line-height scale, high
 * contrast, underlined links, focus rings, reduced motion - visibly changes
 * this card the instant it's changed, without needing a real room. Mirrors
 * Discord's own "Preview" box on its Accessibility page.
 */
export function AccessibilityPreview() {
  const { t } = useTranslation();
  return (
    <div className="mb-4 rounded-lg border border-border bg-bg-secondary p-3">
      <span className="mb-2 block text-[11px] font-bold uppercase text-muted">{t("settings.a11yPreviewLabel")}</span>
      <div className="flex gap-3 rounded bg-bg-primary p-3">
        <Avatar url={null} name={t("settings.a11yPreviewName")} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-header">{t("settings.a11yPreviewName")}</span>
            <span className="text-xs text-muted">{t("settings.a11yPreviewTime")}</span>
          </div>
          <p className="jk-message-text whitespace-pre-wrap break-words text-[0.9375rem] text-normal">
            {t("settings.a11yPreviewText")}{" "}
            <a href="#" onClick={(e) => e.preventDefault()} className="text-link hover:underline">
              jorkonvo.example
            </a>
          </p>
          <div className="mt-1.5 flex items-center gap-1">
            <span className="flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-xs">
              👍 <span className="text-muted">3</span>
            </span>
            <button
              type="button"
              tabIndex={0}
              className="rounded border border-border px-2 py-0.5 text-xs font-medium text-muted hover:bg-bg-modifier-hover"
            >
              {t("settings.a11yPreviewButton")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
