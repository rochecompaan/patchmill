# Source CLI Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move production command implementation code from `scripts/` into
`src/cli/commands/` while preserving public Patchmill CLI behavior.

**Architecture:** Add a testable `src/cli/main.ts` dispatcher, move the triage
and run-once command modules under `src/cli/commands/<command>/`, then make
`bin/patchmill.ts` a thin executable wrapper around the dispatcher. Keep shared
reusable modules in existing `src/config`, `src/git`, `src/host`, `src/pi`,
`src/policy`, and `src/workflow` directories.

**Tech Stack:** Node.js 24 ESM TypeScript, built-in `node:test`, npm scripts,
ESLint, Prettier, markdownlint.

---

## File structure

Create and modify these source areas:

- Create `src/cli/main.ts` — public CLI dispatcher, command lookup, help
  handling, and exit-code normalization.
- Create `src/cli/main.test.ts` — dispatcher unit tests independent of real
  command implementations.
- Move `scripts/agent-issue-triage.ts` to `src/cli/commands/triage/main.ts` —
  `patchmill triage` command entrypoint.
- Move `scripts/agent-issue-triage/*.ts` to `src/cli/commands/triage/*.ts` —
  triage command internals and tests.
- Move `scripts/agent-issue-once.ts` to `src/cli/commands/run-once/main.ts` —
  `patchmill run-once` command entrypoint.
- Move `scripts/agent-issue/*.ts` to `src/cli/commands/run-once/*.ts` — run-once
  command internals and tests.
- Modify `bin/patchmill.ts` — thin wrapper that imports `src/cli/main.ts` and
  exits with its status code.
- Modify `bin/patchmill.test.ts` — keep executable/symlink smoke coverage;
  dispatcher unit coverage moves to `src/cli/main.test.ts`.
- Modify `package.json` — route npm scripts and test/lint globs to the new
  source layout.
- Keep `scripts/audit-generalization.sh` in `scripts/` — maintenance script
  only.

Do not rename the public `run-once` command in this plan.

---

## Task 1: Add testable CLI dispatcher module

**Files:**

- Create: `src/cli/main.test.ts`
- Create: `src/cli/main.ts`

- [ ] **Step 1: Write the failing dispatcher tests**

Create `src/cli/main.test.ts` with this content:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { HELP_TEXT, createCliMain, resolveCommand } from "./main.ts";

test("resolveCommand returns help with no command", () => {
  assert.equal(resolveCommand([], ["triage", "run-once"]), "help");
});

test("resolveCommand maps triage to the public command name", () => {
  assert.deepEqual(resolveCommand(["triage", "--dry-run"], ["triage"]), {
    command: "triage",
    args: ["--dry-run"],
  });
});

test("resolveCommand maps run-once to the public command name", () => {
  assert.deepEqual(resolveCommand(["run-once", "--issue", "7"], ["run-once"]), {
    command: "run-once",
    args: ["--issue", "7"],
  });
});

test("resolveCommand rejects unknown commands", () => {
  assert.throws(
    () => resolveCommand(["queue"], ["triage", "run-once"]),
    /Unknown command: queue/,
  );
});

test("resolveCommand rejects inherited property names", () => {
  assert.throws(
    () => resolveCommand(["toString"], ["triage", "run-once"]),
    /Unknown command: toString/,
  );
});

test("createCliMain prints top-level help", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const main = createCliMain(new Map(), {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });

  assert.equal(await main(["--help"]), 0);
  assert.deepEqual(stdout, [HELP_TEXT]);
  assert.deepEqual(stderr, []);
});

test("createCliMain dispatches selected command with remaining args", async () => {
  const calls: string[][] = [];
  const main = createCliMain(
    new Map([
      [
        "triage",
        async (args) => {
          calls.push(args);
          return 17;
        },
      ],
    ]),
  );

  assert.equal(await main(["triage", "--dry-run"]), 17);
  assert.deepEqual(calls, [["--dry-run"]]);
});

test("createCliMain reports unknown commands with help", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const main = createCliMain(new Map([["triage", async () => 0]]), {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });

  assert.equal(await main(["queue"]), 1);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ["Unknown command: queue", HELP_TEXT]);
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
node --test src/cli/main.test.ts
```

Expected: FAIL because `src/cli/main.ts` does not exist.

- [ ] **Step 3: Implement the dispatcher module**

Create `src/cli/main.ts` with this content:

```ts
export const HELP_TEXT = `Usage:
  patchmill <command> [options]

Commands:
  triage      Classify repository issues for agent readiness.
  run-once    Claim and process one agent-ready issue.
`;

export type CommandHandler = (args: string[]) => number | Promise<number>;

export type CliOutput = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export type ResolvedCommand = {
  command: string;
  args: string[];
};

const DEFAULT_OUTPUT: CliOutput = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

export function resolveCommand(
  argv: string[],
  commandNames: Iterable<string>,
): ResolvedCommand | "help" {
  const command = argv[0];
  if (
    !command ||
    command === "--help" ||
    command === "-h" ||
    command === "help"
  ) {
    return "help";
  }

  if (!new Set(commandNames).has(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  return { command, args: argv.slice(1) };
}

export function createCliMain(
  commands: ReadonlyMap<string, CommandHandler>,
  output: CliOutput = DEFAULT_OUTPUT,
): (argv?: string[]) => Promise<number> {
  return async (argv = process.argv.slice(2)): Promise<number> => {
    let resolved: ResolvedCommand | "help";
    try {
      resolved = resolveCommand(argv, commands.keys());
    } catch (error) {
      output.stderr(error instanceof Error ? error.message : String(error));
      output.stderr(HELP_TEXT);
      return 1;
    }

    if (resolved === "help") {
      output.stdout(HELP_TEXT);
      return 0;
    }

    const handler = commands.get(resolved.command);
    if (!handler) {
      output.stderr(`Unknown command: ${resolved.command}`);
      output.stderr(HELP_TEXT);
      return 1;
    }

    try {
      return await handler(resolved.args);
    } catch (error) {
      output.stderr(error instanceof Error ? error.message : String(error));
      return 1;
    }
  };
}
```

- [ ] **Step 4: Run the dispatcher test to verify it passes**

Run:

```bash
node --test src/cli/main.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the dispatcher module**

Run:

```bash
git add src/cli/main.ts src/cli/main.test.ts
git commit -m "refactor(cli): add source dispatcher"
```

---

## Task 2: Move triage command into `src/cli/commands/triage`

**Files:**

- Move: `scripts/agent-issue-triage.ts` -> `src/cli/commands/triage/main.ts`
- Move: `scripts/agent-issue-triage/*.ts` -> `src/cli/commands/triage/*.ts`
- Modify moved files for relative imports and command entrypoint return codes.

- [ ] **Step 1: Move the triage files with git history**

Run:

```bash
mkdir -p src/cli/commands/triage
git mv scripts/agent-issue-triage.ts src/cli/commands/triage/main.ts
git mv scripts/agent-issue-triage/*.ts src/cli/commands/triage/
```

- [ ] **Step 2: Update triage imports mechanically**

Run:

```bash
perl -0pi -e 's#"\.\./\.\./src/#"../../../#g' src/cli/commands/triage/*.ts
perl -0pi -e 's#"\.\./src/#"../../../#g' src/cli/commands/triage/main.ts
perl -0pi -e 's#"\.\./\.\./test-support/#"../../../../test-support/#g' src/cli/commands/triage/*.test.ts
perl -0pi -e 's#"\./agent-issue-triage/#"./#g' src/cli/commands/triage/main.ts
perl -0pi -e 's#"\.\./agent-issue-triage\.ts"#"./main.ts"#g' src/cli/commands/triage/*.test.ts
```

- [ ] **Step 3: Update the triage command entrypoint API**

Edit `src/cli/commands/triage/main.ts` so the help text starts with public
usage:

```ts
export const HELP_TEXT = `Usage:
  patchmill triage [options]
  npm run triage -- [options]

Automated Forgejo issue triage. Defaults to showing this help when no options are provided.
By default, only open issues without active triage or protection labels are classified.
```

In the same file, replace the current private `main()` function and bottom
`if (isMain)` block with this code:

```ts
export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const config = await loadCliConfig(args);
    if (config.showHelp) {
      console.log(HELP_TEXT);
      return 0;
    }

    const result = await runTriage(createCommandRunner(), config);
    console.log(`agent issue triage: ${result.status}`);
    console.log(`issues: ${result.issueCount}`);
    console.log(`log: ${result.logPath}`);
    for (const line of formatResultLines(result)) {
      console.log(line);
    }
    return 0;
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

Keep the existing `pathToFileURL` import because the moved command module can
still be executed directly during development.

- [ ] **Step 4: Confirm triage help assertions still describe public behavior**

Run:

```bash
rg -n "agent-issue-triage|node scripts|patchmill triage" src/cli/commands/triage/*.test.ts
```

Expected: no `agent-issue-triage` or `node scripts` matches in moved tests. The
tests may assert generic usage, flags, and environment variables without
asserting the executable name.

- [ ] **Step 5: Run triage tests**

Run:

```bash
node --test src/cli/commands/triage/*.test.ts
```

Expected: PASS.

If the command fails with a stale relative import, run:

```bash
rg -n "\.\./\.\./src|\.\./src|\.\./\.\./test-support|agent-issue-triage" src/cli/commands/triage
```

Every shared `src` import in this directory must start with `../../../`; every
`test-support` import must start with `../../../../test-support`; imports of the
moved triage command entrypoint must use `./main.ts`.

- [ ] **Step 6: Confirm no triage TypeScript remains under `scripts/`**

Run:

```bash
find scripts -maxdepth 2 -type f | sort
```

Expected: no `scripts/agent-issue-triage.ts` file and no
`scripts/agent-issue-triage/` directory. `scripts/agent-issue-once.ts`,
`scripts/agent-issue/`, and `scripts/audit-generalization.sh` may still exist at
this point.

- [ ] **Step 7: Commit the triage move**

Run:

```bash
git add scripts src/cli/commands/triage
git commit -m "refactor(cli): move triage command into src"
```

---

## Task 3: Move run-once command into `src/cli/commands/run-once`

**Files:**

- Move: `scripts/agent-issue-once.ts` -> `src/cli/commands/run-once/main.ts`
- Move: `scripts/agent-issue/*.ts` -> `src/cli/commands/run-once/*.ts`
- Modify moved files for relative imports and command entrypoint return codes.

- [ ] **Step 1: Move the run-once files with git history**

Run:

```bash
mkdir -p src/cli/commands/run-once
git mv scripts/agent-issue-once.ts src/cli/commands/run-once/main.ts
git mv scripts/agent-issue/*.ts src/cli/commands/run-once/
```

- [ ] **Step 2: Update run-once imports mechanically**

Run:

```bash
perl -0pi -e 's#"\.\./\.\./src/#"../../../#g' src/cli/commands/run-once/*.ts
perl -0pi -e 's#"\.\./src/#"../../../#g' src/cli/commands/run-once/main.ts
perl -0pi -e 's#"\.\./\.\./test-support/#"../../../../test-support/#g' src/cli/commands/run-once/*.test.ts
perl -0pi -e 's#"\./agent-issue/#"./#g' src/cli/commands/run-once/main.ts
perl -0pi -e 's#"\./agent-issue-triage/command\.ts"#"../triage/command.ts"#g' src/cli/commands/run-once/main.ts
perl -0pi -e 's#"\.\./agent-issue-once\.ts"#"./main.ts"#g' src/cli/commands/run-once/*.test.ts
perl -0pi -e 's#"\.\./agent-issue-triage/#"../triage/#g' src/cli/commands/run-once/*.ts
```

- [ ] **Step 3: Update type-only dynamic imports in run-once types**

Open `src/cli/commands/run-once/types.ts`. Replace the dynamic import path for
`HumanDecisionQuestion` with the new triage path:

```ts
export type AgentIssueBlockerQuestion =
  | string
  | import("../triage/types.ts").HumanDecisionQuestion;
```

- [ ] **Step 4: Update the run-once command entrypoint API**

Edit `src/cli/commands/run-once/main.ts` so the help text starts with public
usage:

```ts
export const HELP_TEXT = `Usage:
  patchmill run-once [options]
  npm run run-once -- [options]

Process one Forgejo issue labeled agent-ready. Defaults to showing this help when no options are provided.
```

In the same file, replace the current private `main()` function and bottom
`if (isMain)` block with this code:

```ts
export async function main(args = process.argv.slice(2)): Promise<number> {
  const startedAt = new Date();
  const timestamp = startedAt.toISOString();

  try {
    const config = await loadCliConfig(args);
    if (config.showHelp) {
      console.log(HELP_TEXT);
      return 0;
    }

    const logPath = runLogPath(config.runStateDir, timestamp);
    const progress = compositeProgressReporter([
      new JsonlProgressReporter(logPath),
      ...(config.quiet
        ? []
        : [new AgentIssueConsoleProgressReporter({ startedAt })]),
    ]);

    let result: AgentIssuePipelineResult;
    try {
      result = await runOneIssue(createCommandRunner(), config, {
        now: startedAt,
        progress,
        logPath,
        verbosePiOutput: config.verbosePiOutput,
        streamPiOutput:
          !config.quiet && config.verbosePiOutput
            ? (chunk) => {
                process.stderr.write(chunk);
              }
            : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await progress.event({
        time: new Date().toISOString(),
        level: "error",
        stage: "error",
        message: `blocked: ${message}`,
        data: { error: message },
      });
      console.log(JSON.stringify({ status: "error", error: message, logPath }));
      return 1;
    }

    const outputLogPath = await finalLogPath(
      logPath,
      config.runStateDir,
      timestamp,
      result,
    );
    console.log(
      JSON.stringify(summarizeResult({ ...result, logPath: outputLogPath })),
    );
    return result.status === "blocked" ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify({ status: "error", error: message }));
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

Keep the existing `pathToFileURL` import because the moved command module can
still be executed directly during development.

- [ ] **Step 5: Update run-once help assertions**

In `src/cli/commands/run-once/args.test.ts`, replace the old script-name
assertion:

```ts
assert.match(HELP_TEXT, /agent-issue-once/);
```

with:

```ts
assert.match(HELP_TEXT, /patchmill run-once/);
```

- [ ] **Step 6: Run run-once tests**

Run:

```bash
node --test src/cli/commands/run-once/*.test.ts
```

Expected: PASS.

If the command fails with a stale relative import, run:

```bash
rg -n "\.\./\.\./src|\.\./src|\.\./\.\./test-support|agent-issue-triage|agent-issue-once" src/cli/commands/run-once
```

Every shared `src` import in this directory must start with `../../../`; every
`test-support` import must start with `../../../../test-support`; imports of
triage command modules must use `../triage/`; imports of the moved run-once
command entrypoint must use `./main.ts`.

- [ ] **Step 7: Confirm no production TypeScript remains under `scripts/`**

Run:

```bash
find scripts -maxdepth 2 -type f | sort
```

Expected exactly:

```text
scripts/audit-generalization.sh
```

- [ ] **Step 8: Commit the run-once move**

Run:

```bash
git add scripts src/cli/commands/run-once
git commit -m "refactor(cli): move run-once command into src"
```

---

## Task 4: Wire `bin/patchmill.ts` to the source dispatcher

**Files:**

- Modify: `src/cli/main.ts`
- Modify: `bin/patchmill.ts`
- Modify: `bin/patchmill.test.ts`

- [ ] **Step 1: Wire real command handlers into `src/cli/main.ts`**

At the top of `src/cli/main.ts`, add these imports before `HELP_TEXT`:

```ts
import { main as runOnceMain } from "./commands/run-once/main.ts";
import { main as triageMain } from "./commands/triage/main.ts";
```

At the end of `src/cli/main.ts`, add the default command map and exported CLI
main:

```ts
const COMMANDS = new Map<string, CommandHandler>([
  ["triage", triageMain],
  ["run-once", runOnceMain],
]);

export const main = createCliMain(COMMANDS);
```

- [ ] **Step 2: Replace `bin/patchmill.ts` with a thin wrapper**

Overwrite `bin/patchmill.ts` with this content:

```ts
#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { main } from "../src/cli/main.ts";

function isMainModule(metaUrl: string, argv1 = process.argv[1]): boolean {
  if (!argv1) return false;

  try {
    return metaUrl === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main();
}
```

- [ ] **Step 3: Update `bin/patchmill.test.ts`**

Replace `bin/patchmill.test.ts` with this content:

```ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { HELP_TEXT } from "../src/cli/main.ts";

test("patchmill executes when invoked through a symlink", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const fixtureDir = mkdtempSync(join(tmpdir(), "patchmill-"));
  const symlinkPath = join(fixtureDir, "patchmill-link.ts");

  try {
    symlinkSync(join(repoRoot, "bin", "patchmill.ts"), symlinkPath, "file");

    const result = spawnSync(process.execPath, [symlinkPath, "--help"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${HELP_TEXT}\n`);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Run CLI dispatcher and bin tests**

Run:

```bash
node --test src/cli/main.test.ts bin/patchmill.test.ts
```

Expected: PASS.

- [ ] **Step 5: Smoke-check top-level help**

Run:

```bash
node bin/patchmill.ts --help
```

Expected stdout:

```text
Usage:
  patchmill <command> [options]

Commands:
  triage      Classify repository issues for agent readiness.
  run-once    Claim and process one agent-ready issue.
```

- [ ] **Step 6: Smoke-check command help dispatch**

Run:

```bash
node bin/patchmill.ts triage --help
node bin/patchmill.ts run-once --help
```

Expected: first command exits 0 and prints `patchmill triage [options]`; second
command exits 0 and prints `patchmill run-once [options]`.

- [ ] **Step 7: Commit dispatcher wiring**

Run:

```bash
git add bin/patchmill.ts bin/patchmill.test.ts src/cli/main.ts
git commit -m "refactor(cli): dispatch commands from src"
```

---

## Task 5: Update package scripts and verify the final layout

**Files:**

- Modify: `package.json`
- Modify: any README or reference doc that directly mentions old executable
  script paths outside historical plans/specs.

- [ ] **Step 1: Update `package.json` scripts**

Edit `package.json` scripts to use this block:

```json
{
  "patchmill": "node bin/patchmill.ts",
  "triage": "node bin/patchmill.ts triage",
  "run-once": "node bin/patchmill.ts run-once",
  "audit:generalization": "bash ./scripts/audit-generalization.sh",
  "lint": "npm run format:check && npm run lint:ts && npm run lint:md",
  "lint:ts": "eslint \"{bin,src,test-support}/**/*.ts\" --max-warnings=0",
  "lint:md": "markdownlint-cli2",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "prepare": "husky",
  "test": "node --test \"bin/*.test.ts\" \"src/**/*.test.ts\" \"test-support/*.test.ts\"",
  "test:coverage": "node --test --experimental-test-coverage --test-coverage-include='bin/**/*.ts' --test-coverage-include='src/**/*.ts' --test-coverage-include='test-support/**/*.ts' --test-coverage-exclude='**/*.test.ts' \"bin/*.test.ts\" \"src/**/*.test.ts\" \"test-support/*.test.ts\"",
  "test:cli": "node --test bin/*.test.ts src/cli/main.test.ts",
  "test:triage": "node --test src/cli/commands/triage/*.test.ts",
  "test:run-once": "node --test src/cli/commands/run-once/*.test.ts"
}
```

Keep all non-script fields in `package.json` unchanged.

- [ ] **Step 2: Check for stale runtime references to old script paths**

Run:

```bash
rg -n "scripts/agent-issue|agent-issue-once|agent-issue-triage|node scripts" package.json README.md src bin test-support docs --glob '!docs/plans/**' --glob '!docs/specs/**'
```

Expected: no matches. Historical `docs/plans/**` and `docs/specs/**` are
excluded because they intentionally describe previous layouts and migration
mappings.

- [ ] **Step 3: Check final `scripts/` contents**

Run:

```bash
find scripts -maxdepth 2 -type f | sort
```

Expected exactly:

```text
scripts/audit-generalization.sh
```

- [ ] **Step 4: Run focused package-script tests**

Run:

```bash
npm run test:cli
npm run test:triage
npm run test:run-once
```

Expected: all PASS.

- [ ] **Step 5: Run full tests and lint**

Run:

```bash
npm test
npm run lint
```

Expected: all PASS.

- [ ] **Step 6: Run final CLI smoke checks**

Run:

```bash
node bin/patchmill.ts --help
npm run triage -- --help
npm run run-once -- --help
```

Expected: all exit 0. The first prints top-level `patchmill <command>` help; the
second prints `patchmill triage [options]`; the third prints
`patchmill run-once [options]`.

- [ ] **Step 7: Commit package and verification cleanup**

Run:

```bash
git add package.json README.md docs src bin scripts
git commit -m "chore(cli): update scripts for source layout"
```

If `README.md` and `docs/` did not change, commit only the changed files:

```bash
git add package.json src bin scripts
git commit -m "chore(cli): update scripts for source layout"
```

---

## Task 6: Final review before handoff

**Files:**

- Inspect: whole working tree.

- [ ] **Step 1: Confirm clean status**

Run:

```bash
git status --short
```

Expected: no output.

- [ ] **Step 2: Confirm recent commits tell the migration story**

Run:

```bash
git log --oneline -5
```

Expected: recent commits include:

```text
chore(cli): update scripts for source layout
refactor(cli): dispatch commands from src
refactor(cli): move run-once command into src
refactor(cli): move triage command into src
refactor(cli): add source dispatcher
```

- [ ] **Step 3: Report verification evidence**

In the final response, include:

```text
Implemented source CLI reorganization.

Verification:
- npm test: PASS
- npm run lint: PASS
- node bin/patchmill.ts --help: PASS
- npm run triage -- --help: PASS
- npm run run-once -- --help: PASS
```

Do not claim completion unless those commands were run and passed.
