import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

test("capture-visual-evidence resolves Playwright from the target project cwd", async () => {
  const projectRoot = await tempRoot("patchmill-visual-evidence-project-");
  await mkdir(join(projectRoot, "node_modules", "@playwright", "test"), {
    recursive: true,
  });
  await writeFile(
    join(projectRoot, "package.json"),
    JSON.stringify({ name: "target-project", private: true }),
  );
  await writeFile(
    join(projectRoot, "node_modules", "@playwright", "test", "index.js"),
    `const fs = require('node:fs');
exports.chromium = {
  async launch() {
    return {
      async newPage() {
        return {
          async goto() {},
          url() { return 'http://app.example/dashboard'; },
          locator() { return { first() { return { async waitFor() {} }; } }; },
          getByText() { return { first() { return {}; } }; },
          async evaluate() {},
          async screenshot(options) { fs.writeFileSync(options.path, 'fake png'); },
        };
      },
      async close() {},
    };
  },
};
exports.expect = () => ({ async toBeVisible() {} });
`,
  );

  const scriptPath = resolve(
    "skills",
    "patchmill-visual-evidence",
    "scripts",
    "capture-visual-evidence.cjs",
  );
  const outputPath = join(projectRoot, ".tmp", "proof.png");

  const result = await execFileAsync(
    process.execPath,
    [
      scriptPath,
      "--url",
      "http://app.example/dashboard",
      "--output",
      outputPath,
      "--wait-text",
      "Dashboard",
    ],
    { cwd: projectRoot },
  );

  assert.match(result.stdout, /screenshot=.*proof\.png/u);
  assert.equal(await readFile(outputPath, "utf8"), "fake png");
});
