# Skill Pack Update Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `patchmill skills update` so repositories can refresh
Patchmill-managed project-local skills to the skill pack bundled in the running
Patchmill CLI.

**Architecture:** Put the update behavior in a reusable updater beside CLI
command code, then wrap it with a small `skills` namespace. The updater treats
existing metadata hashes as ownership proof for old files, treats the bundled
recommended pack as ownership proof for new files, refuses unsafe writes before
copying, and emits structured results that CLI code formats for users.

**Tech Stack:** TypeScript ESM, Node `fs/promises`, Node test runner, existing
Patchmill skill-pack metadata helpers and init skill-installer dependency
abstractions.

---

## Global Constraints

- Latest means `PATCHMILL_RECOMMENDED_SKILL_PACK` bundled in the currently
  running CLI.
- Do not query npm, GitHub, package registries, or release APIs.
- Only update Patchmill-managed project-local skill packs under
  `.patchmill/skills/`.
- Require `.patchmill/skills/patchmill-skill-pack.json` metadata for the
  `patchmill-recommended` pack.
- Abort before writing when any old managed file is edited, missing, unreadable,
  or when a new bundled file would overwrite an untracked local file.
- Only edit paths recorded in the old metadata or present in the new bundled
  recommended pack.
- Do not implement global updates, custom skill directory updates,
  merge/conflict resolution, or `--dry-run`.
- Because this changes skill-pack behavior, verification must include AGENTS.md
  integration checks: bundled upstream Superpowers skill files exist at resolved
  paths, and Patchmill skill-pack config, metadata, tests, and live dependency
  references agree on the upstream version.
- No npm dependency files should change. If they unexpectedly do, rerun the Nix
  build as required by AGENTS.md.

## File Structure

- Modify `src/workflow/skill-pack.ts`
  - Widen metadata-facing types so older installed metadata versions and source
    tags type-check.
  - Keep `PATCHMILL_RECOMMENDED_SKILL_PACK` pinned to the current exact bundled
    version.
- Create `src/cli/commands/skills/update.ts`
  - Export `SkillPackUpdateResult`, `SkillPackUpdateOptions`, and
    `updateProjectSkills()`.
  - Own metadata validation, hash preflight, bundled pack enumeration, unmanaged
    collision detection, copy, obsolete-file removal, and metadata write.
- Create `src/cli/commands/skills/update.test.ts`
  - Cover clean update, already-current pack, dirty managed file, missing
    managed file, missing metadata, and unmanaged new-file collision.
- Create `src/cli/commands/skills/main.ts`
  - Export `HELP_TEXT`, command option/output types, `runSkills()`, and
    executable `main()`.
  - Own `patchmill skills` help, `update` routing, unsupported argument errors,
    and user-facing output.
- Create `src/cli/commands/skills/main.test.ts`
  - Cover help, update output, already-current output, unknown subcommands, and
    unexpected args.
- Modify `src/cli/main.ts`
  - Add top-level help text and routing for `skills`.
- Modify `src/cli/main.test.ts`
  - Cover `skills` command resolution, top-level help entry, and dispatch.
- Modify `README.md`
  - Add short update guidance near the project-local skill installation
    paragraph.
- Modify `docs/skills.md`
  - Add detailed update guidance under Project-local default skills.

### Task 1: Add the reusable skill-pack updater

**Files:**

- Modify: `src/workflow/skill-pack.ts`
- Create: `src/cli/commands/skills/update.ts`
- Create: `src/cli/commands/skills/update.test.ts`

- [ ] **Step 1: Widen skill-pack metadata types**

In `src/workflow/skill-pack.ts`, replace the current `SkillPackSource`,
`SkillPackSkill`, `SkillPack`, and `SkillPackMetadataFile` type block with:

```ts
export type SkillPackSource = {
  type: "github-release";
  repository: string;
  tag: string;
  tarballUrl: string;
};

export type SkillPackSkill = {
  name: string;
  source: "patchmill" | "superpowers";
};

export type SkillPack = {
  name: "patchmill-recommended";
  version: string;
  source: SkillPackSource;
  skills: SkillPackSkill[];
};

export type SkillPackMetadataFile = {
  pack: {
    name: string;
    version: string;
    source: SkillPackSource;
  };
  installedAt: "<generated-by-init>" | string;
  skillDir: string;
  metadataFile: typeof SKILL_PACK_METADATA_FILE;
  files: Array<{ path: string; sha256: string }>;
};
```

Do not change `PATCHMILL_RECOMMENDED_SKILL_PACK` values in this step.

- [ ] **Step 2: Write failing updater tests**

Create `src/cli/commands/skills/update.test.ts` with fixtures and tests that
exercise the updater through a dependency-injected temp filesystem. Include
these imports and dependency object:

```ts
import assert from "node:assert/strict";
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PATCHMILL_RECOMMENDED_SKILL_PACK,
  SKILL_PACK_METADATA_FILE,
  hashText,
  type SkillPackMetadataFile,
} from "../../../workflow/skill-pack.ts";
import type { SkillInstallerDependencies } from "../init/skill-installer.ts";
import { updateProjectSkills } from "./update.ts";

const dependencies: SkillInstallerDependencies = {
  access,
  chmod,
  cp,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
};
```

Add helpers `tempRoot()`, `writeFileEnsuringParent()`, `writeSkill()`,
`writeMetadata()`, and `oldMetadata()` so tests can install a fake old pack and
fake bundled source roots. Then add these six tests:

```ts
test("updateProjectSkills updates clean managed project-local skills", async () => {
  // old metadata contains writing-plans/SKILL.md and obsolete-skill/SKILL.md.
  // bundled source contains writing-plans/SKILL.md plus writing-plans/notes.md.
  // assert status "updated", old version -> current pack version, 2 updated files,
  // 1 removed file, copied file contents, removed obsolete file, and sorted new metadata.
});

test("updateProjectSkills reports already current packs", async () => {
  // metadata version/source/files match the bundled pack.
  // assert { status: "up-to-date", version: PATCHMILL_RECOMMENDED_SKILL_PACK.version }.
});

test("updateProjectSkills aborts when managed files changed locally", async () => {
  // metadata hash records old content, actual file contains "local edit\n".
  // assert rejection starts with "Refusing to update customized project-local skills:" and lists the path.
  // assert local file content is unchanged.
});

test("updateProjectSkills aborts when managed files are missing", async () => {
  // metadata records writing-plans/SKILL.md but the file is absent.
  // assert rejection lists ".patchmill/skills/writing-plans/SKILL.md (missing)".
});

test("updateProjectSkills requires Patchmill-managed project-local metadata", async () => {
  // no metadata file exists.
  // assert rejection equals the two-line missing metadata message from the spec.
});

test("updateProjectSkills aborts when new bundled files would overwrite local files", async () => {
  // old metadata records only SKILL.md; bundled pack adds new-file.md;
  // local untracked new-file.md already exists.
  // assert rejection starts with "Refusing to overwrite unmanaged project-local skill files:".
});
```

Use exact expected messages from the spec:

```text
No Patchmill-managed project-local skill pack found. Run `patchmill init` first,
or reinstall project-local skills.
```

```text
Refusing to update customized project-local skills:
- .patchmill/skills/writing-plans/SKILL.md
```

```text
Refusing to overwrite unmanaged project-local skill files:
- .patchmill/skills/writing-plans/new-file.md
```

- [ ] **Step 3: Run updater tests and confirm the expected failure**

Run:

```sh
node --test src/cli/commands/skills/update.test.ts
```

Expected: fails because `src/cli/commands/skills/update.ts` does not exist yet.

- [ ] **Step 4: Implement `updateProjectSkills()`**

Create `src/cli/commands/skills/update.ts` with these exported interfaces:

```ts
export type SkillPackUpdateResult =
  | { status: "up-to-date"; version: string }
  | {
      status: "updated";
      fromVersion: string;
      toVersion: string;
      updatedFiles: number;
      removedFiles: number;
    };

export type SkillPackUpdateOptions = {
  repoRoot: string;
  sourceRoots?: SourceRoots;
  packSkills?: SkillPackSkill[];
  installedAt?: string;
  dependencies?: SkillInstallerDependencies;
};

export async function updateProjectSkills(
  options: SkillPackUpdateOptions,
): Promise<SkillPackUpdateResult>;
```

Implementation requirements:

1. Import `DEFAULT_PROJECT_SKILL_DIR`, `PATCHMILL_RECOMMENDED_SKILL_PACK`,
   `SKILL_PACK_METADATA_FILE`, `buildSkillPackMetadata`, `hashContent`,
   `projectSkillPath`, and metadata/skill types from
   `../../../workflow/skill-pack.ts`.
2. Import `defaultSkillSourceRoots`, `SourceRoots`, and
   `SkillInstallerDependencies` from `../init/skill-installer.ts`.
3. Read metadata from
   `resolve(repoRoot, DEFAULT_PROJECT_SKILL_DIR, SKILL_PACK_METADATA_FILE)` and
   convert parse/read failures to the two-line missing metadata message.
4. Validate `metadata.pack.name`, `metadata.skillDir`, `metadata.metadataFile`,
   and `metadata.files` before trusting it.
5. Hash every old metadata file with `hashContent(await readFile(path))`;
   missing files should be reported as `path (missing)`, unreadable or changed
   files as `path`.
6. Enumerate bundled files recursively from each `packSkills` source root,
   require `SKILL.md` to exist, normalize metadata paths with POSIX `/`, and
   sort by path.
7. Detect unmanaged new-file collisions by checking bundled paths absent from
   old metadata that already exist under `repoRoot`.
8. Build new metadata with
   `buildSkillPackMetadata(newFiles, { installedAt, skillDir: DEFAULT_PROJECT_SKILL_DIR })`.
9. Return `up-to-date` when old version, old source, and old file hash list
   match new metadata.
10. Otherwise remove obsolete old managed files, copy each bundled skill
    directory into its target with
    `cp(..., { recursive: true, force: true, errorOnExist: false })`, write new
    metadata, and return updated counts.

Use helper names that make the safety boundaries clear: `readInstalledMetadata`,
`assertPatchmillManagedProjectLocal`, `customizedManagedFiles`,
`collectBundledPackFiles`, `unmanagedNewFileCollisions`,
`removeObsoleteManagedFiles`, and `copyBundledSkills`.

- [ ] **Step 5: Run and fix updater tests**

Run:

```sh
node --test src/cli/commands/skills/update.test.ts src/workflow/skill-pack.test.ts
```

Expected: all tests pass. If `src/workflow/skill-pack.test.ts` fails, preserve
its assertions that the current bundled source is `obra/superpowers` tag
`v6.0.3` and pack version `2026.05`; only adjust type-facing code.

- [ ] **Step 6: Commit Task 1**

Run:

```sh
git add src/workflow/skill-pack.ts src/cli/commands/skills/update.ts src/cli/commands/skills/update.test.ts
git commit -m "feat(skills): update managed project skills"
```

### Task 2: Add the `patchmill skills` CLI namespace

**Files:**

- Create: `src/cli/commands/skills/main.ts`
- Create: `src/cli/commands/skills/main.test.ts`
- Modify: `src/cli/main.ts`
- Modify: `src/cli/main.test.ts`

- [ ] **Step 1: Write failing skills command tests**

Create `src/cli/commands/skills/main.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { HELP_TEXT, runSkills } from "./main.ts";

const updatedResult = {
  status: "updated" as const,
  fromVersion: "2026.04",
  toVersion: "2026.05",
  updatedFiles: 14,
  removedFiles: 2,
};

test("runSkills prints help", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(
    await runSkills(["--help"], {
      output: {
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      },
      updateProjectSkills: async () => updatedResult,
    }),
    0,
  );

  assert.deepEqual(stdout, [HELP_TEXT]);
  assert.deepEqual(stderr, []);
});

test("runSkills updates project-local skills", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const calls: string[] = [];

  assert.equal(
    await runSkills(["update"], {
      repoRoot: "/repo",
      output: {
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      },
      updateProjectSkills: async (options) => {
        calls.push(options.repoRoot);
        return updatedResult;
      },
    }),
    0,
  );

  assert.deepEqual(calls, ["/repo"]);
  assert.deepEqual(stdout, [
    "Updated Patchmill skill pack 2026.04 -> 2026.05.",
    "Updated 14 files, removed 2 obsolete files.",
    "Run git diff to review changes.",
  ]);
  assert.deepEqual(stderr, []);
});

test("runSkills reports already current packs", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(
    await runSkills(["update"], {
      output: {
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      },
      updateProjectSkills: async () => ({
        status: "up-to-date",
        version: "2026.05",
      }),
    }),
    0,
  );

  assert.deepEqual(stdout, ["Patchmill skill pack is already up to date."]);
  assert.deepEqual(stderr, []);
});

test("runSkills rejects unknown subcommands", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(
    await runSkills(["reset"], {
      output: {
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      },
      updateProjectSkills: async () => updatedResult,
    }),
    1,
  );

  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ["Unknown skills command: reset", HELP_TEXT]);
});

test("runSkills rejects update arguments", async () => {
  await assert.rejects(
    runSkills(["update", "--dry-run"], {
      updateProjectSkills: async () => updatedResult,
    }),
    /patchmill skills update does not accept arguments/u,
  );
});
```

- [ ] **Step 2: Run skills command tests and confirm the expected failure**

Run:

```sh
node --test src/cli/commands/skills/main.test.ts
```

Expected: fails because `src/cli/commands/skills/main.ts` does not exist yet.

- [ ] **Step 3: Implement `src/cli/commands/skills/main.ts`**

Create `src/cli/commands/skills/main.ts`:

```ts
#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  updateProjectSkills as defaultUpdateProjectSkills,
  type SkillPackUpdateOptions,
  type SkillPackUpdateResult,
} from "./update.ts";

export const HELP_TEXT = `Usage:
  patchmill skills update

Manage Patchmill project-local skills.

Commands:
  update  Update Patchmill-managed project-local skills.
`;

export type SkillsCommandOutput = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export type SkillsCommandOptions = {
  repoRoot?: string;
  output?: SkillsCommandOutput;
  updateProjectSkills?: (
    options: SkillPackUpdateOptions,
  ) => Promise<SkillPackUpdateResult>;
};

const DEFAULT_OUTPUT: SkillsCommandOutput = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

function isHelp(arg: string | undefined): boolean {
  return !arg || arg === "--help" || arg === "-h" || arg === "help";
}

function formatCount(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function printUpdateResult(
  output: SkillsCommandOutput,
  result: SkillPackUpdateResult,
): void {
  if (result.status === "up-to-date") {
    output.stdout("Patchmill skill pack is already up to date.");
    return;
  }

  output.stdout(
    `Updated Patchmill skill pack ${result.fromVersion} -> ${result.toVersion}.`,
  );
  output.stdout(
    `Updated ${formatCount(result.updatedFiles, "file")}, removed ${formatCount(
      result.removedFiles,
      "obsolete file",
    )}.`,
  );
  output.stdout("Run git diff to review changes.");
}

export async function runSkills(
  args: string[],
  options: SkillsCommandOptions = {},
): Promise<number> {
  const output = options.output ?? DEFAULT_OUTPUT;
  const subcommand = args[0];
  if (isHelp(subcommand)) {
    output.stdout(HELP_TEXT);
    return 0;
  }

  if (subcommand !== "update") {
    output.stderr(`Unknown skills command: ${subcommand}`);
    output.stderr(HELP_TEXT);
    return 1;
  }

  if (args.length > 1) {
    throw new Error("patchmill skills update does not accept arguments");
  }

  const updateProjectSkills =
    options.updateProjectSkills ?? defaultUpdateProjectSkills;
  const result = await updateProjectSkills({
    repoRoot: options.repoRoot ?? process.cwd(),
  });
  printUpdateResult(output, result);
  return 0;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    return await runSkills(args);
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

- [ ] **Step 4: Run skills command tests**

Run:

```sh
node --test src/cli/commands/skills/main.test.ts src/cli/commands/skills/update.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Write failing top-level CLI routing tests**

Modify `src/cli/main.test.ts`.

Add this test near other `resolveCommand maps ...` tests:

```ts
test("resolveCommand maps skills to the public command name", () => {
  assert.deepEqual(resolveCommand(["skills", "update"], ["skills"]), {
    command: "skills",
    args: ["update"],
  });
});
```

In `createCliMain prints top-level help`, add:

```ts
assert.match(HELP_TEXT, /skills\s+Manage Patchmill project-local skills\./);
```

Add this dispatch test near other `createCliMain dispatches ...` tests:

```ts
test("createCliMain dispatches skills command", async () => {
  const calls: string[][] = [];
  const main = createCliMain(
    new Map([
      [
        "skills",
        async (args) => {
          calls.push(args);
          return 0;
        },
      ],
    ]),
  );

  assert.equal(await main(["skills", "update"]), 0);
  assert.deepEqual(calls, [["update"]]);
});
```

Run:

```sh
node --test src/cli/main.test.ts
```

Expected: fails because top-level help and routing do not include `skills` yet.

- [ ] **Step 6: Wire `skills` into the top-level CLI**

Modify `src/cli/main.ts`:

1. Add the import:

   ```ts
   import { main as skillsMain } from "./commands/skills/main.ts";
   ```

2. Add this help line before `version`:

   ```text
     skills      Manage Patchmill project-local skills.
   ```

3. Add this `COMMANDS` entry:

   ```ts
   ["skills", skillsMain],
   ```

- [ ] **Step 7: Run top-level and skills command tests**

Run:

```sh
node --test src/cli/main.test.ts src/cli/commands/skills/main.test.ts src/cli/commands/skills/update.test.ts
```

Expected: all tests pass.

- [ ] **Step 8: Commit Task 2**

Run:

```sh
git add src/cli/main.ts src/cli/main.test.ts src/cli/commands/skills/main.ts src/cli/commands/skills/main.test.ts
git commit -m "feat(cli): add skills update command"
```

### Task 3: Document how maintainers update project-local skills

**Files:**

- Modify: `README.md`
- Modify: `docs/skills.md`

- [ ] **Step 1: Update README**

In `README.md`, after the paragraph ending with “consider committing
`patchmill.config.json` and `.patchmill/skills/` explicitly.”, add:

````md
To update a repository after Patchmill publishes a newer bundled skill pack,
run:

```sh
npx patchmill@latest skills update
```

The update command only changes Patchmill-managed project-local skills. It stops
if managed skill files were edited locally. After a successful update, run
`git diff` and commit the skill changes with the repository.
````

- [ ] **Step 2: Update `docs/skills.md`**

In `docs/skills.md`, after the paragraph ending with “`.patchmill/skills/`
explicitly.”, add:

````md
### Updating project-local skills

When Patchmill publishes a newer bundled skill pack, update a repository with
the latest CLI:

```sh
npx patchmill@latest skills update
```

The command only updates Patchmill-managed project-local skills under
`.patchmill/skills/`. It refuses to run if managed skill files were edited or
removed locally. Review the resulting `git diff`, then commit the skill changes
with the repository.
````

- [ ] **Step 3: Run markdown lint**

Run:

```sh
npm run lint:md -- README.md docs/skills.md docs/specs/2026-06-30-issue-59-add-skill-pack-update-command-design.md docs/plans/2026-06-30-issue-59-add-skill-pack-update-command.md
```

Expected: `Summary: 0 error(s)`.

- [ ] **Step 4: Commit Task 3**

Run:

```sh
git add README.md docs/skills.md
git commit -m "docs(skills): explain skill pack updates"
```

### Task 4: Run focused verification and final review

**Files:**

- Modify only if verification exposes a bug in files changed by Tasks 1-3.

- [ ] **Step 1: Run focused automated tests**

Run:

```sh
node --test src/workflow/skill-pack.test.ts src/cli/commands/init/skill-installer.test.ts src/cli/commands/skills/*.test.ts src/cli/main.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run TypeScript lint**

Run:

```sh
npm run lint:ts
```

Expected: exits 0 with no ESLint errors.

- [ ] **Step 3: Run markdown lint**

Run:

```sh
npm run lint:md
```

Expected: `Summary: 0 error(s)`.

- [ ] **Step 4: Run full test suite**

Run:

```sh
npm test
```

Expected: pass. If it fails only in `test-support/npm-shrinkwrap.test.ts` with
missing nested `@earendil-works/*@0.77.0` integrity entries, record that as
pre-existing and keep the focused test results from Step 1 as feature
verification.

- [ ] **Step 5: Verify skill-pack integration required by AGENTS.md**

Run:

```sh
node --input-type=module <<'EOF'
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { access, readFile } from "node:fs/promises";
import { PATCHMILL_RECOMMENDED_SKILL_PACK } from "./src/workflow/skill-pack.ts";
import { bundledTriageSkillPath } from "./src/workflow/skills.ts";

const require = createRequire(import.meta.url);
const superpowersRoot = dirname(require.resolve("superpowers/package.json"));
const patchmillSkillsDir = resolve(dirname(bundledTriageSkillPath()), "..");
const roots = {
  patchmill: patchmillSkillsDir,
  superpowers: join(superpowersRoot, "skills"),
};
for (const skill of PATCHMILL_RECOMMENDED_SKILL_PACK.skills) {
  await access(join(roots[skill.source], skill.name, "SKILL.md"));
}
const superpowersPackage = JSON.parse(
  await readFile(join(superpowersRoot, "package.json"), "utf8"),
);
console.log(JSON.stringify({
  packVersion: PATCHMILL_RECOMMENDED_SKILL_PACK.version,
  sourceTag: PATCHMILL_RECOMMENDED_SKILL_PACK.source.tag,
  superpowersVersion: superpowersPackage.version,
  checkedSkills: PATCHMILL_RECOMMENDED_SKILL_PACK.skills.length,
}, null, 2));
EOF
```

Expected: command prints the current pack version, source tag, installed
`superpowers` package version, and checked skill count without throwing. Confirm
the tag/version also match assertions in `src/workflow/skill-pack.test.ts` and
any package lock metadata. If package files changed unexpectedly, run the
project Nix build before handoff.

- [ ] **Step 6: Inspect the final diff**

Run:

```sh
git status --short
git diff --stat HEAD~3..HEAD
git diff -- src/cli/commands/skills/update.ts src/cli/commands/skills/main.ts README.md docs/skills.md
```

Expected: only skill update command, tests, and docs changed.

- [ ] **Step 7: Commit final fixes only if needed**

If Steps 1-6 required fixes, run:

```sh
git add src/workflow/skill-pack.ts src/cli/main.ts src/cli/main.test.ts src/cli/commands/skills README.md docs/skills.md
git commit -m "fix(skills): polish update command"
```

If no fixes were needed, do not create an empty commit.

## Self-Review Notes

- Spec coverage: The plan includes command routing, metadata validation, hash
  preflight, missing/dirty/unreadable behavior, unmanaged collision checks,
  already-current behavior, copy/remove/metadata update behavior, docs, and
  verification.
- Placeholder scan: Each task has explicit files, commands, expected outcomes,
  and code or test structure. No `TBD` or open-ended implementation placeholders
  remain.
- Type consistency: `SkillPackUpdateOptions`, `SkillPackUpdateResult`,
  `SourceRoots`, `SkillInstallerDependencies`, and metadata helper names match
  the planned imports and usage across tasks.
