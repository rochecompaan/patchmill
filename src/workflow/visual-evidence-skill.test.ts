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

function captureScriptPath(): string {
  return resolve(
    "skills",
    "patchmill-visual-evidence",
    "scripts",
    "capture-visual-evidence.cjs",
  );
}

async function writeFakePlaywrightProject(
  playwrightModule: string,
): Promise<string> {
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
    playwrightModule,
  );
  return projectRoot;
}

test("capture-visual-evidence resolves Playwright from the target project cwd", async () => {
  const projectRoot =
    await writeFakePlaywrightProject(`const fs = require('node:fs');
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
`);
  const outputPath = join(projectRoot, ".tmp", "proof.png");

  const result = await execFileAsync(
    process.execPath,
    [
      captureScriptPath(),
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

test("capture-visual-evidence uses label lookup for standard password inputs", async () => {
  const projectRoot =
    await writeFakePlaywrightProject(`const fs = require('node:fs');
let loggedIn = false;
let gotoCount = 0;
exports.chromium = {
  async launch() {
    return {
      async newPage() {
        return {
          async goto(url) {
            gotoCount += 1;
            this.currentUrl = loggedIn && gotoCount > 1 ? url : 'http://app.example/login';
          },
          url() { return this.currentUrl || 'http://app.example/login'; },
          getByRole(role, options) {
            if (role === 'textbox' && options.name === 'Password') {
              throw new Error('password input is not exposed as textbox role');
            }
            if (role === 'textbox' && options.name === 'Username') {
              return { async fill(value) { globalThis.username = value; } };
            }
            if (role === 'button' && options.name === 'Sign In') {
              return { async click() { loggedIn = true; } };
            }
            throw new Error('unexpected role lookup ' + role + ':' + options.name);
          },
          getByLabel(label) {
            if (label === 'Password') {
              return { async fill(value) { globalThis.password = value; } };
            }
            throw new Error('unexpected label lookup ' + label);
          },
          async waitForLoadState() {},
          locator() { return { first() { return { async waitFor() {} }; } }; },
          getByText() { return { first() { return {}; } }; },
          async evaluate() {},
          async screenshot(options) { fs.writeFileSync(options.path, String(globalThis.username) + ':' + String(globalThis.password)); },
        };
      },
      async close() {},
    };
  },
};
exports.expect = () => ({ async toBeVisible() {} });
`);
  const outputPath = join(projectRoot, ".tmp", "proof.png");

  const result = await execFileAsync(
    process.execPath,
    [
      captureScriptPath(),
      "--url",
      "http://app.example/dashboard",
      "--output",
      outputPath,
      "--login-username",
      "admin",
      "--login-password",
      "secret",
    ],
    { cwd: projectRoot },
  );

  assert.match(result.stdout, /screenshot=.*proof\.png/u);
  assert.equal(await readFile(outputPath, "utf8"), "admin:secret");
});

test("capture-visual-evidence fails when login remains on the login page", async () => {
  const projectRoot =
    await writeFakePlaywrightProject(`const fs = require('node:fs');
exports.chromium = {
  async launch() {
    return {
      async newPage() {
        return {
          async goto() { this.currentUrl = 'http://app.example/login'; },
          url() { return this.currentUrl || 'http://app.example/login'; },
          getByRole(role, options) {
            if (role === 'textbox' && options.name === 'Username') return { async fill() {} };
            if (role === 'button' && options.name === 'Sign In') return { async click() {} };
            throw new Error('unexpected role lookup ' + role + ':' + options.name);
          },
          getByLabel(label) {
            if (label === 'Password') return { async fill() {} };
            throw new Error('unexpected label lookup ' + label);
          },
          async waitForLoadState() {},
          locator() { return { first() { return { async waitFor() {} }; } }; },
          getByText() { return { first() { return {}; } }; },
          async evaluate() {},
          async screenshot(options) { fs.writeFileSync(options.path, 'login page screenshot'); },
        };
      },
      async close() {},
    };
  },
};
exports.expect = () => ({ async toBeVisible() {} });
`);
  const outputPath = join(projectRoot, ".tmp", "proof.png");

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        captureScriptPath(),
        "--url",
        "http://app.example/dashboard",
        "--output",
        outputPath,
        "--login-username",
        "admin",
        "--login-password",
        "wrong-password",
      ],
      { cwd: projectRoot },
    ),
    (error: unknown) => {
      const stderr = String((error as { stderr?: unknown }).stderr ?? "");
      assert.match(stderr, /still at login URL/u);
      return true;
    },
  );
});
