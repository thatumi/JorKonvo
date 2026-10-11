import {
  canManageRoles,
  computeRequiredPowerLevel,
  createRole,
  deleteRole,
  getMemberRoleIds,
  getPermissionDef,
  getSpaceRoles,
  isRoleHoisted,
  isRoleMentionable,
  moveRole,
  type PermissionCategory,
  type PermissionId,
  PERMISSION_CATALOG,
  permissionsImpliedByPowerLevel,
  POWER_LEVEL_PRESETS,
  recolorRole,
  setRoleHoisted,
  setRoleIcon,
  setRoleMentionable,
  setRolePermissions,
  renameRole,
  setMemberRoleAssigned,
  type SpaceRole,
} from "@jorkonvo/matrix-core";
import { useRef, useState } from "react";
import { t as tr, useTranslation } from "../../i18n";
import { useAuthedMedia } from "../../lib/authedMedia";
import { uiConfirm } from "../../lib/dialogs";
import { useMatrixStore } from "../../state/matrixStore";
import { Avatar } from "../Avatar";
import { modalInputClass } from "../Modal";

const DEFAULT_COLORS = ["#f04747", "#faa61a", "#f1c40f", "#43b581", "#1abc9c", "#3498db", "#7289da", "#9b59b6", "#e91e63"];

const PERMISSION_CATEGORIES: PermissionCategory[] = ["general", "membership", "text"];

function RoleRow({
  spaceId,
  role,
  isFirst,
  isLast,
  onSelect,
  selected,
}: {
  spaceId: string;
  role: SpaceRole;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  selected: boolean;
}) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;

  return (
    <div
      className={`flex items-center gap-2 rounded px-2 py-1.5 ${selected ? "bg-bg-modifier-selected" : "hover:bg-bg-modifier-hover"}`}
    >
      <button
        type="button"
        onClick={onSelect}
        data-testid="role-list-item"
        data-role-name={role.name}
        className="flex flex-1 items-center gap-2 text-left"
      >
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: role.color }} />
        <span className="truncate text-sm text-normal">{role.name}</span>
        {typeof role.powerLevel === "number" && (
          <span title={t("roles.permTitle", { label: (() => { const pr = POWER_LEVEL_PRESETS.find((p) => p.value === role.powerLevel); return pr ? tr(pr.labelKey) : t("roles.customLevel", { level: role.powerLevel! }); })() })}>
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-muted" fill="currentColor">
              <path d="M12 2 4 5v6c0 5.25 3.44 9.94 8 11 4.56-1.06 8-5.75 8-11V5l-8-3Z" />
            </svg>
          </span>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        {!isFirst && (
          <button
            type="button"
            title={t("roles.moveUp")}
            aria-label={t("roles.moveUp")}
            onClick={() => void moveRole(client, spaceId, role.id, "up")}
            className="rounded p-0.5 text-muted hover:text-normal"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
              <path d="M7 14l5-5 5 5H7Z" />
            </svg>
          </button>
        )}
        {!isLast && (
          <button
            type="button"
            title={t("roles.moveDown")}
            aria-label={t("roles.moveDown")}
            onClick={() => void moveRole(client, spaceId, role.id, "down")}
            className="rounded p-0.5 text-muted hover:text-normal"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
              <path d="M7 10l5 5 5-5H7Z" />
            </svg>
          </button>
        )}
        <button
          type="button"
          title={t("roles.delete")}
          aria-label={t("roles.delete")}
          onClick={() =>
            void (async () => {
              if (await uiConfirm(t("roles.deleteConfirm", { name: role.name }), { danger: true })) {
                await deleteRole(client, spaceId, role.id);
              }
            })()
          }
          className="rounded p-0.5 text-muted hover:text-dnd"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
            <path d="M6 7h12l-1 14H7L6 7Zm3-4h6l1 2h4v2H4V5h4l1-2Z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function RoleEditor({ spaceId, role }: { spaceId: string; role: SpaceRole }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const space = client.getRoom(spaceId)!;
  const [name, setName] = useState(role.name);
  const members = space.getMembersWithMembership("join").sort((a, b) => a.name.localeCompare(b.name));
  // The checkbox's real state comes from a state-event round trip through
  // /sync, which can lag a click by a beat - track it optimistically here
  // (keyed per role, reset when switching roles via the `key` on RoleEditor)
  // so the checkbox flips immediately instead of looking unresponsive.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [memberFilter, setMemberFilter] = useState("");
  const iconRef = useRef<HTMLInputElement>(null);
  const iconSrc = useAuthedMedia(role.icon ?? null, { width: 40, height: 40, method: "scale", animated: true });

  // What this role ACTUALLY currently grants, whether or not `permissions`
  // has ever been touched - a role that predates this feature (only a
  // manual `powerLevel`) derives power-level-tier checks from that level,
  // and defaults every client-tier one (no power-level equivalent at all)
  // to granted, matching hasClientPermission's own "never configured -
  // allowed" rule. Seeding the checkboxes from this (rather than from
  // `role.permissions` directly, which is undefined for such a role) means
  // the very first edit here can't silently take away something the role
  // already effectively grants.
  const clientTierIds = PERMISSION_CATALOG.filter((p) => p.tier === "client").map((p) => p.id);
  const effectiveIds =
    role.permissions ?? [...permissionsImpliedByPowerLevel(space, role.powerLevel ?? 0), ...clientTierIds];
  const [checked, setChecked] = useState<Set<PermissionId>>(new Set(effectiveIds));
  const [permBusy, setPermBusy] = useState(false);

  const computedLevel = computeRequiredPowerLevel(client, spaceId, [...checked]);
  // Matrix's power level is a single scalar, not an independent bit per
  // permission - the computed level unavoidably also satisfies every OTHER
  // power-level permission whose own threshold is at or below it, in every
  // room. Surfaced here rather than left as a silent surprise.
  const impliedExtra = permissionsImpliedByPowerLevel(space, computedLevel).filter((id) => !checked.has(id));

  async function togglePermission(id: PermissionId, next: boolean) {
    const nextSet = new Set(checked);
    if (next) nextSet.add(id);
    else nextSet.delete(id);
    setChecked(nextSet);
    setPermBusy(true);
    try {
      await setRolePermissions(client, spaceId, role.id, [...nextSet]);
    } catch (err) {
      console.error("failed to set role permissions", err);
      setChecked(checked);
    } finally {
      setPermBusy(false);
    }
  }

  function toggleMember(userId: string, has: boolean) {
    const next = !has;
    setOverrides((prev) => ({ ...prev, [userId]: next }));
    setMemberRoleAssigned(client, spaceId, userId, role.id, next).catch((err) => {
      console.error("failed to assign role", err);
      setOverrides((prev) => ({ ...prev, [userId]: has }));
    });
  }

  return (
    <div className="flex-1 overflow-y-auto pl-4">
      <div className="mb-3 flex items-center gap-2">
        <input
          className={modalInputClass()}
          aria-label={t("roles.nameLabel")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== role.name && void renameRole(client, spaceId, role.id, name.trim())}
        />
      </div>
      <span className="mb-1 block text-xs font-bold uppercase text-muted">{t("roles.colorLabel")}</span>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {DEFAULT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            onClick={() => void recolorRole(client, spaceId, role.id, c)}
            className="h-6 w-6 rounded-full ring-offset-2 ring-offset-bg-secondary transition"
            style={{ backgroundColor: c, boxShadow: role.color === c ? `0 0 0 2px ${c}` : undefined }}
          />
        ))}
      </div>
      <span className="mb-1 block text-xs font-bold uppercase text-muted">{t("roles.iconLabel")}</span>
      <div className="mb-1 flex items-center gap-2">
        {iconSrc && <img src={iconSrc} alt="" className="h-6 w-6 object-contain" />}
        <input ref={iconRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void setRoleIcon(client, spaceId, role.id, f); }} />
        <button type="button" onClick={() => iconRef.current?.click()} className="rounded border border-border px-2 py-1 text-xs font-medium text-normal hover:bg-bg-modifier-hover">{t("roles.iconPick")}</button>
        {role.icon && <button type="button" onClick={() => void setRoleIcon(client, spaceId, role.id, null)} className="text-xs text-muted hover:text-dnd">{t("roles.iconRemove")}</button>}
      </div>
      <p className="mb-3 text-[11px] text-muted">{t("roles.iconHint")}</p>
      <span className="mb-1 block text-xs font-bold uppercase text-muted">{t("permission.sectionTitle")}</span>
      <p className="mb-3 text-xs text-muted">{t("permission.sectionHint")}</p>
      {PERMISSION_CATEGORIES.map((category) => (
        <div key={category} className="mb-3">
          <span className="mb-1 block text-[11px] font-bold uppercase text-muted/80">
            {t(`permission.category.${category}`)}
          </span>
          <div className="flex flex-col gap-1.5">
            {PERMISSION_CATALOG.filter((p) => p.category === category).map((p) => (
              <label
                key={p.id}
                className={`flex cursor-pointer items-start justify-between gap-3 rounded px-1 py-1 text-sm text-normal ${
                  p.id === "administrator" ? "font-semibold" : ""
                }`}
              >
                <span>
                  {t(p.labelKey)}
                  <span className="block text-xs font-normal text-muted">{t(p.descriptionKey)}</span>
                </span>
                <input
                  type="checkbox"
                  data-testid={`role-perm-${p.id}`}
                  disabled={permBusy}
                  checked={checked.has(p.id)}
                  onChange={(e) => void togglePermission(p.id, e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 disabled:opacity-50"
                />
              </label>
            ))}
          </div>
        </div>
      ))}
      <p className="mb-4 text-xs text-muted">
        {computedLevel > 0
          ? t("permission.effectiveLevel", { level: computedLevel })
          : t("roles.visualOnlyHint")}
        {impliedExtra.length > 0 && (
          <span className="block">
            {t("permission.alsoGrants", {
              names: impliedExtra.map((id) => t(getPermissionDef(id).labelKey)).join(", "),
            })}
          </span>
        )}
      </p>
      <label className="mb-4 flex cursor-pointer items-center justify-between gap-3 text-sm text-normal">
        <span>
          {t("roles.mentionableLabel")}
          <span className="block text-xs font-normal text-muted">{t("roles.mentionableHint")}</span>
        </span>
        <input
          type="checkbox"
          checked={isRoleMentionable(role)}
          onChange={(e) => void setRoleMentionable(client, spaceId, role.id, e.target.checked)}
          className="h-4 w-4 shrink-0"
        />
      </label>
      <label className="mb-4 flex cursor-pointer items-center justify-between gap-3 text-sm text-normal">
        <span>
          {t("roles.hoistLabel")}
          <span className="block text-xs font-normal text-muted">{t("roles.hoistHint")}</span>
        </span>
        <input
          type="checkbox"
          checked={isRoleHoisted(role)}
          onChange={(e) => void setRoleHoisted(client, spaceId, role.id, e.target.checked)}
          className="h-4 w-4 shrink-0"
        />
      </label>
      <span className="mb-1 block text-xs font-bold uppercase text-muted">{t("roles.membersCount", { count: members.length })}</span>
      <input
        className={modalInputClass()}
        aria-label={t("roles.memberFilterPlaceholder")}
        value={memberFilter}
        onChange={(e) => setMemberFilter(e.target.value)}
        placeholder={t("roles.memberFilterPlaceholder")}
      />
      <div className="mt-1 flex max-h-64 flex-col gap-0.5 overflow-y-auto">
        {members
          .filter((m) => m.name.toLowerCase().includes(memberFilter.trim().toLowerCase()))
          .map((m) => {
          const has = overrides[m.userId] ?? getMemberRoleIds(space, m.userId).includes(role.id);
          return (
            <label
              key={m.userId}
              className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 hover:bg-bg-modifier-hover"
            >
              <input
                type="checkbox"
                data-testid="role-member-checkbox"
                data-user-id={m.userId}
                checked={has}
                onChange={() => toggleMember(m.userId, has)}
                className="h-4 w-4"
              />
              <Avatar url={m.getAvatarUrl(client.baseUrl, 24, 24, "crop", false, false)} name={m.name} size={24} />
              <span className="truncate text-sm text-normal">{m.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** The role list + editor master-detail view, without any modal chrome of its own - embedded as a pane in SpaceSettingsModal (Discord puts role management in its own Server Settings tab, not a separate dialog).
 *
 * @param spaceId - ID of the space whose roles are listed and edited.
 */
export function SpaceRolesContent({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const space = client.getRoom(spaceId);
  const [newRoleName, setNewRoleName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!space) return null;

  const roles = getSpaceRoles(space);
  const mayManage = canManageRoles(space, client.getUserId() ?? "");
  const selected = roles.find((r) => r.id === selectedId) ?? roles[0] ?? null;

  async function handleCreate() {
    if (!newRoleName.trim() || busy) return;
    setBusy(true);
    try {
      const color = DEFAULT_COLORS[roles.length % DEFAULT_COLORS.length]!;
      await createRole(client, spaceId, newRoleName.trim(), color);
      setNewRoleName("");
    } finally {
      setBusy(false);
    }
  }

  if (!mayManage) {
    return (
      <div className="flex flex-col gap-0.5">
        {roles.length === 0 && <p className="text-sm text-muted">{t("roles.noneYet")}</p>}
        {roles.map((r) => (
          <div key={r.id} className="flex items-center gap-2 px-2 py-1.5">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
            <span className="text-sm text-normal">{r.name}</span>
            {typeof r.powerLevel === "number" && (
              <span title={t("roles.levelLabel", { level: r.powerLevel! })}>
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-muted" fill="currentColor">
                  <path d="M12 2 4 5v6c0 5.25 3.44 9.94 8 11 4.56-1.06 8-5.75 8-11V5l-8-3Z" />
                </svg>
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    // Fills whatever height SettingsModalShell actually gives this pane
    // instead of a fixed 420px - on a tall window that left a lot of empty
    // space below while the permission list on the right (often taller than
    // 420px) had to scroll inside its own cramped box regardless.
    <div className="flex h-full gap-4">
      <div className="flex w-52 shrink-0 flex-col border-r border-border pr-3">
        <div className="mb-2 flex items-center gap-1.5">
          <input
            className={modalInputClass()}
            data-testid="roles-new-name"
            aria-label={t("roles.newNamePlaceholder")}
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            placeholder={t("roles.newNamePlaceholder")}
            onKeyDown={(e) => e.key === "Enter" && void handleCreate()}
          />
          <button
            type="button"
            data-testid="roles-create"
            disabled={!newRoleName.trim() || busy}
            onClick={() => void handleCreate()}
            title={t("roles.create")}
            aria-label={t("roles.create")}
            className="shrink-0 rounded bg-brand p-1.5 text-white disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {roles.length === 0 && <p className="px-2 py-2 text-xs text-muted">{t("roles.noneYetShort")}</p>}
          {roles.map((r, i) => (
            <RoleRow
              key={r.id}
              spaceId={spaceId}
              role={r}
              isFirst={i === 0}
              isLast={i === roles.length - 1}
              selected={selected?.id === r.id}
              onSelect={() => setSelectedId(r.id)}
            />
          ))}
        </div>
      </div>
      {selected ? (
        <RoleEditor key={selected.id} spaceId={spaceId} role={selected} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted">
          {t("roles.createToEdit")}
        </div>
      )}
    </div>
  );
}
