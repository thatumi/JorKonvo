import {
  addNotificationKeyword,
  clearAvatarDecoration,
  clearBanner,
  fetchNotificationKeywords,
  type FriendRequestPolicy,
  getAvatarDecoration,
  getBanner,
  getBio,
  getFriendRequestPolicy,
  getGlobalUnreadSummary,
  setFriendRequestPolicy,
  getIgnoredUserIds,
  getProfileAccent,
  removeNotificationKeyword,
  setAvatarDecoration,
  setAvatarImage,
  setBannerImage,
  setBio,
  setDisplayName,
  setProfileAccent,
  setActivity,
  setStatusMessage,
  setUserIgnored,
} from "@jorkonvo/matrix-core";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Avatar } from "../Avatar";
import { Sensitive } from "../Sensitive";
import { useAuthedMedia } from "../../lib/authedMedia";
import { invalidateProfileFlair } from "../../lib/profileFlair";
import { getReminderLeadMs, REMINDER_LEAD_PRESETS, setReminderLeadMs } from "../../lib/calendarReminders";
import { getTenorApiKey, setTenorApiKey } from "../../lib/gifSearch";
import { isAutoAwayEnabled, setAutoAwayEnabled } from "../../lib/idlePresence";
import {
  getNotificationSound,
  getNotificationVolume,
  NOTIFICATION_SOUNDS,
  type NotificationSoundId,
  previewNotificationSound,
  setNotificationSound,
  setNotificationVolume,
} from "../../lib/notificationSound";
import { isPrivateReadReceiptsEnabled, setPrivateReadReceiptsEnabled } from "../../lib/readReceiptPrivacy";
import {
  getMicVolume,
  getPreferredCameraId,
  getPreferredMicId,
  getPreferredSpeakerId,
  getSpeakerVolume,
  setMicVolume,
  setPreferredCameraId,
  setPreferredMicId,
  setPreferredSpeakerId,
  setSpeakerVolume,
} from "../../lib/mediaDevicePrefs";
import { DeviceSelect } from "../DeviceSelect";
import { MicTest } from "../MicTest";
import { CameraPreview } from "../CameraPreview";
import { GpuSettingsSection } from "../GpuSettingsSection";
import { reapplyAllUserCallPrefs, setMicVolumeLive, switchActiveSpeaker, useGroupCallStore } from "../../state/groupCallStore";
import {
  CALL_SOUND_KINDS,
  getCallSoundsVolume,
  isCallSoundKindEnabled,
  isCallSoundsEnabled,
  previewCallSound,
  setCallSoundKindEnabled,
  setCallSoundsEnabled,
  setCallSoundsVolume,
} from "../../lib/callSounds";
import { isActivitySharingEnabled, setActivitySharingEnabled } from "../../lib/activityPrivacy";
import { applyBadgeCount, isUnreadBadgeEnabled, setUnreadBadgeEnabled } from "../../lib/desktopBadge";
import { getReactionNotifyMode, type ReactionNotifyMode, setReactionNotifyMode } from "../../lib/reactionNotifyPrefs";
import { getLinkPreviewMode, setLinkPreviewMode, type LinkPreviewMode } from "../../lib/linkPreviewPrefs";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { useNoiseSuppressionStore } from "../../state/noiseSuppressionStore";
import { useProfileStore } from "../../state/profileStore";
import { describeKeyCode, usePushToTalkStore } from "../../state/pushToTalkStore";
import {
  ACCENTS,
  CORNERS,
  SURFACES,
  THEME_OPTIONS,
  THEME_PRESETS,
  useThemeStore,
} from "../../state/themeStore";
import { LOCALE_NAMES, useTranslation } from "../../i18n";
import { fileToWallpaperDataUrl, useChatWallpaperStore } from "../../lib/chatWallpaper";
import { useCustomCssStore } from "../../lib/customCss";
import { useDisplayPrefsStore } from "../../lib/displayPrefs";
import { useStreamerModeStore } from "../../lib/streamerMode";
import { isNativePlatform } from "../../lib/platform";
import { ChangePasswordSection } from "./ChangePasswordSection";
import { KeybindsSection } from "./KeybindsSection";
import { isEmoticonToEmojiEnabled, setEmoticonToEmojiEnabled } from "../../lib/emoticons";
import { getSpoilerMode, setSpoilerMode, type SpoilerMode } from "../../lib/spoilerPrefs";
import { AccountDataSection } from "./AccountDataSection";
import { DeviceManagementSection } from "./DeviceManagementSection";
import { AccessibilityPreview } from "../AccessibilityPreview";
import { EmojiPackManager } from "../EmojiPackManager";
import { PushToggle } from "../PushToggle";
import { SettingsBackupSection } from "./SettingsBackupSection";
import { ThreePidSection } from "./ThreePidSection";
import { ModalField, modalInputClass, ModalPrimaryButton } from "../Modal";
import { type SettingsPane, SettingsModalShell } from "./SettingsModalShell";

/**
 * Full user settings modal: profile editing (avatar/banner/decoration/accent),
 * appearance, accessibility, keybinds, notifications, privacy, call and
 * account sections, laid out by the shared SettingsModalShell's category rail.
 * Every pane reads and writes its own persisted preferences directly.
 */
export function UserSettingsModal() {
  const { t, locale, setLocale } = useTranslation();
  const density = useDisplayPrefsStore((s) => s.density);
  const setDensity = useDisplayPrefsStore((s) => s.setDensity);
  const wallpaper = useChatWallpaperStore((s) => s.wallpaper);
  const setWallpaper = useChatWallpaperStore((s) => s.setWallpaper);
  const setWallpaperDim = useChatWallpaperStore((s) => s.setDim);
  const clearWallpaper = useChatWallpaperStore((s) => s.clear);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const developerMode = useDisplayPrefsStore((s) => s.developerMode);
  const setDeveloperMode = useDisplayPrefsStore((s) => s.setDeveloperMode);
  const streamerMode = useStreamerModeStore((s) => s.enabled);
  const setStreamerMode = useStreamerModeStore((s) => s.setEnabled);
  const fontScale = useDisplayPrefsStore((s) => s.fontScale);
  const setFontScale = useDisplayPrefsStore((s) => s.setFontScale);
  const reducedMotion = useDisplayPrefsStore((s) => s.reducedMotion);
  const setReducedMotion = useDisplayPrefsStore((s) => s.setReducedMotion);
  const timeFormat = useDisplayPrefsStore((s) => s.timeFormat);
  const setTimeFormat = useDisplayPrefsStore((s) => s.setTimeFormat);
  const lineHeightScale = useDisplayPrefsStore((s) => s.lineHeightScale);
  const setLineHeightScale = useDisplayPrefsStore((s) => s.setLineHeightScale);
  const highContrast = useDisplayPrefsStore((s) => s.highContrast);
  const setHighContrast = useDisplayPrefsStore((s) => s.setHighContrast);
  const underlineLinks = useDisplayPrefsStore((s) => s.underlineLinks);
  const setUnderlineLinks = useDisplayPrefsStore((s) => s.setUnderlineLinks);
  const focusOutlines = useDisplayPrefsStore((s) => s.focusOutlines);
  const setFocusOutlines = useDisplayPrefsStore((s) => s.setFocusOutlines);
  const announceMessages = useDisplayPrefsStore((s) => s.announceMessages);
  const setAnnounceMessages = useDisplayPrefsStore((s) => s.setAnnounceMessages);
  const [emoticonToEmoji, setEmoticonToEmojiState] = useState(isEmoticonToEmojiEnabled);
  const [unreadBadge, setUnreadBadge] = useState(isUnreadBadgeEnabled);
  const [reactionNotify, setReactionNotifyState] = useState<ReactionNotifyMode>(getReactionNotifyMode);
  const [shareActivity, setShareActivityState] = useState(isActivitySharingEnabled);
  const [callSoundsOn, setCallSoundsOnState] = useState(isCallSoundsEnabled);
  const [callSoundsVol, setCallSoundsVolState] = useState(getCallSoundsVolume);
  const [callSoundKinds, setCallSoundKindsState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(CALL_SOUND_KINDS.map((k) => [k.id, isCallSoundKindEnabled(k.id)])),
  );
  const [spoilerMode, setSpoilerModeState] = useState<SpoilerMode>(getSpoilerMode);
  const customCss = useCustomCssStore((s) => s.css);
  const setCustomCss = useCustomCssStore((s) => s.setCss);
  const client = useMatrixStore((s) => s.client)!;
  const bumpTick = useMatrixStore((s) => s.bumpTick);
  const close = useModalStore((s) => s.close);
  const [friendPolicy, setFriendPolicyState] = useState<FriendRequestPolicy>(() => getFriendRequestPolicy(client));

  const user = client.getUser(client.getUserId() ?? "");
  const profileStore = useProfileStore();
  // See profileStore.ts: client.getUser(...) can be contaminated by a
  // per-room nickname/avatar override set anywhere - prefer the
  // authoritative /profile fetch for what this form treats as "current".
  const globalName = profileStore.displayName ?? user?.displayName ?? "";
  const globalAvatarMxc = profileStore.avatarUrl ?? user?.avatarUrl;
  const [name, setName] = useState(globalName);
  const [statusMsg, setStatusMsg] = useState(user?.presenceStatusMsg ?? "");
  const [bio, setBioValue] = useState("");
  const [initialBio, setInitialBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    globalAvatarMxc ? client.mxcUrlToHttp(globalAvatarMxc, 80, 80, "crop") : null,
  );
  const avatarFileRef = useRef<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bannerMxc, setBannerMxc] = useState<string | null>(null);
  const [bannerLocalPreview, setBannerLocalPreview] = useState<string | null>(null);
  const [bannerRemoved, setBannerRemoved] = useState(false);
  const [decorationMxc, setDecorationMxc] = useState<string | null>(null);
  const [decorationLocalPreview, setDecorationLocalPreview] = useState<string | null>(null);
  const [decorationRemoved, setDecorationRemoved] = useState(false);
  const decorationFileRef = useRef<File | null>(null);
  const decorationInputRef = useRef<HTMLInputElement>(null);
  const [profileAccent, setProfileAccentState] = useState<string>("");
  const bannerFileRef = useRef<File | null>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const resolvedBannerUrl = useAuthedMedia(bannerRemoved ? null : bannerMxc, {
    width: 600,
    height: 240,
    method: "scale",
    animated: true,
  });
  const bannerPreview = bannerLocalPreview ?? resolvedBannerUrl;
  const resolvedDecoration = useAuthedMedia(decorationRemoved ? null : decorationMxc, { width: 96, height: 96, method: "scale", animated: true });
  const decorationPreview = decorationLocalPreview ?? resolvedDecoration;
  const themePreference = useThemeStore((s) => s.preference);
  const setThemePreference = useThemeStore((s) => s.setPreference);
  const accent = useThemeStore((s) => s.accent);
  const setAccent = useThemeStore((s) => s.setAccent);
  const surface = useThemeStore((s) => s.surface);
  const setSurface = useThemeStore((s) => s.setSurface);
  const corners = useThemeStore((s) => s.corners);
  const setCorners = useThemeStore((s) => s.setCorners);
  const applyPreset = useThemeStore((s) => s.applyPreset);
  const effectiveThemeForPreset = useThemeStore((s) => s.effective);
  const accentSwatch = (a: string) => ACCENTS.find((x) => x.value === a)?.swatch ?? "#888";
  const surfaceSwatch = (s: string) => SURFACES.find((x) => x.value === s)?.swatch ?? "#222";
  const noiseSuppressionEnabled = useNoiseSuppressionStore((s) => s.enabled);
  const setNoiseSuppressionEnabled = useNoiseSuppressionStore((s) => s.setEnabled);
  const pttEnabled = usePushToTalkStore((s) => s.enabled);
  const setPttEnabled = usePushToTalkStore((s) => s.setEnabled);
  const [preferredMicId, setPreferredMicIdState] = useState(getPreferredMicId);
  const [preferredCameraId, setPreferredCameraIdState] = useState(getPreferredCameraId);
  const [preferredSpeakerId, setPreferredSpeakerIdState] = useState(getPreferredSpeakerId);
  const [micVolume, setMicVolumeState] = useState(getMicVolume);
  const [speakerVolume, setSpeakerVolumeState] = useState(getSpeakerVolume);
  const refreshMicPipeline = useGroupCallStore((s) => s.refreshMicPipeline);
  const pttCode = usePushToTalkStore((s) => s.code);
  const setPttCode = usePushToTalkStore((s) => s.setCode);
  const [capturingKey, setCapturingKey] = useState(false);
  const [ignoredUsers, setIgnoredUsers] = useState<string[]>(() => getIgnoredUserIds(client));
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [keywordBusy, setKeywordBusy] = useState(false);
  const [autoAway, setAutoAway] = useState(isAutoAwayEnabled);
  const [privateReceipts, setPrivateReceipts] = useState(isPrivateReadReceiptsEnabled);
  const [linkPreviewMode, setLinkPreviewModeState] = useState<LinkPreviewMode>(getLinkPreviewMode);
  const [notifSound, setNotifSound] = useState<NotificationSoundId>(getNotificationSound);
  const [notifVolume, setNotifVolume] = useState(getNotificationVolume);
  const [reminderLeadMs, setReminderLeadMsState] = useState(getReminderLeadMs);
  const [tenorKeyInput, setTenorKeyInput] = useState(getTenorApiKey() ?? "");
  const [tenorKeySaved, setTenorKeySaved] = useState(false);

  /** Thin wrapper kept so the many section divs need no churn; the shell now owns search + nav. */
  const sectionClassName = (_keywords: string, visibleClass = "mt-6 border-t border-border pt-4"): string =>
    visibleClass;

  useEffect(() => {
    void fetchNotificationKeywords(client).then(setKeywords).catch(() => setKeywords([]));
  }, [client]);

  useEffect(() => {
    const userId = client.getUserId();
    if (!userId) return;
    void getBio(client, userId).then((value) => {
      setBioValue(value ?? "");
      setInitialBio(value ?? "");
    });
    void getBanner(client, userId).then(setBannerMxc);
    void getAvatarDecoration(client, userId).then(setDecorationMxc);
    void getProfileAccent(client, userId).then((a: string | null) => setProfileAccentState(a ?? ""));
  }, [client]);

  async function handleAddKeyword() {
    const word = newKeyword.trim();
    if (!word || keywordBusy) return;
    setKeywordBusy(true);
    try {
      await addNotificationKeyword(client, word);
      setKeywords(await fetchNotificationKeywords(client));
      setNewKeyword("");
    } catch (err) {
      console.error("failed to add keyword", err);
    } finally {
      setKeywordBusy(false);
    }
  }

  async function handleRemoveKeyword(word: string) {
    if (keywordBusy) return;
    setKeywordBusy(true);
    try {
      await removeNotificationKeyword(client, word);
      setKeywords((prev) => prev.filter((k) => k !== word));
    } catch (err) {
      console.error("failed to remove keyword", err);
    } finally {
      setKeywordBusy(false);
    }
  }

  useEffect(() => {
    if (!capturingKey) return;
    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      setPttCode(e.code);
      setCapturingKey(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [capturingKey, setPttCode]);

  async function handleUnignore(userId: string) {
    await setUserIgnored(client, userId, false);
    setIgnoredUsers((prev) => prev.filter((id) => id !== userId));
  }

  function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    avatarFileRef.current = file;
    setAvatarPreview(URL.createObjectURL(file));
  }

  function handleBannerPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    bannerFileRef.current = file;
    setBannerRemoved(false);
    setBannerLocalPreview(URL.createObjectURL(file));
  }

  function handleBannerRemove() {
    bannerFileRef.current = null;
    setBannerRemoved(true);
    setBannerLocalPreview(null);
  }

  function handleDecorationPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    decorationFileRef.current = file;
    setDecorationRemoved(false);
    setDecorationLocalPreview(URL.createObjectURL(file));
  }

  function handleDecorationRemove() {
    decorationFileRef.current = null;
    setDecorationRemoved(true);
    setDecorationLocalPreview(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (avatarFileRef.current) {
        await setAvatarImage(client, avatarFileRef.current);
      }
      if (bannerFileRef.current) {
        await setBannerImage(client, bannerFileRef.current);
      } else if (bannerRemoved) {
        await clearBanner(client);
      }
      if (decorationFileRef.current) {
        await setAvatarDecoration(client, decorationFileRef.current);
      } else if (decorationRemoved) {
        await clearAvatarDecoration(client);
      }
      await setProfileAccent(client, profileAccent || null);
      invalidateProfileFlair(client.getUserId() ?? "");
      if (name.trim() && name.trim() !== globalName) {
        await setDisplayName(client, name.trim());
      }
      if (statusMsg.trim() !== (user?.presenceStatusMsg ?? "")) {
        await setStatusMessage(client, statusMsg.trim());
      }
      if (bio.trim() !== initialBio.trim()) {
        await setBio(client, bio.trim());
        setInitialBio(bio.trim());
      }
      await useProfileStore.getState().refresh(client);
      bumpTick();
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const panes: SettingsPane[] = [
    {
      id: "profile",
      label: t("settings.catProfile"),
      keywords: "profil profile név name status státusz bio avatar kép banner dekoráció decoration accent szín",
      render: () => (
        <form onSubmit={handleSave}>
        <div className="-mx-4 -mt-5 sm:-mx-6">
          <button
            type="button"
            onClick={() => bannerInputRef.current?.click()}
            title={t("settings.editProfileBanner")}
            className="flex h-24 w-full items-center justify-center bg-brand/30 bg-cover bg-center text-xs text-white/70 hover:brightness-95"
            style={bannerPreview ? { backgroundImage: `url(${bannerPreview})` } : undefined}
          >
            {!bannerPreview && t("settings.addBanner")}
          </button>
          <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerPick} />
          {bannerPreview && (
            <div className="flex justify-end px-4 pt-1 sm:px-6">
              <button
                type="button"
                onClick={handleBannerRemove}
                className="text-xs font-medium text-link hover:underline"
              >
                {t("settings.removeBanner")}
              </button>
            </div>
          )}
        </div>
        <div className="mb-4 -mt-8 flex items-end gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full ring-4 ring-bg-primary"
            title={t("settings.changeAvatar")}
            aria-label={t("settings.changeAvatar")}
          >
            <Avatar url={avatarPreview} name={name || "?"} size={64} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarPick}
          />
          <div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-sm font-medium text-link hover:underline"
            >
              {t("settings.changeAvatar")}
            </button>
            <p className="text-xs text-muted">
              <Sensitive>{client.getUserId()}</Sensitive>
            </p>
          </div>
        </div>

        <ModalField label={t("settings.displayName")}>
          <input className={modalInputClass()} value={name} onChange={(e) => setName(e.target.value)} />
        </ModalField>

        <ModalField label={t("settings.statusMessage")}>
          <input
            className={modalInputClass()}
            value={statusMsg}
            onChange={(e) => setStatusMsg(e.target.value)}
            placeholder={t("settings.statusPlaceholder")}
            maxLength={100}
          />
        </ModalField>

        <ModalField label={t("settings.bio")}>
          <textarea
            className={`${modalInputClass()} min-h-[80px] resize-y`}
            value={bio}
            onChange={(e) => setBioValue(e.target.value)}
            placeholder={t("settings.bioPlaceholder")}
            maxLength={1000}
          />
          <p className="mt-1 text-[11px] text-muted">{t("settings.bioHint", { count: bio.length })}</p>
        </ModalField>

        <ModalField label={t("settings.avatarDecoration")}>
          <div className="mt-1 flex items-center gap-3">
            <div className="relative h-16 w-16 shrink-0">
              <Avatar url={avatarPreview} name={name || "?"} size={64} />
              {!decorationRemoved && decorationPreview && (
                <img
                  src={decorationPreview}
                  alt=""
                  aria-hidden
                  className="pointer-events-none absolute left-1/2 top-1/2 h-[86px] w-[86px] max-w-none -translate-x-1/2 -translate-y-1/2"
                />
              )}
            </div>
            <div className="flex flex-col gap-1">
              <input ref={decorationInputRef} type="file" accept="image/png,image/webp,image/apng,image/gif" className="hidden" onChange={handleDecorationPick} />
              <button type="button" onClick={() => decorationInputRef.current?.click()} className="rounded border border-border px-2.5 py-1 text-xs font-medium text-normal hover:bg-bg-modifier-hover">
                {t("settings.avatarDecorationPick")}
              </button>
              {(decorationPreview && !decorationRemoved) && (
                <button type="button" onClick={handleDecorationRemove} className="text-left text-[11px] text-muted hover:text-dnd">
                  {t("settings.avatarDecorationRemove")}
                </button>
              )}
            </div>
          </div>
          <p className="mt-1 text-[11px] text-muted">{t("settings.avatarDecorationHint")}</p>
        </ModalField>

        <ModalField label={t("settings.profileAccent")}>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="color"
              value={profileAccent || "#5865f2"}
              onChange={(e) => setProfileAccentState(e.target.value)}
              className="h-9 w-14 shrink-0 cursor-pointer rounded border border-border bg-transparent"
            />
            {profileAccent && (
              <button type="button" onClick={() => setProfileAccentState("")} className="text-xs font-medium text-link hover:underline">
                {t("settings.profileAccentClear")}
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted">{t("settings.profileAccentHint")}</p>
        </ModalField>

        {error && <p className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
        <ModalPrimaryButton type="submit" disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </ModalPrimaryButton>
        </form>
      ),
    },
    {
      id: "emoji",
      label: t("settings.catPersonalEmoji"),
      keywords: "emoji egyéni saját custom personal matrica sticker",
      render: () => (
        <>
          <EmojiPackManager scope="personal" />
          <p className="mt-3 text-xs text-muted">{t("emojiPack.personalScopeHint")}</p>
        </>
      ),
    },
    {
      id: "language",
      label: t("settings.catLanguage"),
      keywords: "nyelv language hu en magyar angol idő time óra clock 12 24 formátum format",
      render: () => (
        <div className="flex flex-col gap-5">
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase text-muted">{t("settings.language")}</h3>
            <div className="flex gap-2">
              {(["hu", "en"] as const).map((loc) => (
                <button
                  key={loc}
                  type="button"
                  data-testid={`settings-locale-${loc}`}
                  aria-pressed={locale === loc}
                  onClick={() => setLocale(loc)}
                  className={`flex-1 rounded border py-2 text-sm font-medium transition ${
                    locale === loc
                      ? "border-brand bg-brand/10 text-header"
                      : "border-border text-muted hover:text-normal"
                  }`}
                >
                  {LOCALE_NAMES[loc]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase text-muted">{t("settings.timeFormat")}</h3>
            <div className="flex gap-2">
              {(["auto", "12h", "24h"] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  data-testid={`settings-timeformat-${fmt}`}
                  aria-pressed={timeFormat === fmt}
                  onClick={() => setTimeFormat(fmt)}
                  className={`flex-1 rounded border py-2 text-sm font-medium transition ${
                    timeFormat === fmt
                      ? "border-brand bg-brand/10 text-header"
                      : "border-border text-muted hover:text-normal"
                  }`}
                >
                  {t(`settings.timeFormat.${fmt}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "appearance",
      label: t("settings.catAppearance"),
      keywords:
        "téma theme dark light system sötét világos megjelenés appearance preset szín accent felület surface lekerekítés corners sűrűség density betűméret font háttérkép wallpaper css egyéni fejlesztői developer",
      render: () => (
        <>
        <div>
        <h3 className="mb-2 text-xs font-bold uppercase text-muted">{t("settings.theme")}</h3>
        <div className="flex gap-2">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setThemePreference(opt.value)}
              className={`flex-1 rounded border py-2 text-sm font-medium transition ${
                themePreference === opt.value
                  ? "border-brand bg-brand/10 text-header"
                  : "border-border text-muted hover:text-normal"
              }`}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div
        className={sectionClassName(
          "megjelenés appearance preset szín accent felület surface lekerekítés corners sűrűség density betűméret font háttérkép wallpaper css egyéni fejlesztői developer",
        )}
      >
        <h3 className="mb-2 text-xs font-bold uppercase text-muted">{t("settings.appearance")}</h3>

        <span className="mb-1.5 block text-xs font-bold uppercase text-muted">{t("settings.preset")}</span>
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {THEME_PRESETS.map((p) => {
            const active = p.theme === effectiveThemeForPreset && p.accent === accent && p.surface === surface;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className={`flex flex-col gap-1.5 rounded-lg border p-2 text-left transition ${
                  active ? "border-brand ring-1 ring-brand" : "border-border hover:border-muted"
                }`}
              >
                <span
                  className="flex h-8 items-center gap-1 rounded px-1.5"
                  style={{ backgroundColor: surfaceSwatch(p.surface) }}
                >
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: accentSwatch(p.accent) }} />
                  <span
                    className="h-1.5 flex-1 rounded-full"
                    style={{ backgroundColor: p.theme === "light" ? "#00000022" : "#ffffff22" }}
                  />
                </span>
                <span className="truncate text-[11px] font-medium text-normal">
                  {t(`settings.preset${p.id[0].toUpperCase()}${p.id.slice(1)}`)}
                </span>
              </button>
            );
          })}
        </div>

        <span className="mb-1.5 block text-xs font-bold uppercase text-muted">{t("settings.accent")}</span>
        <div className="mb-3 flex flex-wrap gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a.value}
              type="button"
              title={t(`settings.accent${a.value[0].toUpperCase()}${a.value.slice(1)}`)}
              aria-label={t(`settings.accent${a.value[0].toUpperCase()}${a.value.slice(1)}`)}
              onClick={() => setAccent(a.value)}
              className={`h-7 w-7 rounded-full ring-offset-2 ring-offset-bg-secondary transition ${
                accent === a.value ? "ring-2 ring-header" : "ring-1 ring-border hover:ring-muted"
              }`}
              style={{ backgroundColor: a.swatch }}
            />
          ))}
        </div>

        <span className="mb-1.5 block text-xs font-bold uppercase text-muted">{t("settings.surface")}</span>
        <div className="mb-4 flex flex-wrap gap-2">
          {SURFACES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setSurface(s.value)}
              className={`flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs font-medium transition ${
                surface === s.value
                  ? "border-brand bg-brand/10 text-header"
                  : "border-border text-muted hover:text-normal"
              }`}
            >
              <span
                className="h-4 w-4 rounded-full ring-1 ring-white/10"
                style={{ backgroundColor: s.swatch }}
              />
              {t(`settings.surface${s.value[0].toUpperCase()}${s.value.slice(1)}`)}
            </button>
          ))}
        </div>

        <span className="mb-1.5 block text-xs font-bold uppercase text-muted">{t("settings.corners")}</span>
        <div className="mb-3 flex gap-1.5">
          {CORNERS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCorners(c)}
              className={`flex-1 rounded border py-1.5 text-xs font-medium transition ${
                corners === c
                  ? "border-brand bg-brand/10 text-header"
                  : "border-border text-muted hover:text-normal"
              }`}
            >
              {t(`settings.corners${c[0].toUpperCase()}${c.slice(1)}`)}
            </button>
          ))}
        </div>

        <p className="mt-2 text-xs text-muted">{t("settings.densityMovedHint")}</p>

        <label className="mt-3 flex items-center justify-between gap-3 py-1.5 text-sm text-normal">
          <span>
            {t("settings.emoticonToEmoji")}
            <span className="block text-xs font-normal text-muted">{t("settings.emoticonToEmojiHint")}</span>
          </span>
          <input
            type="checkbox"
            checked={emoticonToEmoji}
            onChange={(e) => {
              setEmoticonToEmojiEnabled(e.target.checked);
              setEmoticonToEmojiState(e.target.checked);
            }}
            className="h-4 w-4 shrink-0"
          />
        </label>

        <label className="mt-3 flex items-center justify-between gap-3 py-1.5 text-sm text-normal">
          <span>
            {t("settings.spoilerMode")}
            <span className="block text-xs font-normal text-muted">{t("settings.spoilerModeHint")}</span>
          </span>
          <select
            value={spoilerMode}
            onChange={(e) => {
              const v = e.target.value as SpoilerMode;
              setSpoilerMode(v);
              setSpoilerModeState(v);
            }}
            className="shrink-0 rounded bg-bg-darkest px-2 py-1 text-xs text-normal"
          >
            <option value="click">{t("settings.spoilerModeClick")}</option>
            <option value="show">{t("settings.spoilerModeShow")}</option>
            <option value="hide">{t("settings.spoilerModeHide")}</option>
          </select>
        </label>

        <label className="mt-3 flex items-center justify-between gap-3 py-1.5 text-sm text-normal">
          <span>
            {t("settings.developerMode")}
            <span className="block text-xs font-normal text-muted">{t("settings.developerModeHint")}</span>
          </span>
          <input
            type="checkbox"
            checked={developerMode}
            onChange={(e) => setDeveloperMode(e.target.checked)}
            className="h-4 w-4 shrink-0"
          />
        </label>

        <label className="mt-3 flex items-center justify-between gap-3 py-1.5 text-sm text-normal">
          <span>
            {t("settings.streamerMode")}
            <span className="block text-xs font-normal text-muted">{t("settings.streamerModeHint")}</span>
          </span>
          <input
            type="checkbox"
            checked={streamerMode}
            onChange={(e) => setStreamerMode(e.target.checked)}
            className="h-4 w-4 shrink-0"
          />
        </label>

        <div className="mt-3">
          <span className="mb-1.5 block text-xs font-bold uppercase text-muted">{t("settings.wallpaper")}</span>
          <div className="flex items-center gap-2">
            <input
              ref={wallpaperInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void fileToWallpaperDataUrl(file).then(setWallpaper);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => wallpaperInputRef.current?.click()}
              className="rounded border border-border px-3 py-1.5 text-xs font-medium text-normal transition hover:bg-bg-modifier-hover"
            >
              {t("settings.wallpaperChoose")}
            </button>
            {wallpaper && (
              <button
                type="button"
                onClick={clearWallpaper}
                className="rounded border border-dnd px-3 py-1.5 text-xs font-medium text-dnd transition hover:bg-dnd/10"
              >
                {t("settings.wallpaperRemove")}
              </button>
            )}
          </div>
          {wallpaper && (
            <label className="mt-2 block text-xs font-bold uppercase text-muted">
              {t("settings.wallpaperDim", { value: Math.round(wallpaper.dim * 100) })}
              <input
                type="range"
                min={20}
                max={95}
                step={5}
                value={Math.round(wallpaper.dim * 100)}
                onChange={(e) => setWallpaperDim(Number(e.target.value) / 100)}
                className="mt-1 w-full"
              />
            </label>
          )}
        </div>

        <div className="mt-3">
          <span className="mb-1 block text-xs font-bold uppercase text-muted">{t("settings.customCss")}</span>
          <p className="mb-1.5 text-xs text-muted">{t("settings.customCssHint")}</p>
          <textarea
            value={customCss}
            onChange={(e) => setCustomCss(e.target.value)}
            spellCheck={false}
            placeholder={"/* pl. */\n.jk-msg-group:hover { background: #8b5cf622; }"}
            aria-label={t("settings.customCss")}
            className={`${modalInputClass()} min-h-[120px] resize-y font-mono text-xs`}
          />
        </div>
      </div>
        </>
      ),
    },
    {
      id: "accessibility",
      label: t("settings.catAccessibility"),
      keywords:
        "akadálymentesség accessibility mozgás motion animáció animation sűrűség density betűméret font readability olvashatóság kontraszt contrast szín color vak blind aláhúzás underline felolvasó screen reader fókusz focus",
      render: () => (
        <div className={sectionClassName("akadálymentesség accessibility mozgás motion sűrűség density betűméret font", "")}>
          <h3 className="mb-2 text-xs font-bold uppercase text-muted">{t("settings.catAccessibility")}</h3>

          <AccessibilityPreview />

          <h4 className="mb-1.5 mt-4 text-xs font-bold uppercase text-muted">{t("settings.a11yTextReadability")}</h4>
          <label className="block text-xs font-bold uppercase text-muted">
            {t("settings.fontScale", { value: Math.round(fontScale * 100) })}
            <input
              type="range"
              min={80}
              max={140}
              step={5}
              value={Math.round(fontScale * 100)}
              onChange={(e) => setFontScale(Number(e.target.value) / 100)}
              className="mt-1 w-full"
            />
          </label>
          <label className="mt-3 block text-xs font-bold uppercase text-muted">
            {t("settings.lineHeightScale", { value: Math.round(lineHeightScale * 100) })}
            <input
              type="range"
              min={100}
              max={160}
              step={5}
              value={Math.round(lineHeightScale * 100)}
              onChange={(e) => setLineHeightScale(Number(e.target.value) / 100)}
              className="mt-1 w-full"
            />
          </label>
          <label className="mt-3 flex items-center justify-between gap-3 py-1.5 text-sm text-normal">
            <span>
              {t("settings.underlineLinks")}
              <span className="block text-xs font-normal text-muted">{t("settings.underlineLinksHint")}</span>
            </span>
            <input
              type="checkbox"
              checked={underlineLinks}
              onChange={(e) => setUnderlineLinks(e.target.checked)}
              className="h-4 w-4 shrink-0"
            />
          </label>

          <h4 className="mb-1.5 mt-4 border-t border-border pt-3 text-xs font-bold uppercase text-muted">
            {t("settings.a11yVisualDensity")}
          </h4>
          <span className="mb-1.5 block text-xs font-bold uppercase text-muted">{t("settings.density")}</span>
          <div className="mb-1 flex gap-1.5">
            {(["compact", "cozy", "roomy"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDensity(d)}
                className={`flex-1 rounded border py-1.5 text-xs font-medium transition ${
                  density === d ? "border-brand bg-brand/10 text-header" : "border-border text-muted hover:text-normal"
                }`}
              >
                {t(`settings.density${d[0].toUpperCase()}${d.slice(1)}`)}
              </button>
            ))}
          </div>

          <h4 className="mb-1.5 mt-4 border-t border-border pt-3 text-xs font-bold uppercase text-muted">
            {t("settings.a11yColorContrast")}
          </h4>
          <label className="flex items-center justify-between gap-3 py-1.5 text-sm text-normal">
            <span>
              {t("settings.highContrast")}
              <span className="block text-xs font-normal text-muted">{t("settings.highContrastHint")}</span>
            </span>
            <input
              type="checkbox"
              checked={highContrast}
              onChange={(e) => setHighContrast(e.target.checked)}
              className="h-4 w-4 shrink-0"
            />
          </label>
          <label className="flex items-center justify-between gap-3 py-1.5 text-sm text-normal">
            <span>
              {t("settings.focusOutlines")}
              <span className="block text-xs font-normal text-muted">{t("settings.focusOutlinesHint")}</span>
            </span>
            <input
              type="checkbox"
              checked={focusOutlines}
              onChange={(e) => setFocusOutlines(e.target.checked)}
              className="h-4 w-4 shrink-0"
            />
          </label>

          <h4 className="mb-1.5 mt-4 border-t border-border pt-3 text-xs font-bold uppercase text-muted">
            {t("settings.a11yReducedMotion")}
          </h4>
          <label className="flex items-center justify-between gap-3 py-1.5 text-sm text-normal">
            <span>
              {t("settings.reducedMotion")}
              <span className="block text-xs font-normal text-muted">{t("settings.reducedMotionHint")}</span>
            </span>
            <input
              type="checkbox"
              checked={reducedMotion}
              onChange={(e) => setReducedMotion(e.target.checked)}
              className="h-4 w-4 shrink-0"
            />
          </label>

          <h4 className="mb-1.5 mt-4 border-t border-border pt-3 text-xs font-bold uppercase text-muted">
            {t("settings.a11yAudioScreenReader")}
          </h4>
          <label className="flex items-center justify-between gap-3 py-1.5 text-sm text-normal">
            <span>
              {t("settings.announceMessages")}
              <span className="block text-xs font-normal text-muted">{t("settings.announceMessagesHint")}</span>
            </span>
            <input
              type="checkbox"
              checked={announceMessages}
              onChange={(e) => setAnnounceMessages(e.target.checked)}
              className="h-4 w-4 shrink-0"
            />
          </label>
        </div>
      ),
    },
    // Keybinds are a desktop-only concept (nothing to rebind without a
    // hardware keyboard), so the whole pane - nav entry included - is
    // skipped inside the Capacitor shells instead of shipping dead UI.
    ...(isNativePlatform()
      ? []
      : [
          {
            id: "keybinds",
            label: t("settings.catKeybinds"),
            keywords: "billentyű keybind gyorsbillentyű shortcut hotkey combo némítás mute deafen",
            render: () => (
              <div className={sectionClassName("billentyű keybind gyorsbillentyű shortcut hotkey", "")}>
                <KeybindsSection />
              </div>
            ),
          },
        ]),
    {
      id: "notifications",
      label: t("settings.catNotifications"),
      keywords:
        "értesítés notification kulcsszó keyword jelenlét presence távollét away csengőhang hang sound hangerő volume naptár calendar esemény emlékeztető reminder",
      render: () => (
        <>
      <div className={sectionClassName("értesítés kulcsszó notification keyword", "")}>
        <h3 className="mb-1 text-xs font-bold uppercase text-muted">{t("settings.notificationKeywords")}</h3>
        <p className="mb-2 text-xs text-muted">{t("settings.keywordsHint")}</p>
        {keywords.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {keywords.map((word) => (
              <span
                key={word}
                className="flex items-center gap-1 rounded-full bg-bg-darkest px-2.5 py-1 text-xs text-normal"
              >
                {word}
                <button
                  type="button"
                  disabled={keywordBusy}
                  onClick={() => void handleRemoveKeyword(word)}
                  title={t("common.remove")}
                  aria-label={t("common.remove")}
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
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleAddKeyword();
              }
            }}
            placeholder={t("settings.keywordPlaceholder")}
            aria-label={t("settings.keywordPlaceholder")}
          />
          <button
            type="button"
            disabled={keywordBusy || !newKeyword.trim()}
            onClick={() => void handleAddKeyword()}
            className="shrink-0 rounded bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
          >
            {t("common.add")}
          </button>
        </div>
      </div>

      <PushToggle />

      <div className={sectionClassName("jelenlét presence távollét away automatikus")}>
        <h3 className="mb-2 text-xs font-bold uppercase text-muted">{t("settings.presence")}</h3>
        <label className="flex items-center justify-between gap-3 text-sm text-normal">
          <span>
            {t("settings.autoAway")}
            <span className="block text-xs font-normal text-muted">{t("settings.autoAwayHint")}</span>
          </span>
          <input
            type="checkbox"
            checked={autoAway}
            onChange={(e) => {
              setAutoAway(e.target.checked);
              setAutoAwayEnabled(e.target.checked);
            }}
            className="h-4 w-4 shrink-0"
          />
        </label>
      </div>

      <div className={sectionClassName("jelvény badge olvasatlan unread ikon icon dock tálca taskbar")}>
        <h3 className="mb-2 text-xs font-bold uppercase text-muted">{t("settings.badges")}</h3>
        <label className="flex items-center justify-between gap-3 text-sm text-normal">
          <span>
            {t("settings.unreadBadge")}
            <span className="block text-xs font-normal text-muted">{t("settings.unreadBadgeHint")}</span>
          </span>
          <input
            type="checkbox"
            checked={unreadBadge}
            onChange={(e) => {
              setUnreadBadge(e.target.checked);
              setUnreadBadgeEnabled(e.target.checked);
              if (e.target.checked && client) applyBadgeCount(getGlobalUnreadSummary(client).mentionCount);
            }}
            className="h-4 w-4 shrink-0"
          />
        </label>
      </div>

      <div className={sectionClassName("csengőhang hang sound notification hangerő volume")}>
        <h3 className="mb-2 text-xs font-bold uppercase text-muted">{t("settings.ringtone")}</h3>
        <div className="flex flex-col gap-1.5">
          {NOTIFICATION_SOUNDS.map((sound) => (
            <label
              key={sound.id}
              className={`flex items-center justify-between gap-2 rounded border px-3 py-1.5 text-sm transition ${
                notifSound === sound.id
                  ? "border-brand bg-brand/10 text-header"
                  : "border-border text-normal hover:bg-bg-modifier-hover"
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="notif-sound"
                  checked={notifSound === sound.id}
                  onChange={() => {
                    setNotifSound(sound.id);
                    setNotificationSound(sound.id);
                  }}
                  className="h-3.5 w-3.5"
                />
                {t(sound.labelKey)}
              </span>
              {sound.id !== "none" && (
                <button
                  type="button"
                  onClick={() => previewNotificationSound(sound.id, notifVolume)}
                  title={t("voiceMsg.play")}
                  aria-label={t("voiceMsg.play")}
                  className="rounded p-1 text-muted hover:bg-bg-modifier-hover hover:text-normal"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                    <path d="M8 5v14l11-7Z" />
                  </svg>
                </button>
              )}
            </label>
          ))}
        </div>
        <label className="mt-3 block text-xs font-bold uppercase text-muted">
          {t("settings.volume", { value: notifVolume })}
          <input
            type="range"
            min={0}
            max={100}
            value={notifVolume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setNotifVolume(v);
              setNotificationVolume(v);
            }}
            className="mt-1 w-full"
          />
        </label>

        <label className="mt-4 flex items-center justify-between gap-3 text-sm text-normal">
          <span>
            {t("settings.reactionNotify")}
            <span className="block text-xs font-normal text-muted">{t("settings.reactionNotifyHint")}</span>
          </span>
          <select
            value={reactionNotify}
            onChange={(e) => {
              const v = e.target.value as ReactionNotifyMode;
              setReactionNotifyState(v);
              setReactionNotifyMode(v);
            }}
            className="shrink-0 rounded bg-bg-darkest px-2 py-1 text-sm text-normal outline-none"
          >
            <option value="all">{t("settings.reactionNotifyAll")}</option>
            <option value="dms">{t("settings.reactionNotifyDms")}</option>
            <option value="off">{t("settings.reactionNotifyOff")}</option>
          </select>
        </label>
      </div>

      <div className={sectionClassName("naptár esemény emlékeztető calendar reminder")}>
        <h3 className="mb-1 text-xs font-bold uppercase text-muted">{t("settings.calendarReminders")}</h3>
        <p className="mb-2 text-xs text-muted">{t("settings.calendarRemindersHint")}</p>
        <select
          value={reminderLeadMs}
          onChange={(e) => {
            const ms = Number(e.target.value);
            setReminderLeadMsState(ms);
            setReminderLeadMs(ms);
          }}
          className="w-full rounded bg-bg-darkest px-3 py-2 text-sm text-normal outline-none"
        >
          {REMINDER_LEAD_PRESETS.map((p) => (
            <option key={p.ms} value={p.ms}>
              {t(p.labelKey)}
            </option>
          ))}
        </select>
      </div>
        </>
      ),
    },
    {
      id: "integrations",
      label: t("settings.catIntegrations"),
      keywords: "gif tenor kereső api integráció",
      render: () => (
      <div className={sectionClassName("gif tenor kereső api integráció", "")}>
        <h3 className="mb-1 text-xs font-bold uppercase text-muted">{t("settings.gifSearch")}</h3>
        <p className="mb-2 text-xs text-muted">
          {t("settings.gifKeyHintBefore")}
          <a
            href="https://developers.google.com/tenor/guides/quickstart"
            target="_blank"
            rel="noopener noreferrer"
            className="text-link hover:underline"
          >
            {t("settings.gifKeyRegisterLink")}
          </a>
          {t("settings.gifKeyHintAfter")}
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            className={modalInputClass()}
            value={tenorKeyInput}
            onChange={(e) => setTenorKeyInput(e.target.value)}
            placeholder={t("settings.tenorKeyPlaceholder")}
            aria-label={t("settings.tenorKeyPlaceholder")}
          />
          <button
            type="button"
            aria-live="polite"
            onClick={() => {
              setTenorApiKey(tenorKeyInput);
              setTenorKeySaved(true);
              setTimeout(() => setTenorKeySaved(false), 2000);
            }}
            className="shrink-0 rounded bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover"
          >
            {tenorKeySaved ? t("common.saved") : t("common.save")}
          </button>
        </div>
      </div>
      ),
    },
    {
      id: "privacy",
      label: t("settings.catPrivacy"),
      keywords: "adatvédelem privacy olvasási visszaigazolás read receipt link preview előnézet",
      render: () => (
      <div className={sectionClassName("adatvédelem privacy olvasási visszaigazolás read receipt", "")}>
        <h3 className="mb-2 text-xs font-bold uppercase text-muted">{t("settings.privacy")}</h3>
        <label className="flex items-center justify-between gap-3 text-sm text-normal">
          <span>
            {t("settings.privateReceipts")}
            <span className="block text-xs font-normal text-muted">{t("settings.privateReceiptsHint")}</span>
          </span>
          <input
            type="checkbox"
            checked={privateReceipts}
            onChange={(e) => {
              setPrivateReceipts(e.target.checked);
              setPrivateReadReceiptsEnabled(e.target.checked);
            }}
            className="h-4 w-4 shrink-0"
          />
        </label>

        <label className="mt-3 flex items-center justify-between gap-3 text-sm text-normal">
          <span>
            {t("settings.linkPreviews")}
            <span className="block text-xs font-normal text-muted">{t("settings.linkPreviewsHint")}</span>
          </span>
          <select
            value={linkPreviewMode}
            onChange={(e) => {
              const v = e.target.value as LinkPreviewMode;
              setLinkPreviewMode(v);
              setLinkPreviewModeState(v);
            }}
            className="shrink-0 rounded bg-bg-darkest px-2 py-1 text-sm text-normal outline-none"
          >
            <option value="all">{t("settings.linkPreviewAll")}</option>
            <option value="unencrypted">{t("settings.linkPreviewUnencrypted")}</option>
            <option value="off">{t("settings.linkPreviewOff")}</option>
          </select>
        </label>

        <label className="mt-3 flex items-center justify-between gap-3 text-sm text-normal">
          <span>
            {t("settings.shareActivity")}
            <span className="block text-xs font-normal text-muted">{t("settings.shareActivityHint")}</span>
          </span>
          <input
            type="checkbox"
            checked={shareActivity}
            onChange={(e) => {
              setShareActivityState(e.target.checked);
              setActivitySharingEnabled(e.target.checked);
              if (!e.target.checked) void setActivity(client, null).catch(() => undefined);
            }}
            className="h-4 w-4 shrink-0"
          />
        </label>

        <label className="mt-3 flex items-center justify-between gap-3 text-sm text-normal">
          <span>
            {t("settings.friendRequestPolicy")}
            <span className="block text-xs font-normal text-muted">{t("settings.friendRequestPolicyHint")}</span>
          </span>
          <select
            value={friendPolicy}
            onChange={(e) => {
              const v = e.target.value as FriendRequestPolicy;
              setFriendPolicyState(v);
              void setFriendRequestPolicy(client, v);
            }}
            className="shrink-0 rounded bg-bg-darkest px-2 py-1 text-sm text-normal outline-none"
          >
            <option value="everyone">{t("settings.friendRequestEveryone")}</option>
            <option value="mutual_servers">{t("settings.friendRequestMutualServers")}</option>
            <option value="none">{t("settings.friendRequestNone")}</option>
          </select>
        </label>
      </div>
      ),
    },
    {
      id: "calls",
      label: t("settings.catCalls"),
      keywords: "hívás call zajszűrés noise suppression rögzített beszéd push to talk ptt hang video",
      render: () => (
      <div className={sectionClassName("hívás call zajszűrés noise suppression rögzített beszéd push to talk ptt mikrofon kamera microphone camera device eszköz", "")}>
        <h3 className="mb-2 text-xs font-bold uppercase text-muted">{t("settings.calls")}</h3>

        <div className="flex flex-col gap-3">
          <DeviceSelect
            kind="audioinput"
            label={t("settings.microphoneDevice")}
            value={preferredMicId}
            onChange={(id) => {
              setPreferredMicId(id);
              setPreferredMicIdState(id ?? undefined);
              void refreshMicPipeline();
            }}
          />
          <MicTest deviceId={preferredMicId} micVolume={micVolume} />
          <label className="flex items-center gap-2 text-sm text-normal">
            <span className="w-28 shrink-0">{t("settings.micVolume")}</span>
            <input
              type="range"
              min={0}
              max={200}
              value={micVolume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setMicVolume(v);
                setMicVolumeState(v);
                setMicVolumeLive(v);
              }}
              className="min-w-0 flex-1"
            />
            <span className="w-10 shrink-0 text-right text-xs text-muted">{micVolume}%</span>
          </label>

          <DeviceSelect
            kind="videoinput"
            label={t("settings.cameraDevice")}
            value={preferredCameraId}
            onChange={(id) => {
              setPreferredCameraId(id);
              setPreferredCameraIdState(id ?? undefined);
            }}
          />
          <CameraPreview deviceId={preferredCameraId} />

          <DeviceSelect
            kind="audiooutput"
            label={t("settings.speakerDevice")}
            value={preferredSpeakerId}
            onChange={(id) => {
              setPreferredSpeakerId(id);
              setPreferredSpeakerIdState(id ?? undefined);
              if (id) switchActiveSpeaker(id);
            }}
          />
          <label className="flex items-center gap-2 text-sm text-normal">
            <span className="w-28 shrink-0">{t("settings.speakerVolume")}</span>
            <input
              type="range"
              min={0}
              max={200}
              value={speakerVolume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSpeakerVolume(v);
                setSpeakerVolumeState(v);
                reapplyAllUserCallPrefs(client);
              }}
              className="min-w-0 flex-1"
            />
            <span className="w-10 shrink-0 text-right text-xs text-muted">{speakerVolume}%</span>
          </label>
        </div>

        <label className="mt-4 flex items-center justify-between gap-3 text-sm text-normal">
          <span>
            {t("settings.noiseSuppression")}
            <span className="block text-xs font-normal text-muted">{t("settings.noiseSuppressionHint")}</span>
          </span>
          <input
            type="checkbox"
            checked={noiseSuppressionEnabled}
            onChange={(e) => setNoiseSuppressionEnabled(e.target.checked)}
            className="h-4 w-4 shrink-0"
          />
        </label>

        <label className="mt-3 flex items-center justify-between gap-3 text-sm text-normal">
          <span>
            {t("settings.pushToTalk")}
            <span className="block text-xs font-normal text-muted">{t("settings.pushToTalkHint")}</span>
          </span>
          <input
            type="checkbox"
            checked={pttEnabled}
            onChange={(e) => setPttEnabled(e.target.checked)}
            className="h-4 w-4 shrink-0"
          />
        </label>
        {pttEnabled && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded bg-bg-darkest px-3 py-2 text-xs">
            <span className="text-muted">
              {t("settings.pttKeyLabel")} <span className="font-semibold text-normal">{describeKeyCode(pttCode)}</span>
            </span>
            <button
              type="button"
              onClick={() => setCapturingKey(true)}
              className="rounded border border-border px-2 py-1 font-medium text-normal hover:bg-bg-modifier-hover"
            >
              {capturingKey ? t("settings.pttCapturing") : t("settings.pttChange")}
            </button>
          </div>
        )}

        <h3 className="mb-2 mt-6 text-xs font-bold uppercase text-muted">{t("settings.callSounds")}</h3>
        <label className="flex items-center justify-between gap-3 text-sm text-normal">
          <span>{t("settings.callSoundsEnabled")}</span>
          <input
            type="checkbox"
            checked={callSoundsOn}
            onChange={(e) => {
              setCallSoundsOnState(e.target.checked);
              setCallSoundsEnabled(e.target.checked);
            }}
            className="h-4 w-4 shrink-0"
          />
        </label>
        <label className="mt-2 block text-xs font-bold uppercase text-muted">
          {t("settings.volume", { value: callSoundsVol })}
          <input
            type="range"
            min={0}
            max={100}
            value={callSoundsVol}
            onChange={(e) => {
              const v = Number(e.target.value);
              setCallSoundsVolState(v);
              setCallSoundsVolume(v);
            }}
            className="mt-1 w-full"
          />
        </label>
        {callSoundsOn && (
          <div className="mt-2 flex flex-col gap-1.5">
            {CALL_SOUND_KINDS.map((kind) => (
              <label key={kind.id} className="flex items-center justify-between gap-3 text-sm text-normal">
                <span className="flex items-center gap-2">
                  {t(kind.labelKey)}
                  <button
                    type="button"
                    onClick={() => previewCallSound(kind.id)}
                    title={t("voiceMsg.play")}
                    aria-label={t("voiceMsg.play")}
                    className="rounded p-0.5 text-muted hover:bg-bg-modifier-hover hover:text-normal"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                      <path d="M8 5v14l11-7Z" />
                    </svg>
                  </button>
                </span>
                <input
                  type="checkbox"
                  checked={callSoundKinds[kind.id] ?? true}
                  onChange={(e) => {
                    setCallSoundKindEnabled(kind.id, e.target.checked);
                    setCallSoundKindsState((prev) => ({ ...prev, [kind.id]: e.target.checked }));
                  }}
                  className="h-4 w-4 shrink-0"
                />
              </label>
            ))}
          </div>
        )}
        <GpuSettingsSection />
      </div>
      ),
    },
    {
      id: "account",
      label: t("settings.catAccount"),
      keywords: "jelszó password email telefon phone eszköz device munkamenet session fiók account törlés delete deaktiválás deactivate export adat data letöltés download",
      render: () => (
        <div>
          <ChangePasswordSection client={client} />
          <ThreePidSection client={client} />
          <DeviceManagementSection client={client} />
          <AccountDataSection client={client} />
        </div>
      ),
    },
    {
      id: "backup",
      label: t("settings.catBackup"),
      keywords: "mentés export import backup beállítás sync szinkron json fiók",
      render: () => <SettingsBackupSection client={client} />,
    },
    ...(ignoredUsers.length > 0
      ? [
          {
            id: "blocked",
            label: t("settings.catBlocked"),
            keywords: "letiltott ignore block felhasználó user blokkolt",
            render: () => (
              <div className="flex flex-col gap-1">
                {ignoredUsers.map((userId) => (
                  <div key={userId} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-normal">{userId}</span>
                    <button
                      type="button"
                      onClick={() => void handleUnignore(userId)}
                      className="shrink-0 text-xs font-medium text-link hover:underline"
                    >
                      {t("settings.unblock")}
                    </button>
                  </div>
                ))}
              </div>
            ),
          } as SettingsPane,
        ]
      : []),
  ];

  return <SettingsModalShell title={t("settings.title")} onClose={close} panes={panes} />;
}
