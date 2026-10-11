import { type MatrixClient, MsgType } from "matrix-js-sdk";
import { banMember, kickMember, unbanMember } from "./moderation.js";
import { setDisplayName } from "./profile.js";
import { leaveRoom, setRoomTopic } from "./room-admin.js";
import { sendTextMessage } from "./messages.js";

export interface SlashCommandSpec {
  name: string;
  usage: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommandSpec[] = [
  { name: "me", usage: "/me <cselekvés>", description: "Akció-üzenet küldése (pl. /me mosolyog)" },
  { name: "shrug", usage: "/shrug [üzenet]", description: "¯\\_(ツ)_/¯ hozzáfűzése az üzenethez" },
  { name: "nick", usage: "/nick <új név>", description: "Megjelenített neved módosítása" },
  { name: "topic", usage: "/topic <szöveg>", description: "Szoba témájának beállítása" },
  { name: "invite", usage: "/invite @felhasználó:szerver", description: "Felhasználó meghívása a szobába" },
  { name: "kick", usage: "/kick @felhasználó:szerver [indoklás]", description: "Felhasználó kirúgása a szobából" },
  { name: "ban", usage: "/ban @felhasználó:szerver [indoklás]", description: "Felhasználó kitiltása a szobából" },
  { name: "unban", usage: "/unban @felhasználó:szerver", description: "Kitiltás visszavonása" },
  { name: "part", usage: "/part", description: "Szoba elhagyása" },
  { name: "help", usage: "/help", description: "Elérhető parancsok listázása" },
];

const KNOWN_COMMANDS = new Set(SLASH_COMMANDS.map((c) => c.name));

export interface ParsedCommand {
  name: string;
  args: string;
}

export function parseSlashCommand(input: string): ParsedCommand | null {
  if (!input.startsWith("/")) return null;
  const spaceIdx = input.indexOf(" ");
  const name = (spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx)).toLowerCase();
  if (!name) return null;
  const args = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1).trim();
  return { name, args };
}

export interface CommandResult {
  /** Local-only feedback to show the user (error or info) - never sent to the room. */
  message?: string;
  /** Set when the command caused the composer's room to be left/parted. */
  leftRoom?: boolean;
}

/**
 * Recognizes and runs a slash command typed into the composer.
 * Returns `null` when `input` isn't a recognized command at all (the caller
 * should send it as a normal text message instead), or a `CommandResult`
 * once the command has been dispatched (successfully or not - failures are
 * reported via `message`, never thrown).
 */
export async function runSlashCommand(
  client: MatrixClient,
  roomId: string,
  input: string,
): Promise<CommandResult | null> {
  const parsed = parseSlashCommand(input);
  if (!parsed || !KNOWN_COMMANDS.has(parsed.name)) return null;
  const { name, args } = parsed;

  try {
    switch (name) {
      case "me": {
        if (!args) return { message: "Használat: /me <cselekvés>" };
        await client.sendMessage(roomId, { msgtype: MsgType.Emote, body: args });
        return {};
      }
      case "shrug": {
        const body = args ? `${args} ¯\\_(ツ)_/¯` : "¯\\_(ツ)_/¯";
        await sendTextMessage(client, roomId, body);
        return {};
      }
      case "nick": {
        if (!args) return { message: "Használat: /nick <új név>" };
        await setDisplayName(client, args);
        return { message: `Megjelenített név beállítva: ${args}` };
      }
      case "topic": {
        if (!args) return { message: "Használat: /topic <szöveg>" };
        await setRoomTopic(client, roomId, args);
        return { message: "Szoba témája frissítve." };
      }
      case "invite": {
        const userId = args.trim();
        if (!userId.startsWith("@")) return { message: "Használat: /invite @felhasználó:szerver" };
        await client.invite(roomId, userId);
        return { message: `${userId} meghívva.` };
      }
      case "kick": {
        const [userId, ...rest] = args.split(/\s+/);
        if (!userId?.startsWith("@")) return { message: "Használat: /kick @felhasználó:szerver [indoklás]" };
        await kickMember(client, roomId, userId, rest.join(" ") || undefined);
        return { message: `${userId} kirúgva.` };
      }
      case "ban": {
        const [userId, ...rest] = args.split(/\s+/);
        if (!userId?.startsWith("@")) return { message: "Használat: /ban @felhasználó:szerver [indoklás]" };
        await banMember(client, roomId, userId, rest.join(" ") || undefined);
        return { message: `${userId} kitiltva.` };
      }
      case "unban": {
        const userId = args.trim();
        if (!userId.startsWith("@")) return { message: "Használat: /unban @felhasználó:szerver" };
        await unbanMember(client, roomId, userId);
        return { message: `${userId} kitiltása visszavonva.` };
      }
      case "part": {
        await leaveRoom(client, roomId);
        return { leftRoom: true };
      }
      case "help": {
        return { message: SLASH_COMMANDS.map((c) => `${c.usage} — ${c.description}`).join("\n") };
      }
      default:
        return { message: `Ismeretlen parancs: /${name}` };
    }
  } catch (err) {
    return { message: `Hiba: ${(err as Error).message}` };
  }
}
