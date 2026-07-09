#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");

function usage() {
  console.error(`Usage: capture-visual-evidence.cjs --url URL --output FILE [options]

Options:
  --ready-command CMD        Command that must pass before capture
  --viewport WIDTHxHEIGHT    Browser viewport (default: 1366x900)
  --wait-text TEXT           Wait for visible text; may be repeated
  --wait-selector SELECTOR   Wait for selector; may be repeated
  --login-username USER      Username for login redirects
  --login-password PASS      Password for login redirects
  --username-label LABEL     Username textbox accessible name (default: Username)
  --password-label LABEL     Password textbox accessible name (default: Password)
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
      case "--wait-text":
        opts.waitText.push(next());
        break;
      case "--wait-selector":
        opts.waitSelector.push(next());
        break;
      case "--login-username":
        opts.loginUsername = next();
        break;
      case "--login-password":
        opts.loginPassword = next();
        break;
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
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(opts.url, { waitUntil: "networkidle" });

    if (page.url().includes(opts.loginUrlContains)) {
      if (!opts.loginUsername || !opts.loginPassword) {
        throw new Error(
          `page is at login URL (${page.url()}); pass --login-username and --login-password`,
        );
      }
      await page
        .getByRole("textbox", { name: opts.usernameLabel })
        .fill(opts.loginUsername);
      await page.getByLabel(opts.passwordLabel).fill(opts.loginPassword);
      await page.getByRole("button", { name: opts.submitName }).click();
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.goto(opts.url, { waitUntil: "networkidle" });
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
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
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
