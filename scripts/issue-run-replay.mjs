// Read-only source comparison. Only sanitized copies enter the temporary served repository.
import fs from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readIssueCostReport } from "../src/kernel/issue-cost.ts";
const generated = /^\d{8}-\d{6}-[a-f0-9]{4}$/;
const fingerprint = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 8);
function sanitize(record) {
  const r = structuredClone(record);
  if (r.type === "session") {
    delete r.cwd;
    delete r.parentSession;
  }
  const m = r.message;
  if (!m) return r.type === "usage" ? r : { type: "ignored" };
  if (typeof m.content === "string")
    m.content = `Retained ${m.role} text (sanitized ${fingerprint(m.content)}).`;
  else if (Array.isArray(m.content))
    m.content = m.content.flatMap((b) => {
      if (b.type === "thinking") return [];
      if (b.type === "toolCall")
        return [
          { ...b, arguments: { retainedInput: fingerprint(b.arguments) } },
        ];
      return b.type === "text"
        ? [
            {
              type: "text",
              text: `Retained ${m.role} text (sanitized ${fingerprint(b.text)}).`,
            },
          ]
        : [];
    });
  return r;
}
async function jsonLines(path) {
  return (await fs.readFile(path, "utf8"))
    .split("\n")
    .filter((s) => s.trim())
    .flatMap((s) => {
      try {
        return [JSON.parse(s)];
      } catch {
        return [];
      }
    });
}
export async function replayIssueRun(sourceDir, destinationDir, issue) {
  const runs = (await fs.readdir(sourceDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && generated.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const phases = [],
    sources = [],
    seen = new Set();
  let toolCalls = 0;
  async function copySession(dir, destination, main) {
    await fs.mkdir(destination, { recursive: true });
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name),
        target = join(destination, entry.name);
      if (entry.isDirectory()) await copySession(path, target, false);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const records = await jsonLines(path);
        if (main) {
          const header = records.find((r) => r.type === "session");
          for (const r of records) {
            if (r.type !== "message" || r.message?.role !== "assistant")
              continue;
            if (
              header?.timestamp &&
              r.timestamp &&
              Date.parse(r.timestamp) < Date.parse(header.timestamp)
            )
              continue;
            const key = JSON.stringify([r.id, r.message]);
            if (seen.has(key)) continue;
            seen.add(key);
            toolCalls +=
              r.message.content?.filter?.((b) => b.type === "toolCall")
                .length ?? 0;
          }
        }
        await fs.writeFile(
          target,
          records
            .map((r) => {
              // Preserve the session creation time used to exclude inherited entries.
              if (r.type === "session")
                return JSON.stringify({
                  type: "session",
                  timestamp: r.timestamp,
                });
              return JSON.stringify(sanitize(r));
            })
            .join("\n") + "\n",
        );
      }
    }
  }
  for (const entry of runs) {
    const dir = join(sourceDir, entry.name),
      target = join(destinationDir, entry.name);
    const result = JSON.parse(
      await fs.readFile(join(dir, "result.json"), "utf8"),
    );
    if (result.issue !== issue || result.runId !== entry.name)
      throw Error("Replay identity mismatch");
    sources.push(entry.name);
    phases.push(...result.sessions.map((s) => s.phase));
    result.outcome.summary =
      "Retained repository run outcome (sanitized replay).";
    delete result.progress;
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(join(target, "result.json"), JSON.stringify(result));
    for (const session of await fs.readdir(join(dir, "sessions"), {
      withFileTypes: true,
    }))
      if (session.isDirectory() && /^[1-9]\d*$/.test(session.name))
        await copySession(
          join(dir, "sessions", session.name),
          join(target, "sessions", session.name),
          true,
        );
  }
  const report = await readIssueCostReport(sourceDir, undefined, {
    runIds: sources,
  });
  return {
    issue,
    sources,
    phases,
    toolCalls,
    cost: report?.total.costUsd?.toFixed(4) ?? null,
    tokens: report
      ? report.total.inputTokens + report.total.outputTokens
      : null,
    note: "Historical terminal progress and planning tool results were not retained. Text and tool arguments are sanitized; IDs, timestamps, tools and usage remain.",
  };
}
