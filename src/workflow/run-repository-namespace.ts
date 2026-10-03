import {
  link,
  mkdir,
  open,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { CommandRunner } from "../command/types.ts";
import type { RepositoryIdentity } from "../host/pull-requests.ts";

export type RunRepositoryTodoRoot =
  | { kind: "workspace-relative"; path: string }
  | { kind: "absolute"; path: string };
export type RunRepositoryNamespaceInput = {
  repoRoot: string;
  hostRepository: RepositoryIdentity;
  runStateDir: string;
  worktreeRoot: string;
  todoRoot: string;
};
export type RunRepositoryNamespace = {
  commonDir: string;
  cloneRoot: string;
  hostRepository: RepositoryIdentity;
  runStateDir: string;
  worktreeRoot: string;
  todoRoot: RunRepositoryTodoRoot;
};
type NamespaceRecord = RunRepositoryNamespace & { version: 1 };

export class RunRepositoryNamespaceConflictError extends Error {
  readonly recordPath: string;
  constructor(recordPath: string) {
    super(`Run-once repository namespace conflicts with ${recordPath}`);
    this.name = "RunRepositoryNamespaceConflictError";
    this.recordPath = recordPath;
  }
}

async function realPathOrNearestExisting(path: string): Promise<string> {
  let candidate = resolve(path);
  const missing: string[] = [];
  while (true) {
    try {
      const existing = await realpath(candidate);
      return resolve(existing, ...missing.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      missing.push(candidate.slice(parent.length + 1));
      candidate = parent;
    }
  }
}

function serialize(namespace: RunRepositoryNamespace): string {
  return `${JSON.stringify({ version: 1, ...namespace })}\n`;
}

function parse(raw: string): NamespaceRecord | undefined {
  try {
    const value = JSON.parse(raw) as NamespaceRecord;
    return value.version === 1 &&
      typeof value.commonDir === "string" &&
      typeof value.cloneRoot === "string" &&
      typeof value.runStateDir === "string" &&
      typeof value.worktreeRoot === "string" &&
      typeof value.hostRepository?.provider === "string" &&
      typeof value.hostRepository.host === "string" &&
      typeof value.hostRepository.owner === "string" &&
      typeof value.hostRepository.repository === "string" &&
      (value.todoRoot?.kind === "absolute" ||
        value.todoRoot?.kind === "workspace-relative") &&
      typeof value.todoRoot.path === "string"
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function same(
  left: RunRepositoryNamespace,
  right: RunRepositoryNamespace,
): boolean {
  return serialize(left) === serialize(right);
}

async function bindNamespace(namespace: RunRepositoryNamespace): Promise<void> {
  const directory = join(namespace.commonDir, "patchmill", "run-once");
  const path = join(directory, "namespace-v1.json");
  const temporary = join(
    directory,
    `.namespace-${process.pid}-${Date.now()}.tmp`,
  );
  await mkdir(directory, { recursive: true });
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(serialize(namespace));
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, path);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  const saved = parse(await readFile(path, "utf8"));
  if (saved === undefined || !same(saved, namespace))
    throw new RunRepositoryNamespaceConflictError(path);
}

/** Resolves and binds the single filesystem namespace used by Run-once writers. */
export async function resolveRunRepositoryNamespace(
  runner: CommandRunner,
  input: RunRepositoryNamespaceInput,
): Promise<RunRepositoryNamespace> {
  const result = await runner.run(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: input.repoRoot },
  );
  if (result.code !== 0 || result.stdout.trim() === "")
    throw new Error(`Cannot resolve Git common directory: ${result.stderr}`);
  const cloneRoot = await realPathOrNearestExisting(input.repoRoot);
  const commonDir = await realPathOrNearestExisting(result.stdout.trim());
  const namespace: RunRepositoryNamespace = {
    commonDir,
    cloneRoot,
    hostRepository: input.hostRepository,
    runStateDir: await realPathOrNearestExisting(
      isAbsolute(input.runStateDir)
        ? input.runStateDir
        : join(cloneRoot, input.runStateDir),
    ),
    worktreeRoot: await realPathOrNearestExisting(
      isAbsolute(input.worktreeRoot)
        ? input.worktreeRoot
        : join(cloneRoot, input.worktreeRoot),
    ),
    todoRoot: isAbsolute(input.todoRoot)
      ? {
          kind: "absolute",
          path: await realPathOrNearestExisting(input.todoRoot),
        }
      : { kind: "workspace-relative", path: input.todoRoot },
  };
  await bindNamespace(namespace);
  return namespace;
}
