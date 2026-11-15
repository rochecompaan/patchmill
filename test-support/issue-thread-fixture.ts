import fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TestContext } from "node:test";
import { DEFAULT_CONFIG } from "../src/config/config.ts";
import { boardIssue } from "./board-fixture.ts";
import { readIssueObservation } from "../src/web/file-run-observations.ts";
import { projectBoardIssue } from "../src/web/board-projection.ts";
import { readIssueDetail } from "../src/web/file-issue-detail.ts";

export function piEntry(
  id: string,
  role: string,
  content: unknown,
  at: string | null = "2026-11-14T12:00:01Z",
) {
  return {
    type: "message",
    id,
    ...(at ? { timestamp: at } : {}),
    message: {
      role,
      content,
      ...(role === "assistant"
        ? {
            model: "fixture",
            usage: {
              input: 100,
              output: 10,
              cacheRead: 0,
              cacheWrite: 0,
              cost: { total: 0.1 },
            },
          }
        : {}),
    },
  };
}

export async function issueThreadFixture(t: TestContext) {
  const repoRoot = await fs.mkdtemp(join(tmpdir(), "patchmill-thread-"));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  const config = structuredClone(DEFAULT_CONFIG);
  config.paths.runsDir = "custom-runs";
  const issue = {
    ...boardIssue(9, ["in-progress"]),
    body: "<script>body stays text</script>",
  };
  const issueDir = join(repoRoot, config.paths.runsDir, "issue-9");
  const warnings: string[] = [];
  const input = {
    repoRoot,
    config,
    issue: 9,
    warn: (s: string) => warnings.push(s),
  };
  async function attempt(options: {
    id?: string;
    start?: string;
    finish?: string;
    phase?: "planning" | "implementation";
    messages?: unknown[];
    label?: "done" | "needsInfo" | "inProgress";
    summary?: string;
  }) {
    const runId = options.id ?? "20261114-120000-abcd";
    const dir = join(issueDir, runId);
    await fs.mkdir(dir, { recursive: true });
    const label = options.label ?? "done";
    const phase = options.phase ?? "planning";
    await fs.writeFile(
      join(dir, "result.json"),
      JSON.stringify({
        issue: 9,
        runId,
        startedAt: options.start ?? "2026-11-14T12:00:00Z",
        finishedAt: options.finish ?? "2026-11-14T12:00:30Z",
        sessions: [{ phase }],
        outcome: {
          issue: 9,
          status: label === "done" ? "completed" : "stopped",
          label,
          summary: options.summary ?? "done",
        },
      }),
    );
    const sessionDir = join(dir, "sessions/1");
    if (options.messages) {
      await fs.mkdir(sessionDir, { recursive: true });
      await fs.writeFile(
        join(sessionDir, "main.jsonl"),
        options.messages
          .map((r) => (typeof r === "string" ? r : JSON.stringify(r)))
          .join("\n") + "\n",
      );
    }
    return { dir, sessionDir };
  }
  return {
    ...input,
    issue,
    issueDir,
    warnings,
    attempt,
    read: async () => {
      const observation = await readIssueObservation(input);
      const summary = projectBoardIssue({
        issue,
        roles: ["inProgress"],
        run: observation,
        pullRequests: [],
        documentLinks: [],
      })!;
      return readIssueDetail({ ...input, issue, summary, observation });
    },
  };
}
