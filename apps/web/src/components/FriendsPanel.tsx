import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  getFriendRequests,
  getFriends,
  type MatrixClient,
  removeFriend,
  searchUsers,
  sendFriendRequest,
  startDirectMessage,
  type UserSearchResult,
} from "@jorkonvo/matrix-core";
import { useEffect, useState } from "react";
import { useTranslation } from "../i18n";
import { uiConfirm } from "../lib/dialogs";
import { useMatrixStore } from "../state/matrixStore";
import { useUiStore } from "../state/uiStore";
import { Avatar } from "./Avatar";

function presenceColor(presence: string | undefined): string {
  switch (presence) {
    case "online":
      return "var(--color-online)";
    case "unavailable":
      return "var(--color-idle)";
    default:
      return "var(--color-offline)";
  }
}

function presenceKey(presence: string | undefined): string {
  switch (presence) {
    case "online":
      return "presence.online";
    case "unavailable":
      return "presence.idle";
    default:
      return "presence.offline";
  }
}

/**
 * Matrix only tells a client about a user's presence if they share a room
 * (or the client explicitly asked for it) - two friends with no DM open yet
 * would otherwise show as permanently offline here even while actually
 * online, defeating the whole point of a friends list. This fills that gap
 * with client.getPresence() (a direct GET /presence/{userId}/status), polled
 * on an interval while the panel is open. Live presence from a shared room
 * (via the normal sync-tick path) still takes priority when available - this
 * is only the fallback for friends the client wouldn't otherwise be tracking.
 */
function useFriendPresence(client: MatrixClient | null, friends: string[]) {
  const [fetched, setFetched] = useState<Record<string, string | undefined>>({});

  useEffect(() => {
    if (!client || friends.length === 0) return;
    let cancelled = false;

    async function poll() {
      const results = await Promise.all(
        friends.map(async (userId) => {
          // A friend already tracked live (shares a room) doesn't need the
          // fallback fetch - avoids spamming a GET for every friend every
          // poll once real presence is flowing in normally.
          if (client!.getUser(userId)?.presence) return [userId, undefined] as const;
          try {
            const status = await client!.getPresence(userId);
            return [userId, status.presence] as const;
          } catch {
            return [userId, undefined] as const;
          }
        }),
      );
      if (cancelled) return;
      setFetched(Object.fromEntries(results.filter(([, p]) => p !== undefined)));
    }

    void poll();
    const interval = setInterval(() => void poll(), 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, friends.join(",")]);

  return fetched;
}

function AddFriendBox() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      searchUsers(client, term)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [client, query]);

  async function handleAdd(userId: string, label: string) {
    setBusyId(userId);
    setFeedback(null);
    try {
      await sendFriendRequest(client, userId);
      setFeedback({ ok: true, text: t("friends.requestSent", { name: label }) });
      setQuery("");
      setResults([]);
    } catch (err) {
      setFeedback({ ok: false, text: (err as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-lg bg-bg-secondary p-4">
      <h3 className="mb-1 text-sm font-semibold text-header">{t("friends.add")}</h3>
      <p className="mb-3 text-xs text-muted">{t("friends.addHint")}</p>
      <div className="flex items-center gap-2 rounded bg-bg-darkest px-3 py-2">
        <input
          aria-label={t("friends.add")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="@user:example.com"
          className="min-w-0 flex-1 bg-transparent text-sm text-normal placeholder:text-muted outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim()) void handleAdd(query.trim(), query.trim());
          }}
        />
        <button
          type="button"
          disabled={!query.trim() || busyId !== null}
          onClick={() => void handleAdd(query.trim(), query.trim())}
          className="shrink-0 rounded bg-brand px-3 py-1 text-xs font-semibold text-white enabled:hover:bg-brand-hover disabled:opacity-50"
        >
          {t("friends.sendRequest")}
        </button>
      </div>

      {feedback && (
        <p role={feedback.ok ? "status" : "alert"} className={`mt-2 text-xs ${feedback.ok ? "text-online" : "text-dnd"}`}>{feedback.text}</p>
      )}

      {(results.length > 0 || searching) && (
        <div className="mt-2 max-h-52 overflow-y-auto rounded bg-bg-darkest">
          {searching && <p role="status" className="px-3 py-2 text-xs text-muted">{t("common.searching")}</p>}
          {results.map((r) => (
            <button
              key={r.userId}
              type="button"
              disabled={busyId !== null}
              onClick={() => void handleAdd(r.userId, r.displayName ?? r.userId)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-bg-modifier-hover disabled:opacity-60"
            >
              <Avatar
                url={r.avatarMxcUrl ? client.mxcUrlToHttp(r.avatarMxcUrl, 28, 28, "crop") : null}
                name={r.displayName ?? r.userId}
                size={28}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-normal">{r.displayName ?? r.userId}</div>
                {r.displayName && <div className="truncate text-xs text-muted">{r.userId}</div>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PersonRow({
  userId,
  presenceOverride,
  action,
}: {
  userId: string;
  /** Fallback presence (from useFriendPresence) for a friend with no shared room, where the live User object has none of its own. */
  presenceOverride?: string;
  action: React.ReactNode;
}) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const user = client.getUser(userId);
  const name = user?.displayName || userId;
  const avatarUrl = user?.avatarUrl ? client.mxcUrlToHttp(user.avatarUrl, 40, 40, "crop") : null;
  const presence = user?.presence ?? presenceOverride;
  const statusMsg = user?.presenceStatusMsg;

  return (
    <div role="listitem" className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-bg-modifier-hover">
      <Avatar url={avatarUrl} name={name} size={40} statusColor={presenceColor(presence)} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-header">{name}</div>
        <div className="truncate text-xs text-muted" title={statusMsg}>
          {statusMsg || (presence ? t(presenceKey(presence)) : userId)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{action}</div>
    </div>
  );
}

function IconButton({
  onClick,
  title,
  tone = "normal",
  disabled,
  children,
}: {
  onClick: () => void;
  title: string;
  tone?: "normal" | "danger" | "positive";
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "danger"
      ? "enabled:hover:bg-dnd/15 enabled:hover:text-dnd"
      : tone === "positive"
        ? "enabled:hover:bg-online/15 enabled:hover:text-online"
        : "enabled:hover:bg-bg-modifier-hover enabled:hover:text-normal";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={`flex h-8 w-8 items-center justify-center rounded-full text-muted transition disabled:opacity-40 ${toneClass}`}
    >
      {children}
    </button>
  );
}

const CheckIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
    <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" />
  </svg>
);
const XIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
    <path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.3 19.7 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.29-6.3Z" />
  </svg>
);
const ChatIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
    <path d="M4 4h16v12H7l-3 3V4Z" />
  </svg>
);

function FriendRow({
  userId,
  presenceOverride,
  busyId,
  onMessage,
  onRemove,
  client,
}: {
  userId: string;
  presenceOverride?: string;
  busyId: string | null;
  onMessage: (userId: string) => void;
  onRemove: (userId: string) => void;
  client: MatrixClient;
}) {
  const { t } = useTranslation();
  return (
    <PersonRow
      userId={userId}
      presenceOverride={presenceOverride}
      action={
        <>
          <IconButton title={t("friends.message")} disabled={busyId === userId} onClick={() => onMessage(userId)}>
            {ChatIcon}
          </IconButton>
          <IconButton
            tone="danger"
            title={t("common.remove")}
            disabled={busyId === userId}
            onClick={() =>
              void (async () => {
                const user = client.getUser(userId);
                if (await uiConfirm(t("friends.removeConfirm", { name: user?.displayName || userId }), { danger: true })) {
                  onRemove(userId);
                }
              })()
            }
          >
            {XIcon}
          </IconButton>
        </>
      }
    />
  );
}

/**
 * Home-tab friends panel: add friends by Matrix ID or user search, handle
 * incoming/outgoing requests, and browse the friend list grouped into online
 * and offline rows (backed by the polled presence fallback), with per-row
 * actions to start a DM or remove the friend and a text filter on top.
 */
export function FriendsPanel() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const selectRoom = useUiStore((s) => s.selectRoom);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const friends = getFriends(client);
  const { incoming, outgoing } = getFriendRequests(client);
  // Presence is fetched for the whole friend list regardless of the search
  // filter, so typing/clearing a search never has to wait on a fresh poll.
  const fallbackPresence = useFriendPresence(client, friends);
  const presenceOf = (userId: string) => client.getUser(userId)?.presence ?? fallbackPresence[userId];

  const query = filter.trim().toLowerCase();
  const visibleFriends = query
    ? friends.filter((id) => (client.getUser(id)?.displayName || id).toLowerCase().includes(query))
    : friends;

  // Discord-style grouping: online friends surfaced first (this is the
  // actual point of a friends list - who's around right now), then everyone
  // else. "unavailable" (idle) counts as present for this split - they have
  // an active session, just stepped away.
  const onlineFriends = visibleFriends.filter((id) => {
    const p = presenceOf(id);
    return p === "online" || p === "unavailable";
  });
  const offlineFriends = visibleFriends.filter((id) => !onlineFriends.includes(id));

  async function run(userId: string, fn: () => Promise<void>) {
    setBusyId(userId);
    try {
      await fn();
    } catch (err) {
      console.error("friend action failed", err);
    } finally {
      setBusyId(null);
    }
  }

  async function handleMessage(userId: string) {
    setBusyId(userId);
    try {
      const roomId = await startDirectMessage(client, userId);
      selectRoom(roomId);
    } catch (err) {
      console.error("failed to start DM", err);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 shadow-sm">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-header" fill="currentColor">
          <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3Zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5Zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z" />
        </svg>
        <h2 className="text-[15px] font-semibold text-header">{t("sidebar.friends")}</h2>
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
        <AddFriendBox />

        {friends.length > 0 && (
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("common.search")}
            aria-label={t("common.search")}
            className="w-full shrink-0 rounded bg-bg-darkest px-2.5 py-1.5 text-sm text-normal placeholder:text-muted outline-none focus:ring-1 focus:ring-brand"
          />
        )}

        {incoming.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
              {t("friends.incoming")} — {incoming.length}
            </h3>
            <div role="list" className="flex flex-col gap-0.5">
              {incoming.map((r) => (
                <PersonRow
                  key={r.userId}
                  userId={r.userId}
                  action={
                    <>
                      <IconButton
                        tone="positive"
                        title={t("sidebar.acceptInvite")}
                        disabled={busyId === r.userId}
                        onClick={() => void run(r.userId, () => acceptFriendRequest(client, r.userId))}
                      >
                        {CheckIcon}
                      </IconButton>
                      <IconButton
                        tone="danger"
                        title={t("sidebar.rejectInvite")}
                        disabled={busyId === r.userId}
                        onClick={() => void run(r.userId, () => declineFriendRequest(client, r.userId))}
                      >
                        {XIcon}
                      </IconButton>
                    </>
                  }
                />
              ))}
            </div>
          </section>
        )}

        {outgoing.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
              {t("friends.outgoing")} — {outgoing.length}
            </h3>
            <div role="list" className="flex flex-col gap-0.5">
              {outgoing.map((r) => (
                <PersonRow
                  key={r.userId}
                  userId={r.userId}
                  action={
                    <IconButton
                      tone="danger"
                      title={t("friends.withdraw")}
                      disabled={busyId === r.userId}
                      onClick={() => void run(r.userId, () => cancelFriendRequest(client, r.userId))}
                    >
                      {XIcon}
                    </IconButton>
                  }
                />
              ))}
            </div>
          </section>
        )}

        {friends.length > 0 && visibleFriends.length === 0 ? (
          <p className="text-sm text-muted">{t("friends.noSearchResults")}</p>
        ) : friends.length === 0 ? (
          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{t("sidebar.friends")} — 0</h3>
            <p className="text-sm text-muted">{t("friends.none")}</p>
          </section>
        ) : (
          <>
            {onlineFriends.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
                  {t("presence.online")} — {onlineFriends.length}
                </h3>
                <div role="list" className="flex flex-col gap-0.5">
                  {onlineFriends.map((userId) => (
                    <FriendRow
                      key={userId}
                      userId={userId}
                      presenceOverride={fallbackPresence[userId]}
                      busyId={busyId}
                      onMessage={handleMessage}
                      onRemove={(id) => void run(id, () => removeFriend(client, id))}
                      client={client}
                    />
                  ))}
                </div>
              </section>
            )}
            {offlineFriends.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
                  {t("friends.otherGroup")} — {offlineFriends.length}
                </h3>
                <div role="list" className="flex flex-col gap-0.5">
                  {offlineFriends.map((userId) => (
                    <FriendRow
                      key={userId}
                      userId={userId}
                      presenceOverride={fallbackPresence[userId]}
                      busyId={busyId}
                      onMessage={handleMessage}
                      onRemove={(id) => void run(id, () => removeFriend(client, id))}
                      client={client}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
