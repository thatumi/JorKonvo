import {
  joinRoomByIdOrAlias,
  joinRoomFromInviteLink,
  parseInviteLink,
  previewInviteLink,
  type InviteLinkPreview,
} from "@jorkonvo/matrix-core";
import { useEffect, useState } from "react";
import { useTranslation } from "../i18n";
import { useMatrixStore } from "../state/matrixStore";
import { useUiStore } from "../state/uiStore";
import { Avatar } from "./Avatar";

/**
 * Discord-style "you've been invited to a server" card, rendered under a
 * message in place of a bare link when it's a JorKonvo/matrix.to invite
 * link (see parseInviteLink) - shows the target's name/avatar/member count
 * when discoverable (previewInviteLink) and joins directly in-app on
 * click, no navigation anywhere (real gap reported live 2026-09-16: tapping
 * an invite link opened Safari - a dead end since Universal Links aren't
 * verified yet - instead of joining in-app the way the link was clearly
 * meant to work).
 *
 * Returns null for a non-invite-link URL - the caller (MessageLine.tsx)
 * falls back to RichEmbed/LinkPreview for those, same as before.
 */
export function InviteLinkCard({ url }: { url: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const bumpTick = useMatrixStore((s) => s.bumpTick);
  const selectRoom = useUiStore((s) => s.selectRoom);
  const parsed = parseInviteLink(url);

  const [preview, setPreview] = useState<InviteLinkPreview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    if (!parsed) return;
    let cancelled = false;
    setPreview(undefined);
    void previewInviteLink(client, parsed).then((p) => {
      if (!cancelled) setPreview(p);
    });
    return () => {
      cancelled = true;
    };
    // parsed is re-derived from `url` every render but is value-equal for
    // the same url - re-keying the effect on url (not the object) avoids
    // an infinite fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, url]);

  if (!parsed) return null;

  const alreadyMember = client.getRoom(parsed.target)?.getMyMembership() === "join";

  async function handleJoin() {
    if (!parsed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const room = parsed.spaceId
        ? (await joinRoomFromInviteLink(client, parsed)).room
        : await joinRoomByIdOrAlias(client, url);
      setJoined(true);
      bumpTick();
      selectRoom(room.roomId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const displayName = preview?.spaceName ?? preview?.targetName ?? null;
  const avatarMxc = preview?.spaceAvatarMxcUrl ?? preview?.targetAvatarMxcUrl ?? null;
  const memberCount = preview?.spaceMemberCount ?? preview?.targetMemberCount;
  const done = joined || alreadyMember;

  return (
    <div className="mt-1 max-w-sm overflow-hidden rounded-lg border border-border bg-bg-secondary p-3">
      <div className="flex items-center gap-3">
        <Avatar
          url={avatarMxc ? client.mxcUrlToHttp(avatarMxc, 40, 40, "crop") : null}
          name={displayName ?? "?"}
          size={40}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-bold uppercase text-muted">
            {preview?.targetIsSpace || preview?.spaceId ? t("inviteCard.serverInvite") : t("inviteCard.roomInvite")}
          </div>
          <div className="truncate text-sm font-semibold text-header">
            {displayName ?? t("inviteCard.unknownTarget")}
          </div>
          {memberCount != null && (
            <div className="text-xs text-muted">{t("inviteCard.memberCount", { count: memberCount })}</div>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-dnd">{error}</p>}
      <button
        type="button"
        data-testid="invite-card-join"
        disabled={busy || done}
        onClick={() => void handleJoin()}
        className="mt-2 w-full rounded bg-brand py-1.5 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-60"
      >
        {done ? t("inviteCard.joined") : busy ? t("inviteCard.joining") : t("inviteCard.join")}
      </button>
    </div>
  );
}
