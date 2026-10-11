import {
  findEventNearTimestamp,
  getOwningSpace,
  hitMatchesQuery,
  parseSearchQuery,
  type ParsedQuery,
  type Room,
  type SearchHit,
  type SearchResultPage,
  searchAllLoadedRoomMessages,
  searchAllRoomMessages,
  searchLoadedRoomMessages,
  searchMore,
  searchRoomMessages,
  stripReplyFallback,
} from "@jorkonvo/matrix-core";
import type { ISearchResults } from "matrix-js-sdk";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n";
import { formatTimestamp } from "../lib/format";
import { useMatrixStore } from "../state/matrixStore";
import { useUiStore } from "../state/uiStore";
import { Avatar } from "./Avatar";

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-1 rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-medium text-link">
      {label}
      <button type="button" onClick={onRemove} className="rounded-full text-muted hover:text-dnd" title={t("common.remove")} aria-label={t("common.remove")}>
        ✕
      </button>
    </span>
  );
}

/**
 * Slide-in message search sidebar: debounced query search with operator chips
 * (from:/has:/in:/dates), a "this room / everywhere" scope toggle, a
 * jump-to-date shortcut, and clickable hits that jump to the message (and its
 * room). Falls back to scanning locally loaded messages in E2EE rooms the
 * server can't index.
 *
 * @param room - The room the search was opened from; scopes the "this room" search.
 */
export function SearchPanel({ room }: { room: Room }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const closeSearch = useUiStore((s) => s.closeSearch);
  const jumpToEvent = useUiStore((s) => s.jumpToEvent);
  const selectRoom = useUiStore((s) => s.selectRoom);
  const selectSpace = useUiStore((s) => s.selectSpace);
  const [scope, setScope] = useState<"room" | "everywhere">("room");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [usedLocalFallback, setUsedLocalFallback] = useState(false);
  const [nextPage, setNextPage] = useState<ISearchResults | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [parsed, setParsed] = useState<ParsedQuery | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const [jumpDate, setJumpDate] = useState("");
  const [jumpBusy, setJumpBusy] = useState(false);
  const [jumpError, setJumpError] = useState<string | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const term = query.trim();
    if (!term) {
      setResults([]);
      setError(null);
      setSearched(false);
      setUsedLocalFallback(false);
      setNextPage(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      setNextPage(null);
      // Operators (from:/has:/in:/dates) come out of the box; the remaining
      // free text is what the server sees.
      const parsed = parseSearchQuery(term);
      setParsed(parsed);
      const applyFilters = (hits: SearchHit[]) =>
        hits.filter((hit) => {
          const hitRoom = client.getRoom(hit.roomId);
          const senderName = hitRoom?.getMember(hit.event.getSender() ?? "")?.name ?? null;
          if (
            parsed.inRoomName &&
            !(hitRoom?.name ?? "").toLowerCase().includes(parsed.inRoomName)
          ) {
            return false;
          }
          return hitMatchesQuery(hit.event, parsed, senderName);
        });
      const serverSearch: Promise<SearchResultPage> =
        scope === "room" ? searchRoomMessages(client, room.roomId, parsed.term) : searchAllRoomMessages(client, parsed.term);
      serverSearch
        .then((page) => {
          if (requestId !== requestIdRef.current) return;
          // The homeserver can only index plaintext it has seen, so search
          // in an E2EE room always comes back empty - fall back to scanning
          // what's already decrypted and loaded in this client.
          if (page.hits.length === 0) {
            const needsFallback = scope === "room" ? room.hasEncryptionStateEvent() : true;
            if (needsFallback) {
              const localHits = applyFilters(
                scope === "room" ? searchLoadedRoomMessages(room, parsed.term) : searchAllLoadedRoomMessages(client, parsed.term),
              );
              setResults(localHits);
              setUsedLocalFallback(localHits.length > 0);
              setSearched(true);
              return;
            }
          }
          setResults(applyFilters(page.hits));
          setNextPage(page.raw);
          setUsedLocalFallback(false);
          setSearched(true);
        })
        .catch((err) => {
          if (requestId !== requestIdRef.current) return;
          setError((err as Error).message);
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, room.roomId, scope]);

  function removeOperator(op: string) {
    const re =
      op === "from"
        ? /\bfrom:\s*("[^"]*"|\S+)/gi
        : op === "in"
          ? /\bin:\s*("[^"]*"|\S+)/gi
          : new RegExp(`\\b${op}:\\s*("[^"]*"|\\S+)`, "gi");
    setQuery((q) => q.replace(re, "").replace(/\s+/g, " ").trim());
  }

  async function handleLoadMore() {
    if (!nextPage || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await searchMore(client, nextPage);
      setResults(page.hits);
      setNextPage(page.raw);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleJumpToDate() {
    if (!jumpDate) return;
    setJumpBusy(true);
    setJumpError(null);
    try {
      // Midnight LOCAL time on the picked date - "f" (forward) finds the
      // closest event AT OR AFTER that moment, same convention Element
      // uses, so picking a quiet day still lands on the next real activity
      // rather than erroring out.
      const ts = new Date(`${jumpDate}T00:00:00`).getTime();
      const eventId = await findEventNearTimestamp(client, room.roomId, ts);
      jumpToEvent(eventId);
    } catch (err) {
      setJumpError((err as Error).message);
    } finally {
      setJumpBusy(false);
    }
  }

  function handlePick(hit: SearchHit) {
    const eventId = hit.event.getId();
    if (!eventId) return;
    if (hit.roomId !== room.roomId) {
      const owningSpace = getOwningSpace(client, hit.roomId);
      selectSpace(owningSpace ? owningSpace.roomId : null);
      selectRoom(hit.roomId);
    }
    jumpToEvent(eventId);
  }

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-bg-primary">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4 shadow-sm">
        <h2 className="text-[15px] font-semibold text-header">{t("search.title")}</h2>
        <button
          type="button"
          onClick={closeSearch}
          title={t("search.close")}
          aria-label={t("search.close")}
          className="rounded p-1.5 text-muted hover:bg-bg-modifier-hover hover:text-normal"
        >
          ✕
        </button>
      </div>

      <div className="border-b border-border p-3">
        <input
          autoFocus
          aria-label={scope === "room" ? t("search.placeholderRoom") : t("search.placeholderEverywhere")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={scope === "room" ? t("search.placeholderRoom") : t("search.placeholderEverywhere")}
          className="mb-2 w-full rounded bg-bg-darkest px-3 py-2 text-sm text-normal outline-none focus:ring-2 focus:ring-brand"
        />
        <p className="mb-2 text-[11px] leading-relaxed text-muted">
          {t("search.operatorsHint")}
        </p>
        {parsed && (parsed.from || parsed.inRoomName || parsed.hasLink || parsed.hasImage || parsed.hasFile || parsed.beforeTs || parsed.afterTs || parsed.duringDay) && (
          <div className="mb-2 flex flex-wrap gap-1">
            {parsed.from && (
              <FilterChip label={`from: ${parsed.from}`} onRemove={() => removeOperator("from")} />
            )}
            {parsed.hasLink && <FilterChip label="has: link" onRemove={() => removeOperator("has:link")} />}
            {parsed.hasImage && <FilterChip label="has: image" onRemove={() => removeOperator("has:image")} />}
            {parsed.hasFile && <FilterChip label="has: file" onRemove={() => removeOperator("has:file")} />}
            {parsed.inRoomName && (
              <FilterChip label={`in: #${parsed.inRoomName}`} onRemove={() => removeOperator("in")} />
            )}
            {parsed.afterTs !== null && (
              <FilterChip label={`after: ${parsed.duringDay ?? new Date(parsed.afterTs).toISOString().slice(0, 10)}`} onRemove={() => removeOperator("after")} />
            )}
            {parsed.beforeTs !== null && (
              <FilterChip label={`before: ${new Date(parsed.beforeTs).toISOString().slice(0, 10)}`} onRemove={() => removeOperator("before")} />
            )}
          </div>
        )}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setScope("room")}
            aria-pressed={scope === "room"}
            className={`flex-1 rounded px-2 py-1 text-xs font-medium transition ${
              scope === "room" ? "bg-brand text-white" : "bg-bg-darkest text-muted hover:text-normal"
            }`}
          >
            {t("search.scopeRoom")}
          </button>
          <button
            type="button"
            onClick={() => setScope("everywhere")}
            aria-pressed={scope === "everywhere"}
            className={`flex-1 rounded px-2 py-1 text-xs font-medium transition ${
              scope === "everywhere" ? "bg-brand text-white" : "bg-bg-darkest text-muted hover:text-normal"
            }`}
          >
            {t("search.scopeEverywhere")}
          </button>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <input
            type="date"
            value={jumpDate}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setJumpDate(e.target.value)}
            aria-label={t("search.jumpToDate")}
            className="min-w-0 flex-1 rounded bg-bg-darkest px-2 py-1.5 text-xs text-normal outline-none"
          />
          <button
            type="button"
            disabled={!jumpDate || jumpBusy}
            onClick={() => void handleJumpToDate()}
            className="shrink-0 rounded bg-bg-darkest px-2 py-1.5 text-xs font-medium text-muted hover:text-normal disabled:opacity-50"
          >
            {jumpBusy ? t("search.jumping") : t("search.jumpToDate")}
          </button>
        </div>
        {jumpError && <p role="alert" className="mt-1 text-[11px] text-dnd">{t("search.jumpFailed", { error: jumpError })}</p>}
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {usedLocalFallback && !loading && (
          <p className="border-b border-border px-4 py-2 text-xs text-muted">
            {scope === "room" ? t("search.e2eeNoteRoom") : t("search.e2eeNoteEverywhere")}
          </p>
        )}
        {loading && <p role="status" className="px-4 py-3 text-sm text-muted">{t("search.searching")}</p>}
        {error && <p role="alert" className="px-4 py-3 text-sm text-dnd">{t("search.error", { error })}</p>}
        {!loading && !error && searched && results.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted">{t("search.noResults")}</p>
        )}
        {!loading &&
          results.map((hit) => {
            const eventId = hit.event.getId();
            const hitRoom = client.getRoom(hit.roomId);
            const sender = hitRoom?.getMember(hit.event.getSender() ?? "");
            return (
              <button
                key={eventId}
                type="button"
                onClick={() => handlePick(hit)}
                className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left hover:bg-bg-modifier-hover"
              >
                <Avatar
                  url={sender?.getAvatarUrl(client.baseUrl, 28, 28, "crop", false, false) ?? null}
                  name={sender?.name ?? hit.event.getSender() ?? "?"}
                  size={28}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="truncate text-xs font-medium text-header">
                      {sender?.name ?? hit.event.getSender()}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted">{formatTimestamp(hit.event.getTs())}</span>
                  </div>
                  {scope === "everywhere" && hitRoom && (
                    <p className="truncate text-[11px] text-link">#{hitRoom.name}</p>
                  )}
                  <p className="line-clamp-2 text-sm text-normal">
                    {stripReplyFallback((hit.event.getContent().body as string) ?? "")}
                  </p>
                </div>
              </button>
            );
          })}
        {!loading && nextPage && (
          <button
            type="button"
            onClick={() => void handleLoadMore()}
            disabled={loadingMore}
            className="mx-4 my-2 block w-[calc(100%-2rem)] rounded border border-border py-1.5 text-xs font-medium text-muted hover:bg-bg-modifier-hover hover:text-normal disabled:opacity-50"
          >
            {loadingMore ? t("search.searching") : t("search.loadMore")}
          </button>
        )}
      </div>
    </div>
  );
}
