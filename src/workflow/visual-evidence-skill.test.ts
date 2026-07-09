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

test("capture-visual-evidence passes storage state to Playwright", async () => {
  const projectRoot =
    await writeFakePlaywrightProject(`const fs = require('node:fs');
let pageOptions;
exports.chromium = {
  async launch() {
    return {
      async newPage(options) {
        pageOptions = options;
        return {
          async goto() {},
          url() { return 'http://app.example/dashboard'; },
          locator() { return { first() { return { async waitFor() {} }; } }; },
          getByText() { return { first() { return {}; } }; },
          async evaluate() {},
          async screenshot(options) { fs.writeFileSync(options.path, pageOptions.storageState); },
        };
      },
      async close() {},
    };
  },
};
exports.expect = () => ({ async toBeVisible() {} });
`);
  const outputPath = join(projectRoot, ".tmp", "proof.png");

  await execFileAsync(
    process.execPath,
    [
      captureScriptPath(),
      "--url",
      "http://app.example/dashboard",
      "--output",
      outputPath,
      "--storage-state",
      "playwright/.auth/user.json",
    ],
    { cwd: projectRoot },
  );

  assert.equal(
    await readFile(outputPath, "utf8"),
    "playwright/.auth/user.json",
  );
});

test("capture-visual-evidence does not use networkidle by default", async () => {
  const projectRoot =
    await writeFakePlaywrightProject(`const fs = require('node:fs');
let waitUntil;
exports.chromium = {
  async launch() {
    return {
      async newPage() {
        return {
          async goto(_url, options) {
            waitUntil = options.waitUntil;
            if (waitUntil === 'networkidle') throw new Error('networkidle should be explicit');
          },
          url() { return 'http://app.example/dashboard'; },
          locator() { return { first() { return { async waitFor() {} }; } }; },
          getByText() { return { first() { return {}; } }; },
          async evaluate() {},
          async screenshot(options) { fs.writeFileSync(options.path, waitUntil); },
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
    ],
    { cwd: projectRoot },
  );

  assert.match(result.stdout, /screenshot=.*proof\.png/u);
  assert.equal(await readFile(outputPath, "utf8"), "domcontentloaded");
});

test("capture-visual-evidence rejects plaintext credential arguments", async () => {
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

  for (const legacyArg of ["--login-username", "--login-password"]) {
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          captureScriptPath(),
          "--url",
          "http://app.example/dashboard",
          "--output",
          join(projectRoot, ".tmp", `${legacyArg.slice(2)}.png`),
          legacyArg,
          "secret",
        ],
        { cwd: projectRoot },
      ),
      (error: unknown) => {
        const stderr = String((error as { stderr?: unknown }).stderr ?? "");
        assert.match(stderr, new RegExp(`unknown argument: ${legacyArg}`, "u"));
        return true;
      },
    );
  }
});

test("capture-visual-evidence uses env vars and label lookup for login", async () => {
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
      "--login-username-env",
      "PATCHMILL_TEST_VISUAL_USER",
      "--login-password-env",
      "PATCHMILL_TEST_VISUAL_PASSWORD",
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        PATCHMILL_TEST_VISUAL_USER: "admin",
        PATCHMILL_TEST_VISUAL_PASSWORD: "secret",
      },
    },
  );

  assert.match(result.stdout, /screenshot=.*proof\.png/u);
  assert.equal(await readFile(outputPath, "utf8"), "admin:secret");
});

test("capture-visual-evidence fails when login env vars are missing", async () => {
  const projectRoot =
    await writeFakePlaywrightProject(`const fs = require('node:fs');
exports.chromium = {
  async launch() {
    return {
      async newPage() {
        return {
          async goto() { this.currentUrl = 'http://app.example/login'; },
          url() { return this.currentUrl || 'http://app.example/login'; },
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

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        captureScriptPath(),
        "--url",
        "http://app.example/dashboard",
        "--output",
        join(projectRoot, ".tmp", "proof.png"),
        "--login-username-env",
        "PATCHMILL_TEST_VISUAL_USER_MISSING",
        "--login-password-env",
        "PATCHMILL_TEST_VISUAL_PASSWORD_MISSING",
      ],
      { cwd: projectRoot, env: { ...process.env } },
    ),
    (error: unknown) => {
      const stderr = String((error as { stderr?: unknown }).stderr ?? "");
      assert.match(
        stderr,
        /environment variable PATCHMILL_TEST_VISUAL_USER_MISSING is not set/u,
      );
      return true;
    },
  );
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
        "--login-username-env",
        "PATCHMILL_TEST_VISUAL_USER",
        "--login-password-env",
        "PATCHMILL_TEST_VISUAL_PASSWORD",
      ],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          PATCHMILL_TEST_VISUAL_USER: "admin",
          PATCHMILL_TEST_VISUAL_PASSWORD: "wrong-password",
        },
      },
    ),
    (error: unknown) => {
      const stderr = String((error as { stderr?: unknown }).stderr ?? "");
      assert.match(stderr, /still at login URL/u);
      return true;
    },
  );
});
