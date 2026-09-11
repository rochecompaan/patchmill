export type MarkdownTopLevelLine = Readonly<{
  line: string;
  index: number;
}>;

type RawHtmlBlock =
  | Readonly<{ kind: "blank" }>
  | Readonly<{ kind: "terminator"; terminator: RegExp }>;

const openingFencePattern = /^(`{3,}|~{3,})(.*)$/u;
const closingFencePattern = /^(`+|~+)[ \t]*$/u;
const rawTextTagPattern =
  /^<(?<tag>script|style|pre|textarea)(?=[ \t/>]|$)[^>]*>/iu;
const blockTagPattern =
  /^<(?:(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|ol|p|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul))(?=[ \t/>]|$)[^>]*>/iu;
const genericHtmlTagPattern =
  /^<\/?[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[^<>]*)?\/?>[ \t]*$/u;

function openingFence(line: string): string | undefined {
  const match = line.match(openingFencePattern);
  if (match === null) return undefined;
  const delimiter = match[1]!;
  return delimiter[0] === "`" && match[2]!.includes("`")
    ? undefined
    : delimiter;
}

function rawHtmlBlock(line: string): RawHtmlBlock | undefined {
  const rawTextTag = rawTextTagPattern.exec(line)?.groups?.tag;
  if (rawTextTag !== undefined)
    return {
      kind: "terminator",
      terminator: new RegExp(`</${rawTextTag}[ \t]*>`, "iu"),
    };
  if (line.startsWith("<!--"))
    return { kind: "terminator", terminator: /-->/u };
  if (line.startsWith("<?")) return { kind: "terminator", terminator: /\?>/u };
  if (line.startsWith("<![CDATA["))
    return { kind: "terminator", terminator: /\]\]>/u };
  if (/^<![A-Z]/u.test(line)) return { kind: "terminator", terminator: />/u };
  if (blockTagPattern.test(line) || genericHtmlTagPattern.test(line))
    return { kind: "blank" };
  return undefined;
}

function endsRawHtmlBlock(block: RawHtmlBlock, line: string): boolean {
  return block.kind === "blank"
    ? line.trim() === ""
    : block.terminator.test(line);
}

/** Returns source lines that are outside fenced code and multiline raw HTML blocks. */
export function markdownTopLevelLines(
  body: string,
  options: Readonly<{ includeStandaloneLine?: (line: string) => boolean }> = {},
): readonly MarkdownTopLevelLine[] {
  const output: MarkdownTopLevelLine[] = [];
  const lines = body.replaceAll("\r\n", "\n").split("\n");
  let fence: string | undefined;
  let htmlBlock: RawHtmlBlock | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const topLevel = line.replace(/^[ ]{0,3}/u, "");
    if (fence !== undefined) {
      const closingFence = topLevel.match(closingFencePattern)?.[1];
      if (
        closingFence !== undefined &&
        closingFence[0] === fence[0] &&
        closingFence.length >= fence.length
      )
        fence = undefined;
      continue;
    }
    if (htmlBlock !== undefined) {
      if (endsRawHtmlBlock(htmlBlock, topLevel)) htmlBlock = undefined;
      continue;
    }
    const opening = openingFence(topLevel);
    if (opening !== undefined) {
      fence = opening;
      continue;
    }
    if (options.includeStandaloneLine?.(line) === true) {
      output.push({ line, index });
      continue;
    }
    const rawBlock = rawHtmlBlock(topLevel);
    if (rawBlock !== undefined) {
      if (!endsRawHtmlBlock(rawBlock, topLevel)) {
        htmlBlock = rawBlock;
        continue;
      }
      if (rawBlock.kind === "terminator") output.push({ line, index });
      continue;
    }
    output.push({ line, index });
  }
  return output;
}
