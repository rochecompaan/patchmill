import {
  stripTerminalSequences,
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
function wrap(
  value: TerminalValue,
  firstPrefix: string,
  continuationPrefix: string,
  width: number,
  color: boolean,
): string[] {
  const text = cleanValue(value.text);
  if (!text) return [];
  const first = Math.min(
    stripTerminalSequences(firstPrefix).length,
    Math.max(0, width - 1),
  );
  const continuation = Math.min(
    stripTerminalSequences(continuationPrefix).length,
    Math.max(0, width - 1),
  );
  const lines = wrapTextWithAnsi(text, Math.max(1, width - first));
  return lines.flatMap((line, index) => {
    const prefix = index === 0 ? firstPrefix : continuationPrefix;
    const available = Math.max(1, width - (index === 0 ? first : continuation));
    return wrapTextWithAnsi(line, available).map(
      (part) => `${prefix}${style(part, value.role, color)}`,
    );
  });
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
        styled(`${pad}${label}`, SGR.dim, color),
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

export function renderTerminalDocument(input: TerminalDocument): string {
  const width = normalizeWidth(input.width);
  const color = input.color;
  const headerPrefix =
    input.stepNumber === undefined
      ? ""
      : `${String(input.stepNumber).padStart(2, "0")}  `;
  const marker = styled(
    markerFor(input.severity),
    severityColor(input.severity),
    color,
  );
  const header = `${headerPrefix}Final result: ${marker} ${styled(input.label, SGR.bold + severityColor(input.severity), color)}`;
  const lines = wrap({ text: header }, "", "", width, false);
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
      ...wrap(
        { text: styled(parts, SGR.dim, color) },
        "    ",
        "    ",
        width,
        false,
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
      return body.length
        ? [
            styled(
              section.count === undefined
                ? section.heading
                : `${section.heading} (${section.count})`,
              SGR.bold,
              color,
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
  ].join("\n");
}
