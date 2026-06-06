# Setup Test Repo Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `patchmill setup-test-repo` to create or reset a disposable Team
Lunch Poll repository on GitHub or Forgejo/Gitea and seed it with reusable demo
files, labels, and issues.

**Architecture:** Keep provider-specific `gh` and `tea` commands in the existing
host provider modules. Keep Team Lunch Poll fixture parsing, copying, and setup
orchestration in `src/cli/commands/setup-test-repo`. Use small modules for args,
fixture discovery, issue parsing, labels, and command orchestration so no setup
file becomes a provider integration duplicate.

**Tech Stack:** TypeScript, Node.js built-in test runner, `gh`, `tea`, `git`,
npm package `files` allowlist.

---

## Source spec

Implement against `docs/specs/2026-06-05-patchmill-test-repo-design.md` in this
worktree.

## File map

- Create: `fixtures/patchmill-test-repo/README.md`
  - Human-facing README copied into every disposable demo repository.
- Create: `fixtures/patchmill-test-repo/PROJECT_BRIEF.md`
  - Reusable Team Lunch Poll product brief copied into every demo repository.
- Create: `fixtures/patchmill-test-repo/issues/*.md`
  - Twelve reusable issue prompts with simple frontmatter.
- Modify: `package.json`
  - Add `fixtures` to the npm package `files` allowlist.
- Modify: `src/host/types.ts`
  - Add generic repository target, issue creation, and repository lifecycle
    provider types.
- Modify: `src/host/factory.ts`
  - Add `createGitHostProvider()` returning the expanded generic provider type.
  - Keep `createIssueHostProvider()` for existing callers.
- Modify: `src/host/factory.test.ts`
  - Assert factory-created providers expose generic lifecycle methods.
- Modify: `src/host/github-gh.ts`
  - Add generic repository lifecycle and issue creation methods to
    `GitHubGhHostProvider`.
- Modify: `src/host/github-gh.test.ts`
  - Cover GitHub lifecycle, URL, clone command, and issue creation commands.
- Create: `src/host/forgejo-tea-context.ts`
  - Generic Forgejo/Gitea `tea` repo/login argument helper shared by the
    existing triage functions and the provider class.
- Create: `src/host/forgejo-tea-context.test.ts`
  - Cover `--repo` and `--login` placement, including commands with `--`.
- Modify: `src/cli/commands/triage/forgejo.ts`
  - Import the shared `withTeaContext()` helper instead of owning duplicate
    context logic.
- Modify: `src/host/forgejo-tea.ts`
  - Add generic repository lifecycle and issue creation methods to
    `ForgejoTeaHostProvider`.
- Modify: `src/host/forgejo-tea.test.ts`
  - Cover Forgejo/Gitea lifecycle, URL lookup, clone command, login propagation,
    and issue creation commands.
- Create: `src/cli/commands/setup-test-repo/args.ts`
  - Parse `--provider`, `--repo OWNER/REPO`, `--login`, `--reset`, and help.
- Create: `src/cli/commands/setup-test-repo/args.test.ts`
  - Cover required args, malformed args, provider values, login, reset, and
    help.
- Create: `src/cli/commands/setup-test-repo/issue-parser.ts`
  - Parse issue markdown frontmatter without adding a YAML dependency.
- Create: `src/cli/commands/setup-test-repo/issue-parser.test.ts`
  - Cover valid issues, missing titles, missing labels, invalid labels, and body
    extraction.
- Create: `src/cli/commands/setup-test-repo/fixtures.ts`
  - Resolve package root, validate fixture layout, load issue files, and copy
    fixture files to a temporary repository.
- Create: `src/cli/commands/setup-test-repo/fixtures.test.ts`
  - Cover package-root resolution, missing files, sorted issue loading, and copy
    behavior.
- Create: `src/cli/commands/setup-test-repo/labels.ts`
  - Hold setup-specific label definitions for `feature`, `bug`, `docs`, and
    `polish`.
- Create: `src/cli/commands/setup-test-repo/main.ts`
  - Orchestrate validation, reset/create, fixture copy, git push, label
    creation, issue creation, and final instructions.
- Create: `src/cli/commands/setup-test-repo/main.test.ts`
  - Cover create-only, existing-without-reset, reset, provider failures, git
    failures, and final output with mocked providers and runner.
- Create: `src/cli/commands/setup-test-repo/host-boundary.test.ts`
  - Enforce that the setup command does not run `gh` or `tea` directly.
- Modify: `src/cli/main.ts`
  - Register the public `setup-test-repo` command and top-level help entry.
- Modify: `src/cli/main.test.ts`
  - Assert command resolution, help text, and dispatch for `setup-test-repo`.
- Modify: `README.md`
  - Promote the disposable setup command near the first-use workflow.
- Create: `docs/setup-test-repo.md`
  - Add detailed usage, reset, provider, fixture location, and manual testing
    documentation.

## Task 1: Add the reusable Team Lunch Poll fixture

**Files:**

- Create: `fixtures/patchmill-test-repo/README.md`
- Create: `fixtures/patchmill-test-repo/PROJECT_BRIEF.md`
- Create: `fixtures/patchmill-test-repo/issues/01-project-scaffold.md`
- Create: `fixtures/patchmill-test-repo/issues/02-domain-model.md`
- Create: `fixtures/patchmill-test-repo/issues/03-create-poll-form.md`
- Create: `fixtures/patchmill-test-repo/issues/04-voting-flow.md`
- Create: `fixtures/patchmill-test-repo/issues/05-results-view.md`
- Create: `fixtures/patchmill-test-repo/issues/06-local-persistence.md`
- Create: `fixtures/patchmill-test-repo/issues/07-validation-empty-states.md`
- Create: `fixtures/patchmill-test-repo/issues/08-responsive-polish.md`
- Create: `fixtures/patchmill-test-repo/issues/09-automated-tests.md`
- Create: `fixtures/patchmill-test-repo/issues/10-readme-docs.md`
- Create: `fixtures/patchmill-test-repo/issues/11-make-it-social.md`
- Create: `fixtures/patchmill-test-repo/issues/12-votes-disappear.md`
- Modify: `package.json`

- [ ] **Step 1: Add the fixture README**

Create `fixtures/patchmill-test-repo/README.md` with this content.

````markdown
# Team Lunch Poll

Team Lunch Poll is a small greenfield demo app for trying Patchmill on a safe,
disposable repository.

The app should let a team create a lunch poll, add meal or restaurant options,
vote on those options, and see the current winner. The repository intentionally
starts with documentation and issue prompts only. Patchmill agents should build
the application from the seeded issues.

## Demo workflow

After this repository is seeded, try Patchmill manually:

```bash
patchmill init
patchmill triage --dry-run
patchmill triage
```

## Source of truth

This repository is disposable. The reusable project brief and issue prompts live
in the Patchmill package under `fixtures/patchmill-test-repo/`.
````

- [ ] **Step 2: Add the project brief**

Create `fixtures/patchmill-test-repo/PROJECT_BRIEF.md` with this content.

```markdown
# Team Lunch Poll Project Brief

Team Lunch Poll is a lightweight web app for teams that need to decide where or
what to eat together.

## Product goals

- Create a poll with a lunch question and a short list of options.
- Let teammates vote for one option.
- Show results clearly enough for the team to pick a winner.
- Keep the first version simple, local, and easy to run.

## Suggested implementation shape

A good first implementation can be a small TypeScript web app using local state
and browser storage. A full backend, authentication system, and deployment setup
are outside the first demo scope unless an issue explicitly asks for them.

## User experience principles

- The app should feel friendly and low-friction.
- Empty states should explain what to do next.
- Validation messages should help the user fix input quickly.
- The interface should work on desktop and mobile screens.
```

- [ ] **Step 3: Add the twelve issue files**

Create the issue files with the exact frontmatter titles and labels shown here.
The bodies can use the paragraphs below verbatim.

`fixtures/patchmill-test-repo/issues/01-project-scaffold.md`

```markdown
---
title: Create the Team Lunch Poll app scaffold
labels: [feature]
---

Set up the initial Team Lunch Poll web app so contributors have a working place
to build from.

Please include a minimal app shell with a heading, a short description of the
product, and a placeholder area where poll creation and results will appear.
Choose a simple TypeScript-friendly setup and document the commands needed to
install dependencies, run the app locally, and run checks.
```

`fixtures/patchmill-test-repo/issues/02-domain-model.md`

```markdown
---
title: Define the poll, option, and vote data model
labels: [feature]
---

Define the core data structures for Team Lunch Poll.

The app needs a poll with a question, a collection of lunch options, and votes
that can be counted per option. Keep the model small enough for local browser
state, but make the names clear so future issues can build forms, voting, and
results on top of it.
```

`fixtures/patchmill-test-repo/issues/03-create-poll-form.md`

```markdown
---
title: Build the create-poll form
labels: [feature]
---

Add a form that lets someone create a lunch poll.

The form should collect a poll question and at least two options. A user should
be able to add another option before saving the poll. After saving, the app
should show the poll instead of the empty placeholder.
```

`fixtures/patchmill-test-repo/issues/04-voting-flow.md`

```markdown
---
title: Add the option voting flow
labels: [feature]
---

Let a teammate vote for one lunch option in the current poll.

Each option should have an obvious vote action. After a vote is cast, the UI
should make it clear which option received the vote and prevent accidental
double-voting in the same browser session.
```

`fixtures/patchmill-test-repo/issues/05-results-view.md`

```markdown
---
title: Show live results and winner state
labels: [feature]
---

Display vote totals for the current poll.

The results view should update after each vote, show counts for every option,
and highlight the current winner. If there is a tie, show that the poll is tied
instead of pretending there is a single winner.
```

`fixtures/patchmill-test-repo/issues/06-local-persistence.md`

```markdown
---
title: Persist polls locally
labels: [feature]
---

Persist the current poll and votes in browser storage so a refresh does not wipe
out the demo.

Use a simple local persistence approach. The app should load saved poll data on
startup and provide a clear way to reset the current poll when someone wants to
start over.
```

`fixtures/patchmill-test-repo/issues/07-validation-empty-states.md`

```markdown
---
title: Add validation, empty states, and error states
labels: [feature]
---

Make the app resilient when users enter incomplete poll information.

The create-poll form should explain what is missing when the question is blank,
when an option is blank, or when fewer than two usable options are provided. The
empty state should guide a new user toward creating their first lunch poll.
```

`fixtures/patchmill-test-repo/issues/08-responsive-polish.md`

```markdown
---
title: Improve responsive visual polish
labels: [polish]
---

Give Team Lunch Poll a friendly responsive layout.

The app should be comfortable to use on a phone and on a laptop. Improve
spacing, typography, button states, and result presentation without adding a
large design system or unrelated UI features.
```

`fixtures/patchmill-test-repo/issues/09-automated-tests.md`

```markdown
---
title: Add automated tests for core poll flows
labels: [feature]
---

Add automated tests for the most important Team Lunch Poll behavior.

Cover creating a poll, voting for an option, showing results, and preserving the
poll through the chosen local persistence layer. Keep the test setup easy for a
new contributor to run.
```

`fixtures/patchmill-test-repo/issues/10-readme-docs.md`

```markdown
---
title: Document setup and usage
labels: [docs]
---

Improve the repository README for people trying the Team Lunch Poll demo.

Document the project purpose, local setup commands, test commands, and a short
walkthrough of creating a poll and voting. Include notes about the current local
persistence behavior so users know where their demo data lives.
```

`fixtures/patchmill-test-repo/issues/11-make-it-social.md`

```markdown
---
title: Make lunch polls more social
---

The poll should feel more social and fun for a team.

Maybe people should be able to react to options, add comments, invite teammates,
or see who voted. I am not sure which of these matters most for the first
version. Please figure out a good direction.
```

`fixtures/patchmill-test-repo/issues/12-votes-disappear.md`

```markdown
---
title: Votes sometimes disappear when I refresh
---

I heard that votes can disappear after refreshing the page.

There is not much detail yet. Please look into what could cause vote data to be
lost and propose or make the smallest useful fix for the demo app.
```

- [ ] **Step 4: Add fixtures to the package allowlist**

In `package.json`, add `"fixtures"` to the top-level `files` array immediately
after `"dist"`.

```json
"files": [
  "bin",
  "src",
  "dist",
  "fixtures",
  "docs",
  "skills",
  "extensions",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "tsconfig.build.json"
]
```

- [ ] **Step 5: Verify fixture shape without adding a text-only test**

Run:

```bash
find fixtures/patchmill-test-repo -type f | sort
node -e "const p=require('./package.json'); if(!p.files.includes('fixtures')) process.exit(1); console.log('fixtures packaged')"
```

Expected: the `find` output lists `README.md`, `PROJECT_BRIEF.md`, and exactly
12 files under `issues/`; the Node command prints `fixtures packaged`.

- [ ] **Step 6: Commit**

```bash
git add package.json fixtures/patchmill-test-repo
git commit -m "feat: add setup test repo fixtures"
```

## Task 2: Add issue parsing and fixture loading

**Files:**

- Create: `src/cli/commands/setup-test-repo/issue-parser.ts`
- Create: `src/cli/commands/setup-test-repo/issue-parser.test.ts`
- Create: `src/cli/commands/setup-test-repo/fixtures.ts`
- Create: `src/cli/commands/setup-test-repo/fixtures.test.ts`

- [ ] **Step 1: Write failing issue parser tests**

Create `src/cli/commands/setup-test-repo/issue-parser.test.ts`.

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseIssueFile } from "./issue-parser.ts";

test("parseIssueFile parses title, labels, and body", () => {
  const issue = parseIssueFile(
    "01-example.md",
    [
      "---",
      "title: Build the form",
      "labels: [feature, polish]",
      "---",
      "",
      "Create a useful form.",
    ].join("\n"),
  );

  assert.deepEqual(issue, {
    fileName: "01-example.md",
    title: "Build the form",
    labels: ["feature", "polish"],
    body: "Create a useful form.\n",
  });
});

test("parseIssueFile allows missing labels", () => {
  const issue = parseIssueFile(
    "11-vague.md",
    ["---", "title: Make it social", "---", "", "Needs discovery."].join("\n"),
  );

  assert.deepEqual(issue.labels, []);
  assert.equal(issue.body, "Needs discovery.\n");
});

test("parseIssueFile rejects missing title", () => {
  assert.throws(
    () => parseIssueFile("bad.md", "---\nlabels: [feature]\n---\nBody"),
    /bad\.md is missing required frontmatter field: title/,
  );
});

test("parseIssueFile rejects invalid label syntax", () => {
  assert.throws(
    () =>
      parseIssueFile("bad.md", "---\ntitle: Bad\nlabels: feature\n---\nBody"),
    /bad\.md labels must use \[label, other-label\] syntax/,
  );
});

test("parseIssueFile rejects empty labels", () => {
  assert.throws(
    () =>
      parseIssueFile(
        "bad.md",
        "---\ntitle: Bad\nlabels: [feature, ]\n---\nBody",
      ),
    /bad\.md labels include an empty value/,
  );
});
```

Run: `node --test src/cli/commands/setup-test-repo/issue-parser.test.ts`

Expected: FAIL because `issue-parser.ts` does not exist.

- [ ] **Step 2: Implement the issue parser**

Create `src/cli/commands/setup-test-repo/issue-parser.ts`.

```ts
export type SetupIssue = {
  fileName: string;
  title: string;
  labels: string[];
  body: string;
};

function frontmatterValue(
  fields: Map<string, string>,
  name: string,
): string | undefined {
  const value = fields.get(name);
  return value === undefined ? undefined : value.trim();
}

function parseLabels(fileName: string, value: string | undefined): string[] {
  if (value === undefined) return [];
  const match = /^\[(.*)\]$/u.exec(value.trim());
  if (!match) {
    throw new Error(`${fileName} labels must use [label, other-label] syntax`);
  }

  if (match[1].trim().length === 0) return [];
  const labels = match[1].split(",").map((label) => label.trim());
  if (labels.some((label) => label.length === 0)) {
    throw new Error(`${fileName} labels include an empty value`);
  }
  return labels;
}

function parseFrontmatter(fileName: string, raw: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of raw.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/u.exec(line);
    if (!match) throw new Error(`${fileName} has invalid frontmatter: ${line}`);
    fields.set(match[1], match[2]);
  }
  return fields;
}

export function parseIssueFile(fileName: string, content: string): SetupIssue {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(content);
  if (!match) throw new Error(`${fileName} is missing frontmatter`);

  const fields = parseFrontmatter(fileName, match[1]);
  const title = frontmatterValue(fields, "title");
  if (!title) {
    throw new Error(`${fileName} is missing required frontmatter field: title`);
  }

  return {
    fileName,
    title,
    labels: parseLabels(fileName, frontmatterValue(fields, "labels")),
    body: match[2].replace(/\s*$/u, "") + "\n",
  };
}
```

Run: `node --test src/cli/commands/setup-test-repo/issue-parser.test.ts`

Expected: PASS.

- [ ] **Step 3: Write failing fixture tests**

Create `src/cli/commands/setup-test-repo/fixtures.test.ts`.

```ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  copyFixtureToRepository,
  loadSetupIssues,
  resolveFixtureDirectory,
  validateFixtureDirectory,
} from "./fixtures.ts";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-fixture-test-"));
}

test("resolveFixtureDirectory finds fixtures from the package root", async () => {
  const fixtureDir = await resolveFixtureDirectory(process.cwd());
  assert.match(fixtureDir, /fixtures\/patchmill-test-repo$/u);
});

test("validateFixtureDirectory rejects missing project brief", async () => {
  const root = await tempDir();
  await mkdir(join(root, "issues"), { recursive: true });
  await writeFile(join(root, "README.md"), "# Demo\n");

  await assert.rejects(
    () => validateFixtureDirectory(root),
    /missing PROJECT_BRIEF\.md/,
  );

  await rm(root, { recursive: true, force: true });
});

test("loadSetupIssues reads fixture issues in filename order", async () => {
  const fixtureDir = await resolveFixtureDirectory(process.cwd());
  const issues = await loadSetupIssues(fixtureDir);

  assert.equal(issues.length, 12);
  assert.equal(issues[0]?.fileName, "01-project-scaffold.md");
  assert.equal(issues[11]?.fileName, "12-votes-disappear.md");
});

test("copyFixtureToRepository copies docs and issue prompts", async () => {
  const fixtureDir = await resolveFixtureDirectory(process.cwd());
  const destination = await tempDir();

  await copyFixtureToRepository(fixtureDir, destination);

  assert.match(
    await readFile(join(destination, "README.md"), "utf8"),
    /Team Lunch Poll/u,
  );
  assert.match(
    await readFile(join(destination, "PROJECT_BRIEF.md"), "utf8"),
    /Product goals/u,
  );
  assert.match(
    await readFile(
      join(destination, "issues", "01-project-scaffold.md"),
      "utf8",
    ),
    /Create the Team Lunch Poll app scaffold/u,
  );

  await rm(destination, { recursive: true, force: true });
});
```

Run: `node --test src/cli/commands/setup-test-repo/fixtures.test.ts`

Expected: FAIL because `fixtures.ts` does not exist.

- [ ] **Step 4: Implement fixture resolution, validation, loading, and copy**

Create `src/cli/commands/setup-test-repo/fixtures.ts`.

```ts
import { constants } from "node:fs";
import { access, cp, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseIssueFile, type SetupIssue } from "./issue-parser.ts";

const FIXTURE_RELATIVE_PATH = join("fixtures", "patchmill-test-repo");

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findPackageRoot(startDir: string): Promise<string> {
  let current = resolve(startDir);
  for (;;) {
    if (await exists(join(current, "package.json"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error("Could not find package root");
    current = parent;
  }
}

export async function resolveFixtureDirectory(
  startDir = dirname(fileURLToPath(import.meta.url)),
): Promise<string> {
  const packageRoot = await findPackageRoot(startDir);
  return join(packageRoot, FIXTURE_RELATIVE_PATH);
}

export async function validateFixtureDirectory(
  fixtureDir: string,
): Promise<void> {
  const required = ["README.md", "PROJECT_BRIEF.md", "issues"];
  for (const entry of required) {
    if (!(await exists(join(fixtureDir, entry)))) {
      throw new Error(`Fixture directory is missing ${entry}`);
    }
  }
}

export async function loadSetupIssues(
  fixtureDir: string,
): Promise<SetupIssue[]> {
  await validateFixtureDirectory(fixtureDir);
  const issueDir = join(fixtureDir, "issues");
  const files = (await readdir(issueDir))
    .filter((file) => file.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b));

  return Promise.all(
    files.map(async (file) =>
      parseIssueFile(file, await readFile(join(issueDir, file), "utf8")),
    ),
  );
}

export async function copyFixtureToRepository(
  fixtureDir: string,
  destination: string,
): Promise<void> {
  await validateFixtureDirectory(fixtureDir);
  await cp(join(fixtureDir, "README.md"), join(destination, "README.md"));
  await cp(
    join(fixtureDir, "PROJECT_BRIEF.md"),
    join(destination, "PROJECT_BRIEF.md"),
  );
  await cp(join(fixtureDir, "issues"), join(destination, "issues"), {
    recursive: true,
  });
}
```

Run:

```bash
node --test src/cli/commands/setup-test-repo/issue-parser.test.ts src/cli/commands/setup-test-repo/fixtures.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/setup-test-repo/issue-parser.ts src/cli/commands/setup-test-repo/issue-parser.test.ts src/cli/commands/setup-test-repo/fixtures.ts src/cli/commands/setup-test-repo/fixtures.test.ts
git commit -m "feat: load setup test repo fixtures"
```

## Task 3: Add setup-test-repo argument parsing

**Files:**

- Modify: `src/host/types.ts`
- Create: `src/cli/commands/setup-test-repo/args.ts`
- Create: `src/cli/commands/setup-test-repo/args.test.ts`

- [ ] **Step 1: Add the shared repository target type**

Add this type to `src/host/types.ts` after `LabelDefinition`.

```ts
export type RepositoryTarget = {
  owner: string;
  repo: string;
  slug: string;
};
```

- [ ] **Step 2: Write failing parser tests**

Create `src/cli/commands/setup-test-repo/args.test.ts`.

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "./args.ts";

test("parseArgs requires provider", () => {
  assert.throws(
    () => parseArgs(["--repo", "OWNER/REPO"]),
    /--provider is required/,
  );
});

test("parseArgs requires repo", () => {
  assert.throws(
    () => parseArgs(["--provider", "github-gh"]),
    /--repo OWNER\/REPO is required/,
  );
});

test("parseArgs rejects unsupported providers", () => {
  assert.throws(
    () => parseArgs(["--provider", "gitlab", "--repo", "OWNER/REPO"]),
    /Unsupported provider: gitlab/,
  );
});

test("parseArgs rejects malformed repositories", () => {
  assert.throws(
    () => parseArgs(["--provider", "github-gh", "--repo", "OWNER"]),
    /--repo must use OWNER\/REPO/,
  );
});

test("parseArgs parses GitHub target", () => {
  assert.deepEqual(
    parseArgs(["--provider", "github-gh", "--repo", "OWNER/REPO"]),
    {
      showHelp: false,
      provider: "github-gh",
      target: { owner: "OWNER", repo: "REPO", slug: "OWNER/REPO" },
      reset: false,
    },
  );
});

test("parseArgs parses Forgejo login and reset", () => {
  assert.deepEqual(
    parseArgs([
      "--provider=forgejo-tea",
      "--repo=team/lunch",
      "--login",
      "demo-login",
      "--reset",
    ]),
    {
      showHelp: false,
      provider: "forgejo-tea",
      target: { owner: "team", repo: "lunch", slug: "team/lunch" },
      login: "demo-login",
      reset: true,
    },
  );
});

test("parseArgs rejects GitHub login", () => {
  assert.throws(
    () =>
      parseArgs([
        "--provider",
        "github-gh",
        "--repo",
        "OWNER/REPO",
        "--login",
        "unused",
      ]),
    /--login is only supported with forgejo-tea/,
  );
});

test("parseArgs returns help without requiring provider or repo", () => {
  assert.deepEqual(parseArgs(["--help"]), {
    showHelp: true,
    reset: false,
  });
});
```

Run: `node --test src/cli/commands/setup-test-repo/args.test.ts`

Expected: FAIL because `args.ts` does not exist.

- [ ] **Step 3: Implement parser**

Create `src/cli/commands/setup-test-repo/args.ts`.

```ts
import type { PatchmillHostProviderId } from "../../../config/types.ts";
import type { RepositoryTarget } from "../../../host/types.ts";

export type SetupTestRepoConfig = {
  showHelp: boolean;
  provider?: PatchmillHostProviderId;
  target?: RepositoryTarget;
  login?: string;
  reset: boolean;
};

const SUPPORTED_PROVIDERS = new Set<PatchmillHostProviderId>([
  "github-gh",
  "forgejo-tea",
]);

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${flag} requires a value`);
  return value;
}

function parseRepo(value: string): RepositoryTarget {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u.exec(value);
  if (!match) throw new Error("--repo must use OWNER/REPO");
  return { owner: match[1], repo: match[2], slug: value };
}

function parseProvider(value: string): PatchmillHostProviderId {
  if (SUPPORTED_PROVIDERS.has(value as PatchmillHostProviderId)) {
    return value as PatchmillHostProviderId;
  }
  throw new Error(`Unsupported provider: ${value}`);
}

export function parseArgs(args: string[]): SetupTestRepoConfig {
  const config: SetupTestRepoConfig = { showHelp: false, reset: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      config.showHelp = true;
    } else if (arg === "--provider") {
      config.provider = parseProvider(requireValue(args, index, arg));
      index += 1;
    } else if (arg.startsWith("--provider=")) {
      config.provider = parseProvider(arg.slice("--provider=".length));
    } else if (arg === "--repo") {
      config.target = parseRepo(requireValue(args, index, arg));
      index += 1;
    } else if (arg.startsWith("--repo=")) {
      config.target = parseRepo(arg.slice("--repo=".length));
    } else if (arg === "--login") {
      config.login = requireValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--login=")) {
      config.login = arg.slice("--login=".length);
      if (!config.login) throw new Error("--login requires a value");
    } else if (arg === "--reset") {
      config.reset = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (config.showHelp) return config;
  if (!config.provider) throw new Error("--provider is required");
  if (!config.target) throw new Error("--repo OWNER/REPO is required");
  if (config.login && config.provider !== "forgejo-tea") {
    throw new Error("--login is only supported with forgejo-tea");
  }

  return config;
}
```

Run: `node --test src/cli/commands/setup-test-repo/args.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/host/types.ts src/cli/commands/setup-test-repo/args.ts src/cli/commands/setup-test-repo/args.test.ts
git commit -m "feat: parse setup test repo arguments"
```

## Task 4: Add generic GitHub host capabilities

**Files:**

- Modify: `src/host/types.ts`
- Modify: `src/host/factory.ts`
- Modify: `src/host/factory.test.ts`
- Modify: `src/host/github-gh.ts`
- Modify: `src/host/github-gh.test.ts`

- [ ] **Step 1: Add generic host capability types**

In `src/host/types.ts`, add these types after `RepositoryTarget`.

```ts
export type HostIssueCreateInput = {
  title: string;
  body: string;
  labels: string[];
};

export type RepositoryLifecycleHostProvider = {
  repoExists(target: RepositoryTarget): Promise<boolean>;
  createPublicRepo(target: RepositoryTarget): Promise<void>;
  deleteRepo(target: RepositoryTarget): Promise<void>;
  gitRemoteUrl(target: RepositoryTarget): Promise<string>;
  publicRepoUrl(target: RepositoryTarget): Promise<string>;
  cloneCommand(target: RepositoryTarget): string;
};

export type GitHostProvider = IssueHostProvider &
  RepositoryLifecycleHostProvider & {
    createIssue(issue: HostIssueCreateInput): Promise<void>;
  };
```

- [ ] **Step 2: Write failing GitHub tests**

Append these tests to `src/host/github-gh.test.ts`. Reuse the file's existing
fake runner helpers when possible; if the helper names differ, adapt only the
helper calls and keep the asserted commands exactly the same.

```ts
test("GitHub provider checks repository existence with gh repo view", async () => {
  const { provider, calls } = createProviderWithResponses([
    { code: 0, stdout: '{"name":"patchmill-test"}', stderr: "" },
  ]);

  assert.equal(
    await provider.repoExists({
      owner: "OWNER",
      repo: "patchmill-test",
      slug: "OWNER/patchmill-test",
    }),
    true,
  );
  assert.deepEqual(calls[0], {
    command: "gh",
    args: ["repo", "view", "OWNER/patchmill-test", "--json", "name"],
    cwd: "/repo",
  });
});

test("GitHub provider returns false when gh repo view cannot find the repo", async () => {
  const { provider } = createProviderWithResponses([
    { code: 1, stdout: "", stderr: "Could not resolve to a Repository" },
  ]);

  assert.equal(
    await provider.repoExists({
      owner: "OWNER",
      repo: "missing",
      slug: "OWNER/missing",
    }),
    false,
  );
});

test("GitHub provider creates and deletes public repositories", async () => {
  const { provider, calls } = createProviderWithResponses([
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
  ]);
  const target = {
    owner: "OWNER",
    repo: "patchmill-test",
    slug: "OWNER/patchmill-test",
  };

  await provider.createPublicRepo(target);
  await provider.deleteRepo(target);

  assert.deepEqual(
    calls.map((call) => call.args),
    [
      ["repo", "create", "OWNER/patchmill-test", "--public"],
      ["repo", "delete", "OWNER/patchmill-test", "--yes"],
    ],
  );
});

test("GitHub provider exposes remote URL, public URL, and clone command", async () => {
  const { provider } = createProviderWithResponses([]);
  const target = {
    owner: "OWNER",
    repo: "patchmill-test",
    slug: "OWNER/patchmill-test",
  };

  assert.equal(
    await provider.gitRemoteUrl(target),
    "https://github.com/OWNER/patchmill-test.git",
  );
  assert.equal(
    await provider.publicRepoUrl(target),
    "https://github.com/OWNER/patchmill-test",
  );
  assert.equal(
    provider.cloneCommand(target),
    "gh repo clone OWNER/patchmill-test",
  );
});

test("GitHub provider creates issues with labels when provided", async () => {
  const { provider, calls } = createProviderWithResponses([
    {
      code: 0,
      stdout: "https://github.com/OWNER/patchmill-test/issues/1\n",
      stderr: "",
    },
  ]);

  await provider.createIssue({
    title: "Build the form",
    body: "Create a useful form.\n",
    labels: ["feature", "polish"],
  });

  assert.deepEqual(calls[0]?.args, [
    "issue",
    "create",
    "--title",
    "Build the form",
    "--body",
    "Create a useful form.\n",
    "--label",
    "feature,polish",
  ]);
});
```

Run: `node --test src/host/github-gh.test.ts`

Expected: FAIL because `GitHubGhHostProvider` does not have the new methods.

- [ ] **Step 3: Implement GitHub provider methods**

In `src/host/github-gh.ts`, import the new types.

```ts
import type {
  HostCliCheck,
  HostIssueCreateInput,
  IssueHostProvider,
  IssueSummary,
  LabelChangePlan,
  LabelDefinition,
  RepositoryTarget,
} from "./types.ts";
```

Add these methods inside `GitHubGhHostProvider`.

```ts
async repoExists(target: RepositoryTarget): Promise<boolean> {
  const result = await this.runGh([
    "repo",
    "view",
    target.slug,
    "--json",
    "name",
  ]);
  return result.code === 0;
}

async createPublicRepo(target: RepositoryTarget): Promise<void> {
  const result = await this.runGh(["repo", "create", target.slug, "--public"]);
  if (result.code !== 0) {
    throw new Error(
      `gh repo create failed for ${target.slug}: ${commandOutput(result)}`,
    );
  }
}

async deleteRepo(target: RepositoryTarget): Promise<void> {
  const result = await this.runGh(["repo", "delete", target.slug, "--yes"]);
  if (result.code !== 0) {
    throw new Error(
      `gh repo delete failed for ${target.slug}: ${commandOutput(result)}`,
    );
  }
}

async gitRemoteUrl(target: RepositoryTarget): Promise<string> {
  return `https://github.com/${target.slug}.git`;
}

async publicRepoUrl(target: RepositoryTarget): Promise<string> {
  return `https://github.com/${target.slug}`;
}

cloneCommand(target: RepositoryTarget): string {
  return `gh repo clone ${target.slug}`;
}

async createIssue(issue: HostIssueCreateInput): Promise<void> {
  const args = ["issue", "create", "--title", issue.title, "--body", issue.body];
  if (issue.labels.length > 0) args.push("--label", issue.labels.join(","));

  const result = await this.runGh(args);
  if (result.code !== 0) {
    throw new Error(
      `gh issue create failed for ${issue.title}: ${commandOutput(result)}`,
    );
  }
}
```

Run: `node --test src/host/github-gh.test.ts`

Expected: PASS.

- [ ] **Step 4: Add the expanded factory without breaking existing callers**

Modify `src/host/factory.ts` so existing callers can continue using
`createIssueHostProvider()` while setup can request the expanded type.

```ts
import type { GitHostProvider, IssueHostProvider } from "./types.ts";

export function createGitHostProvider(options: {
  runner: CommandRunner;
  repoRoot: string;
  host: PatchmillHostConfig;
}): GitHostProvider {
  switch (options.host.provider) {
    case "forgejo-tea":
      return new ForgejoTeaHostProvider({
        runner: options.runner,
        repoRoot: options.repoRoot,
        login: options.host.login,
      });
    case "github-gh":
      return new GitHubGhHostProvider({
        runner: options.runner,
        repoRoot: options.repoRoot,
      });
  }
}

export function createIssueHostProvider(options: {
  runner: CommandRunner;
  repoRoot: string;
  host: PatchmillHostConfig;
}): IssueHostProvider {
  return createGitHostProvider(options);
}
```

Append this test to `src/host/factory.test.ts`.

```ts
test("createGitHostProvider exposes generic repository capabilities", () => {
  const provider = createGitHostProvider({
    runner,
    repoRoot: "/repo",
    host: { provider: "github-gh", login: "" },
  });

  assert.equal(typeof provider.repoExists, "function");
  assert.equal(typeof provider.createPublicRepo, "function");
  assert.equal(typeof provider.deleteRepo, "function");
  assert.equal(typeof provider.gitRemoteUrl, "function");
  assert.equal(typeof provider.publicRepoUrl, "function");
  assert.equal(typeof provider.cloneCommand, "function");
  assert.equal(typeof provider.createIssue, "function");
});
```

Run: `node --test src/host/factory.test.ts src/host/github-gh.test.ts`

Expected: PASS after importing `createGitHostProvider` in the test.

- [ ] **Step 5: Commit**

```bash
git add src/host/types.ts src/host/factory.ts src/host/factory.test.ts src/host/github-gh.ts src/host/github-gh.test.ts
git commit -m "feat: add generic github host repository commands"
```

## Task 5: Add generic Forgejo/Gitea host capabilities

**Files:**

- Create: `src/host/forgejo-tea-context.ts`
- Create: `src/host/forgejo-tea-context.test.ts`
- Modify: `src/cli/commands/triage/forgejo.ts`
- Modify: `src/host/forgejo-tea.ts`
- Modify: `src/host/forgejo-tea.test.ts`
- Modify: `src/host/factory.test.ts`

- [ ] **Step 1: Extract shared tea context tests**

Create `src/host/forgejo-tea-context.test.ts`.

```ts
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { withTeaContext } from "./forgejo-tea-context.ts";

async function gitRepoWithOrigin(remoteUrl: string): Promise<string> {
  const repoRoot = join(
    tmpdir(),
    `patchmill-tea-context-${Date.now()}-${Math.random()}`,
  );
  await mkdir(join(repoRoot, ".git"), { recursive: true });
  await writeFile(
    join(repoRoot, ".git", "config"),
    `[remote "origin"]\n\turl = ${remoteUrl}\n`,
  );
  return repoRoot;
}

test("withTeaContext adds repo from origin remote", async () => {
  const repoRoot = await gitRepoWithOrigin("git@example.test:OWNER/REPO.git");

  assert.deepEqual(withTeaContext(["issues", "list"], repoRoot), [
    "issues",
    "list",
    "--repo",
    "OWNER/REPO",
  ]);

  await rm(repoRoot, { recursive: true, force: true });
});

test("withTeaContext adds login before -- body separator", async () => {
  const repoRoot = await gitRepoWithOrigin(
    "https://forgejo.example/OWNER/REPO.git",
  );

  assert.deepEqual(
    withTeaContext(["comment", "1", "--", "hello"], repoRoot, "demo"),
    ["comment", "1", "--repo", "OWNER/REPO", "--login", "demo", "--", "hello"],
  );

  await rm(repoRoot, { recursive: true, force: true });
});
```

Run: `node --test src/host/forgejo-tea-context.test.ts`

Expected: FAIL because `forgejo-tea-context.ts` does not exist.

- [ ] **Step 2: Move existing tea context logic into src/host**

Create `src/host/forgejo-tea-context.ts` by moving the existing generic helpers
from `src/cli/commands/triage/forgejo.ts`: `insertBeforeSeparator`,
`commonGitConfigPath`, `gitConfigPath`, `originRemoteUrl`,
`repoSlugFromRemoteUrl`, `teaRepo`, and `withTeaContext`.

Export only `withTeaContext`.

```ts
export function withTeaContext(
  args: string[],
  repoRoot: string,
  teaLogin?: string,
): string[] {
  const repoArgs = insertBeforeSeparator(args, ["--repo", teaRepo(repoRoot)]);
  if (!teaLogin) return repoArgs;
  return insertBeforeSeparator(repoArgs, ["--login", teaLogin]);
}
```

In `src/cli/commands/triage/forgejo.ts`, delete the moved helper definitions and
add this import.

```ts
import { withTeaContext } from "../../../host/forgejo-tea-context.ts";
```

Run:

```bash
node --test src/host/forgejo-tea-context.test.ts src/host/forgejo-tea.test.ts
```

Expected: PASS. This step is a refactor; Forgejo triage behavior should stay the
same.

- [ ] **Step 3: Write failing Forgejo provider lifecycle tests**

Append these tests to `src/host/forgejo-tea.test.ts`. Reuse existing fake runner
helpers from the file.

```ts
test("Forgejo provider checks repository existence with tea repos search", async () => {
  const { provider, calls } = createProviderWithResponses([
    {
      code: 0,
      stdout: JSON.stringify([
        {
          owner: { login: "OWNER" },
          name: "patchmill-test",
          url: "https://forgejo.example/OWNER/patchmill-test",
          ssh: "git@forgejo.example:OWNER/patchmill-test.git",
        },
      ]),
      stderr: "",
    },
  ]);

  assert.equal(
    await provider.repoExists({
      owner: "OWNER",
      repo: "patchmill-test",
      slug: "OWNER/patchmill-test",
    }),
    true,
  );
  assert.deepEqual(calls[0]?.args, [
    "repos",
    "search",
    "patchmill-test",
    "--owner",
    "OWNER",
    "--fields",
    "owner,name,ssh,url",
    "--limit",
    "50",
    "--output",
    "json",
    "--login",
    "triage-agent",
  ]);
});

test("Forgejo provider creates and deletes public repositories", async () => {
  const { provider, calls } = createProviderWithResponses([
    { code: 0, stdout: "{}", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
  ]);
  const target = {
    owner: "OWNER",
    repo: "patchmill-test",
    slug: "OWNER/patchmill-test",
  };

  await provider.createPublicRepo(target);
  await provider.deleteRepo(target);

  assert.deepEqual(
    calls.map((call) => call.args),
    [
      [
        "repos",
        "create",
        "--name",
        "patchmill-test",
        "--owner",
        "OWNER",
        "--output",
        "json",
        "--login",
        "triage-agent",
      ],
      [
        "repos",
        "delete",
        "--name",
        "patchmill-test",
        "--owner",
        "OWNER",
        "--force",
        "--login",
        "triage-agent",
      ],
    ],
  );
});

test("Forgejo provider reads clone and public URLs from repository info", async () => {
  const { provider } = createProviderWithResponses([
    {
      code: 0,
      stdout: JSON.stringify([
        {
          owner: "OWNER",
          name: "patchmill-test",
          url: "https://forgejo.example/OWNER/patchmill-test",
          ssh: "git@forgejo.example:OWNER/patchmill-test.git",
        },
      ]),
      stderr: "",
    },
    {
      code: 0,
      stdout: JSON.stringify([
        {
          owner: "OWNER",
          name: "patchmill-test",
          url: "https://forgejo.example/OWNER/patchmill-test",
          ssh: "git@forgejo.example:OWNER/patchmill-test.git",
        },
      ]),
      stderr: "",
    },
  ]);
  const target = {
    owner: "OWNER",
    repo: "patchmill-test",
    slug: "OWNER/patchmill-test",
  };

  assert.equal(
    await provider.gitRemoteUrl(target),
    "git@forgejo.example:OWNER/patchmill-test.git",
  );
  assert.equal(
    await provider.publicRepoUrl(target),
    "https://forgejo.example/OWNER/patchmill-test",
  );
  assert.equal(provider.cloneCommand(target), "tea clone OWNER/patchmill-test");
});

test("Forgejo provider creates issues with labels", async () => {
  const { provider, calls } = createProviderWithResponses([
    { code: 0, stdout: "", stderr: "" },
  ]);

  await provider.createIssue({
    title: "Build the form",
    body: "Create a useful form.\n",
    labels: ["feature", "polish"],
  });

  assert.deepEqual(calls[0]?.args, [
    "issues",
    "create",
    "--title",
    "Build the form",
    "--description",
    "Create a useful form.\n",
    "--labels",
    "feature,polish",
    "--repo",
    "/repo",
    "--login",
    "triage-agent",
  ]);
});
```

Run: `node --test src/host/forgejo-tea.test.ts`

Expected: FAIL because the provider does not have the new lifecycle methods.

- [ ] **Step 4: Implement Forgejo provider lifecycle and issue methods**

In `src/host/forgejo-tea.ts`, import the new types and shared context helper.

```ts
import { withTeaContext } from "./forgejo-tea-context.ts";
import type {
  HostCliCheck,
  HostIssueCreateInput,
  IssueHostProvider,
  IssueSummary,
  LabelChangePlan,
  LabelDefinition,
  RepositoryTarget,
} from "./types.ts";
```

Add private repo info parsing helpers above the class.

```ts
type TeaRepoPayload = Record<string, unknown>;

type TeaRepoInfo = {
  webUrl: string;
  cloneUrl: string;
};

function parseJson(stdout: string, context: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `${context} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function ownerName(owner: unknown): string | undefined {
  if (typeof owner === "string") return owner;
  if (owner && typeof owner === "object") {
    const value = owner as Record<string, unknown>;
    if (typeof value.login === "string") return value.login;
    if (typeof value.name === "string") return value.name;
    if (typeof value.username === "string") return value.username;
  }
  return undefined;
}

function repoMatches(entry: TeaRepoPayload, target: RepositoryTarget): boolean {
  return ownerName(entry.owner) === target.owner && entry.name === target.repo;
}

function repoInfo(
  entry: TeaRepoPayload,
  target: RepositoryTarget,
): TeaRepoInfo {
  if (typeof entry.url !== "string") {
    throw new Error(
      `tea repos search did not return a web URL for ${target.slug}`,
    );
  }
  if (typeof entry.ssh !== "string") {
    throw new Error(
      `tea repos search did not return an SSH URL for ${target.slug}`,
    );
  }
  return { webUrl: entry.url, cloneUrl: entry.ssh };
}
```

Add these methods inside `ForgejoTeaHostProvider`.

```ts
private runTea(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const withLogin = this.options.login ? [...args, "--login", this.options.login] : args;
  return this.options.runner.run("tea", withLogin, { cwd: this.options.repoRoot });
}

private async repositoryInfo(target: RepositoryTarget): Promise<TeaRepoInfo | undefined> {
  const result = await this.runTea([
    "repos",
    "search",
    target.repo,
    "--owner",
    target.owner,
    "--fields",
    "owner,name,ssh,url",
    "--limit",
    "50",
    "--output",
    "json",
  ]);
  if (result.code !== 0) {
    throw new Error(`tea repos search failed for ${target.slug}: ${commandOutput(result)}`);
  }
  const parsed = parseJson(result.stdout, "tea repos search");
  if (!Array.isArray(parsed)) throw new Error("tea repos search returned a non-array payload");
  const match = parsed.find(
    (entry): entry is TeaRepoPayload =>
      Boolean(entry) && typeof entry === "object" && repoMatches(entry as TeaRepoPayload, target),
  );
  return match ? repoInfo(match, target) : undefined;
}

async repoExists(target: RepositoryTarget): Promise<boolean> {
  return (await this.repositoryInfo(target)) !== undefined;
}

async createPublicRepo(target: RepositoryTarget): Promise<void> {
  const result = await this.runTea([
    "repos",
    "create",
    "--name",
    target.repo,
    "--owner",
    target.owner,
    "--output",
    "json",
  ]);
  if (result.code !== 0) {
    throw new Error(`tea repos create failed for ${target.slug}: ${commandOutput(result)}`);
  }
}

async deleteRepo(target: RepositoryTarget): Promise<void> {
  const result = await this.runTea([
    "repos",
    "delete",
    "--name",
    target.repo,
    "--owner",
    target.owner,
    "--force",
  ]);
  if (result.code !== 0) {
    throw new Error(`tea repos delete failed for ${target.slug}: ${commandOutput(result)}`);
  }
}

async gitRemoteUrl(target: RepositoryTarget): Promise<string> {
  const info = await this.repositoryInfo(target);
  if (!info) throw new Error(`Repository not found: ${target.slug}`);
  return info.cloneUrl;
}

async publicRepoUrl(target: RepositoryTarget): Promise<string> {
  const info = await this.repositoryInfo(target);
  if (!info) throw new Error(`Repository not found: ${target.slug}`);
  return info.webUrl;
}

cloneCommand(target: RepositoryTarget): string {
  return `tea clone ${target.slug}`;
}

async createIssue(issue: HostIssueCreateInput): Promise<void> {
  const args = [
    "issues",
    "create",
    "--title",
    issue.title,
    "--description",
    issue.body,
  ];
  if (issue.labels.length > 0) args.push("--labels", issue.labels.join(","));

  const result = await this.options.runner.run(
    "tea",
    withTeaContext(args, this.options.repoRoot, this.options.login),
    { cwd: this.options.repoRoot },
  );
  if (result.code !== 0) {
    throw new Error(`tea issues create failed for ${issue.title}: ${commandOutput(result)}`);
  }
}
```

Run:

```bash
node --test src/host/forgejo-tea-context.test.ts src/host/forgejo-tea.test.ts src/host/factory.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/host/forgejo-tea-context.ts src/host/forgejo-tea-context.test.ts src/cli/commands/triage/forgejo.ts src/host/forgejo-tea.ts src/host/forgejo-tea.test.ts src/host/factory.test.ts
git commit -m "feat: add generic forgejo host repository commands"
```

## Task 6: Add setup command orchestration

**Files:**

- Create: `src/cli/commands/setup-test-repo/labels.ts`
- Create: `src/cli/commands/setup-test-repo/main.ts`
- Create: `src/cli/commands/setup-test-repo/main.test.ts`
- Create: `src/cli/commands/setup-test-repo/host-boundary.test.ts`

- [ ] **Step 1: Add setup-specific label definitions**

Create `src/cli/commands/setup-test-repo/labels.ts`.

```ts
import type { LabelDefinition } from "../../../host/types.ts";

export const SETUP_TEST_REPO_LABELS: LabelDefinition[] = [
  {
    name: "feature",
    color: "0e8a16",
    description: "New user-facing functionality.",
  },
  {
    name: "bug",
    color: "d73a4a",
    description: "Something is broken or behaves incorrectly.",
  },
  {
    name: "docs",
    color: "0075ca",
    description: "Documentation or usage guidance.",
  },
  {
    name: "polish",
    color: "a2eeef",
    description: "Visual, UX, or cleanup improvement.",
  },
];
```

- [ ] **Step 2: Write failing orchestration tests**

Create `src/cli/commands/setup-test-repo/main.test.ts`. Use a mocked provider
and mocked runner so no real `git`, `gh`, or `tea` command runs.

```ts
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runSetupTestRepo } from "./main.ts";
import type { CommandRunner } from "../triage/types.ts";
import type {
  GitHostProvider,
  HostCliCheck,
  HostIssueCreateInput,
  LabelChangePlan,
  LabelDefinition,
  RepositoryTarget,
} from "../../../host/types.ts";

function okCli(): HostCliCheck {
  return { ok: true, message: "ok" };
}

function createProvider(options: { exists?: boolean } = {}): {
  provider: GitHostProvider;
  calls: string[];
  issues: HostIssueCreateInput[];
  labels: LabelDefinition[];
} {
  const calls: string[] = [];
  const issues: HostIssueCreateInput[] = [];
  const labels: LabelDefinition[] = [];
  const provider: GitHostProvider = {
    id: "github-gh",
    displayName: "GitHub via gh",
    async checkCli() {
      calls.push("checkCli");
      return okCli();
    },
    missingLabelRemediation(label) {
      return `create ${label.name}`;
    },
    async listOpenIssues() {
      return [];
    },
    async viewIssue() {
      throw new Error("not used");
    },
    async hydrateIssueComments(value) {
      return value;
    },
    async listLabels() {
      return [];
    },
    async createLabel(label) {
      labels.push(label);
    },
    async applyLabels(_change: LabelChangePlan) {},
    async commentIssue() {},
    async repoExists() {
      calls.push("repoExists");
      return options.exists ?? false;
    },
    async createPublicRepo(target: RepositoryTarget) {
      calls.push(`createPublicRepo:${target.slug}`);
    },
    async deleteRepo(target: RepositoryTarget) {
      calls.push(`deleteRepo:${target.slug}`);
    },
    async gitRemoteUrl(target: RepositoryTarget) {
      return `https://example.test/${target.slug}.git`;
    },
    async publicRepoUrl(target: RepositoryTarget) {
      return `https://example.test/${target.slug}`;
    },
    cloneCommand(target: RepositoryTarget) {
      return `gh repo clone ${target.slug}`;
    },
    async createIssue(issue: HostIssueCreateInput) {
      issues.push(issue);
    },
  };
  return { provider, calls, issues, labels };
}

function createGitRunner(): { runner: CommandRunner; gitCalls: string[][] } {
  const gitCalls: string[][] = [];
  return {
    gitCalls,
    runner: {
      async run(command, args) {
        if (command !== "git")
          throw new Error(`Unexpected command: ${command}`);
        gitCalls.push(args);
        return { code: 0, stdout: "", stderr: "" };
      },
    },
  };
}

test("runSetupTestRepo creates a new repo, pushes fixtures, labels, and issues", async () => {
  const tempParent = await mkdtemp(join(tmpdir(), "patchmill-setup-test-"));
  const { provider, calls, labels, issues } = createProvider({ exists: false });
  const { runner, gitCalls } = createGitRunner();
  const stdout: string[] = [];

  const code = await runSetupTestRepo(
    ["--provider", "github-gh", "--repo", "OWNER/patchmill-test"],
    {
      runner,
      tempParent,
      output: { stdout: (line) => stdout.push(line), stderr: () => undefined },
      createProvider: () => provider,
    },
  );

  assert.equal(code, 0);
  assert.deepEqual(calls, [
    "checkCli",
    "repoExists",
    "createPublicRepo:OWNER/patchmill-test",
  ]);
  assert.deepEqual(
    gitCalls.map((args) => args[0]),
    ["--version", "init", "add", "commit", "remote", "push"],
  );
  assert.deepEqual(
    labels.map((label) => label.name),
    ["feature", "bug", "docs", "polish"],
  );
  assert.equal(issues.length, 12);
  assert.equal(issues[0]?.title, "Create the Team Lunch Poll app scaffold");
  assert.match(stdout.join("\n"), /patchmill init/u);

  await rm(tempParent, { recursive: true, force: true });
});

test("runSetupTestRepo refuses existing repo without reset", async () => {
  const { provider } = createProvider({ exists: true });
  const { runner } = createGitRunner();
  const stderr: string[] = [];

  const code = await runSetupTestRepo(
    ["--provider", "github-gh", "--repo", "OWNER/patchmill-test"],
    {
      runner,
      output: { stdout: () => undefined, stderr: (line) => stderr.push(line) },
      createProvider: () => provider,
    },
  );

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /already exists/u);
  assert.match(stderr.join("\n"), /--reset/u);
});

test("runSetupTestRepo deletes and recreates when reset is supplied", async () => {
  const { provider, calls } = createProvider({ exists: true });
  const { runner } = createGitRunner();

  const code = await runSetupTestRepo(
    ["--provider", "github-gh", "--repo", "OWNER/patchmill-test", "--reset"],
    {
      runner,
      output: { stdout: () => undefined, stderr: () => undefined },
      createProvider: () => provider,
    },
  );

  assert.equal(code, 0);
  assert.deepEqual(calls, [
    "checkCli",
    "repoExists",
    "deleteRepo:OWNER/patchmill-test",
    "createPublicRepo:OWNER/patchmill-test",
  ]);
});
```

Run: `node --test src/cli/commands/setup-test-repo/main.test.ts`

Expected: FAIL because `main.ts` does not exist.

- [ ] **Step 3: Implement setup command orchestration**

Create `src/cli/commands/setup-test-repo/main.ts`.

```ts
#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createCommandRunner } from "../triage/command.ts";
import type { CommandRunner } from "../triage/types.ts";
import { createGitHostProvider } from "../../../host/factory.ts";
import type { GitHostProvider, RepositoryTarget } from "../../../host/types.ts";
import { parseArgs } from "./args.ts";
import {
  copyFixtureToRepository,
  loadSetupIssues,
  resolveFixtureDirectory,
} from "./fixtures.ts";
import { SETUP_TEST_REPO_LABELS } from "./labels.ts";

export const HELP_TEXT = `Usage:
  patchmill setup-test-repo --provider github-gh --repo OWNER/REPO [--reset]
  patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO --login LOGIN [--reset]

Create or reset a disposable public Team Lunch Poll repository for trying Patchmill.

Options:
  --help, -h             Show this help and exit.
  --provider PROVIDER    Required. One of: github-gh, forgejo-tea.
  --repo OWNER/REPO      Required. Disposable target repository.
  --login LOGIN          Optional named tea login for forgejo-tea.
  --reset                Delete and recreate the target repository before seeding.
`;

export type SetupTestRepoOutput = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export type SetupTestRepoDependencies = {
  runner?: CommandRunner;
  output?: SetupTestRepoOutput;
  tempParent?: string;
  createProvider?: (options: {
    runner: CommandRunner;
    repoRoot: string;
    provider: "github-gh" | "forgejo-tea";
    login: string;
  }) => GitHostProvider;
};

const DEFAULT_OUTPUT: SetupTestRepoOutput = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

async function runGit(
  runner: CommandRunner,
  repoRoot: string,
  args: string[],
): Promise<void> {
  const result = await runner.run("git", args, { cwd: repoRoot });
  if (result.code !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
}

async function ensureGit(runner: CommandRunner): Promise<void> {
  const result = await runner.run("git", ["--version"]);
  if (result.code !== 0) {
    throw new Error(`git --version failed: ${result.stderr || result.stdout}`);
  }
}

function createProviderFromFactory(options: {
  runner: CommandRunner;
  repoRoot: string;
  provider: "github-gh" | "forgejo-tea";
  login: string;
}): GitHostProvider {
  return createGitHostProvider({
    runner: options.runner,
    repoRoot: options.repoRoot,
    host: { provider: options.provider, login: options.login },
  });
}

async function prepareRepository(options: {
  provider: GitHostProvider;
  target: RepositoryTarget;
  reset: boolean;
  output: SetupTestRepoOutput;
}): Promise<void> {
  const exists = await options.provider.repoExists(options.target);
  if (exists && !options.reset) {
    throw new Error(
      `Repository ${options.target.slug} already exists. Rerun with --reset only if it is disposable and safe to delete.`,
    );
  }

  if (options.reset) {
    options.output.stdout(
      `Resetting ${options.provider.displayName} repository ${options.target.slug}`,
    );
    if (exists) await options.provider.deleteRepo(options.target);
  }

  await options.provider.createPublicRepo(options.target);
}

async function seedGitRepository(options: {
  runner: CommandRunner;
  repoRoot: string;
  remoteUrl: string;
}): Promise<void> {
  await runGit(options.runner, options.repoRoot, ["init", "-b", "main"]);
  await runGit(options.runner, options.repoRoot, [
    "add",
    "README.md",
    "PROJECT_BRIEF.md",
    "issues",
  ]);
  await runGit(options.runner, options.repoRoot, [
    "commit",
    "-m",
    "Seed Team Lunch Poll demo",
  ]);
  await runGit(options.runner, options.repoRoot, [
    "remote",
    "add",
    "origin",
    options.remoteUrl,
  ]);
  await runGit(options.runner, options.repoRoot, [
    "push",
    "-u",
    "origin",
    "main",
  ]);
}

export async function runSetupTestRepo(
  args: string[],
  dependencies: SetupTestRepoDependencies = {},
): Promise<number> {
  const output = dependencies.output ?? DEFAULT_OUTPUT;
  try {
    const config = parseArgs(args);
    if (config.showHelp) {
      output.stdout(HELP_TEXT);
      return 0;
    }
    if (!config.provider || !config.target)
      throw new Error("Invalid setup-test-repo configuration");

    const runner = dependencies.runner ?? createCommandRunner();
    await ensureGit(runner);

    const tempParent = dependencies.tempParent ?? tmpdir();
    const repoRoot = await mkdtemp(join(tempParent, "patchmill-test-repo-"));
    try {
      const provider = (
        dependencies.createProvider ?? createProviderFromFactory
      )({
        runner,
        repoRoot,
        provider: config.provider,
        login: config.login ?? "",
      });

      const cli = await provider.checkCli();
      if (!cli.ok) {
        throw new Error([cli.message, ...cli.remediation].join("\n"));
      }

      await prepareRepository({
        provider,
        target: config.target,
        reset: config.reset,
        output,
      });

      const fixtureDir = await resolveFixtureDirectory();
      const issues = await loadSetupIssues(fixtureDir);
      await copyFixtureToRepository(fixtureDir, repoRoot);
      await seedGitRepository({
        runner,
        repoRoot,
        remoteUrl: await provider.gitRemoteUrl(config.target),
      });

      for (const label of SETUP_TEST_REPO_LABELS)
        await provider.createLabel(label);
      for (const issue of issues) await provider.createIssue(issue);

      output.stdout(`Seeded ${await provider.publicRepoUrl(config.target)}`);
      output.stdout("");
      output.stdout("Next steps:");
      output.stdout(`  ${provider.cloneCommand(config.target)}`);
      output.stdout(`  cd ${config.target.repo}`);
      output.stdout("  patchmill init");
      output.stdout("  patchmill triage --dry-run");
      output.stdout("  patchmill triage");
      return 0;
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  } catch (error) {
    output.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  return runSetupTestRepo(args);
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  process.exitCode = await main();
}
```

Run: `node --test src/cli/commands/setup-test-repo/main.test.ts`

Expected: PASS after adjusting any fake runner assumptions exposed by the test.

- [ ] **Step 4: Add the host boundary test**

Create `src/cli/commands/setup-test-repo/host-boundary.test.ts`.

```ts
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const commandDir = dirname(fileURLToPath(import.meta.url));

async function tsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await tsFiles(path)));
    if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

test("setup-test-repo command does not invoke provider CLIs directly", async () => {
  for (const file of await tsFiles(commandDir)) {
    const content = await readFile(file, "utf8");
    assert.doesNotMatch(content, /\.run\(\s*["'](?:gh|tea)["']/u, file);
    assert.doesNotMatch(
      content,
      /\b(?:spawn|exec|execFile)\(\s*["'](?:gh|tea)["']/u,
      file,
    );
  }
});
```

Run:

```bash
node --test src/cli/commands/setup-test-repo/*.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/setup-test-repo/labels.ts src/cli/commands/setup-test-repo/main.ts src/cli/commands/setup-test-repo/main.test.ts src/cli/commands/setup-test-repo/host-boundary.test.ts
git commit -m "feat: orchestrate setup test repo command"
```

## Task 7: Register the public CLI command

**Files:**

- Modify: `src/cli/main.ts`
- Modify: `src/cli/main.test.ts`

- [ ] **Step 1: Write failing CLI registration tests**

Append these tests to `src/cli/main.test.ts`.

```ts
test("resolveCommand maps setup-test-repo to the public command name", () => {
  assert.deepEqual(
    resolveCommand(
      ["setup-test-repo", "--provider", "github-gh"],
      ["setup-test-repo"],
    ),
    {
      command: "setup-test-repo",
      args: ["--provider", "github-gh"],
    },
  );
});

test("createCliMain dispatches setup-test-repo command", async () => {
  const calls: string[][] = [];
  const main = createCliMain(
    new Map([
      [
        "setup-test-repo",
        async (args) => {
          calls.push(args);
          return 0;
        },
      ],
    ]),
  );

  assert.equal(
    await main([
      "setup-test-repo",
      "--provider",
      "github-gh",
      "--repo",
      "OWNER/REPO",
    ]),
    0,
  );
  assert.deepEqual(calls, [
    ["--provider", "github-gh", "--repo", "OWNER/REPO"],
  ]);
});
```

Update the help test to assert the new command appears.

```ts
assert.match(
  HELP_TEXT,
  /setup-test-repo\s+Create or reset a disposable Patchmill demo repository\./,
);
```

Run: `node --test src/cli/main.test.ts`

Expected: FAIL because the help text and command map do not include
`setup-test-repo`.

- [ ] **Step 2: Register setup-test-repo**

In `src/cli/main.ts`, import the command.

```ts
import { main as setupTestRepoMain } from "./commands/setup-test-repo/main.ts";
```

Add the help row.

```ts
  setup-test-repo  Create or reset a disposable Patchmill demo repository.
```

Add the command to `COMMANDS`.

```ts
["setup-test-repo", setupTestRepoMain],
```

Run:
`node --test src/cli/main.test.ts src/cli/commands/setup-test-repo/*.test.ts`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/cli/main.ts src/cli/main.test.ts
git commit -m "feat: register setup test repo command"
```

## Task 8: Add README and reference documentation

**Files:**

- Modify: `README.md`
- Create: `docs/setup-test-repo.md`

- [ ] **Step 1: Update README first-use guidance**

In `README.md`, add this section under `## First use`, before the production
repository workflow.

````markdown
### Try Patchmill on a disposable demo repository

Before pointing Patchmill at a production repository, create a disposable Team
Lunch Poll demo repository and let Patchmill triage its seeded issues.

For GitHub:

```bash
patchmill setup-test-repo --provider github-gh --repo OWNER/REPO
gh repo clone OWNER/REPO
cd REPO
patchmill init
patchmill triage --dry-run
```

For Forgejo or Gitea with a named `tea` login:

```bash
patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO --login LOGIN
tea clone OWNER/REPO
cd REPO
patchmill init
patchmill triage --dry-run
```

Use an explicit disposable public repository for `OWNER/REPO`. The reset form
deletes and recreates that repository:

```bash
patchmill setup-test-repo --provider github-gh --repo OWNER/REPO --reset
patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO --login LOGIN --reset
```

The reusable demo prompts live in the Patchmill package under
`fixtures/patchmill-test-repo/`. See `docs/setup-test-repo.md` for details.
````

- [ ] **Step 2: Add reference documentation**

Create `docs/setup-test-repo.md`.

````markdown
# Setup Test Repo

`patchmill setup-test-repo` creates a disposable public Team Lunch Poll
repository for trying Patchmill safely before using it on production issues.

## When to use it

Use this command when you want to see `patchmill init` and `patchmill triage`
work on realistic greenfield issues without risking an existing project.

## Supported providers

The command supports the same issue hosts Patchmill currently supports:

- `github-gh` through the GitHub `gh` CLI.
- `forgejo-tea` through the Forgejo/Gitea `tea` CLI.

The provider is required. Patchmill does not infer it from git remotes or CLI
state.

## Create a disposable GitHub repository

```bash
patchmill setup-test-repo --provider github-gh --repo OWNER/REPO
```

## Create a disposable Forgejo/Gitea repository

```bash
patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO --login LOGIN
```

## Reset a disposable repository

`--reset` deletes and recreates the selected public repository. Use it only for
a repository you are comfortable losing.

```bash
patchmill setup-test-repo --provider github-gh --repo OWNER/REPO --reset
patchmill setup-test-repo --provider forgejo-tea --repo OWNER/REPO --login LOGIN --reset
```

## Fixture contents

The seeded repository receives these files from the installed Patchmill package:

- `README.md`
- `PROJECT_BRIEF.md`
- `issues/*.md`

The source fixture lives at `fixtures/patchmill-test-repo/` in the Patchmill
package and source tree.

## Manual Patchmill workflow

After setup, clone the disposable repository and run:

```bash
patchmill init
patchmill triage --dry-run
patchmill triage
```

`setup-test-repo` does not run `patchmill init` for you. The goal is to provide
a safe repository where you can exercise the same first-use workflow you would
run on a real project.
````

- [ ] **Step 3: Verify markdown**

Run:

```bash
npx markdownlint-cli2 README.md docs/setup-test-repo.md
```

Expected: `Summary: 0 error(s)`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/setup-test-repo.md
git commit -m "docs: document setup test repo workflow"
```

## Task 9: Verify packaging, full tests, and live GitHub setup

**Files:**

- Modify only if verification exposes a defect in files changed by earlier
  tasks.

- [ ] **Step 1: Run focused setup command tests**

```bash
node --test src/cli/commands/setup-test-repo/*.test.ts
```

Expected: all setup command tests pass.

- [ ] **Step 2: Run host provider tests**

```bash
node --test src/host/*.test.ts
```

Expected: all host provider tests pass.

- [ ] **Step 3: Run CLI tests**

```bash
npm run test:cli
```

Expected: CLI tests pass and include `setup-test-repo` coverage.

- [ ] **Step 4: Run the full automated test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Run lint and build**

```bash
npm run lint
npm run build
```

Expected: lint exits 0 and `dist/` is rebuilt successfully.

- [ ] **Step 6: Verify fixtures are included in the npm package**

```bash
npm pack --dry-run --json > .tmp-pack.json
node -e "const pack=require('./.tmp-pack.json')[0]; const files=pack.files.map(f=>f.path); for (const p of ['fixtures/patchmill-test-repo/README.md','fixtures/patchmill-test-repo/PROJECT_BRIEF.md','fixtures/patchmill-test-repo/issues/12-votes-disappear.md']) { if (!files.includes(p)) throw new Error(p + ' missing'); } console.log('fixture files included')"
rm .tmp-pack.json
```

Expected: the Node command prints `fixture files included`.

- [ ] **Step 7: Run live GitHub verification**

Use the agreed disposable Patchmill repository.

```bash
npm run patchmill -- setup-test-repo --provider github-gh --repo rochecompaan/patchmill-test --reset
```

Expected: the command exits 0, prints the GitHub public URL, and prints
next-step commands.

- [ ] **Step 8: Verify the live GitHub repository**

```bash
gh repo view rochecompaan/patchmill-test --json name,visibility,url
gh label list --repo rochecompaan/patchmill-test --json name --limit 100
gh issue list --repo rochecompaan/patchmill-test --state all --json number,title,labels --limit 100
```

Expected:

- repository `rochecompaan/patchmill-test` exists and is public,
- labels include `feature`, `bug`, `docs`, and `polish`,
- there are 12 issues,
- issue 1 is `Create the Team Lunch Poll app scaffold`,
- issue 12 is `Votes sometimes disappear when I refresh`,
- issue 11 and issue 12 have no seeded labels.

Leave `rochecompaan/patchmill-test` live and seeded.

- [ ] **Step 9: Optional Forgejo/Gitea verification**

Run this only when a disposable Forgejo/Gitea repository target and `tea` login
are available.

```bash
npm run patchmill -- setup-test-repo --provider forgejo-tea --repo OWNER/REPO --login LOGIN --reset
tea repos --login LOGIN --output json OWNER/REPO
tea issues list --login LOGIN --repo OWNER/REPO --state all --output json --limit 100
```

Expected: the repository exists, the seeded files are pushed, the four labels
exist, and 12 issues exist.

- [ ] **Step 10: Commit verification fixes or leave tree clean**

If verification required code changes, commit them with the narrowest matching
message. If no changes were required, confirm a clean tree.

```bash
git status --short
```

Expected: no output.

## Self-review checklist

- Spec coverage:
  - Command naming and required explicit `--provider`/`--repo`: Task 3 and
    Task 7.
  - Provider support for `github-gh` and `forgejo-tea`: Task 4 and Task 5.
  - No `src/host/setup-test-repo` subtree: file map and Task 6 boundary test.
  - No direct setup command `gh`/`tea` calls: Task 6 boundary test.
  - Reusable fixture prompts and copied repository files: Task 1 and Task 2.
  - Reset safety: Task 6 orchestration tests.
  - README and reference docs: Task 8.
  - Package inclusion and live verification: Task 9.
- Placeholder scan: no placeholder markers remain in this plan.
- Type consistency:
  - `RepositoryTarget`, `HostIssueCreateInput`, and `GitHostProvider` are
    defined in Task 3 and Task 4 before orchestration uses them in Task 6.
  - Provider lifecycle method names match across `src/host/types.ts`, provider
    classes, and setup orchestration.
  - `createGitHostProvider()` is introduced before `main.ts` imports it.
