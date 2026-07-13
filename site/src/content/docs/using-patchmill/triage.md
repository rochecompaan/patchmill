---
title: Triage
description:
  Use Patchmill triage to classify issues before agent implementation.
---

`patchmill triage` inspects open issues and decides whether each issue is ready
for automation. It uses your configured issue host, labels, triage state map,
and triage skill.

Start with a dry run:

```sh
patchmill triage --dry-run
```

Dry-run mode previews triage decisions without changing labels or comments on
the issue host.

## What triage selects

By default, triage looks at unclassified open issues and blocked issues that can
be rechecked. It skips most issues that already carry active triage or
protection labels, which keeps normal runs focused on work that needs a fresh
decision.

Useful selection options:

```sh
patchmill triage --issue 123 --dry-run
patchmill triage --limit 10 --dry-run
patchmill triage --all --dry-run
```

- `--issue <number>` checks one open issue.
- `--limit <number>` checks only the first selected issues.
- `--all` re-triages selected open issues and includes issues that already have
  triage or protection labels, such as in-progress work.

## Run triage for real

After the preview looks right, run triage without `--dry-run`:

```sh
patchmill triage
```

A normal run can apply configured labels and comments. It also writes triage run
logs under the configured triage log directory, which defaults to
`.patchmill/triage-runs/`.

Use `--log-dir <path>` when a local run needs a different log location.

## Read the outcomes

The exact labels are configurable, but the default outcomes are:

- `agent-ready`: the issue is clear enough for `patchmill run-once`.
- `needs-info`: the issue needs a human answer before automation should start.
- `agent-unsuitable`: the issue is not a good fit for Patchmill automation.
- `blocked`: the issue is suitable, but must wait for same-repository blockers.

For blocked issues, the triage agent should identify the blocking issue numbers.
Later triage runs can re-check those blockers and move the issue to ready when
they are closed.

## After triage

Once an issue has the configured ready label, use
[`patchmill run-once`](/using-patchmill/run-once/) to advance it through specs,
plans, implementation, review, evidence, and landing.
