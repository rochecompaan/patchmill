# Pi-subagents Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Patchmill's required agent-team preset integration with
explicit bundled pi-subagents support and documentation.

**Architecture:** Remove the agent-team resolver/config fields from run-once,
config loading, prompts, and Pi runner types. Render a new implementation-prompt
subagent support section that relies on pi-subagents-discovered agents and user
settings. Update docs to describe pi-subagents agent/chains configuration
instead of Patchmill agent-team presets.

**Tech Stack:** TypeScript, Node test runner, Patchmill CLI/config modules, Pi
prompt builders, Markdown docs, npm package dependency management.

---

## File structure

- Modify `package.json`: declare `pi-subagents` as a runtime dependency.
- Modify `src/config/types.ts`: remove `PatchmillPiConfig.team`.
- Modify `src/config/load.ts`: stop parsing/merging `pi.team`,
  `PATCHMILL_AGENT_TEAM`, and `--agent-team`.
- Modify `src/cli/commands/run-once/args.ts`: remove `agentTeamName`
  parsing/defaulting.
- Modify `src/cli/commands/run-once/main.ts`: remove `--agent-team` and
  `PATCHMILL_AGENT_TEAM` help text.
- Modify `src/cli/commands/run-once/types.ts`: remove `agentTeamName` and
  `agentTeam` from `AgentIssueConfig`.
- Delete `src/cli/commands/run-once/agent-team.ts` and
  `src/cli/commands/run-once/agent-team.test.ts`.
- Modify `src/cli/commands/run-once/pipeline.ts`: remove agent-team
  resolution/blocking and stop passing agent teams into implementation prompts.
- Modify `src/cli/commands/run-once/prompts.ts`: remove `ResolvedAgentTeam`,
  `dispatchModel()`, and `formatAgentTeam()`; add `formatSubagentSupport()`.
- Modify `src/pi/types.ts` and `src/pi/runner.ts`: remove implementation
  `agentTeam` input.
- Modify affected tests in `src/cli/commands/run-once/*.test.ts`,
  `src/config/load.test.ts`, and `src/pi/runner.test.ts`.
- Modify `README.md`, `docs/configuration.md`, `docs/issue-agent-workflows.md`,
  `docs/skills.md`, `docs/providers.md`, and `docs/task-contracts.md` to
  document pi-subagents and remove agent-team references.

## Task 1: Remove agent-team CLI/config surface

**Files:**

- Modify: `src/config/types.ts`
- Modify: `src/config/load.ts`
- Modify: `src/cli/commands/run-once/args.ts`
- Modify: `src/cli/commands/run-once/main.ts`
- Modify: `src/cli/commands/run-once/types.ts`
- Test: `src/config/load.test.ts`
- Test: `src/cli/commands/run-once/args.test.ts`

- [ ] **Step 1: Write failing config-loader tests for removed pi.team inputs**

In `src/config/load.test.ts`, replace the two env/CLI override tests around
existing lines 507-521 with tests that assert agent-team inputs no longer affect
loaded config and that the primary host-login behavior still works:

```ts
test("loadPatchmillConfig ignores removed agent-team env and config fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(
    join(dir, "patchmill.config.json"),
    JSON.stringify({
      host: { login: "file-login" },
      pi: { team: "file-team", triageThinking: "medium" },
    }),
  );
  const config = await loadPatchmillConfig(
    dir,
    { PATCHMILL_HOST_LOGIN: "env-login", PATCHMILL_AGENT_TEAM: "env-team" },
    [],
  );
  assert.equal(config.host.login, "env-login");
  assert.equal(config.pi.triageThinking, "medium");
  assert.equal("team" in config.pi, false);
});

test("loadPatchmillConfig applies host-login CLI overrides last", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  const config = await loadPatchmillConfig(
    dir,
    { PATCHMILL_HOST_LOGIN: "env-login", PATCHMILL_AGENT_TEAM: "env-team" },
    ["--host-login", "cli-login"],
  );
  assert.equal(config.host.login, "cli-login");
  assert.equal("team" in config.pi, false);
});
```

- [ ] **Step 2: Write failing run-once args tests for removed agent-team
      inputs**

In `src/cli/commands/run-once/args.test.ts`:

1. Delete `parseArgs accepts an explicit agent team`.
1. Replace `parseArgs uses PATCHMILL_AGENT_TEAM env value` with:

```ts
test("parseArgs ignores removed PATCHMILL_AGENT_TEAM env value", () => {
  const config = parseArgs(["--dry-run"], "/repo", {
    PATCHMILL_AGENT_TEAM: "patchmill-team",
  });

  assert.equal("agentTeamName" in config, false);
});
```

1. In `parseArgs ignores removed legacy agent team variable`, change the
   assertion to:

```ts
assert.equal("agentTeamName" in config, false);
```

1. In
   `loadCliConfig uses normalized Patchmill defaults when no config file exists`,
   change the assertion to:

```ts
assert.equal("agentTeamName" in config, false);
```

1. In `loadCliConfig applies normalized patchmill defaults for run-once`, remove
   `pi: { team: "config-team" }` from the test config JSON and change the
   assertion to:

```ts
assert.equal("agentTeamName" in config, false);
```

1. In
   `loadCliConfig lets run-once login and agent-team flags override patchmill config`,
   rename the test to
   `loadCliConfig lets run-once login flags override patchmill config`, remove
   the `--agent-team` arguments, and assert only `teaLogin`/host login behavior.

- [ ] **Step 3: Run targeted tests and verify they fail for the expected
      reason**

Run:

```bash
npm run test:run-once -- --test-name-pattern="parseArgs|loadCliConfig"
npm test -- src/config/load.test.ts --test-name-pattern="agent-team|host-login|PATCHMILL_AGENT_TEAM|pi.team"
```

Expected: failures mention existing `agentTeamName`, `pi.team`, `--agent-team`,
or `PATCHMILL_AGENT_TEAM` behavior.

- [ ] **Step 4: Remove `team` from config types**

In `src/config/types.ts`, change:

```ts
export type PatchmillPiConfig = {
  team?: string;
  triageThinking: string;
};
```

to:

```ts
export type PatchmillPiConfig = {
  triageThinking: string;
};
```

- [ ] **Step 5: Stop parsing pi.team, env, and CLI agent-team config**

In `src/config/load.ts`:

1. In the top-level `pi` parse block, replace the current body:

```ts
const parsed: Partial<PatchmillConfig["pi"]> = {};
const team = readOptionalString(pi, "team", "pi.team");
const triageThinking = readOptionalString(
  pi,
  "triageThinking",
  "pi.triageThinking",
);
if (team !== undefined) parsed.team = team;
if (triageThinking !== undefined) parsed.triageThinking = triageThinking;
if (hasEntries(parsed)) config.pi = parsed;
```

with:

```ts
const parsed: Partial<PatchmillConfig["pi"]> = {};
const triageThinking = readOptionalString(
  pi,
  "triageThinking",
  "pi.triageThinking",
);
if (triageThinking !== undefined) parsed.triageThinking = triageThinking;
if (hasEntries(parsed)) config.pi = parsed;
```

1. Replace `envConfig()` with:

```ts
function envConfig(env: Env): PartialConfig {
  return {
    host: env.PATCHMILL_HOST_LOGIN ? { login: env.PATCHMILL_HOST_LOGIN } : {},
  };
}
```

1. In `cliConfig()`, delete the entire
   `else if (args[index] === "--agent-team") { ... }` branch.

- [ ] **Step 6: Remove run-once args agent-team parsing**

In `src/cli/commands/run-once/args.ts`:

1. Delete the helper that reads `PATCHMILL_AGENT_TEAM` / normalized `pi.team`.
1. In the default config returned by `parseArgs`, remove
   `agentTeamName: defaultAgentTeam(env, normalizedConfig),`.
1. Delete this branch from the argument loop:

```ts
} else if (arg === "--agent-team") {
  config.agentTeamName = requireValue(args, index, arg);
  index += 1;
```

- [ ] **Step 7: Remove help text for agent-team**

In `src/cli/commands/run-once/main.ts`, delete these help lines:

```text
  --agent-team <name> Use the named Pi agent-team preset for worker/reviewer subagents.
```

and:

```text
  PATCHMILL_AGENT_TEAM               Override the default Pi agent-team preset.
```

- [ ] **Step 8: Remove agentTeam fields from run-once config type**

In `src/cli/commands/run-once/types.ts`:

1. Delete the import:

```ts
import type { ResolvedAgentTeam } from "./agent-team.ts";
```

1. Delete these `AgentIssueConfig` fields:

```ts
agentTeamName?: string;
agentTeam?: ResolvedAgentTeam;
```

- [ ] **Step 9: Run targeted tests and verify Task 1 passes**

Run:

```bash
npm run test:run-once -- --test-name-pattern="parseArgs|loadCliConfig"
npm test -- src/config/load.test.ts
```

Expected: all selected tests pass. If TypeScript test loading fails on removed
fields, fix only the compile errors directly related to Task 1.

- [ ] **Step 10: Commit Task 1**

```bash
git add src/config/types.ts src/config/load.ts src/config/load.test.ts src/cli/commands/run-once/args.ts src/cli/commands/run-once/args.test.ts src/cli/commands/run-once/main.ts src/cli/commands/run-once/types.ts
git commit -m "refactor(config): remove agent-team settings"
```

## Task 2: Replace implementation prompt agent-team section with pi-subagents support

**Files:**

- Modify: `src/cli/commands/run-once/prompts.ts`
- Test: `src/cli/commands/run-once/prompts.test.ts`

- [ ] **Step 1: Write failing prompt expectations for subagent support**

In `src/cli/commands/run-once/prompts.test.ts`:

1. Delete the top-level `agentTeam` constant.
1. Remove every `agentTeam,` property passed to `buildImplementationPrompt()`.
1. In the main implementation prompt test around existing lines 290-312, replace
   all agent-team assertions with:

```ts
assert.match(prompt, /Subagent support:/);
assert.match(prompt, /Patchmill bundles `pi-subagents`/);
assert.match(
  prompt,
  /Use the Pi `subagent` tool for delegated implementation and review workflows\./,
);
assert.match(
  prompt,
  /Use pi-subagents-discovered `worker` agents for implementation handoffs/,
);
assert.match(
  prompt,
  /Use pi-subagents-discovered `reviewer` agents for review checkpoints/,
);
assert.match(
  prompt,
  /Do not pass Patchmill-specific agent-team model overrides/,
);
assert.match(
  prompt,
  /If required subagents are unavailable or disabled, return the blocker JSON/,
);
assert.match(
  prompt,
  /Users control subagent models, thinking, tools, context mode, skills, and nesting behavior through pi-subagents configuration\./,
);
assert.doesNotMatch(prompt, /Authoritative agent team/);
assert.doesNotMatch(prompt, /dispatchModel/);
assert.doesNotMatch(prompt, /Example worker dispatch/);
```

1. Keep existing assertions for skills, validation, visual evidence, landing,
   and legacy project text.

- [ ] **Step 2: Run prompt tests and verify they fail**

Run:

```bash
npm run test:run-once -- --test-name-pattern="implementation prompt"
```

Expected: failures show `buildImplementationPrompt()` still requires `agentTeam`
and still renders `Authoritative agent team`.

- [ ] **Step 3: Remove agent-team prompt input and renderer**

In `src/cli/commands/run-once/prompts.ts`:

1. Delete this import:

```ts
import type { ResolvedAgentTeam } from "./agent-team.ts";
```

1. Delete `agentTeam: ResolvedAgentTeam;` from `ImplementationPromptInput`.
1. Delete `dispatchModel()`.
1. Delete `formatAgentTeam()`.
1. Add this function near `formatResumeContext()`:

```ts
function formatSubagentSupport(): string {
  return [
    "Subagent support:",
    "- Patchmill bundles `pi-subagents`; the implementation session can use the Pi `subagent` tool for delegated implementation and review workflows.",
    "- Use pi-subagents-discovered `worker` agents for implementation handoffs and `reviewer` agents for review checkpoints unless the configured implementation skill directs a different pi-subagents workflow.",
    "- Use the user's pi-subagents agent definitions, chains, settings, and builtin defaults for model, thinking, tools, context mode, skills, and output behavior.",
    "- Do not pass Patchmill-specific agent-team model overrides; Patchmill no longer resolves or requires agent-team presets.",
    "- If required subagents are unavailable or disabled, return the blocker JSON with actionable setup guidance instead of inventing a local replacement workflow.",
    "- Users control subagent models, thinking, tools, context mode, skills, and nesting behavior through pi-subagents configuration.",
  ].join("\n");
}
```

- [ ] **Step 4: Render subagent support in implementation prompt**

In `buildImplementationPrompt()` destructuring, remove `agentTeam`:

```ts
const { issue, planPath, branch, worktreePath, git, projectPolicy, resume } =
  input;
```

Then replace:

```ts
${formatAgentTeam(agentTeam)}
```

with:

```ts
${formatSubagentSupport()}
```

- [ ] **Step 5: Run prompt tests and verify Task 2 passes**

Run:

```bash
npm run test:run-once -- --test-name-pattern="implementation prompt|legacy project text|skill"
```

Expected: selected prompt tests pass and no prompt contains
`Authoritative agent team`.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/cli/commands/run-once/prompts.ts src/cli/commands/run-once/prompts.test.ts
git commit -m "refactor(run-once): render pi-subagents support"
```

## Task 3: Remove pipeline and Pi runner agent-team dependencies

**Files:**

- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/pi/types.ts`
- Modify: `src/pi/runner.ts`
- Delete: `src/cli/commands/run-once/agent-team.ts`
- Delete: `src/cli/commands/run-once/agent-team.test.ts`
- Test: `src/cli/commands/run-once/pipeline.test.ts`
- Test: `src/pi/runner.test.ts`

- [ ] **Step 1: Update pipeline tests to prove implementation no longer blocks
      without an agent team**

In `src/cli/commands/run-once/pipeline.test.ts`:

1. Delete the top-level `AGENT_TEAM` constant.
1. In `makeConfig()`, remove `agentTeam: AGENT_TEAM,`.
1. Remove every override object property named `agentTeam` or `agentTeamName`.
1. Replace the test named
   `runOneIssue blocks implementation before Pi when no agent team is configured`
   with a test named `runOneIssue starts implementation without an agent team`.
1. In the replacement test, keep the existing selected issue and existing plan
   setup, but update the mock runner to allow worktree creation and Pi
   execution. Use this response for the implementation Pi call:

```ts
if (call.command === "pi") {
  return {
    code: 0,
    stdout: JSON.stringify({
      status: "pr-created",
      prUrl: "https://forgejo.example/repo/pulls/14",
      branch: "agent/issue-14-needs-explicit-team",
      commits: ["abc1234"],
      validation: ["npm test: pass"],
      reviewSummary: "Reviewed with pi-subagents reviewer.",
      landingDecision: "PR fallback.",
    }),
    stderr: "",
  };
}
```

1. Assert:

```ts
assert.equal(result.status, "pr-created");
assert.equal(
  runner.calls.some((call) => call.command === "pi"),
  true,
);
```

Use nearby successful implementation tests as the source for required
`git worktree`, `git checkout`, `git status`, `git log`, `tea pulls create`,
`tea issues`, and label mock responses. Do not keep any assertion about
`Agent team is required`.

- [ ] **Step 2: Update Pi runner tests to remove agentTeam input**

In `src/pi/runner.test.ts`:

1. Delete this import:

```ts
import type { ResolvedAgentTeam } from "../cli/commands/run-once/agent-team.ts";
```

1. Delete the `agentTeam` constant.
1. Remove `agentTeam,` from every `ImplementationPiInput` object.
1. Add an assertion in the implementation prompt test that the prompt includes
   `Subagent support:` and does not include `Authoritative agent team`.

- [ ] **Step 3: Run tests and verify failures identify production dependencies**

Run:

```bash
npm run test:run-once -- --test-name-pattern="agent team|implementation without|resolves a named agent team"
npm test -- src/pi/runner.test.ts
```

Expected: compile or assertion failures point to `pipeline.ts`, `PiRunner`, and
`ImplementationPiInput` still requiring agent teams.

- [ ] **Step 4: Remove pipeline agent-team resolution**

In `src/cli/commands/run-once/pipeline.ts`:

1. Delete these imports:

```ts
import { resolveAgentTeam } from "./agent-team.ts";
import type { ResolvedAgentTeam } from "./agent-team.ts";
```

1. Delete `agentTeamQuestion()`.
1. Delete `implementationAgentTeam()`.
1. Delete `let agentTeam: ResolvedAgentTeam | undefined;` and the block that
   calls `implementationAgentTeam(config)` before worktree setup.
1. In the object passed to the implementation Pi runner or
   `buildImplementationPrompt()`, delete `agentTeam,`.
1. Delete any now-unused `errorMessage` use only if TypeScript reports it
   unused; keep it if other error paths use it.

- [ ] **Step 5: Remove Pi runner agentTeam input**

In `src/pi/types.ts`:

1. Delete:

```ts
import type { ResolvedAgentTeam } from "../cli/commands/run-once/agent-team.ts";
```

1. Delete this field from `ImplementationPiInput`:

```ts
agentTeam: ResolvedAgentTeam;
```

In `src/pi/runner.ts`, delete this property from the
`buildImplementationPrompt()` input:

```ts
agentTeam: input.agentTeam,
```

- [ ] **Step 6: Delete agent-team resolver files**

Run:

```bash
rm src/cli/commands/run-once/agent-team.ts src/cli/commands/run-once/agent-team.test.ts
```

- [ ] **Step 7: Remove or rewrite named-agent-team pipeline test**

In `src/cli/commands/run-once/pipeline.test.ts`, delete the test named
`runOneIssue resolves a named agent team when using an existing plan` or rewrite
it to assert normal existing-plan implementation without any `.pi/agent-teams`
file. If rewritten, name it
`runOneIssue uses an existing plan without agent-team lookup` and assert the
implementation prompt contains `Subagent support:`.

- [ ] **Step 8: Run run-once and Pi runner tests**

Run:

```bash
npm run test:run-once
npm test -- src/pi/runner.test.ts
```

Expected: all selected tests pass. No TypeScript import should reference
`agent-team.ts`.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts src/pi/types.ts src/pi/runner.ts src/pi/runner.test.ts src/cli/commands/run-once/agent-team.ts src/cli/commands/run-once/agent-team.test.ts
git commit -m "refactor(run-once): drop agent-team resolver"
```

## Task 4: Declare pi-subagents dependency

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json` if npm creates or updates it

- [ ] **Step 1: Check current package manager state**

Run:

```bash
ls package-lock.json npm-shrinkwrap.json pnpm-lock.yaml yarn.lock 2>/dev/null || true
npm view pi-subagents version
```

Expected: identify the lockfile in use and the available `pi-subagents` version.

- [ ] **Step 2: Add pi-subagents dependency**

Run:

```bash
npm install pi-subagents --save
```

Expected: `package.json` gains a `dependencies` object containing
`pi-subagents`; the npm lockfile is updated if present.

- [ ] **Step 3: Verify dependency declaration**

Run:

```bash
node -e "const p=require('./package.json'); if(!p.dependencies?.['pi-subagents']) process.exit(1); console.log(p.dependencies['pi-subagents'])"
```

Expected: prints the installed `pi-subagents` version range.

- [ ] **Step 4: Commit Task 4**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add pi-subagents"
```

If there is no `package-lock.json`, omit it from `git add`.

## Task 5: Update user documentation for pi-subagents support

**Files:**

- Modify: `README.md`
- Modify: `docs/configuration.md`
- Modify: `docs/issue-agent-workflows.md`
- Modify: `docs/skills.md`
- Modify: `docs/providers.md`
- Modify: `docs/task-contracts.md`

- [ ] **Step 1: Write docs changes in README**

In `README.md`:

1. Remove `pi.team` from the starter config JSON.
1. Replace the sentence `For full implementation runs, also set ...` with:

```md
Patchmill bundles `pi-subagents` for implementation delegation. The default
implementation skill, `superpowers:subagent-driven-development`, can use
pi-subagents builtin agents such as `worker`, `reviewer`, `scout`, `planner`,
`context-builder`, `researcher`, `delegate`, and `oracle`. Customize those
agents with normal pi-subagents user or project configuration when your
repository needs different models, tools, context behavior, or nested
delegation.
```

1. Remove the `PATCHMILL_AGENT_TEAM` bullet from the environment variables list.
1. Add a `## Subagents` section before `## State paths`:

````md
## Subagents

Patchmill includes `pi-subagents`; users do not install it separately.
Implementation prompts can rely on the Pi `subagent` tool and the agents
discovered by pi-subagents.

Agent files can live in:

- `~/.pi/agent/agents/**/*.md` for user-scope agents
- `.pi/agents/**/*.md` for project-scope agents

Chain files can live in:

- `~/.pi/agent/chains/**/*.chain.md`
- `.pi/chains/**/*.chain.md`

Settings overrides can live in `~/.pi/agent/settings.json` or
`.pi/settings.json`. For example:

```json
{
  "subagents": {
    "agentOverrides": {
      "reviewer": {
        "model": "anthropic/claude-sonnet-4",
        "thinking": "high"
      }
    }
  }
}
```

A minimal project agent file looks like:

```md
---
name: worker
description: Project-specific implementation worker
model: anthropic/claude-sonnet-4
thinking: high
tools: read, grep, find, ls, bash, edit, write
systemPromptMode: append
inheritProjectContext: true
inheritSkills: true
---

Follow this repository's implementation conventions. Escalate unclear product or
architecture decisions instead of guessing.
```

If you want a child agent to delegate further, include the `subagent` tool in
that agent's tools and configure nesting/depth through pi-subagents settings.
Patchmill does not override those user choices.
````

- [ ] **Step 2: Update configuration docs**

In `docs/configuration.md`:

1. Remove `"team": "my-agent-team"` from the complete example.
1. Remove text telling users to replace `my-agent-team`.
1. Remove `PATCHMILL_AGENT_TEAM` from environment-only settings.
1. Add a subsection under `## Skills` named `### Subagents` that says Patchmill
   bundles pi-subagents, `skills.implementation` defaults to
   `superpowers:subagent-driven-development`, and agent customization uses
   `.pi/agents`, `.pi/chains`, and `.pi/settings.json` rather than Patchmill
   config.

- [ ] **Step 3: Update workflow docs**

In `docs/issue-agent-workflows.md`:

1. In the source files list, replace
   `Agent-team resolver: src/cli/commands/run-once/agent-team.ts` with
   `Subagent support: bundled pi-subagents and implementation prompt guidance`.
1. In the flow diagram, replace `Resolve required worker/reviewer agent team`
   and the missing/invalid branch with `Render pi-subagents support guidance`.
1. In the implementation prompt bullet list, replace
   `authoritative agent-team mappings for worker and reviewer roles` with
   `pi-subagents support guidance for delegated implementation and review workflows`.
1. Delete the old agent-team text block.
1. Add a new paragraph that mirrors the new prompt section and lists the
   user/project agent, chain, and settings paths.

- [ ] **Step 4: Update remaining docs**

1. In `docs/skills.md`, add a short paragraph under the implementation skill
   description:

```md
Subagent workflows run through bundled `pi-subagents`. Patchmill does not define
models or tools for `worker` and `reviewer`; pi-subagents builtin agents, user
overrides, and project agent files control that behavior.
```

1. In `docs/providers.md`, remove the `PATCHMILL_AGENT_TEAM` bullet.
1. In `docs/task-contracts.md`, replace the sentence mentioning
   `PATCHMILL_AGENT_TEAM` with:

```md
Implementation subagent behavior is controlled by bundled `pi-subagents` and the
user's pi-subagents agent/settings configuration.
```

- [ ] **Step 5: Search docs for stale active references**

Run:

```bash
rg -n "--agent-team|PATCHMILL_AGENT_TEAM|pi\.team|\.pi/agent-teams|agent-team preset|Authoritative agent team" README.md docs src package.json --glob '!docs/plans/**' --glob '!docs/specs/**'
```

Expected: no matches in active code or current user docs. Historical matches
inside `docs/specs/*` or `docs/plans/*` are acceptable because they record prior
decisions and implementation history.

- [ ] **Step 6: Run docs formatting/linting**

Run:

```bash
npm run lint:md
```

Expected: markdown lint passes.

- [ ] **Step 7: Commit Task 5**

```bash
git add README.md docs/configuration.md docs/issue-agent-workflows.md docs/skills.md docs/providers.md docs/task-contracts.md
git commit -m "docs: document pi-subagents configuration"
```

## Task 6: Final cleanup and verification

**Files:**

- Potentially modify any file found by searches or failing tests.

- [ ] **Step 1: Search source for removed symbols**

Run:

```bash
rg -n "agentTeam|agentTeamName|ResolvedAgentTeam|resolveAgentTeam|agent-team|PATCHMILL_AGENT_TEAM|--agent-team|pi\.team|\.pi/agent-teams|Authoritative agent team|dispatchModel" src test-support bin README.md docs package.json --glob '!docs/plans/**' --glob '!docs/specs/**'
```

Expected: no matches in active source or current user docs. Historical matches
inside `docs/specs/*` or `docs/plans/*` are acceptable because they record prior
decisions and implementation history.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run full lint**

Run:

```bash
npm run lint
```

Expected: formatting, TypeScript lint, and markdown lint pass.

- [ ] **Step 4: Inspect git diff for scope**

Run:

```bash
git status --short
git diff --stat HEAD
git diff -- src/cli/commands/run-once/prompts.ts docs/issue-agent-workflows.md README.md
```

Expected: diff only contains the approved pi-subagents support cleanup,
dependency addition, and docs updates.

- [ ] **Step 5: Commit final cleanup if needed**

If Step 1-4 required extra fixes, commit them:

```bash
git add <changed-files>
git commit -m "chore: finish pi-subagents cleanup"
```

If there are no extra fixes, do not create an empty commit.

- [ ] **Step 6: Summarize completion**

Report:

- commits created;
- tests and lint commands run;
- any remaining historical references left in old specs/plans, if applicable.
