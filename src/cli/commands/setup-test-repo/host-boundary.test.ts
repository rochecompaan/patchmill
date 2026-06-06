import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const commandDir = dirname(fileURLToPath(import.meta.url));

async function tsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await tsFiles(path)));
    if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

test("setup-test-repo command does not invoke provider CLIs directly", async () => {
  for (const file of await tsFiles(commandDir)) {
    const content = await readFile(file, "utf8");
    assert.doesNotMatch(content, /\.run\(\s*["'](?:gh|tea)["']/u, file);
    assert.doesNotMatch(
      content,
      /\b(?:spawn|exec|execFile)\(\s*["'](?:gh|tea)["']/u,
      file,
    );
  }
});
