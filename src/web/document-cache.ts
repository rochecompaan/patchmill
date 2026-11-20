/**
 * A bounded, content-addressed cache. Keys are Git blob IDs, so an entry never
 * goes stale. Only `createDocumentCache()` makes one.
 */
class ContentCache {
  readonly #entries = new Map<string, { value: unknown; size: number }>();
  readonly #warned = new Set<string>();
  #bytes = 0;
  readonly maxEntries: number;
  readonly maxBytes: number;
  constructor(maxEntries: number, maxBytes: number) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }
  get<T>(key: string): T | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value as T;
  }
  set(key: string, value: unknown, size: number): void {
    const old = this.#entries.get(key);
    if (old) {
      this.#bytes -= old.size;
      this.#entries.delete(key);
    }
    if (size > this.maxBytes) return;
    this.#entries.set(key, { value, size });
    this.#bytes += size;
    for (const [oldest, entry] of this.#entries) {
      if (this.#entries.size <= this.maxEntries && this.#bytes <= this.maxBytes)
        break;
      this.#entries.delete(oldest);
      this.#bytes -= entry.size;
    }
  }
  /** True the first time a key is seen, so callers warn once for each blob. */
  firstWarning(key: string): boolean {
    if (this.#warned.has(key)) return false;
    if (this.#warned.size >= 1024) this.#warned.clear();
    this.#warned.add(key);
    return true;
  }
}

export type DocumentCache = ContentCache;

/** One cache for a live source: 64 entries and 32 MiB, oldest out first. */
export function createDocumentCache(): DocumentCache {
  return new ContentCache(64, 32 * 1024 * 1024);
}
