import type { MatrixClient } from "@jorkonvo/matrix-core";
import { useEffect, useState } from "react";
import { useMatrixStore } from "../state/matrixStore";

/**
 * Discord-Nitro-style profile "flair" that lives in the user's MSC4133
 * extended profile: an avatar decoration (frame image) and a profile accent
 * colour. Shown next to a user almost everywhere (message rows, member list,
 * popovers), so the whole extended profile is fetched once per user and
 * cached rather than re-requested on every render.
 */
export interface ProfileFlair {
  decorationMxc: string | null;
  accent: string | null;
}

const EMPTY: ProfileFlair = { decorationMxc: null, accent: null };
const cache = new Map<string, Promise<ProfileFlair>>();

function parse(raw: Record<string, unknown>): ProfileFlair {
  const dec = raw["io.jorkonvo.avatar_decoration"];
  const acc = raw["io.jorkonvo.profile_accent"];
  return {
    decorationMxc: typeof dec === "string" && dec.startsWith("mxc://") ? dec : null,
    accent: typeof acc === "string" && /^#[0-9a-fA-F]{6}$/.test(acc) ? acc : null,
  };
}

function fetchFlair(client: MatrixClient, userId: string): Promise<ProfileFlair> {
  let promise = cache.get(userId);
  if (!promise) {
    promise = (async () => {
      try {
        return parse(await client.getExtendedProfile(userId));
      } catch {
        return EMPTY;
      }
    })();
    cache.set(userId, promise);
  }
  return promise;
}

/** Call after changing your OWN flair so the next read re-fetches it. */
export function invalidateProfileFlair(userId: string): void {
  cache.delete(userId);
}

export function useProfileFlair(userId: string | null | undefined): ProfileFlair {
  const client = useMatrixStore((s) => s.client);
  const [flair, setFlair] = useState<ProfileFlair>(EMPTY);

  useEffect(() => {
    if (!client || !userId) {
      setFlair(EMPTY);
      return;
    }
    let cancelled = false;
    void fetchFlair(client, userId).then((f) => {
      if (!cancelled) setFlair(f);
    });
    return () => {
      cancelled = true;
    };
  }, [client, userId]);

  return flair;
}
