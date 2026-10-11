import type { MatrixClient } from "@jorkonvo/matrix-core";
import { useTranslation } from "../i18n";
import { useIsUserVerified } from "../lib/useVerificationStatus";

/**
 * Element-style small shield next to a name, shown only when this device has
 * actually cross-signing-verified the user - a real trust signal, not a
 * decoration (renders nothing while loading or when unverified, same as
 * RoleBadges rendering nothing when there's nothing to show).
 */
export function VerifiedBadge({
  client,
  userId,
  size = 13,
}: {
  client: MatrixClient;
  userId: string;
  size?: number;
}) {
  const { t } = useTranslation();
  const verified = useIsUserVerified(client, userId);
  if (!verified) return null;
  return (
    <span className="ml-1 inline-flex shrink-0 items-center text-online" title={t("profile.verifiedBadge")}>
      <svg viewBox="0 0 24 24" style={{ width: size, height: size }} fill="currentColor" aria-hidden>
        <path d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Zm-1.2 14.6L6.4 11.2l1.4-1.4 2.99 2.99L16.2 6.4l1.4 1.4Z" />
      </svg>
      <span className="sr-only">{t("profile.verifiedBadge")}</span>
    </span>
  );
}
