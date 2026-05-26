import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type PromptFileDependencies = {
  tmpdir(): string;
  mkdtemp(prefix: string): Promise<string>;
  writeFile(
    path: string,
    data: string,
    encoding: BufferEncoding,
  ): Promise<void>;
  rm(
    path: string,
    options: { recursive: boolean; force: boolean },
  ): Promise<void>;
};

const defaultDependencies: PromptFileDependencies = {
  tmpdir,
  mkdtemp,
  writeFile,
  rm,
};

export async function withPromptFile<T>(
  prefix: string,
  prompt: string,
  usePromptPath: (promptPath: string) => Promise<T>,
  dependencies: PromptFileDependencies = defaultDependencies,
): Promise<T> {
  const dir = await dependencies.mkdtemp(join(dependencies.tmpdir(), prefix));

  try {
    const promptPath = join(dir, "prompt.md");
    await dependencies.writeFile(promptPath, prompt, "utf8");
    return await usePromptPath(promptPath);
  } finally {
    await dependencies.rm(dir, { recursive: true, force: true });
  }
}
