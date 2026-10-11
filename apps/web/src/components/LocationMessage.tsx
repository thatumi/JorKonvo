import { getMapLink, parseGeoUri } from "@jorkonvo/matrix-core";
import { useTranslation } from "../i18n";
import { type MatrixEvent } from "matrix-js-sdk";

const PinIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-brand" fill="currentColor" aria-hidden="true">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
  </svg>
);

/**
 * Static location message: renders the event's `geo_uri` as a chip linking to
 * an external map, or an error note when the URI can't be parsed.
 *
 * @param ev - The location message event holding the `geo_uri` payload.
 */
export function LocationMessage({ ev }: { ev: MatrixEvent }) {
  const { t } = useTranslation();
  const content = ev.getContent() as { geo_uri?: string; body?: string };
  const point = content.geo_uri ? parseGeoUri(content.geo_uri) : null;

  if (!point) return <p className="mt-1 text-sm text-dnd">{t("locationMsg.invalid")}</p>;

  return (
    <a
      href={getMapLink(point)}
      target="_blank"
      rel="noreferrer"
      className="mt-1 flex max-w-xs items-center gap-2 rounded-lg border border-border bg-bg-secondary px-3 py-2.5 text-sm text-normal hover:border-brand"
    >
      {PinIcon}
      <span className="min-w-0 flex-1 truncate">{t("locationMsg.shared")}</span>
      <span className="shrink-0 text-xs text-link">{t("locationMsg.map")}</span>
    </a>
  );
}
