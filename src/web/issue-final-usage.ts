import { join } from "node:path";
import { readIssueCostReport } from "../kernel/issue-cost.ts";
import type { IssueDetail } from "./api-types.ts";
import type { IssueRunRecord } from "./file-run-records.ts";
import { object, type RunFiles } from "./run-files.ts";

const amount = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
/** The default kernel reader tolerates missing usage. A web total must not claim completeness. */
async function completeUsageTree(
  files: RunFiles,
  dir: string,
): Promise<boolean> {
  if (!(await files.directory(dir))) return false;
  for (const entry of await files.list(dir)) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory()))
      return false;
    if (entry.isDirectory()) {
      if (!(await completeUsageTree(files, path))) return false;
    } else if (entry.name.endsWith(".jsonl")) {
      for await (const r of files.lines(path)) {
        if (r === null) return false;
        if (!object(r)) continue;
        const m = object(r.message) ? r.message : r;
        if (m.role !== "assistant" && r.type !== "usage") continue;
        const u = m.usage;
        if (
          !object(u) ||
          !amount(u.input) ||
          !amount(u.output) ||
          !amount(u.cacheRead ?? 0) ||
          !amount(u.cacheWrite ?? 0)
        )
          return false;
      }
    }
  }
  return true;
}

export async function issueFinalUsage(
  files: RunFiles,
  issueDir: string,
  records: readonly IssueRunRecord[],
): Promise<IssueDetail["finalUsage"]> {
  try {
    for (const record of records)
      if (
        !record.resultRecorded ||
        !record.finishedAt ||
        !(await completeUsageTree(
          files,
          join(issueDir, record.runId, "sessions"),
        ))
      )
        return null;
    const report = await readIssueCostReport(issueDir, undefined, {
      runIds: records.map((r) => r.runId),
      records,
    });
    return report
      ? {
          tokens: report.total.inputTokens + report.total.outputTokens,
          cost:
            report.total.costUsd === undefined
              ? null
              : { amount: report.total.costUsd.toFixed(4), currency: "USD" },
        }
      : null;
  } catch {
    return null;
  }
}
