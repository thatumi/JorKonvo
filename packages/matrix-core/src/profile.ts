import type { MatrixClient } from "matrix-js-sdk";

export async function setDisplayName(client: MatrixClient, name: string): Promise<void> {
  await client.setDisplayName(name);
}

/** Uploads a new avatar image and sets it as the user's profile picture. */
export async function setAvatarImage(client: MatrixClient, file: File): Promise<void> {
  const upload = await client.uploadContent(file, { type: file.type });
  await client.setAvatarUrl(upload.content_uri);
}

/** Sets a custom status message (e.g. "épp kávézik"), keeping the current online/idle/offline presence. */
export async function setStatusMessage(client: MatrixClient, statusMsg: string): Promise<void> {
  const own = client.getUser(client.getUserId() ?? "");
  const presence = (own?.presence as "online" | "offline" | "unavailable" | undefined) ?? "online";
  await client.setPresence({ presence, status_msg: statusMsg || undefined });
}

const BIO_KEY = "io.jorkonvo.bio";

/**
 * Discord-style longer "About Me" bio - unlike the single-line presence
 * status_msg above, this needs somewhere to live that's global (visible to
 * anyone, not just people sharing a room with you right now, the way a
 * per-room member-event field would be) but isn't the Matrix spec proper
 * (which has no such field at all). MSC4133 "extended profiles" is exactly
 * this: an arbitrary key/value store alongside displayname/avatar_url,
 * readable by anyone via GET /profile/{userId}/{key} with no shared-room
 * requirement, the same way avatar/displayname already work. Namespaced
 * under io.jorkonvo.* like this app's other custom fields, since MSC4133
 * doesn't reserve a "bio" key of its own.
 */
export async function serverSupportsBio(client: MatrixClient): Promise<boolean> {
  try {
    return await client.doesServerSupportExtendedProfiles();
  } catch {
    return false;
  }
}

export async function getBio(client: MatrixClient, userId: string): Promise<string | null> {
  try {
    const value = await client.getExtendedProfileProperty(userId, BIO_KEY);
    return typeof value === "string" && value.trim() ? value : null;
  } catch {
    // Not supported, nothing set, or the profile doesn't exist - a missing bio is never an error to surface.
    return null;
  }
}

export async function setBio(client: MatrixClient, bio: string): Promise<void> {
  if (bio.trim()) {
    await client.setExtendedProfileProperty(BIO_KEY, bio);
  } else {
    await client.deleteExtendedProfileProperty(BIO_KEY).catch(() => undefined);
  }
}

const BANNER_KEY = "io.jorkonvo.banner_url";

/** Discord-style profile banner - same MSC4133 extended-profile mechanism as the bio above, storing an uploaded image's mxc:// URL rather than the image itself. */
export async function getBanner(client: MatrixClient, userId: string): Promise<string | null> {
  try {
    const value = await client.getExtendedProfileProperty(userId, BANNER_KEY);
    return typeof value === "string" && value.trim() ? value : null;
  } catch {
    return null;
  }
}

/** Uploads a new banner image and sets it as the account's global banner (visible to anyone, not just people sharing a room). */
export async function setBannerImage(client: MatrixClient, file: File): Promise<void> {
  const upload = await client.uploadContent(file, { type: file.type });
  await client.setExtendedProfileProperty(BANNER_KEY, upload.content_uri);
}

export async function clearBanner(client: MatrixClient): Promise<void> {
  await client.deleteExtendedProfileProperty(BANNER_KEY).catch(() => undefined);
}

const DECORATION_KEY = "io.jorkonvo.avatar_decoration";
const PROFILE_ACCENT_KEY = "io.jorkonvo.profile_accent";

/**
 * Discord-style avatar decoration - a (usually animated, transparent) frame
 * image drawn on top of the profile picture. Same MSC4133 extended-profile
 * mechanism as the bio/banner: the `mxc://` of an uploaded PNG/APNG/WebP.
 */
export async function getAvatarDecoration(client: MatrixClient, userId: string): Promise<string | null> {
  try {
    const value = await client.getExtendedProfileProperty(userId, DECORATION_KEY);
    return typeof value === "string" && value.startsWith("mxc://") ? value : null;
  } catch {
    return null;
  }
}

export async function setAvatarDecoration(client: MatrixClient, file: File): Promise<void> {
  const upload = await client.uploadContent(file, { type: file.type });
  await client.setExtendedProfileProperty(DECORATION_KEY, upload.content_uri);
}

export async function clearAvatarDecoration(client: MatrixClient): Promise<void> {
  await client.deleteExtendedProfileProperty(DECORATION_KEY).catch(() => undefined);
}

/** Discord-style profile accent colour - a hex string like "#5865f2", shown behind/around the profile card. */
export async function getProfileAccent(client: MatrixClient, userId: string): Promise<string | null> {
  try {
    const value = await client.getExtendedProfileProperty(userId, PROFILE_ACCENT_KEY);
    return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export async function setProfileAccent(client: MatrixClient, hex: string | null): Promise<void> {
  if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    await client.setExtendedProfileProperty(PROFILE_ACCENT_KEY, hex);
  } else {
    await client.deleteExtendedProfileProperty(PROFILE_ACCENT_KEY).catch(() => undefined);
  }
}

/**
 * Changes the account password. `logoutDevices` (default true, matching most
 * clients) invalidates every other session as a safety measure - untick it to
 * keep other devices signed in. The current password is submitted as the
 * user-interactive-auth stage the homeserver requires for this endpoint.
 */
export async function changePassword(
  client: MatrixClient,
  currentPassword: string,
  newPassword: string,
  logoutDevices = true,
): Promise<void> {
  await client.setPassword(
    {
      type: "m.login.password",
      identifier: { type: "m.id.user", user: client.getUserId() ?? "" },
      user: client.getUserId() ?? "",
      password: currentPassword,
    },
    newPassword,
    logoutDevices,
  );
}
