import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

export const repairHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const repairFile = (dir: string, issue: number, suffix: string) =>
  join(dir, "locks", `issue-${issue}${suffix}`);
export async function repairContent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export async function writeRepairExclusive(
  path: string,
  raw: string,
): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(raw);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function removeRepairExact(
  path: string,
  raw: string,
): Promise<void> {
  if ((await repairContent(path)) === raw) await unlink(path);
}
export async function archiveRepairBytes(
  dir: string,
  issue: number,
  kind: string,
  raw: string,
  now?: () => Date,
): Promise<string> {
  const root = join(dir, "archive", "leases", `issue-${issue}`);
  await mkdir(root, { recursive: true });
  const target = join(
    root,
    `${(now?.() ?? new Date()).toISOString().replaceAll(/[:.]/gu, "-")}-${kind}-${randomUUID()}.json`,
  );
  await writeRepairExclusive(target, raw);
  return target;
}
