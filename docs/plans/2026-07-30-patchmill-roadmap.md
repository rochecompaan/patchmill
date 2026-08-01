# Patchmill Public Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Patchmill's four-phase product roadmap and announce it from
the README without presenting planned capabilities as already available.

**Architecture:** Keep the complete public roadmap in `docs/roadmap.md`, which
is already covered by the npm package's `docs` file inclusion. Add only a short
announcement and relative link to `README.md` so the README stays introductory
and the roadmap has one canonical source.

**Tech Stack:** Markdown, Prettier 3.8.3, markdownlint-cli2 0.22.1

## Global Constraints

- Implement the approved design in
  `docs/specs/2026-07-30-patchmill-roadmap-design.md`.
- Organize the roadmap as four ordered, outcome-based phases with no release
  dates or version assignments.
- Describe listed features as candidate capabilities and current direction, not
  guaranteed commitments.
- Preserve local-first operation as a first-class option after dashboard and
  cloud deployment capabilities exist.
- State that Kubernetes is an execution backend, not a requirement or
  Patchmill's core architecture.
- Do not present `patchmill run`, Linear, local trackers, the dashboard, or
  cloud workers as currently available.
- Keep the README announcement concise and link it to the canonical roadmap.
- Do not add automated tests for static documentation text. Use formatting,
  Markdown linting, link/path checks, and direct review instead, as required by
  the Testing Value Gate.

## File Structure

- Create `docs/roadmap.md` as the canonical public roadmap, including
  principles, four phases, scope boundaries, and a feedback invitation.
- Modify `README.md` to announce the roadmap and link to `docs/roadmap.md` after
  the existing Documentation section.

---

### Task 1: Publish the canonical roadmap

**Files:**

- Create: `docs/roadmap.md`
- Reference: `docs/specs/2026-07-30-patchmill-roadmap-design.md`

**Interfaces:**

- Consumes: The approved product narrative, phase outcomes, candidate
  capabilities, and scope boundaries from the design specification.
- Produces: The canonical `docs/roadmap.md` target that the README links to in
  Task 2.

- [ ] **Step 1: Create the canonical roadmap with the approved public copy**

Create `docs/roadmap.md` with exactly this content:

```markdown
# Patchmill Roadmap

Patchmill is growing from a supervised local workflow into a safe, extensible,
cloud-operated software factory. The roadmap follows four stages: operate
unattended safely, bring work from more sources, see and direct the factory from
a unified control plane, and run isolated workers in managed infrastructure.

> This roadmap describes Patchmill's current direction, not a release or version
> commitment. Ordering and details may change as the architecture is validated
> and maintainers learn from real-world use.

## Principles

- Organize work around user outcomes rather than internal projects.
- Establish safety, observability, and human control before increasing autonomy
  or scale.
- Keep local-first operation available as shared and remote deployment options
  grow.
- Build durable boundaries that support later phases without requiring earlier
  workflows to be replaced.
- Treat every capability below as a candidate until its dedicated design is
  approved.

## Phase I: Operate unattended, safely

**Outcome:** A maintainer can leave Patchmill running under a process supervisor
without risking duplicate work or uncontrolled spending.

Candidate capabilities include:

- A continuous `patchmill run` command built around the existing atomic
  `run-once` workflow.
- One issue at a time by default, with safe configurable concurrency later.
- Idle polling with configurable intervals, backoff, and jitter.
- Graceful shutdown, pause, resume, and drain controls.
- Single-instance locking and durable resumable run state.
- Daily and weekly token and estimated US dollar budgets.
- An initial budget policy that finishes the current issue, then stops before
  selecting another.
- Configurable budget stopping boundaries in later iterations.
- Repeated-failure circuit breakers and issue quarantine.
- Notification hooks for blockers, approvals, failures, and budget limits.
- A structured event, usage, and audit ledger.

Cost limits will use Patchmill's recorded model usage and estimated cost. They
will not claim exact equivalence with provider billing or guarantee that every
provider request can be interrupted at an exact billing boundary.

## Phase II: Bring work from anywhere

**Outcome:** Teams can keep product work in one system and source code in
another.

Candidate capabilities include:

- Independent work-source and code-host configuration.
- Provider-qualified issue identities rather than numeric-only issue numbers.
- A built-in Linear work source.
- A generic local-command adapter with a documented JSON protocol.
- Beads as the reference local tracker integration.
- Capability discovery and adapter conformance tests.
- Priority, dependency, and readiness signals across work sources.

A public plugin SDK will wait until built-in and local adapters have proven the
underlying contract. Kata and other local trackers can be evaluated after the
generic adapter works; they are not initial commitments.

## Phase III: See and direct the factory

**Outcome:** A maintainer can understand and direct Patchmill from one local
interface.

Candidate capabilities include:

- A local control-plane API and event stream.
- A unified kanban, list, and factory-status dashboard.
- Issue details, artifacts, run history, and agent timelines.
- Issue-centered conversations with an agent.
- Agent-drafted issues, specifications, and plans.
- Explicit approval for proposed workflow actions initially, with selected
  actions becoming optionally autonomous through policy later.
- An approval inbox and intervention controls.
- Pause, resume, drain, retry, and quarantine actions.
- Logs, token and cost breakdowns, budget status, and forecasting.

The first dashboard will be read-mostly: inspection, conversation, approval, and
essential operational controls come before a general workflow builder. Work will
remain central through board and list views, while active runs, queue health,
approvals, and budget state remain visible.

## Phase IV: Run the factory anywhere

**Outcome:** Teams primarily use a shared dashboard while Patchmill schedules
isolated workers into managed infrastructure.

Candidate capabilities include:

- A remote controller and shared dashboard.
- A durable database, event stream, queue, and worker leases.
- Containerized disposable agent workers.
- Kubernetes Jobs as an execution backend.
- Cancellation, recovery, autoscaling, and resource quotas.
- Scoped repository credentials and secrets.
- Filesystem, network, model, and tool policies for each sandbox.
- Central logs, artifacts, costs, and audit history.
- Authentication, role-based access control, projects, and multi-tenancy.
- Docker Compose and Helm deployment paths.

Kubernetes will be one execution backend, not Patchmill's core architecture.
Local operation will remain supported without requiring a cluster or hosted
service.

## How the phases build on each other

Phase I establishes the coordinator and event ledger around `run-once`. Phase II
normalizes work from independently configured work sources and code hosts. Phase
III exposes those capabilities through a stable local API and control plane.
Phase IV distributes the control plane and execution backend while preserving
the same domain boundaries.

Substantial roadmap capabilities will receive their own design and
implementation plan before development.

## Feedback and contributions

Feedback from maintainers and teams using Patchmill will shape the details
within each phase. To propose a use case, integration, or change in priority,
[open a GitHub issue](https://github.com/rochecompaan/patchmill/issues).
```

- [ ] **Step 2: Format the roadmap**

Run:

```bash
npx prettier --write docs/roadmap.md
```

Expected: Prettier reports `docs/roadmap.md` and exits successfully.

- [ ] **Step 3: Lint the roadmap**

Run:

```bash
npx markdownlint-cli2 docs/roadmap.md
```

Expected: exit 0 with `Summary: 0 error(s)`.

- [ ] **Step 4: Verify the public structure and commitment language directly**

Run:

```bash
node - <<'NODE'
const { readFileSync } = require("node:fs");
const roadmap = readFileSync("docs/roadmap.md", "utf8");
const required = [
  "## Phase I: Operate unattended, safely",
  "## Phase II: Bring work from anywhere",
  "## Phase III: See and direct the factory",
  "## Phase IV: Run the factory anywhere",
  "current direction, not a release or version",
  "Local operation will remain supported",
];
const missing = required.filter((text) => !roadmap.includes(text));
if (missing.length > 0) {
  console.error(`Missing roadmap language: ${missing.join(", ")}`);
  process.exit(1);
}
console.log("Roadmap structure and scope language verified");
NODE
```

Expected: `Roadmap structure and scope language verified`.

This is a one-off documentation check, not a new automated test.

- [ ] **Step 5: Inspect the roadmap diff and whitespace**

Run:

```bash
git diff --check
git diff -- docs/roadmap.md
```

Expected: `git diff --check` exits 0. The roadmap diff contains four phases,
uses candidate-capability language, makes local operation optional, and contains
no dates or version promises.

- [ ] **Step 6: Commit the canonical roadmap**

```bash
git add docs/roadmap.md
git commit -m "docs(roadmap): publish product direction"
```

Expected: one commit containing only `docs/roadmap.md`.

---

### Task 2: Announce the roadmap in the README

**Files:**

- Modify: `README.md:17-29`
- Verify: `docs/roadmap.md`

**Interfaces:**

- Consumes: The canonical relative link target `docs/roadmap.md` created in
  Task 1.
- Produces: A concise README announcement that directs GitHub and npm readers to
  the roadmap without duplicating it.

- [ ] **Step 1: Insert the Roadmap section after Documentation**

In `README.md`, replace this exact boundary:

```markdown
- [Run-once](https://patchmill.dev/using-patchmill/run-once/)

## Install
```

with:

```markdown
- [Run-once](https://patchmill.dev/using-patchmill/run-once/)

## Roadmap

Patchmill's roadmap moves from safe, unattended local operation to broader work
sources, a unified control plane, and cloud-operated agents running in isolated
sandboxes. The phases describe product direction rather than date or version
commitments.

Read the [Patchmill roadmap](docs/roadmap.md).

## Install
```

- [ ] **Step 2: Format the README and roadmap**

Run:

```bash
npx prettier --write README.md docs/roadmap.md
```

Expected: Prettier reports both Markdown files and exits successfully.

- [ ] **Step 3: Lint the changed Markdown files**

Run:

```bash
npx markdownlint-cli2 README.md docs/roadmap.md
```

Expected: exit 0 with `Summary: 0 error(s)`.

- [ ] **Step 4: Verify the README link and announcement boundary**

Run:

```bash
node - <<'NODE'
const { existsSync, readFileSync } = require("node:fs");
const readme = readFileSync("README.md", "utf8");
if (!readme.includes("## Roadmap\n")) {
  throw new Error("README Roadmap heading is missing");
}
if (!readme.includes("[Patchmill roadmap](docs/roadmap.md)")) {
  throw new Error("README roadmap link is missing");
}
if (!existsSync("docs/roadmap.md")) {
  throw new Error("README roadmap link target does not exist");
}
if (readme.indexOf("## Documentation") > readme.indexOf("## Roadmap")) {
  throw new Error("Roadmap must follow Documentation");
}
if (readme.indexOf("## Roadmap") > readme.indexOf("## Install")) {
  throw new Error("Roadmap must precede Install");
}
console.log("README roadmap announcement and link verified");
NODE
```

Expected: `README roadmap announcement and link verified`.

This is a one-off link and placement check, not a new automated test.

- [ ] **Step 5: Review the complete documentation diff**

Run:

```bash
git diff --check
git diff -- README.md docs/roadmap.md
```

Expected:

- `git diff --check` exits 0.
- The README adds only the concise Roadmap section.
- The existing Basic workflow and Main commands continue to list only current
  commands; `patchmill run` appears only in the roadmap as planned work.
- Linear, Beads, the dashboard, and cloud workers appear only as roadmap
  direction, not supported current features.

- [ ] **Step 6: Run final changed-file validation**

Run:

```bash
npx prettier --check README.md docs/roadmap.md
npx markdownlint-cli2 README.md docs/roadmap.md
git status --short
```

Expected:

- Prettier reports `All matched files use Prettier code style!`.
- Markdownlint reports `Summary: 0 error(s)`.
- `git status --short` lists only `M README.md` before the commit.

No new automated tests are added because the Testing Value Gate excludes static
documentation text. The clean 1,136-test baseline established in the worktree is
sufficient production-code evidence for this documentation-only change.

- [ ] **Step 7: Commit the README announcement**

```bash
git add README.md
git commit -m "docs(readme): announce product roadmap"
```

Expected: one commit containing only `README.md`, with the worktree clean after
the commit.
