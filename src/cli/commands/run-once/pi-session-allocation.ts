import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open } from "node:fs/promises";
import { join } from "node:path";

export type PiSessionAllocation = {
  sessionDir: string;
  sessionPath?: string;
};

export type PiSessionAllocationOptions = {
  stage: string;
  promptTempDir: string;
  observeSession?: boolean;
  streamOutput?: boolean;
  sessionRoot?: string;
  sessionDir?: string;
  idFactory?: () => string;
};

async function createInvocationDir(
  options: PiSessionAllocationOptions,
): Promise<string> {
  if (options.sessionDir) {
    await mkdir(options.sessionDir, { recursive: true });
    return options.sessionDir;
  }
  if (options.sessionRoot) {
    const stageRoot = join(options.sessionRoot, options.stage);
    await mkdir(stageRoot, { recursive: true });
    return mkdtemp(join(stageRoot, "invocation-"));
  }
  const sessionDir = join(options.promptTempDir, "sessions");
  await mkdir(sessionDir, { recursive: true });
  return sessionDir;
}

async function createExactParentSessionFile(
  sessionDir: string,
  idFactory: () => string,
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const sessionPath = join(sessionDir, `parent-${idFactory()}.jsonl`);
    try {
      const handle = await open(sessionPath, "wx");
      await handle.close();
      return sessionPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("could not allocate a unique Pi parent session file");
}

export async function createPiSessionAllocation(
  options: PiSessionAllocationOptions,
): Promise<PiSessionAllocation | undefined> {
  if (!options.observeSession && !options.streamOutput) return undefined;

  const sessionDir = await createInvocationDir(options);
  if (!options.observeSession) return { sessionDir };
  return {
    sessionDir,
    sessionPath: await createExactParentSessionFile(
      sessionDir,
      options.idFactory ?? randomUUID,
    ),
  };
}
