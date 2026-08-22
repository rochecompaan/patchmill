import {
  stripTerminalSequences,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { TerminalResultSeverity } from "./terminal-result.ts";

export type TerminalValue = {
  text: string;
  role?: "plain" | "url" | "path" | "commit";
};
export type TerminalField = { label?: string; value: TerminalValue };
export type TerminalListItem = {
  value: TerminalValue;
  details?: TerminalField[];
};
export type TerminalSectionBlock =
  | { kind: "value"; value: TerminalValue }
  | { kind: "fields"; fields: TerminalField[] }
  | {
      kind: "list";
      marker: "•" | "✓" | "!" | "→" | "✗";
      markerSeverity?: TerminalResultSeverity;
      items: TerminalListItem[];
    };
export type TerminalSection = {
  heading: string;
  count?: number;
  blocks: TerminalSectionBlock[];
};
export type TerminalDocument = {
  label: string;
  severity: TerminalResultSeverity;
  width: number;
  color: boolean;
  stepNumber?: number;
  totalOutputTokens?: number;
  elapsedSeconds?: number;
  sections: TerminalSection[];
};

const SGR = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  url: "\u001b[36;4m",
  accent: "\u001b[35m",
} as const;
const markerFor = (severity: TerminalResultSeverity) =>
  severity === "success" ? "✓" : severity === "warning" ? "!" : "✗";
const severityColor = (severity: TerminalResultSeverity) =>
  severity === "success"
    ? SGR.green
    : severity === "warning"
      ? SGR.yellow
      : SGR.red;
const style = (value: string, role: string | undefined, color: boolean) =>
  !color
    ? value
    : `${role === "url" ? SGR.url : role === "path" || role === "commit" ? SGR.accent : ""}${value}${role === "url" || role === "path" || role === "commit" ? SGR.reset : ""}`;
const styled = (value: string, prefix: string, color: boolean) =>
  color ? `${prefix}${value}${SGR.reset}` : value;

export function cleanValue(value: string): string {
  return stripTerminalSequences(value)
    .replace(/\r\n?|\n/gu, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, " ")
    .trim();
}

function normalizeWidth(width: number): number {
  return Number.isFinite(width) && width > 0
    ? Math.max(1, Math.floor(width))
    : 80;
}

function fittingPrefix(prefix: string, width: number): string {
  if (visibleWidth(prefix) < width) return prefix;
  const unindented = prefix.replace(/^ +/u, "");
  if (visibleWidth(unindented) < width) return unindented;
  const compact = unindented.replace(/ +$/u, "");
  return visibleWidth(compact) < width ? compact : "";
}

function encodeOversizeGraphemes(text: string, width: number): string {
  return [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
  ]
    .map(({ segment }) =>
      visibleWidth(segment) > width
        ? [...segment]
            .map(
              (codePoint) => `\\u{${codePoint.codePointAt(0)?.toString(16)}}`,
            )
            .join("")
        : segment,
    )
    .join("");
}

function protectLiteralWhitespace(text: string, role: TerminalValue["role"]) {
  if (role !== "url" && role !== "path" && role !== "commit")
    return { text, restore: (value: string) => value };

  let marker = "\uE000";
  while (text.includes(marker))
    marker = String.fromCodePoint(marker.codePointAt(0)! + 1);
  return {
    text: text.replaceAll(" ", marker),
    restore: (value: string) => value.replaceAll(marker, " "),
  };
}

function wrap(
  value: TerminalValue,
  firstPrefix: string,
  continuationPrefix: string,
  width: number,
  color: boolean,
): string[] {
  const text = cleanValue(value.text);
  if (!text) return [];
  const first = fittingPrefix(firstPrefix, width);
  const continuation = fittingPrefix(continuationPrefix, width);
  const standalonePrefix =
    !first && cleanValue(stripTerminalSequences(firstPrefix))
      ? firstPrefix.replace(/^ +| +$/gu, "")
      : undefined;
  const prefixes = standalonePrefix ? [standalonePrefix] : [];
  const protectedText = protectLiteralWhitespace(text, value.role);
  const lines = wrapTextWithAnsi(
    encodeOversizeGraphemes(
      protectedText.text,
      Math.max(1, width - visibleWidth(first)),
    ),
    Math.max(1, width - visibleWidth(first)),
  );
  return [
    ...prefixes,
    ...lines.flatMap((line, index) => {
      const prefix = index === 0 ? first : continuation;
      const available = Math.max(1, width - visibleWidth(prefix));
      return wrapTextWithAnsi(
        encodeOversizeGraphemes(line, available),
        available,
      ).map(
        (part) =>
          `${prefix}${style(protectedText.restore(part), value.role, color)}`,
      );
    }),
  ];
}

function renderFields(
  fields: TerminalField[],
  width: number,
  color: boolean,
  indent: number,
): string[] {
  const valid = fields.filter((field) => cleanValue(field.value.text));
  if (!valid.length) return [];
  const labels = valid.map((field) =>
    field.label ? `${cleanValue(field.label)}:` : "",
  );
  const maxLabel = Math.max(...labels.map((label) => label.length));
  const inline = maxLabel > 0 && width - indent - maxLabel - 1 >= 16;
  return valid.flatMap((field, index) => {
    const label = labels[index];
    const pad = " ".repeat(indent);
    if (!label) return wrap(field.value, pad, pad, width, color);
    if (!inline)
      return [
        ...wrap({ text: label }, pad, pad, width, false).map((line) =>
          styled(line, SGR.dim, color),
        ),
        ...wrap(field.value, `${pad}  `, `${pad}  `, width, color),
      ];
    const labelText = `${pad}${label.padEnd(maxLabel)} `;
    return wrap(
      field.value,
      styled(labelText, SGR.dim, color),
      " ".repeat(labelText.length),
      width,
      color,
    );
  });
}

function renderList(
  block: Extract<TerminalSectionBlock, { kind: "list" }>,
  width: number,
  color: boolean,
): string[] {
  const marker = styled(
    block.marker,
    severityColor(block.markerSeverity ?? "success"),
    color,
  );
  return block.items.flatMap((item) => [
    ...wrap(item.value, `  ${marker} `, "    ", width, color),
    ...renderFields(item.details ?? [], width, color, 4),
  ]);
}

function formatTokens(tokens: number): string {
  return `${(tokens / 1000).toFixed(1)}k`;
}
function formatElapsed(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  if (value < 60) return `${value}s`;
  const m = Math.floor(value / 60);
  const s = value % 60;
  if (m < 60) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${m % 60}m${String(s).padStart(2, "0")}s`;
}

function resetLine(line: string, color: boolean): string {
  return color && line.includes("\u001b[") && !line.endsWith(SGR.reset)
    ? `${line}${SGR.reset}`
    : line;
}

export function renderTerminalDocument(input: TerminalDocument): string {
  const width = normalizeWidth(input.width);
  const color = input.color;
  const headerPrefix =
    input.stepNumber === undefined
      ? ""
      : `${String(input.stepNumber).padStart(2, "0")}  `;
  const header = `${headerPrefix}Final result: ${markerFor(input.severity)} ${input.label}`;
  const lines = wrap({ text: header }, "", "", width, false).map((line) =>
    styled(line, SGR.bold + severityColor(input.severity), color),
  );
  const metrics: string[] = [];
  if (
    input.totalOutputTokens !== undefined ||
    input.elapsedSeconds !== undefined
  ) {
    const parts = [
      input.totalOutputTokens !== undefined
        ? `${formatTokens(input.totalOutputTokens)} tokens`
        : undefined,
      input.elapsedSeconds !== undefined
        ? `elapsed ${formatElapsed(input.elapsedSeconds)}`
        : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    metrics.push(
      ...wrap({ text: parts }, "    ", "    ", width, false).map((line) =>
        styled(line, SGR.dim, color),
      ),
    );
  }
  const sections = input.sections
    .map((section) => {
      const body = section.blocks.flatMap((block) =>
        block.kind === "value"
          ? wrap(block.value, "  ", "  ", width, color)
          : block.kind === "fields"
            ? renderFields(block.fields, width, color, 2)
            : renderList(block, width, color),
      );
      const heading =
        section.count === undefined
          ? section.heading
          : `${section.heading} (${section.count})`;
      return body.length
        ? [
            ...wrap({ text: heading }, "", "", width, false).map((line) =>
              styled(line, SGR.bold, color),
            ),
            ...body,
          ].join("\n")
        : undefined;
    })
    .filter((section): section is string => section !== undefined);
  return [
    ...lines,
    ...metrics,
    ...(sections.length ? ["", sections.join("\n\n")] : []),
  ]
    .join("\n")
    .split("\n")
    .map((line) => resetLine(line, color))
    .join("\n");
}
