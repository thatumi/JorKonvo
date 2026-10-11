import {
  applySpaceDrop,
  canInviteToRoom,
  canManageSpaceSettings,
  dissolveFolder,
  getInvitedRooms,
  getResolvedSpaceLayout,
  getRoomInviteLink,
  getRoomsInSpace,
  getSpaceUnreadSummary,
  getStoredSpaceLayout,
  leaveRoom,
  markSpaceRead,
  type MatrixClient,
  type RailItem,
  renameFolder,
  resolveSpaceEntryRoomId,
  resolveStoredLayout,
  type Room,
  saveSpaceLayout,
  setFolderColor,
  type StoredSpaceLayout,
} from "@jorkonvo/matrix-core";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n";
import { useAuthStore } from "../state/authStore";
import { useMatrixStore } from "../state/matrixStore";
import { useModalStore } from "../state/modalStore";
import { isDeveloperMode } from "../lib/displayPrefs";
import { uiAlert, uiConfirm, uiPrompt } from "../lib/dialogs";
import { isPrivateReadReceiptsEnabled } from "../lib/readReceiptPrivacy";
import { THEME_PRESETS, useThemeStore } from "../state/themeStore";
import { getLastRoomForScope, useUiStore } from "../state/uiStore";
import { Avatar } from "./Avatar";
import { type MenuItem, useContextMenu } from "./ContextMenu";

/** The row of account avatars - only worth its space (and the "which account am I in?" overhead) once there's actually something to switch between. The persistent "add account" entry point lives separately, in the bottom button group, so it's discoverable even with just one account. */
function AccountSwitcher() {
  const accounts = useAuthStore((s) => s.accounts);
  const activeUserId = useAuthStore((s) => s.activeUserId);
  const switching = useAuthStore((s) => s.switching);
  const switchAccount = useAuthStore((s) => s.switchAccount);

  if (accounts.length < 2) return null;

  return (
    <>
      <div className="flex w-full flex-col items-center gap-2">
        {accounts.map((account) => (
          <button
            key={account.userId}
            type="button"
            title={account.userId}
            aria-label={account.userId}
            aria-pressed={account.userId === activeUserId}
            disabled={switching}
            onClick={() => void switchAccount(account.userId)}
            className={clsx(
              "flex h-8 w-8 items-center justify-center overflow-hidden rounded-full ring-2 transition disabled:cursor-wait",
              account.userId === activeUserId ? "ring-white" : "ring-transparent hover:ring-white/50",
            )}
          >
            <Avatar url={null} name={account.userId.replace(/^@/, "")} size={32} />
          </button>
        ))}
      </div>
      <div className="my-1 h-0.5 w-8 rounded bg-bg-dark" />
    </>
  );
}

function Pill({ active, hover }: { active: boolean; hover: boolean }) {
  return (
    <span
      className={clsx(
        "absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-white transition-all",
        active ? "h-10" : hover ? "h-5" : "h-0 group-hover:h-5",
      )}
    />
  );
}

function RailButton({
  active,
  onClick,
  label,
  testId,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative flex w-full justify-center">
      <Pill active={active} hover={false} />
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        aria-pressed={active}
        data-testid={testId}
        className={clsx(
          "flex h-12 w-12 items-center justify-center overflow-hidden transition-all",
          active
            ? "rounded-2xl bg-brand text-white shadow-lg shadow-brand/25"
            : "rounded-3xl bg-bg-dark text-normal hover:-translate-y-0.5 hover:rounded-2xl hover:bg-brand hover:text-white",
        )}
      >
        {children}
      </button>
    </div>
  );
}

const COLLAPSED_FOLDERS_KEY = "jorkonvo-collapsed-space-folders";

function loadExpandedFolders(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_FOLDERS_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

type DropMode = "before" | "after" | "folder";
interface DropTarget {
  index: number;
  mode: DropMode;
  folderId?: string;
}

function SpaceButton({
  item,
  active,
  onEnter,
  onContextMenu,
  onDragPointerDown,
  dragging,
  baseUrl,
  client,
}: {
  item: Extract<RailItem, { type: "space" }>;
  active: boolean;
  onEnter: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragPointerDown: (e: React.PointerEvent) => void;
  dragging: boolean;
  baseUrl: string;
  client: MatrixClient;
}) {
  const { space } = item;
  const { hasUnread, mentionCount } = getSpaceUnreadSummary(client, space.roomId);
  return (
    <div className="group relative flex w-full justify-center" onPointerDown={onDragPointerDown}>
      <Pill active={active} hover={false} />
      <button
        type="button"
        onClick={onEnter}
        onContextMenu={onContextMenu}
        title={space.name || "Space"}
        aria-label={space.name || "Space"}
        aria-pressed={active}
        data-testid="space-rail-item"
        data-space-name={space.name || ""}
        data-space-id={space.roomId}
        className={clsx(
          "jk-ctx-target relative flex h-12 w-12 items-center justify-center overflow-hidden transition-all",
          dragging && "opacity-40",
          active
            ? "rounded-2xl bg-brand text-white shadow-lg shadow-brand/25"
            : "rounded-3xl bg-bg-dark text-normal hover:-translate-y-0.5 hover:rounded-2xl hover:bg-brand hover:text-white",
        )}
      >
        <Avatar
          url={space.getAvatarUrl(baseUrl, 48, 48, "crop", false)}
          name={space.name || "?"}
          size={48}
          rounded="none"
          fill
        />
        {mentionCount > 0 ? (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-dnd px-1 text-[10px] font-bold leading-none text-white ring-2 ring-bg-floating">
            {mentionCount > 99 ? "99+" : mentionCount}
          </span>
        ) : (
          hasUnread && (
            <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-white ring-2 ring-bg-floating" />
          )
        )}
      </button>
    </div>
  );
}

function FolderButton({
  item,
  expanded,
  hasActiveChild,
  onToggle,
  onContextMenu,
  baseUrl,
  client,
}: {
  item: Extract<RailItem, { type: "folder" }>;
  expanded: boolean;
  hasActiveChild: boolean;
  onToggle: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  baseUrl: string;
  client: MatrixClient;
}) {
  // Individual spaces already show their own indicator once the folder is
  // expanded - this is what makes an unread space discoverable while it's
  // still COLLAPSED, which is the only time it'd otherwise be invisible.
  const summaries = item.spaces.map((s) => getSpaceUnreadSummary(client, s.roomId));
  const hasUnread = summaries.some((s) => s.hasUnread);
  const mentionCount = summaries.reduce((sum, s) => sum + s.mentionCount, 0);
  return (
    <div className="group relative flex w-full justify-center">
      <Pill active={hasActiveChild && !expanded} hover={false} />
      <button
        type="button"
        onClick={onToggle}
        onContextMenu={onContextMenu}
        title={item.name}
        aria-label={item.name}
        aria-expanded={expanded}
        aria-controls={expanded ? `jk-folder-${item.id}` : undefined}
        className={clsx(
          "jk-ctx-target relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-[16px] p-1.5 transition-all hover:-translate-y-0.5 hover:rounded-2xl",
          expanded ? "bg-bg-dark/40" : "bg-bg-dark",
        )}
        style={item.color ? { backgroundColor: expanded ? `${item.color}22` : `${item.color}55` } : undefined}
      >
        <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-0.5">
          {item.spaces.slice(0, 4).map((space) => (
            <div key={space.roomId} className="overflow-hidden rounded-[5px] bg-bg-darkest">
              <Avatar
                url={space.getAvatarUrl(baseUrl, 24, 24, "crop", false)}
                name={space.name || "?"}
                size={20}
                rounded="none"
                fill
              />
            </div>
          ))}
        </div>
        {mentionCount > 0 ? (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-dnd px-1 text-[10px] font-bold leading-none text-white ring-2 ring-bg-floating">
            {mentionCount > 99 ? "99+" : mentionCount}
          </span>
        ) : (
          hasUnread && (
            <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-white ring-2 ring-bg-floating" />
          )
        )}
      </button>
    </div>
  );
}

function DropLine({ visible }: { visible: boolean }) {
  return (
    <div className="relative h-0 w-full">
      {visible && <div className="absolute inset-x-2 -top-1 h-0.5 rounded-full bg-white" />}
    </div>
  );
}

/**
 * Left-most navigation rail: account switcher, Home button, space icons and
 * space folders (all drag-reorderable), plus the bottom utility group
 * (discover, create/join, theme cycle, account, logout).
 */
export function SpaceRail() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client);
  const syncTick = useMatrixStore((s) => s.syncTick);
  const selectedSpaceId = useUiStore((s) => s.selectedSpaceId);
  const selectSpace = useUiStore((s) => s.selectSpace);
  const openFriends = useUiStore((s) => s.openFriends);
  const logout = useAuthStore((s) => s.logout);
  const openModal = useModalStore((s) => s.open);
  const themeAccent = useThemeStore((s) => s.accent);
  const themeSurface = useThemeStore((s) => s.surface);
  const themeEffective = useThemeStore((s) => s.effective);
  const applyPreset = useThemeStore((s) => s.applyPreset);
  const currentPresetIdx = THEME_PRESETS.findIndex(
    (p) => p.theme === themeEffective && p.accent === themeAccent && p.surface === themeSurface,
  );
  const nextPreset = THEME_PRESETS[(currentPresetIdx + 1) % THEME_PRESETS.length]!;
  const nextPresetLabelKey = `settings.preset${nextPreset.id[0].toUpperCase()}${nextPreset.id.slice(1)}`;
  const cyclePreset = () => applyPreset(nextPreset);

  const { open: openCtx, menu: ctxMenu } = useContextMenu();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(loadExpandedFolders);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Reordering uses pointer events, not native HTML5 drag-and-drop: found
  // live that the browser can show a permanent "not-allowed" cursor for the
  // whole gesture (dragover never resolves to a valid drop target, so drop
  // never fires) inside Tauri's CEF-based webview specifically - and native
  // DnD state read from React state closures is generally timing-fragile
  // besides (dragover firing before a dragstart-triggered setState commits).
  // Pointer events sidestep both: we do our own hit-testing and never depend
  // on the browser's own drag-session/cursor machinery at all.
  const draggingIdRef = useRef<string | null>(null);
  // A pointerdown that hasn't moved past DRAG_THRESHOLD_PX yet - lets a plain
  // click on the button still work normally (its own onClick fires
  // untouched) instead of every press being treated as a drag.
  const dragCandidateRef = useRef<{ id: string; pointerId: number; startX: number; startY: number } | null>(null);
  // Set for the one click that follows a real drag's pointerup - pointer
  // capture routes that click to the originally-pressed element regardless
  // of where the pointer actually ended up, so without this the drop would
  // immediately be followed by spuriously entering whatever was dragged.
  const justDraggedRef = useRef(false);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  // Optimistic layout shown until the account-data echo lands (drag-drop must
  // feel instant; matrix-js-sdk's setAccountData has no local echo).
  const [optimistic, setOptimistic] = useState<StoredSpaceLayout | null>(null);

  const items = client
    ? optimistic
      ? resolveStoredLayout(client, optimistic)
      : getResolvedSpaceLayout(client)
    : [];
  const inviteCount = client ? getInvitedRooms(client).length : 0;

  // Drop the optimistic override once the account-data echo of our write has
  // landed (stored layout matches what we asked for), or after a safety
  // timeout in case the server normalised it differently.
  useEffect(() => {
    if (!optimistic || !client) return;
    if (JSON.stringify(getStoredSpaceLayout(client).order) === JSON.stringify(optimistic.order)) {
      setOptimistic(null);
      return;
    }
    const t = setTimeout(() => setOptimistic(null), 6000);
    return () => clearTimeout(t);
  }, [syncTick, optimistic, client]);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify([...expandedFolders]));
  }, [expandedFolders]);

  function toggleFolder(id: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function persist(layout: StoredSpaceLayout) {
    if (!client) return;
    setOptimistic(layout);
    void saveSpaceLayout(client, layout).catch((err) => {
      console.error("failed to save space layout", err);
      setOptimistic(null);
    });
  }

  function spaceMenu(space: Room): MenuItem[] {
    if (!client) return [];
    const priv = isPrivateReadReceiptsEnabled();
    const childIds = getRoomsInSpace(client, space.roomId).map((r) => r.roomId);
    const items: MenuItem[] = [
      {
        label: t("spaceMenu.markAllRead"),
        onClick: () => void markSpaceRead(client, childIds, priv).then(() => useMatrixStore.getState().bumpTick()),
      },
    ];
    if (canManageSpaceSettings(space, client.getUserId() ?? "")) {
      items.push({
        label: t("sidebar.spaceSettings"),
        separator: true,
        onClick: () => openModal({ type: "spaceSettings", spaceId: space.roomId }),
      });
    }
    if (canInviteToRoom(space, client.getUserId() ?? "")) {
      items.push({
        label: t("spaceSettings.inviteLinkCopy"),
        onClick: () => {
          void navigator.clipboard.writeText(getRoomInviteLink(client, space));
          void uiAlert(t("spaceSettings.inviteLinkCopied"));
        },
      });
      items.push({
        label: t("roomMenu.invite"),
        onClick: () =>
          void (async () => {
            const id = await uiPrompt(t("roomMenu.invitePrompt"));
            if (id?.trim()) void client.invite(space.roomId, id.trim()).catch((e) => console.error(e));
          })(),
      });
    }
    if (isDeveloperMode()) {
      items.push({ label: t("common.copyId"), onClick: () => void navigator.clipboard.writeText(space.roomId) });
    }
    items.push({
      label: t("spaceMenu.leave"),
      separator: true,
      danger: true,
      onClick: () =>
        void (async () => {
          if (await uiConfirm(t("spaceMenu.leaveConfirm", { name: space.name || space.roomId }), { danger: true })) {
            await leaveRoom(client, space.roomId).then(() => useMatrixStore.getState().bumpTick());
          }
        })(),
    });
    return items;
  }

  function folderMenu(folderId: string, name: string): MenuItem[] {
    if (!client) return [];
    const colors = ["#8b5cf6", "#ec4b56", "#3fbf7f", "#f5a623", "#38bdf8", "#f472b6"];
    return [
      {
        label: t("common.rename"),
        onClick: () =>
          void (async () => {
            const next = await uiPrompt(t("rail.folderRename"), name);
            if (next?.trim()) persist(renameFolder(client, folderId, next.trim()));
          })(),
      },
      {
        label: t("spaceMenu.folderColour"),
        submenu: [
          { label: t("spaceMenu.folderColourNone"), onClick: () => persist(setFolderColor(client, folderId, undefined)) },
          ...colors.map((c) => ({
            label: c,
            icon: <span className="h-3 w-3 rounded-full" style={{ backgroundColor: c }} />,
            onClick: () => persist(setFolderColor(client, folderId, c)),
          })),
        ],
      },
      {
        label: t("spaceMenu.folderDissolve"),
        separator: true,
        danger: true,
        onClick: () => persist(dissolveFolder(client, folderId)),
      },
    ];
  }

  /** Enter a space (or Home, spaceId=null) landing on the right room. */
  function enterSpace(spaceId: string | null) {
    if (!client) {
      selectSpace(spaceId);
      return;
    }
    const target = resolveSpaceEntryRoomId(client, spaceId, getLastRoomForScope(spaceId));
    if (!target && spaceId === null) {
      openFriends();
      return;
    }
    selectSpace(spaceId, target);
  }

  function setDragging(id: string | null) {
    draggingIdRef.current = id;
    setDraggingId(id);
  }

  function handleDrop() {
    const dragged = draggingIdRef.current;
    if (!client || !dragged || !dropTarget) {
      setDragging(null);
      setDropTarget(null);
      return;
    }
    const dt = dropTarget;
    setDragging(null);
    setDropTarget(null);

    let layout: StoredSpaceLayout;
    if (dt.mode === "folder" && dt.folderId) {
      layout = applySpaceDrop(client, { type: "into-folder", draggedSpaceId: dragged, folderId: dt.folderId });
    } else if (dt.mode === "folder") {
      const targetItem = items[dt.index];
      if (targetItem?.type !== "space" || targetItem.space.roomId === dragged) return;
      layout = applySpaceDrop(client, {
        type: "onto-space",
        draggedSpaceId: dragged,
        targetSpaceId: targetItem.space.roomId,
      });
    } else {
      const beforeIndex = dt.mode === "before" ? dt.index : dt.index + 1;
      layout = applySpaceDrop(client, { type: "reorder", draggedSpaceId: dragged, beforeIndex });
    }
    persist(layout);
  }

  const DRAG_THRESHOLD_PX = 4;

  function beginDragCandidate(id: string, e: React.PointerEvent) {
    if (e.button !== 0) return;
    // NB: no setPointerCapture here - capturing the pointer on pointerdown
    // redirects the follow-up pointerup (and therefore suppresses the
    // synthesized `click`) away from the inner <button>, so a plain click on
    // a space icon would do nothing. Capture is taken only once a real drag
    // actually starts, in handleRailPointerMove below.
    dragCandidateRef.current = { id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
  }

  function updateDropTargetFor(index: number, item: RailItem, clientY: number, rect: DOMRect) {
    const y = (clientY - rect.top) / rect.height;
    if (item.type === "folder") {
      setDropTarget({ index, mode: "folder", folderId: item.id });
    } else if (y < 0.3) {
      setDropTarget({ index, mode: "before" });
    } else if (y > 0.7) {
      setDropTarget({ index, mode: "after" });
    } else {
      setDropTarget({ index, mode: "folder" }); // onto a space => make a folder
    }
  }

  function handleRailPointerMove(e: React.PointerEvent) {
    const candidate = dragCandidateRef.current;
    if (candidate && !draggingIdRef.current) {
      const dx = e.clientX - candidate.startX;
      const dy = e.clientY - candidate.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      // Real drag now - take pointer capture so tracking survives the pointer
      // leaving the rail, and mark the trailing click to be swallowed.
      try {
        (e.currentTarget as Element).setPointerCapture(candidate.pointerId);
      } catch {
        /* pointer already released / invalid id */
      }
      justDraggedRef.current = true;
      setDragging(candidate.id);
    }
    if (!draggingIdRef.current) return;
    const slot = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-rail-index]");
    if (!slot) {
      setDropTarget(null);
      return;
    }
    const index = Number(slot.dataset.railIndex);
    const item = items[index];
    if (!item) {
      setDropTarget(null);
      return;
    }
    updateDropTargetFor(index, item, e.clientY, slot.getBoundingClientRect());
  }

  function handleRailPointerUp() {
    const wasDragging = !!draggingIdRef.current;
    dragCandidateRef.current = null;
    if (wasDragging) handleDrop();
  }

  function handleRailPointerCancel() {
    dragCandidateRef.current = null;
    if (draggingIdRef.current) {
      setDragging(null);
      setDropTarget(null);
    }
  }

  return (
    <nav
      aria-label={t("a11y.serverNav")}
      className="jk-space-rail flex h-full w-[72px] flex-col items-center gap-2 overflow-y-auto rounded-[20px] max-md:rounded-none bg-gradient-to-b from-bg-darkest via-bg-darkest to-bg-floating py-3"
    >
      <AccountSwitcher />
      {!client && <div className="h-12 w-12 shrink-0 animate-pulse rounded-3xl bg-bg-dark" />}
      {client && (
        <>
          <div className="relative w-full">
            <RailButton active={selectedSpaceId === null} onClick={() => enterSpace(null)} label={t("rail.home")}>
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor">
                <path d="M12 2 2 9.5V22h6.5v-6h7v6H22V9.5L12 2Z" />
              </svg>
            </RailButton>
            {inviteCount > 0 && (
              <span className="pointer-events-none absolute right-3.5 top-0 flex h-4 w-4 items-center justify-center rounded-full bg-dnd text-[10px] font-bold text-white">
                {inviteCount}
              </span>
            )}
          </div>

          <div className="my-1 h-0.5 w-8 rounded bg-bg-dark" />

          <div
            className="flex w-full flex-col items-center gap-2"
            onPointerMove={handleRailPointerMove}
            onPointerUp={handleRailPointerUp}
            onPointerCancel={handleRailPointerCancel}
            onClickCapture={(e) => {
              if (justDraggedRef.current) {
                e.preventDefault();
                e.stopPropagation();
                justDraggedRef.current = false;
              }
            }}
          >
            {items.map((item, index) => {
              const isFolderTargeted =
                dropTarget?.index === index && dropTarget.mode === "folder" && !dropTarget.folderId;
              const isFolderDropTargeted =
                item.type === "folder" && dropTarget?.folderId === item.id;
              return (
                <div key={item.type === "space" ? item.space.roomId : item.id} className="w-full">
                  <DropLine visible={dropTarget?.index === index && dropTarget.mode === "before"} />
                  <div
                    data-rail-index={index}
                    className={clsx(
                      "w-full rounded-2xl",
                      (isFolderTargeted || isFolderDropTargeted) && "ring-2 ring-white",
                    )}
                  >
                    {item.type === "space" ? (
                      <SpaceButton
                        item={item}
                        active={selectedSpaceId === item.space.roomId}
                        onEnter={() => enterSpace(item.space.roomId)}
                        onContextMenu={(e) => openCtx(e, spaceMenu(item.space))}
                        onDragPointerDown={(e) => beginDragCandidate(item.space.roomId, e)}
                        dragging={draggingId === item.space.roomId}
                        baseUrl={client.baseUrl}
                        client={client}
                      />
                    ) : (
                      <>
                        <FolderButton
                          item={item}
                          expanded={expandedFolders.has(item.id)}
                          hasActiveChild={item.spaces.some((s) => s.roomId === selectedSpaceId)}
                          onToggle={() => toggleFolder(item.id)}
                          onContextMenu={(e) => openCtx(e, folderMenu(item.id, item.name))}
                          baseUrl={client.baseUrl}
                          client={client}
                        />
                        {expandedFolders.has(item.id) && (
                          <div
                            id={`jk-folder-${item.id}`}
                            className="mt-1 flex flex-col items-center gap-2 rounded-2xl py-2"
                            style={{ backgroundColor: item.color ? `${item.color}18` : "rgba(255,255,255,0.04)" }}
                          >
                            {item.spaces.map((space) => (
                              <SpaceButton
                                key={space.roomId}
                                item={{ type: "space", space }}
                                active={selectedSpaceId === space.roomId}
                                onEnter={() => enterSpace(space.roomId)}
                                onContextMenu={(e) => openCtx(e, spaceMenu(space))}
                                onDragPointerDown={(e) => beginDragCandidate(space.roomId, e)}
                                dragging={draggingId === space.roomId}
                                baseUrl={client.baseUrl}
                                client={client}
                              />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <DropLine visible={dropTarget?.index === index && dropTarget.mode === "after"} />
                </div>
              );
            })}
          </div>

          <RailButton active={false} onClick={() => openModal({ type: "discoverSpaces" })} label={t("rail.discover")}>
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
              <path d="M12 10.9a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2ZM12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm2.19 12.19L6 18l3.81-8.19L18 6l-3.81 8.19Z" />
            </svg>
          </RailButton>

          <RailButton active={false} onClick={() => openModal({ type: "createSpace" })} label={t("rail.newServer")} testId="rail-new-space">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
              <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
            </svg>
          </RailButton>

          <RailButton active={false} onClick={() => openModal({ type: "joinRoom" })} label={t("rail.joinRoom")} testId="rail-join-room">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
              <path d="M12 2 2 7v10l10 5 10-5V7L12 2Zm0 2.2 7 3.5v8.6l-7 3.5-7-3.5V7.7l7-3.5ZM9 11v2h6v-2H9Z" />
            </svg>
          </RailButton>

          <div className="mt-auto flex w-full flex-col items-center gap-2">
            <RailButton active={false} onClick={cyclePreset} label={t("rail.cycleTheme", { name: t(nextPresetLabelKey) })}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                <path d="M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1-.24-.27-.36-.61-.36-.99 0-.83.67-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.42-4.03-8-9-8Zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
              </svg>
            </RailButton>
            <RailButton active={false} onClick={() => openModal({ type: "addAccount" })} label={t("rail.addAccount")}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
              </svg>
            </RailButton>
            <RailButton
              active={false}
              onClick={() => openModal({ type: "scanQrLogin" })}
              label={t("rail.scanQr")}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                <path d="M3 3h8v8H3V3Zm2 2v4h4V5H5Zm8-2h8v8h-8V3Zm2 2v4h4V5h-4ZM3 13h8v8H3v-8Zm2 2v4h4v-4H5Zm10-2h2v2h-2v-2Zm4 0h2v2h-2v-2Zm-4 4h2v2h-2v-2Zm4 0h2v2h-2v-2Zm-2 4h2v2h-2v-2Zm4 0h2v2h-2v-2Z" />
              </svg>
            </RailButton>
            <RailButton active={false} onClick={() => openModal({ type: "recoveryKey" })} label={t("rail.recoveryKey")}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                <path d="M12.65 10a5.5 5.5 0 1 0 0 4H17v4h4v-4h1v-4h-9.35ZM7.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
              </svg>
            </RailButton>
            <RailButton active={false} onClick={() => openModal({ type: "callHistory" })} label={t("rail.callHistory")}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.24.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2Z" />
              </svg>
            </RailButton>
            <RailButton active={false} onClick={() => void logout()} label={t("rail.logout")}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                <path d="M16 17v-3H9v-4h7V7l5 5-5 5ZM14 2a2 2 0 0 1 2 2v2h-2V4H5v16h9v-2h2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9Z" />
              </svg>
            </RailButton>
          </div>
        </>
      )}
      {ctxMenu}
    </nav>
  );
}
