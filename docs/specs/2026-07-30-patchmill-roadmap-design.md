# Patchmill Roadmap Design

**Status:** Approved

## Purpose

Patchmill needs a public roadmap that connects its next features into a coherent
product direction. The roadmap should explain how Patchmill can grow from a
supervised local workflow into a safe, extensible, cloud-operated software
factory without implying dates or fixed release commitments.

The immediate documentation change consists of:

- a canonical roadmap at `docs/roadmap.md`; and
- a concise roadmap announcement in `README.md`.

This design describes that public roadmap. It does not serve as the
implementation specification for every capability named in it. Each substantial
runtime, integration, dashboard, or cloud feature will receive its own design
and implementation plan before development.

## Audience

The first phases optimize for solo developers and maintainers who want Patchmill
to operate locally with minimal infrastructure. Interfaces and state boundaries
must preserve a path toward small-team and platform deployments rather than
requiring a later rewrite.

## Product narrative

The roadmap tells a four-stage maturity story:

1. **Operate unattended, safely.** Turn `run-once` into a dependable continuous
   factory with budgets, scheduling, recovery, and operator controls.
2. **Bring work from anywhere.** Separate work sources from code hosts, then
   support Linear and local trackers through a reusable adapter boundary.
3. **See and direct the factory.** Add a local-first unified control plane for
   kanban work management, agent collaboration, approvals, costs, and
   observability.
4. **Run the factory anywhere.** Evolve into a remotely operated
   controller/worker system with sandboxed agents, Kubernetes execution, shared
   dashboards, and team governance.

The concise product arc is:

> From a supervised local workflow to a safe, extensible, cloud-operated
> software factory.

## Roadmap principles

The public roadmap will follow these rules:

- Organize work by user outcomes rather than internal projects.
- Use ordered phases without release dates or version assignments.
- Describe capabilities as current direction, not guaranteed commitments.
- Preserve local-first operation as shared and remote deployment options grow.
- Establish safety, observability, and human control before increasing autonomy
  or scale.
- Keep individual deliverables visible beneath each phase so the roadmap remains
  actionable rather than purely thematic.
- Invite feedback and contribution without implying that public demand alone
  overrides safety or architectural sequencing.

## Architectural through-line

The phases build on five durable boundaries rather than forming disconnected
feature lists.

### Coordinator

`patchmill run` will coordinate repeated calls to the existing atomic `run-once`
workflow. Scheduling, backoff, locking, pausing, and budget checks belong
outside `run-once`; the continuous command must not duplicate workflow logic.

### Event and usage ledger

Patchmill will persist structured lifecycle, cost, token, approval, and failure
events. Initially local, this ledger becomes the source for budget enforcement,
audit history, observability, and dashboard state.

### Work source and code host

A work source supplies issues and workflow metadata. A code host supplies Git
repositories and pull requests. These responsibilities must be independently
configurable so combinations such as Linear with GitHub or Beads with Forgejo
are ordinary configurations.

### Control-plane API

The dashboard will consume a stable API and event stream instead of reading
Patchmill's internal files directly. The API can begin in-process and
local-only, then become remotely accessible without replacing the UI or its
domain model.

### Execution backend

Local worktrees remain the first execution backend. A later execution contract
will allow the controller to dispatch isolated container workers or Kubernetes
Jobs with scoped credentials and explicit policy.

## Phase I: Operate unattended, safely

**Outcome:** A maintainer can leave Patchmill running under a process supervisor
without risking duplicate work or uncontrolled spending.

Candidate capabilities:

- A continuous `patchmill run` command.
- One issue at a time by default.
- Idle polling with configurable intervals, backoff, and jitter.
- Graceful shutdown, pause, resume, and drain controls.
- Single-instance locking, followed by configurable concurrency when the state
  and lease model can support it safely.
- Daily and weekly token and US dollar budgets.
- An initial budget policy that finishes the current issue, then stops before
  selecting another.
- Configurable budget stopping boundaries in later iterations.
- Repeated-failure circuit breakers and issue quarantine.
- Notification hooks for blockers, approvals, failures, and budget limits.
- A structured event, usage, and audit ledger.

Cost limits are based on Patchmill's recorded model usage and estimated cost.
The roadmap will not imply that these estimates are identical to provider
billing or that Patchmill can interrupt every provider request at an exact
billing boundary.

## Phase II: Bring work from anywhere

**Outcome:** Teams can keep product work in one system and source code in
another.

Candidate capabilities:

- Separate work-source and code-host contracts.
- Provider-qualified issue identities rather than numeric-only issue numbers.
- A built-in Linear work source.
- A generic local-command adapter with a documented JSON protocol.
- Beads as the reference local tracker integration.
- Capability discovery and adapter conformance tests.
- Priority, dependency, and readiness signals across work sources.

A public plugin SDK is deferred until built-in and local adapters have proven
the underlying contract. Kata and other local trackers can be evaluated after
the generic adapter works; they are not initial roadmap commitments.

## Phase III: See and direct the factory

**Outcome:** A maintainer can understand and direct Patchmill from one local
interface.

Candidate capabilities:

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

The first dashboard is read-mostly: it supports inspection, conversation,
approval, and essential operational controls. A general workflow builder is out
of scope.

The primary dashboard layout is a unified control plane. Work remains central
through board and list views, while active runs, queue health, approvals, and
budget state remain persistently visible. Detailed issue and operations views
are one level deeper.

## Phase IV: Run the factory anywhere

**Outcome:** Teams primarily use a shared dashboard while Patchmill schedules
isolated workers into managed infrastructure.

Candidate capabilities:

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

Kubernetes is one execution backend, not Patchmill's core architecture. Local
operation remains supported and does not require a cluster or hosted service.

## Sequencing and data flow

The ordering is intentional:

1. Phase I creates the coordinator and event ledger while retaining `run-once`
   as the atomic unit of work.
2. Phase II introduces independent work-source and code-host adapters that feed
   normalized work into the existing workflow.
3. Phase III exposes coordinator state, normalized work, events, artifacts, and
   policies through the local control-plane API.
4. Phase IV distributes the control plane and execution backend while preserving
   the same domain contracts.

At maturity, the principal data flow is:

1. A work-source adapter discovers eligible work.
2. The coordinator evaluates policy, capacity, and budgets.
3. An execution backend runs the existing issue workflow in an isolated
   workspace.
4. Workers emit structured state, usage, artifact, approval, and failure events.
5. The control plane persists and publishes those events.
6. The dashboard presents state and submits policy-authorized commands.
7. The code-host adapter publishes or lands the resulting repository changes.

## Safety and failure handling

The roadmap will establish these expectations without prematurely specifying
each feature's implementation:

- A lost loop or worker must not silently create duplicate work.
- Pauses and budget exhaustion must preserve resumable issue state.
- Repeated failures must back off and eventually quarantine affected work rather
  than spin indefinitely.
- Dashboard actions must pass through the same policy and audit boundaries as
  CLI actions.
- Remote workers receive only the credentials, filesystem access, network
  access, models, and tools required for their task.
- Controller and worker communication must support durable leases, cancellation,
  and recovery before horizontal scale is offered.
- Human approvals remain explicit by default as interaction moves from the CLI
  to the dashboard.

## Public scope boundaries

The roadmap will avoid these promises:

- release dates or version assignments;
- guarantees that every candidate capability ships unchanged;
- a requirement to use Kubernetes or a hosted service for local operation;
- an immediate public plugin SDK;
- an initial multi-user dashboard, workflow builder, or marketplace;
- initial support for Kata before the local adapter contract is proven; or
- exact equivalence between estimated model cost and provider billing.

The following dependencies will be stated or reflected in phase ordering:

- The dashboard depends on the event ledger and stable control-plane API.
- Cloud workers depend on proven local execution and sandbox contracts.
- Team autonomy remains policy-controlled.
- Local-first operation remains supported after remote deployment exists.

## Canonical roadmap document

The public roadmap will live at `docs/roadmap.md`. This location keeps it
available in the repository and in Patchmill's published npm package, whose
package file list already includes `docs`.

The document structure will be:

1. Product direction.
2. Roadmap principles and commitment disclaimer.
3. The four phases, each with an outcome and candidate capabilities.
4. Scope boundaries where they prevent likely misunderstandings.
5. A feedback and contribution invitation.

The roadmap should be concise enough to scan. It will describe product outcomes
and representative capabilities without reproducing this design's complete
architectural rationale.

## README announcement

`README.md` will gain a short `Roadmap` section after `Documentation` and before
`Install`. The announcement will:

- summarize the four-stage direction in two or three sentences;
- highlight safe autonomy, integrations, the control plane, and cloud sandboxes;
- link to `docs/roadmap.md`; and
- avoid presenting planned commands or integrations as currently available.

The README remains an introduction and does not duplicate the canonical roadmap.

## Verification

This change affects documentation only. Under the Testing Value Gate, new
automated tests would assert static text rather than meaningful production
behavior, so no new tests will be added.

Verification will use:

- Prettier against the changed Markdown files.
- Markdownlint against the changed Markdown files.
- Direct inspection of the README-to-roadmap link and file path.
- Review of the rendered heading hierarchy and wording for accidental feature
  promises.
- The repository's relevant existing validation if the implementation changes
  any non-documentation file unexpectedly.

## Success criteria

The roadmap documentation succeeds when:

- readers can explain Patchmill's progression from safe local autonomy to
  cloud-operated sandbox workers;
- each phase has a clear user outcome and credible enabling capabilities;
- Linear, local trackers, the dashboard, and Kubernetes appear as parts of one
  architectural progression rather than unrelated promises;
- current and planned capabilities cannot reasonably be confused;
- local-first users understand that remote infrastructure is optional; and
- maintainers can revise candidate scope without violating date or version
  promises.
