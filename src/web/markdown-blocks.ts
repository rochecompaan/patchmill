import type { Inline, TextBlock } from "./api-types.ts";

/** A Markdown inline link, as written. Images are not links. */
export type MarkdownLink = { readonly text: string; readonly target: string };

type Token = Inline | { kind: "raw-link"; text: string; href: string };
type Scanned = { block: TextBlock; level?: number };

const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const thematic = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const item = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const quote = /^ {0,3}> ?(.*)$/;
const separator =
  /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const word = /[\p{L}\p{N}]/u;

/** Parses inline Markdown into tokens. Unclosed markers stay text. */
function tokens(source: string): Token[] {
  const out: Token[] = [];
  const push = (t: Token) => {
    const last = out.at(-1);
    if (t.kind === "text" && last?.kind === "text")
      out[out.length - 1] = { kind: "text", text: last.text + t.text };
    else out.push(t);
  };
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (c === "\\" && /[\\`*_[\]()#|!>-]/.test(source[i + 1] ?? "")) {
      push({ kind: "text", text: source[i + 1]! });
      i += 2;
      continue;
    }
    if (c === "`") {
      const run = /^`+/.exec(source.slice(i))![0];
      const close = new RegExp(`(?<!\`)${run}(?!\`)`, "g");
      close.lastIndex = i + run.length;
      const end = close.exec(source)?.index ?? -1;
      if (end > i + run.length) {
        const body = source.slice(i + run.length, end);
        push({ kind: "code", text: run.length > 1 ? body.trim() : body });
        i = end + run.length;
      } else {
        push({ kind: "text", text: run });
        i += run.length;
      }
      continue;
    }
    if (source.startsWith("**", i)) {
      const end = source.indexOf("**", i + 2);
      if (end > i + 2) {
        push({ kind: "strong", text: plain(source.slice(i + 2, end)) });
        i = end + 2;
      } else {
        push({ kind: "text", text: "**" });
        i += 2;
      }
      continue;
    }
    if ((c === "*" || c === "_") && !word.test(source[i - 1] ?? "")) {
      const end = source.indexOf(c, i + 1);
      if (
        end > i + 1 &&
        source[i + 1] !== " " &&
        !word.test(source[end + 1] ?? "")
      ) {
        push({ kind: "emphasis", text: plain(source.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    const image = c === "!" && source[i + 1] === "[";
    if (c === "[" || image) {
      const open = image ? i + 1 : i;
      const close = source.indexOf("](", open + 1);
      const end = close < 0 ? -1 : source.indexOf(")", close + 2);
      if (
        close > 0 &&
        end > 0 &&
        !source.slice(open + 1, close).includes("]")
      ) {
        const label = plain(source.slice(open + 1, close));
        const href = source.slice(close + 2, end).trim();
        if (image) push({ kind: "text", text: label });
        else push({ kind: "raw-link", text: label, href });
        i = end + 1;
        continue;
      }
    }
    push({ kind: "text", text: c });
    i++;
  }
  return out;
}

function inline(source: string): Inline[] {
  const out: Inline[] = [];
  for (const t of tokens(source)) {
    const next: Inline =
      t.kind !== "raw-link"
        ? t
        : /^https?:\/\/\S+$/i.test(t.href)
          ? { kind: "link", text: t.text, href: t.href }
          : { kind: "text", text: t.text };
    const last = out.at(-1);
    if (next.kind === "text" && last?.kind === "text")
      out[out.length - 1] = { kind: "text", text: last.text + next.text };
    else out.push(next);
  }
  return out;
}

function plain(source: string): string {
  return tokens(source)
    .map((t) => t.text)
    .join("");
}

function cells(line: string): string[] {
  const body = line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "");
  return body.split(/(?<!\\)\|/).map((cell) => plain(cell.trim()));
}

function startsBlock(line: string): boolean {
  return (
    fence.test(line) ||
    heading.test(line) ||
    thematic.test(line) ||
    item.test(line)
  );
}

/** Scans block structure. Each text run is passed to `text` for inline parsing. */
function scan(source: string, text: (raw: string) => void): Scanned[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: Scanned[] = [];
  let i = 0;
  const blank = (n: number) => (lines[n] ?? "").trim() === "";
  const content = (raw: string) => {
    text(raw);
    return inline(raw);
  };
  while (i < lines.length) {
    const line = lines[i]!;
    if (blank(i) || thematic.test(line)) {
      i++;
      continue;
    }
    const f = fence.exec(line);
    if (f) {
      const marker = f[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const close = lines[i]!.trim();
        if (
          close.startsWith(marker[0]!.repeat(marker.length)) &&
          /^(`+|~+)$/.test(close)
        )
          break;
        body.push(lines[i]!);
        i++;
      }
      i++;
      out.push({ block: { kind: "code", text: body.join("\n") } });
      continue;
    }
    const h = heading.exec(line);
    if (h) {
      out.push({
        block: { kind: "heading", content: content((h[2] ?? "").trim()) },
        level: h[1]!.length,
      });
      i++;
      continue;
    }
    if (
      line.includes("|") &&
      separator.test(lines[i + 1] ?? "") &&
      lines[i + 1]!.includes("|")
    ) {
      const rows: string[][] = [];
      text(line);
      const headers = cells(line);
      i += 2;
      while (i < lines.length && !blank(i) && lines[i]!.includes("|")) {
        text(lines[i]!);
        rows.push(cells(lines[i]!));
        i++;
      }
      out.push({ block: { kind: "table", headers, rows } });
      continue;
    }
    const first = item.exec(line);
    if (first) {
      const ordered = /\d/.test(first[2]!);
      const base = first[1]!.length;
      const items: string[] = [];
      while (i < lines.length) {
        const m = item.exec(lines[i]!);
        if (m) {
          const nested = m[1]!.length > base;
          if (!nested && /\d/.test(m[2]!) !== ordered) break;
          items.push(m[3]!.trim());
        } else if (!blank(i) && !startsBlock(lines[i]!)) {
          items[items.length - 1] += " " + lines[i]!.trim();
        } else if (blank(i)) {
          const next = lines[i + 1] ?? "";
          const m2 = item.exec(next);
          const continues = m2
            ? m2[1]!.length > base || /\d/.test(m2[2]!) === ordered
            : /^[ \t]{2,}\S/.test(next);
          if (!continues) break;
        } else break;
        i++;
      }
      out.push({
        block: { kind: "list", ordered, items: items.map(content) },
      });
      continue;
    }
    const parts: string[] = [];
    while (
      i < lines.length &&
      !blank(i) &&
      (parts.length === 0 || !startsBlock(lines[i]!))
    ) {
      const q = quote.exec(lines[i]!);
      parts.push((q ? q[1]! : lines[i]!).trim());
      i++;
    }
    out.push({
      block: { kind: "paragraph", content: content(parts.join(" ")) },
    });
  }
  return out;
}

/** Parses Markdown into text-safe data blocks. Raw HTML stays text. */
export function markdownBlocks(source: string): readonly TextBlock[] {
  return scan(source, () => {}).map((s) => s.block);
}

/** The plain text of the first level-one ATX heading, or null. */
export function markdownTitle(source: string): string | null {
  const found = scan(source, () => {}).find((s) => s.level === 1);
  if (!found || found.block.kind !== "heading") return null;
  const title = found.block.content
    .map((c) => c.text)
    .join("")
    .trim();
  return title || null;
}

/** Inline links outside code, in document order. Image targets are excluded. */
export function markdownLinks(source: string): readonly MarkdownLink[] {
  const links: MarkdownLink[] = [];
  scan(source, (raw) => {
    for (const t of tokens(raw))
      if (t.kind === "raw-link") links.push({ text: t.text, target: t.href });
  });
  return links;
}
