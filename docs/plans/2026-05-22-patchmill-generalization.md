# Patchmill Generalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the copied Croprun Forgejo + Pi automation into a configurable Patchmill CLI with an issue-host provider boundary and concrete Pi runtime support.

**Architecture:** Keep the copied workflow green while extracting thin interfaces around host access, configuration, and policy. Pi remains a first-class runtime dependency: the plan preserves concrete Pi runner and prompt contracts instead of hiding Pi behind a generic coding-agent provider. Each task introduces one seam, wraps the current behavior as the default, and updates tests before moving the next responsibility.

**Tech Stack:** Node 24 native TypeScript, Node test runner, Forgejo `tea` CLI adapter, Pi CLI adapter, JSON config.

---

## File structure map

- `bin/patchmill.ts`: top-level Patchmill command dispatcher.
- `src/config/types.ts`: typed normalized Patchmill configuration.
- `src/config/defaults.ts`: built-in defaults matching the copied Croprun behavior.
- `src/config/load.ts`: config-file, environment, and CLI override loading.
- `src/host/types.ts`: issue-host provider contract.
- `src/host/forgejo-tea.ts`: Forgejo provider wrapping copied `tea` command functions.
- `src/pi/types.ts`: concrete Pi prompt input and output contract types.
- `src/pi/runner.ts`: Pi runner wrapping copied prompt execution without a generic agent-provider layer.
- `src/policy/types.ts`: labels, selection, landing, validation, and prompt policy types.
- `src/workflows/triage.ts`: host-provider + Pi-runner triage orchestration.
- `src/workflows/run-once.ts`: host-provider + Pi-runner single-issue orchestration.
- `scripts/agent-issue-*`: compatibility entrypoints retained until the new workflows fully replace them.
- `docs/specs/2026-05-22-patchmill-generalization-design.md`: design source for this plan.

## Task 1: Lock the bootstrap CLI and tests

**Files:**
- Modify: `bin/patchmill.ts`
- Create: `bin/patchmill.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add a command resolver export**

Replace `bin/patchmill.ts` with this structure so tests can validate command routing without spawning child processes:

```ts
#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HELP_TEXT = `Usage:
  patchmill <command> [options]

Commands:
  triage      Classify repository issues for agent readiness.
  run-once    Claim and process one agent-ready issue.
`;

export type ResolvedCommand = {
  script: string;
  args: string[];
};

export function resolveCommand(root: string, argv: string[]): ResolvedCommand | "help" {
  const command = argv[0];
  if (!command || command === "--help" || command === "-h" || command === "help") return "help";

  const scripts: Record<string, string> = {
    triage: join(root, "scripts", "agent-issue-triage.ts"),
    "run-once": join(root, "scripts", "agent-issue-once.ts"),
  };

  const script = scripts[command];
  if (!script) throw new Error(`Unknown command: ${command}`);
  return { script, args: argv.slice(1) };
}

export function main(argv = process.argv.slice(2)): number {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  let resolved: ResolvedCommand | "help";
  try {
    resolved = resolveCommand(root, argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(HELP_TEXT);
    return 1;
  }

  if (resolved === "help") {
    console.log(HELP_TEXT);
    return 0;
  }

  const result = spawnSync(process.execPath, [resolved.script, ...resolved.args], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  if (result.signal) {
    console.error(`patchmill terminated by ${result.signal}`);
    return 1;
  }
  return result.status ?? 1;
}

const isMain = process.argv[1]
  ? import.meta.url === new URL(process.argv[1], "file:").href
  : false;

if (isMain) process.exit(main());
```

- [ ] **Step 2: Add CLI resolver tests**

Create `bin/patchmill.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCommand } from "./patchmill.ts";

test("resolveCommand returns help with no command", () => {
  assert.equal(resolveCommand("/repo", []), "help");
});

test("resolveCommand maps triage to copied triage script", () => {
  assert.deepEqual(resolveCommand("/repo", ["triage", "--dry-run"]), {
    script: "/repo/scripts/agent-issue-triage.ts",
    args: ["--dry-run"],
  });
});

test("resolveCommand maps run-once to copied runner script", () => {
  assert.deepEqual(resolveCommand("/repo", ["run-once", "--issue", "7"]), {
    script: "/repo/scripts/agent-issue-once.ts",
    args: ["--issue", "7"],
  });
});

test("resolveCommand rejects unknown commands", () => {
  assert.throws(() => resolveCommand("/repo", ["queue"]), /Unknown command: queue/);
});
```

- [ ] **Step 3: Include bin tests in `npm test`**

Update `package.json` scripts:

```json
{
  "scripts": {
    "patchmill": "node bin/patchmill.ts",
    "triage": "node scripts/agent-issue-triage.ts",
    "run-once": "node scripts/agent-issue-once.ts",
    "test": "node --test bin/*.test.ts scripts/agent-issue-triage/*.test.ts scripts/agent-issue/*.test.ts",
    "test:cli": "node --test bin/*.test.ts",
    "test:triage": "node --test scripts/agent-issue-triage/*.test.ts",
    "test:run-once": "node --test scripts/agent-issue/*.test.ts"
  }
}
```

- [ ] **Step 4: Verify tests pass**

Run:

```sh
npm test
```

Expected: all copied tests and new CLI tests pass.

- [ ] **Step 5: Commit**

```sh
git add bin/patchmill.ts bin/patchmill.test.ts package.json
git commit -m "feat(cli): add patchmill command dispatcher tests"
```

## Task 2: Add typed configuration defaults

**Files:**
- Create: `src/config/types.ts`
- Create: `src/config/defaults.ts`
- Create: `src/config/defaults.test.ts`

- [ ] **Step 1: Write configuration type definitions**

Create `src/config/types.ts`:

```ts
export type PatchmillHostConfig = {
  provider: "forgejo-tea";
  login: string;
};

export type PatchmillPiConfig = {
  team?: string;
  triageThinking: string;
};

export type PatchmillLabelsConfig = {
  ready: string;
  needsInfo: string;
  unsuitable: string;
  inProgress: string;
  done: string;
  blocked: string;
  priorities: string[];
};

export type PatchmillPathsConfig = {
  plansDir: string;
  runStateDir: string;
  triageLogDir: string;
  worktreeDir: string;
};

export type PatchmillGitConfig = {
  baseBranch: string;
  branchPrefix: string;
  worktreePrefix: string;
  allowDirectLand: boolean;
};

export type PatchmillProjectPolicyConfig = {
  validationCommands: string[];
  landingPolicy: "project-default";
  planRequiresApproval: boolean;
};

export type PatchmillConfig = {
  host: PatchmillHostConfig;
  pi: PatchmillPiConfig;
  labels: PatchmillLabelsConfig;
  paths: PatchmillPathsConfig;
  git: PatchmillGitConfig;
  projectPolicy: PatchmillProjectPolicyConfig;
};
```

- [ ] **Step 2: Add defaults matching current behavior**

Create `src/config/defaults.ts`:

```ts
import type { PatchmillConfig } from "./types.ts";

export const DEFAULT_PATCHMILL_CONFIG: PatchmillConfig = {
  host: {
    provider: "forgejo-tea",
    login: "triage-agent",
  },
  pi: {
    triageThinking: "high",
  },
  labels: {
    ready: "agent-ready",
    needsInfo: "needs-info",
    unsuitable: "agent-unsuitable",
    inProgress: "in-progress",
    done: "agent-done",
    blocked: "blocked",
    priorities: ["priority:critical", "priority:high", "priority:medium", "priority:low"],
  },
  paths: {
    plansDir: "docs/plans",
    runStateDir: ".patchmill/runs",
    triageLogDir: ".patchmill/triage-runs",
    worktreeDir: ".worktrees",
  },
  git: {
    baseBranch: "main",
    branchPrefix: "agent/issue-",
    worktreePrefix: "patchmill-issue-",
    allowDirectLand: true,
  },
  projectPolicy: {
    validationCommands: [],
    landingPolicy: "project-default",
    planRequiresApproval: false,
  },
};
```

- [ ] **Step 3: Add defaults test**

Create `src/config/defaults.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "./defaults.ts";

test("defaults preserve the initial Forgejo host and Pi runtime choices", () => {
  assert.equal(DEFAULT_PATCHMILL_CONFIG.host.provider, "forgejo-tea");
  assert.equal(DEFAULT_PATCHMILL_CONFIG.pi.triageThinking, "high");
});

test("defaults keep agent-ready label vocabulary", () => {
  assert.equal(DEFAULT_PATCHMILL_CONFIG.labels.ready, "agent-ready");
  assert.equal(DEFAULT_PATCHMILL_CONFIG.labels.needsInfo, "needs-info");
  assert.equal(DEFAULT_PATCHMILL_CONFIG.labels.unsuitable, "agent-unsuitable");
});
```

- [ ] **Step 4: Run config tests**

Run:

```sh
node --test src/config/*.test.ts
```

Expected: both tests pass.

- [ ] **Step 5: Commit**

```sh
git add src/config/types.ts src/config/defaults.ts src/config/defaults.test.ts
git commit -m "feat(config): add patchmill defaults"
```

## Task 3: Load config from file, env, and CLI overrides

**Files:**
- Create: `src/config/load.ts`
- Create: `src/config/load.test.ts`
- Modify: `bin/patchmill.ts`

- [ ] **Step 1: Write failing config load tests**

Create `src/config/load.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadPatchmillConfig } from "./load.ts";

test("loadPatchmillConfig returns defaults when no file or env is present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  const config = await loadPatchmillConfig(dir, {}, []);
  assert.equal(config.host.login, "triage-agent");
  assert.equal(config.paths.runStateDir, join(dir, ".patchmill/runs"));
});

test("loadPatchmillConfig applies patchmill.config.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(join(dir, "patchmill.config.json"), JSON.stringify({
    host: { login: "bot-login" },
    pi: { team: "fast-team" },
    paths: { plansDir: "engineering/plans" }
  }));
  const config = await loadPatchmillConfig(dir, {}, []);
  assert.equal(config.host.login, "bot-login");
  assert.equal(config.pi.team, "fast-team");
  assert.equal(config.paths.plansDir, join(dir, "engineering/plans"));
});

test("loadPatchmillConfig applies env and CLI overrides last", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  const config = await loadPatchmillConfig(
    dir,
    { PATCHMILL_HOST_LOGIN: "env-login", PATCHMILL_AGENT_TEAM: "env-team" },
    ["--host-login", "cli-login", "--agent-team", "cli-team"]
  );
  assert.equal(config.host.login, "cli-login");
  assert.equal(config.pi.team, "cli-team");
});
```

- [ ] **Step 2: Implement config loading**

Create `src/config/load.ts`:

```ts
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { DEFAULT_PATCHMILL_CONFIG } from "./defaults.ts";
import type { PatchmillConfig } from "./types.ts";

type Env = Record<string, string | undefined>;
type PartialConfig = Partial<{
  host: Partial<PatchmillConfig["host"]>;
  pi: Partial<PatchmillConfig["pi"]>;
  paths: Partial<PatchmillConfig["paths"]>;
  labels: Partial<PatchmillConfig["labels"]>;
  git: Partial<PatchmillConfig["git"]>;
  projectPolicy: Partial<PatchmillConfig["projectPolicy"]>;
}>;

function mergeConfig(base: PatchmillConfig, update: PartialConfig): PatchmillConfig {
  return {
    host: { ...base.host, ...update.host },
    pi: { ...base.pi, ...update.pi },
    labels: { ...base.labels, ...update.labels },
    paths: { ...base.paths, ...update.paths },
    git: { ...base.git, ...update.git },
    projectPolicy: { ...base.projectPolicy, ...update.projectPolicy },
  };
}

function absolutize(root: string, value: string): string {
  return isAbsolute(value) ? value : join(root, value);
}

function absolutizePaths(root: string, config: PatchmillConfig): PatchmillConfig {
  return {
    ...config,
    paths: {
      plansDir: absolutize(root, config.paths.plansDir),
      runStateDir: absolutize(root, config.paths.runStateDir),
      triageLogDir: absolutize(root, config.paths.triageLogDir),
      worktreeDir: absolutize(root, config.paths.worktreeDir),
    },
  };
}

async function readConfigFile(repoRoot: string): Promise<PartialConfig> {
  try {
    return JSON.parse(await readFile(join(repoRoot, "patchmill.config.json"), "utf8")) as PartialConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function envConfig(env: Env): PartialConfig {
  return {
    host: env.PATCHMILL_HOST_LOGIN ? { login: env.PATCHMILL_HOST_LOGIN } : {},
    pi: env.PATCHMILL_AGENT_TEAM ? { team: env.PATCHMILL_AGENT_TEAM } : {},
  };
}

function cliConfig(args: string[]): PartialConfig {
  const config: PartialConfig = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--host-login") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--host-login requires a value");
      config.host = { ...(config.host ?? {}), login: value };
      index += 1;
    } else if (args[index] === "--agent-team") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--agent-team requires a value");
      config.pi = { ...(config.pi ?? {}), team: value };
      index += 1;
    }
  }
  return config;
}

export async function loadPatchmillConfig(repoRoot: string, env: Env = process.env, args: string[] = []): Promise<PatchmillConfig> {
  const fromFile = await readConfigFile(repoRoot);
  const merged = mergeConfig(mergeConfig(mergeConfig(DEFAULT_PATCHMILL_CONFIG, fromFile), envConfig(env)), cliConfig(args));
  return absolutizePaths(repoRoot, merged);
}
```

- [ ] **Step 3: Run config load tests**

Run:

```sh
node --test src/config/*.test.ts
```

Expected: all config tests pass.

- [ ] **Step 4: Commit**

```sh
git add src/config/load.ts src/config/load.test.ts
git commit -m "feat(config): load patchmill project config"
```

## Task 4: Extract host provider contract and Forgejo adapter

**Files:**
- Create: `src/host/types.ts`
- Create: `src/host/forgejo-tea.ts`
- Create: `src/host/forgejo-tea.test.ts`

- [ ] **Step 1: Define the host contract**

Create `src/host/types.ts`:

```ts
export type IssueSummary = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
  author?: string;
  updated?: string;
  comments?: unknown[];
};

export type LabelDefinition = {
  name: string;
  color: string;
  description: string;
};

export type LabelChangePlan = {
  issueNumber: number;
  oldLabels: string[];
  newLabels: string[];
  addLabels: string[];
  removeLabels: string[];
};

export type IssueHostProvider = {
  listOpenIssues(): Promise<IssueSummary[]>;
  hydrateIssueComments(issues: IssueSummary[]): Promise<IssueSummary[]>;
  listLabels(): Promise<string[]>;
  createLabel(label: LabelDefinition): Promise<void>;
  applyLabels(change: LabelChangePlan): Promise<void>;
  commentIssue(issueNumber: number, body: string): Promise<void>;
};
```

- [ ] **Step 2: Wrap copied Forgejo functions**

Create `src/host/forgejo-tea.ts`:

```ts
import {
  applyIssueLabels,
  commentIssue,
  createLabel,
  hydrateIssueComments,
  listLabels,
  listOpenIssues,
} from "../../scripts/agent-issue-triage/forgejo.ts";
import type { CommandRunner } from "../../scripts/agent-issue-triage/types.ts";
import type { IssueHostProvider, IssueSummary, LabelChangePlan, LabelDefinition } from "./types.ts";

export type ForgejoTeaHostOptions = {
  runner: CommandRunner;
  repoRoot: string;
  login?: string;
};

export class ForgejoTeaHostProvider implements IssueHostProvider {
  constructor(private readonly options: ForgejoTeaHostOptions) {}

  listOpenIssues(): Promise<IssueSummary[]> {
    return listOpenIssues(this.options.runner, this.options.repoRoot, this.options.login);
  }

  async hydrateIssueComments(issues: IssueSummary[]): Promise<IssueSummary[]> {
    await hydrateIssueComments(this.options.runner, this.options.repoRoot, issues, this.options.login);
    return issues;
  }

  listLabels(): Promise<string[]> {
    return listLabels(this.options.runner, this.options.repoRoot, this.options.login);
  }

  createLabel(label: LabelDefinition): Promise<void> {
    return createLabel(this.options.runner, this.options.repoRoot, label, this.options.login);
  }

  applyLabels(change: LabelChangePlan): Promise<void> {
    return applyIssueLabels(this.options.runner, this.options.repoRoot, change, this.options.login);
  }

  commentIssue(issueNumber: number, body: string): Promise<void> {
    return commentIssue(this.options.runner, this.options.repoRoot, issueNumber, body, this.options.login);
  }
}
```

- [ ] **Step 3: Add adapter smoke test**

Create `src/host/forgejo-tea.test.ts` with a fake `CommandRunner` that verifies `listLabels` uses `tea labels list` through the adapter:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { ForgejoTeaHostProvider } from "./forgejo-tea.ts";
import type { CommandRunner } from "../../scripts/agent-issue-triage/types.ts";

test("ForgejoTeaHostProvider delegates label listing to tea", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner: CommandRunner = {
    async run(command, args) {
      calls.push({ command, args });
      return { code: 0, stdout: JSON.stringify([{ name: "agent-ready" }]), stderr: "" };
    },
  };
  const provider = new ForgejoTeaHostProvider({ runner, repoRoot: "/repo", login: "bot" });
  assert.deepEqual(await provider.listLabels(), ["agent-ready"]);
  assert.equal(calls[0]?.command, "tea");
  assert.ok(calls[0]?.args.includes("labels"));
  assert.ok(calls[0]?.args.includes("--login"));
});
```

- [ ] **Step 4: Run host tests**

Run:

```sh
node --test src/host/*.test.ts
```

Expected: host adapter tests pass.

- [ ] **Step 5: Commit**

```sh
git add src/host/types.ts src/host/forgejo-tea.ts src/host/forgejo-tea.test.ts
git commit -m "feat(host): add forgejo tea provider"
```

## Task 5: Preserve concrete Pi runner and prompt contracts

**Files:**
- Create: `src/pi/types.ts`
- Create: `src/pi/runner.ts`
- Create: `src/pi/runner.test.ts`

- [ ] **Step 1: Define concrete Pi prompt contract types**

Create `src/pi/types.ts`:

```ts
import type { RawTriageDocument } from "../../scripts/agent-issue-triage/types.ts";
import type { AgentIssuePiResult, IssueSummary } from "../../scripts/agent-issue/types.ts";
import type { ResolvedAgentTeam } from "../../scripts/agent-issue/agent-team.ts";

export type TriagePiInput = {
  repoRoot: string;
  issues: IssueSummary[];
};

export type PlanPiInput = {
  repoRoot: string;
  issue: IssueSummary;
  planPath: string;
};

export type ImplementationPiInput = {
  repoRoot: string;
  issue: IssueSummary;
  planPath: string;
  branch: string;
  worktreePath: string;
  agentTeam: ResolvedAgentTeam;
};

export type PiPromptContracts = {
  triage(input: TriagePiInput): Promise<RawTriageDocument>;
  plan(input: PlanPiInput): Promise<AgentIssuePiResult>;
  implementation(input: ImplementationPiInput): Promise<AgentIssuePiResult>;
};
```

- [ ] **Step 2: Wrap Pi functions without a generic provider interface**

Create `src/pi/runner.ts`:

```ts
import { runTriageAgent } from "../../scripts/agent-issue-triage/agent.ts";
import type { CommandRunner } from "../../scripts/agent-issue-triage/types.ts";
import { runPiPrompt } from "../../scripts/agent-issue/pi.ts";
import { buildImplementationPrompt, buildPlanCreationPrompt } from "../../scripts/agent-issue/prompts.ts";
import type { ImplementationPiInput, PiPromptContracts, PlanPiInput, TriagePiInput } from "./types.ts";

export class PiRunner implements PiPromptContracts {
  constructor(private readonly runner: CommandRunner) {}

  triage(input: TriagePiInput) {
    return runTriageAgent(this.runner, input.repoRoot, input.issues);
  }

  plan(input: PlanPiInput) {
    return runPiPrompt(this.runner, input.repoRoot, buildPlanCreationPrompt(input.issue, input.planPath), {
      stage: "pi-plan",
      issueNumber: input.issue.number,
      repoRoot: input.repoRoot,
    });
  }

  implementation(input: ImplementationPiInput) {
    return runPiPrompt(
      this.runner,
      input.repoRoot,
      buildImplementationPrompt({
        issue: input.issue,
        planPath: input.planPath,
        branch: input.branch,
        worktreePath: input.worktreePath,
        agentTeam: input.agentTeam,
      }),
      {
        stage: "pi-implementation",
        issueNumber: input.issue.number,
        repoRoot: input.repoRoot,
      },
    );
  }
}
```

- [ ] **Step 3: Add Pi runner parse test**

Create `src/pi/runner.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePiResult } from "../../scripts/agent-issue/pi.ts";

test("Pi result parser accepts merged status", () => {
  assert.deepEqual(parsePiResult(JSON.stringify({
    status: "merged",
    branch: "agent/issue-1-fix",
    mergeCommit: "abc123",
    commits: ["def456"],
    validation: ["npm test passed"],
    reviewSummary: "review passed",
    landingDecision: "direct squash-landed: simple localized bug fix"
  })), {
    status: "merged",
    branch: "agent/issue-1-fix",
    mergeCommit: "abc123",
    commits: ["def456"],
    validation: ["npm test passed"],
    reviewSummary: "review passed",
    landingDecision: "direct squash-landed: simple localized bug fix"
  });
});
```

- [ ] **Step 4: Run Pi tests**

Run:

```sh
node --test src/pi/*.test.ts
```

Expected: Pi runner tests pass.

- [ ] **Step 5: Commit**

```sh
git add src/pi/types.ts src/pi/runner.ts src/pi/runner.test.ts
git commit -m "feat(pi): add concrete pi runner"
```

## Task 6: Replace Croprun env names with Patchmill config while preserving compatibility

**Files:**
- Modify: `scripts/agent-issue-triage/args.ts`
- Modify: `scripts/agent-issue/args.ts`
- Modify: `scripts/agent-issue-triage/args.test.ts`
- Modify: `scripts/agent-issue/args.test.ts`

- [ ] **Step 1: Add tests for Patchmill env vars**

In `scripts/agent-issue-triage/args.test.ts`, add:

```ts
test("parseArgs prefers PATCHMILL_HOST_LOGIN over Croprun triage login", () => {
  const config = parseArgs(["--dry-run"], "/repo", {
    PATCHMILL_HOST_LOGIN: "patchmill-bot",
    CROPRUN_TRIAGE_TEA_LOGIN: "croprun-bot",
  });
  assert.equal(config.teaLogin, "patchmill-bot");
});
```

In `scripts/agent-issue/args.test.ts`, add:

```ts
test("parseArgs prefers PATCHMILL_AGENT_TEAM over Croprun agent team", () => {
  const config = parseArgs(["--dry-run"], "/repo", {
    PATCHMILL_AGENT_TEAM: "patchmill-team",
    CROPRUN_AGENT_ISSUE_AGENT_TEAM: "croprun-team",
  });
  assert.equal(config.agentTeamName, "patchmill-team");
});
```

- [ ] **Step 2: Update triage env fallback order**

In `scripts/agent-issue-triage/args.ts`, set the default login to:

```ts
teaLogin: env.PATCHMILL_HOST_LOGIN ?? env.CROPRUN_TRIAGE_TEA_LOGIN ?? "triage-agent",
```

- [ ] **Step 3: Update run-once env fallback order**

In `scripts/agent-issue/args.ts`, update helper functions:

```ts
function defaultTeaLogin(env: Env): string {
  return (
    env.PATCHMILL_HOST_LOGIN ??
    env.CROPRUN_AGENT_ISSUE_TEA_LOGIN ??
    env.CROPRUN_TRIAGE_TEA_LOGIN ??
    "triage-agent"
  );
}

function defaultAgentTeam(env: Env): string | undefined {
  return env.PATCHMILL_AGENT_TEAM ?? env.CROPRUN_AGENT_ISSUE_AGENT_TEAM;
}
```

- [ ] **Step 4: Run args tests**

Run:

```sh
node --test scripts/agent-issue-triage/args.test.ts scripts/agent-issue/args.test.ts
```

Expected: all args tests pass.

- [ ] **Step 5: Commit**

```sh
git add scripts/agent-issue-triage/args.ts scripts/agent-issue/args.ts scripts/agent-issue-triage/args.test.ts scripts/agent-issue/args.test.ts
git commit -m "feat(config): prefer patchmill environment variables"
```

## Task 7: Move labels and paths to policy/config seams

**Files:**
- Create: `src/policy/labels.ts`
- Create: `src/policy/labels.test.ts`
- Modify: `scripts/agent-issue-triage/labels.ts`
- Modify: `scripts/agent-issue/selection.ts`
- Modify: related tests under `scripts/agent-issue-triage` and `scripts/agent-issue`

- [ ] **Step 1: Create configurable label policy**

Create `src/policy/labels.ts`:

```ts
import type { PatchmillLabelsConfig } from "../config/types.ts";
import type { LabelDefinition } from "../host/types.ts";

export function requiredLabels(config: PatchmillLabelsConfig): LabelDefinition[] {
  return [
    { name: config.ready, color: "#2ea043", description: "Ready for automated agent processing" },
    { name: config.needsInfo, color: "#8957e5", description: "Needs reporter information or human decision before planning" },
    { name: config.unsuitable, color: "#8b949e", description: "Not suitable for automated implementation" },
    { name: config.inProgress, color: "#fbca04", description: "Issue is currently being processed by automation" },
    { name: config.done, color: "#0e8a16", description: "Issue was completed by automation" },
    { name: config.blocked, color: "#d876e3", description: "Blocked by another issue or dependency" },
    { name: "bug", color: "#d73a4a", description: "Something is broken" },
    { name: "enhancement", color: "#a2eeef", description: "Feature request or improvement" },
    { name: "docs", color: "#0075ca", description: "Documentation work" },
    { name: "chore", color: "#cfd3d7", description: "Maintenance work" },
    { name: "test", color: "#bfdadc", description: "Test-only or test-focused work" },
    { name: "priority:low", color: "#8b949e", description: "Low priority" },
    { name: "priority:medium", color: "#d29922", description: "Medium priority" },
    { name: "priority:high", color: "#db6d28", description: "High priority" },
    { name: "priority:critical", color: "#cf222e", description: "Critical priority" },
  ];
}

export function automationProtectionLabels(config: PatchmillLabelsConfig): Set<string> {
  return new Set([config.ready, config.needsInfo, config.unsuitable, config.inProgress, config.done, config.blocked]);
}
```

- [ ] **Step 2: Add label policy tests**

Create `src/policy/labels.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "../config/defaults.ts";
import { automationProtectionLabels, requiredLabels } from "./labels.ts";

test("requiredLabels derives automation labels from config", () => {
  const labels = requiredLabels({ ...DEFAULT_PATCHMILL_CONFIG.labels, ready: "ready-for-bots" });
  assert.ok(labels.some((label) => label.name === "ready-for-bots"));
});

test("automationProtectionLabels includes configured done label", () => {
  const labels = automationProtectionLabels({ ...DEFAULT_PATCHMILL_CONFIG.labels, done: "factory-done" });
  assert.ok(labels.has("factory-done"));
});
```

- [ ] **Step 3: Refactor copied label constants incrementally**

Modify `scripts/agent-issue-triage/labels.ts` only after tests are in place. Keep exported constants for compatibility, but derive them from `DEFAULT_PATCHMILL_CONFIG.labels` and `requiredLabels(DEFAULT_PATCHMILL_CONFIG.labels)`.

- [ ] **Step 4: Run label and selection tests**

Run:

```sh
node --test src/policy/*.test.ts scripts/agent-issue-triage/labels.test.ts scripts/agent-issue/selection.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```sh
git add src/policy/labels.ts src/policy/labels.test.ts scripts/agent-issue-triage/labels.ts scripts/agent-issue-triage/labels.test.ts scripts/agent-issue/selection.ts scripts/agent-issue/selection.test.ts
git commit -m "refactor(policy): derive labels from config"
```

## Task 8: Document the first supported host/runtime combination

**Files:**
- Modify: `README.md`
- Create: `docs/providers.md`

- [ ] **Step 1: Add provider docs**

Create `docs/providers.md`:

```md
# Patchmill Providers

Patchmill separates orchestration from issue-host integrations. Pi is the built-in runtime for planning, implementation, skills, todos, subagents, and TUI-driven review.

## Supported now

| Area | Name | Backing tool | Status |
| --- | --- | --- | --- |
| Issue host | `forgejo-tea` | `tea` CLI | supported seed provider |
| Runtime | Pi | `pi` CLI/TUI | built-in runtime |

## Planned later

| Area | Provider | Backing tool |
| --- | --- | --- |
| Issue host | `github-gh` | `gh` CLI |
| Issue host | `gitlab-glab` | `glab` CLI or GitLab REST |

Host provider implementations and Pi prompt contracts must preserve Patchmill's safety rules: strict structured output, untrusted issue-content boundaries, checkpointed host mutations, and clean worktree checks.
```

- [ ] **Step 2: Link provider docs from README**

Add this section to `README.md`:

```md
## Providers

The first supported host/runtime combination is Forgejo via `tea` and Pi via `pi`. See `docs/providers.md` for the host-provider boundary and Pi runtime contract.
```

- [ ] **Step 3: Verify docs contain no stale Croprun-only claim**

Run:

```sh
grep -R "Croprun" README.md docs
```

Expected: Croprun appears only where the bootstrap origin is intentionally described.

- [ ] **Step 4: Commit**

```sh
git add README.md docs/providers.md
git commit -m "docs: describe patchmill host and pi runtime"
```

## Task 9: Wire normalized config into the compatibility workflows

**Files:**
- Modify: `bin/patchmill.ts`
- Modify: `scripts/agent-issue-triage/args.ts`
- Modify: `scripts/agent-issue/args.ts`
- Modify: `scripts/agent-issue-triage.ts`
- Modify: `scripts/agent-issue-once.ts`
- Modify: related args and CLI tests

- [ ] **Step 1: Add tests that `patchmill.config.json` affects copied commands**

Add CLI/config tests that create a temporary repo with `patchmill.config.json` and assert:

```json
{
  "host": { "login": "config-bot" },
  "pi": { "team": "config-team" },
  "paths": {
    "plansDir": "pm-plans",
    "runStateDir": ".patchmill/runs",
    "triageLogDir": ".patchmill/triage-runs",
    "worktreeDir": ".patchmill/worktrees"
  }
}
```

Expected behavior:
- triage uses `config-bot` unless `--tea-login` or `--host-login` overrides it.
- run-once uses `config-bot` and `config-team` unless CLI overrides them.
- default state/log paths come from normalized config, not `.pi/agent-issue`.

- [ ] **Step 2: Add Patchmill-aware parse options**

Extend copied `parseArgs` functions to accept an optional normalized `PatchmillConfig` argument. Keep current direct script behavior working when no config is passed.

- [ ] **Step 3: Load config in compatibility entrypoints**

In `scripts/agent-issue-triage.ts` and `scripts/agent-issue-once.ts`, load `patchmill.config.json` before parsing command-specific args and pass the normalized config into `parseArgs`.

- [ ] **Step 4: Normalize CLI naming without breaking compatibility**

Support both old and new flags:

```sh
--tea-login <name>   # compatibility alias
--host-login <name>  # Patchmill primary flag
--agent-team <name>
```

- [ ] **Step 5: Run tests and commit**

```sh
npm test
git add bin/patchmill.ts scripts/agent-issue-triage.ts scripts/agent-issue-once.ts scripts/agent-issue-triage/args.ts scripts/agent-issue/args.ts src/config/load.ts '*test.ts'
git commit -m "feat(config): wire patchmill config into workflows"
```

## Task 10: Move paths and run-state locations out of `.pi/agent-issue`

**Files:**
- Modify: `src/config/types.ts`
- Modify: `src/config/defaults.ts`
- Modify: `scripts/agent-issue/args.ts`
- Modify: `scripts/agent-issue-triage/args.ts`
- Modify: `scripts/agent-issue/git.ts`
- Modify: `scripts/agent-issue/progress.ts`
- Modify: `scripts/agent-issue/run-state.ts`
- Modify: related tests

- [ ] **Step 1: Add regression tests for configured paths**

Write tests proving these values are honored:

- `paths.plansDir`
- `paths.runStateDir`
- `paths.triageLogDir`
- `paths.worktreeDir`
- `paths.cleanStatusIgnorePrefixes`

- [ ] **Step 2: Extend path config**

Add this field to `PatchmillPathsConfig`:

```ts
cleanStatusIgnorePrefixes: string[];
```

Default:

```ts
cleanStatusIgnorePrefixes: [".patchmill/runs/", ".patchmill/triage-runs/", ".pi/agent-issue/runs/"],
```

- [ ] **Step 3: Replace hard-coded path defaults**

Remove direct defaults to `.pi/agent-issue/runs` and `.pi/agent-issue/triage-runs` from the compatibility arg parsers when normalized config is available. Keep the old paths only as direct-script compatibility defaults.

- [ ] **Step 4: Make clean-worktree ignored paths configurable**

Change `assertCleanWorktree` so ignored status prefixes come from config instead of only `.pi/agent-issue/runs/`.

- [ ] **Step 5: Run tests and commit**

```sh
npm test
git add src/config scripts/agent-issue scripts/agent-issue-triage
git commit -m "feat(paths): use patchmill state and log paths"
```

## Task 11: Extract configurable git worktree strategy

**Files:**
- Create: `src/git/types.ts`
- Create: `src/git/worktree-strategy.ts`
- Create: `src/git/worktree-strategy.test.ts`
- Modify: `scripts/agent-issue/git.ts`
- Modify: `scripts/agent-issue/pipeline.ts`
- Modify: related git and pipeline tests

- [ ] **Step 1: Define `GitWorktreeStrategyConfig`**

Create config-driven strategy types covering:

```ts
export type GitWorktreeStrategyConfig = {
  baseBranch: string;
  baseRef: string;
  remote: string;
  branchPrefix: string;
  worktreeDir: string;
  worktreePrefix: string;
  slugLength: number;
  allowDirectLand: boolean;
};
```

- [ ] **Step 2: Move branch/worktree name construction**

Move `buildIssueBranchName`, `buildIssueWorktreePath`, and slug truncation into `src/git/worktree-strategy.ts` with tests for defaults and custom prefixes.

- [ ] **Step 3: Thread strategy config through run-once**

Update `expectedIssueWorkspace`, `ensureIssueWorktree`, and saved branch/worktree safety checks to use the configured strategy.

- [ ] **Step 4: Make base ref and remote configurable**

Use configured `baseRef` for `git worktree add` and configured `remote` for pushes/direct-land prompt instructions.

- [ ] **Step 5: Run tests and commit**

```sh
node --test src/git/*.test.ts scripts/agent-issue/git.test.ts scripts/agent-issue/pipeline.test.ts
git add src/git scripts/agent-issue/git.ts scripts/agent-issue/pipeline.ts src/config
git commit -m "feat(git): add configurable worktree strategy"
```

## Task 12: Replace hard-coded Tilt cleanup with cleanup hooks

**Files:**
- Create: `src/cleanup/types.ts`
- Create: `src/cleanup/hooks.ts`
- Create: `src/cleanup/hooks.test.ts`
- Modify: `scripts/agent-issue/tilt-cleanup.ts`
- Modify: `scripts/agent-issue/pipeline.ts`
- Modify: related cleanup and pipeline tests

- [ ] **Step 1: Add cleanup hook config**

Add cleanup config with safe defaults:

```ts
export type CleanupHookConfig = {
  name: string;
  whenPathExists?: string;
  terminateProcessPatterns?: string[];
  command?: string;
  args?: string[];
};
```

Default `cleanupHooks` should be empty for generic Patchmill. Add a compatibility Croprun/Tilt preset only when the copied direct scripts are run without `patchmill.config.json`.

- [ ] **Step 2: Preserve Tilt behavior as a named hook**

Move the current `.env` probe, process group termination, and `just tilt-down` invocation behind a hook named `tilt-just`.

- [ ] **Step 3: Update pipeline cleanup call**

Replace `cleanupIssueTilt(...)` with `runCleanupHooks(...)`. Progress events should report skipped/cleaned/failed per hook.

- [ ] **Step 4: Test generic no-op cleanup**

Add tests proving no cleanup command runs when `cleanupHooks: []`.

- [ ] **Step 5: Test Tilt compatibility**

Retain existing Tilt cleanup tests against the `tilt-just` preset.

- [ ] **Step 6: Run tests and commit**

```sh
node --test src/cleanup/*.test.ts scripts/agent-issue/tilt-cleanup.test.ts scripts/agent-issue/pipeline.test.ts
git add src/cleanup scripts/agent-issue/tilt-cleanup.ts scripts/agent-issue/pipeline.ts src/config
git commit -m "feat(cleanup): replace tilt cleanup with hooks"
```

## Task 13: Extract project policy for validation, toolchain, landing, and prompts

**Files:**
- Create: `src/policy/types.ts`
- Create: `src/policy/defaults.ts`
- Create: `src/policy/defaults.test.ts`
- Modify: `src/config/types.ts`
- Modify: `src/config/defaults.ts`

- [ ] **Step 1: Define policy types**

Create policy types for:

- project name used in prompts
- context file names, defaulting to `["AGENTS.md"]`
- toolchain instruction, defaulting to a neutral string such as “Use the repository's documented development toolchain.”
- validation rules as named categories and commands
- forbidden validation substitutions
- direct-land policy text and target branch
- visual evidence policy
- host tooling instruction
- Pi todo and subagent workflow instruction snippets

- [ ] **Step 2: Add Croprun compatibility policy**

Create a `CROPRUN_COMPAT_POLICY` that preserves current prompt wording and commands for compatibility tests.

- [ ] **Step 3: Add generic default policy**

Create `DEFAULT_PATCHMILL_POLICY` with no Croprun name, no Tilt assumptions, and neutral validation guidance.

- [ ] **Step 4: Wire policy into config defaults**

Make `DEFAULT_PATCHMILL_CONFIG.projectPolicy` reference the generic policy shape. Keep direct copied scripts on the Croprun compatibility policy until full migration is complete.

- [ ] **Step 5: Run tests and commit**

```sh
node --test src/policy/*.test.ts src/config/*.test.ts
git add src/policy src/config
git commit -m "feat(policy): define configurable project workflow policy"
```

## Task 14: Rewrite prompt builders to consume policy inputs

**Files:**
- Modify: `scripts/agent-issue/prompts.ts`
- Modify: `scripts/agent-issue/prompts.test.ts`
- Modify: `scripts/agent-issue-triage/agent.ts`
- Modify: `scripts/agent-issue-triage/agent.test.ts`
- Modify: `src/pi/runner.ts`
- Modify: related tests

- [ ] **Step 1: Add tests that generic prompts contain no Croprun-only text**

Add prompt tests asserting generic policy prompts do not include:

- `Croprun`
- `devenv shell`
- `just tilt-up`
- `just tilt-down`
- `direct kubectl exec`
- `docs/reference-screenshots/web/`
- `docs/reference-screenshots/mobile/`

- [ ] **Step 2: Add tests that compatibility prompts preserve old behavior**

Use `CROPRUN_COMPAT_POLICY` to assert the copied validation commands and landing policy still render for compatibility.

- [ ] **Step 3: Add prompt builder input objects**

Extend `buildTriagePrompt`, `buildPlanCreationPrompt`, and `buildImplementationPrompt` to accept policy/template inputs. Avoid reading global defaults inside prompt builders.

- [ ] **Step 4: Replace hard-coded prompt sections**

Move these sections to policy-rendered text:

- project/repository name
- required context files
- toolchain instructions
- validation commands
- forbidden substitutions
- Forgejo/tea vs other host tooling instruction
- landing policy and direct-land target branch
- visual evidence rules
- todo/subagent workflow rules

- [ ] **Step 5: Run tests and commit**

```sh
node --test scripts/agent-issue/prompts.test.ts scripts/agent-issue-triage/agent.test.ts src/pi/*.test.ts
git add scripts/agent-issue/prompts.ts scripts/agent-issue-triage/agent.ts src/pi src/policy
git commit -m "refactor(prompts): render workflow prompts from policy"
```

## Task 15: Split visual evidence policy from host upload implementation

**Files:**
- Create: `src/host/visual-evidence.ts`
- Create: `src/host/forgejo-visual-evidence.ts`
- Create: `src/host/forgejo-visual-evidence.test.ts`
- Modify: `scripts/agent-issue/visual-evidence.ts`
- Modify: `scripts/agent-issue/pipeline.ts`
- Modify: `scripts/agent-issue/prompts.ts`
- Modify: related tests

- [ ] **Step 1: Define visual evidence uploader interface**

Create:

```ts
export type VisualEvidenceUploader = {
  uploadPrEvidence(input: {
    repoRoot: string;
    prUrl: string;
    evidence: AgentIssueVisualEvidence[] | undefined;
  }): Promise<AgentIssueVisualEvidence[]>;
};
```

- [ ] **Step 2: Wrap Forgejo asset upload**

Move Forgejo-specific API paths and token env names behind `ForgejoVisualEvidenceUploader`. Primary env/config names should be `PATCHMILL_FORGEJO_URL`, `PATCHMILL_FORGEJO_TOKEN`, and `PATCHMILL_FORGEJO_REPO`, with `CROPRUN_AGENT_ISSUE_FORGEJO_*` as compatibility fallbacks.

- [ ] **Step 3: Make uploader optional**

If no uploader is configured, keep `visualEvidence` in final JSON/result but skip host asset upload with a progress message.

- [ ] **Step 4: Move screenshot prompt requirements to policy**

Use policy fields for screenshot skills, reference screenshot paths, and reviewer expectations.

- [ ] **Step 5: Run tests and commit**

```sh
node --test src/host/*visual*.test.ts scripts/agent-issue/visual-evidence.test.ts scripts/agent-issue/pipeline.test.ts scripts/agent-issue/prompts.test.ts
git add src/host scripts/agent-issue/visual-evidence.ts scripts/agent-issue/pipeline.ts scripts/agent-issue/prompts.ts src/policy
git commit -m "feat(host): split visual evidence upload from policy"
```

## Task 16: Document and parameterize Pi todo and plan-task contracts

**Files:**
- Create: `src/policy/task-contract.ts`
- Create: `src/policy/task-contract.test.ts`
- Modify: `scripts/agent-issue/issue-todos.ts`
- Modify: `scripts/agent-issue/plan-tasks.ts`
- Modify: `scripts/agent-issue/prompts.ts`
- Modify: `docs/providers.md`
- Create: `docs/task-contracts.md`

- [ ] **Step 1: Define task contract policy**

Represent:

- todo root path, default `.pi/todos`
- todo title pattern, default `issue-<number>-task-<two-digit-number>-<slug>`
- done statuses, default `closed`, `completed`, `done`
- plan task heading pattern, default `## Task N: Label` and deeper headings
- whether open task todos block final handoff, default `true`

- [ ] **Step 2: Update readers to accept the contract**

Pass task contract policy into `readIssueTodoTasks`, `issueTodoProgress`, `assertIssueTodosComplete`, and `readPlanTaskLabels`.

- [ ] **Step 3: Update prompts from task contract**

Render todo naming, tags, body requirements, and completion gate instructions from the task contract policy.

- [ ] **Step 4: Add task contract docs**

Create `docs/task-contracts.md` documenting the default Pi todo and plan task conventions and how projects may override them.

- [ ] **Step 5: Run tests and commit**

```sh
node --test src/policy/task-contract.test.ts scripts/agent-issue/issue-todos.test.ts scripts/agent-issue/plan-tasks.test.ts scripts/agent-issue/prompts.test.ts
git add src/policy scripts/agent-issue/issue-todos.ts scripts/agent-issue/plan-tasks.ts scripts/agent-issue/prompts.ts docs/task-contracts.md docs/providers.md
git commit -m "feat(policy): document pi task contracts"
```

## Task 17: Generalize triage taxonomy and decision policy

**Files:**
- Modify: `src/policy/labels.ts`
- Create: `src/policy/triage.ts`
- Create: `src/policy/triage.test.ts`
- Modify: `scripts/agent-issue-triage/agent.ts`
- Modify: `scripts/agent-issue-triage/labels.ts`
- Modify: `scripts/agent-issue-triage/validation.ts`
- Modify: `scripts/agent-issue-triage/apply.ts`
- Modify: `scripts/agent-issue/selection.ts`
- Modify: related tests

- [ ] **Step 1: Extend label config beyond automation labels**

Add configurable type labels and priority labels instead of hard-coding `bug`, `enhancement`, `docs`, `chore`, `test`, and `priority:*` in copied modules.

- [ ] **Step 2: Create triage policy**

Represent:

- primary buckets
- allowed labels
- excluded/protection labels
- confidence values
- ambiguity rule text
- needs-info comment behavior
- priority ordering for run-once selection

- [ ] **Step 3: Update triage prompt and validation**

Make `buildTriagePrompt` and `validateTriageDocument` consume triage policy. Preserve default statuses: `agent-ready`, `needs-info`, `agent-unsuitable`.

- [ ] **Step 4: Update selection policy**

Make run-once issue selection use configured ready label, protection labels, and priority ordering.

- [ ] **Step 5: Run tests and commit**

```sh
node --test src/policy/*.test.ts scripts/agent-issue-triage/*.test.ts scripts/agent-issue/selection.test.ts
git add src/policy scripts/agent-issue-triage scripts/agent-issue/selection.ts
git commit -m "feat(policy): generalize triage taxonomy"
```

## Task 18: Final Croprun-specific audit and compatibility documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/providers.md`
- Modify: `docs/task-contracts.md`
- Create: `docs/migration-from-croprun-scripts.md`
- Modify: tests as needed

- [ ] **Step 1: Add an audit test/script**

Add a lightweight grep-based verification command documented in `package.json`, for example:

```sh
npm run audit:generalization
```

It should report remaining occurrences of `Croprun`, `CROPRUN_`, `tilt`, `devenv`, `just tilt`, `.pi/agent-issue`, and `docs/reference-screenshots` in source files. Allowed occurrences must be documented as compatibility fixtures, tests, or migration docs.

- [ ] **Step 2: Document compatibility behavior**

Create `docs/migration-from-croprun-scripts.md` explaining:

- old command names and new Patchmill commands
- old environment variables and new `PATCHMILL_*` names
- default state path migration from `.pi/agent-issue` to `.patchmill`
- how to enable the legacy Tilt cleanup hook
- how to preserve Croprun prompt policy with config

- [ ] **Step 3: Verify no stale generic-path regressions**

Run:

```sh
npm test
npm run audit:generalization
```

Expected: tests pass and the audit lists only documented compatibility references.

- [ ] **Step 4: Commit**

```sh
git add README.md docs package.json '*test.ts'
git commit -m "docs: document patchmill migration and generalization audit"
```

## Final verification

- [ ] Run all tests:

```sh
npm test
```

Expected: all tests pass.

- [ ] Check repository status:

```sh
git status --short
```

Expected: no uncommitted changes after the final commit.

## Self-review notes

- Spec coverage: the plan now covers CLI bootstrap, config, host provider, concrete Pi runner contracts, env-name generalization, label policy, workflow config wiring, path migration, git worktree strategy, cleanup hooks, project policy/prompt templates, visual evidence upload boundaries, Pi todo/plan-task contracts, triage taxonomy, and final Croprun-specific audit documentation.
- The plan intentionally does not implement GitHub/GitLab because the design marks those as future host-provider extensions.
- The plan intentionally does not abstract or implement non-Pi coding agents; Pi remains the concrete workflow runtime.
- Croprun compatibility remains available through explicit compatibility policy, environment fallbacks, migration docs, and tests; generic Patchmill defaults should not depend on Croprun, Tilt, Just, or Forgejo-only visual evidence behavior.
