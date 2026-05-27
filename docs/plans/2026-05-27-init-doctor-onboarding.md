# Init and Doctor Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safety-first `patchmill init` and read-only `patchmill doctor`
commands that prepare and verify a repository before existing dry-run workflows.

**Architecture:** Add two new command modules under `src/cli/commands/`, keep
repo config writing isolated in the init command, and keep doctor checks as
independent read-only probes with structured reporting. Reuse existing config
loading, command runner, Forgejo label/issue readers, triage policy helpers, and
git cleanliness helper where possible.

**Tech Stack:** TypeScript ESM, Node 24 built-ins, `node:test`, existing
Patchmill CLI command dispatch and `CommandRunner` abstraction.

---

## File structure

Create:

- `src/cli/commands/init/args.ts` — parse `patchmill init` flags and represent
  injectable stdin/stdout environment for tests.
- `src/cli/commands/init/config-writer.ts` — infer local config values and write
  minimal `patchmill.config.json` safely.
- `src/cli/commands/init/pi-preflight.ts` — detect apparent Pi provider setup
  from local environment/auth only.
- `src/cli/commands/init/main.ts` — CLI entrypoint, user-facing output, optional
  Pi handoff prompt.
- `src/cli/commands/init/args.test.ts` — unit tests for init args.
- `src/cli/commands/init/config-writer.test.ts` — unit tests for config writing
  and overwrite safety.
- `src/cli/commands/init/pi-preflight.test.ts` — unit tests for env/auth
  detection.
- `src/cli/commands/init/main.test.ts` — tests for init output and Pi handoff
  behavior.
- `src/cli/commands/doctor/args.ts` — parse `patchmill doctor` flags.
- `src/cli/commands/doctor/checks.ts` — read-only doctor check orchestration and
  result types.
- `src/cli/commands/doctor/reporting.ts` — checklist and remediation formatting.
- `src/cli/commands/doctor/main.ts` — CLI entrypoint.
- `src/cli/commands/doctor/args.test.ts` — unit tests for doctor args.
- `src/cli/commands/doctor/checks.test.ts` — unit tests for check aggregation
  and read-only command behavior.
- `src/cli/commands/doctor/reporting.test.ts` — unit tests for
  checklist/remediation output.
- `src/cli/commands/doctor/main.test.ts` — CLI entrypoint tests.

Modify:

- `src/cli/main.ts` — register `init` and `doctor` commands and update help
  text.
- `src/cli/main.test.ts` — cover dispatch and help for the new commands.
- `README.md` — add first-use flow to docs.
- `docs/configuration.md` — mention `patchmill init` and `patchmill doctor` as
  onboarding entrypoints.
- `docs/issue-agent-workflows.md` — mention `doctor` as the preflight before dry
  runs.

Do not modify:

- Existing triage/run-once dry-run behavior.
- Pi credential storage.
- Host mutation helpers, except by importing their read-only functions.

---

## Task 1: Register command dispatch contract

**Files:**

- Modify: `src/cli/main.ts`
- Modify: `src/cli/main.test.ts`

- [ ] **Step 1: Write failing dispatch tests**

Modify `src/cli/main.test.ts` so command-name lists and assertions include
`init` and `doctor`.

Add these tests after the existing `resolveCommand maps run-once...` test:

```ts
test("resolveCommand maps init to the public command name", () => {
  assert.deepEqual(resolveCommand(["init"], ["init"]), {
    command: "init",
    args: [],
  });
});

test("resolveCommand maps doctor to the public command name", () => {
  assert.deepEqual(resolveCommand(["doctor", "--quiet"], ["doctor"]), {
    command: "doctor",
    args: ["--quiet"],
  });
});
```

Update the inherited-property and unknown-command tests to pass command arrays
that include all public commands:

```ts
["init", "doctor", "triage", "run-once"];
```

Add this dispatch test after
`createCliMain dispatches selected command with remaining args`:

```ts
test("createCliMain dispatches init and doctor commands", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const main = createCliMain(
    new Map([
      [
        "init",
        async (args) => {
          calls.push({ command: "init", args });
          return 0;
        },
      ],
      [
        "doctor",
        async (args) => {
          calls.push({ command: "doctor", args });
          return 0;
        },
      ],
    ]),
  );

  assert.equal(await main(["init"]), 0);
  assert.equal(await main(["doctor", "--quiet"]), 0);
  assert.deepEqual(calls, [
    { command: "init", args: [] },
    { command: "doctor", args: ["--quiet"] },
  ]);
});
```

Update the top-level help assertion to expect `init` and `doctor` in
`HELP_TEXT`.

- [ ] **Step 2: Run the dispatch tests to verify failure**

Run:

```sh
node --test src/cli/main.test.ts
```

Expected: FAIL because `HELP_TEXT` and the command registry do not include
`init` or `doctor`, and imports for the command mains do not exist yet.

- [ ] **Step 3: Add temporary command entrypoint stubs**

Create `src/cli/commands/init/main.ts`:

```ts
export const HELP_TEXT = `Usage:
  patchmill init [options]

Create a minimal patchmill.config.json for this repository.

Options:
  --help, -h  Show this help and exit.
`;

export async function main(args = process.argv.slice(2)): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP_TEXT);
    return 0;
  }
  console.log("patchmill init is not implemented yet");
  return 1;
}
```

Create `src/cli/commands/doctor/main.ts`:

```ts
export const HELP_TEXT = `Usage:
  patchmill doctor [options]

Run read-only checks for Patchmill repository readiness.

Options:
  --help, -h  Show this help and exit.
`;

export async function main(args = process.argv.slice(2)): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP_TEXT);
    return 0;
  }
  console.log("patchmill doctor is not implemented yet");
  return 1;
}
```

- [ ] **Step 4: Register the new commands**

Modify `src/cli/main.ts` imports:

```ts
import { main as doctorMain } from "./commands/doctor/main.ts";
import { main as initMain } from "./commands/init/main.ts";
import { main as runOnceMain } from "./commands/run-once/main.ts";
import { main as triageMain } from "./commands/triage/main.ts";
```

Update `HELP_TEXT` commands block:

```ts
Commands:
  init        Create a minimal patchmill.config.json.
  doctor      Run read-only readiness checks.
  triage      Classify repository issues for agent readiness.
  run-once    Claim and process one agent-ready issue.
```

Update `COMMANDS`:

```ts
const COMMANDS = new Map<string, CommandHandler>([
  ["init", initMain],
  ["doctor", doctorMain],
  ["triage", triageMain],
  ["run-once", runOnceMain],
]);
```

- [ ] **Step 5: Run dispatch tests**

Run:

```sh
node --test src/cli/main.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit dispatch scaffolding**

Run:

```sh
git add src/cli/main.ts src/cli/main.test.ts src/cli/commands/init/main.ts src/cli/commands/doctor/main.ts
git commit -m "feat(cli): add init and doctor commands"
```

---

## Task 2: Implement `patchmill init` minimal config writing

**Files:**

- Create: `src/cli/commands/init/args.ts`
- Create: `src/cli/commands/init/args.test.ts`
- Create: `src/cli/commands/init/config-writer.ts`
- Create: `src/cli/commands/init/config-writer.test.ts`
- Modify: `src/cli/commands/init/main.ts`

- [ ] **Step 1: Write failing init args tests**

Create `src/cli/commands/init/args.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "./args.ts";

test("parseArgs defaults to creating config", () => {
  assert.deepEqual(parseArgs([], "/repo"), {
    repoRoot: "/repo",
    showHelp: false,
  });
});

test("parseArgs recognizes help", () => {
  assert.deepEqual(parseArgs(["--help"], "/repo"), {
    repoRoot: "/repo",
    showHelp: true,
  });
  assert.deepEqual(parseArgs(["-h"], "/repo"), {
    repoRoot: "/repo",
    showHelp: true,
  });
});

test("parseArgs rejects force in v1", () => {
  assert.throws(
    () => parseArgs(["--force"], "/repo"),
    /Unknown argument: --force/,
  );
});

test("parseArgs rejects unknown arguments", () => {
  assert.throws(
    () => parseArgs(["--json"], "/repo"),
    /Unknown argument: --json/,
  );
});
```

- [ ] **Step 2: Implement init args**

Create `src/cli/commands/init/args.ts`:

```ts
import { cwd } from "node:process";

export type InitConfig = {
  repoRoot: string;
  showHelp: boolean;
};

export function parseArgs(args: string[], repoRoot = cwd()): InitConfig {
  const config: InitConfig = {
    repoRoot,
    showHelp: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      config.showHelp = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return config;
}
```

- [ ] **Step 3: Verify init args tests pass**

Run:

```sh
node --test src/cli/commands/init/args.test.ts
```

Expected: PASS.

- [ ] **Step 4: Write failing config writer tests**

Create `src/cli/commands/init/config-writer.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
  CONFIG_FILE_NAME,
  buildInitialConfig,
  inferHostProviderFromRemote,
  writeInitialConfig,
} from "./config-writer.ts";

async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-init-"));
}

test("buildInitialConfig returns minimal default config", () => {
  assert.deepEqual(buildInitialConfig(), {
    host: {
      provider: "forgejo-tea",
      login: "triage-agent",
    },
  });
});

test("inferHostProviderFromRemote recognizes Forgejo-like remotes", () => {
  assert.equal(
    inferHostProviderFromRemote("git@forgejo.example.com:owner/repo.git"),
    "forgejo-tea",
  );
  assert.equal(
    inferHostProviderFromRemote("https://codeberg.org/owner/repo.git"),
    "forgejo-tea",
  );
});

test("inferHostProviderFromRemote falls back to forgejo-tea for unknown remotes", () => {
  assert.equal(
    inferHostProviderFromRemote("git@example.com:owner/repo.git"),
    "forgejo-tea",
  );
});

test("writeInitialConfig writes pretty minimal JSON", async () => {
  const repoRoot = await tempRepo();
  const result = await writeInitialConfig(repoRoot, {});

  assert.deepEqual(result, {
    status: "created",
    path: join(repoRoot, CONFIG_FILE_NAME),
    config: buildInitialConfig(),
  });
  assert.equal(
    await readFile(join(repoRoot, CONFIG_FILE_NAME), "utf8"),
    `${JSON.stringify(buildInitialConfig(), null, 2)}\n`,
  );
});

test("writeInitialConfig refuses to overwrite existing config", async () => {
  const repoRoot = await tempRepo();
  await writeFile(join(repoRoot, CONFIG_FILE_NAME), "{}\n");

  const result = await writeInitialConfig(repoRoot, {});

  assert.deepEqual(result, {
    status: "exists",
    path: join(repoRoot, CONFIG_FILE_NAME),
  });
  assert.equal(
    await readFile(join(repoRoot, CONFIG_FILE_NAME), "utf8"),
    "{}\n",
  );
});

test("writeInitialConfig reads origin remote from git config when present", async () => {
  const repoRoot = await tempRepo();
  await mkdir(join(repoRoot, ".git"));
  await writeFile(
    join(repoRoot, ".git", "config"),
    `[remote "origin"]\n\turl = git@forgejo.example.com:owner/repo.git\n`,
  );

  const result = await writeInitialConfig(repoRoot, {});

  assert.equal(result.status, "created");
  assert.deepEqual(
    JSON.parse(await readFile(join(repoRoot, CONFIG_FILE_NAME), "utf8")),
    buildInitialConfig(),
  );
});
```

- [ ] **Step 5: Implement config writer**

Create `src/cli/commands/init/config-writer.ts`:

```ts
import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import type { PatchmillConfig } from "../../../config/types.ts";

export const CONFIG_FILE_NAME = "patchmill.config.json";

type InitialConfig = {
  host: Pick<PatchmillConfig["host"], "provider" | "login">;
};

export type InitWriteResult =
  | { status: "created"; path: string; config: InitialConfig }
  | { status: "exists"; path: string };

export function inferHostProviderFromRemote(
  _remoteUrl: string | undefined,
): PatchmillConfig["host"]["provider"] {
  return "forgejo-tea";
}

export function buildInitialConfig(
  options: {
    provider?: PatchmillConfig["host"]["provider"];
    login?: string;
  } = {},
): InitialConfig {
  return {
    host: {
      provider: options.provider ?? DEFAULT_PATCHMILL_CONFIG.host.provider,
      login: options.login ?? DEFAULT_PATCHMILL_CONFIG.host.login,
    },
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function originRemoteUrl(repoRoot: string): Promise<string | undefined> {
  try {
    const config = await readFile(join(repoRoot, ".git", "config"), "utf8");
    const lines = config.split(/\r?\n/u);
    let inOrigin = false;
    for (const line of lines) {
      const section = /^\s*\[remote\s+"([^"]+)"\]\s*$/u.exec(line);
      if (section) {
        inOrigin = section[1] === "origin";
        continue;
      }
      if (!inOrigin) continue;
      const url = /^\s*url\s*=\s*(\S+)\s*$/u.exec(line);
      if (url) return url[1];
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function writeInitialConfig(
  repoRoot: string,
  options: { login?: string },
): Promise<InitWriteResult> {
  const path = join(repoRoot, CONFIG_FILE_NAME);
  if (await fileExists(path)) return { status: "exists", path };

  const provider = inferHostProviderFromRemote(await originRemoteUrl(repoRoot));
  const config = buildInitialConfig({ provider, login: options.login });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, {
    flag: "wx",
  });
  return { status: "created", path, config };
}
```

- [ ] **Step 6: Verify config writer tests pass**

Run:

```sh
node --test src/cli/commands/init/config-writer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Wire init main to config writer**

Replace the temporary body of `src/cli/commands/init/main.ts` with:

```ts
#!/usr/bin/env node
import { cwd } from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./args.ts";
import { writeInitialConfig } from "./config-writer.ts";

export const HELP_TEXT = `Usage:
  patchmill init [options]

Create a minimal patchmill.config.json for this repository.

Options:
  --help, -h  Show this help and exit.
`;

export type InitOutput = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

const DEFAULT_OUTPUT: InitOutput = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

export async function runInit(
  args: string[],
  repoRoot = cwd(),
  output: InitOutput = DEFAULT_OUTPUT,
): Promise<number> {
  const config = parseArgs(args, repoRoot);
  if (config.showHelp) {
    output.stdout(HELP_TEXT);
    return 0;
  }

  const result = await writeInitialConfig(config.repoRoot, {});
  if (result.status === "exists") {
    output.stdout(
      `patchmill.config.json already exists.\n\nPatchmill did not overwrite it.\n\nNext:\n  patchmill doctor`,
    );
    return 1;
  }

  output.stdout(
    `Created patchmill.config.json\n\nHost:\n  provider: ${result.config.host.provider}\n  login: ${result.config.host.login}\n\nUsing Patchmill defaults for labels, paths, skills, and git policy.\n\nNext:\n  patchmill doctor`,
  );
  return 0;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    return await runInit(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  process.exitCode = await main();
}
```

- [ ] **Step 8: Add init main tests**

Create `src/cli/commands/init/main.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HELP_TEXT, runInit } from "./main.ts";

async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-init-main-"));
}

test("runInit prints help", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(
    await runInit(["--help"], await tempRepo(), {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    }),
    0,
  );
  assert.deepEqual(stdout, [HELP_TEXT]);
  assert.deepEqual(stderr, []);
});

test("runInit creates config and prints next step", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];

  assert.equal(
    await runInit([], repoRoot, {
      stdout: (line) => stdout.push(line),
      stderr: () => undefined,
    }),
    0,
  );

  assert.match(stdout.join("\n"), /Created patchmill\.config\.json/);
  assert.match(stdout.join("\n"), /provider: forgejo-tea/);
  assert.match(stdout.join("\n"), /patchmill doctor/);
});

test("runInit refuses existing config", async () => {
  const repoRoot = await tempRepo();
  await writeFile(join(repoRoot, "patchmill.config.json"), "{}\n");
  const stdout: string[] = [];

  assert.equal(
    await runInit([], repoRoot, {
      stdout: (line) => stdout.push(line),
      stderr: () => undefined,
    }),
    1,
  );
  assert.match(stdout.join("\n"), /already exists/);
  assert.match(stdout.join("\n"), /did not overwrite/);
});
```

- [ ] **Step 9: Verify init tests pass**

Run:

```sh
node --test src/cli/commands/init/*.test.ts src/cli/main.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit init config writing**

Run:

```sh
git add src/cli/commands/init src/cli/main.ts src/cli/main.test.ts
git commit -m "feat(init): write minimal patchmill config"
```

---

## Task 3: Add Pi provider preflight and native setup handoff to `init`

**Files:**

- Create: `src/cli/commands/init/pi-preflight.ts`
- Create: `src/cli/commands/init/pi-preflight.test.ts`
- Modify: `src/cli/commands/init/main.ts`
- Modify: `src/cli/commands/init/main.test.ts`

- [ ] **Step 1: Write failing Pi preflight tests**

Create `src/cli/commands/init/pi-preflight.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hasApparentPiProviderConfig } from "./pi-preflight.ts";

async function homeDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-pi-home-"));
}

test("hasApparentPiProviderConfig detects known provider API key env vars", async () => {
  assert.equal(
    await hasApparentPiProviderConfig({
      env: { ANTHROPIC_API_KEY: "sk-ant-test" },
      homeDir: await homeDir(),
    }),
    true,
  );
  assert.equal(
    await hasApparentPiProviderConfig({
      env: { OPENAI_API_KEY: "sk-test" },
      homeDir: await homeDir(),
    }),
    true,
  );
  assert.equal(
    await hasApparentPiProviderConfig({
      env: { GEMINI_API_KEY: "test" },
      homeDir: await homeDir(),
    }),
    true,
  );
});

test("hasApparentPiProviderConfig ignores empty env vars", async () => {
  assert.equal(
    await hasApparentPiProviderConfig({
      env: { ANTHROPIC_API_KEY: "" },
      homeDir: await homeDir(),
    }),
    false,
  );
});

test("hasApparentPiProviderConfig detects auth.json entries", async () => {
  const home = await homeDir();
  await mkdir(join(home, ".pi", "agent"), { recursive: true });
  await writeFile(
    join(home, ".pi", "agent", "auth.json"),
    JSON.stringify({
      anthropic: { type: "api_key", key: "ANTHROPIC_API_KEY" },
    }),
  );

  assert.equal(
    await hasApparentPiProviderConfig({ env: {}, homeDir: home }),
    true,
  );
});

test("hasApparentPiProviderConfig returns false for missing or empty auth", async () => {
  assert.equal(
    await hasApparentPiProviderConfig({ env: {}, homeDir: await homeDir() }),
    false,
  );

  const home = await homeDir();
  await mkdir(join(home, ".pi", "agent"), { recursive: true });
  await writeFile(join(home, ".pi", "agent", "auth.json"), "{}\n");
  assert.equal(
    await hasApparentPiProviderConfig({ env: {}, homeDir: home }),
    false,
  );
});
```

- [ ] **Step 2: Implement Pi preflight helper**

Create `src/cli/commands/init/pi-preflight.ts`:

```ts
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const PI_PROVIDER_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "MISTRAL_API_KEY",
  "GROQ_API_KEY",
  "CLOUDFLARE_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
  "AI_GATEWAY_API_KEY",
  "ZAI_API_KEY",
  "OPENCODE_API_KEY",
  "HF_TOKEN",
  "FIREWORKS_API_KEY",
  "KIMI_API_KEY",
  "MINIMAX_API_KEY",
  "MINIMAX_CN_API_KEY",
  "XIAOMI_API_KEY",
  "XIAOMI_TOKEN_PLAN_CN_API_KEY",
  "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
  "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
] as const;

type Env = Record<string, string | undefined>;

function hasProviderEnv(env: Env): boolean {
  return PI_PROVIDER_ENV_VARS.some((key) => (env[key]?.trim().length ?? 0) > 0);
}

function hasAuthEntries(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}

export async function hasApparentPiProviderConfig(
  options: {
    env?: Env;
    homeDir?: string;
  } = {},
): Promise<boolean> {
  const env = options.env ?? process.env;
  if (hasProviderEnv(env)) return true;

  const authPath = join(
    options.homeDir ?? homedir(),
    ".pi",
    "agent",
    "auth.json",
  );
  try {
    return hasAuthEntries(
      JSON.parse(await readFile(authPath, "utf8")) as unknown,
    );
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Verify Pi preflight tests pass**

Run:

```sh
node --test src/cli/commands/init/pi-preflight.test.ts
```

Expected: PASS.

- [ ] **Step 4: Extend init main with injectable prompt and launcher**

Modify `src/cli/commands/init/main.ts` imports:

```ts
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import { hasApparentPiProviderConfig } from "./pi-preflight.ts";
```

Add types and helpers above `runInit`:

```ts
export type PiLauncher = () => Promise<number>;
export type InitPrompt = (question: string) => Promise<string>;

function defaultPiLauncher(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("pi", [], { stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function defaultPrompt(question: string): Promise<string> {
  const rl = createInterface({ input: defaultStdin, output: defaultStdout });
  return rl.question(question).finally(() => rl.close());
}

function isYes(value: string): boolean {
  return /^(y|yes)$/iu.test(value.trim());
}
```

Change `runInit` signature:

```ts
export async function runInit(
  args: string[],
  repoRoot = cwd(),
  output: InitOutput = DEFAULT_OUTPUT,
  options: {
    env?: Record<string, string | undefined>;
    homeDir?: string;
    prompt?: InitPrompt;
    launchPi?: PiLauncher;
    isInteractive?: boolean;
  } = {},
): Promise<number> {
```

After config write succeeds and before final output, add:

```ts
const hasPiProvider = await hasApparentPiProviderConfig({
  env: options.env,
  homeDir: options.homeDir,
});
let piMessage =
  "Pi provider configuration detected.\nDoctor will verify it with a minimal smoke test.";
if (!hasPiProvider) {
  piMessage =
    "Patchmill also requires Pi with an LLM provider configured.\nNo provider configuration was detected.";
  if (options.isInteractive ?? process.stdin.isTTY) {
    const answer = await (options.prompt ?? defaultPrompt)(
      "Open Pi now to configure a provider with `/login`? [y/N] ",
    );
    if (isYes(answer)) {
      const code = await (options.launchPi ?? defaultPiLauncher)();
      piMessage +=
        code === 0
          ? "\n\nReturned from Pi provider setup."
          : "\n\nPi exited before provider setup could be confirmed.";
    } else {
      piMessage += "\n\nTo configure manually, run `pi`, then `/login`.";
    }
  } else {
    piMessage += "\n\nTo configure manually, run `pi`, then `/login`.";
  }
}
```

Insert `${piMessage}` in the successful output between defaults and `Next:`.

- [ ] **Step 5: Add init handoff tests**

Append to `src/cli/commands/init/main.test.ts`:

```ts
test("runInit does not offer Pi handoff when provider config is apparent", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  let prompted = false;

  assert.equal(
    await runInit(
      [],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        env: { ANTHROPIC_API_KEY: "sk-ant-test" },
        homeDir: await tempRepo(),
        isInteractive: true,
        prompt: async () => {
          prompted = true;
          return "yes";
        },
      },
    ),
    0,
  );

  assert.equal(prompted, false);
  assert.match(stdout.join("\n"), /Pi provider configuration detected/);
});

test("runInit offers Pi handoff when provider config is not apparent", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  let launched = false;

  assert.equal(
    await runInit(
      [],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        env: {},
        homeDir: await tempRepo(),
        isInteractive: true,
        prompt: async () => "y",
        launchPi: async () => {
          launched = true;
          return 0;
        },
      },
    ),
    0,
  );

  assert.equal(launched, true);
  assert.match(stdout.join("\n"), /No provider configuration was detected/);
  assert.match(stdout.join("\n"), /Returned from Pi provider setup/);
});

test("runInit handles declined Pi handoff without error", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];

  assert.equal(
    await runInit(
      [],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        env: {},
        homeDir: await tempRepo(),
        isInteractive: true,
        prompt: async () => "no",
      },
    ),
    0,
  );

  assert.match(
    stdout.join("\n"),
    /To configure manually, run `pi`, then `\/login`/,
  );
  assert.match(stdout.join("\n"), /patchmill doctor/);
});
```

- [ ] **Step 6: Verify init handoff tests pass**

Run:

```sh
node --test src/cli/commands/init/*.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Pi setup handoff**

Run:

```sh
git add src/cli/commands/init
git commit -m "feat(init): hand off pi provider setup"
```

---

## Task 4: Implement doctor read-only checks and reporting

**Files:**

- Create: `src/cli/commands/doctor/args.ts`
- Create: `src/cli/commands/doctor/args.test.ts`
- Create: `src/cli/commands/doctor/checks.ts`
- Create: `src/cli/commands/doctor/checks.test.ts`
- Create: `src/cli/commands/doctor/reporting.ts`
- Create: `src/cli/commands/doctor/reporting.test.ts`

- [ ] **Step 1: Write failing doctor args tests**

Create `src/cli/commands/doctor/args.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "./args.ts";

test("parseArgs defaults to running checks", () => {
  assert.deepEqual(parseArgs([], "/repo"), {
    repoRoot: "/repo",
    showHelp: false,
    quiet: false,
  });
});

test("parseArgs recognizes help", () => {
  assert.equal(parseArgs(["--help"], "/repo").showHelp, true);
  assert.equal(parseArgs(["-h"], "/repo").showHelp, true);
});

test("parseArgs recognizes quiet", () => {
  assert.deepEqual(parseArgs(["--quiet"], "/repo"), {
    repoRoot: "/repo",
    showHelp: false,
    quiet: true,
  });
});

test("parseArgs rejects fix mode in v1", () => {
  assert.throws(() => parseArgs(["--fix"], "/repo"), /Unknown argument: --fix/);
});
```

- [ ] **Step 2: Implement doctor args**

Create `src/cli/commands/doctor/args.ts`:

```ts
import { cwd } from "node:process";

export type DoctorConfig = {
  repoRoot: string;
  showHelp: boolean;
  quiet: boolean;
};

export function parseArgs(args: string[], repoRoot = cwd()): DoctorConfig {
  const config: DoctorConfig = {
    repoRoot,
    showHelp: false,
    quiet: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      config.showHelp = true;
    } else if (arg === "--quiet") {
      config.quiet = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return config;
}
```

- [ ] **Step 3: Verify doctor args tests pass**

Run:

```sh
node --test src/cli/commands/doctor/args.test.ts
```

Expected: PASS.

- [ ] **Step 4: Write reporting tests**

Create `src/cli/commands/doctor/reporting.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDoctorReport } from "./reporting.ts";
import type { DoctorCheckResult } from "./checks.ts";

const passing: DoctorCheckResult[] = [
  { name: "config", status: "pass", message: "patchmill.config.json" },
  { name: "git", status: "pass", message: "clean worktree" },
];

test("formatDoctorReport prints success checklist and next command", () => {
  assert.deepEqual(formatDoctorReport(passing), [
    "Patchmill doctor",
    "",
    "✓ config: patchmill.config.json",
    "✓ git: clean worktree",
    "",
    "Ready for safe dry runs.",
    "",
    "Next:",
    "  patchmill triage --dry-run",
  ]);
});

test("formatDoctorReport prints failures and remediation", () => {
  const lines = formatDoctorReport([
    ...passing,
    {
      name: "labels",
      status: "fail",
      message: "missing agent-ready, needs-info",
      remediation: [
        "Patchmill doctor is read-only and did not create labels.",
        "",
        "Create the missing labels manually, then rerun:",
        "  tea labels create --name agent-ready --color 0e8a16",
        "  patchmill doctor",
      ],
    },
  ]);

  assert.deepEqual(lines, [
    "Patchmill doctor",
    "",
    "✓ config: patchmill.config.json",
    "✓ git: clean worktree",
    "✗ labels: missing agent-ready, needs-info",
    "",
    "Patchmill doctor is read-only and did not create labels.",
    "",
    "Create the missing labels manually, then rerun:",
    "  tea labels create --name agent-ready --color 0e8a16",
    "  patchmill doctor",
  ]);
});

test("formatDoctorReport prints warnings but keeps next command", () => {
  const lines = formatDoctorReport([
    ...passing,
    {
      name: "paths",
      status: "warn",
      message: "worktree directory does not exist yet",
    },
  ]);

  assert.match(
    lines.join("\n"),
    /! paths: worktree directory does not exist yet/,
  );
  assert.match(lines.join("\n"), /Ready for safe dry runs/);
});
```

- [ ] **Step 5: Implement reporting**

Create `src/cli/commands/doctor/reporting.ts`:

```ts
import type { DoctorCheckResult } from "./checks.ts";

function prefix(status: DoctorCheckResult["status"]): string {
  if (status === "pass") return "✓";
  if (status === "warn") return "!";
  return "✗";
}

export function hasDoctorFailures(results: DoctorCheckResult[]): boolean {
  return results.some((result) => result.status === "fail");
}

export function formatDoctorReport(results: DoctorCheckResult[]): string[] {
  const lines = ["Patchmill doctor", ""];
  lines.push(
    ...results.map(
      (result) => `${prefix(result.status)} ${result.name}: ${result.message}`,
    ),
  );

  const remediation = results.flatMap((result) => result.remediation ?? []);
  if (remediation.length > 0) {
    lines.push("", ...remediation);
    return lines;
  }

  if (!hasDoctorFailures(results)) {
    lines.push(
      "",
      "Ready for safe dry runs.",
      "",
      "Next:",
      "  patchmill triage --dry-run",
    );
  }

  return lines;
}
```

- [ ] **Step 6: Write doctor checks tests**

Create `src/cli/commands/doctor/checks.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runDoctorChecks } from "./checks.ts";
import type { CommandRunner } from "../triage/types.ts";

async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-doctor-"));
}

function runnerFrom(
  map: Record<string, { code: number; stdout?: string; stderr?: string }>,
): CommandRunner {
  return {
    async run(command, args) {
      const key = [command, ...args].join(" ");
      const result = map[key] ?? {
        code: 127,
        stderr: `missing mock for ${key}`,
      };
      return {
        code: result.code,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    },
  };
}

test("runDoctorChecks aggregates successful read-only checks", async () => {
  const repoRoot = await tempRepo();
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      host: { provider: "forgejo-tea", login: "triage-agent" },
    }),
  );
  const runner = runnerFrom({
    "git rev-parse --is-inside-work-tree": { code: 0, stdout: "true\n" },
    "git branch --show-current": { code: 0, stdout: "main\n" },
    "git status --porcelain=v1 --untracked-files=all": { code: 0, stdout: "" },
    "tea labels list --limit 1000 --output json --repo /repo --login triage-agent":
      { code: 0, stdout: "[]" },
    "tea issues --state open --limit 1000 --page 1 --output json --repo /repo --login triage-agent":
      { code: 0, stdout: "[]" },
    "pi --help": { code: 0, stdout: "pi help" },
    "pi --no-session --no-context-files --no-prompt-templates -p Reply with PATCHMILL_PI_OK and nothing else.":
      { code: 0, stdout: "PATCHMILL_PI_OK\n" },
  });

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });

  assert.equal(
    results.find((result) => result.name === "config")?.status,
    "pass",
  );
  assert.equal(results.find((result) => result.name === "git")?.status, "pass");
  assert.equal(
    results.find((result) => result.name === "pi provider")?.status,
    "pass",
  );
  assert.equal(
    results.some((result) => result.status === "fail"),
    false,
  );
});

test("runDoctorChecks reports invalid config and continues", async () => {
  const repoRoot = await tempRepo();
  await writeFile(join(repoRoot, "patchmill.config.json"), "{");
  const runner = runnerFrom({});

  const results = await runDoctorChecks(runner, { repoRoot });

  assert.equal(results[0]?.name, "config");
  assert.equal(results[0]?.status, "fail");
  assert.ok(results.length > 1);
});

test("runDoctorChecks reports missing labels with manual commands", async () => {
  const repoRoot = await tempRepo();
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      host: { provider: "forgejo-tea", login: "triage-agent" },
    }),
  );
  const runner = runnerFrom({
    "git rev-parse --is-inside-work-tree": { code: 0, stdout: "true\n" },
    "git branch --show-current": { code: 0, stdout: "main\n" },
    "git status --porcelain=v1 --untracked-files=all": { code: 0, stdout: "" },
    "tea labels list --limit 1000 --output json --repo /repo --login triage-agent":
      { code: 0, stdout: "[]" },
    "tea issues --state open --limit 1000 --page 1 --output json --repo /repo --login triage-agent":
      { code: 0, stdout: "[]" },
    "pi --help": { code: 0, stdout: "pi help" },
    "pi --no-session --no-context-files --no-prompt-templates -p Reply with PATCHMILL_PI_OK and nothing else.":
      { code: 0, stdout: "PATCHMILL_PI_OK\n" },
  });

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const labels = results.find((result) => result.name === "labels");

  assert.equal(labels?.status, "fail");
  assert.match(labels?.message ?? "", /agent-ready/);
  assert.match(
    (labels?.remediation ?? []).join("\n"),
    /tea labels create --name agent-ready/,
  );
});

test("runDoctorChecks never invokes known mutating host commands", async () => {
  const repoRoot = await tempRepo();
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      host: { provider: "forgejo-tea", login: "triage-agent" },
    }),
  );
  const commands: string[] = [];
  const runner: CommandRunner = {
    async run(command, args) {
      commands.push([command, ...args].join(" "));
      return { code: 1, stdout: "", stderr: "mock failure" };
    },
  };

  await runDoctorChecks(runner, { repoRoot });

  assert.equal(
    commands.some((command) =>
      /labels create|issues edit|comment/.test(command),
    ),
    false,
  );
});
```

- [ ] **Step 7: Implement doctor checks**

Create `src/cli/commands/doctor/checks.ts` with these definitions. Keep helpers
focused; do not import mutating helpers such as `createLabel`,
`applyIssueLabels`, or `commentIssue`.

```ts
import { access } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { loadPatchmillConfigState } from "../../../config/load.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import { missingLabelDefinitions } from "../triage/labels.ts";
import { listLabels, listOpenIssues } from "../triage/forgejo.ts";
import { assertCleanWorktree } from "../run-once/git.ts";
import type { CommandRunner } from "../triage/types.ts";

export type DoctorCheckStatus = "pass" | "warn" | "fail";

export type DoctorCheckResult = {
  name: string;
  status: DoctorCheckStatus;
  message: string;
  remediation?: string[];
};

type DoctorOptions = {
  repoRoot: string;
  env?: Record<string, string | undefined>;
  teaRepoRootForTests?: string;
};

function pass(name: string, message: string): DoctorCheckResult {
  return { name, status: "pass", message };
}

function warn(name: string, message: string): DoctorCheckResult {
  return { name, status: "warn", message };
}

function fail(
  name: string,
  message: string,
  remediation?: string[],
): DoctorCheckResult {
  return {
    name,
    status: "fail",
    message,
    ...(remediation ? { remediation } : {}),
  };
}

function commandOutput(result: {
  code: number;
  stdout: string;
  stderr: string;
}): string {
  return (
    [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n") ||
    "no output"
  );
}

async function checkGit(
  runner: CommandRunner,
  repoRoot: string,
): Promise<DoctorCheckResult> {
  const inside = await runner.run(
    "git",
    ["rev-parse", "--is-inside-work-tree"],
    { cwd: repoRoot },
  );
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    return fail("git", `not inside a git worktree: ${commandOutput(inside)}`);
  }

  const branch = await runner.run("git", ["branch", "--show-current"], {
    cwd: repoRoot,
  });
  try {
    await assertCleanWorktree(runner, repoRoot, [
      ".patchmill/runs/",
      ".patchmill/triage-runs/",
    ]);
  } catch (error) {
    return fail("git", error instanceof Error ? error.message : String(error));
  }

  const branchName =
    branch.code === 0 && branch.stdout.trim()
      ? branch.stdout.trim()
      : "detached HEAD";
  return pass("git", `clean worktree on ${branchName}`);
}

async function pathStatus(
  path: string,
): Promise<"exists" | "parent-usable" | "missing"> {
  try {
    await access(path);
    return "exists";
  } catch {
    try {
      await access(dirname(path));
      return "parent-usable";
    } catch {
      return "missing";
    }
  }
}

async function checkPiBinary(
  runner: CommandRunner,
  repoRoot: string,
): Promise<DoctorCheckResult> {
  const result = await runner.run("pi", ["--help"], { cwd: repoRoot });
  return result.code === 0
    ? pass("pi", "binary available")
    : fail("pi", `binary unavailable: ${commandOutput(result)}`, [
        "Install Pi, then rerun:",
        "  npm install -g @earendil-works/pi-coding-agent",
        "  patchmill doctor",
      ]);
}

async function checkPiProvider(
  runner: CommandRunner,
  repoRoot: string,
): Promise<DoctorCheckResult> {
  const prompt = "Reply with PATCHMILL_PI_OK and nothing else.";
  const result = await runner.run(
    "pi",
    [
      "--no-session",
      "--no-context-files",
      "--no-prompt-templates",
      "-p",
      prompt,
    ],
    { cwd: repoRoot },
  );
  if (result.code === 0 && result.stdout.includes("PATCHMILL_PI_OK")) {
    return pass("pi provider", "minimal LLM smoke test succeeded");
  }
  return fail("pi provider", "Pi could not complete a minimal LLM smoke test", [
    "Patchmill doctor did not change the repository or issue host.",
    "The Pi check made no Patchmill workflow changes, but it could not reach a configured model provider.",
    "",
    "Configure Pi, then rerun:",
    "  pi",
    "  /login",
    "  patchmill doctor",
    "",
    "Alternatively set a provider API key, for example:",
    "  export ANTHROPIC_API_KEY=sk-ant-...",
    "  patchmill doctor",
  ]);
}

export async function runDoctorChecks(
  runner: CommandRunner,
  options: DoctorOptions,
): Promise<DoctorCheckResult[]> {
  const results: DoctorCheckResult[] = [];
  let loaded;
  try {
    loaded = await loadPatchmillConfigState(
      options.repoRoot,
      options.env ?? process.env,
      [],
    );
    results.push(
      loaded.hasConfigFile
        ? pass("config", "patchmill.config.json")
        : fail("config", "patchmill.config.json not found", [
            "Create local config, then rerun:",
            "  patchmill init",
            "  patchmill doctor",
          ]),
    );
  } catch (error) {
    results.push(
      fail("config", error instanceof Error ? error.message : String(error)),
    );
  }

  results.push(await checkGit(runner, options.repoRoot));

  if (!loaded) {
    results.push(fail("host", "skipped because config did not load"));
    results.push(fail("issues", "skipped because config did not load"));
    results.push(fail("labels", "skipped because config did not load"));
  } else {
    const config = loaded.config;
    const repoRoot = options.teaRepoRootForTests ?? options.repoRoot;
    if (config.host.provider !== "forgejo-tea") {
      results.push(
        fail("host", `unsupported provider ${config.host.provider}`),
      );
    } else {
      const teaHelp = await runner.run("tea", ["--help"], {
        cwd: options.repoRoot,
      });
      results.push(
        teaHelp.code === 0
          ? pass("host", `forgejo via tea as ${config.host.login}`)
          : fail("host", `tea unavailable: ${commandOutput(teaHelp)}`),
      );
    }

    try {
      const issues = await listOpenIssues(runner, repoRoot, config.host.login);
      results.push(
        pass("issues", `open issues can be listed (${issues.length})`),
      );
    } catch (error) {
      results.push(
        fail("issues", error instanceof Error ? error.message : String(error)),
      );
    }

    try {
      const policy = createTriagePolicy(config.labels, config.triage);
      const missing = missingLabelDefinitions(
        await listLabels(runner, repoRoot, config.host.login),
        policy,
      );
      if (missing.length === 0) {
        results.push(
          pass(
            "labels",
            policy.allowedLabels.map((label) => label.name).join(", "),
          ),
        );
      } else {
        results.push(
          fail(
            "labels",
            `missing ${missing.map((label) => label.name).join(", ")}`,
            [
              "Patchmill doctor is read-only and did not create labels.",
              "",
              "Create the missing labels manually, then rerun:",
              ...missing.map(
                (label) =>
                  `  tea labels create --name ${label.name} --color ${label.color}`,
              ),
              "  patchmill doctor",
            ],
          ),
        );
      }
    } catch (error) {
      results.push(
        fail("labels", error instanceof Error ? error.message : String(error)),
      );
    }

    const skillNames = [
      config.skills.triage,
      config.skills.planning,
      config.skills.implementation,
    ];
    results.push(pass("skills", skillNames.join(", ")));

    const paths = [
      ["plans", config.paths.plansDir],
      ["run-state", config.paths.runStateDir],
      ["triage", config.paths.triageLogDir],
      ["worktree", config.paths.worktreeDir],
    ] as const;
    const statuses = await Promise.all(
      paths.map(async ([name, path]) => `${name}:${await pathStatus(path)}`),
    );
    results.push(
      statuses.some((entry) => entry.endsWith(":missing"))
        ? warn("paths", statuses.join(", "))
        : pass("paths", statuses.join(", ")),
    );
  }

  results.push(await checkPiBinary(runner, options.repoRoot));
  results.push(await checkPiProvider(runner, options.repoRoot));

  return results;
}
```

The `teaRepoRootForTests` option is a narrow testing seam. If it feels
undesirable during implementation, instead improve the mock key construction to
match real `withTeaContext()` output for temp repos.

- [ ] **Step 8: Run doctor unit tests and fix integration details**

Run:

```sh
node --test src/cli/commands/doctor/args.test.ts src/cli/commands/doctor/reporting.test.ts src/cli/commands/doctor/checks.test.ts
```

Expected: PASS after adjusting mock command keys to match the actual `tea`
argument order. If tests fail because `listOpenIssues` paginates and requests
page 2, add this mock too:

```ts
"tea issues --state open --limit 1000 --page 2 --output json --repo /repo --login triage-agent": { code: 0, stdout: "[]" }
```

- [ ] **Step 9: Commit doctor checks/reporting**

Run:

```sh
git add src/cli/commands/doctor
git commit -m "feat(doctor): add read-only readiness checks"
```

---

## Task 5: Wire doctor CLI entrypoint and polish behavior

**Files:**

- Modify: `src/cli/commands/doctor/main.ts`
- Create: `src/cli/commands/doctor/main.test.ts`
- Modify: `src/cli/commands/doctor/checks.ts` if Task 4 integration details
  require cleanup.

- [ ] **Step 1: Write doctor main tests**

Create `src/cli/commands/doctor/main.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { HELP_TEXT, runDoctor } from "./main.ts";
import type { CommandRunner } from "../triage/types.ts";
import type { DoctorCheckResult } from "./checks.ts";

const runner: CommandRunner = {
  async run() {
    return { code: 0, stdout: "", stderr: "" };
  },
};

test("runDoctor prints help", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(
    await runDoctor(["--help"], "/repo", {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    }),
    0,
  );

  assert.deepEqual(stdout, [HELP_TEXT]);
  assert.deepEqual(stderr, []);
});

test("runDoctor returns zero when checks pass", async () => {
  const stdout: string[] = [];
  const checks: DoctorCheckResult[] = [
    { name: "config", status: "pass", message: "patchmill.config.json" },
  ];

  assert.equal(
    await runDoctor(
      [],
      "/repo",
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      { runner, runChecks: async () => checks },
    ),
    0,
  );
  assert.match(stdout.join("\n"), /Ready for safe dry runs/);
});

test("runDoctor returns one when any check fails", async () => {
  const stdout: string[] = [];
  const checks: DoctorCheckResult[] = [
    { name: "config", status: "fail", message: "missing" },
  ];

  assert.equal(
    await runDoctor(
      [],
      "/repo",
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      { runner, runChecks: async () => checks },
    ),
    1,
  );
  assert.match(stdout.join("\n"), /✗ config: missing/);
});
```

- [ ] **Step 2: Implement doctor main**

Replace `src/cli/commands/doctor/main.ts` with:

```ts
#!/usr/bin/env node
import { cwd } from "node:process";
import { pathToFileURL } from "node:url";
import { createCommandRunner } from "../triage/command.ts";
import { parseArgs } from "./args.ts";
import { runDoctorChecks, type DoctorCheckResult } from "./checks.ts";
import { formatDoctorReport, hasDoctorFailures } from "./reporting.ts";
import type { CommandRunner } from "../triage/types.ts";

export const HELP_TEXT = `Usage:
  patchmill doctor [options]

Run read-only checks for Patchmill repository readiness.

Options:
  --help, -h  Show this help and exit.
  --quiet     Suppress successful checklist output; failures still print.
`;

export type DoctorOutput = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

const DEFAULT_OUTPUT: DoctorOutput = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

export async function runDoctor(
  args: string[],
  repoRoot = cwd(),
  output: DoctorOutput = DEFAULT_OUTPUT,
  options: {
    runner?: CommandRunner;
    runChecks?: (
      runner: CommandRunner,
      options: { repoRoot: string },
    ) => Promise<DoctorCheckResult[]>;
  } = {},
): Promise<number> {
  const config = parseArgs(args, repoRoot);
  if (config.showHelp) {
    output.stdout(HELP_TEXT);
    return 0;
  }

  const runner = options.runner ?? createCommandRunner();
  const results = await (options.runChecks ?? runDoctorChecks)(runner, {
    repoRoot: config.repoRoot,
  });
  const failed = hasDoctorFailures(results);
  if (!config.quiet || failed) {
    output.stdout(formatDoctorReport(results).join("\n"));
  }
  return failed ? 1 : 0;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    return await runDoctor(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  process.exitCode = await main();
}
```

- [ ] **Step 3: Verify doctor main tests pass**

Run:

```sh
node --test src/cli/commands/doctor/*.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run broader CLI tests**

Run:

```sh
npm run test:cli
```

Expected: PASS.

- [ ] **Step 5: Commit doctor CLI integration**

Run:

```sh
git add src/cli/commands/doctor src/cli/main.ts src/cli/main.test.ts
git commit -m "feat(doctor): wire readiness command"
```

---

## Task 6: Documentation and final verification

**Files:**

- Modify: `README.md`
- Modify: `docs/configuration.md`
- Modify: `docs/issue-agent-workflows.md`

- [ ] **Step 1: Update README first-use section**

In `README.md`, add a short first-use section after the intro and before
“Configuration”:

````md
## First use

After installing Patchmill, start with the safety-first onboarding flow:

```sh
patchmill init
patchmill doctor
patchmill triage --dry-run
patchmill run-once
patchmill run-once --execute
```

`patchmill init` writes a minimal local `patchmill.config.json` and, when Pi
provider setup is not apparent, can hand you to Pi's native `/login` flow.
`patchmill doctor` is read-only: it checks git, host access, labels, Pi, skills,
and local paths before recommending dry runs.
````

Escape the nested fenced code block correctly when editing Markdown.

- [ ] **Step 2: Update configuration docs**

In `docs/configuration.md`, add near the top:

```md
## Creating the initial config

Use `patchmill init` to create the smallest useful `patchmill.config.json` for a
repository. The generated file usually only needs the host provider and login;
Patchmill fills omitted labels, paths, skills, and git policy from defaults.

Run `patchmill doctor` after initialization to validate the config and local
toolchain before dry runs.
```

- [ ] **Step 3: Update workflow docs**

In `docs/issue-agent-workflows.md`, add near the opening section:

````md
Before running issue-agent workflows in a new repository, run:

```sh
patchmill init
patchmill doctor
```

`doctor` is read-only and verifies repository, host, label, Pi provider, skill,
and path readiness before the existing `triage --dry-run` and `run-once` dry-run
flows.
````

Escape the nested fenced code block correctly when editing Markdown.

- [ ] **Step 4: Run documentation lint**

Run:

```sh
npx markdownlint-cli2 README.md docs/configuration.md docs/issue-agent-workflows.md docs/plans/2026-05-27-init-doctor-onboarding.md
```

Expected: `0 error(s)`.

- [ ] **Step 5: Run targeted tests**

Run:

```sh
node --test src/cli/main.test.ts src/cli/commands/init/*.test.ts src/cli/commands/doctor/*.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Run full test suite**

Run:

```sh
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Run full lint**

Run:

```sh
npm run lint
```

Expected: all checks pass.

- [ ] **Step 8: Commit docs and final verification cleanup**

Run:

```sh
git add README.md docs/configuration.md docs/issue-agent-workflows.md docs/plans/2026-05-27-init-doctor-onboarding.md
git commit -m "docs(onboarding): document init and doctor flow"
```

If implementation adjustments remain unstaged after tests/lint, include them in
the relevant feature commit instead of the docs-only commit.

---

## Self-review notes

Spec coverage:

- `patchmill init` creation, overwrite refusal, minimal config, remote/provider
  inference, and Pi setup handoff are covered by Tasks 2 and 3.
- `patchmill doctor` read-only checks, Pi binary/provider validation, label
  reporting, paths, and output are covered by Tasks 4 and 5.
- Command dispatch and help are covered by Task 1.
- Docs and verification are covered by Task 6.

No intentional `doctor --fix` or `init --force` work is included. Existing
dry-run behavior is not redesigned.
