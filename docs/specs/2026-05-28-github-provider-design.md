# GitHub Provider Design

## Goal

Add GitHub as a first-class issue host provider for Patchmill while preserving
the existing Forgejo/`tea` behavior. Patchmill should support
`host.provider: "github-gh"` in `patchmill.config.json` and use the GitHub CLI
(`gh`) for deterministic issue, label, and comment I/O.

## Current direct host integration points

Patchmill currently couples host behavior to Forgejo/`tea` in these places:

- `src/config/types.ts` and `src/config/defaults.ts` constrain/default
  `host.provider` to `"forgejo-tea"`.
- `src/cli/commands/init/config-writer.ts` always infers `"forgejo-tea"`.
- `src/cli/commands/triage/forgejo.ts` contains direct `tea` command mappings
  for issue listing, comment hydration, label listing/creation/application, and
  issue comments.
- `src/cli/commands/triage/pipeline.ts` imports the Forgejo functions directly
  to fetch input issues and post-execution snapshots.
- `src/cli/commands/run-once/pipeline.ts` imports the Forgejo functions directly
  for issue selection, claim/block/done label transitions, and workflow
  comments.
- `src/cli/commands/doctor/checks.ts` directly checks `tea`, lists issues/labels
  with Forgejo functions, and prints `tea labels create ...` remediation.
- `src/host/forgejo-visual-evidence.ts` uploads PR visual evidence through
  Forgejo-specific APIs and environment variables.
- CLI help and internal config names still say `teaLogin`/Forgejo in
  `src/cli/commands/triage/main.ts`, `src/cli/commands/run-once/main.ts`, and
  related types.

## Skills versus provider code

Skills should remain responsible for judgment and workflow procedure:

- triage criteria and comments;
- planning and implementation workflow;
- review and visual evidence capture;
- landing decisions and host-specific PR creation guidance.

Skills should not replace deterministic host I/O that Patchmill needs for safety
and resumability:

- listing issues;
- reading labels and comments;
- snapshotting issue state before/after skill execution;
- creating missing automation labels;
- applying lifecycle labels;
- posting Patchmill workflow comments;
- doctor readiness checks;
- visual-evidence upload plumbing when supported by the provider.

Reason: those operations are part of Patchmill's state machine. They need typed
results, reliable errors, and tests. A skill can decide what should happen;
provider code should perform repeatable host reads/writes.

## Provider model

Introduce a provider ID union:

```ts
export type PatchmillHostProviderId = "forgejo-tea" | "github-gh";
```

Keep `host.login` for compatibility, but treat it as provider-specific:

- `forgejo-tea`: passed as `tea --login <name>` when present.
- `github-gh`: ignored for normal `gh` usage because `gh` uses its authenticated
  account. Future GitHub Enterprise support can add a host-specific option
  without changing provider semantics.

Use an `IssueHostProvider` interface for issue-host state I/O. Extend the
existing `src/host/types.ts` interface so the pipelines do not import Forgejo
functions directly:

```ts
export type IssueHostProvider = {
  readonly id: PatchmillHostProviderId;
  readonly displayName: string;
  checkCli(): Promise<
    | { ok: true; message: string }
    | { ok: false; message: string; remediation: string[] }
  >;
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

Add a factory, for example `src/host/factory.ts`:

```ts
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
      return new GitHubGhHostProvider({
        runner: options.runner,
        repoRoot: options.repoRoot,
      });
  }
}
```

## GitHub CLI command mapping

The first GitHub provider should use `gh`, not direct REST calls, to match the
current Forgejo/`tea` CLI-adapter style.

Required operations:

- CLI/auth check:
  - `gh --version`
  - `gh auth status`
- List open issues:
  - `gh issue list --state open --limit 1000 --json number,title,body,state,labels,author,updatedAt`
- View individual issue and comments:
  - `gh issue view <number> --json number,title,body,state,labels,author,updatedAt,comments`
- List labels:
  - `gh label list --limit 1000 --json name`
- Create label:
  - `gh label create <name> --color <hex-without-#> --description <description>`
- Apply labels:
  - `gh issue edit <number> --add-label <csv>`
  - `gh issue edit <number> --remove-label <csv>`
- Comment issue:
  - `gh issue comment <number> --body <body>`

Normalize GitHub payloads into the existing `IssueSummary` shape:

- `number` from `number`;
- `title` from `title`;
- `body` from `body ?? ""`;
- `state` as lower-case `OPEN`/`CLOSED` converted to `open`/`closed`;
- `labels` from `labels[].name`, sorted;
- `author` from `author.login`;
- `updated` from `updatedAt`;
- `comments` from `comments[]` objects when hydrated.

## Pipeline changes

Both `triage` and `run-once` should create a host provider from normalized
config and use it for all host operations.

`patchmill triage`:

1. Create provider from `config.host`.
2. Use `host.listOpenIssues()` for selection.
3. Use `host.hydrateIssueComments()` before passing issues to Pi.
4. After execute mode, use `host.listIssuesByNumbers()` and
   `host.hydrateIssueComments()` for observed-change reporting.

`patchmill run-once`:

1. Create provider from `config.host`.
2. Use `host.listOpenIssues()` for ready issue selection.
3. Use `host.listLabels()`/`host.createLabel()` to ensure lifecycle labels.
4. Use `host.applyLabels()` for ready → in-progress, in-progress → needs-info,
   in-progress → done, and plan-only label restoration.
5. Use `host.commentIssue()` for started, blocked, plan-ready, handoff, and
   unexpected-failure comments.

## Doctor changes

`patchmill doctor` should be provider-aware:

- For Forgejo: keep the current `tea` availability check and label remediation
  commands.
- For GitHub: check `gh --version` and `gh auth status`, list issues/labels
  through the provider, and print `gh label create ...` remediation commands.
- The unsupported-provider branch should only be reachable for invalid config,
  not for `github-gh`.

## Visual evidence

Keep Forgejo visual-evidence upload unchanged for `forgejo-tea`.

For `github-gh`, do not attempt binary attachment upload in the initial GitHub
provider. GitHub does not expose a simple issue/PR attachment API equivalent to
Forgejo's issue assets endpoint through `gh`. Patchmill already handles missing
uploaders by preserving local evidence entries and logging that host upload is
skipped.

Provider-aware behavior:

- `forgejo-tea` + Forgejo env vars: use `ForgejoVisualEvidenceUploader`.
- `github-gh`: return no default uploader and skip host upload with the existing
  message.
- Docs should state that GitHub visual evidence is recorded in Patchmill
  output/handoff data but not uploaded as host attachments in the first version.

## Init and configuration

`patchmill init` should infer provider from `origin` remote:

- GitHub remotes (`github.com:owner/repo`, `https://github.com/owner/repo`,
  `ssh://git@github.com/owner/repo`) → `github-gh`.
- Other remotes → current default `forgejo-tea` for backward compatibility.

Example GitHub config:

```json
{
  "host": {
    "provider": "github-gh",
    "login": ""
  }
}
```

If the codebase keeps `host.login` required for now, the generated GitHub value
can be an empty string. A later compatibility cleanup can make it optional.

## Compatibility

- Keep `--tea-login` as a deprecated alias for `--host-login`.
- Internally rename new code toward `host.login`/`hostLogin`; avoid expanding
  `teaLogin` usage.
- Preserve existing Forgejo tests and behavior.
- Make GitHub support additive: existing `patchmill.config.json` files should
  continue to load unchanged.

## Non-goals for the first GitHub provider

- Direct GitHub REST/GraphQL integration without `gh`.
- GitHub Enterprise host selection.
- GitHub visual evidence attachment upload.
- Replacing triage/landing skills with provider code.
- Closing issues automatically beyond what existing skills/provider interactions
  already support.
