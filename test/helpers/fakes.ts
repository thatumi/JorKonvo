/**
 * Minimal fakes for the two matrix-js-sdk objects the framework-agnostic
 * helpers in `packages/matrix-core` actually touch: `Room` (really just
 * `room.currentState` + a few getters) and `MatrixClient` (an id, a room
 * registry, and `sendStateEvent`). Deliberately hand-rolled rather than
 * `vi.mock`-ing the whole SDK - the helpers only ever reach for a tiny,
 * stable slice of the surface, and a real fake keeps the tests readable.
 */

export interface FakeStateEvent {
  getContent: () => Record<string, unknown>;
  getSender: () => string | undefined;
  getStateKey: () => string;
}

export interface FakeMember {
  userId: string;
  membership: string;
  powerLevel?: number;
  name?: string;
}

interface RoomOpts {
  roomId?: string;
  /** `{ "<type>|<stateKey>": content }` - stateKey defaults to "". */
  state?: Record<string, Record<string, unknown>>;
  /** `{ "<type>|<stateKey>": senderUserId }` for events whose sender matters. */
  stateSenders?: Record<string, string>;
  members?: FakeMember[];
  name?: string;
  canonicalAlias?: string | null;
  isSpace?: boolean;
}

export class FakeRoom {
  roomId: string;
  name: string;
  private _alias: string | null;
  private _isSpace: boolean;
  private _members: FakeMember[];
  currentState: {
    getStateEvents: {
      (type: string): FakeStateEvent[];
      (type: string, stateKey: string): FakeStateEvent | null;
    };
    maySendStateEvent: (type: string, userId: string) => boolean;
    maySendEvent: (type: string, userId: string) => boolean;
    hasSufficientPowerLevelFor: (action: string, level: number) => boolean;
  };

  constructor(opts: RoomOpts = {}) {
    this.roomId = opts.roomId ?? "!room:test";
    this.name = opts.name ?? "Test Room";
    this._alias = opts.canonicalAlias ?? null;
    this._isSpace = opts.isSpace ?? false;
    this._members = opts.members ?? [];
    const state = opts.state ?? {};
    const senders = opts.stateSenders ?? {};

    const mk = (key: string): FakeStateEvent => ({
      getContent: () => state[key]!,
      getSender: () => senders[key],
      getStateKey: () => key.slice(key.indexOf("|") + 1),
    });
    const getStateEvents = ((type: string, stateKey?: string) => {
      if (stateKey === undefined) {
        return Object.keys(state)
          .filter((k) => k === `${type}|` || k.startsWith(`${type}|`))
          .map(mk);
      }
      const key = `${type}|${stateKey}`;
      return key in state ? mk(key) : null;
    }) as FakeRoom["currentState"]["getStateEvents"];

    this.currentState = {
      getStateEvents,
      maySendStateEvent: (type: string, userId: string) => this.powerOf(userId) >= this.stateThreshold(type),
      maySendEvent: (type: string, userId: string) => this.powerOf(userId) >= this.eventThreshold(type),
      hasSufficientPowerLevelFor: (action: string, level: number) => {
        const pls = this.powerLevelsContent();
        const specDefaults: Record<string, number> = { redact: 50, kick: 50, ban: 50, invite: 0 };
        const req = typeof pls[action] === "number" ? (pls[action] as number) : (specDefaults[action] ?? 50);
        return level >= req;
      },
    };
  }

  private powerLevelsContent(): Record<string, unknown> {
    return this.currentState.getStateEvents("m.room.power_levels", "")?.getContent() ?? {};
  }

  powerOf(userId: string): number {
    const pls = this.powerLevelsContent();
    const users = (pls.users as Record<string, number> | undefined) ?? {};
    if (userId in users) return users[userId]!;
    const explicit = this._members.find((m) => m.userId === userId)?.powerLevel;
    if (typeof explicit === "number") return explicit;
    return (pls.users_default as number | undefined) ?? 0;
  }

  private stateThreshold(type: string): number {
    const pls = this.powerLevelsContent();
    const events = (pls.events as Record<string, number> | undefined) ?? {};
    if (type in events) return events[type]!;
    return (pls.state_default as number | undefined) ?? 50;
  }

  private eventThreshold(type: string): number {
    const pls = this.powerLevelsContent();
    const events = (pls.events as Record<string, number> | undefined) ?? {};
    if (type in events) return events[type]!;
    return (pls.events_default as number | undefined) ?? 0;
  }

  getCanonicalAlias(): string | null {
    return this._alias;
  }

  isSpaceRoom(): boolean {
    return this._isSpace;
  }

  getType(): string | undefined {
    return this._isSpace ? "m.space" : undefined;
  }

  getLastActiveTimestamp(): number {
    return 0;
  }

  getDMInviter(): string | undefined {
    return undefined;
  }

  getMyMembership(): string {
    return "join";
  }

  getMember(userId: string): FakeMember | null {
    return this._members.find((m) => m.userId === userId) ?? null;
  }

  getMembersWithMembership(membership: string): FakeMember[] {
    return this._members.filter((m) => m.membership === membership);
  }

  getJoinedMembers(): FakeMember[] {
    return this._members.filter((m) => m.membership === "join");
  }
}

interface ClientOpts {
  userId?: string;
  rooms?: FakeRoom[];
  baseUrl?: string;
}

export class FakeClient {
  private _userId: string;
  private _rooms: Map<string, FakeRoom>;
  baseUrl: string;
  /** Every `sendStateEvent` call, in order - lets a test assert what got written. */
  sentStateEvents: { roomId: string; type: string; content: unknown; stateKey: string }[] = [];

  constructor(opts: ClientOpts = {}) {
    this._userId = opts.userId ?? "@me:test";
    this._rooms = new Map((opts.rooms ?? []).map((r) => [r.roomId, r]));
    this.baseUrl = opts.baseUrl ?? "https://hs.test";
  }

  getUserId(): string {
    return this._userId;
  }

  getRoom(roomId: string): FakeRoom | null {
    return this._rooms.get(roomId) ?? null;
  }

  getRooms(): FakeRoom[] {
    return [...this._rooms.values()];
  }

  async sendStateEvent(roomId: string, type: string, content: unknown, stateKey = ""): Promise<{ event_id: string }> {
    this.sentStateEvents.push({ roomId, type, content, stateKey });
    return { event_id: `$evt${this.sentStateEvents.length}` };
  }

  mxcUrlToHttp(mxc: string, w?: number, h?: number, method?: string): string | null {
    if (!mxc.startsWith("mxc://")) return null;
    const [server, id] = mxc.slice(6).split("/");
    return `${this.baseUrl}/_matrix/media/v3/thumbnail/${server}/${id}?width=${w}&height=${h}&method=${method}`;
  }
}
