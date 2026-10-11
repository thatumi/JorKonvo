import { useAuthStore } from "../state/authStore";
import { useMatrixStore } from "../state/matrixStore";
import { useModalStore } from "../state/modalStore";
import { useProfileStore } from "../state/profileStore";
import { useProfileFlair } from "../lib/profileFlair";
import { Avatar } from "./Avatar";
import { useTranslation } from "../i18n";

/**
 * The bottom strip of the sidebar: the account's avatar + name (opens user
 * settings on click) and a logout button.
 */
export function UserPanel() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client);
  useMatrixStore((s) => s.syncTick);
  const logout = useAuthStore((s) => s.logout);
  const openModal = useModalStore((s) => s.open);
  const profileDisplayName = useProfileStore((s) => s.displayName);
  const profileAvatarUrl = useProfileStore((s) => s.avatarUrl);
  const flair = useProfileFlair(client?.getUserId());

  if (!client) return null;

  // Prefer the authoritative /profile fetch over client.getUser(...): the
  // latter's displayName/avatarUrl get contaminated by any per-room nickname
  // override (see profileStore.ts) - this is the account's global identity,
  // it should never flip just because one room has its own nickname set.
  const user = client.getUser(client.getUserId() ?? "");
  const displayName = profileDisplayName || user?.displayName || client.getUserId() || "";
  const rawAvatarUrl = profileAvatarUrl || user?.avatarUrl;
  const avatarUrl = rawAvatarUrl ? (client.mxcUrlToHttp(rawAvatarUrl, 32, 32, "crop") ?? null) : null;

  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2 bg-bg-darkest px-2">
      <button
        type="button"
        onClick={() => openModal({ type: "userSettings" })}
        data-testid="open-user-settings"
        className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 hover:bg-bg-modifier-hover"
        title={t("settings.title")}
      >
        <Avatar url={avatarUrl} name={displayName} size={32} statusColor="var(--color-online)" decorationMxc={flair.decorationMxc} />
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-medium text-header">{displayName}</div>
          <div className="truncate text-xs text-muted">{client.getUserId()}</div>
        </div>
      </button>
      <button
        type="button"
        onClick={() => void logout()}
        title={t("rail.logout")}
        aria-label={t("rail.logout")}
        className="rounded p-1.5 text-muted hover:bg-bg-modifier-hover hover:text-normal"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
          <path d="M16 17v-3H9v-4h7V7l5 5-5 5ZM14 2a2 2 0 0 1 2 2v2h-2V4H5v16h9v-2h2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9Z" />
        </svg>
      </button>
    </div>
  );
}
