// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  nextDialogId,
  useDialogStore,
  type DialogRequest,
} from "../../../apps/web/src/state/dialogStore.js";
import { useModalStore } from "../../../apps/web/src/state/modalStore.js";
import { getLastRoomForScope, useUiStore } from "../../../apps/web/src/state/uiStore.js";
import { useLightboxStore, type LightboxItem } from "../../../apps/web/src/state/lightboxStore.js";

/**
 * Pure state-reducer tests for the transient-UI zustand stores. authStore /
 * matrixStore are deliberately NOT imported (they touch the real MatrixClient).
 *
 * zustand itself is not mocked: we drive each store through its real actions
 * via useStore.getState() and assert on state snapshots, resetting state back
 * to the documented initial values before every test.
 */

function resetStores(): void {
  useDialogStore.setState({ queue: [], resolvers: new Map() });
  useModalStore.setState({ modal: null });
  useLightboxStore.setState({ item: null });
  useUiStore.setState({
    selectedSpaceId: null,
    selectedRoomId: null,
    friendsViewOpen: false,
    eventsViewOpen: false,
    inboxViewOpen: false,
    memberListOpen: true,
    replyTarget: null,
    editTarget: null,
    activeThreadRootId: null,
    threadsListOpen: false,
    searchOpen: false,
    widgetsPanelOpen: false,
    jumpToEventId: null,
    pendingMention: null,
    pendingWatchTogetherJoin: null,
  });
}

beforeEach(() => {
  // uiStore persists "last room per scope" to localStorage; keep tests isolated.
  localStorage.clear();
  resetStores();
});

describe("dialogStore", () => {
  const confirmRequest = (id: number): DialogRequest => ({
    id,
    kind: "confirm",
    message: "Biztosan kilépsz?",
    danger: true,
    confirmLabel: "Kilépés",
  });

  it("starts with an empty queue and no resolvers", () => {
    expect(useDialogStore.getState().queue).toEqual([]);
    expect(useDialogStore.getState().resolvers.size).toBe(0);
  });

  it("push appends the request to the queue in order", () => {
    const a = nextDialogId();
    const b = nextDialogId();
    useDialogStore.getState().push({ id: a, kind: "alert", message: "first" }, () => {});
    useDialogStore.getState().push(confirmRequest(b), () => {});

    const queue = useDialogStore.getState().queue;
    expect(queue.map((d) => d.id)).toEqual([a, b]);
    expect(queue[0]).toMatchObject({ kind: "alert", message: "first" });
    expect(queue[1]).toMatchObject({ kind: "confirm", message: "Biztosan kilépsz?", danger: true });
  });

  it("push registers the resolver keyed by request id", () => {
    const id = nextDialogId();
    const resolver = () => {};
    useDialogStore.getState().push(confirmRequest(id), resolver);
    expect(useDialogStore.getState().resolvers.get(id)).toBe(resolver);
  });

  it("settle resolves the stored promise with the given value and removes the dialog", async () => {
    const id = nextDialogId();
    const settled = new Promise<unknown>((resolve) => {
      useDialogStore.getState().push(confirmRequest(id), resolve as (value: unknown) => void);
    });

    useDialogStore.getState().settle(id, true);
    await expect(settled).resolves.toBe(true);
    expect(useDialogStore.getState().queue.map((d) => d.id)).toEqual([]);
    expect(useDialogStore.getState().resolvers.has(id)).toBe(false);
  });

  it("settle only removes the matching dialog from the stack (others stay layered)", () => {
    const a = nextDialogId();
    const b = nextDialogId();
    useDialogStore.getState().push({ id: a, kind: "alert", message: "first" }, () => {});
    useDialogStore.getState().push({ id: b, kind: "prompt", message: "second" }, () => {});

    useDialogStore.getState().settle(a, undefined);
    expect(useDialogStore.getState().queue.map((d) => d.id)).toEqual([b]);
  });

  it("settle of a prompt passes the string value through", async () => {
    const id = nextDialogId();
    const settled = new Promise<unknown>((resolve) => {
      useDialogStore
        .getState()
        .push({ id, kind: "prompt", message: "Név?" }, resolve as (value: unknown) => void);
    });

    useDialogStore.getState().settle(id, " új név ");
    await expect(settled).resolves.toBe(" új név ");
  });

  it("settle with an unknown id is a harmless no-op", () => {
    const id = nextDialogId();
    useDialogStore.getState().push(confirmRequest(id), () => {});

    expect(() => useDialogStore.getState().settle(9999, true)).not.toThrow();
    expect(useDialogStore.getState().queue.map((d) => d.id)).toEqual([id]);
  });

  it("nextDialogId hands out monotonically increasing ids", () => {
    const a = nextDialogId();
    const b = nextDialogId();
    expect(b).toBeGreaterThan(a);
  });
});

describe("modalStore", () => {
  it("starts with no modal open", () => {
    expect(useModalStore.getState().modal).toBeNull();
  });

  it("open stores the modal payload verbatim", () => {
    useModalStore.getState().open({ type: "createRoom", parentSpaceId: null });
    expect(useModalStore.getState().modal).toEqual({ type: "createRoom", parentSpaceId: null });

    useModalStore
      .getState()
      .open({ type: "forwardMessage", roomId: "!room:example.org", eventId: "$ev1" });
    expect(useModalStore.getState().modal).toEqual({
      type: "forwardMessage",
      roomId: "!room:example.org",
      eventId: "$ev1",
    });
  });

  it("close clears the modal", () => {
    useModalStore.getState().open({ type: "userSettings" });
    useModalStore.getState().close();
    expect(useModalStore.getState().modal).toBeNull();
  });

  it("is a single slot, not a stack: opening replaces the previous modal", () => {
    // Documented behaviour (see dialogStore's doc comment): modalStore holds
    // one modal at a time; layered confirm dialogs go through dialogStore.
    useModalStore.getState().open({ type: "roomSettings", roomId: "!r:example.org" });
    useModalStore.getState().open({ type: "spaceSettings", spaceId: "!s:example.org" });
    expect(useModalStore.getState().modal).toEqual({
      type: "spaceSettings",
      spaceId: "!s:example.org",
    });
  });

  it("close when nothing is open stays closed", () => {
    expect(() => useModalStore.getState().close()).not.toThrow();
    expect(useModalStore.getState().modal).toBeNull();
  });
});

describe("lightboxStore", () => {
  const plainItem: LightboxItem = {
    content: { url: "mxc://example.org/plain" },
    name: "kép.png",
  };
  const encryptedVideoItem: LightboxItem = {
    content: { file: { url: "mxc://example.org/enc", key: {} as never, iv: "", hashes: {} } },
    name: "videó.mp4",
    video: true,
  };

  it("starts closed", () => {
    expect(useLightboxStore.getState().item).toBeNull();
  });

  it("open stores the item payload including the video flag", () => {
    useLightboxStore.getState().open(plainItem);
    expect(useLightboxStore.getState().item).toEqual(plainItem);

    useLightboxStore.getState().open(encryptedVideoItem);
    expect(useLightboxStore.getState().item).toEqual(encryptedVideoItem);
    expect(useLightboxStore.getState().item?.video).toBe(true);
  });

  it("close clears the item", () => {
    useLightboxStore.getState().open(plainItem);
    useLightboxStore.getState().close();
    expect(useLightboxStore.getState().item).toBeNull();
  });

  it("opening a second image replaces the first", () => {
    useLightboxStore.getState().open(plainItem);
    useLightboxStore.getState().open({ content: { url: "mxc://example.org/other" }, name: "b.png" });
    expect(useLightboxStore.getState().item?.name).toBe("b.png");
  });
});

describe("uiStore", () => {
  it("starts on Home with no room, member list open and every panel closed", () => {
    const s = useUiStore.getState();
    expect(s.selectedSpaceId).toBeNull();
    expect(s.selectedRoomId).toBeNull();
    expect(s.friendsViewOpen).toBe(false);
    expect(s.eventsViewOpen).toBe(false);
    expect(s.inboxViewOpen).toBe(false);
    expect(s.memberListOpen).toBe(true);
    expect(s.threadsListOpen).toBe(false);
    expect(s.searchOpen).toBe(false);
    expect(s.widgetsPanelOpen).toBe(false);
    expect(s.jumpToEventId).toBeNull();
  });

  describe("selection", () => {
    it("selectSpace sets the space and optional room and closes the home tabs", () => {
      useUiStore.getState().openFriends();
      useUiStore.getState().selectSpace("!space:example.org", "!room:example.org");

      const s = useUiStore.getState();
      expect(s.selectedSpaceId).toBe("!space:example.org");
      expect(s.selectedRoomId).toBe("!room:example.org");
      expect(s.friendsViewOpen).toBe(false);
      expect(s.eventsViewOpen).toBe(false);
      expect(s.inboxViewOpen).toBe(false);
    });

    it("selectSpace with a room remembers it per space scope", () => {
      useUiStore.getState().selectSpace("!space:example.org", "!roomA:example.org");
      expect(getLastRoomForScope("!space:example.org")).toBe("!roomA:example.org");
      expect(getLastRoomForScope(null)).toBeNull();
    });

    it("selectSpace without a room does not touch the last-room memory", () => {
      useUiStore.getState().selectSpace("!space:example.org");
      expect(getLastRoomForScope("!space:example.org")).toBeNull();
    });

    it("selectRoom switches rooms, remembers the last room for the current scope and closes panels", () => {
      useUiStore.getState().selectSpace("!space:example.org", "!roomA:example.org");
      useUiStore.setState({
        replyTarget: { eventId: "$1", senderName: "Bob", body: "hi" },
        editTarget: { eventId: "$1", body: "hi" },
        activeThreadRootId: "$1",
        threadsListOpen: true,
        searchOpen: true,
        widgetsPanelOpen: true,
      });

      useUiStore.getState().selectRoom("!roomB:example.org");

      const s = useUiStore.getState();
      expect(s.selectedRoomId).toBe("!roomB:example.org");
      expect(s.selectedSpaceId).toBe("!space:example.org");
      expect(getLastRoomForScope("!space:example.org")).toBe("!roomB:example.org");
      expect(s.replyTarget).toBeNull();
      expect(s.editTarget).toBeNull();
      expect(s.activeThreadRootId).toBeNull();
      expect(s.threadsListOpen).toBe(false);
      expect(s.searchOpen).toBe(false);
      expect(s.widgetsPanelOpen).toBe(false);
    });

    it("selectRoom(null) leaves the room without persisting last-room memory", () => {
      useUiStore.getState().selectSpace("!space:example.org", "!roomA:example.org");
      useUiStore.getState().selectRoom(null);
      expect(useUiStore.getState().selectedRoomId).toBeNull();
      expect(getLastRoomForScope("!space:example.org")).toBe("!roomA:example.org");
    });
  });

  describe("home tabs", () => {
    it("openFriends selects Home and activates only the friends tab", () => {
      useUiStore.getState().openEvents();
      useUiStore.getState().openFriends();

      const s = useUiStore.getState();
      expect(s.selectedSpaceId).toBeNull();
      expect(s.selectedRoomId).toBeNull();
      expect(s.friendsViewOpen).toBe(true);
      expect(s.eventsViewOpen).toBe(false);
      expect(s.inboxViewOpen).toBe(false);
    });

    it("openEvents is mutually exclusive with the other tabs", () => {
      useUiStore.getState().openFriends();
      useUiStore.getState().openEvents();
      expect(useUiStore.getState().eventsViewOpen).toBe(true);
      expect(useUiStore.getState().friendsViewOpen).toBe(false);
      expect(useUiStore.getState().inboxViewOpen).toBe(false);
    });

    it("openInbox is mutually exclusive with the other tabs", () => {
      useUiStore.getState().openFriends();
      useUiStore.getState().openInbox();
      expect(useUiStore.getState().inboxViewOpen).toBe(true);
      expect(useUiStore.getState().friendsViewOpen).toBe(false);
      expect(useUiStore.getState().eventsViewOpen).toBe(false);
    });

    it("opening a home tab drops any active reply/edit/thread/search state", () => {
      useUiStore.setState({
        replyTarget: { eventId: "$1", senderName: "Bob", body: "hi" },
        editTarget: { eventId: "$1", body: "hi" },
        activeThreadRootId: "$1",
        threadsListOpen: true,
        searchOpen: true,
      });
      useUiStore.getState().openInbox();

      const s = useUiStore.getState();
      expect(s.replyTarget).toBeNull();
      expect(s.editTarget).toBeNull();
      expect(s.activeThreadRootId).toBeNull();
      expect(s.threadsListOpen).toBe(false);
      expect(s.searchOpen).toBe(false);
    });
  });

  describe("member list", () => {
    it("toggleMemberList flips the flag", () => {
      expect(useUiStore.getState().memberListOpen).toBe(true);
      useUiStore.getState().toggleMemberList();
      expect(useUiStore.getState().memberListOpen).toBe(false);
      useUiStore.getState().toggleMemberList();
      expect(useUiStore.getState().memberListOpen).toBe(true);
    });

    it("setMemberListOpen sets it explicitly", () => {
      useUiStore.getState().setMemberListOpen(false);
      expect(useUiStore.getState().memberListOpen).toBe(false);
      useUiStore.getState().setMemberListOpen(false);
      expect(useUiStore.getState().memberListOpen).toBe(false);
    });
  });

  describe("composer targets", () => {
    it("startReply sets the reply target and clears any edit target", () => {
      useUiStore.getState().startEdit({ eventId: "$1", body: "old" });
      const reply = { eventId: "$2", senderName: "Alice", body: "hello" };
      useUiStore.getState().startReply(reply);

      expect(useUiStore.getState().replyTarget).toEqual(reply);
      expect(useUiStore.getState().editTarget).toBeNull();
    });

    it("startEdit sets the edit target and clears any reply target", () => {
      useUiStore.getState().startReply({ eventId: "$2", senderName: "Alice", body: "hello" });
      useUiStore.getState().startEdit({ eventId: "$1", body: "fix" });

      expect(useUiStore.getState().editTarget).toEqual({ eventId: "$1", body: "fix" });
      expect(useUiStore.getState().replyTarget).toBeNull();
    });

    it("clearComposerTarget clears both", () => {
      useUiStore.getState().startReply({ eventId: "$2", senderName: "Alice", body: "hello" });
      useUiStore.getState().clearComposerTarget();

      expect(useUiStore.getState().replyTarget).toBeNull();
      expect(useUiStore.getState().editTarget).toBeNull();
    });
  });

  describe("threads", () => {
    it("openThread sets the root id and closes the threads list and search", () => {
      useUiStore.getState().toggleThreadsList();
      useUiStore.getState().toggleSearch();
      useUiStore.getState().openThread("$root");

      const s = useUiStore.getState();
      expect(s.activeThreadRootId).toBe("$root");
      expect(s.threadsListOpen).toBe(false);
      expect(s.searchOpen).toBe(false);
    });

    it("closeThread only clears the root id for a thread opened from the timeline", () => {
      useUiStore.getState().toggleThreadsList();
      useUiStore.getState().openThread("$root");
      useUiStore.getState().closeThread();

      expect(useUiStore.getState().activeThreadRootId).toBeNull();
      expect(useUiStore.getState().threadsListOpen).toBe(false);
    });

    it("closeThread on a thread opened from the threads list goes back to the list", () => {
      // The back gesture out of a thread must return to the surface it was
      // entered from, not drop the user on the chat two levels away.
      useUiStore.getState().toggleThreadsList();
      useUiStore.getState().openThread("$root", { fromList: true });
      useUiStore.getState().closeThread();

      const s = useUiStore.getState();
      expect(s.activeThreadRootId).toBeNull();
      expect(s.threadsListOpen).toBe(true);
      // The one-shot origin flag is consumed, so a later thread opened from
      // the timeline doesn't inherit it.
      expect(s.threadOpenedFromList).toBe(false);
    });

    it("selectRoom clears a thread's from-list origin without reopening the list", () => {
      useUiStore.getState().toggleThreadsList();
      useUiStore.getState().openThread("$root", { fromList: true });
      useUiStore.getState().selectRoom("!other:example.org");

      const s = useUiStore.getState();
      expect(s.activeThreadRootId).toBeNull();
      expect(s.threadsListOpen).toBe(false);
      expect(s.threadOpenedFromList).toBe(false);
    });

    it("opening a thread straight after a from-list one overwrites the origin", () => {
      useUiStore.getState().toggleThreadsList();
      useUiStore.getState().openThread("$a", { fromList: true });
      useUiStore.getState().openThread("$b");
      useUiStore.getState().closeThread();

      expect(useUiStore.getState().threadsListOpen).toBe(false);
    });

    it("toggleThreadsList opens the list and closes the thread panel, search and widgets", () => {
      useUiStore.getState().openThread("$root");
      useUiStore.getState().toggleSearch();
      useUiStore.getState().toggleWidgetsPanel();
      useUiStore.getState().toggleThreadsList();

      const s = useUiStore.getState();
      expect(s.threadsListOpen).toBe(true);
      expect(s.activeThreadRootId).toBeNull();
      expect(s.searchOpen).toBe(false);
      expect(s.widgetsPanelOpen).toBe(false);
    });

    it("toggleThreadsList twice closes the list again", () => {
      useUiStore.getState().toggleThreadsList();
      useUiStore.getState().toggleThreadsList();
      expect(useUiStore.getState().threadsListOpen).toBe(false);
    });

    it("closeThreadsList closes the list without touching the open thread", () => {
      useUiStore.getState().toggleThreadsList();
      useUiStore.getState().openThread("$root");
      useUiStore.getState().closeThreadsList();

      expect(useUiStore.getState().threadsListOpen).toBe(false);
      expect(useUiStore.getState().activeThreadRootId).toBe("$root");
    });
  });

  describe("search", () => {
    it("toggleSearch flips the flag and closes thread panels", () => {
      useUiStore.getState().openThread("$root");
      useUiStore.getState().toggleThreadsList();
      useUiStore.getState().toggleSearch();

      const s = useUiStore.getState();
      expect(s.searchOpen).toBe(true);
      expect(s.activeThreadRootId).toBeNull();
      expect(s.threadsListOpen).toBe(false);
    });

    it("closeSearch closes it without touching other state", () => {
      useUiStore.getState().toggleSearch();
      useUiStore.getState().closeSearch();
      expect(useUiStore.getState().searchOpen).toBe(false);
    });
  });

  it("toggleWidgetsPanel flips the full-width widgets view", () => {
    expect(useUiStore.getState().widgetsPanelOpen).toBe(false);
    useUiStore.getState().toggleWidgetsPanel();
    expect(useUiStore.getState().widgetsPanelOpen).toBe(true);
    useUiStore.getState().toggleWidgetsPanel();
    expect(useUiStore.getState().widgetsPanelOpen).toBe(false);
  });

  it("jumpToEvent sets the jump id and closes search/thread/threads-list", () => {
    useUiStore.getState().toggleSearch();
    useUiStore.getState().openThread("$root");
    useUiStore.getState().jumpToEvent("$target");

    const s = useUiStore.getState();
    expect(s.jumpToEventId).toBe("$target");
    expect(s.searchOpen).toBe(false);
    expect(s.activeThreadRootId).toBeNull();
    expect(s.threadsListOpen).toBe(false);
  });

  it("clearJumpToEvent resets the jump id", () => {
    useUiStore.getState().jumpToEvent("$target");
    useUiStore.getState().clearJumpToEvent();
    expect(useUiStore.getState().jumpToEventId).toBeNull();
  });

  it("requestMention stores the pending mention, clearPendingMention drops it", () => {
    useUiStore.getState().requestMention("@alice:example.org", "Alice");
    expect(useUiStore.getState().pendingMention).toEqual({
      userId: "@alice:example.org",
      displayName: "Alice",
    });

    useUiStore.getState().clearPendingMention();
    expect(useUiStore.getState().pendingMention).toBeNull();
  });

  it("a second requestMention replaces the first (fresh object each request)", () => {
    useUiStore.getState().requestMention("@alice:example.org", "Alice");
    useUiStore.getState().requestMention("@bob:example.org", "Bob");
    expect(useUiStore.getState().pendingMention).toEqual({
      userId: "@bob:example.org",
      displayName: "Bob",
    });
  });

  it("requestWatchTogetherJoin stores the room id, clear drops it", () => {
    useUiStore.getState().requestWatchTogetherJoin("!room:example.org");
    expect(useUiStore.getState().pendingWatchTogetherJoin).toBe("!room:example.org");

    useUiStore.getState().clearPendingWatchTogetherJoin();
    expect(useUiStore.getState().pendingWatchTogetherJoin).toBeNull();
  });
});
