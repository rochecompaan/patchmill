---
title: Overview
description: Understand the kernel and its skills.
---

Patchmill advances one issue with Pi, git, and an issue host. The kernel
supervises Pi, claims and releases issues, derives the phase, checks the
outcome, and fixes names and paths. Skills provide the judgment.

A skill is a reusable set of agent instructions. Patchmill installs its skills
with pinned Superpowers and SimpleEnglish skills. Planning, implementation,
review, and visual evidence live in those instructions, not a second workflow
state machine.

## Planning merge gates

Spec and plan gates default off. With no gates, one branch and pull request
carry the spec, plan, and code. Each enabled gate uses a separate planning pull
request that a human must merge before the next stage. Review approval and issue
labels do not unlock these gates. The issue stays `in-progress` while waiting.

The kernel reads git and the host on every attempt. Local logs are outputs, not
resume instructions. `agent-done` means that a ready pull request closes the
issue. It does not mean that the pull request merged.

## Start here

Read the [quickstart](/getting-started/quickstart/),
[configuration](/getting-started/configuration/), and
[Run-once guide](/using-patchmill/run-once/).
