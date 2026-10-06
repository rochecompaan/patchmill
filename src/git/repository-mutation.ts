import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  CommandResult,
  CommandRunOptions,
  CommandRunner,
} from "../command/types.ts";
import type { RunRepositoryNamespace } from "../workflow/run-repository-namespace.ts";
import {
  acquireRepositoryMutationGuard,
  RepositoryMutationOwnershipError,
  writeExclusiveMutationRecord,
  type MutationGuard,
} from "./repository-mutation-guard.ts";
export {
  RepositoryMutationBusyError,
  RepositoryMutationOwnershipError,
} from "./repository-mutation-guard.ts";

export type RepositoryMutationContext = {
  namespace: RunRepositoryNamespace;
  attemptId: string;
  runner: CommandRunner;
  assertOwned: () => Promise<void>;
};
export type RepositoryGitTransaction = {
  run: (args: string[], options?: CommandRunOptions) => Promise<CommandResult>;
};
export class RepositoryMutationInterruptedError extends Error {
  readonly evidencePath: string;
  constructor(evidencePath: string, cause: unknown) {
    super(
      `Repository transaction was interrupted; preserve its checkpoint and command evidence: ${evidencePath}`,
      { cause },
    );
    this.name = "RepositoryMutationInterruptedError";
    this.evidencePath = evidencePath;
  }
}
async function replaceCommandRecord(
  guard: MutationGuard,
  path: string,
  expected: string,
  next: string,
): Promise<void> {
  await guard.assertOwned();
  if ((await readFile(path, "utf8")) !== expected)
    throw new RepositoryMutationOwnershipError(path);
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(next);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await guard.assertOwned();
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
async function runCommand(
  context: RepositoryMutationContext,
  guard: MutationGuard,
  args: string[],
  options: CommandRunOptions,
  signal: AbortSignal | undefined,
  commandMs: number,
): Promise<CommandResult> {
  if (!context.runner.supportsOwnedGit)
    throw new RepositoryMutationOwnershipError(
      "CommandRunner requires verified owned-Git lifecycle support",
    );
  await context.assertOwned();
  await guard.assertOwned();
  await mkdir(guard.commands, { recursive: true });
  const commandId = randomUUID();
  const path = join(guard.commands, `${commandId}.json`);
  const base = {
    version: 1,
    ownerToken: guard.ownerToken,
    commandId,
    args,
    cwd: options.cwd ?? context.namespace.cloneRoot,
  };
  let raw = JSON.stringify({ ...base, state: "pending" });
  await writeExclusiveMutationRecord(path, raw);
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new Error("Git command timeout")),
    commandMs,
  );
  const signals = [signal, options.signal, timeout.signal].filter(
    (value): value is AbortSignal => value !== undefined,
  );
  const combined = AbortSignal.any(signals);
  let verified = false;
  try {
    const result = await context.runner.run("git", args, {
      ...options,
      cwd: base.cwd,
      signal: combined,
      ownedGit: {
        onSpawn: async (processGroupId) => {
          const next = JSON.stringify({
            ...base,
            state: "running",
            processGroupId,
          });
          await replaceCommandRecord(guard, path, raw, next);
          raw = next;
        },
        onStopped: async (stopped) => {
          if (!stopped) return;
          const next = JSON.stringify({ ...base, state: "stopped" });
          await replaceCommandRecord(guard, path, raw, next);
          raw = next;
          verified = true;
        },
      },
    });
    if (!verified || combined.aborted)
      throw new RepositoryMutationInterruptedError(path, combined.reason);
    await context.assertOwned();
    await guard.assertOwned();
    return result;
  } catch (error) {
    if (error instanceof RepositoryMutationInterruptedError) throw error;
    throw new RepositoryMutationInterruptedError(path, error);
  } finally {
    clearTimeout(timer);
  }
}

export async function withRepositoryMutation<T>(
  context: RepositoryMutationContext,
  action: (transaction: RepositoryGitTransaction) => Promise<T>,
  options: { signal?: AbortSignal; waitMs?: number; commandMs?: number } = {},
): Promise<T> {
  const waitMs = options.waitMs ?? 10_000;
  const commandMs = options.commandMs ?? 60_000;
  if (
    !Number.isFinite(waitMs) ||
    waitMs < 0 ||
    !Number.isFinite(commandMs) ||
    commandMs < 1
  )
    throw new RangeError("Invalid repository transaction bounds");
  await context.assertOwned();
  const guard = await acquireRepositoryMutationGuard({
    root: join(context.namespace.commonDir, "patchmill", "run-once"),
    attemptId: context.attemptId,
    waitMs,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const commands: Promise<CommandResult>[] = [];
  let running = false;
  let ended = false;
  let failure: unknown;
  let failed = false;
  let result: { value: T } | undefined;
  const transaction: RepositoryGitTransaction = {
    run(args, runOptions = {}) {
      if (running || ended)
        return Promise.reject(
          new Error("Git transaction must run awaited sequential commands"),
        );
      running = true;
      const command = runCommand(
        context,
        guard,
        args,
        runOptions,
        options.signal,
        commandMs,
      ).finally(() => {
        running = false;
      });
      commands.push(command);
      return command;
    },
  };
  try {
    await context.assertOwned();
    options.signal?.throwIfAborted();
    result = { value: await action(transaction) };
  } catch (error) {
    failed = true;
    failure = error;
  }
  ended = true;
  const results = await Promise.allSettled(commands);
  const rejected = results.find((result) => result.status === "rejected");
  try {
    await guard.release();
  } catch (error) {
    if (!failed && rejected === undefined) {
      failed = true;
      failure = error;
    }
  }
  if (failed) throw failure;
  if (rejected?.status === "rejected") throw rejected.reason;
  if (!result) throw new Error("Repository transaction has no result");
  return result.value;
}
