import { t } from "../i18n";
/**
 * GIF picker groundwork (Tenor API) - the user doesn't have an API key yet,
 * so this is deliberately built to fail gracefully (a clear "add your key"
 * prompt, not a broken feature) until one is added, at which point
 * everything else here already works with no further changes needed.
 *
 * The key is a personal, free-tier Tenor credential
 * (https://developers.google.com/tenor/guides/quickstart) - stored ONLY in
 * localStorage, deliberately never synced as account data or sent anywhere
 * but Tenor's own API, since it's a credential, not a preference.
 */

const API_KEY_STORAGE = "jorkonvo-tenor-api-key";
// Tenor's own optional "client_key" query param, for THEIR usage analytics
// bucketing - not a secret, just identifies which app is calling, same
// idea as a User-Agent.
const CLIENT_KEY = "jorkonvo";

export function getTenorApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE) || null;
}

export function setTenorApiKey(key: string): void {
  const trimmed = key.trim();
  if (trimmed) localStorage.setItem(API_KEY_STORAGE, trimmed);
  else localStorage.removeItem(API_KEY_STORAGE);
}

export interface GifResult {
  id: string;
  /** Small, for the picker grid. */
  previewUrl: string;
  /** The actual clip to download+send. */
  fullUrl: string;
  description: string;
}

interface TenorMediaFormat {
  url?: string;
}

interface TenorResult {
  id: string;
  content_description?: string;
  media_formats?: {
    tinygif?: TenorMediaFormat;
    gif?: TenorMediaFormat;
  };
}

function parseResults(results: unknown): GifResult[] {
  if (!Array.isArray(results)) return [];
  return (results as TenorResult[])
    .map((r) => ({
      id: r.id,
      previewUrl: r.media_formats?.tinygif?.url ?? r.media_formats?.gif?.url ?? "",
      fullUrl: r.media_formats?.gif?.url ?? "",
      description: r.content_description ?? "GIF",
    }))
    .filter((g) => g.previewUrl && g.fullUrl);
}

async function tenorRequest(path: string, params: Record<string, string>): Promise<GifResult[]> {
  const key = getTenorApiKey();
  if (!key) throw new Error(t("gifSearch.noKey"));
  const query = new URLSearchParams({ ...params, key, client_key: CLIENT_KEY, media_filter: "gif" });
  const res = await fetch(`https://tenor.googleapis.com/v2/${path}?${query}`);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error(t("gifSearch.invalidKey"));
    throw new Error(`Tenor API hiba (${res.status})`);
  }
  const data = (await res.json()) as { results?: unknown };
  return parseResults(data.results);
}

export function searchGifs(query: string, limit = 24): Promise<GifResult[]> {
  return tenorRequest("search", { q: query, limit: String(limit) });
}

export function getTrendingGifs(limit = 24): Promise<GifResult[]> {
  return tenorRequest("featured", { limit: String(limit) });
}
