#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");

const LOAD_STATES = new Set(["domcontentloaded", "load", "networkidle"]);

function usage() {
  console.error(`Usage: capture-visual-evidence.cjs --url URL --output FILE [options]

Options:
  --ready-command CMD        Command that must pass before capture
  --viewport WIDTHxHEIGHT    Browser viewport (default: 1366x900)
  --load-state STATE         Navigation wait state: domcontentloaded, load, or networkidle (default: domcontentloaded)
  --wait-text TEXT           Wait for visible text; may be repeated
  --wait-selector SELECTOR   Wait for selector; may be repeated
  --storage-state FILE       Playwright storage state for authenticated sessions
  --login-username-env VAR   Environment variable containing login username
  --login-password-env VAR   Environment variable containing login password
  --username-label LABEL     Username textbox accessible name (default: Username)
  --password-label LABEL     Password field accessible label (default: Password)
  --submit-name NAME         Login button accessible name (default: Sign In)
  --login-url-contains TEXT  Login URL marker (default: /login)
  --no-full-page             Capture viewport only
  --help                     Show this help

The script uses @playwright/test from the project. It does not install or bundle Playwright.
`);
}

function parseArgs(argv) {
  const opts = {
    viewport: "1366x900",
    loadState: "domcontentloaded",
    waitText: [],
    waitSelector: [],
    usernameLabel: "Username",
    passwordLabel: "Password",
    submitName: "Sign In",
    loginUrlContains: "/login",
    fullPage: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      if (index + 1 >= argv.length) throw new Error(`${arg} requires a value`);
      index += 1;
      return argv[index];
    };
    switch (arg) {
      case "--help":
        opts.help = true;
        break;
      case "--url":
        opts.url = next();
        break;
      case "--output":
        opts.output = next();
        break;
      case "--ready-command":
        opts.readyCommand = next();
        break;
      case "--viewport":
        opts.viewport = next();
        break;
      case "--load-state":
        opts.loadState = next();
        break;
      case "--wait-text":
        opts.waitText.push(next());
        break;
      case "--wait-selector":
        opts.waitSelector.push(next());
        break;
      case "--storage-state":
        opts.storageState = next();
        break;
      case "--login-username-env":
        opts.loginUsernameEnv = next();
        break;
      case "--login-password-env":
        opts.loginPasswordEnv = next();
        break;
      case "--login-username":
        throw new Error(
          "unknown argument: --login-username; use --login-username-env VAR or --storage-state FILE",
        );
      case "--login-password":
        throw new Error(
          "unknown argument: --login-password; use --login-password-env VAR or --storage-state FILE",
        );
      case "--username-label":
        opts.usernameLabel = next();
        break;
      case "--password-label":
        opts.passwordLabel = next();
        break;
      case "--submit-name":
        opts.submitName = next();
        break;
      case "--login-url-contains":
        opts.loginUrlContains = next();
        break;
      case "--no-full-page":
        opts.fullPage = false;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function readRequiredEnv(name) {
  if (!name) return undefined;
  const value = process.env[name];
  if (!value) {
    throw new Error(`environment variable ${name} is not set`);
  }
  return value;
}

function loadPlaywright() {
  const projectRequire = createRequire(
    path.resolve(process.cwd(), "package.json"),
  );
  try {
    return projectRequire("@playwright/test");
  } catch (error) {
    const cause =
      error && typeof error === "object" && "message" in error
        ? `\nOriginal error: ${error.message}`
        : "";
    throw new Error(
      "Patchmill visual evidence requires project Playwright support. " +
        "Install/configure @playwright/test in this project or use the project's approved screenshot tooling before returning visualEvidence." +
        cause,
    );
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return;
  }
  if (!opts.url || !opts.output) {
    usage();
    process.exit(2);
  }
  if (!LOAD_STATES.has(opts.loadState)) {
    throw new Error(
      `invalid --load-state: ${opts.loadState}; expected domcontentloaded, load, or networkidle`,
    );
  }

  if (opts.readyCommand) {
    execFileSync("bash", ["-lc", opts.readyCommand], { stdio: "inherit" });
  }

  const { chromium, expect } = loadPlaywright();
  const [width, height] = opts.viewport
    .split(/[x,]/u)
    .map((part) => Number(part.trim()));
  if (!width || !height)
    throw new Error(`invalid --viewport: ${opts.viewport}`);

  fs.mkdirSync(path.dirname(opts.output), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width, height },
      ...(opts.storageState ? { storageState: opts.storageState } : {}),
    });
    await page.goto(opts.url, { waitUntil: opts.loadState });

    if (page.url().includes(opts.loginUrlContains)) {
      if (!opts.loginUsernameEnv || !opts.loginPasswordEnv) {
        throw new Error(
          `page is at login URL (${page.url()}); pass --storage-state FILE or --login-username-env and --login-password-env`,
        );
      }
      const loginUsername = readRequiredEnv(opts.loginUsernameEnv);
      const loginPassword = readRequiredEnv(opts.loginPasswordEnv);
      await page
        .getByRole("textbox", { name: opts.usernameLabel })
        .fill(loginUsername);
      await page.getByLabel(opts.passwordLabel).fill(loginPassword);
      await page.getByRole("button", { name: opts.submitName }).click();
      await page.goto(opts.url, { waitUntil: opts.loadState });
      if (page.url().includes(opts.loginUrlContains)) {
        throw new Error(
          `login did not complete; still at login URL (${page.url()}) after submitting credentials`,
        );
      }
    }

    for (const selector of opts.waitSelector) {
      await page.locator(selector).first().waitFor({ state: "visible" });
    }
    for (const text of opts.waitText) {
      await expect(page.getByText(text).first()).toBeVisible();
    }
    await page.evaluate(() => document.fonts?.ready);
    await page.screenshot({ path: opts.output, fullPage: opts.fullPage });
    console.log(`screenshot=${opts.output}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
