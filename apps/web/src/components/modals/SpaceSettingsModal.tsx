import {
  addRoomToSpace,
  allowMembersToManageRoles,
  banMember,
  canBan,
  canInviteToRoom,
  canKick,
  canManageOnboarding,
  canManagePowerLevels,
  canManageRoles,
  canSetJoinRule,
  getJoinRule,
  canManageSpaceEmojis,
  canManageSuperReactions,
  canManageWelcomeMessage,
  canSetSpaceDefaultNotifications,
  clearSpaceBanner,
  getMemberRoles,
  kickMember,
  getInvitePowerLevel,
  getOnboardingConfig,
  getRoomInviteLink,
  getRoomsInSpace,
  setRoomAvatarImage,
  getSpaceBannerMxc,
  getUngroupedRooms,
  getSpaceDefaultNotificationMode,
  getSpaceRoles,
  setMemberRoleAssigned,
  getSpaceSettings,
  getWelcomeMessageConfig,
  hasCustomSpaceBanner,
  isDmAllowedFromSpace,
  isPersonalEmojiAllowed,
  isVoiceChannel,
  membersCanManageRoles,
  removeRoomFromSpace,
  resolveRoomTarget,
  setDmAllowedFromSpace,
  setInvitePowerLevel,
  setOnboardingConfig,
  setSpaceBanner,
  setJoinRule,
  setSpaceDefaultNotificationMode,
  setSpaceKnockingAllowed,
  type SpaceDefaultNotificationMode,
  setSpaceProfile,
  setWelcomeMessageConfig,
  updateSpaceSettings,
} from "@jorkonvo/matrix-core";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../../i18n";
import { useAuthedMedia } from "../../lib/authedMedia";
import { intlLocale } from "../../lib/dateLocale";
import { uiAlert, uiConfirm } from "../../lib/dialogs";
import { getServerUploadLimit } from "../../lib/imageCompression";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { Avatar } from "../Avatar";
import { EmojiPackManager } from "../EmojiPackManager";
import { SuperReactionsSection } from "../SuperReactionsSection";
import { ModalField, modalInputClass, ModalPrimaryButton } from "../Modal";
import { SpaceRolesContent } from "./SpaceRolesContent";
import { type SettingsPane, SettingsModalShell } from "./SettingsModalShell";

/** Your nickname/avatar across the whole server (best-effort cascade to its channels). */
function MySpaceProfile({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const ownUserId = client.getUserId() ?? "";
  const member = client.getRoom(spaceId)?.getMember(ownUserId);

  const [nick, setNick] = useState(member?.rawDisplayName ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [clearAvatar, setClearAvatar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Re-seed when switching servers.
  useEffect(() => {
    setNick(member?.rawDisplayName ?? "");
  }, [spaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const previewUrl = useAuthedMedia(
    file ? null : (member?.getMxcAvatarUrl() ?? null),
    { width: 64, height: 64, method: "crop" },
  );

  async function apply() {
    setBusy(true);
    try {
      await setSpaceProfile(client, spaceId, nick.trim() || null, clearAvatar ? null : (file ?? undefined));
      setFile(null);
      setClearAvatar(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-bold uppercase text-muted">{t("spaceSettings.myProfile")}</h3>
      <div className="mb-2 flex items-center gap-3">
        {file ? (
          <img src={URL.createObjectURL(file)} alt="" className="h-12 w-12 rounded-full object-cover" />
        ) : clearAvatar ? (
          <Avatar url={null} name={nick || ownUserId} size={48} />
        ) : (
          <Avatar url={previewUrl} name={nick || ownUserId} size={48} />
        )}
        <div className="flex flex-col gap-1">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded border border-border px-2.5 py-1 text-xs font-medium text-normal hover:bg-bg-modifier-hover"
          >
            {t("spaceSettings.profileAvatar")}
          </button>
          {(file || member?.getMxcAvatarUrl()) && (
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setClearAvatar(true);
              }}
              className="text-left text-[11px] text-muted hover:text-dnd"
            >
              {t("spaceSettings.profileAvatarReset")}
            </button>
          )}
        </div>
      </div>
      <input
        className={modalInputClass()}
        value={nick}
        onChange={(e) => setNick(e.target.value)}
        placeholder={client.getUser(ownUserId)?.displayName ?? ownUserId}
        aria-label={t("spaceSettings.myProfile")}
      />
      <p className="mt-1 text-xs text-muted">{t("spaceSettings.myProfileHint")}</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void apply()}
        className="mt-2 rounded bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover disabled:opacity-50"
      >
        {busy ? t("common.saving") : saved ? t("common.saved") : t("common.save")}
      </button>
      <div className="mt-4 border-t border-border pt-4">
        <SpaceDmPrivacyToggle spaceId={spaceId} />
      </div>
    </div>
  );
}

/** My own preference - not admin-set - for whether members of this space may open a first DM with me. */
function SpaceDmPrivacyToggle({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const [allowed, setAllowed] = useState(() => isDmAllowedFromSpace(client, spaceId));

  return (
    <label className="flex items-center justify-between gap-3 text-sm text-normal">
      <span>
        {t("spaceSettings.allowDms")}
        <span className="block text-xs font-normal text-muted">{t("spaceSettings.allowDmsHint")}</span>
      </span>
      <input
        type="checkbox"
        checked={allowed}
        onChange={(e) => {
          setAllowed(e.target.checked);
          void setDmAllowedFromSpace(client, spaceId, e.target.checked);
        }}
        className="h-4 w-4 shrink-0"
      />
    </label>
  );
}

/** Rules screen / self-assignable roles / welcome message shown once to new members - see OnboardingGate.tsx. */
function OnboardingSettings({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const space = client.getRoom(spaceId);
  const config = space ? getOnboardingConfig(space) : null;

  const [enabled, setEnabled] = useState(config?.enabled ?? false);
  const [rules, setRules] = useState(config?.rules ?? "");
  const [welcomeMessage, setWelcomeMessage] = useState(config?.welcomeMessage ?? "");
  const [selfAssignableRoleIds, setSelfAssignableRoleIds] = useState<string[]>(config?.selfAssignableRoleIds ?? []);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!space || !config) return null;
  const ownUserId = client.getUserId() ?? "";
  if (!canManageOnboarding(space, ownUserId)) return null;

  const cosmeticRoles = getSpaceRoles(space).filter((r) => r.powerLevel === undefined);
  const rolesOpenToMembers = membersCanManageRoles(space);

  async function handleSave() {
    setBusy(true);
    try {
      await setOnboardingConfig(client, spaceId, { enabled, rules, welcomeMessage, selfAssignableRoleIds });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3 className="mb-1.5 text-xs font-bold uppercase text-muted">{t("onboarding.settingsTitle")}</h3>
      <label className="mb-3 flex items-center gap-2 text-sm text-normal">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
        {t("onboarding.enable")}
      </label>
      {enabled && (
        <>
          <ModalField label={t("onboarding.rulesLabel")}>
            <textarea
              className={modalInputClass() + " min-h-[80px] resize-y"}
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              placeholder={t("onboarding.rulesPlaceholder")}
            />
          </ModalField>
          <ModalField label={t("onboarding.welcomeLabel")}>
            <textarea
              className={modalInputClass() + " min-h-[60px] resize-y"}
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
              placeholder={t("onboarding.welcomePlaceholder")}
            />
          </ModalField>
          {cosmeticRoles.length > 0 && (
            <div className="mb-3">
              <span className="mb-1 block text-xs font-bold uppercase text-muted">
                {t("onboarding.selfAssignableRoles")}
              </span>
              <div className="flex flex-wrap gap-2">
                {cosmeticRoles.map((role) => {
                  const active = selfAssignableRoleIds.includes(role.id);
                  return (
                    <button
                      key={role.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setSelfAssignableRoleIds((prev) =>
                          active ? prev.filter((id) => id !== role.id) : [...prev, role.id],
                        )
                      }
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                        active ? "" : "border-border text-muted hover:text-normal"
                      }`}
                      style={
                        active
                          ? { borderColor: role.color, backgroundColor: `${role.color}26`, color: role.color }
                          : undefined
                      }
                    >
                      {role.name}
                    </button>
                  );
                })}
              </div>
              {selfAssignableRoleIds.length > 0 && !rolesOpenToMembers && (
                <div className="mt-2 rounded bg-dnd/10 px-3 py-2 text-xs text-dnd">
                  {t("onboarding.rolesPermissionWarning")}{" "}
                  <button
                    type="button"
                    onClick={() => void allowMembersToManageRoles(client, spaceId)}
                    className="underline hover:no-underline"
                  >
                    {t("onboarding.rolesPermissionFix")}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={busy}
        className="mt-3 w-full rounded border border-brand py-1.5 text-sm font-medium text-brand transition hover:bg-brand/10 disabled:opacity-50"
      >
        {busy ? t("common.saving") : saved ? t("common.saved") : t("common.save")}
      </button>
    </div>
  );
}

/** Server-wide switch for whether members may use their OWN personal emoji pack (personalEmoji.ts) in this space's rooms, on top of the space's own custom emoji. */
function PersonalEmojiToggle({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const space = client.getRoom(spaceId);
  if (!space) return null;
  const allowed = isPersonalEmojiAllowed(space);
  return (
    <label className="mb-4 flex cursor-pointer items-center justify-between gap-3 rounded border border-border px-3 py-2.5 text-sm text-normal">
      <span>
        {t("spaceSettings.allowPersonalEmoji")}
        <span className="block text-xs font-normal text-muted">{t("spaceSettings.allowPersonalEmojiHint")}</span>
      </span>
      <input
        type="checkbox"
        checked={allowed}
        onChange={(e) => void updateSpaceSettings(client, spaceId, { allow_personal_emoji: e.target.checked })}
        className="h-4 w-4 shrink-0"
      />
    </label>
  );
}

/** Discord's "Server Members" admin table - every joined member, when they joined, their roles, and kick/ban/manage-roles actions. */
function SpaceMembersSettings({ spaceId, onOpenRoles }: { spaceId: string; onOpenRoles: () => void }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const bumpTick = useMatrixStore((s) => s.bumpTick);
  const space = client.getRoom(spaceId);
  const [filter, setFilter] = useState("");
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [rolePickerFor, setRolePickerFor] = useState<string | null>(null);
  // Optimistic per-(user, role) overrides so a checkbox flips instantly
  // instead of waiting on the state-event round trip through /sync, same
  // pattern as the per-role member checklist in SpaceRolesContent.
  const [roleOverrides, setRoleOverrides] = useState<Record<string, Record<string, boolean>>>({});

  if (!space) return null;
  const ownUserId = client.getUserId() ?? "";
  const assignableRoles = getSpaceRoles(space);

  function toggleMemberRole(userId: string, roleId: string, has: boolean) {
    const next = !has;
    setRoleOverrides((prev) => ({ ...prev, [userId]: { ...prev[userId], [roleId]: next } }));
    setMemberRoleAssigned(client, spaceId, userId, roleId, next)
      .then(() => bumpTick())
      .catch((err: unknown) => {
        setRoleOverrides((prev) => ({ ...prev, [userId]: { ...prev[userId], [roleId]: has } }));
        void uiAlert((err as Error).message);
      });
  }

  const query = filter.trim().toLowerCase();
  const members = space
    .getMembersWithMembership("join")
    .filter((m) => !query || m.name.toLowerCase().includes(query) || m.userId.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));

  const joinTs = (userId: string): number | null => {
    const ev = space.getMember(userId)?.events?.member;
    return ev ? ev.getTs() : null;
  };

  async function act(userId: string, fn: () => Promise<unknown>) {
    setBusyUser(userId);
    try {
      await fn();
      bumpTick();
    } catch (err) {
      await uiAlert((err as Error).message);
    } finally {
      setBusyUser(null);
    }
  }

  return (
    <div className="mt-6 border-t border-border pt-4">
      <h3 className="mb-1.5 text-xs font-bold uppercase text-muted">{t("spaceMembers.title")}</h3>
      <p className="mb-2 text-xs text-muted">{t("spaceMembers.count", { count: space.getJoinedMemberCount() })}</p>
      <input
        className={modalInputClass()}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t("spaceMembers.searchPlaceholder")}
        aria-label={t("spaceMembers.searchPlaceholder")}
      />
      <div className="mt-2 flex max-h-96 flex-col divide-y divide-border overflow-y-auto">
        {members.slice(0, 200).map((m) => {
          const roles = getMemberRoles(space, m.userId);
          const ts = joinTs(m.userId);
          const mayKick = canKick(space, ownUserId, m.userId);
          const mayBan = canBan(space, ownUserId, m.userId);
          const mayRoles = canManageRoles(space, ownUserId);
          return (
            <div key={m.userId}>
            <div className="flex items-center gap-2 py-2 text-sm">
              <Avatar
                url={m.getAvatarUrl(client.baseUrl, 28, 28, "crop", false, false)}
                name={m.name}
                size={28}
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1 truncate text-normal">
                  <span className="truncate">{m.name}</span>
                  {roles.map((r) => (
                    <span
                      key={r.id}
                      className="shrink-0 rounded px-1 text-[10px]"
                      style={{ backgroundColor: `${r.color}22`, color: r.color }}
                    >
                      {r.name}
                    </span>
                  ))}
                </span>
                <span className="truncate text-[11px] text-muted">
                  {ts
                    ? t("spaceMembers.joined", { date: new Date(ts).toLocaleDateString(intlLocale()) })
                    : m.userId}
                </span>
              </div>
              {mayRoles && (
                <button
                  type="button"
                  onClick={() => setRolePickerFor(rolePickerFor === m.userId ? null : m.userId)}
                  aria-expanded={rolePickerFor === m.userId}
                  className="shrink-0 rounded px-2 py-1 text-xs font-medium text-muted hover:bg-bg-modifier-hover hover:text-normal"
                >
                  {t("spaceMembers.roles")}
                </button>
              )}
              {mayKick && m.userId !== ownUserId && (
                <button
                  type="button"
                  disabled={busyUser === m.userId}
                  onClick={() =>
                    void (async () => {
                      if (await uiConfirm(t("spaceMembers.kickConfirm", { name: m.name }), { danger: true })) {
                        await act(m.userId, () => kickMember(client, spaceId, m.userId));
                      }
                    })()
                  }
                  className="shrink-0 rounded px-2 py-1 text-xs font-medium text-dnd hover:bg-dnd/10 disabled:opacity-50"
                >
                  {t("spaceMembers.kick")}
                </button>
              )}
              {mayBan && m.userId !== ownUserId && (
                <button
                  type="button"
                  disabled={busyUser === m.userId}
                  onClick={() =>
                    void (async () => {
                      if (await uiConfirm(t("spaceMembers.banConfirm", { name: m.name }), { danger: true })) {
                        await act(m.userId, () => banMember(client, spaceId, m.userId));
                      }
                    })()
                  }
                  className="shrink-0 rounded px-2 py-1 text-xs font-medium text-dnd hover:bg-dnd/10 disabled:opacity-50"
                >
                  {t("spaceMembers.ban")}
                </button>
              )}
            </div>
            {rolePickerFor === m.userId && (
              <div className="mb-2 ml-9 flex flex-wrap gap-1.5 rounded bg-bg-modifier-hover/50 p-2">
                {assignableRoles.length === 0 && (
                  <span className="text-xs text-muted">{t("spaceMembers.noRoles")}</span>
                )}
                {assignableRoles.map((role) => {
                  const has =
                    roleOverrides[m.userId]?.[role.id] ?? roles.some((r) => r.id === role.id);
                  return (
                    <label
                      key={role.id}
                      className="flex cursor-pointer items-center gap-1.5 rounded border border-border px-2 py-1 text-xs"
                      style={has ? { borderColor: role.color, color: role.color } : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={has}
                        onChange={() => toggleMemberRole(m.userId, role.id, has)}
                        className="h-3.5 w-3.5"
                      />
                      {role.name}
                    </label>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setRolePickerFor(null);
                    onOpenRoles();
                  }}
                  className="rounded px-2 py-1 text-xs font-medium text-link hover:underline"
                >
                  {t("spaceMembers.manageRoles")}
                </button>
              </div>
            )}
            </div>
          );
        })}
        {members.length > 200 && (
          <p className="py-2 text-center text-xs text-muted">{t("spaceMembers.truncated")}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Links/unlinks existing rooms to this space via m.space.child. Exists
 * because a room joined outside JorKonvo's own "create channel in this
 * space" flow (e.g. a server admin adding members to a space AND a room
 * separately via the Synapse admin API) never gets this link on its own -
 * membership in a room and a room being listed as a space's child are two
 * independent things in Matrix, and there was previously no UI for the
 * second one at all.
 */
function SpaceRoomsSettings({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const bumpTick = useMatrixStore((s) => s.bumpTick);
  const openModal = useModalStore((s) => s.open);
  const [manualTarget, setManualTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentRooms = getRoomsInSpace(client, spaceId);
  const currentIds = new Set(currentRooms.map((r) => r.roomId));
  const candidateRooms = getUngroupedRooms(client).filter((r) => !currentIds.has(r.roomId));

  async function add(roomId: string) {
    setBusy(true);
    setError(null);
    try {
      await addRoomToSpace(client, spaceId, roomId);
      bumpTick();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleManualAdd() {
    if (!manualTarget.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const roomId = await resolveRoomTarget(client, manualTarget.trim());
      await addRoomToSpace(client, spaceId, roomId);
      setManualTarget("");
      bumpTick();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h3 className="mb-1.5 text-xs font-bold uppercase text-muted">{t("spaceSettings.roomsCurrent")}</h3>
      {currentRooms.length === 0 && (
        <p className="mb-3 text-xs text-muted">{t("spaceSettings.roomsCurrentEmpty")}</p>
      )}
      <div className="mb-4 flex max-h-56 flex-col divide-y divide-border overflow-y-auto">
        {currentRooms.map((room) => (
          <div key={room.roomId} className="flex items-center gap-2 py-1.5 text-sm">
            <button
              type="button"
              title={t("spaceSettings.roomsOpenSettings")}
              onClick={() => openModal({ type: "roomSettings", roomId: room.roomId })}
              className="flex min-w-0 flex-1 items-center gap-2 rounded text-left hover:text-header"
            >
              <Avatar
                url={room.getAvatarUrl(client.baseUrl, 24, 24, "crop", false)}
                name={room.name || "?"}
                size={24}
              />
              <span className="min-w-0 flex-1 truncate text-normal">{room.name || room.roomId}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void (async () => {
                  if (
                    await uiConfirm(t("spaceSettings.roomsRemoveConfirm", { name: room.name || room.roomId }), {
                      danger: true,
                    })
                  ) {
                    setBusy(true);
                    setError(null);
                    try {
                      await removeRoomFromSpace(client, spaceId, room.roomId);
                      bumpTick();
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }
                })()
              }
              className="shrink-0 rounded px-2 py-1 text-xs font-medium text-dnd hover:bg-dnd/10 disabled:opacity-50"
            >
              {t("spaceSettings.roomsRemove")}
            </button>
          </div>
        ))}
      </div>

      <h3 className="mb-1.5 text-xs font-bold uppercase text-muted">{t("spaceSettings.roomsAddExisting")}</h3>
      <p className="mb-2 text-xs text-muted">{t("spaceSettings.roomsAddExistingHint")}</p>
      {candidateRooms.length === 0 ? (
        <p className="mb-3 text-xs text-muted">{t("spaceSettings.roomsNoneToAdd")}</p>
      ) : (
        <div className="mb-3 flex max-h-40 flex-col divide-y divide-border overflow-y-auto">
          {candidateRooms.map((room) => (
            <div key={room.roomId} className="flex items-center gap-2 py-1.5 text-sm">
              <Avatar
                url={room.getAvatarUrl(client.baseUrl, 24, 24, "crop", false)}
                name={room.name || "?"}
                size={24}
              />
              <span className="min-w-0 flex-1 truncate text-normal">{room.name || room.roomId}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void add(room.roomId)}
                className="shrink-0 rounded px-2 py-1 text-xs font-medium text-brand hover:bg-brand/10 disabled:opacity-50"
              >
                {t("spaceSettings.roomsAdd")}
              </button>
            </div>
          ))}
        </div>
      )}

      <ModalField label={t("spaceSettings.roomsManualLabel")}>
        <div className="flex gap-2">
          <input
            className={modalInputClass()}
            value={manualTarget}
            onChange={(e) => setManualTarget(e.target.value)}
            placeholder={t("spaceSettings.roomsManualPlaceholder")}
          />
          <button
            type="button"
            disabled={busy || !manualTarget.trim()}
            onClick={() => void handleManualAdd()}
            className="shrink-0 rounded border border-border px-3 py-1.5 text-xs font-medium text-normal transition hover:bg-bg-modifier-hover disabled:opacity-50"
          >
            {t("spaceSettings.roomsAdd")}
          </button>
        </div>
      </ModalField>
      {error && <p className="mt-2 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
    </>
  );
}

/** Discord's "send a random welcome message when someone joins this server" - a real posted message, distinct from OnboardingSettings' rules-gate-only welcome text above. */
function WelcomeMessageSettings({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const space = client.getRoom(spaceId);
  const config = space ? getWelcomeMessageConfig(space) : null;
  const textRooms = getRoomsInSpace(client, spaceId).filter((r) => !isVoiceChannel(r));

  const [enabled, setEnabled] = useState(config?.enabled ?? false);
  const [channelId, setChannelId] = useState(config?.channelId ?? "");
  const [messagesText, setMessagesText] = useState((config?.messages ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!space || !config) return null;
  const ownUserId = client.getUserId() ?? "";
  if (!canManageWelcomeMessage(space, ownUserId)) return null;

  async function handleSave() {
    setBusy(true);
    try {
      const messages = messagesText.split("\n").map((m) => m.trim()).filter(Boolean);
      await setWelcomeMessageConfig(client, spaceId, { enabled, channelId: channelId || null, messages });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 border-t border-border pt-4">
      <h3 className="mb-1.5 text-xs font-bold uppercase text-muted">{t("welcomeMessage.title")}</h3>
      <label className="mb-3 flex items-center gap-2 text-sm text-normal">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
        {t("welcomeMessage.enable")}
      </label>
      {enabled && (
        <>
          <ModalField label={t("welcomeMessage.channelLabel")}>
            <select className={modalInputClass()} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">{t("welcomeMessage.channelNone")}</option>
              {textRooms.map((room) => (
                <option key={room.roomId} value={room.roomId}>
                  {room.name || room.roomId}
                </option>
              ))}
            </select>
          </ModalField>
          <ModalField label={t("welcomeMessage.messagesLabel")}>
            <textarea
              className={modalInputClass() + " min-h-[80px] resize-y"}
              value={messagesText}
              onChange={(e) => setMessagesText(e.target.value)}
              placeholder={t("welcomeMessage.messagesPlaceholder")}
            />
          </ModalField>
          <p className="mb-3 text-xs text-muted">{t("welcomeMessage.messagesHint")}</p>
        </>
      )}
      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={busy}
        className="w-full rounded border border-brand py-1.5 text-sm font-medium text-brand transition hover:bg-brand/10 disabled:opacity-50"
      >
        {busy ? t("common.saving") : saved ? t("common.saved") : t("common.save")}
      </button>
    </div>
  );
}

/** Admin-set fallback notification mode for members who haven't personally overridden their own. */
function SpaceDefaultNotificationsSettings({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const space = client.getRoom(spaceId);
  const [mode, setMode] = useState<SpaceDefaultNotificationMode>(space ? getSpaceDefaultNotificationMode(space) : "all");

  if (!space || !canSetSpaceDefaultNotifications(space, client.getUserId() ?? "")) return null;

  async function handleChange(next: SpaceDefaultNotificationMode) {
    setMode(next);
    await setSpaceDefaultNotificationMode(client, spaceId, next);
  }

  return (
    <div className="mt-6 border-t border-border pt-4">
      <h3 className="mb-1.5 text-xs font-bold uppercase text-muted">{t("spaceSettings.defaultNotifTitle")}</h3>
      <p className="mb-2 text-xs text-muted">{t("spaceSettings.defaultNotifHint")}</p>
      <select className={modalInputClass()} value={mode} onChange={(e) => void handleChange(e.target.value as SpaceDefaultNotificationMode)}>
        <option value="all">{t("chat.notifyAll")}</option>
        <option value="mentions">{t("chat.notifyMentions")}</option>
      </select>
    </div>
  );
}

/**
 * Space (server) settings modal: per-user profile, banner/appearance, upload
 * policy, invite policy and link, emoji, super reactions, members, roles and
 * onboarding panes, permission-gated per section and laid out by the shared
 * SettingsModalShell.
 *
 * @param spaceId - Matrix room ID of the space whose settings are edited.
 * @param initialPaneId - Optional pane to open first (e.g. deep-linking "roles").
 */
export function SpaceSettingsModal({ spaceId, initialPaneId }: { spaceId: string; initialPaneId?: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const close = useModalStore((s) => s.close);
  const bumpTick = useMatrixStore((s) => s.bumpTick);
  // Without this, the modal never re-renders on its own after a state event
  // lands (banner/icon upload, role/permission change, etc.) - confirmed
  // live: the banner only refreshed after closing and reopening the modal,
  // even though bumpTick() is already called after those same mutations
  // below (it just had no subscriber here to bump). RoomSidebar and the
  // other settings panes already subscribe the same way.
  useMatrixStore((s) => s.syncTick);
  const [activePaneId, setActivePaneId] = useState<string | undefined>(initialPaneId);
  const space = client.getRoom(spaceId);
  const settings = space ? getSpaceSettings(space) : {};

  const textRooms = getRoomsInSpace(client, spaceId).filter((r) => !isVoiceChannel(r));
  const [defaultRoomId, setDefaultRoomId] = useState<string>(settings.default_room_id ?? "");
  const [maxUploadMb, setMaxUploadMb] = useState<string>(
    settings.max_upload_mb ? String(settings.max_upload_mb) : "",
  );
  const [compressImages, setCompressImages] = useState<boolean>(settings.compress_images ?? true);
  const [serverLimitMb, setServerLimitMb] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [iconBusy, setIconBusy] = useState(false);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const [bannerBusy, setBannerBusy] = useState(false);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const bannerMxc = space ? getSpaceBannerMxc(space) : null;
  const bannerPreview = useAuthedMedia(bannerMxc, { width: 600, height: 200, method: "scale", animated: true });
  const bannerIsCustom = space ? hasCustomSpaceBanner(space) : false;

  const ownUserId = client.getUserId() ?? "";
  const mayManageInvitePolicy = space ? canManagePowerLevels(space, ownUserId) : false;
  const mayInvite = space ? canInviteToRoom(space, ownUserId) : false;
  const [invitePl, setInvitePl] = useState<number>(space ? getInvitePowerLevel(space) : 0);
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const [allowRoomKnocking, setAllowRoomKnocking] = useState<boolean>(settings.allow_room_knocking ?? false);
  // The SPACE's own join_rule (distinct from allowRoomKnocking above, which
  // only governs CHANNELS created inside it) - "public" means an invite
  // link/bare id is enough to join outright, no approval, matching a
  // Discord invite link; "knock"/"invite" both require an admin's yes.
  // Only "public" vs. "knock" are offered here (a top-level space, unlike
  // a room, has no owning space "restricted" could key off of).
  const mayChangeSpaceJoinRule = space ? canSetJoinRule(space, ownUserId) : false;
  const [requireApprovalToJoin, setRequireApprovalToJoin] = useState<boolean>(
    space ? getJoinRule(space) !== "public" : false,
  );
  const [spaceJoinRuleBusy, setSpaceJoinRuleBusy] = useState(false);

  async function handleInvitePlChange(next: number) {
    setInvitePl(next);
    setError(null);
    try {
      await setInvitePowerLevel(client, spaceId, next);
      bumpTick();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleAllowKnockingChange(next: boolean) {
    setAllowRoomKnocking(next);
    setError(null);
    try {
      await setSpaceKnockingAllowed(client, spaceId, next);
      bumpTick();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleSpaceJoinRuleChange(nextRequireApproval: boolean) {
    setRequireApprovalToJoin(nextRequireApproval);
    setSpaceJoinRuleBusy(true);
    setError(null);
    try {
      await setJoinRule(client, spaceId, nextRequireApproval ? "knock" : "public");
      bumpTick();
    } catch (err) {
      setError((err as Error).message);
      setRequireApprovalToJoin(!nextRequireApproval);
    } finally {
      setSpaceJoinRuleBusy(false);
    }
  }

  async function handleCopyInviteLink() {
    if (!space) return;
    await navigator.clipboard.writeText(getRoomInviteLink(client, space));
    setInviteLinkCopied(true);
    setTimeout(() => setInviteLinkCopied(false), 2000);
  }

  async function handleIconPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setIconBusy(true);
    setError(null);
    try {
      await setRoomAvatarImage(client, spaceId, file);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIconBusy(false);
    }
  }

  async function handleBannerPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBannerBusy(true);
    setError(null);
    try {
      await setSpaceBanner(client, spaceId, file);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBannerBusy(false);
    }
  }

  useEffect(() => {
    void getServerUploadLimit(client).then((bytes) =>
      setServerLimitMb(bytes != null ? Math.round(bytes / (1024 * 1024)) : null),
    );
  }, [client]);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const mb = maxUploadMb.trim() ? Number(maxUploadMb) : undefined;
      await updateSpaceSettings(client, spaceId, {
        default_room_id: defaultRoomId || undefined,
        max_upload_mb: mb && mb > 0 ? mb : undefined,
        compress_images: compressImages ? undefined : false, // default is true, so only store when disabling
      });
      bumpTick();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const mayEmoji = !!space && canManageSpaceEmojis(space, ownUserId);
  const maySuperReact = !!space && canManageSuperReactions(space, ownUserId);
  const mayManageMembers = !!space && (canManagePowerLevels(space, ownUserId) || canManageRoles(space, ownUserId));

  const panes: SettingsPane[] = [
    {
      id: "profile",
      label: t("spaceSettings.catProfile"),
      keywords: "profil profile becenév nickname avatar kép",
      render: () => <MySpaceProfile spaceId={spaceId} />,
    },
    {
      id: "appearance",
      label: t("spaceSettings.catAppearance"),
      keywords:
        "banner ikon icon megjelenés appearance kép cover borító alapértelmezett szoba default landing room csatorna",
      render: () => (
        <>
          <span className="mb-1.5 block text-xs font-bold uppercase text-muted">{t("spaceSettings.icon")}</span>
          <div className="mb-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => iconInputRef.current?.click()}
              className="rounded-full"
              title={t("spaceSettings.iconChoose")}
              aria-label={t("spaceSettings.iconChoose")}
            >
              <Avatar
                url={space ? space.getAvatarUrl(client.baseUrl, 56, 56, "crop", false) : null}
                name={space?.name || "?"}
                size={56}
              />
            </button>
            <input ref={iconInputRef} type="file" accept="image/*" className="hidden" onChange={handleIconPick} />
            <div>
              <button
                type="button"
                disabled={iconBusy}
                onClick={() => iconInputRef.current?.click()}
                className="rounded border border-border px-3 py-1.5 text-xs font-medium text-normal transition hover:bg-bg-modifier-hover disabled:opacity-50"
              >
                {iconBusy ? t("common.saving") : t("spaceSettings.iconChoose")}
              </button>
              <p className="mt-1 text-xs text-muted">{t("spaceSettings.iconHint")}</p>
            </div>
          </div>
          <span className="mb-1.5 block text-xs font-bold uppercase text-muted">{t("spaceSettings.banner")}</span>
          <div
            className="mb-2 h-24 w-full overflow-hidden rounded-lg bg-gradient-to-br from-brand/40 to-brand-hover/20 bg-cover bg-center"
            style={bannerPreview ? { backgroundImage: `url(${bannerPreview})` } : undefined}
          />
          <div className="flex gap-2">
            <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerPick} />
            <button
              type="button"
              disabled={bannerBusy}
              onClick={() => bannerInputRef.current?.click()}
              className="rounded border border-border px-3 py-1.5 text-xs font-medium text-normal transition hover:bg-bg-modifier-hover disabled:opacity-50"
            >
              {bannerBusy ? t("common.saving") : t("spaceSettings.bannerChoose")}
            </button>
            {bannerIsCustom && (
              <button
                type="button"
                disabled={bannerBusy}
                onClick={() => void clearSpaceBanner(client, spaceId)}
                className="rounded border border-dnd px-3 py-1.5 text-xs font-medium text-dnd transition hover:bg-dnd/10 disabled:opacity-50"
              >
                {t("spaceSettings.bannerReset")}
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">{t("spaceSettings.bannerHint")}</p>

          <div className="mt-4">
            <ModalField label={t("spaceSettings.defaultRoom")}>
              <select
                className={modalInputClass()}
                value={defaultRoomId}
                onChange={(e) => setDefaultRoomId(e.target.value)}
              >
                <option value="">{t("spaceSettings.defaultRoomNone")}</option>
                {textRooms.map((room) => (
                  <option key={room.roomId} value={room.roomId}>
                    {room.name || room.roomId}
                  </option>
                ))}
              </select>
            </ModalField>
            <p className="text-xs text-muted">{t("spaceSettings.defaultRoomHint")}</p>
          </div>
        </>
      ),
    },
    ...(mayManageInvitePolicy
      ? [
          {
            id: "rooms",
            label: t("spaceSettings.catRooms"),
            keywords: "szoba room hozzáadás add link kapcsolás existing meglévő",
            render: () => <SpaceRoomsSettings spaceId={spaceId} />,
          } as SettingsPane,
        ]
      : []),
    {
      id: "uploads",
      label: t("spaceSettings.catUploads"),
      keywords: "feltöltés upload méret compress tömörítés kép",
      render: () => (
        <>
          <ModalField label={t("spaceSettings.maxUpload")}>
            <input
              type="number"
              min={1}
              className={modalInputClass()}
              value={maxUploadMb}
              onChange={(e) => setMaxUploadMb(e.target.value)}
              placeholder={serverLimitMb != null ? `${serverLimitMb} MB` : ""}
            />
          </ModalField>
          <p className="mb-3 text-xs text-muted">
            {t("spaceSettings.uploadServerNote", { limit: serverLimitMb != null ? `${serverLimitMb} MB` : "?" })}
          </p>
          <label className="flex items-center justify-between gap-3 text-sm text-normal">
            <span>
              {t("spaceSettings.compressImages")}
              <span className="block text-xs font-normal text-muted">
                {t("spaceSettings.compressImagesHint")}
              </span>
            </span>
            <input
              type="checkbox"
              checked={compressImages}
              onChange={(e) => setCompressImages(e.target.checked)}
              className="h-4 w-4 shrink-0"
            />
          </label>
          {error && <p className="mt-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
          <div className="mt-3">
            <ModalPrimaryButton type="button" disabled={busy} onClick={() => void handleSave()}>
              {busy ? t("common.saving") : saved ? t("common.saved") : t("common.save")}
            </ModalPrimaryButton>
          </div>
        </>
      ),
    },
    ...(mayInvite || mayManageInvitePolicy
      ? [
          {
            id: "invites",
            label: t("spaceSettings.invitesTitle"),
            keywords: "meghívó invite link jogosultság permission who can invite qr",
            render: () => (
              <>
                {mayManageInvitePolicy && (
                  <label className="mb-3 block">
                    <span className="mb-1 block text-xs font-bold uppercase text-muted">
                      {t("spaceSettings.whoCanInvite")}
                    </span>
                    <select
                      value={invitePl}
                      onChange={(e) => void handleInvitePlChange(Number(e.target.value))}
                      className="w-full rounded bg-bg-darkest px-3 py-2 text-sm text-normal outline-none"
                    >
                      <option value={0}>{t("spaceSettings.inviteEveryone")}</option>
                      <option value={25}>{t("spaceSettings.inviteModerators")}</option>
                      <option value={50}>{t("spaceSettings.inviteAdmins")}</option>
                      <option value={100}>{t("spaceSettings.inviteOwner")}</option>
                    </select>
                    <span className="mt-1 block text-xs font-normal text-muted">
                      {t("spaceSettings.whoCanInviteHint")}
                    </span>
                  </label>
                )}
                {mayInvite && (
                  <button
                    type="button"
                    onClick={() => void handleCopyInviteLink()}
                    className="w-full rounded border border-border py-2 text-sm font-medium text-normal transition hover:bg-bg-modifier-hover"
                  >
                    {inviteLinkCopied ? t("spaceSettings.inviteLinkCopied") : t("spaceSettings.inviteLinkCopy")}
                  </button>
                )}
                {mayChangeSpaceJoinRule && (
                  <label className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4 text-sm text-normal">
                    <span>
                      {t("createSpace.requireApproval")}
                      <span className="block text-xs font-normal text-muted">
                        {t("createSpace.requireApprovalHint")}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      data-testid="space-settings-require-approval"
                      disabled={spaceJoinRuleBusy}
                      checked={requireApprovalToJoin}
                      onChange={(e) => void handleSpaceJoinRuleChange(e.target.checked)}
                      className="h-4 w-4 shrink-0"
                    />
                  </label>
                )}
                {mayManageInvitePolicy && (
                  <label className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4 text-sm text-normal">
                    <span>
                      {t("createSpace.allowKnocking")}
                      <span className="block text-xs font-normal text-muted">
                        {t("createSpace.allowKnockingHint")}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={allowRoomKnocking}
                      onChange={(e) => void handleAllowKnockingChange(e.target.checked)}
                      className="h-4 w-4 shrink-0"
                    />
                  </label>
                )}
              </>
            ),
          } as SettingsPane,
        ]
      : []),
    ...(mayEmoji
      ? [
          {
            id: "emoji",
            label: t("spaceSettings.catEmoji"),
            keywords: "emoji szerver custom egyéni matrica saját personal",
            render: () => (
              <>
                <PersonalEmojiToggle spaceId={spaceId} />
                <EmojiPackManager targetId={spaceId} scope="space" />
              </>
            ),
          } as SettingsPane,
        ]
      : []),
    ...(maySuperReact
      ? [
          {
            id: "super-reactions",
            label: t("superReact.title"),
            keywords: "super reaction reakció emoji burst effekt effect",
            render: () => <SuperReactionsSection targetId={spaceId} scope="space" />,
          } as SettingsPane,
        ]
      : []),
    ...(mayManageMembers
      ? [
          {
            id: "members",
            label: t("spaceSettings.catMembers"),
            keywords: "tag member kirúgás kick kitiltás ban szerepkör role tagok",
            render: () => <SpaceMembersSettings spaceId={spaceId} onOpenRoles={() => setActivePaneId("roles")} />,
          } as SettingsPane,
        ]
      : []),
    {
      id: "roles",
      label: t("roles.manageTitle"),
      keywords: "szerepkör role jogosultság permission tag member",
      render: () => <SpaceRolesContent spaceId={spaceId} />,
    },
    {
      id: "onboarding",
      label: t("spaceSettings.catOnboarding"),
      keywords: "onboarding szabályzat rules üdvözlő welcome szerepkör role beléptetés notification értesítés",
      render: () => (
        <>
          <OnboardingSettings spaceId={spaceId} />
          <WelcomeMessageSettings spaceId={spaceId} />
          <SpaceDefaultNotificationsSettings spaceId={spaceId} />
        </>
      ),
    },
  ];

  return (
    <SettingsModalShell
      title={t("spaceSettings.title", { name: space?.name ?? "" })}
      onClose={close}
      panes={panes}
      activePaneId={activePaneId}
      onPaneChange={setActivePaneId}
    />
  );
}
