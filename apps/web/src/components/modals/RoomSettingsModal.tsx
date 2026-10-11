import {
  addPolicyRule,
  approveKnock,
  assignRoomToCategory,
  type AutoModConfig,
  type AutoModPattern,
  canApproveKnocks,
  canConfigureAutoMod,
  canKick,
  canManageCategories,
  canManageForumTags,
  canInviteToRoom,
  canManageSuperReactions,
  canManagePolicyRules,
  canManagePolicySubscriptions,
  canManagePowerLevels,
  canManageRoomEmojis,
  canSetChannelType,
  canSetHistoryVisibility,
  canSetJoinRule,
  canSetMemberPowerLevel,
  canSetRoomAlias,
  canSetSlowmode,
  type ChannelType,
  EventType,
  type ForumTag,
  getAutoModConfig,
  getCategoryOfRoom,
  getChannelType,
  getForumTags,
  getHistoryVisibility,
  getJoinRule,
  getKnockReason,
  getMemberPowerLevel,
  getOwningSpace,
  getPendingKnocks,
  getPolicyRules,
  getPolicySubscriptions,
  getRoomInviteLink,
  getSlowmodeSeconds,
  getSpaceCategories,
  getChannelContentRating,
  type ChannelContentRating,
  setChannelContentRating,
  getVoiceBitrateKbps,
  getVoiceUserLimit,
  getVoiceVideoQuality,
  setVoiceBitrateKbps,
  setVoiceVideoQuality,
  type VoiceVideoQuality,
  VOICE_BITRATE_MAX_KBPS,
  VOICE_BITRATE_MIN_KBPS,
  isFavourite,
  isLowPriority,
  isRoomListedInDirectory,
  HISTORY_VISIBILITY_OPTIONS,
  type HistoryVisibilityValue,
  JOIN_RULE_OPTIONS,
  type JoinRuleValue,
  kickMember,
  unbanMember,
  leaveRoom,
  type PolicyRule,
  type PolicyRuleKind,
  POWER_LEVEL_PRESETS,
  removePolicyRule,
  renameRoom,
  reportRoom,
  setAutoModConfig,
  setChannelType,
  setFavourite,
  setForumTags,
  setHistoryVisibility,
  setJoinRule,
  setLowPriority,
  setMemberPowerLevel,
  setPolicySubscriptions,
  setRoomAlias,
  setRoomAvatarImage,
  setRoomAvatarOverride,
  setRoomListedInDirectory,
  setRoomNickname,
  setRoomTopic,
  setSlowmodeSeconds,
  setVoiceUserLimit,
  SLOWMODE_PRESETS,
  canUpgradeRoom,
  canManageGuestAccess,
  getGuestAccess,
  getAvailableRoomVersions,
  getRecommendedRoomVersion,
  getRoomVersion,
  type RoomVersionOption,
  setGuestAccess,
  upgradeRoom,
  canManageChannelAccess,
  type ChannelAccess,
  getChannelAccess,
  getSpaceRoles,
  setChannelAccess,
} from "@jorkonvo/matrix-core";
import QRCode from "qrcode";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "../../i18n";
import { uiAlert, uiConfirm, uiPrompt } from "../../lib/dialogs";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { useUiStore } from "../../state/uiStore";
import { Avatar } from "../Avatar";
import { Sensitive } from "../Sensitive";
import { EmojiPackManager } from "../EmojiPackManager";
import { SuperReactionsSection } from "../SuperReactionsSection";
import { ModalField, modalInputClass, ModalPrimaryButton } from "../Modal";
import { type SettingsPane, SettingsModalShell } from "./SettingsModalShell";

const PRESET_VALUES = new Set<number>(POWER_LEVEL_PRESETS.map((p) => p.value));

/**
 * Per-channel settings modal: general (name/topic/avatar/channel type/slowmode),
 * access (join rules, roles, knocks), moderation (AutoMod, ban list, forum
 * tags), sharing (invite link/QR, directory alias), emoji and advanced (room
 * upgrade, report, leave). Sections are permission-gated and laid out by the
 * shared SettingsModalShell.
 *
 * @param roomId - Matrix room ID of the channel whose settings are edited.
 */
export function RoomSettingsModal({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const close = useModalStore((s) => s.close);
  const openModal = useModalStore((s) => s.open);
  const selectRoom = useUiStore((s) => s.selectRoom);
  const room = client.getRoom(roomId);
  const ownUserId = client.getUserId() ?? "";

  const [name, setName] = useState(room?.name ?? "");
  const [topic, setTopic] = useState(
    (room?.currentState.getStateEvents("m.room.topic", "")?.getContent().topic as string) ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Thin wrapper kept so the section divs need no churn; the shell owns search + nav now. */
  const sectionClassName = (_keywords: string, visibleClass = "mt-6 border-t border-border pt-4"): string =>
    visibleClass;
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    room ? room.getAvatarUrl(client.baseUrl, 80, 80, "crop", false) : null,
  );
  const avatarFileRef = useRef<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const ownMember = room?.getMember(ownUserId) ?? null;
  const [roomNickname, setRoomNicknameInput] = useState(ownMember?.rawDisplayName ?? "");
  const [roomAvatarPreview, setRoomAvatarPreview] = useState<string | null>(
    ownMember?.getAvatarUrl(client.baseUrl, 64, 64, "crop", false, false) ?? null,
  );
  const roomAvatarFileRef = useRef<File | null>(null);
  const roomAvatarInputRef = useRef<HTMLInputElement>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [joinRuleBusy, setJoinRuleBusy] = useState(false);
  const [historyVisBusy, setHistoryVisBusy] = useState(false);
  const [recommendedVersion, setRecommendedVersion] = useState<string | null>(null);
  const [availableVersions, setAvailableVersions] = useState<RoomVersionOption[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [upgradeAcknowledged, setUpgradeAcknowledged] = useState(false);
  const [upgradeBusy, setUpgradeBusy] = useState(false);
  const [accessDraft, setAccessDraft] = useState<ChannelAccess | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);
  const [knockBusyId, setKnockBusyId] = useState<string | null>(null);
  const [favouriteOverride, setFavouriteOverride] = useState<boolean | null>(null);
  const [lowPriorityOverride, setLowPriorityOverride] = useState<boolean | null>(null);
  const [slowmodeBusy, setSlowmodeBusy] = useState(false);
  const [voiceUserLimit, setVoiceUserLimitState] = useState(() => (room ? getVoiceUserLimit(room) : 0));
  const [contentRating, setContentRating] = useState<ChannelContentRating>(() =>
    room ? getChannelContentRating(room) : "default",
  );
  const [voiceBitrate, setVoiceBitrateState] = useState(() => (room ? getVoiceBitrateKbps(room) : 64));
  const [voiceVideoQuality, setVoiceVideoQualityState] = useState<VoiceVideoQuality>(() =>
    room ? getVoiceVideoQuality(room) : "auto",
  );
  const [autoModBusy, setAutoModBusy] = useState(false);
  const [newAutoModKeyword, setNewAutoModKeyword] = useState("");
  const [newAutoModPatternValue, setNewAutoModPatternValue] = useState("");
  const [newAutoModPatternKind, setNewAutoModPatternKind] = useState<AutoModPattern["kind"]>("wildcard");
  const [newAllowedDomain, setNewAllowedDomain] = useState("");
  const [forumTagsBusy, setForumTagsBusy] = useState(false);
  const [forumTagsOverride, setForumTagsOverride] = useState<ForumTag[] | null>(null);
  const [newForumTagName, setNewForumTagName] = useState("");
  const [newForumTagColor, setNewForumTagColor] = useState("#5865f2");
  // sendStateEvent has no local echo (confirmed from the matrix-js-sdk
  // source, same bug class already hit and fixed for role power-levels and
  // the favourite/low-priority checkboxes) - room.currentState only reflects
  // this until the change round-trips through a later /sync, so the
  // checkbox/keyword-list needs an optimistic override or it looks
  // unresponsive for a beat.
  const [autoModOverride, setAutoModOverride] = useState<AutoModConfig | null>(null);
  const [aliasLocalpart, setAliasLocalpart] = useState("");
  const [aliasBusy, setAliasBusy] = useState(false);
  const [listedInDirectory, setListedInDirectory] = useState<boolean | null>(null);
  const [directoryBusy, setDirectoryBusy] = useState(false);
  const [policyRulesOverride, setPolicyRulesOverride] = useState<PolicyRule[] | null>(null);
  const [policyRuleKind, setPolicyRuleKind] = useState<PolicyRuleKind>("user");
  const [policyRuleEntity, setPolicyRuleEntity] = useState("");
  const [policyRuleReason, setPolicyRuleReason] = useState("");
  const [policyRuleBusy, setPolicyRuleBusy] = useState(false);
  const [policySubsOverride, setPolicySubsOverride] = useState<string[] | null>(null);
  const [newPolicySubRoomId, setNewPolicySubRoomId] = useState("");
  const [policySubBusy, setPolicySubBusy] = useState(false);

  async function handleCopyInviteLink() {
    if (!room) return;
    await navigator.clipboard.writeText(getRoomInviteLink(client, room));
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  useEffect(() => {
    if (!qrVisible || !room) return;
    let cancelled = false;
    QRCode.toDataURL(getRoomInviteLink(client, room), { width: 220, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrVisible, room?.roomId]);

  useEffect(() => {
    let cancelled = false;
    void isRoomListedInDirectory(client, roomId).then((listed) => {
      if (!cancelled) setListedInDirectory(listed);
    });
    return () => {
      cancelled = true;
    };
  }, [client, roomId]);

  useEffect(() => {
    let cancelled = false;
    void getRecommendedRoomVersion(client).then((v) => {
      if (!cancelled) {
        setRecommendedVersion(v);
        setSelectedVersion((prev) => prev ?? v);
      }
    });
    void getAvailableRoomVersions(client).then((versions) => {
      if (!cancelled) setAvailableVersions(versions);
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (!room) return null;

  const maySeeRoles = canManagePowerLevels(room, ownUserId);
  const mayInvite = canInviteToRoom(room, ownUserId);
  const mayManageSuperReactions = canManageSuperReactions(room, ownUserId);
  const mayChangeAvatar = room.currentState.maySendStateEvent(EventType.RoomAvatar, ownUserId);
  const mayChangeChannelType = canSetChannelType(room, ownUserId);
  const currentChannelType = getChannelType(room);
  const members = room.getMembersWithMembership("join").sort((a, b) => a.name.localeCompare(b.name));
  const bannedMembers = room.getMembersWithMembership("ban").sort((a, b) => a.name.localeCompare(b.name));
  const mayUnban = room.currentState.hasSufficientPowerLevelFor("ban", room.getMember(ownUserId)?.powerLevel ?? 0);
  const owningSpace = getOwningSpace(client, roomId);
  const spaceCategories = owningSpace ? getSpaceCategories(owningSpace) : [];
  const mayAssignCategory = owningSpace ? canManageCategories(owningSpace, ownUserId) : false;
  const currentCategoryId = owningSpace ? getCategoryOfRoom(owningSpace, roomId) : null;
  const mayChangeJoinRule = canSetJoinRule(room, ownUserId);
  const currentJoinRule = getJoinRule(room);
  const mayChangeHistoryVis = canSetHistoryVisibility(room, ownUserId);
  const currentHistoryVis = getHistoryVisibility(room);
  const mayChangeGuestAccess = canManageGuestAccess(room, ownUserId);
  const guestsAllowed = getGuestAccess(room) === "can_join";
  const currentRoomVersion = getRoomVersion(room);
  const mayUpgrade = canUpgradeRoom(room, ownUserId);
  const mayManageAccess = owningSpace !== null && canManageChannelAccess(room, ownUserId);
  const spaceRoles = owningSpace ? getSpaceRoles(owningSpace) : [];
  const storedAccess = getChannelAccess(room);
  const access = accessDraft ?? storedAccess;
  const accessDirty =
    accessDraft !== null &&
    (accessDraft.mode !== storedAccess.mode ||
      accessDraft.roleIds.slice().sort().join() !== storedAccess.roleIds.slice().sort().join());
  // Most homeservers advertise the full `available` map, but fall back to
  // just the recommended version so upgrading still works on ones that don't.
  const versionOptions: RoomVersionOption[] =
    availableVersions.length > 0
      ? availableVersions
      : recommendedVersion
        ? [{ version: recommendedVersion, stable: true }]
        : [];
  const upgradeAvailable = versionOptions.some((v) => v.version !== currentRoomVersion);
  const joinRuleOptions = owningSpace
    ? JOIN_RULE_OPTIONS
    : JOIN_RULE_OPTIONS.filter((o) => o.value !== "restricted" && o.value !== "knock_restricted");
  // Not gated on the CURRENT join rule - a knock persists as a membership
  // state until resolved even if the rule was changed afterwards, so any
  // leftover pending request should still surface here.
  const pendingKnocks = getPendingKnocks(room);
  const mayApproveKnocks = pendingKnocks.length > 0 && canApproveKnocks(room, ownUserId);
  const maySetSlowmode = canSetSlowmode(room, ownUserId);
  const currentSlowmodeSeconds = getSlowmodeSeconds(room);
  const mayConfigureAutoMod = canConfigureAutoMod(room, ownUserId);
  const autoModConfig = autoModOverride ?? getAutoModConfig(room);
  const mayManageForumTags = currentChannelType === "forum" && canManageForumTags(room, ownUserId);
  const forumTags = forumTagsOverride ?? getForumTags(room);
  const mayManageRoomEmojis = canManageRoomEmojis(room, ownUserId);
  const mayPublishToDirectory = canSetRoomAlias(room, ownUserId);
  const currentAlias = room.getCanonicalAlias();
  const mayManagePolicyRules = (["user", "room", "server"] as PolicyRuleKind[]).some((k) =>
    canManagePolicyRules(room, ownUserId, k),
  );
  const policyRules = policyRulesOverride ?? getPolicyRules(room);
  const mayManagePolicySubscriptions = canManagePolicySubscriptions(room, ownUserId);
  const policySubscriptions = policySubsOverride ?? getPolicySubscriptions(room);

  async function handleChannelTypeChange(type: ChannelType) {
    setBusy(true);
    setError(null);
    try {
      await setChannelType(client, roomId, type);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleVoiceUserLimitCommit() {
    try {
      await setVoiceUserLimit(client, roomId, voiceUserLimit);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleVoiceBitrateCommit() {
    try {
      await setVoiceBitrateKbps(client, roomId, voiceBitrate);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleVoiceVideoQualityChange(quality: VoiceVideoQuality) {
    const prev = voiceVideoQuality;
    setVoiceVideoQualityState(quality);
    try {
      await setVoiceVideoQuality(client, roomId, quality);
    } catch (err) {
      setVoiceVideoQualityState(prev);
      setError((err as Error).message);
    }
  }

  async function handleContentRatingChange(rating: ChannelContentRating) {
    const prev = contentRating;
    setContentRating(rating);
    setBusy(true);
    setError(null);
    try {
      await setChannelContentRating(client, roomId, rating);
    } catch (err) {
      setContentRating(prev);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    avatarFileRef.current = file;
    setAvatarPreview(URL.createObjectURL(file));
  }

  function handleRoomAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    roomAvatarFileRef.current = file;
    setRoomAvatarPreview(URL.createObjectURL(file));
  }

  async function handleSaveRoomProfile() {
    setProfileBusy(true);
    setError(null);
    try {
      if (roomAvatarFileRef.current) {
        await setRoomAvatarOverride(client, roomId, roomAvatarFileRef.current);
        roomAvatarFileRef.current = null;
      }
      await setRoomNickname(client, roomId, roomNickname.trim() || null);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProfileBusy(false);
    }
  }

  async function handleResetRoomProfile() {
    setProfileBusy(true);
    setError(null);
    try {
      await setRoomAvatarOverride(client, roomId, null);
      await setRoomNickname(client, roomId, null);
      setRoomNicknameInput("");
      roomAvatarFileRef.current = null;
      const globalUser = client.getUser(ownUserId);
      setRoomAvatarPreview(globalUser?.avatarUrl ? client.mxcUrlToHttp(globalUser.avatarUrl, 64, 64, "crop") : null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProfileBusy(false);
    }
  }

  async function handleCategoryChange(spaceId: string, categoryId: string) {
    setBusy(true);
    setError(null);
    try {
      await assignRoomToCategory(client, spaceId, roomId, categoryId || null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRoleChange(userId: string, newLevel: number) {
    setBusy(true);
    setError(null);
    try {
      await setMemberPowerLevel(client, roomId, userId, newLevel);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUnban(userId: string) {
    setBusy(true);
    setError(null);
    try {
      await unbanMember(client, roomId, userId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleFavouriteChange(favourite: boolean) {
    // setRoomTag/deleteRoomTag are plain PUT/DELETE with no local echo -
    // room.tags only updates once the account_data change round-trips back
    // through a later /sync, so the checkbox needs an optimistic override
    // (same pattern as the role-assignment checkboxes in SpaceRolesContent)
    // or a click would look unresponsive for a beat.
    setFavouriteOverride(favourite);
    setError(null);
    try {
      await setFavourite(client, roomId, favourite);
    } catch (err) {
      setError((err as Error).message);
      setFavouriteOverride(!favourite);
    }
  }

  async function handleLowPriorityChange(lowPriority: boolean) {
    setLowPriorityOverride(lowPriority);
    setError(null);
    try {
      await setLowPriority(client, roomId, lowPriority);
    } catch (err) {
      setError((err as Error).message);
      setLowPriorityOverride(!lowPriority);
    }
  }

  async function handleJoinRuleChange(rule: JoinRuleValue) {
    setJoinRuleBusy(true);
    setError(null);
    try {
      await setJoinRule(client, roomId, rule, owningSpace?.roomId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJoinRuleBusy(false);
    }
  }

  async function handleGuestAccessToggle(allow: boolean) {
    setError(null);
    try {
      await setGuestAccess(client, roomId, allow);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleHistoryVisChange(value: HistoryVisibilityValue) {
    setHistoryVisBusy(true);
    setError(null);
    try {
      await setHistoryVisibility(client, roomId, value);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setHistoryVisBusy(false);
    }
  }

  async function handleApplyAccess() {
    if (!accessDraft || accessBusy) return;
    setAccessBusy(true);
    setError(null);
    try {
      await setChannelAccess(client, roomId, accessDraft);
      setAccessDraft(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAccessBusy(false);
    }
  }

  async function handleUpgrade() {
    if (!selectedVersion || !upgradeAcknowledged || upgradeBusy) return;
    if (!(await uiConfirm(t("roomUpgrade.confirm", { name: room?.name || roomId }), { danger: true }))) return;
    setUpgradeBusy(true);
    setError(null);
    try {
      const newRoomId = await upgradeRoom(client, roomId, selectedVersion);
      close();
      selectRoom(newRoomId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpgradeBusy(false);
    }
  }

  async function handleApproveKnock(userId: string) {
    setKnockBusyId(userId);
    try {
      await approveKnock(client, roomId, userId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setKnockBusyId(null);
    }
  }

  async function handleDenyKnock(userId: string) {
    setKnockBusyId(userId);
    try {
      await kickMember(client, roomId, userId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setKnockBusyId(null);
    }
  }

  async function handleSlowmodeChange(seconds: number) {
    setSlowmodeBusy(true);
    setError(null);
    try {
      await setSlowmodeSeconds(client, roomId, seconds);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSlowmodeBusy(false);
    }
  }

  async function handleAutoModSave(next: AutoModConfig) {
    setAutoModOverride(next);
    setAutoModBusy(true);
    setError(null);
    try {
      await setAutoModConfig(client, roomId, next);
    } catch (err) {
      setError((err as Error).message);
      setAutoModOverride(null);
    } finally {
      setAutoModBusy(false);
    }
  }

  async function handleAddAutoModKeyword() {
    const word = newAutoModKeyword.trim();
    if (!word || autoModConfig.keywords.includes(word)) return;
    setNewAutoModKeyword("");
    await handleAutoModSave({ ...autoModConfig, keywords: [...autoModConfig.keywords, word] });
  }

  async function handleRemoveAutoModKeyword(word: string) {
    await handleAutoModSave({ ...autoModConfig, keywords: autoModConfig.keywords.filter((k) => k !== word) });
  }

  async function handleAddAutoModPattern() {
    const value = newAutoModPatternValue.trim();
    if (!value) return;
    setNewAutoModPatternValue("");
    await handleAutoModSave({
      ...autoModConfig,
      patterns: [...autoModConfig.patterns, { value, kind: newAutoModPatternKind }],
    });
  }

  async function handleRemoveAutoModPattern(value: string) {
    await handleAutoModSave({ ...autoModConfig, patterns: autoModConfig.patterns.filter((p) => p.value !== value) });
  }

  async function handleAddAllowedDomain() {
    const domain = newAllowedDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!domain || autoModConfig.allowedDomains.includes(domain)) return;
    setNewAllowedDomain("");
    await handleAutoModSave({ ...autoModConfig, allowedDomains: [...autoModConfig.allowedDomains, domain] });
  }

  async function handleRemoveAllowedDomain(domain: string) {
    await handleAutoModSave({ ...autoModConfig, allowedDomains: autoModConfig.allowedDomains.filter((d) => d !== domain) });
  }

  async function handleForumTagsSave(next: ForumTag[]) {
    setForumTagsOverride(next);
    setForumTagsBusy(true);
    setError(null);
    try {
      await setForumTags(client, roomId, next);
    } catch (err) {
      setError((err as Error).message);
      setForumTagsOverride(null);
    } finally {
      setForumTagsBusy(false);
    }
  }

  async function handleAddForumTag() {
    const name = newForumTagName.trim();
    if (!name) return;
    setNewForumTagName("");
    const id = `tag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await handleForumTagsSave([...forumTags, { id, name, color: newForumTagColor }]);
  }

  async function handleRemoveForumTag(id: string) {
    await handleForumTagsSave(forumTags.filter((t) => t.id !== id));
  }

  async function handleAddPolicyRule() {
    const entity = policyRuleEntity.trim();
    if (!entity) return;
    setPolicyRuleBusy(true);
    setError(null);
    try {
      await addPolicyRule(client, roomId, policyRuleKind, entity, policyRuleReason.trim());
      // sendStateEvent has no local echo - optimistically show the new rule
      // right away (same pattern as AutoMod/forum tags above), a real
      // stateKey isn't needed for display purposes until the next /sync
      // reconciles it with the real state.
      setPolicyRulesOverride([
        ...policyRules,
        { stateKey: `pending_${Date.now()}`, kind: policyRuleKind, entity, reason: policyRuleReason.trim(), recommendation: "m.ban" },
      ]);
      setPolicyRuleEntity("");
      setPolicyRuleReason("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPolicyRuleBusy(false);
    }
  }

  async function handleRemovePolicyRule(rule: PolicyRule) {
    setPolicyRuleBusy(true);
    setError(null);
    try {
      await removePolicyRule(client, roomId, rule.kind, rule.stateKey);
      setPolicyRulesOverride(policyRules.filter((r) => r.stateKey !== rule.stateKey));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPolicyRuleBusy(false);
    }
  }

  async function handleAddPolicySubscription() {
    const target = newPolicySubRoomId.trim();
    if (!target) return;
    setPolicySubBusy(true);
    setError(null);
    try {
      const targetRoomId = target.startsWith("#") ? (await client.getRoomIdForAlias(target)).room_id : target;
      const next = policySubscriptions.includes(targetRoomId) ? policySubscriptions : [...policySubscriptions, targetRoomId];
      await setPolicySubscriptions(client, roomId, next);
      setPolicySubsOverride(next);
      setNewPolicySubRoomId("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPolicySubBusy(false);
    }
  }

  async function handleRemovePolicySubscription(listRoomId: string) {
    setPolicySubBusy(true);
    setError(null);
    try {
      const next = policySubscriptions.filter((id) => id !== listRoomId);
      await setPolicySubscriptions(client, roomId, next);
      setPolicySubsOverride(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPolicySubBusy(false);
    }
  }

  async function handleSetAlias() {
    const localpart = aliasLocalpart.trim();
    if (!localpart) return;
    setAliasBusy(true);
    setError(null);
    try {
      await setRoomAlias(client, roomId, localpart);
      setAliasLocalpart("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAliasBusy(false);
    }
  }

  async function handleDirectoryToggle(listed: boolean) {
    setDirectoryBusy(true);
    setError(null);
    try {
      await setRoomListedInDirectory(client, roomId, listed);
      setListedInDirectory(listed);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDirectoryBusy(false);
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (avatarFileRef.current) {
        await setRoomAvatarImage(client, roomId, avatarFileRef.current);
      }
      if (name.trim() && name.trim() !== room!.name) {
        await renameRoom(client, roomId, name.trim());
      }
      await setRoomTopic(client, roomId, topic.trim());
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReportRoom() {
    const reason = await uiPrompt(t("roomSettings.reportPrompt", { name: room!.name }));
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await reportRoom(client, roomId, reason);
      await uiAlert(t("roomSettings.reported"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLeave() {
    if (!(await uiConfirm(t("roomSettings.leaveConfirm", { name: room!.name }), { danger: true }))) return;
    setBusy(true);
    try {
      await leaveRoom(client, roomId);
      selectRoom(null);
      close();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const showAccess =
    maySeeRoles ||
    mayChangeJoinRule ||
    mayChangeHistoryVis ||
    mayChangeGuestAccess ||
    mayManageAccess ||
    pendingKnocks.length > 0;
  const showSharing = mayInvite || mayPublishToDirectory;

  const panes: SettingsPane[] = [
    {
      id: "general",
      label: t("roomSettings.catGeneral"),
      keywords:
        "általános general szoba neve name topic téma csatorna típusa channel type slowmode lassított kategória category kedvenc favourite prioritás priority profil megjelenés becenév nickname avatar",
    },
    ...(showAccess
      ? [
          {
            id: "access",
            label: t("roomSettings.catAccess"),
            keywords:
              "hozzáférés access csatlakozás join szabály rule előzmény history láthatóság visibility vendég guest szerepkör role jogosultság permission power level kopogtatás knock",
          } as SettingsPane,
        ]
      : []),
    {
      id: "moderation",
      label: t("roomSettings.catModeration"),
      keywords:
        "automod moderáció moderation kulcsszó keyword szűrés filter fórum forum címke tag kitiltás ban lista list napló audit log",
    },
    ...(showSharing
      ? [
          {
            id: "sharing",
            label: t("roomSettings.catSharing"),
            keywords: "megosztás sharing meghívó invite link qr kód code nyilvános public könyvtár directory cím alias",
          } as SettingsPane,
        ]
      : []),
    ...(mayManageRoomEmojis
      ? [
          {
            id: "emoji",
            label: t("spaceSettings.catEmoji"),
            keywords: "emoji szoba custom egyéni matrica",
          } as SettingsPane,
        ]
      : []),
    ...(mayManageSuperReactions
      ? [
          {
            id: "super-reactions",
            label: t("superReact.title"),
            keywords: "super reaction reakció emoji burst effekt effect",
          } as SettingsPane,
        ]
      : []),
    {
      id: "advanced",
      label: t("roomSettings.catAdvanced"),
      keywords: "speciális advanced verzió version frissítés upgrade jelentés report elhagyás leave szoba room",
    },
  ];

  return (
    <SettingsModalShell title={t("roomSettings.title")} onClose={close} panes={panes}>
      {(active) => (
        <>
      {active === "general" && (
      <form onSubmit={handleSave}>
        {mayChangeAvatar && (
          <div className="mb-4 flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-full"
              title={t("roomSettings.changeAvatar")}
              aria-label={t("roomSettings.changeAvatar")}
            >
              <Avatar url={avatarPreview} name={name || room.name || "?"} size={64} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarPick}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-sm font-medium text-link hover:underline"
            >
              {t("roomSettings.changeAvatar")}
            </button>
          </div>
        )}
        <ModalField label={t("roomSettings.nameLabel")}>
          <input className={modalInputClass()} value={name} onChange={(e) => setName(e.target.value)} />
        </ModalField>
        <ModalField label={t("roomSettings.topicLabel")}>
          <input className={modalInputClass()} value={topic} onChange={(e) => setTopic(e.target.value)} />
        </ModalField>
        {mayChangeChannelType && (
          <div className="mb-4">
            <span className="mb-1 block text-xs font-bold uppercase text-muted">{t("roomSettings.channelType")}</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                aria-pressed={currentChannelType === "text"}
                onClick={() => void handleChannelTypeChange("text")}
                className={`flex-1 rounded border py-2 text-sm font-medium transition disabled:opacity-60 ${
                  currentChannelType === "text"
                    ? "border-brand bg-brand/10 text-header"
                    : "border-border text-muted hover:text-normal"
                }`}
              >
                {t("roomSettings.typeText")}
              </button>
              <button
                type="button"
                disabled={busy}
                aria-pressed={currentChannelType === "voice"}
                onClick={() => void handleChannelTypeChange("voice")}
                className={`flex-1 rounded border py-2 text-sm font-medium transition disabled:opacity-60 ${
                  currentChannelType === "voice"
                    ? "border-brand bg-brand/10 text-header"
                    : "border-border text-muted hover:text-normal"
                }`}
              >
                {t("roomSettings.typeVoice")}
              </button>
              <button
                type="button"
                disabled={busy}
                aria-pressed={currentChannelType === "stage"}
                onClick={() => void handleChannelTypeChange("stage")}
                title={t("roomSettings.typeStageHint")}
                className={`flex-1 rounded border py-2 text-sm font-medium transition disabled:opacity-60 ${
                  currentChannelType === "stage"
                    ? "border-brand bg-brand/10 text-header"
                    : "border-border text-muted hover:text-normal"
                }`}
              >
                {t("roomSettings.typeStage")}
              </button>
              <button
                type="button"
                disabled={busy}
                aria-pressed={currentChannelType === "forum"}
                onClick={() => void handleChannelTypeChange("forum")}
                title={t("roomSettings.typeForumHint")}
                className={`flex-1 rounded border py-2 text-sm font-medium transition disabled:opacity-60 ${
                  currentChannelType === "forum"
                    ? "border-brand bg-brand/10 text-header"
                    : "border-border text-muted hover:text-normal"
                }`}
              >
                {t("roomSettings.typeForum")}
              </button>
            </div>
          </div>
        )}
        {mayChangeChannelType && (currentChannelType === "voice" || currentChannelType === "stage") && (
          <div className="mb-4">
            <span className="mb-1 block text-xs font-bold uppercase text-muted">{t("roomSettings.voiceUserLimit")}</span>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={99}
                value={voiceUserLimit}
                onChange={(e) => setVoiceUserLimitState(Number(e.target.value))}
                onMouseUp={() => void handleVoiceUserLimitCommit()}
                onTouchEnd={() => void handleVoiceUserLimitCommit()}
                className="min-w-0 flex-1"
              />
              <span className="w-16 shrink-0 text-right text-sm text-normal">
                {voiceUserLimit === 0 ? "∞" : voiceUserLimit}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">{t("roomSettings.voiceUserLimitHint")}</p>
          </div>
        )}
        {mayChangeChannelType && (currentChannelType === "voice" || currentChannelType === "stage") && (
          <div className="mb-4">
            <span className="mb-1 block text-xs font-bold uppercase text-muted">{t("roomSettings.voiceBitrate")}</span>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={VOICE_BITRATE_MIN_KBPS}
                max={VOICE_BITRATE_MAX_KBPS}
                step={8}
                value={voiceBitrate}
                onChange={(e) => setVoiceBitrateState(Number(e.target.value))}
                onMouseUp={() => void handleVoiceBitrateCommit()}
                onTouchEnd={() => void handleVoiceBitrateCommit()}
                className="min-w-0 flex-1"
              />
              <span className="w-20 shrink-0 text-right text-sm text-normal">{voiceBitrate} kbps</span>
            </div>
            <p className="mt-1 text-xs text-muted">{t("roomSettings.voiceBitrateHint")}</p>
          </div>
        )}
        {mayChangeChannelType && (currentChannelType === "voice" || currentChannelType === "stage") && (
          <div className="mb-4">
            <span className="mb-1 block text-xs font-bold uppercase text-muted">{t("roomSettings.voiceVideoQuality")}</span>
            <div className="flex gap-2">
              {(["auto", "720p"] as const).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void handleVoiceVideoQualityChange(q)}
                  className={`flex-1 rounded border py-2 text-sm font-medium transition ${
                    voiceVideoQuality === q
                      ? "border-brand bg-brand/10 text-header"
                      : "border-border text-muted hover:text-normal"
                  }`}
                >
                  {t(`roomSettings.voiceVideoQuality.${q}`)}
                </button>
              ))}
            </div>
          </div>
        )}
        {mayChangeChannelType && currentChannelType === "text" && (
          <div className="mb-4">
            <span className="mb-1 block text-xs font-bold uppercase text-muted">
              {t("roomSettings.contentRating")}
            </span>
            <div className="flex flex-col gap-2">
              {(["default", "spoiler", "age_restricted"] as const).map((rating) => (
                <label key={rating} className="flex cursor-pointer items-start gap-2 text-sm text-normal">
                  <input
                    type="radio"
                    name="channel-content-rating"
                    className="mt-0.5 h-4 w-4 shrink-0"
                    checked={contentRating === rating}
                    disabled={busy}
                    onChange={() => void handleContentRatingChange(rating)}
                  />
                  <span>
                    {t(`roomSettings.contentRating.${rating}`)}
                    <span className="block text-xs font-normal text-muted">
                      {t(`roomSettings.contentRating.${rating}Hint`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
        {maySetSlowmode && (
          <div className="mb-4">
            <span className="mb-1 block text-xs font-bold uppercase text-muted">{t("roomSettings.slowmode")}</span>
            <select
              value={currentSlowmodeSeconds}
              disabled={slowmodeBusy}
              onChange={(e) => void handleSlowmodeChange(Number(e.target.value))}
              className="w-full rounded bg-bg-darkest px-3 py-2 text-sm text-normal outline-none disabled:opacity-50"
            >
              {SLOWMODE_PRESETS.map((p) => (
                <option key={p.seconds} value={p.seconds}>
                  {t(p.labelKey)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">{t("roomSettings.slowmodeHint")}</p>
          </div>
        )}
        {owningSpace && mayAssignCategory && spaceCategories.length > 0 && (
          <div className="mb-4">
            <span className="mb-1 block text-xs font-bold uppercase text-muted">{t("roomSettings.category")}</span>
            <select
              value={currentCategoryId ?? ""}
              disabled={busy}
              onChange={(e) => void handleCategoryChange(owningSpace.roomId, e.target.value)}
              className="w-full rounded bg-bg-darkest px-3 py-2 text-sm text-normal outline-none disabled:opacity-50"
            >
              <option value="">{t("roomSettings.noCategory")}</option>
              {spaceCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="mb-4 flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-sm text-normal">
            <input
              type="checkbox"
              checked={favouriteOverride ?? isFavourite(room)}
              onChange={(e) => void handleFavouriteChange(e.target.checked)}
              className="h-4 w-4"
            />
            {t("roomSettings.favourite")}
          </label>
          <label className="flex items-center gap-1.5 text-sm text-normal">
            <input
              type="checkbox"
              checked={lowPriorityOverride ?? isLowPriority(room)}
              onChange={(e) => void handleLowPriorityChange(e.target.checked)}
              className="h-4 w-4"
            />
            {t("roomSettings.lowPriority")}
          </label>
        </div>
        {error && <p className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
        <ModalPrimaryButton type="submit" disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </ModalPrimaryButton>
      </form>
      )}

      {active === "moderation" && mayConfigureAutoMod && (
        <div id="room-settings-section-automod" className={sectionClassName("automod moderáció moderation kulcsszó keyword szűrés filter")}>
          <h3 className="mb-1 text-xs font-bold uppercase text-muted">{t("roomSettings.automodTitle")}</h3>
          <p className="mb-2 text-xs text-muted">{t("roomSettings.automodHint")}</p>
          <label className="mb-2 flex items-center justify-between gap-3 text-sm text-normal">
            <span>{t("roomSettings.enabled")}</span>
            <input
              type="checkbox"
              checked={autoModConfig.enabled}
              disabled={autoModBusy}
              onChange={(e) => void handleAutoModSave({ ...autoModConfig, enabled: e.target.checked })}
              className="h-4 w-4 shrink-0"
            />
          </label>
          {autoModConfig.keywords.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {autoModConfig.keywords.map((word) => (
                <span
                  key={word}
                  className="flex items-center gap-1 rounded-full bg-bg-darkest px-2.5 py-1 text-xs text-normal"
                >
                  {word}
                  <button
                    type="button"
                    disabled={autoModBusy}
                    onClick={() => void handleRemoveAutoModKeyword(word)}
                    title={t("roomSettings.remove")}
                    aria-label={t("roomSettings.remove")}
                    className="text-muted hover:text-dnd disabled:opacity-50"
                  >
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
                      <path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.3 19.7 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.29-6.3Z" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              className={modalInputClass()}
              value={newAutoModKeyword}
              onChange={(e) => setNewAutoModKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleAddAutoModKeyword();
                }
              }}
              placeholder={t("roomSettings.automodKeywordPlaceholder")}
              aria-label={t("roomSettings.automodKeywordPlaceholder")}
            />
            <button
              type="button"
              disabled={autoModBusy || !newAutoModKeyword.trim()}
              onClick={() => void handleAddAutoModKeyword()}
              className="shrink-0 rounded bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
            >
              {t("roomSettings.add")}
            </button>
          </div>

          <p className="mb-1 mt-4 text-xs font-bold uppercase text-muted">{t("roomSettings.patternsTitle")}</p>
          <p className="mb-2 text-xs text-muted">{t("roomSettings.patternsHint")}</p>
          {autoModConfig.patterns.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {autoModConfig.patterns.map((p) => (
                <span
                  key={p.value}
                  className="flex items-center gap-1 rounded-full bg-bg-darkest px-2.5 py-1 text-xs text-normal"
                >
                  <span className="rounded bg-bg-modifier-hover px-1 text-[10px] font-bold uppercase text-muted">
                    {p.kind === "wildcard" ? "WC" : "RE"}
                  </span>
                  <span className="font-mono">{p.value}</span>
                  <button
                    type="button"
                    disabled={autoModBusy}
                    onClick={() => void handleRemoveAutoModPattern(p.value)}
                    title={t("roomSettings.remove")}
                    aria-label={t("roomSettings.remove")}
                    className="text-muted hover:text-dnd disabled:opacity-50"
                  >
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
                      <path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.3 19.7 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.29-6.3Z" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <select
              value={newAutoModPatternKind}
              onChange={(e) => setNewAutoModPatternKind(e.target.value as AutoModPattern["kind"])}
              className="shrink-0 rounded bg-bg-darkest px-2 py-2 text-sm text-normal outline-none"
            >
              <option value="wildcard">{t("roomSettings.patternWildcard")}</option>
              <option value="regex">{t("roomSettings.patternRegex")}</option>
            </select>
            <input
              className={modalInputClass()}
              value={newAutoModPatternValue}
              onChange={(e) => setNewAutoModPatternValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleAddAutoModPattern();
                }
              }}
              placeholder={newAutoModPatternKind === "wildcard" ? t("roomSettings.patternWildcardPlaceholder") : t("roomSettings.patternRegexPlaceholder")}
              aria-label={newAutoModPatternKind === "wildcard" ? t("roomSettings.patternWildcardPlaceholder") : t("roomSettings.patternRegexPlaceholder")}
            />
            <button
              type="button"
              disabled={autoModBusy || !newAutoModPatternValue.trim()}
              onClick={() => void handleAddAutoModPattern()}
              className="shrink-0 rounded bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
            >
              {t("roomSettings.add")}
            </button>
          </div>

          <label className="mb-2 mt-4 flex items-center justify-between gap-3 text-sm text-normal">
            <span>{t("roomSettings.linkFilter")}</span>
            <input
              type="checkbox"
              checked={autoModConfig.linkFilterEnabled}
              disabled={autoModBusy}
              onChange={(e) => void handleAutoModSave({ ...autoModConfig, linkFilterEnabled: e.target.checked })}
              className="h-4 w-4 shrink-0"
            />
          </label>
          {autoModConfig.linkFilterEnabled && (
            <>
              <p className="mb-2 text-xs text-muted">{t("roomSettings.linkFilterHint")}</p>
              {autoModConfig.allowedDomains.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {autoModConfig.allowedDomains.map((domain) => (
                    <span
                      key={domain}
                      className="flex items-center gap-1 rounded-full bg-bg-darkest px-2.5 py-1 text-xs text-normal"
                    >
                      {domain}
                      <button
                        type="button"
                        disabled={autoModBusy}
                        onClick={() => void handleRemoveAllowedDomain(domain)}
                        title={t("roomSettings.remove")}
                        className="text-muted hover:text-dnd disabled:opacity-50"
                      >
                        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
                          <path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.3 19.7 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.29-6.3Z" />
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  className={modalInputClass()}
                  value={newAllowedDomain}
                  onChange={(e) => setNewAllowedDomain(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleAddAllowedDomain();
                    }
                  }}
                  placeholder={t("roomSettings.domainPlaceholder")}
                  aria-label={t("roomSettings.domainPlaceholder")}
                />
                <button
                  type="button"
                  disabled={autoModBusy || !newAllowedDomain.trim()}
                  onClick={() => void handleAddAllowedDomain()}
                  className="shrink-0 rounded bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
                >
                  {t("roomSettings.add")}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {active === "moderation" && mayManageForumTags && (
        <div id="room-settings-section-forum" className={sectionClassName("fórum forum címke tag")}>
          <h3 className="mb-1 text-xs font-bold uppercase text-muted">{t("roomSettings.forumTagsTitle")}</h3>
          <p className="mb-2 text-xs text-muted">{t("roomSettings.forumTagsHint")}</p>
          {forumTags.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {forumTags.map((tag) => (
                <span
                  key={tag.id}
                  className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{ backgroundColor: `${tag.color}33`, color: tag.color }}
                >
                  {tag.name}
                  <button
                    type="button"
                    disabled={forumTagsBusy}
                    onClick={() => void handleRemoveForumTag(tag.id)}
                    title={t("roomSettings.remove")}
                    aria-label={t("roomSettings.remove")}
                    className="opacity-70 hover:opacity-100 disabled:opacity-30"
                  >
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
                      <path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.3 19.7 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.29-6.3Z" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="color"
              value={newForumTagColor}
              onChange={(e) => setNewForumTagColor(e.target.value)}
              className="h-9 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent"
              title={t("roomSettings.tagColor")}
            />
            <input
              className={modalInputClass()}
              value={newForumTagName}
              onChange={(e) => setNewForumTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleAddForumTag();
                }
              }}
              placeholder={t("roomSettings.newTagPlaceholder")}
              aria-label={t("roomSettings.newTagPlaceholder")}
            />
            <button
              type="button"
              disabled={forumTagsBusy || !newForumTagName.trim()}
              onClick={() => void handleAddForumTag()}
              className="shrink-0 rounded bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
            >
              {t("roomSettings.add")}
            </button>
          </div>
        </div>
      )}

      {active === "emoji" && mayManageRoomEmojis && (
        <div>
          <EmojiPackManager targetId={roomId} scope="room" />
        </div>
      )}

      {active === "super-reactions" && mayManageSuperReactions && (
        <div>
          <SuperReactionsSection targetId={roomId} scope="room" />
        </div>
      )}

      {active === "moderation" && mayManagePolicyRules && (
        <div id="room-settings-section-banlist" className={sectionClassName("moderáció moderation kitiltás ban lista list msc2313")}>
          <h3 className="mb-1 text-xs font-bold uppercase text-muted">{t("roomSettings.banlistTitle")}</h3>
          <p className="mb-2 text-xs text-muted">{t("roomSettings.banlistHint")}</p>
          {policyRules.length > 0 && (
            <div className="mb-2 flex flex-col gap-1.5">
              {policyRules.map((rule) => (
                <div key={rule.stateKey} className="flex items-center gap-2 rounded bg-bg-darkest px-2.5 py-1.5 text-xs">
                  <span className="shrink-0 rounded bg-bg-modifier-hover px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted">
                    {rule.kind}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-normal">{rule.entity}</span>
                  {rule.reason && <span className="min-w-0 flex-1 truncate text-muted">{rule.reason}</span>}
                  <button
                    type="button"
                    disabled={policyRuleBusy}
                    onClick={() => void handleRemovePolicyRule(rule)}
                    title={t("roomSettings.removeRule")}
                    aria-label={t("roomSettings.removeRule")}
                    className="shrink-0 text-muted hover:text-dnd disabled:opacity-50"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                      <path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.3 19.7 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.29-6.3Z" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <select
              value={policyRuleKind}
              onChange={(e) => setPolicyRuleKind(e.target.value as PolicyRuleKind)}
              className="shrink-0 rounded bg-bg-darkest px-2 py-2 text-sm text-normal outline-none"
            >
              <option value="user">{t("roomSettings.entityUser")}</option>
              <option value="room">{t("roomSettings.entityRoom")}</option>
              <option value="server">{t("roomSettings.entityServer")}</option>
            </select>
            <input
              className={modalInputClass()}
              value={policyRuleEntity}
              onChange={(e) => setPolicyRuleEntity(e.target.value)}
              placeholder={t("roomSettings.entityPlaceholder")}
              aria-label={t("roomSettings.entityPlaceholder")}
            />
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className={modalInputClass()}
              value={policyRuleReason}
              onChange={(e) => setPolicyRuleReason(e.target.value)}
              placeholder={t("roomSettings.reasonPlaceholder")}
              aria-label={t("roomSettings.reasonPlaceholder")}
            />
            <button
              type="button"
              disabled={policyRuleBusy || !policyRuleEntity.trim()}
              onClick={() => void handleAddPolicyRule()}
              className="shrink-0 rounded bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
            >
              {t("roomSettings.add")}
            </button>
          </div>
        </div>
      )}

      {active === "moderation" && mayManagePolicySubscriptions && (
        <div className={sectionClassName("moderáció moderation kitiltás ban lista list feliratkozás subscribe")}>
          <h3 className="mb-1 text-xs font-bold uppercase text-muted">{t("roomSettings.policySubsTitle")}</h3>
          <p className="mb-2 text-xs text-muted">{t("roomSettings.policySubsHint")}</p>
          {policySubscriptions.length > 0 && (
            <div className="mb-2 flex flex-col gap-1.5">
              {policySubscriptions.map((id) => {
                const listRoom = client.getRoom(id);
                return (
                  <div key={id} className="flex items-center gap-2 rounded bg-bg-darkest px-2.5 py-1.5 text-xs">
                    <span className="min-w-0 flex-1 truncate text-normal">
                      {listRoom?.name ?? id}
                      {!listRoom && <span className="ml-1 text-muted">{t("roomSettings.notJoined")}</span>}
                    </span>
                    <button
                      type="button"
                      disabled={policySubBusy}
                      onClick={() => void handleRemovePolicySubscription(id)}
                      title={t("roomSettings.unsubscribe")}
                      aria-label={t("roomSettings.unsubscribe")}
                      className="shrink-0 text-muted hover:text-dnd disabled:opacity-50"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                        <path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.3 19.7 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.29-6.3Z" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex gap-2">
            <input
              className={modalInputClass()}
              value={newPolicySubRoomId}
              onChange={(e) => setNewPolicySubRoomId(e.target.value)}
              placeholder={t("roomSettings.listRoomPlaceholder")}
              aria-label={t("roomSettings.listRoomPlaceholder")}
            />
            <button
              type="button"
              disabled={policySubBusy || !newPolicySubRoomId.trim()}
              onClick={() => void handleAddPolicySubscription()}
              className="shrink-0 rounded bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
            >
              {t("roomSettings.subscribe")}
            </button>
          </div>
        </div>
      )}

      {active === "moderation" && mayUnban && (
        <div id="room-settings-section-banned" className={sectionClassName("moderáció moderation kitiltás ban unban feloldás tag member")}>
          <h3 className="mb-1 text-xs font-bold uppercase text-muted">{t("roomSettings.bannedTitle")}</h3>
          <p className="mb-2 text-xs text-muted">{t("roomSettings.bannedHint")}</p>
          {bannedMembers.length === 0 ? (
            <p className="text-sm text-muted">{t("roomSettings.bannedEmpty")}</p>
          ) : (
            <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto" data-testid="banned-list">
              {bannedMembers.map((m) => {
                const reason = m.events.member?.getContent().reason as string | undefined;
                return (
                  <div
                    key={m.userId}
                    data-testid="banned-row"
                    data-user-id={m.userId}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-normal">{m.name}</p>
                      <p className="truncate text-xs text-muted">
                        {m.userId}
                        {reason ? ` — ${reason}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      data-testid="unban-button"
                      disabled={busy}
                      onClick={() => void handleUnban(m.userId)}
                      className="shrink-0 rounded border border-border px-2.5 py-1 text-xs font-medium text-normal hover:bg-bg-modifier-hover disabled:opacity-50"
                    >
                      {t("roomSettings.unban")}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {active === "access" && maySeeRoles && (
        <div id="room-settings-section-permissions" className={sectionClassName("jogosultság permission power level szint moderátor admin")}>
          <h3 className="mb-1 text-xs font-bold uppercase text-muted">{t("roomSettings.memberPermsTitle")}</h3>
          <ul className="mb-2 space-y-0.5 text-xs text-muted">
            {POWER_LEVEL_PRESETS.map((p) => (
              <li key={p.value}>
                <span className="font-semibold text-normal">{t(p.labelKey)}</span> — {t(p.hintKey)}
              </li>
            ))}
          </ul>
          <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto">
            {members.map((m) => {
              const level = getMemberPowerLevel(room, m.userId);
              const disabled = busy || !canSetMemberPowerLevel(room, ownUserId, m.userId, level);
              return (
                <div key={m.userId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-normal">{m.name}</span>
                  <select
                    value={level}
                    disabled={disabled}
                    onChange={(e) => void handleRoleChange(m.userId, Number(e.target.value))}
                    className="shrink-0 rounded bg-bg-darkest px-2 py-1 text-xs text-normal outline-none disabled:opacity-50"
                  >
                    {!PRESET_VALUES.has(level) && <option value={level}>{t("roomSettings.customLevelOption", { level })}</option>}
                    {POWER_LEVEL_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {t(p.labelKey)}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {active === "access" && mayChangeJoinRule && (
        <div id="room-settings-section-access" className={sectionClassName("hozzáférés access csatlakozás join szabály rule")}>
          <h3 className="mb-1 text-xs font-bold uppercase text-muted">{t("roomSettings.joinRuleTitle")}</h3>
          <select
            value={currentJoinRule}
            disabled={joinRuleBusy}
            onChange={(e) => void handleJoinRuleChange(e.target.value as JoinRuleValue)}
            className="w-full rounded bg-bg-darkest px-3 py-2 text-sm text-normal outline-none disabled:opacity-50"
          >
            {joinRuleOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">
            {(() => { const o = joinRuleOptions.find((x) => x.value === currentJoinRule); return o ? t(o.hintKey) : ""; })()}
          </p>
        </div>
      )}

      {active === "access" && mayChangeHistoryVis && (
        <div className={sectionClassName("hozzáférés access adatvédelem privacy előzmény history láthatóság visibility")}>
          <h3 className="mb-1 text-xs font-bold uppercase text-muted">{t("roomSettings.historyVisTitle")}</h3>
          <select
            value={currentHistoryVis}
            disabled={historyVisBusy}
            onChange={(e) => void handleHistoryVisChange(e.target.value as HistoryVisibilityValue)}
            className="w-full rounded bg-bg-darkest px-3 py-2 text-sm text-normal outline-none disabled:opacity-50"
          >
            {HISTORY_VISIBILITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">
            {(() => { const o = HISTORY_VISIBILITY_OPTIONS.find((x) => x.value === currentHistoryVis); return o ? t(o.hintKey) : ""; })()}
          </p>
        </div>
      )}

      {active === "access" && mayChangeGuestAccess && (
        <div className={sectionClassName("hozzáférés access vendég guest")}>
          <label className="flex items-center justify-between gap-3 text-sm text-normal">
            <span>
              {t("guestAccess.label")}
              <span className="block text-xs font-normal text-muted">{t("guestAccess.hint")}</span>
            </span>
            <input
              type="checkbox"
              checked={guestsAllowed}
              onChange={(e) => void handleGuestAccessToggle(e.target.checked)}
              className="h-4 w-4 shrink-0"
            />
          </label>
        </div>
      )}

      {active === "access" && mayManageAccess && (
        <div className={sectionClassName("hozzáférés access szerepkör role csatorna channel")}>
          <h3 className="mb-1 text-xs font-bold uppercase text-muted">{t("channelAccess.title")}</h3>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-sm text-normal">
              <input
                type="radio"
                name="channelAccess"
                checked={access.mode === "open"}
                onChange={() => setAccessDraft({ mode: "open", roleIds: [] })}
                className="h-4 w-4"
              />
              {t("channelAccess.open")}
            </label>
            <label className="flex items-center gap-2 text-sm text-normal">
              <input
                type="radio"
                name="channelAccess"
                checked={access.mode === "restricted"}
                onChange={() =>
                  setAccessDraft({ mode: "restricted", roleIds: access.roleIds })
                }
                className="h-4 w-4"
              />
              {t("channelAccess.restricted")}
            </label>
          </div>
          {access.mode === "restricted" && (
            <div className="mt-2">
              {spaceRoles.length === 0 ? (
                <p className="text-xs text-muted">{t("channelAccess.needRoles")}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {spaceRoles.map((r) => {
                    const on = access.roleIds.includes(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setAccessDraft({
                            mode: "restricted",
                            roleIds: on
                              ? access.roleIds.filter((id) => id !== r.id)
                              : [...access.roleIds, r.id],
                          })
                        }
                        className="rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition"
                        style={{
                          borderColor: r.color,
                          color: on ? "#fff" : r.color,
                          backgroundColor: on ? r.color : "transparent",
                        }}
                      >
                        {r.name}
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="mt-1.5 text-xs text-muted">{t("channelAccess.roleHint")}</p>
            </div>
          )}
          {accessDirty && (
            <button
              type="button"
              onClick={() => void handleApplyAccess()}
              disabled={accessBusy}
              className="mt-2 w-full rounded bg-brand py-2 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-60"
            >
              {accessBusy ? t("channelAccess.saving") : t("channelAccess.apply")}
            </button>
          )}
        </div>
      )}

      {active === "access" && pendingKnocks.length > 0 && (
        <div className={sectionClassName("hozzáférés access kopogtatás knock tag member várakozó")}>
          <h3 className="mb-2 text-xs font-bold uppercase text-muted">
            {t("roomSettings.knocksWaiting", { count: pendingKnocks.length })}
          </h3>
          <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto">
            {pendingKnocks.map((m) => {
              const reason = getKnockReason(m);
              const disabled = knockBusyId === m.userId;
              return (
                <div key={m.userId} className="flex items-center gap-2 rounded px-1 py-1.5">
                  <Avatar url={m.getAvatarUrl(client.baseUrl, 28, 28, "crop", false, false)} name={m.name} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-normal">{m.name}</div>
                    {reason && <div className="truncate text-xs text-muted">{reason}</div>}
                  </div>
                  {mayApproveKnocks && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void handleApproveKnock(m.userId)}
                      title={t("roomSettings.approveKnock")}
                      aria-label={t("roomSettings.approveKnock")}
                      className="shrink-0 rounded p-1.5 text-online hover:bg-bg-modifier-hover disabled:opacity-50"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                        <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" />
                      </svg>
                    </button>
                  )}
                  {canKick(room, ownUserId, m.userId) && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void handleDenyKnock(m.userId)}
                      title={t("roomSettings.denyKnock")}
                      aria-label={t("roomSettings.denyKnock")}
                      className="shrink-0 rounded p-1.5 text-dnd hover:bg-bg-modifier-hover disabled:opacity-50"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                        <path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.3 19.7 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.29-6.3Z" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {active === "general" && (
      <div className={sectionClassName("profil profile megjelenés appearance becenév nickname avatar kép")}>
        <h3 className="mb-2 text-xs font-bold uppercase text-muted">{t("roomSettings.roomProfileTitle")}</h3>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => roomAvatarInputRef.current?.click()}
            className="rounded-full"
            title={t("roomSettings.roomAvatarTitle")}
            aria-label={t("roomSettings.roomAvatarTitle")}
          >
            <Avatar url={roomAvatarPreview} name={roomNickname || room.name || "?"} size={48} />
          </button>
          <input
            ref={roomAvatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleRoomAvatarPick}
          />
          <input
            className={modalInputClass()}
            value={roomNickname}
            onChange={(e) => setRoomNicknameInput(e.target.value)}
            placeholder={t("roomSettings.roomNicknamePlaceholder")}
            aria-label={t("roomSettings.roomNicknamePlaceholder")}
          />
        </div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={profileBusy}
            aria-live="polite"
            onClick={() => void handleSaveRoomProfile()}
            className="flex-1 rounded bg-brand py-1.5 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-60"
          >
            {profileSaved ? t("common.saved") : profileBusy ? t("common.saving") : t("common.save")}
          </button>
          <button
            type="button"
            disabled={profileBusy}
            onClick={() => void handleResetRoomProfile()}
            className="rounded border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-bg-modifier-hover disabled:opacity-60"
          >
            {t("roomSettings.resetToDefault")}
          </button>
        </div>
      </div>
      )}

      {active === "sharing" && mayInvite && (
      <div className={sectionClassName("megosztás sharing meghívó invite link qr kód code", "")}>
        <div className="flex gap-2">
          <button
            type="button"
            aria-live="polite"
            onClick={() => void handleCopyInviteLink()}
            className="flex-1 rounded border border-border py-2 text-sm font-medium text-normal transition hover:bg-bg-modifier-hover"
          >
            {linkCopied ? t("roomSettings.inviteLinkCopied") : t("roomSettings.inviteLinkCopy")}
          </button>
          <button
            type="button"
            onClick={() => setQrVisible((v) => !v)}
            title={t("roomSettings.qrCode")}
            aria-label={t("roomSettings.qrCode")}
            aria-expanded={qrVisible}
            className={`shrink-0 rounded border px-3 py-2 text-sm font-medium transition ${
              qrVisible ? "border-brand bg-brand/10 text-header" : "border-border text-normal hover:bg-bg-modifier-hover"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M3 3h8v8H3V3Zm2 2v4h4V5H5Zm8-2h8v8h-8V3Zm2 2v4h4V5h-4ZM3 13h8v8H3v-8Zm2 2v4h4v-4H5Zm10-2h2v2h-2v-2Zm4 0h2v2h-2v-2Zm-4 4h2v2h-2v-2Zm4 0h2v2h-2v-2Zm-2 4h2v2h-2v-2Zm4 0h2v2h-2v-2Z" />
            </svg>
          </button>
        </div>
        {qrVisible && (
          <Sensitive>
            <div className="mt-3 flex justify-center rounded bg-white p-3">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt={t("roomSettings.qrAlt")} width={180} height={180} />
              ) : (
                <div className="flex h-[180px] w-[180px] items-center justify-center text-xs text-muted">
                  {t("roomSettings.generating")}
                </div>
              )}
            </div>
          </Sensitive>
        )}
      </div>
      )}

      {active === "sharing" && mayPublishToDirectory && (
        <div className={sectionClassName("megosztás sharing nyilvános public könyvtár directory cím alias")}>
          <h3 className="mb-1 text-xs font-bold uppercase text-muted">{t("roomSettings.directoryTitle")}</h3>
          <p className="mb-2 text-xs text-muted">{t("roomSettings.directoryHint")}</p>
          {currentAlias ? (
            <p className="mb-2 text-xs text-normal">
              {t("roomSettings.aliasLabel")} <span className="font-mono">{currentAlias}</span>
            </p>
          ) : (
            <div className="mb-2 flex gap-2">
              <div className="flex flex-1 items-center rounded bg-bg-darkest px-3 text-sm text-muted">
                <span className="shrink-0">#</span>
                <input
                  value={aliasLocalpart}
                  onChange={(e) => setAliasLocalpart(e.target.value)}
                  placeholder={t("roomSettings.aliasLocalpartPlaceholder")}
                  aria-label={t("roomSettings.aliasLocalpartPlaceholder")}
                  className="min-w-0 flex-1 bg-transparent py-2 text-normal outline-none"
                />
                <span className="shrink-0 truncate text-muted">:{client.getDomain()}</span>
              </div>
              <button
                type="button"
                disabled={aliasBusy || !aliasLocalpart.trim()}
                onClick={() => void handleSetAlias()}
                className="shrink-0 rounded bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
              >
                {t("roomSettings.setAlias")}
              </button>
            </div>
          )}
          <label className="flex items-center justify-between gap-3 text-sm text-normal">
            <span>{t("roomSettings.listInDirectory")}</span>
            <input
              type="checkbox"
              checked={listedInDirectory ?? false}
              disabled={directoryBusy || listedInDirectory === null}
              onChange={(e) => void handleDirectoryToggle(e.target.checked)}
              className="h-4 w-4 shrink-0"
            />
          </label>
        </div>
      )}

      {active === "moderation" && (
      <div className={sectionClassName("moderáció moderation napló audit log", "mt-6 border-t border-border pt-4")}>
        <button
          type="button"
          onClick={() => openModal({ type: "auditLog", roomId })}
          className="w-full rounded border border-border py-2 text-sm font-medium text-normal transition hover:bg-bg-modifier-hover"
        >
          {t("roomSettings.viewAuditLog")}
        </button>
      </div>
      )}

      {active === "advanced" && mayUpgrade && (
        <div
          id="room-settings-section-upgrade"
          className={sectionClassName("speciális advanced verzió version frissítés upgrade", "mt-4 border-t border-border pt-4")}
        >
          <h3 className="mb-1 text-xs font-bold uppercase text-muted">{t("roomUpgrade.title")}</h3>
          <p className="text-xs text-muted">
            {t("roomUpgrade.current", { version: currentRoomVersion })}
          </p>
          {upgradeAvailable ? (
            <>
              {recommendedVersion && (
                <p className="mt-0.5 text-xs text-muted">
                  {t("roomUpgrade.recommended", { version: recommendedVersion })}
                </p>
              )}
              <label className="mt-2 block text-xs font-bold uppercase text-muted">
                {t("roomUpgrade.selectVersion")}
              </label>
              <select
                value={selectedVersion ?? ""}
                onChange={(e) => setSelectedVersion(e.target.value)}
                className={modalInputClass() + " mt-1"}
              >
                {versionOptions
                  .filter((v) => v.version !== currentRoomVersion)
                  .map((v) => (
                    <option key={v.version} value={v.version}>
                      {v.version}
                      {v.version === recommendedVersion ? ` (${t("roomUpgrade.recommendedTag")})` : ""}
                      {!v.stable ? ` (${t("roomUpgrade.unstableTag")})` : ""}
                    </option>
                  ))}
              </select>
              <p className="mt-2 rounded bg-dnd/10 px-3 py-2 text-xs text-dnd">
                {t("roomUpgrade.warning")}
              </p>
              <label className="mt-2 flex items-start gap-2 text-xs text-normal">
                <input
                  type="checkbox"
                  checked={upgradeAcknowledged}
                  onChange={(e) => setUpgradeAcknowledged(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                {t("roomUpgrade.understand")}
              </label>
              <button
                type="button"
                onClick={() => void handleUpgrade()}
                disabled={!selectedVersion || !upgradeAcknowledged || upgradeBusy}
                className="mt-2 w-full rounded border border-dnd py-2 text-sm font-medium text-dnd transition hover:bg-dnd/10 disabled:opacity-50"
              >
                {upgradeBusy
                  ? t("roomUpgrade.upgrading")
                  : t("roomUpgrade.action", { version: selectedVersion ?? "" })}
              </button>
            </>
          ) : (
            <p className="mt-0.5 text-xs text-muted">{t("roomUpgrade.upToDate")}</p>
          )}
        </div>
      )}

      {active === "advanced" && (
      <div className={`flex flex-col gap-2 ${mayUpgrade ? "mt-6 border-t border-border pt-4" : ""}`}>
        <button
          type="button"
          onClick={() => void handleReportRoom()}
          disabled={busy}
          className="w-full rounded border border-border py-2 text-sm font-medium text-normal transition hover:bg-bg-modifier-hover disabled:opacity-60"
        >
          {t("roomSettings.reportRoom")}
        </button>
        <button
          type="button"
          onClick={() => void handleLeave()}
          disabled={busy}
          className="w-full rounded border border-dnd py-2 text-sm font-medium text-dnd transition hover:bg-dnd/10 disabled:opacity-60"
        >
          {t("roomSettings.leaveRoom")}
        </button>
      </div>
      )}
        </>
      )}
    </SettingsModalShell>
  );
}
