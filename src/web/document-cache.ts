import type { TextBlock } from "./api-types.ts";
import type { MarkdownLink } from "./markdown-blocks.ts";

/** A parsed spec or plan: everything the reader needs from its blob. */
export type ParsedMarkdown = {
  readonly blocks: readonly TextBlock[];
  readonly title: string | null;
  readonly links: readonly MarkdownLink[];
};

type Entry =
  | { kind: "markdown"; value: ParsedMarkdown; size: number }
  | { kind: "html"; value: Buffer; size: number };

/**
 * A bounded cache keyed by Git blob ID, so an entry never goes stale. Oldest
 * entries leave first. Only `createDocumentCache()` makes one.
 */
export type DocumentCache = {
  markdown(blob: string): ParsedMarkdown | undefined;
  setMarkdown(blob: string, value: ParsedMarkdown, size: number): void;
  html(blob: string): Buffer | undefined;
  setHtml(blob: string, body: Buffer): void;
  /** True the first time a blob is seen, so callers warn once for each blob. */
  firstWarning(blob: string): boolean;
};

const MAX_ENTRIES = 64;
const MAX_BYTES = 32 * 1024 * 1024;

/** One cache for a live source: 64 entries and 32 MiB. */
export function createDocumentCache(): DocumentCache {
  const entries = new Map<string, Entry>();
  const warned = new Set<string>();
  let bytes = 0;
  function read(key: string): Entry | undefined {
    const entry = entries.get(key);
    if (entry) {
      entries.delete(key);
      entries.set(key, entry);
    }
    return entry;
  }
  function write(key: string, entry: Entry): void {
    const old = entries.get(key);
    if (old) {
      bytes -= old.size;
      entries.delete(key);
    }
    if (entry.size > MAX_BYTES) return;
    entries.set(key, entry);
    bytes += entry.size;
    for (const [oldest, value] of entries) {
      if (entries.size <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
      entries.delete(oldest);
      bytes -= value.size;
    }
  }
  return {
    markdown(blob) {
      const entry = read(`md:${blob}`);
      return entry?.kind === "markdown" ? entry.value : undefined;
    },
    setMarkdown(blob, value, size) {
      write(`md:${blob}`, { kind: "markdown", value, size });
    },
    html(blob) {
      const entry = read(`html:${blob}`);
      return entry?.kind === "html" ? entry.value : undefined;
    },
    setHtml(blob, body) {
      write(`html:${blob}`, { kind: "html", value: body, size: body.length });
    },
    firstWarning(blob) {
      if (warned.has(blob)) return false;
      if (warned.size >= 1024) warned.clear();
      warned.add(blob);
      return true;
    },
  };
}
