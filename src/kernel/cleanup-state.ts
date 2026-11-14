import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { isIssueBranch, planningBranchName } from "./names.ts";

export type CleanupIdentity = {
  repository: string;
  pushRepository: string;
  issue: number;
  branch: string;
  baseBranch: string;
  pullRequest: number;
};
export type CleanupReceipt = {
  version: 1;
  identity: CleanupIdentity;
  completedAt: string;
  hook: { status: "succeeded"; path: string } | { status: "not-configured" };
};
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

function validReceipt(value: unknown): value is CleanupReceipt {
  if (
    !object(value) ||
    value.version !== 1 ||
    !object(value.identity) ||
    !object(value.hook)
  )
    return false;
  const { identity: id, hook } = value;
  return (
    positive(id.issue) &&
    positive(id.pullRequest) &&
    text(id.repository) &&
    text(id.pushRepository) &&
    text(id.baseBranch) &&
    text(id.branch) &&
    isIssueBranch(id.issue, id.branch) &&
    !["spec", "plan"].some(
      (stage) =>
        id.branch ===
        planningBranchName(id.issue as number, stage as "spec" | "plan"),
    ) &&
    typeof value.completedAt === "string" &&
    Number.isFinite(Date.parse(value.completedAt)) &&
    (hook.status === "not-configured" ||
      (hook.status === "succeeded" && typeof hook.path === "string"))
  );
}

export async function readCleanupReceipt(
  issueDir: string,
): Promise<CleanupReceipt | undefined> {
  const path = join(issueDir, "cleanup.json");
  let content: string;
  try {
    content = await fs.readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error(`Invalid cleanup receipt: ${path}`);
  }
  if (!validReceipt(value)) throw new Error(`Invalid cleanup receipt: ${path}`);
  return value;
}

export async function writeCleanupReceipt(
  issueDir: string,
  receipt: CleanupReceipt,
): Promise<void> {
  const temporary = join(issueDir, `.cleanup-${randomUUID()}.tmp`);
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(receipt, null, 2) + "\n");
    await handle.close();
    await fs.rename(temporary, join(issueDir, "cleanup.json"));
  } finally {
    await handle.close();
    await fs.rm(temporary, { force: true });
  }
}

export async function appendCleanupLog(input: {
  issueDir: string;
  at: string;
  message: string;
  stdout?: string;
  stderr?: string;
  runLogPath?: string;
}): Promise<void> {
  const diagnostic = `[${input.at}] ${input.message}\n`;
  const output = (input.stdout ?? "") + (input.stderr ?? "");
  await fs.appendFile(
    join(input.issueDir, "cleanup.log"),
    diagnostic + output + (output && !output.endsWith("\n") ? "\n" : ""),
    { mode: 0o600 },
  );
  if (input.runLogPath)
    await fs.appendFile(input.runLogPath, diagnostic, { mode: 0o600 });
}
