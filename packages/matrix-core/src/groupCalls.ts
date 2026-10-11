import type { MatrixClient } from "matrix-js-sdk";

export interface LiveKitConnectionInfo {
  url: string;
  jwt: string;
}

interface WellKnownRtcFocus {
  type: string;
  livekit_service_url?: string;
}

const serviceUrlCache = new Map<string, string | null>();

/**
 * Looks up the homeserver's LiveKit JWT service URL via the standard
 * `org.matrix.msc4143.rtc_foci` well-known key (the same mechanism Element
 * Call uses to discover its SFU). Cached per domain for the page's lifetime.
 */
async function getLivekitServiceUrl(client: MatrixClient): Promise<string | null> {
  const domain = client.getDomain();
  if (!domain) return null;
  if (serviceUrlCache.has(domain)) return serviceUrlCache.get(domain)!;

  let url: string | null = null;
  try {
    const res = await fetch(`https://${domain}/.well-known/matrix/client`);
    if (res.ok) {
      const data = await res.json();
      const foci = data["org.matrix.msc4143.rtc_foci"] as WellKnownRtcFocus[] | undefined;
      const livekitFocus = foci?.find((f) => f.type === "livekit" && f.livekit_service_url);
      url = livekitFocus?.livekit_service_url ?? null;
    }
  } catch {
    url = null;
  }
  serviceUrlCache.set(domain, url);
  return url;
}

export async function hasGroupCallSupport(client: MatrixClient): Promise<boolean> {
  return (await getLivekitServiceUrl(client)) !== null;
}

/**
 * lk-jwt-service mints each LiveKit participant's identity as
 * `${matrixUserId}:${deviceId}` (matching Element Call/MSC3401's own
 * convention), not the bare Matrix user id - so `RemoteParticipant.identity`
 * needs this stripped back off before it can be used to key into Matrix
 * room state (member list, power levels, custom per-user events, etc.).
 * Splits on the LAST colon rather than matching `@user:domain` structurally,
 * so it still works for homeservers on a non-default port (`user:host:port`).
 */
export function matrixUserIdFromLivekitIdentity(identity: string): string {
  const idx = identity.lastIndexOf(":");
  return idx === -1 ? identity : identity.slice(0, idx);
}

/**
 * Exchanges the user's Matrix OpenID token for a LiveKit connection token
 * scoped to `roomId`, via the homeserver-advertised LiveKit JWT service
 * (matrix-org/lk-jwt-service protocol: POST {serviceUrl}/sfu/get).
 */
export async function getLivekitConnectionInfo(
  client: MatrixClient,
  roomId: string,
): Promise<LiveKitConnectionInfo> {
  const serviceUrl = await getLivekitServiceUrl(client);
  if (!serviceUrl) {
    throw new Error("A szerver nem hirdet csoportos hívás (LiveKit) szolgáltatást");
  }

  const openIdToken = await client.getOpenIdToken();
  const res = await fetch(`${serviceUrl}/sfu/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room: roomId, openid_token: openIdToken }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LiveKit token lekérése sikertelen (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { url?: string; jwt?: string };
  if (!data.url || !data.jwt) {
    throw new Error("A LiveKit szolgáltatás váratlan választ adott");
  }
  return { url: data.url, jwt: data.jwt };
}
