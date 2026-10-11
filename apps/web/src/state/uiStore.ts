import { create } from "zustand";
import { captureCurrentRoomScrollMemory } from "../lib/roomScrollMemory";

// Remembers the last room opened in each "scope" (a space id, or "home"), so
// re-entering a space drops you back where you were instead of an empty list.
const LAST_ROOM_KEY = "jorkonvo-last-room";

function scopeKey(spaceId: string | null): string {
  return spaceId ?? "home";
}

function readLastRooms(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LAST_ROOM_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function getLastRoomForScope(spaceId: string | null): string | null {
  return readLastRooms()[scopeKey(spaceId)] ?? null;
}

function persistLastRoom(spaceId: string | null, roomId: string): void {
  try {
    const map = readLastRooms();
    map[scopeKey(spaceId)] = roomId;
    localStorage.setItem(LAST_ROOM_KEY, JSON.stringify(map));
  } catch {
    // Private-mode / disabled storage - last-room memory is a nicety, not load-bearing.
  }
}

export interface ReplyTarget {
  eventId: string;
  senderName: string;
  body: string;
}

export interface EditTarget {
  eventId: string;
  body: string;
}

interface UiState {
  /** null = "Home" (DMs + ungrouped rooms), otherwise a space room id. */
  selectedSpaceId: string | null;
  selectedRoomId: string | null;
  /** The Discord-style "Friends" tab, only meaningful on Home (selectedSpaceId === null). */
  friendsViewOpen: boolean;
  /** The "Upcoming events" tab, mutually exclusive with friendsViewOpen, same scope. */
  eventsViewOpen: boolean;
  /** The Home-tab "Inbox" (mentions + replies), same scope as the other tabs. */
  inboxViewOpen: boolean;
  memberListOpen: boolean;
  /** Bumped on every selectRoom() call - even re-picking the already-selected room - so the tablet list drawer (MainLayout) can close on any explicit room pick. */
  roomPickSeq: number;
  replyTarget: ReplyTarget | null;
  editTarget: EditTarget | null;
  /** Root event id of the thread currently shown in the side panel, if any. */
  activeThreadRootId: string | null;
  /**
   * Whether the open thread was entered from the threads list rather than from
   * the timeline. `closeThread` ("back") then re-opens the list instead of
   * dropping the user on the chat two levels away from where they were.
   */
  threadOpenedFromList: boolean;
  /** The "all threads in this room" list panel. */
  threadsListOpen: boolean;
  searchOpen: boolean;
  /** Full-width widgets panel (replaces the timeline/composer while open, like Element's widget view). */
  widgetsPanelOpen: boolean;
  /** Event id the Timeline should paginate to and highlight, set by a search result "jump". */
  jumpToEventId: string | null;
  /**
   * A user the composer should insert an @mention for - set by middle-clicking
   * a message author / member row. A fresh object each request so the composer
   * effect re-fires even for the same person twice.
   */
  pendingMention: { userId: string; displayName: string } | null;
  /**
   * Room id whose watch-together bar should (re)open - set by clicking a
   * "Csatlakozás" invite card in the timeline, so someone who dismissed the
   * bar (or is scrolled up in history) can get back into a still-live
   * session with one click instead of it being gone until a new one starts.
   */
  pendingWatchTogetherJoin: string | null;
  selectSpace: (spaceId: string | null, roomId?: string | null) => void;
  selectRoom: (roomId: string | null) => void;
  openFriends: () => void;
  openEvents: () => void;
  openInbox: () => void;
  toggleMemberList: () => void;
  setMemberListOpen: (open: boolean) => void;
  startReply: (target: ReplyTarget) => void;
  startEdit: (target: EditTarget) => void;
  clearComposerTarget: () => void;
  openThread: (rootEventId: string, opts?: { fromList?: boolean }) => void;
  closeThread: () => void;
  toggleThreadsList: () => void;
  closeThreadsList: () => void;
  toggleSearch: () => void;
  closeSearch: () => void;
  toggleWidgetsPanel: () => void;
  jumpToEvent: (eventId: string) => void;
  clearJumpToEvent: () => void;
  requestMention: (userId: string, displayName: string) => void;
  clearPendingMention: () => void;
  requestWatchTogetherJoin: (roomId: string) => void;
  clearPendingWatchTogetherJoin: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  selectedSpaceId: null,
  selectedRoomId: null,
  friendsViewOpen: false,
  eventsViewOpen: false,
  inboxViewOpen: false,
  memberListOpen: true,
  roomPickSeq: 0,
  replyTarget: null,
  editTarget: null,
  activeThreadRootId: null,
  threadOpenedFromList: false,
  threadsListOpen: false,
  searchOpen: false,
  widgetsPanelOpen: false,
  jumpToEventId: null,
  pendingMention: null,
  pendingWatchTogetherJoin: null,
  selectSpace: (spaceId, roomId = null) => {
    captureCurrentRoomScrollMemory();
    if (roomId) persistLastRoom(spaceId, roomId);
    set({
      selectedSpaceId: spaceId,
      selectedRoomId: roomId,
      friendsViewOpen: false,
      eventsViewOpen: false,
      inboxViewOpen: false,
    });
  },
  selectRoom: (roomId) => {
    captureCurrentRoomScrollMemory();
    if (roomId) persistLastRoom(get().selectedSpaceId, roomId);
    set({
      selectedRoomId: roomId,
      roomPickSeq: get().roomPickSeq + 1,
      friendsViewOpen: false,
      eventsViewOpen: false,
      inboxViewOpen: false,
      replyTarget: null,
      editTarget: null,
      activeThreadRootId: null,
      threadOpenedFromList: false,
      threadsListOpen: false,
      searchOpen: false,
      widgetsPanelOpen: false,
    });
  },
  openFriends: () => {
    captureCurrentRoomScrollMemory();
    set({
      selectedSpaceId: null,
      selectedRoomId: null,
      friendsViewOpen: true,
      eventsViewOpen: false,
      inboxViewOpen: false,
      replyTarget: null,
      editTarget: null,
      activeThreadRootId: null,
      threadOpenedFromList: false,
      threadsListOpen: false,
      searchOpen: false,
    });
  },
  openEvents: () => {
    captureCurrentRoomScrollMemory();
    set({
      selectedSpaceId: null,
      selectedRoomId: null,
      friendsViewOpen: false,
      eventsViewOpen: true,
      inboxViewOpen: false,
      replyTarget: null,
      editTarget: null,
      activeThreadRootId: null,
      threadOpenedFromList: false,
      threadsListOpen: false,
      searchOpen: false,
    });
  },
  openInbox: () => {
    captureCurrentRoomScrollMemory();
    set({
      selectedSpaceId: null,
      selectedRoomId: null,
      friendsViewOpen: false,
      eventsViewOpen: false,
      inboxViewOpen: true,
      replyTarget: null,
      editTarget: null,
      activeThreadRootId: null,
      threadOpenedFromList: false,
      threadsListOpen: false,
      searchOpen: false,
    });
  },
  toggleMemberList: () => set((s) => ({ memberListOpen: !s.memberListOpen })),
  setMemberListOpen: (open) => set({ memberListOpen: open }),
  startReply: (target) => set({ replyTarget: target, editTarget: null }),
  startEdit: (target) => set({ editTarget: target, replyTarget: null }),
  clearComposerTarget: () => set({ replyTarget: null, editTarget: null }),
  openThread: (rootEventId, opts) =>
    set({
      activeThreadRootId: rootEventId,
      threadsListOpen: false,
      searchOpen: false,
      threadOpenedFromList: opts?.fromList ?? false,
    }),
  // "Back" out of a thread one level, not all the way to the chat: a thread
  // entered from the threads list returns there, so the panel the user came
  // from is never silently swallowed by the navigation.
  closeThread: () =>
    set((s) => ({
      activeThreadRootId: null,
      threadsListOpen: s.threadOpenedFromList,
      threadOpenedFromList: false,
    })),
  toggleThreadsList: () =>
    set((s) => ({
      threadsListOpen: !s.threadsListOpen,
      activeThreadRootId: null,
      threadOpenedFromList: false,
      searchOpen: false,
      widgetsPanelOpen: false,
    })),
  closeThreadsList: () => set({ threadsListOpen: false }),
  toggleSearch: () =>
    set((s) => ({ searchOpen: !s.searchOpen, activeThreadRootId: null, threadOpenedFromList: false, threadsListOpen: false })),
  closeSearch: () => set({ searchOpen: false }),
  toggleWidgetsPanel: () => set((s) => ({ widgetsPanelOpen: !s.widgetsPanelOpen })),
  jumpToEvent: (eventId) =>
    set({ jumpToEventId: eventId, searchOpen: false, activeThreadRootId: null, threadOpenedFromList: false, threadsListOpen: false }),
  clearJumpToEvent: () => set({ jumpToEventId: null }),
  requestMention: (userId, displayName) => set({ pendingMention: { userId, displayName } }),
  clearPendingMention: () => set({ pendingMention: null }),
  requestWatchTogetherJoin: (roomId) => set({ pendingWatchTogetherJoin: roomId }),
  clearPendingWatchTogetherJoin: () => set({ pendingWatchTogetherJoin: null }),
}));
