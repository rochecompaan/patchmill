# GitHub Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `github-gh` as a Patchmill issue-host provider while preserving
existing `forgejo-tea` behavior.

**Architecture:** Refactor host reads/writes behind the existing
`IssueHostProvider` abstraction, add a provider factory, then implement a GitHub
CLI-backed provider using `gh`. Keep skills responsible for judgment/procedure
and provider code responsible for deterministic issue, label, comment, doctor,
and visual-evidence plumbing.

**Tech Stack:** TypeScript, Node test runner, GitHub CLI (`gh`), Forgejo/Gitea
`tea` CLI, existing `CommandRunner` test doubles.

---

## File structure

- Modify `src/config/types.ts` to add the `"github-gh"` provider ID.
- Modify `src/config/defaults.ts` only if the host type requires default shape
  adjustments; keep default provider `"forgejo-tea"`.
- Modify `src/cli/commands/init/config-writer.ts` to infer GitHub remotes.
- Modify `src/host/types.ts` to extend `IssueHostProvider` with provider
  metadata, `checkCli`, label remediation, and issue-by-number reads.
- Modify `src/host/forgejo-tea.ts` to implement the extended interface.
- Modify `src/cli/commands/triage/forgejo.ts` only for exported helpers still
  needed by `ForgejoTeaHostProvider`.
- Create `src/host/github-gh.ts` for the GitHub CLI-backed provider.
- Create `src/host/factory.ts` for provider construction.
- Modify `src/cli/commands/triage/types.ts` and
  `src/cli/commands/run-once/types.ts` to carry `host` config instead of adding
  new `teaLogin` usages.
- Modify `src/cli/commands/triage/args.ts` and
  `src/cli/commands/run-once/args.ts` to populate `host` from normalized config
  and `--host-login`/`--tea-login`.
- Modify `src/cli/commands/triage/pipeline.ts` to use `IssueHostProvider`.
- Modify `src/cli/commands/run-once/pipeline.ts` to use `IssueHostProvider`.
- Modify `src/cli/commands/doctor/checks.ts` to use provider-aware checks and
  remediation.
- Modify `src/cli/commands/run-once/visual-evidence.ts` to choose uploaders by
  provider.
- Modify CLI help in `src/cli/commands/triage/main.ts` and
  `src/cli/commands/run-once/main.ts` to remove Forgejo-only wording.
- Modify docs: `README.md`, `docs/configuration.md`, and `docs/providers.md`.

## Task 1: Config model and init inference

**Files:**

- Modify: `src/config/types.ts`
- Modify: `src/cli/commands/init/config-writer.ts`
- Test: `src/cli/commands/init/config-writer.test.ts`
- Test: `src/config/load.test.ts`

- [ ] **Step 1: Write failing tests for GitHub provider config**

Add tests that assert `github-gh` is accepted and invalid providers are still
rejected. Use existing config loading test helpers in `src/config/load.test.ts`.

```ts
test("loadPatchmillConfigState accepts github-gh host provider", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    `${JSON.stringify({ host: { provider: "github-gh", login: "" } })}\n`,
  );

  const result = await loadPatchmillConfigState(repoRoot, {}, []);

  assert.equal(result.config.host.provider, "github-gh");
  assert.equal(result.config.host.login, "");
});
```

Add init inference tests in `src/cli/commands/init/config-writer.test.ts`:

```ts
test("inferHostProviderFromRemote detects GitHub HTTPS remotes", () => {
  assert.equal(
    inferHostProviderFromRemote(
      "https://github.com/rochecompaan/patchmill.git",
    ),
    "github-gh",
  );
});

test("inferHostProviderFromRemote detects GitHub SCP-like remotes", () => {
  assert.equal(
    inferHostProviderFromRemote("git@github.com:rochecompaan/patchmill.git"),
    "github-gh",
  );
});

test("inferHostProviderFromRemote keeps Forgejo as fallback", () => {
  assert.equal(
    inferHostProviderFromRemote("git@git.example.com:owner/repo.git"),
    "forgejo-tea",
  );
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```sh
node --test src/config/load.test.ts src/cli/commands/init/config-writer.test.ts
```

Expected: failure because `github-gh` is not an allowed provider and inference
still returns `forgejo-tea`.

- [ ] **Step 3: Implement provider type and inference**

In `src/config/types.ts`, replace the hard-coded provider literal with a union:

```ts
export type PatchmillHostProviderId = "forgejo-tea" | "github-gh";

export type PatchmillHostConfig = {
  provider: PatchmillHostProviderId;
  login: string;
};
```

In `src/cli/commands/init/config-writer.ts`, implement GitHub detection:

```ts
function remoteHost(remoteUrl: string | undefined): string | undefined {
  if (!remoteUrl) return undefined;
  const trimmed = remoteUrl.trim();
  const scpLike = /^[^@]+@([^:]+):/u.exec(trimmed);
  if (scpLike) return scpLike[1]?.toLowerCase();
  try {
    return new URL(trimmed.replace(/^git\+/, "")).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function inferHostProviderFromRemote(
  remoteUrl: string | undefined,
): PatchmillConfig["host"]["provider"] {
  return remoteHost(remoteUrl) === "github.com" ? "github-gh" : "forgejo-tea";
}
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```sh
node --test src/config/load.test.ts src/cli/commands/init/config-writer.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```sh
git add src/config/types.ts src/cli/commands/init/config-writer.ts src/cli/commands/init/config-writer.test.ts src/config/load.test.ts
git commit -m "feat(config): add github host provider option"
```

## Task 2: Extend host provider interface and factory

**Files:**

- Modify: `src/host/types.ts`
- Modify: `src/host/forgejo-tea.ts`
- Create: `src/host/factory.ts`
- Test: `src/host/forgejo-tea.test.ts`
- Test: `src/host/factory.test.ts`

- [ ] **Step 1: Write failing factory tests**

Create `src/host/factory.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createIssueHostProvider } from "./factory.ts";
import { ForgejoTeaHostProvider } from "./forgejo-tea.ts";

const runner = {
  async run() {
    return { code: 0, stdout: "", stderr: "" };
  },
};

test("createIssueHostProvider creates Forgejo Tea provider", () => {
  const provider = createIssueHostProvider({
    runner,
    repoRoot: "/repo",
    host: { provider: "forgejo-tea", login: "triage-agent" },
  });

  assert.equal(provider.id, "forgejo-tea");
  assert.equal(provider instanceof ForgejoTeaHostProvider, true);
});
```

Add a Forgejo provider test for new metadata/check methods:

```ts
test("ForgejoTeaHostProvider reports CLI readiness", async () => {
  const calls: string[] = [];
  const provider = createProvider({
    async run(command, args) {
      calls.push([command, ...args].join(" "));
      return { code: 0, stdout: "tea help", stderr: "" };
    },
  });

  const result = await provider.checkCli();

  assert.deepEqual(result, {
    ok: true,
    message: "forgejo via tea as triage-agent",
  });
  assert.deepEqual(calls, ["tea --help"]);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```sh
node --test src/host/factory.test.ts src/host/forgejo-tea.test.ts
```

Expected: factory module and new methods do not exist.

- [ ] **Step 3: Extend `IssueHostProvider`**

In `src/host/types.ts`, add:

```ts
import type { PatchmillHostProviderId } from "../config/types.ts";

export type HostCliCheck =
  | { ok: true; message: string }
  | { ok: false; message: string; remediation: string[] };
```

Then update `IssueHostProvider`:

```ts
export type IssueHostProvider = {
  readonly id: PatchmillHostProviderId;
  readonly displayName: string;
  checkCli(): Promise<HostCliCheck>;
  missingLabelRemediation(label: LabelDefinition): string;
  listOpenIssues(): Promise<IssueSummary[]>;
  listIssuesByNumbers(issueNumbers: readonly number[]): Promise<IssueSummary[]>;
  hydrateIssueComments(issues: IssueSummary[]): Promise<IssueSummary[]>;
  listLabels(): Promise<string[]>;
  createLabel(label: LabelDefinition): Promise<void>;
  applyLabels(change: LabelChangePlan): Promise<void>;
  commentIssue(issueNumber: number, body: string): Promise<void>;
};
```

- [ ] **Step 4: Update Forgejo provider**

In `src/host/forgejo-tea.ts`, add `id`, `displayName`, `checkCli`,
`missingLabelRemediation`, and `listIssuesByNumbers`:

```ts
readonly id = "forgejo-tea" as const;
readonly displayName = "Forgejo via tea";

async checkCli(): Promise<HostCliCheck> {
  const result = await this.options.runner.run("tea", ["--help"], {
    cwd: this.options.repoRoot,
  });
  if (result.code === 0) {
    return {
      ok: true,
      message: this.options.login
        ? `forgejo via tea as ${this.options.login}`
        : "forgejo via tea",
    };
  }
  return {
    ok: false,
    message: `tea unavailable: ${commandOutput(result)}`,
    remediation: ["Install and authenticate tea, then rerun:", "  patchmill doctor"],
  };
}

missingLabelRemediation(label: LabelDefinition): string {
  return `  tea labels create --name ${label.name} --color ${label.color}`;
}
```

Import and delegate `listIssuesByNumbers` from
`src/cli/commands/triage/forgejo.ts`.

- [ ] **Step 5: Create provider factory**

Create `src/host/factory.ts`:

```ts
import type { PatchmillHostConfig } from "../config/types.ts";
import type { CommandRunner } from "../cli/commands/triage/types.ts";
import { ForgejoTeaHostProvider } from "./forgejo-tea.ts";
import type { IssueHostProvider } from "./types.ts";

export function createIssueHostProvider(options: {
  runner: CommandRunner;
  repoRoot: string;
  host: PatchmillHostConfig;
}): IssueHostProvider {
  switch (options.host.provider) {
    case "forgejo-tea":
      return new ForgejoTeaHostProvider({
        runner: options.runner,
        repoRoot: options.repoRoot,
        login: options.host.login,
      });
    case "github-gh":
      throw new Error("github-gh provider is not implemented yet");
  }
}
```

- [ ] **Step 6: Run tests and verify pass**

Run:

```sh
node --test src/host/factory.test.ts src/host/forgejo-tea.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```sh
git add src/host/types.ts src/host/forgejo-tea.ts src/host/forgejo-tea.test.ts src/host/factory.ts src/host/factory.test.ts
git commit -m "refactor(host): introduce provider factory"
```

## Task 3: Refactor triage pipeline to use host provider

**Files:**

- Modify: `src/cli/commands/triage/types.ts`
- Modify: `src/cli/commands/triage/args.ts`
- Modify: `src/cli/commands/triage/pipeline.ts`
- Test: `src/cli/commands/triage/args.test.ts`
- Test: `src/cli/commands/triage/pipeline.test.ts`

- [ ] **Step 1: Write failing tests that assert provider factory usage**

In `src/cli/commands/triage/args.test.ts`, add:

```ts
test("parseArgs carries normalized host config", () => {
  const config = parseArgs(
    ["--dry-run"],
    "/repo",
    {},
    {
      ...DEFAULT_PATCHMILL_CONFIG,
      host: { provider: "github-gh", login: "" },
    },
  );

  assert.deepEqual(config.host, { provider: "github-gh", login: "" });
});
```

In `src/cli/commands/triage/pipeline.test.ts`, add or adapt a test runner that
fails if `tea` is called when provider is `github-gh` before the provider is
implemented. The expected failure at this task is a thrown
`github-gh provider is not implemented yet` error from the factory, not a `tea`
command.

```ts
test("runTriage constructs provider from config host", async () => {
  await assert.rejects(
    runTriage(fakeRunner(), {
      ...baseTriageConfig(),
      host: { provider: "github-gh", login: "" },
      dryRun: true,
      execute: false,
    }),
    /github-gh provider is not implemented yet/,
  );
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```sh
node --test src/cli/commands/triage/args.test.ts src/cli/commands/triage/pipeline.test.ts
```

Expected: `host` is missing from `TriageConfig` and pipeline still imports
Forgejo functions directly.

- [ ] **Step 3: Add host config to triage config parsing**

In `src/cli/commands/triage/types.ts`:

```ts
import type { PatchmillHostConfig } from "../../../config/types.ts";

export type TriageConfig = {
  repoRoot: string;
  host: PatchmillHostConfig;
  // keep teaLogin temporarily only if tests or compatibility still need it during this refactor
};
```

In `src/cli/commands/triage/args.ts`, replace `teaLogin` initialization with
provider-aware host config:

```ts
function hostConfig(
  env: Env,
  normalizedConfig: PatchmillConfig,
): PatchmillConfig["host"] {
  return {
    ...normalizedConfig.host,
    login: env.PATCHMILL_HOST_LOGIN ?? normalizedConfig.host.login,
  };
}
```

Set `config.host = hostConfig(env, patchmillConfig)`. For `--host-login` and
`--tea-login`, update `config.host.login`.

- [ ] **Step 4: Refactor `runTriage`**

In `src/cli/commands/triage/pipeline.ts`, remove direct imports from
`./forgejo.ts` and import the factory:

```ts
import { createIssueHostProvider } from "../../../host/factory.ts";
```

At the start of `runTriage` after config/policy setup:

```ts
const host = createIssueHostProvider({
  runner,
  repoRoot: config.repoRoot,
  host: config.host,
});
```

Replace calls:

```ts
listedIssues = await host.listOpenIssues();
await host.hydrateIssueComments(issues);
afterIssues = await host.listIssuesByNumbers(
  beforeIssues.map((issue) => issue.number),
);
await host.hydrateIssueComments(afterIssues);
```

- [ ] **Step 5: Run triage tests**

Run:

```sh
node --test src/cli/commands/triage/*.test.ts
```

Expected: all triage tests pass, with Forgejo behavior unchanged.

- [ ] **Step 6: Commit**

```sh
git add src/cli/commands/triage/types.ts src/cli/commands/triage/args.ts src/cli/commands/triage/args.test.ts src/cli/commands/triage/pipeline.ts src/cli/commands/triage/pipeline.test.ts
git commit -m "refactor(triage): route host IO through provider"
```

## Task 4: Refactor run-once pipeline to use host provider

**Files:**

- Modify: `src/cli/commands/run-once/types.ts`
- Modify: `src/cli/commands/run-once/args.ts`
- Modify: `src/cli/commands/run-once/pipeline.ts`
- Test: `src/cli/commands/run-once/args.test.ts`
- Test: `src/cli/commands/run-once/pipeline.test.ts`

- [ ] **Step 1: Write failing run-once config tests**

In `src/cli/commands/run-once/args.test.ts`, add:

```ts
test("parseArgs carries normalized github host config", () => {
  const config = parseArgs(
    ["--dry-run"],
    "/repo",
    {},
    {
      ...DEFAULT_PATCHMILL_CONFIG,
      host: { provider: "github-gh", login: "" },
    },
  );

  assert.deepEqual(config.host, { provider: "github-gh", login: "" });
});

test("parseArgs applies host-login to host config", () => {
  const config = parseArgs(
    ["--host-login", "operator"],
    "/repo",
    {},
    DEFAULT_PATCHMILL_CONFIG,
  );

  assert.equal(config.host.login, "operator");
});
```

- [ ] **Step 2: Run tests and verify fail**

Run:

```sh
node --test src/cli/commands/run-once/args.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: `host` is missing from `AgentIssueConfig`.

- [ ] **Step 3: Add host config to run-once config parsing**

In `src/cli/commands/run-once/types.ts`:

```ts
import type { PatchmillHostConfig } from "../../../config/types.ts";

export type AgentIssueConfig = {
  repoRoot: string;
  host: PatchmillHostConfig;
  // keep teaLogin only during migration if existing tests still read it
};
```

In `src/cli/commands/run-once/args.ts`, mirror the `hostConfig` helper from
triage args and set `config.host`. Update `--host-login` and `--tea-login` to
mutate `config.host.login`.

- [ ] **Step 4: Refactor run-once pipeline host calls**

In `src/cli/commands/run-once/pipeline.ts`, remove direct Forgejo imports:

```ts
import { createIssueHostProvider } from "../../../host/factory.ts";
```

At the start of `runOneIssue`:

```ts
const host = createIssueHostProvider({
  runner,
  repoRoot: config.repoRoot,
  host: config.host,
});
```

Replace host operations:

```ts
const issues = await host.listOpenIssues();
const missing = missingLabelDefinitions(await host.listLabels(), ...);
await host.createLabel(label);
await host.applyLabels(planLabelChange(...));
await host.commentIssue(issue.number, body);
```

Change `ensureAutomationLabel` to accept `host: IssueHostProvider` instead of
runner/config:

```ts
async function ensureAutomationLabel(
  host: IssueHostProvider,
  triagePolicy: PatchmillTriagePolicy | undefined,
  name: string,
): Promise<void> {
  const missing = missingLabelDefinitions(
    await host.listLabels(),
    triagePolicy ?? DEFAULT_TRIAGE_POLICY,
  );
  const label = missing.find((definition) => definition.name === name);
  if (!label) return;
  await host.createLabel(label);
}
```

- [ ] **Step 5: Run run-once tests**

Run:

```sh
node --test src/cli/commands/run-once/*.test.ts
```

Expected: all run-once tests pass.

- [ ] **Step 6: Commit**

```sh
git add src/cli/commands/run-once/types.ts src/cli/commands/run-once/args.ts src/cli/commands/run-once/args.test.ts src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
git commit -m "refactor(run-once): route host IO through provider"
```

## Task 5: Implement GitHub `gh` provider

**Files:**

- Create: `src/host/github-gh.ts`
- Create: `src/host/github-gh.test.ts`
- Modify: `src/host/factory.ts`
- Test: `src/host/factory.test.ts`

- [ ] **Step 1: Write GitHub provider tests**

Create `src/host/github-gh.test.ts` with command-runner tests for each
operation. Start with listing and normalizing issues:

```ts
test("GitHubGhHostProvider lists open issues", async () => {
  const runner = scriptedRunner({
    "gh issue list --state open --limit 1000 --json number,title,body,state,labels,author,updatedAt":
      {
        code: 0,
        stdout: JSON.stringify([
          {
            number: 42,
            title: "Fix dashboard",
            body: null,
            state: "OPEN",
            labels: [{ name: "agent-ready" }, { name: "bug" }],
            author: { login: "alice" },
            updatedAt: "2026-05-28T10:00:00Z",
          },
        ]),
        stderr: "",
      },
  });
  const provider = new GitHubGhHostProvider({ runner, repoRoot: "/repo" });

  assert.deepEqual(await provider.listOpenIssues(), [
    {
      number: 42,
      title: "Fix dashboard",
      body: "",
      state: "open",
      labels: ["agent-ready", "bug"],
      author: "alice",
      updated: "2026-05-28T10:00:00Z",
    },
  ]);
});
```

Add tests for:

- `hydrateIssueComments()` calls `gh issue view <number> --json ...comments...`
  and writes `issue.comments`.
- `listIssuesByNumbers([1, 2])` calls `gh issue view 1 ...` and
  `gh issue view 2 ...`.
- `listLabels()` parses `gh label list --json name`.
- `createLabel()` strips leading `#` from colors for `gh label create`.
- `applyLabels()` calls `gh issue edit` with `--add-label` and/or
  `--remove-label` only when needed.
- `commentIssue()` calls `gh issue comment <number> --body <body>`.
- failed commands throw errors containing `gh` and the issue/label context.

- [ ] **Step 2: Run tests and verify fail**

Run:

```sh
node --test src/host/github-gh.test.ts src/host/factory.test.ts
```

Expected: `github-gh.ts` does not exist or factory throws not implemented.

- [ ] **Step 3: Implement `GitHubGhHostProvider`**

Create `src/host/github-gh.ts`:

```ts
import type { CommandRunner } from "../cli/commands/triage/types.ts";
import type {
  HostCliCheck,
  IssueHostProvider,
  IssueSummary,
  LabelChangePlan,
  LabelDefinition,
} from "./types.ts";

const ISSUE_JSON_FIELDS =
  "number,title,body,state,labels,author,updatedAt,comments";

export type GitHubGhHostOptions = {
  runner: CommandRunner;
  repoRoot: string;
};

export class GitHubGhHostProvider implements IssueHostProvider {
  readonly id = "github-gh" as const;
  readonly displayName = "GitHub via gh";

  constructor(private readonly options: GitHubGhHostOptions) {}

  async checkCli(): Promise<HostCliCheck> {
    const version = await this.options.runner.run("gh", ["--version"], {
      cwd: this.options.repoRoot,
    });
    if (version.code !== 0) {
      return {
        ok: false,
        message: `gh unavailable: ${commandOutput(version)}`,
        remediation: [
          "Install and authenticate GitHub CLI:",
          "  gh auth login",
          "  patchmill doctor",
        ],
      };
    }
    const auth = await this.options.runner.run("gh", ["auth", "status"], {
      cwd: this.options.repoRoot,
    });
    if (auth.code !== 0) {
      return {
        ok: false,
        message: `gh auth unavailable: ${commandOutput(auth)}`,
        remediation: [
          "Authenticate GitHub CLI, then rerun:",
          "  gh auth login",
          "  patchmill doctor",
        ],
      };
    }
    return { ok: true, message: "github via gh" };
  }

  missingLabelRemediation(label: LabelDefinition): string {
    return `  gh label create ${shellQuote(label.name)} --color ${label.color.replace(/^#/u, "")} --description ${shellQuote(label.description)}`;
  }

  async listOpenIssues(): Promise<IssueSummary[]> {
    const result = await this.options.runner.run(
      "gh",
      [
        "issue",
        "list",
        "--state",
        "open",
        "--limit",
        "1000",
        "--json",
        "number,title,body,state,labels,author,updatedAt",
      ],
      { cwd: this.options.repoRoot },
    );
    if (result.code !== 0)
      throw new Error(`gh issue list failed: ${commandOutput(result)}`);
    return parseIssueArray(result.stdout, "gh issue list");
  }

  async listIssuesByNumbers(
    issueNumbers: readonly number[],
  ): Promise<IssueSummary[]> {
    const issues: IssueSummary[] = [];
    for (const issueNumber of issueNumbers)
      issues.push(await this.viewIssue(issueNumber));
    return issues.sort((a, b) => a.number - b.number);
  }

  async hydrateIssueComments(issues: IssueSummary[]): Promise<IssueSummary[]> {
    for (const issue of issues)
      issue.comments = (await this.viewIssue(issue.number)).comments ?? [];
    return issues;
  }

  async listLabels(): Promise<string[]> {
    const result = await this.options.runner.run(
      "gh",
      ["label", "list", "--limit", "1000", "--json", "name"],
      { cwd: this.options.repoRoot },
    );
    if (result.code !== 0)
      throw new Error(`gh label list failed: ${commandOutput(result)}`);
    return parseLabelNames(result.stdout, "gh label list");
  }

  async createLabel(label: LabelDefinition): Promise<void> {
    const result = await this.options.runner.run(
      "gh",
      [
        "label",
        "create",
        label.name,
        "--color",
        label.color.replace(/^#/u, ""),
        "--description",
        label.description,
      ],
      { cwd: this.options.repoRoot },
    );
    if (result.code !== 0)
      throw new Error(
        `gh label create failed for ${label.name}: ${commandOutput(result)}`,
      );
  }

  async applyLabels(change: LabelChangePlan): Promise<void> {
    if (change.addLabels.length === 0 && change.removeLabels.length === 0)
      return;
    const args = ["issue", "edit", String(change.issueNumber)];
    if (change.addLabels.length > 0)
      args.push("--add-label", change.addLabels.join(","));
    if (change.removeLabels.length > 0)
      args.push("--remove-label", change.removeLabels.join(","));
    const result = await this.options.runner.run("gh", args, {
      cwd: this.options.repoRoot,
    });
    if (result.code !== 0)
      throw new Error(
        `gh issue edit labels failed for #${change.issueNumber}: ${commandOutput(result)}`,
      );
  }

  async commentIssue(issueNumber: number, body: string): Promise<void> {
    const result = await this.options.runner.run(
      "gh",
      ["issue", "comment", String(issueNumber), "--body", body],
      { cwd: this.options.repoRoot },
    );
    if (result.code !== 0)
      throw new Error(
        `gh issue comment failed for #${issueNumber}: ${commandOutput(result)}`,
      );
  }

  private async viewIssue(issueNumber: number): Promise<IssueSummary> {
    const result = await this.options.runner.run(
      "gh",
      ["issue", "view", String(issueNumber), "--json", ISSUE_JSON_FIELDS],
      { cwd: this.options.repoRoot },
    );
    if (result.code !== 0)
      throw new Error(
        `gh issue view failed for #${issueNumber}: ${commandOutput(result)}`,
      );
    return parseIssueObject(
      JSON.parse(result.stdout),
      `gh issue view #${issueNumber}`,
    );
  }
}
```

Also implement `commandOutput`, `parseIssueArray`, `parseIssueObject`,
`parseLabelNames`, and `shellQuote` in the same file. Keep them small and fully
covered by tests.

- [ ] **Step 4: Wire factory**

In `src/host/factory.ts`, replace the GitHub throw with:

```ts
case "github-gh":
  return new GitHubGhHostProvider({
    runner: options.runner,
    repoRoot: options.repoRoot,
  });
```

- [ ] **Step 5: Run provider tests**

Run:

```sh
node --test src/host/github-gh.test.ts src/host/factory.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```sh
git add src/host/github-gh.ts src/host/github-gh.test.ts src/host/factory.ts src/host/factory.test.ts
git commit -m "feat(host): add github gh provider"
```

## Task 6: Make doctor provider-aware

**Files:**

- Modify: `src/cli/commands/doctor/checks.ts`
- Test: `src/cli/commands/doctor/checks.test.ts`

- [ ] **Step 1: Write failing doctor tests for GitHub**

In `src/cli/commands/doctor/checks.test.ts`, add a GitHub happy-path case with
command fixtures:

```ts
test("runDoctorChecks supports github-gh provider", async () => {
  const runner = scriptedRunner({
    "git rev-parse --is-inside-work-tree": {
      code: 0,
      stdout: "true\n",
      stderr: "",
    },
    "git branch --show-current": { code: 0, stdout: "main\n", stderr: "" },
    "git status --porcelain=v1 --untracked-files=all": {
      code: 0,
      stdout: "",
      stderr: "",
    },
    "gh --version": { code: 0, stdout: "gh version 2.0.0\n", stderr: "" },
    "gh auth status": { code: 0, stdout: "Logged in\n", stderr: "" },
    "gh issue list --state open --limit 1000 --json number,title,body,state,labels,author,updatedAt":
      { code: 0, stdout: "[]", stderr: "" },
    "gh label list --limit 1000 --json name": {
      code: 0,
      stdout: JSON.stringify(REQUIRED_LABELS.map((name) => ({ name }))),
      stderr: "",
    },
    "pi --help": { code: 0, stdout: "pi help", stderr: "" },
    "pi --no-session --no-context-files --no-prompt-templates -p Reply with PATCHMILL_PI_OK and nothing else.":
      { code: 0, stdout: "PATCHMILL_PI_OK", stderr: "" },
  });
  await writeConfig(repoRoot, { host: { provider: "github-gh", login: "" } });

  const results = await runDoctorChecks(runner, { repoRoot });

  assert.equal(
    results.find((result) => result.name === "host")?.status,
    "pass",
  );
});
```

Add a missing-label remediation assertion that includes `gh label create`.

- [ ] **Step 2: Run doctor tests and verify fail**

Run:

```sh
node --test src/cli/commands/doctor/checks.test.ts
```

Expected: unsupported provider or direct `tea` checks fail.

- [ ] **Step 3: Refactor doctor to use provider factory**

In `src/cli/commands/doctor/checks.ts`:

- Remove direct `listLabels`/`listOpenIssues` imports from
  `../triage/forgejo.ts`.
- Import `createIssueHostProvider`.
- After config loads, create
  `const host = createIssueHostProvider({ runner, repoRoot, host: config.host });`.
- Replace provider support check with `await host.checkCli()`.
- Replace issue listing with `await host.listOpenIssues()`.
- Replace label listing with `await host.listLabels()`.
- Replace remediation command generation with
  `host.missingLabelRemediation(label)`.

- [ ] **Step 4: Run doctor tests**

Run:

```sh
node --test src/cli/commands/doctor/checks.test.ts
```

Expected: all doctor tests pass for Forgejo and GitHub.

- [ ] **Step 5: Commit**

```sh
git add src/cli/commands/doctor/checks.ts src/cli/commands/doctor/checks.test.ts
git commit -m "feat(doctor): check github host provider"
```

## Task 7: Provider-aware visual evidence defaults

**Files:**

- Modify: `src/cli/commands/run-once/visual-evidence.ts`
- Modify: `src/cli/commands/run-once/pipeline.ts`
- Test: `src/cli/commands/run-once/visual-evidence.test.ts`

- [ ] **Step 1: Write failing visual evidence tests**

Add tests:

```ts
test("defaultVisualEvidenceUploader returns no uploader for github-gh", () => {
  assert.equal(
    defaultVisualEvidenceUploader({
      runner: fakeRunner(),
      provider: "github-gh",
      env: {
        PATCHMILL_FORGEJO_URL: "https://forgejo.example",
        PATCHMILL_FORGEJO_TOKEN: "token",
      },
    }),
    undefined,
  );
});

test("defaultVisualEvidenceUploader keeps Forgejo uploader for forgejo-tea", () => {
  const uploader = defaultVisualEvidenceUploader({
    runner: fakeRunner(),
    provider: "forgejo-tea",
    env: {
      PATCHMILL_FORGEJO_URL: "https://forgejo.example",
      PATCHMILL_FORGEJO_TOKEN: "token",
    },
  });

  assert.notEqual(uploader, undefined);
});
```

- [ ] **Step 2: Run visual evidence tests and verify fail**

Run:

```sh
node --test src/cli/commands/run-once/visual-evidence.test.ts
```

Expected: `provider` input is not accepted.

- [ ] **Step 3: Add provider input**

In `src/cli/commands/run-once/visual-evidence.ts`, update input type:

```ts
import type { PatchmillHostProviderId } from "../../../config/types.ts";

export type DefaultVisualEvidenceUploaderInput = {
  runner: CommandRunner;
  provider: PatchmillHostProviderId;
  env?: ForgejoVisualEvidenceEnv;
  fetchImpl?: typeof fetch;
};
```

Update function:

```ts
if (input.provider !== "forgejo-tea") return undefined;
```

In `src/cli/commands/run-once/pipeline.ts`, pass `config.host.provider` when
calling `defaultVisualEvidenceUploader`.

- [ ] **Step 4: Run visual evidence and run-once tests**

Run:

```sh
node --test src/cli/commands/run-once/visual-evidence.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```sh
git add src/cli/commands/run-once/visual-evidence.ts src/cli/commands/run-once/visual-evidence.test.ts src/cli/commands/run-once/pipeline.ts
git commit -m "feat(visual-evidence): make uploader provider-aware"
```

## Task 8: Update help text and documentation

**Files:**

- Modify: `src/cli/commands/triage/main.ts`
- Modify: `src/cli/commands/run-once/main.ts`
- Modify: `README.md`
- Modify: `docs/configuration.md`
- Modify: `docs/providers.md`
- Test: existing CLI/help and markdown lint tests

- [ ] **Step 1: Write failing help text tests**

Update existing tests in `src/cli/commands/triage/*main*.test.ts` or
`src/cli/commands/run-once/*main*.test.ts` to assert help uses host-neutral
wording:

```ts
assert.match(HELP_TEXT, /Use a named host login/);
assert.doesNotMatch(HELP_TEXT, /Forgejo issue updates/);
```

- [ ] **Step 2: Run help tests and verify fail**

Run:

```sh
npm run test:cli
```

Expected: help still mentions Forgejo.

- [ ] **Step 3: Update help text**

Change help strings:

- `Automated Forgejo issue triage` → `Automated issue triage`.
- `Preview ... without mutating Forgejo` →
  `Preview ... without mutating the configured issue host`.
- `Use a named host login for Forgejo issue updates` →
  `Use a named host login when the provider supports named logins`.
- Keep `--tea-login` as `Compatibility alias for --host-login`.
- In run-once help, mark Forgejo visual evidence env vars as Forgejo-only.

- [ ] **Step 4: Update docs**

In `docs/providers.md`, document:

```md
## Supported issue hosts

- `forgejo-tea`: Forgejo/Gitea through `tea`.
- `github-gh`: GitHub through `gh`.
```

Add GitHub setup:

```sh
gh auth login
patchmill init
patchmill doctor
```

In `docs/configuration.md`, show GitHub host config:

```json
{
  "host": {
    "provider": "github-gh",
    "login": ""
  }
}
```

Document that `PATCHMILL_HOST_LOGIN` only affects providers with named-login
support, and GitHub visual evidence upload is not supported in the first
version.

- [ ] **Step 5: Run docs/help verification**

Run:

```sh
npm run test:cli
npm run lint:md
```

Expected: tests and markdown lint pass.

- [ ] **Step 6: Commit**

```sh
git add src/cli/commands/triage/main.ts src/cli/commands/run-once/main.ts README.md docs/configuration.md docs/providers.md
git commit -m "docs(providers): document github gh support"
```

## Task 9: Full regression verification

**Files:**

- No production file edits expected unless verification finds a bug.

- [ ] **Step 1: Run full test suite**

Run:

```sh
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run lint**

Run:

```sh
npm run lint
```

Expected: Prettier, ESLint, and markdownlint all pass.

- [ ] **Step 3: Run package verification**

Run:

```sh
npm pack --dry-run
```

Expected: package builds with expected files and no npm errors.

- [ ] **Step 4: Run Nix package build**

Run:

```sh
nix build .#patchmill
```

Expected: build and install check pass.

- [ ] **Step 5: Manual smoke test with GitHub repository**

In a GitHub-backed test repository with `gh auth status` passing, create:

```json
{
  "host": {
    "provider": "github-gh",
    "login": ""
  }
}
```

Run:

```sh
patchmill doctor
patchmill triage --dry-run --limit 1
patchmill run-once --dry-run
```

Expected:

- `doctor` reports GitHub host pass or actionable label remediation.
- `triage --dry-run` lists and previews GitHub issues without mutations.
- `run-once --dry-run` selects one ready GitHub issue without mutations.

- [ ] **Step 6: Final commit if verification fixes were needed**

If any fixes were made during verification:

```sh
git add <fixed files>
git commit -m "fix(providers): stabilize github provider support"
```

If no fixes were needed, do not create an empty commit.
