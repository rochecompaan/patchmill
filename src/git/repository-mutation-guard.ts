import { randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
} from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

type Owner = {
  version: 2;
  attemptId: string;
  ownerToken: string;
  pid: number;
  hostname: string;
};
export class RepositoryMutationBusyError extends Error {
  constructor() {
    super(
      "Shared repository mutation is busy; retry after the current transaction stops",
    );
    this.name = "RepositoryMutationBusyError";
  }
}
export class RepositoryMutationOwnershipError extends Error {
  constructor(path: string) {
    super(
      `Repository mutation ownership or command shutdown is unverifiable: ${path}`,
    );
    this.name = "RepositoryMutationOwnershipError";
  }
}
export type MutationGuard = {
  root: string;
  path: string;
  ownerToken: string;
  commands: string;
  assertOwned: () => Promise<void>;
  release: () => Promise<void>;
};
function parse(raw: string): Owner | undefined {
  try {
    const value = JSON.parse(raw) as Partial<Owner>;
    return value.version === 2 &&
      typeof value.attemptId === "string" &&
      value.attemptId.length > 0 &&
      typeof value.ownerToken === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value.ownerToken) &&
      Number.isSafeInteger(value.pid) &&
      (value.pid ?? 0) > 0 &&
      typeof value.hostname === "string" &&
      value.hostname.length > 0
      ? (value as Owner)
      : undefined;
  } catch {
    return undefined;
  }
}
function ownerState(owner: Owner): "alive" | "dead" | "unknown" {
  if (owner.hostname !== hostname()) return "unknown";
  try {
    process.kill(owner.pid, 0);
    return "alive";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH"
      ? "dead"
      : "unknown";
  }
}
async function read(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export async function writeExclusiveMutationRecord(
  path: string,
  raw: string,
): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(raw);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporary, path);
  } finally {
    await unlink(temporary);
  }
}
async function removeExact(path: string, raw: string): Promise<void> {
  if ((await read(path)) !== raw)
    throw new RepositoryMutationOwnershipError(path);
  await unlink(path);
}
function commandsPath(root: string, ownerToken: string): string {
  return join(root, "mutation-commands", ownerToken);
}
async function assertCommandsStopped(
  root: string,
  owner: Owner,
): Promise<void> {
  const directory = commandsPath(root, owner.ownerToken);
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry);
    const raw = await readFile(path, "utf8");
    let value;
    try {
      value = JSON.parse(raw) as {
        version?: number;
        ownerToken?: string;
        state?: string;
        processGroupId?: number;
      };
    } catch {
      throw new RepositoryMutationOwnershipError(path);
    }
    if (
      value.version !== 1 ||
      value.ownerToken !== owner.ownerToken ||
      !entry.endsWith(".json")
    )
      throw new RepositoryMutationOwnershipError(path);
    // Group/PID absence cannot replace the runner's durable shutdown receipt.
    // A dead owner with an active or unknown command always remains fail-closed.
    if (value.state !== "stopped")
      throw new RepositoryMutationOwnershipError(path);
    if ((await read(path)) !== raw)
      throw new RepositoryMutationOwnershipError(path);
  }
}
async function reconcile(
  root: string,
  path: string,
  observed: string,
  mine: Owner,
): Promise<void> {
  const reconciliation = join(root, "mutation-reconciliation.lock");
  const receipt = JSON.stringify({ ...mine, ownerToken: randomUUID() });
  try {
    await writeExclusiveMutationRecord(reconciliation, receipt);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new RepositoryMutationOwnershipError(reconciliation);
    throw error;
  }
  try {
    const current = await read(path);
    if (current === undefined || current !== observed) return;
    const owner = parse(current);
    if (!owner || ownerState(owner) !== "dead")
      throw new RepositoryMutationOwnershipError(path);
    await assertCommandsStopped(root, owner);
    const archive = join(root, "archive", "mutations");
    await mkdir(archive, { recursive: true });
    if ((await read(path)) !== observed)
      throw new RepositoryMutationOwnershipError(path);
    // Keep the command receipts in their immutable token directory.
    await rename(path, join(archive, `${randomUUID()}.json`));
  } finally {
    await removeExact(reconciliation, receipt);
  }
}

/** Owns a short repository transaction, never a whole Run attempt. */
export async function acquireRepositoryMutationGuard(input: {
  root: string;
  attemptId: string;
  signal?: AbortSignal;
  waitMs: number;
}): Promise<MutationGuard> {
  await mkdir(input.root, { recursive: true });
  const path = join(input.root, "mutation.lock");
  const mine: Owner = {
    version: 2,
    attemptId: input.attemptId,
    ownerToken: randomUUID(),
    pid: process.pid,
    hostname: hostname(),
  };
  const raw = JSON.stringify(mine);
  const deadline = Date.now() + input.waitMs;
  while (true) {
    input.signal?.throwIfAborted();
    try {
      await writeExclusiveMutationRecord(path, raw);
      return {
        root: input.root,
        path,
        ownerToken: mine.ownerToken,
        commands: commandsPath(input.root, mine.ownerToken),
        assertOwned: async () => {
          if ((await read(path)) !== raw)
            throw new RepositoryMutationOwnershipError(path);
        },
        release: async () => {
          await assertCommandsStopped(input.root, mine);
          await removeExact(path, raw);
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const observed = await read(path);
      if (observed === undefined) continue;
      const owner = parse(observed);
      if (!owner || ownerState(owner) === "unknown")
        throw new RepositoryMutationOwnershipError(path);
      if (ownerState(owner) === "dead") {
        await reconcile(input.root, path, observed, mine);
        continue;
      }
      if (Date.now() >= deadline) throw new RepositoryMutationBusyError();
      await delay(Math.min(10, Math.max(1, deadline - Date.now())), undefined, {
        signal: input.signal,
      });
    }
  }
}
