/**
 * A bounded cache of object URLs keyed by their source (an mxc HTTP URL + any
 * size params). Authenticated-media homeservers (MSC3916) can't be hit with a
 * plain `<img src>`, so every avatar / emoji / banner is fetched with a Bearer
 * token and turned into a `blob:` URL - and a `blob:` URL pins its bytes in
 * memory until it's revoked or the document unloads. Without a bound, a
 * multi-day session that scrolls through thousands of rooms and members just
 * accumulates them forever.
 *
 * When the cache is full the least-recently-used entry is evicted and its URL
 * revoked. The cap is deliberately generous - far more than could plausibly be
 * on screen at once - so a still-displayed image is never the one revoked.
 */
export class BlobUrlCache {
  private map = new Map<string, string>();
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  get(key: string): string | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // Re-insert so it becomes most-recently-used.
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: string, url: string): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, url);
    while (this.map.size > this.max) {
      const oldestKey = this.map.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldestUrl = this.map.get(oldestKey);
      this.map.delete(oldestKey);
      if (oldestUrl) URL.revokeObjectURL(oldestUrl);
    }
  }
}
