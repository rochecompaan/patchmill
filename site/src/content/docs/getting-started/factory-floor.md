---
title: Factory floor
description:
  The stations an issue passes through, from the receiving dock to a merged pull
  request.
---

Patchmill works like a factory floor. An issue enters at the receiving dock and
leaves as a merged pull request. This page shows each station on the way and the
code or skill that runs it. Each station links to the page that describes it in
detail. For the skills that each phase loads, see
[Skills workflow](/reference/skills-workflow/).

## High-level view

```mermaid
---
config:
  flowchart:
    wrappingWidth: 420
  themeCSS: ".nodeLabel { display: inline-block; width: 380px; }"
---
flowchart TD
    s0["🏗️ <b>0 · Commissioning</b><br/>Set up config, skills, model, and labels once"]
    s1["📦 <b>1 · Receiving Dock</b><br/>Open issues arrive from the issue tracker"]
    s2["🔍 <b>2 · Triage</b><br/>Label issues ready, needs-info, or unsuitable"]
    s3["🧹 <b>3 · Pre-shift Maintenance</b><br/>Clean up merged work, fix conflicting PRs"]
    s4["📋 <b>4 · Dispatch & Claim</b><br/>Claim the oldest unblocked ready issue"]
    s5["🧭 <b>5 · Foreman</b><br/>Read git and the host to choose the next step"]
    s6["📐 <b>6 · Design Office</b><br/>The agent writes the spec and the plan"]
    s7["🔩 <b>7 · Assembly Line</b><br/>The agent builds, tests, reviews, and passes CI"]
    s8["✅ <b>8 · Final Inspection</b><br/>The kernel verifies the PR closes the issue"]
    s9["🚚 <b>9 · Shipping</b><br/>Label agent-done, post summary and cost"]
    s10["👤 <b>10 · Customer Acceptance</b><br/>You review and merge, then Patchmill cleans up"]

    s0 --> s1 --> s2 --> s3 --> s4 --> s5 --> s6 --> s7 --> s8 --> s9 --> s10

    classDef human fill:#fde68a,stroke:#b45309,color:#000
    classDef done fill:#bbf7d0,stroke:#15803d,color:#000
    class s10 human
    class s9 done
```

## Stations

| #   | Station                                                                         | Code                                                       | What happens                                                                                                           |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 0   | [Commissioning](/getting-started/quickstart/)                                   | `init`, `auth`, `labels setup`, `doctor`                   | You set up the factory once.                                                                                           |
| 1   | [Receiving dock](/getting-started/configuration/#host-and-trust)                | host CLI (`gh` / `tea`)                                    | Open issues arrive as raw material.                                                                                    |
| 2   | [Triage](/using-patchmill/triage/)                                              | `src/kernel/triage.ts`, `patchmill-issue-triage`           | Each issue gets `agent-ready`, `needs-info`, or `agent-unsuitable`. Triage adds blocker links.                         |
| 3   | [Pre-shift maintenance](/using-patchmill/run/#merge-conflicts)                  | `src/kernel/merged-cleanup-sweep.ts`, `merge-conflicts.ts` | Patchmill cleans up merged issues. A `done` pull request that now conflicts with the base is fixed before new work.    |
| 4   | [Dispatch and claim](/using-patchmill/run-once/#claim-and-release)              | `src/kernel/issue-selection.ts`, `src/kernel/lock.ts`      | Patchmill picks the oldest ready issue with all blockers closed, locks it, and labels it `in-progress`.                |
| 5   | [Foreman](/using-patchmill/run-once/#phase-derivation)                          | `src/kernel/facts.ts`, `src/kernel/phase.ts`               | `derivePhase` reads git and the host to choose the next step. It keeps no remembered state.                            |
| 6   | [Design office](/reference/agent-workflow-lifecycle/#human-review-and-merge)    | `src/kernel/planning-workspace.ts`, `patchmill-planning`   | The agent writes the spec, then the plan. Each optional planning gate opens a planning pull request.                   |
| 7   | [Assembly line](/reference/skills-workflow/#implementation)                     | `patchmill-implementation`                                 | The agent prepares, builds, gets a reviewer subagent review, opens a draft pull request, and repairs CI at most twice. |
| 8   | [Final inspection](/using-patchmill/run-once/#outcome-checks)                   | `src/kernel/verify.ts`                                     | The kernel checks the pull request itself. The agent's "done" is not enough.                                           |
| 9   | [Shipping](/using-patchmill/run-once/#cost-reporting)                           | `src/kernel/publish.ts`                                    | Patchmill labels the issue `agent-done`, posts a comment with the cost, and writes `result.json`.                      |
| 10  | [Customer acceptance](/reference/agent-workflow-lifecycle/#cleanup-after-merge) | none                                                       | You review and merge. `src/kernel/merged-cleanup.ts` then removes the worktrees.                                       |

## Detailed view

```mermaid
flowchart TD
    %% ───────────── ONE-TIME COMMISSIONING ─────────────
    subgraph S0["🏗️ Station 0 · Commissioning (one time)"]
        direction LR
        init["patchmill init<br/>config + skill pack"] --> auth["patchmill auth<br/>model provider"] --> labels["labels setup<br/>workflow labels"] --> doctor["patchmill doctor<br/>preflight checks"]
    end

    %% ───────────── RECEIVING ─────────────
    subgraph S1["📦 Station 1 · Receiving Dock"]
        raw[("Open issues<br/>GitHub / Forgejo / Gitea")]
    end

    %% ───────────── INSPECTION ─────────────
    subgraph S2["🔍 Station 2 · Incoming Inspection — Triage<br/>skill: patchmill-issue-triage"]
        triage{"Agent classifies issue<br/>returns label, comment, blockedBy"}
        ready["🏷️ agent-ready<br/>+ native Blocked-by links"]
        needsinfo["🏷️ needs-info<br/>questions posted"]
        unsuitable["🏷️ agent-unsuitable<br/>leaves the line"]
    end

    %% ───────────── PRE-SHIFT ─────────────
    subgraph S3["🧹 Station 3 · Pre-shift Maintenance"]
        sweep["Sweep merged issues<br/>remove stale worktrees + branches"]
        conflict{"Any agent-done PR<br/>conflicting with base?<br/>(unattended only)"}
        rework["🔧 Rework line<br/>agent merges base into issue branch"]
    end

    %% ───────────── DISPATCH ─────────────
    subgraph S4["📋 Station 4 · Dispatch & Claim"]
        select{"Select issue<br/>oldest ready / in-progress<br/>with all blockers closed"}
        claim["Take per-issue lock<br/>🏷️ in-progress<br/>open run dir"]
    end

    %% ───────────── FOREMAN ─────────────
    subgraph S5["🧭 Station 5 · Foreman — Derive Next Step<br/>(max 3 sessions without a human)"]
        facts["Provision worktree<br/>collect facts from git + host:<br/>stage, branch, spec, plan, PR"]
        derive{"derivePhase"}
    end

    %% ───────────── DESIGN ─────────────
    subgraph S6["📐 Station 6 · Design Office — Planning<br/>skill: patchmill-planning"]
        spec["Stage spec<br/>write the spec"]
        plan["Stage plan<br/>write and review the plan"]
        gate{"Spec gate<br/>required?"}
        gate2{"Plan gate<br/>required?"}
        planpr["Open planning PR<br/>Refs #N, never Closes"]
        nogate["Commit spec + plan to<br/>the implementation branch"]
        vplan{"QC: verify planning<br/>branch pushed, spec + plan paths,<br/>planning PR valid"}
    end

    %% ───────────── HUMAN GATE ─────────────
    gatewait["⏸️ Gate wait<br/>🏷️ stays in-progress<br/>human must MERGE planning PR"]

    %% ───────────── ASSEMBLY ─────────────
    subgraph S7["🔩 Station 7 · Assembly Line — Implementation<br/>skill: patchmill-implementation"]
        prep["Prepare<br/>read AGENTS.md, issue, spec, plan<br/>set up env, baseline tests"]
        build["Build<br/>follow the plan, run tests"]
        review["Independent review<br/>fresh-context reviewer subagent"]
        push["Commit + push issue branch<br/>open DRAFT PR"]
        ci{"CI checks pass<br/>on current head?"}
        repair["Repair pass<br/>max 2"]
        readypr["PR body: Closes #N<br/>rulings, findings, validation<br/>mark READY"]
    end

    %% ───────────── FINAL QC ─────────────
    subgraph S8["✅ Station 8 · Final Inspection — Kernel Verify"]
        vimpl{"PR exists, open, not draft,<br/>targets base, closes #N,<br/>no conflict gaps?"}
    end

    %% ───────────── SHIPPING ─────────────
    subgraph S9["🚚 Station 9 · Shipping"]
        publish["Publish stop<br/>🏷️ agent-done + comment<br/>cost summary, result.json"]
    end

    %% ───────────── CUSTOMER ─────────────
    subgraph S10["👤 Station 10 · Customer Acceptance"]
        humanreview["Human reviews PR"]
        merged["Human merges<br/>issue closes"]
    end

    %% ───────────── HOLD / IDLE / CLEANUP ─────────────
    hold["🛑 Hold bin<br/>🏷️ needs-info + comment<br/>agent failed, needs-input,<br/>no progress, wrong PR target"]
    idle["💤 Idle backoff"]
    cleanup["🧽 Cleanup<br/>remove worktrees + local branches<br/>run cleanupHook"]

    %% ═══════════ FLOW ═══════════
    S0 --> raw
    raw --> triage
    triage -->|clear, automatable| ready
    triage -->|missing facts| needsinfo
    triage -->|unsafe / manual| unsuitable
    needsinfo -.->|"trusted author replies<br/>→ re-triage"| triage

    ready --> sweep
    sweep --> conflict
    conflict -->|yes| rework
    rework --> claim
    conflict -->|no| select
    select -->|none eligible| idle
    select -->|picked| claim
    claim --> facts --> derive

    derive -->|"stage spec / plan,<br/>or spec/plan missing"| spec
    derive -->|planning PR open| gatewait
    derive -->|spec + plan present| prep
    derive -->|impl PR merged| cleanup
    derive -->|PR closed / wrong target| hold

    spec --> gate
    gate -->|yes| planpr
    gate -->|no| plan
    plan --> gate2
    gate2 -->|yes| planpr
    gate2 -->|no| nogate
    planpr --> vplan
    nogate --> vplan
    vplan -->|planning PR open| gatewait
    vplan -->|advance| facts
    vplan -->|claim not verified| hold

    gatewait -->|"human merges planning PR,<br/>next run-once"| facts

    prep --> build --> review --> push --> ci
    ci -->|fail, caused by code| repair --> ci
    ci -->|"base / host / 3rd failure"| hold
    ci -->|pass| readypr
    readypr --> vimpl

    vimpl -->|yes| publish
    vimpl -->|no| hold
    publish --> humanreview
    humanreview -->|"requests changes →<br/>next run addresses review"| facts
    humanreview --> merged
    merged --> cleanup
    merged -.->|"later base drift<br/>conflicts open PR"| conflict

    hold -.->|"human answers<br/>→ re-triage"| triage

    idle -.->|"patchmill run loop:<br/>triage every N min,<br/>then next run-once"| raw
    cleanup -.->|next shift| select

    classDef human fill:#fde68a,stroke:#b45309,color:#000
    classDef stop fill:#fecaca,stroke:#b91c1c,color:#000
    classDef done fill:#bbf7d0,stroke:#15803d,color:#000
    class gatewait,humanreview,merged human
    class hold,unsuitable stop
    class publish,cleanup done
```

Yellow nodes wait for a human. Red nodes stop the run. Green nodes are the
finished product. The planning and implementation boxes show only the kernel's
view. See [Skills workflow](/reference/skills-workflow/) for the skills inside
each box, and [Agent workflow lifecycle](/reference/agent-workflow-lifecycle/)
for the rules behind the gate wait, the hold bin, and cleanup.

## Two loops

- The inner loop runs inside one
  [`patchmill run-once`](/using-patchmill/run-once/). After each agent session,
  the foreman chooses the next phase again. It stops after three sessions
  without a human.
- The outer loop is [`patchmill run`](/using-patchmill/run/). It repeats
  `run-once`, runs triage every `run.triageIntervalMinutes`, and waits longer
  between passes when no issue is eligible.

The diagram leaves out two details. Interactive runs (`run-once --interactive`
and Web sessions) add a chat approval dialog at each gate and an "approve
without a PR" shortcut. A pause (Ctrl-C or `SIGTERM`) keeps the issue
`in-progress`, and the next run continues it.
