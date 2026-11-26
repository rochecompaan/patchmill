import { promises as fs } from "node:fs";
import { join, relative } from "node:path";
import {
  matchesFile,
  readSessionFiles,
  totalUsage,
  type PiUsage,
  type SessionFileUsage,
} from "./pi-cost.ts";
import { RETROS_DIR, type RetroScope } from "./retro-record.ts";

export type RetroSourceRole = "console" | "phase" | "subagent" | "run-record";
export type RetroSource = {
  /** Absolute path. */
  path: string;
  role: RetroSourceRole;
  /** The Run attempt, for "phase", "run-record", and their children. */
  runId?: string;
  /** Phase session number, for "phase" and its children. */
  session?: number;
  /** The subagent agent name, from the artifact file name, when known. */
  agent?: string;
  /** The file whose `subagent` tool result names this child file. */
  parent?: string;
  model?: string;
  /** Usage of the file's own records. Absent when it has none or is unreadable. */
  usage?: PiUsage;
  bytes: number;
  /** True when the file could not be read or parsed. */
  unreadable?: true;
};

const RUN_RECORDS = [
  "prompt.md",
  "result.json",
  "history.jsonl",
  "pi.log",
  "guidance.md",
];
const ARTIFACTS_DIR = "subagent-artifacts";
const ARTIFACT_NAME =
  /^([0-9a-f-]{36})_(.+?)(?:_\d+)?_(?:transcript\.jsonl|output\.md|meta\.json|input\.md)$/;

async function bytesOf(path: string): Promise<number | undefined> {
  try {
    const stat = await fs.stat(path);
    return stat.isFile() ? stat.size : undefined;
  } catch {
    return undefined;
  }
}

async function listFiles(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else if (entry.isFile() && !entry.name.startsWith(".")) files.push(path);
  }
  return files;
}

function isArtifact(path: string): boolean {
  return path.split("/").includes(ARTIFACTS_DIR);
}

function artifactOf(path: string): { id: string; agent: string } | undefined {
  const match = ARTIFACT_NAME.exec(path.split("/").at(-1) ?? "");
  return match ? { id: match[1]!, agent: match[2]! } : undefined;
}

function firstModel(file: SessionFileUsage): string | undefined {
  for (const record of file.records)
    for (const own of record.own)
      if (own.model !== "Unknown model") return own.model;
  return undefined;
}

function ownUsage(file: SessionFileUsage): PiUsage | undefined {
  return totalUsage(
    file.records.flatMap((record) => record.own.map((own) => own.usage)),
  );
}

/**
 * Lists the session files and artifacts below one folder. Files named by a
 * parent `subagent` tool result, and files in `subagent-artifacts/`, are
 * subagent children; the others get `role`.
 */
async function collectFolder(
  dir: string,
  role: "console" | "phase",
  base: Pick<RetroSource, "runId" | "session">,
  include: (path: string) => Promise<boolean>,
): Promise<RetroSource[]> {
  const { files, unreadable } = await readSessionFiles(dir);
  const parents = new Map<string, string>();
  for (const file of files)
    for (const record of file.records)
      for (const child of record.childFiles)
        for (const recorded of [child.sessionFile, child.transcriptPath])
          if (recorded) {
            const target = files.find((other) =>
              matchesFile(other, [recorded]),
            );
            if (target && target.path !== file.path)
              parents.set(target.path, file.path);
          }
  const parsed = new Map(files.map((file) => [file.path, file]));
  const paths = await listFiles(dir);
  // Child session folders and forks are named by the subagent run ID.
  const agents = new Map<string, string>();
  for (const path of paths) {
    const artifact = artifactOf(path);
    if (artifact) agents.set(artifact.id, artifact.agent);
  }
  const sources: RetroSource[] = [];
  for (const path of paths) {
    const jsonl = path.endsWith(".jsonl");
    if (!jsonl && !isArtifact(path)) continue;
    if (!(await include(path))) continue;
    const bytes = await bytesOf(path);
    if (bytes === undefined) continue;
    const file = parsed.get(path);
    const parent = parents.get(path);
    const agent =
      artifactOf(path)?.agent ??
      relative(dir, path)
        .split("/")
        .map((segment) => agents.get(segment))
        .find((name) => name !== undefined);
    const usage = file ? ownUsage(file) : undefined;
    const model = file ? firstModel(file) : undefined;
    sources.push({
      path,
      role: parent || agent || isArtifact(path) ? "subagent" : role,
      ...base,
      ...(agent ? { agent } : {}),
      ...(parent ? { parent } : {}),
      ...(model ? { model } : {}),
      ...(usage ? { usage } : {}),
      bytes,
      ...(jsonl && (unreadable.includes(path) || !file)
        ? { unreadable: true as const }
        : {}),
    });
  }
  return sources;
}

/**
 * The Retro source map of one Retro: the run records and session files of
 * each covered Run attempt, and the Console files changed at or after `since`.
 * One bad file never hides the others. Files below `retros/` never appear.
 */
export async function collectRetroSources(
  scope: Pick<RetroScope, "runIds" | "since">,
  issueDir: string,
): Promise<RetroSource[]> {
  const sources: RetroSource[] = [];
  const all = async () => true;
  for (const runId of scope.runIds) {
    const runDir = join(issueDir, runId);
    const names = await fs.readdir(runDir).catch(() => [] as string[]);
    for (const name of names.sort()) {
      if (!RUN_RECORDS.includes(name) && !/^session-\d+\.log$/.test(name))
        continue;
      const path = join(runDir, name);
      const bytes = await bytesOf(path);
      if (bytes !== undefined)
        sources.push({ path, role: "run-record", runId, bytes });
    }
    const sessionsDir = join(runDir, "sessions");
    const sessions = await fs.readdir(sessionsDir).catch(() => [] as string[]);
    for (const name of sessions) {
      const session = Number(name);
      sources.push(
        ...(await collectFolder(
          join(sessionsDir, name),
          "phase",
          { runId, ...(Number.isSafeInteger(session) ? { session } : {}) },
          all,
        )),
      );
    }
  }
  const since = Date.parse(scope.since);
  const consoleDir = join(issueDir, "console");
  sources.push(
    ...(await collectFolder(consoleDir, "console", {}, async (path) => {
      if (Number.isNaN(since)) return true;
      try {
        return (await fs.stat(path)).mtimeMs >= since;
      } catch {
        return false;
      }
    })),
  );
  const retros = join(issueDir, RETROS_DIR);
  return sources.filter(
    (source) => !source.path.startsWith(`${retros}/`) && source.path !== retros,
  );
}

const ROLE_ORDER: RetroSourceRole[] = [
  "phase",
  "subagent",
  "console",
  "run-record",
];

function tokens(value: number | undefined): string {
  return value === undefined ? "-" : value.toLocaleString("en-US");
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|");
}

/**
 * A Markdown table of the sources, grouped by Run attempt and then the Console
 * session, each sorted by input tokens, largest first.
 */
export function renderRetroSourceMap(
  sources: RetroSource[],
  options: { issueDir: string; since: string },
): string {
  const rel = (path: string) => relative(options.issueDir, path) || path;
  const groups = new Map<string, RetroSource[]>();
  for (const source of sources) {
    const key = source.runId ?? "console";
    groups.set(key, [...(groups.get(key) ?? []), source]);
  }
  const keys = [...groups.keys()].sort((a, b) =>
    a === "console" ? 1 : b === "console" ? -1 : a.localeCompare(b),
  );
  const lines = [
    `Issue folder: \`${options.issueDir}\`. Paths below are relative to it.`,
    `Covered since: ${options.since}. In reused Console session files, read only records at or after this time.`,
  ];
  for (const key of keys) {
    const rows = groups
      .get(key)!
      .slice()
      .sort(
        (a, b) =>
          (b.usage?.inputTokens ?? -1) - (a.usage?.inputTokens ?? -1) ||
          ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
          a.path.localeCompare(b.path),
      );
    lines.push(
      "",
      key === "console" ? "### Console session" : `### Run attempt ${key}`,
      "",
      "| Role | Session | Agent | Model | Input tokens | Output tokens | Bytes | Path | Parent |",
      "| ---- | ------- | ----- | ----- | ------------ | ------------- | ----- | ---- | ------ |",
    );
    for (const row of rows)
      lines.push(
        `| ${[
          row.role + (row.unreadable ? " (unreadable)" : ""),
          row.session === undefined ? "" : String(row.session),
          row.agent ?? "",
          row.model ?? "",
          tokens(row.usage?.inputTokens),
          tokens(row.usage?.outputTokens),
          row.bytes.toLocaleString("en-US"),
          `\`${rel(row.path)}\``,
          row.parent ? `\`${rel(row.parent)}\`` : "",
        ]
          .map(cell)
          .join(" | ")} |`,
      );
  }
  if (!sources.length) lines.push("", "No session files were found.");
  return `${lines.join("\n")}\n`;
}
