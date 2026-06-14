# Init Git Policy Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `patchmill init` local-only warning with an interactive
git handling choice while keeping `.git/info/exclude` as the non-interactive
default.

**Architecture:** Add a focused init git-policy helper that owns ignore/exclude
file edits, prompt normalization, and `git add` execution. Keep `main.ts`
responsible for orchestration: choose the policy, apply it, and print the
resulting message.

**Tech Stack:** TypeScript, Node `node:test`, Node filesystem APIs, existing
`CommandRunner` abstraction.

---

## File Structure

- Create `src/cli/commands/init/git-policy.ts`
  - Defines git policy choices and entries.
  - Appends entries to `.gitignore` and `.git/info/exclude` without duplicates.
  - Resolves `.git` directories and worktree gitdir files.
  - Applies the chosen policy and returns a message for init output.
- Create `src/cli/commands/init/git-policy.test.ts`
  - Unit tests for add-to-git, git-ignore, git-exclude, non-duplicate append
    behavior, and missing git metadata warnings.
- Modify `src/cli/commands/init/main.ts`
  - Replace direct `ensurePatchmillLocalExcludeEntries` use and broad
    consistency warning with git policy selection and application.
  - Add a small prompt path only for interactive runs without `--yes`.
  - Inject an optional command runner for tests.
- Create `src/cli/commands/init/main-git-policy.test.ts`
  - Integration tests for prompt choices and non-interactive defaults without
    growing `main.test.ts` further.
- Modify `src/cli/commands/init/main.test.ts`
  - Update existing assertions that expect the old warning or old exclude
    message text.
- Modify `docs/configuration.md`
  - Describe the interactive choice and the non-interactive `.git/info/exclude`
    default.

## Task 1: Add the git-policy helper with test-first coverage

**Files:**

- Create: `src/cli/commands/init/git-policy.test.ts`
- Create: `src/cli/commands/init/git-policy.ts`
- Read-only reference: `src/cli/commands/init/local-ignore.ts`
- Read-only reference: `src/cli/commands/triage/types.ts`

- [ ] **Step 1: Write failing tests for helper behavior**

Create `src/cli/commands/init/git-policy.test.ts` with this content:

```ts
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CommandRunner } from "../triage/types.ts";
import { applyInitGitPolicy, selectInitGitPolicy } from "./git-policy.ts";

async function tempRepo(options: { git?: boolean } = { git: true }) {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-git-policy-"));
  if (options.git !== false) {
    await mkdir(join(repoRoot, ".git", "info"), { recursive: true });
  }
  return repoRoot;
}

function recordingRunner(calls: string[][] = []): CommandRunner {
  return {
    async run(command, args, options) {
      calls.push([command, ...args, `cwd=${options?.cwd ?? ""}`]);
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

test("selectInitGitPolicy defaults to git-exclude for non-interactive runs", async () => {
  assert.equal(
    await selectInitGitPolicy({ isInteractive: false, assumeYes: false }),
    "exclude",
  );
  assert.equal(
    await selectInitGitPolicy({ isInteractive: true, assumeYes: true }),
    "exclude",
  );
});

test("selectInitGitPolicy accepts add, ignore, and exclude prompt answers", async () => {
  assert.equal(
    await selectInitGitPolicy({
      isInteractive: true,
      assumeYes: false,
      prompt: async () => "1",
    }),
    "add",
  );
  assert.equal(
    await selectInitGitPolicy({
      isInteractive: true,
      assumeYes: false,
      prompt: async () => "ignore",
    }),
    "ignore",
  );
  assert.equal(
    await selectInitGitPolicy({
      isInteractive: true,
      assumeYes: false,
      prompt: async () => "",
    }),
    "exclude",
  );
});

test("applyInitGitPolicy add stages config, skills, and runtime ignore entries", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];

  const result = await applyInitGitPolicy({
    repoRoot,
    policy: "add",
    runner: recordingRunner(calls),
  });

  assert.equal(
    await readFile(join(repoRoot, ".gitignore"), "utf8"),
    ".patchmill/pi-agent\n.patchmill/runs\n.patchmill/triage-runs\n",
  );
  assert.deepEqual(calls, [
    [
      "git",
      "add",
      "patchmill.config.json",
      ".patchmill/skills",
      ".gitignore",
      `cwd=${repoRoot}`,
    ],
  ]);
  assert.match(result.message, /Added Patchmill config and skills to git/u);
});

test("applyInitGitPolicy ignore writes patchmill.config.json and .patchmill to .gitignore", async () => {
  const repoRoot = await tempRepo();

  const result = await applyInitGitPolicy({
    repoRoot,
    policy: "ignore",
    runner: recordingRunner(),
  });

  assert.equal(
    await readFile(join(repoRoot, ".gitignore"), "utf8"),
    "patchmill.config.json\n.patchmill/\n",
  );
  assert.match(result.message, /Added Patchmill files to .gitignore/u);
});

test("applyInitGitPolicy exclude writes patchmill.config.json and .patchmill to local exclude", async () => {
  const repoRoot = await tempRepo();

  const result = await applyInitGitPolicy({
    repoRoot,
    policy: "exclude",
    runner: recordingRunner(),
  });

  assert.equal(
    await readFile(join(repoRoot, ".git", "info", "exclude"), "utf8"),
    "patchmill.config.json\n.patchmill/\n",
  );
  assert.match(result.message, /Added Patchmill files to .git\/info\/exclude/u);
});

test("applyInitGitPolicy does not duplicate existing ignore or exclude entries", async () => {
  const repoRoot = await tempRepo();
  await writeFile(
    join(repoRoot, ".gitignore"),
    "node_modules\n.patchmill/pi-agent\n.patchmill/runs\n.patchmill/triage-runs\n",
  );
  await writeFile(
    join(repoRoot, ".git", "info", "exclude"),
    "node_modules\n.patchmill\npatchmill.config.json\n",
  );

  await applyInitGitPolicy({
    repoRoot,
    policy: "add",
    runner: recordingRunner(),
  });
  await applyInitGitPolicy({
    repoRoot,
    policy: "exclude",
    runner: recordingRunner(),
  });

  assert.equal(
    await readFile(join(repoRoot, ".gitignore"), "utf8"),
    "node_modules\n.patchmill/pi-agent\n.patchmill/runs\n.patchmill/triage-runs\n",
  );
  assert.equal(
    await readFile(join(repoRoot, ".git", "info", "exclude"), "utf8"),
    "node_modules\n.patchmill\npatchmill.config.json\n",
  );
});

test("applyInitGitPolicy reports missing git metadata without failing init", async () => {
  const repoRoot = await tempRepo({ git: false });

  const result = await applyInitGitPolicy({
    repoRoot,
    policy: "exclude",
    runner: recordingRunner(),
  });

  assert.match(
    result.message,
    /Warning: Patchmill could not update .git\/info\/exclude/u,
  );
  assert.match(result.message, /patchmill.config.json/u);
  assert.match(result.message, /.patchmill\//u);
});
```

- [ ] **Step 2: Run the helper tests to verify they fail because the module is
      missing**

Run:

```bash
node --test src/cli/commands/init/git-policy.test.ts
```

Expected: FAIL with an import error for `./git-policy.ts`.

- [ ] **Step 3: Implement the helper**

Create `src/cli/commands/init/git-policy.ts` with this content:

```ts
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { CommandRunner } from "../triage/types.ts";

export type InitGitPolicy = "add" | "ignore" | "exclude";

export const PATCHMILL_GIT_IGNORE_ENTRIES = [
  "patchmill.config.json",
  ".patchmill/",
] as const;

export const PATCHMILL_ADD_TO_GIT_IGNORE_ENTRIES = [
  ".patchmill/pi-agent",
  ".patchmill/runs",
  ".patchmill/triage-runs",
] as const;

export type InitGitPolicyResult = {
  policy: InitGitPolicy;
  message: string;
};

export type InitGitPolicyPrompt = (question: string) => Promise<string>;

function normalEntry(entry: string): string {
  return entry.trim().replace(/\/+$/u, "");
}

function hasEntry(lines: string[], entry: string): boolean {
  const wanted = normalEntry(entry);
  return lines.some((line) => normalEntry(line) === wanted);
}

async function appendEntries(
  path: string,
  entries: readonly string[],
): Promise<string[]> {
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const lines = existing.split(/\r?\n/u);
  const added = entries.filter((entry) => !hasEntry(lines, entry));
  if (added.length === 0) return [];

  const separator =
    existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  await writeFile(path, `${existing}${separator}${added.join("\n")}\n`);
  return added;
}

async function resolveGitDir(repoRoot: string): Promise<string | undefined> {
  const dotGit = join(repoRoot, ".git");

  try {
    const dotGitStat = await stat(dotGit);
    if (dotGitStat.isDirectory()) return dotGit;
    if (!dotGitStat.isFile()) return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  const dotGitContent = await readFile(dotGit, "utf8");
  const match = /^gitdir:\s*(.+?)\s*$/imu.exec(dotGitContent);
  if (!match) return undefined;

  const gitDir = match[1] ?? "";
  return isAbsolute(gitDir) ? gitDir : resolve(repoRoot, gitDir);
}

function formatEntries(entries: readonly string[]): string {
  return entries.map((entry) => `  ${entry}`).join("\n");
}

export async function selectInitGitPolicy(options: {
  isInteractive: boolean;
  assumeYes: boolean;
  prompt?: InitGitPolicyPrompt;
}): Promise<InitGitPolicy> {
  if (!options.isInteractive || options.assumeYes || !options.prompt) {
    return "exclude";
  }

  const answer = (
    await options.prompt(
      [
        "How should Patchmill files be handled by git?",
        "  1) Add config and skills to git",
        "  2) Add Patchmill files to .gitignore",
        "  3) Add Patchmill files to .git/info/exclude (local only)",
        "Choose 1, 2, or 3 [3]: ",
      ].join("\n"),
    )
  )
    .trim()
    .toLowerCase();

  if (["1", "a", "add", "git", "add to git"].includes(answer)) return "add";
  if (["2", "i", "ignore", "gitignore", "git ignore"].includes(answer)) {
    return "ignore";
  }
  return "exclude";
}

export async function applyInitGitPolicy(options: {
  repoRoot: string;
  policy: InitGitPolicy;
  runner: CommandRunner;
}): Promise<InitGitPolicyResult> {
  if (options.policy === "add") {
    const gitignorePath = join(options.repoRoot, ".gitignore");
    const added = await appendEntries(
      gitignorePath,
      PATCHMILL_ADD_TO_GIT_IGNORE_ENTRIES,
    );
    const gitAdd = await options.runner.run(
      "git",
      ["add", "patchmill.config.json", ".patchmill/skills", ".gitignore"],
      { cwd: options.repoRoot },
    );
    const gitAddMessage =
      gitAdd.code === 0
        ? "Staged patchmill.config.json, .patchmill/skills, and .gitignore."
        : `Warning: git add failed: ${gitAdd.stderr || gitAdd.stdout || "unknown error"}`;
    const ignoreMessage =
      added.length > 0
        ? `Added local Patchmill runtime directories to .gitignore:\n${formatEntries(added)}`
        : "Local Patchmill runtime directories were already listed in .gitignore.";
    return {
      policy: options.policy,
      message: [
        "Added Patchmill config and skills to git.",
        gitAddMessage,
        ignoreMessage,
      ].join("\n"),
    };
  }

  if (options.policy === "ignore") {
    const added = await appendEntries(
      join(options.repoRoot, ".gitignore"),
      PATCHMILL_GIT_IGNORE_ENTRIES,
    );
    return {
      policy: options.policy,
      message:
        added.length > 0
          ? `Added Patchmill files to .gitignore:\n${formatEntries(added)}`
          : "Patchmill files were already listed in .gitignore.",
    };
  }

  const gitDir = await resolveGitDir(options.repoRoot);
  const excludePath = gitDir
    ? join(gitDir, "info", "exclude")
    : join(options.repoRoot, ".git", "info", "exclude");
  if (!gitDir) {
    return {
      policy: options.policy,
      message: [
        "Warning: Patchmill could not update .git/info/exclude because this directory is not inside a git repository.",
        "Add these entries manually to keep Patchmill files local:",
        formatEntries(PATCHMILL_GIT_IGNORE_ENTRIES),
      ].join("\n"),
    };
  }

  await mkdir(join(gitDir, "info"), { recursive: true });
  const added = await appendEntries(excludePath, PATCHMILL_GIT_IGNORE_ENTRIES);
  return {
    policy: options.policy,
    message:
      added.length > 0
        ? `Added Patchmill files to .git/info/exclude:\n${formatEntries(added)}`
        : "Patchmill files were already listed in .git/info/exclude.",
  };
}
```

- [ ] **Step 4: Run helper tests to verify green**

Run:

```bash
node --test src/cli/commands/init/git-policy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit helper**

Run:

```bash
git add src/cli/commands/init/git-policy.ts src/cli/commands/init/git-policy.test.ts
git commit -m "feat(init): add git policy helper"
```

## Task 2: Wire the prompt into `patchmill init`

**Files:**

- Modify: `src/cli/commands/init/main.ts`
- Create: `src/cli/commands/init/main-git-policy.test.ts`
- Modify: `src/cli/commands/init/main.test.ts`

- [ ] **Step 1: Write failing init integration tests**

Create `src/cli/commands/init/main-git-policy.test.ts` with this content:

```ts
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CommandRunner } from "../triage/types.ts";
import { runInit } from "./main.ts";

async function tempRepo(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-init-git-policy-"));
  await mkdir(join(repoRoot, ".git", "info"), { recursive: true });
  return repoRoot;
}

function missingPiReadiness() {
  return {
    status: "missing" as const,
    message: "Pi did not report any provider/model with configured auth.",
    models: [],
  };
}

async function failingPiSmokeTest() {
  return {
    status: "fail" as const,
    message: "Pi could not complete the provider smoke test.",
    command:
      "pi --no-session --no-context-files --no-prompt-templates -p Reply with PATCHMILL_PI_OK and nothing else.",
    details: "missing key",
  };
}

function runner(calls: string[][]): CommandRunner {
  return {
    async run(command, args, options) {
      calls.push([command, ...args, `cwd=${options?.cwd ?? ""}`]);
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

async function runInitForGitPolicy(
  repoRoot: string,
  options: {
    args?: string[];
    isInteractive: boolean;
    promptAnswer?: string;
    calls?: string[][];
  },
) {
  const stdout: string[] = [];
  await runInit(
    options.args ?? [],
    repoRoot,
    {
      stdout: (line) => stdout.push(line),
      stderr: () => undefined,
    },
    {
      detectPiReadiness: missingPiReadiness,
      runPiSmokeTest: failingPiSmokeTest,
      isInteractive: options.isInteractive,
      prompt: async () => options.promptAnswer ?? "",
      commandRunner: runner(options.calls ?? []),
      setupLabels: async () => ({
        status: "skipped",
        message: "Label setup skipped.",
      }),
    },
  );
  return stdout.join("\n");
}

test("interactive init add-to-git stages config, skills, and gitignore", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];

  const output = await runInitForGitPolicy(repoRoot, {
    isInteractive: true,
    promptAnswer: "1",
    calls,
  });

  assert.deepEqual(calls, [
    [
      "git",
      "add",
      "patchmill.config.json",
      ".patchmill/skills",
      ".gitignore",
      `cwd=${repoRoot}`,
    ],
  ]);
  assert.equal(
    await readFile(join(repoRoot, ".gitignore"), "utf8"),
    ".patchmill/pi-agent\n.patchmill/runs\n.patchmill/triage-runs\n",
  );
  assert.match(output, /Added Patchmill config and skills to git/u);
  assert.doesNotMatch(output, /local-only by default/u);
});

test("interactive init git-ignore writes config and .patchmill to .gitignore", async () => {
  const repoRoot = await tempRepo();

  const output = await runInitForGitPolicy(repoRoot, {
    isInteractive: true,
    promptAnswer: "2",
  });

  assert.equal(
    await readFile(join(repoRoot, ".gitignore"), "utf8"),
    "patchmill.config.json\n.patchmill/\n",
  );
  assert.match(output, /Added Patchmill files to .gitignore/u);
  assert.doesNotMatch(output, /local-only by default/u);
});

test("interactive init git-exclude writes config and .patchmill to local exclude", async () => {
  const repoRoot = await tempRepo();

  const output = await runInitForGitPolicy(repoRoot, {
    isInteractive: true,
    promptAnswer: "3",
  });

  assert.equal(
    await readFile(join(repoRoot, ".git", "info", "exclude"), "utf8"),
    "patchmill.config.json\n.patchmill/\n",
  );
  assert.match(output, /Added Patchmill files to .git\/info\/exclude/u);
});

test("non-interactive and --yes init choose git-exclude without prompting", async () => {
  const nonInteractiveRoot = await tempRepo();
  const yesRoot = await tempRepo();
  let prompted = false;

  await runInitForGitPolicy(nonInteractiveRoot, {
    isInteractive: false,
    promptAnswer: "1",
  });
  await runInit(
    ["--yes"],
    yesRoot,
    {
      stdout: () => undefined,
      stderr: () => undefined,
    },
    {
      detectPiReadiness: missingPiReadiness,
      runPiSmokeTest: failingPiSmokeTest,
      isInteractive: true,
      prompt: async () => {
        prompted = true;
        return "1";
      },
      commandRunner: runner([]),
      setupLabels: async () => ({
        status: "skipped",
        message: "Label setup skipped.",
      }),
    },
  );

  assert.equal(prompted, false);
  assert.equal(
    await readFile(join(nonInteractiveRoot, ".git", "info", "exclude"), "utf8"),
    "patchmill.config.json\n.patchmill/\n",
  );
  assert.equal(
    await readFile(join(yesRoot, ".git", "info", "exclude"), "utf8"),
    "patchmill.config.json\n.patchmill/\n",
  );
});
```

- [ ] **Step 2: Run the new integration tests to verify they fail on missing
      wiring**

Run:

```bash
node --test src/cli/commands/init/main-git-policy.test.ts
```

Expected: FAIL because `runInit` does not accept `commandRunner`, does not
prompt for git policy, and still writes old exclude entries.

- [ ] **Step 3: Modify `main.ts` imports and options**

In `src/cli/commands/init/main.ts`, replace:

```ts
import { ensurePatchmillLocalExcludeEntries } from "./local-ignore.ts";
```

with:

```ts
import { applyInitGitPolicy, selectInitGitPolicy } from "./git-policy.ts";
import type { CommandRunner } from "../triage/types.ts";
```

Then add this option to the `runInit` options type:

```ts
    commandRunner?: CommandRunner;
```

- [ ] **Step 4: Replace local exclude and consistency warning orchestration**

In `src/cli/commands/init/main.ts`, replace this block:

```ts
const localExclude = await ensurePatchmillLocalExcludeEntries(config.repoRoot);
const localExcludeMessage = localExclude.skipped
  ? `Warning: Patchmill could not update .git/info/exclude (${localExclude.skipped}).\nAdd .patchmill and patchmill.config.json to your local git excludes to keep the worktree clean.`
  : localExclude.added.length > 0
    ? `Added Patchmill local files to .git/info/exclude:\n  ${localExclude.added.join("\n  ")}`
    : "Patchmill local files were already ignored by .git/info/exclude.";
const consistencyWarning =
  "Warning: Patchmill config and skills are local-only by default. For consistent Patchmill runs across local machines and CI, consider committing patchmill.config.json and .patchmill/skills/ explicitly.";
const isInteractive = options.isInteractive ?? defaultStdin.isTTY;
```

with:

```ts
const isInteractive = options.isInteractive ?? defaultStdin.isTTY;
const gitPolicy = await selectInitGitPolicy({
  isInteractive,
  assumeYes: config.yes,
  prompt: options.prompt ?? defaultPrompt,
});
const gitPolicyResult = await applyInitGitPolicy({
  repoRoot: config.repoRoot,
  policy: gitPolicy,
  runner: options.commandRunner ?? createCommandRunner(),
});
```

Then replace the output segment:

```ts
\n\n${localExcludeMessage}\n\n${consistencyWarning}\n\n${skillsMessage}
```

with:

```ts
\n\n${gitPolicyResult.message}\n\n${skillsMessage}
```

- [ ] **Step 5: Run the new integration tests to verify green**

Run:

```bash
node --test src/cli/commands/init/main-git-policy.test.ts
```

Expected: PASS.

- [ ] **Step 6: Update existing main test assertions**

In `src/cli/commands/init/main.test.ts`, update expectations in
`runInit installs project-local skills by default`:

```ts
assert.match(
  stdout.join("\n"),
  /Added Patchmill files to \.git\/info\/exclude/,
);
assert.match(
  await readFile(join(repoRoot, ".git", "info", "exclude"), "utf8"),
  /patchmill\.config\.json\n\.patchmill\/\n/u,
);
assert.doesNotMatch(stdout.join("\n"), /local-only by default/u);
```

Remove the old assertion that matches
`Warning: Patchmill config and skills are local-only by default`.

In
`runInit preserves existing local exclude entries and does not touch gitignore`,
update the expected exclude content to:

```ts
assert.equal(
  await readFile(join(repoRoot, ".git", "info", "exclude"), "utf8"),
  "node_modules\n.patchmill\npatchmill.config.json\n",
);
```

- [ ] **Step 7: Run init tests**

Run:

```bash
node --test src/cli/commands/init/git-policy.test.ts src/cli/commands/init/main-git-policy.test.ts src/cli/commands/init/main.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit init wiring**

Run:

```bash
git add src/cli/commands/init/main.ts src/cli/commands/init/main.test.ts src/cli/commands/init/main-git-policy.test.ts
git commit -m "feat(init): prompt for git policy"
```

## Task 3: Update documentation and run final verification

**Files:**

- Modify: `docs/configuration.md`

- [ ] **Step 1: Update docs text for init git handling**

In `docs/configuration.md`, replace this paragraph under `## Skills`:

```md
The required skill keys are `triage`, `planning`, and `implementation`. For new
repositories, `patchmill init` defaults them to local-only skill paths and adds
`.patchmill` plus `patchmill.config.json` to `.git/info/exclude`:
```

with:

```md
The required skill keys are `triage`, `planning`, and `implementation`. For new
repositories, `patchmill init` defaults them to project-local skill paths. In an
interactive terminal, init asks whether to add generated config and skills to
git, add Patchmill files to `.gitignore`, or add Patchmill files to
`.git/info/exclude`. Non-interactive and `--yes` runs keep the files local by
adding `patchmill.config.json` and `.patchmill/` to `.git/info/exclude`:
```

Then replace this paragraph:

```md
Path-like skill references resolve relative to the config file directory. For
consistent Patchmill runs across local machines and CI, consider committing
`patchmill.config.json` and `.patchmill/skills/` explicitly.
```

with:

```md
Path-like skill references resolve relative to the config file directory. When
choosing **Add to git**, init stages `patchmill.config.json`,
`.patchmill/skills`, and `.gitignore`; `.gitignore` keeps `.patchmill/pi-agent`,
`.patchmill/runs`, and `.patchmill/triage-runs` local because they contain
machine-specific auth, session, and run output.
```

- [ ] **Step 2: Run docs verification**

Run:

```bash
npx markdownlint-cli2 docs/configuration.md docs/specs/2026-06-13-init-git-policy-prompt-design.md docs/plans/2026-06-13-init-git-policy-prompt.md
```

Expected: PASS.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
node --test src/cli/commands/init/git-policy.test.ts src/cli/commands/init/main-git-policy.test.ts src/cli/commands/init/main.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Run TypeScript and formatting checks**

Run:

```bash
npm run lint:ts
npm run format:check
```

Expected: both commands PASS.

- [ ] **Step 6: Commit docs and verification follow-up**

Run:

```bash
git add docs/configuration.md docs/plans/2026-06-13-init-git-policy-prompt.md
git commit -m "docs(init): document git policy prompt"
```

## Self-Review

- Spec coverage: Task 1 covers the three policy effects, duplicate handling, and
  missing git metadata warnings. Task 2 covers interactive prompt wiring plus
  non-interactive and `--yes` defaults. Task 3 covers documentation and final
  verification.
- Placeholder scan: The plan contains no placeholder markers or deferred
  behavior.
- Type consistency: The plan consistently uses `InitGitPolicy`,
  `InitGitPolicyResult`, `selectInitGitPolicy`, `applyInitGitPolicy`, and
  `CommandRunner`.
