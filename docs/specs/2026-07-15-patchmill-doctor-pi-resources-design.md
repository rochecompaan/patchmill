# `patchmill doctor` Pi resource summary design

## Goal

`patchmill doctor` should show the Pi resources Patchmill will use, in a compact
style similar to Pi's interactive startup resource summary:

```text
[Pi resources: run-once planning]
[Context]
  AGENTS.md

[Skills]
  writing-plans

[Prompts]
  /review-loop

[Extensions]
  pi-subagents, todos.ts
```

The report helps users diagnose why Patchmill-powered Pi runs see a specific
context file, skill, prompt template, or extension before they start a workflow.

## Non-goals

- Do not add a new flag. The sections are part of normal non-quiet
  `patchmill doctor` output.
- Do not reproduce Pi's expanded interactive grouping UI. `doctor` prints
  compact, terminal-friendly lists only.
- Do not make `doctor` mutate Pi settings, project trust, labels, git state, or
  package installations while collecting resources.
- Do not execute extension code merely to list resources.
- Do not replace the existing readiness checks. The resource summary is
  additive.

## Profiles to report

Patchmill has more than one Pi invocation shape, so doctor must not report a
single vague resource set. It should report these named resource profiles:

- `run-once planning`: mirrors the plan/spec prompt path through `runPiPrompt()`
  with normal context files, prompt templates, auto-discovered non-mutating
  resources, the Patchmill-injected `pi-subagents` and `todos.ts` extensions,
  and the configured planning skill.
- `run-once development-environment`: mirrors the development-environment prompt
  path through `runPiPrompt()` with the same context/extension behavior and the
  configured development-environment skill when present.
- `run-once implementation`: mirrors the implementation prompt path through
  `runPiPrompt()` with the same context/extension behavior and configured
  toolchain, implementation, review, visual-evidence, and landing skills when
  present.
- `triage`: mirrors triage dry-run and execute agents with `--no-context-files`,
  no Patchmill-injected run-once extensions, and the configured triage skill.
  Prompt templates, trusted auto-discovered skills, and trusted auto-discovered
  extensions still appear when Pi would load them for that invocation.

The provider smoke test remains a readiness check rather than a resource profile
because it is intentionally minimal and already reports as `pi provider`.

To prevent drift, define these profiles in shared code used by both doctor
discovery and the actual Pi invocation argument builders. If a future Patchmill
command adds a distinct Pi invocation shape, add a named profile beside the
invocation code and include it in doctor output.

## Non-mutating discovery boundary

Do not call `DefaultResourceLoader.reload()` for doctor resource listing. In
Pi's current implementation that path resolves package resources, may install
missing npm/git package sources, and loads extension modules. That violates
doctor's read-only contract.

Instead, resource discovery should use Pi's public non-mutating pieces directly:

- Construct a `SettingsManager` with the same trusted/untrusted state a
  non-interactive Pi run would use, without prompting and without writing trust
  decisions.
- Use `DefaultPackageManager.resolve(onMissing)` with `onMissing` returning
  `"skip"` so missing npm/git package sources are reported but not installed.
- Use `DefaultPackageManager.resolveExtensionSources()` only for Patchmill's
  known local extension paths that are already passed to Pi by the runtime
  profile. Do not use it for arbitrary package sources unless missing installs
  are also skipped.
- Use Pi's exported `loadSkills()` for enabled skill paths because it scans
  skill files without executing extensions.
- Derive prompt commands from enabled prompt-template file paths and their
  filenames. If Pi later exports a non-mutating prompt-template loader from the
  package root, prefer that API.
- Derive extension labels from enabled extension paths and metadata. Do not
  import or execute extension modules.

Because extension code is not executed, doctor will not list resources
dynamically contributed by `resources_discover` handlers. Report this limitation
as part of the profile summary diagnostics only when such dynamic resources
cannot be known; do not execute extensions to discover them.

## Project trust parity

Doctor resource discovery must match non-interactive Pi trust behavior as
closely as possible without prompting or writing trust state:

1. If the cwd has no trust-requiring project resources, treat project resources
   as trusted.
2. If `ProjectTrustStore(agentDir).get(repoRoot)` has a saved decision, use that
   decision.
3. Otherwise, load global settings only and honor `defaultProjectTrust`:
   `"always"` trusts project resources; `"ask"` and `"never"` do not.
4. Do not call the interactive trust prompt and do not write `trust.json`.

When project resources are untrusted, omit project `.pi` resources and ancestor
`.agents/skills` resources exactly as Pi's package/resource discovery does with
`projectTrusted: false`.

## Formatting

For each named profile with at least one resource, print:

```text
[Pi resources: <profile label>]

[Context]
  item, item

[Skills]
  item, item

[Prompts]
  /item, /item

[Extensions]
  item, item
```

Formatting rules:

- `[Context]`: comma-separated display paths for loaded context files, omitted
  for profiles with `--no-context-files`. Use repository-relative labels when
  possible, such as `AGENTS.md`.
- `[Skills]`: comma-separated skill names, sorted alphabetically.
- `[Prompts]`: comma-separated slash commands, sorted alphabetically, for
  example `/parallel-review`.
- `[Extensions]`: comma-separated compact extension labels. For ordinary paths
  use the filename, or the parent directory when the extension is
  `index.ts`/`index.js`. For package-backed paths, include a concise
  package/source label.

Only print resource categories that contain resources. Keep blank lines between
profile blocks, resource sections, and the existing doctor checklist.

## Quiet behavior

`patchmill doctor --quiet` keeps its existing meaning: suppress successful
non-failure output. Therefore:

- If all readiness checks pass and resource discovery only produced sections or
  warnings, `--quiet` prints nothing.
- If any required readiness check fails, `--quiet` prints the same report as
  non-quiet mode, including resource sections and `pi resources` warnings.
- Resource-only warnings do not make `doctor` fail and do not force output under
  `--quiet`.

Keep this policy centralized in the doctor report/output path rather than
scattering special-case conditionals across resource discovery.

## Diagnostics and failures

Resource discovery must not prevent doctor from running existing checks.

If non-mutating discovery skips missing package sources, add a warning check
named `pi resources` that lists the skipped sources and tells the user to run Pi
package installation/update outside doctor if they want those resources loaded.

If discovery succeeds but Pi reports static resource diagnostics, add a warning
check named `pi resources` with a concise summary and remediation to inspect or
fix the affected Pi resource.

If discovery throws unexpectedly, add a warning check named `pi resources`
saying Patchmill could not list Pi resources, include the error message, and
continue with existing doctor checks. This remains a warning because the
separate `pi` and `pi provider` checks determine whether Patchmill can invoke
Pi.

Existing required failures keep the current exit-code behavior. Resource-summary
warnings do not make `doctor` fail unless they also surface through an existing
required check.

## Tests

Add focused tests around profile construction, non-mutating discovery,
formatting, trust parity, and doctor integration:

- profile builders match the actual run-once and triage Pi invocation arguments;
- missing package sources are skipped and reported rather than installed;
- project resources are included or omitted according to saved
  trust/defaultProjectTrust parity;
- compact profile sections are included in normal doctor output when resource
  discovery returns context, skills, prompts, and extensions;
- empty resource categories are omitted;
- discovery warnings are rendered as a `pi resources` warning without changing
  successful doctor exit behavior;
- discovery exceptions are rendered as a warning and do not skip existing
  checks;
- `--quiet` suppresses resource-only output when no required check fails;
- existing doctor failure behavior remains unchanged when a readiness check
  fails.

Use stubs for the resource summary provider in doctor output tests so unit tests
do not load real user Pi resources. Avoid tests that assert the exact contents
of a developer's machine-specific Pi configuration.

## Verification

Run the existing doctor tests and full TypeScript test suite after
implementation:

```bash
npm test -- src/cli/commands/doctor/*.test.ts
npm test
```

Run `npm run lint` for formatting and type/lint validation. No dependency
changes are planned, so the Nix build requirement for dependency changes does
not apply.
