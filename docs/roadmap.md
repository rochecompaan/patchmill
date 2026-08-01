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
