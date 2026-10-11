import { describe, expect, it, vi } from "vitest";
import { parseSlashCommand, runSlashCommand, SLASH_COMMANDS } from "../../../packages/matrix-core/src/commands.js";

describe("parseSlashCommand", () => {
  it("returns null for non-slash input", () => {
    expect(parseSlashCommand("hello")).toBeNull();
    expect(parseSlashCommand("")).toBeNull();
  });

  it("returns null for a bare slash", () => {
    expect(parseSlashCommand("/")).toBeNull();
  });

  it("lower-cases the command name and trims args", () => {
    expect(parseSlashCommand("/ME  waves  ")).toEqual({ name: "me", args: "waves" });
  });

  it("handles a command with no args", () => {
    expect(parseSlashCommand("/help")).toEqual({ name: "help", args: "" });
  });
});

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    getUserId: () => "@me:test",
    sendMessage: vi.fn().mockResolvedValue({ event_id: "$1" }),
    invite: vi.fn().mockResolvedValue(undefined),
    kick: vi.fn().mockResolvedValue(undefined),
    ban: vi.fn().mockResolvedValue(undefined),
    unban: vi.fn().mockResolvedValue(undefined),
    sendStateEvent: vi.fn().mockResolvedValue({ event_id: "$2" }),
    setRoomTopic: vi.fn().mockResolvedValue(undefined),
    setDisplayName: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    getRoom: () => null,
    ...overrides,
  } as never;
}

describe("runSlashCommand", () => {
  it("returns null for an unknown command so the caller sends it as text", async () => {
    expect(await runSlashCommand(fakeClient(), "!r:test", "/notacommand foo")).toBeNull();
    expect(await runSlashCommand(fakeClient(), "!r:test", "plain text")).toBeNull();
  });

  it("/me sends an m.emote", async () => {
    const client = fakeClient();
    const res = await runSlashCommand(client, "!r:test", "/me jumps");
    expect(res).toEqual({});
    expect((client as never as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage).toHaveBeenCalledWith("!r:test", {
      msgtype: "m.emote",
      body: "jumps",
    });
  });

  it("/me with no args reports usage locally and does not send", async () => {
    const client = fakeClient();
    const res = await runSlashCommand(client, "!r:test", "/me");
    expect(res?.message).toMatch(/Használat/);
    expect((client as never as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage).not.toHaveBeenCalled();
  });

  it("/shrug appends the kaomoji", async () => {
    const client = fakeClient();
    await runSlashCommand(client, "!r:test", "/shrug dunno");
    const sendMessage = (client as never as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage;
    expect(sendMessage.mock.calls[0][1].body).toBe("dunno ¯\\_(ツ)_/¯");
  });

  it("/invite rejects a non-@ target", async () => {
    const res = await runSlashCommand(fakeClient(), "!r:test", "/invite bob");
    expect(res?.message).toMatch(/Használat/);
  });

  it("/invite calls client.invite for a valid mxid", async () => {
    const client = fakeClient();
    const res = await runSlashCommand(client, "!r:test", "/invite @bob:test");
    expect(res?.message).toContain("@bob:test");
    expect((client as never as { invite: ReturnType<typeof vi.fn> }).invite).toHaveBeenCalledWith("!r:test", "@bob:test");
  });

  it("reports a thrown SDK error via message rather than throwing", async () => {
    const client = fakeClient({ ban: vi.fn().mockRejectedValue(new Error("M_FORBIDDEN")) });
    const res = await runSlashCommand(client, "!r:test", "/ban @bob:test spam");
    expect(res?.message).toBe("Hiba: M_FORBIDDEN");
  });

  it("/help lists every registered command locally", async () => {
    const res = await runSlashCommand(fakeClient(), "!r:test", "/help");
    for (const c of SLASH_COMMANDS) expect(res?.message).toContain(c.usage);
  });
});
