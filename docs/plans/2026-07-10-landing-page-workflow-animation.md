# Landing Page Workflow Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-width terminal-led landing-page animation that
demonstrates Patchmill init, demo repo creation, triage, and run-once issue
advancement.

**Architecture:** Keep the landing page as a composition layer and put the demo
in `WorkflowAnimation.astro`. Store the timeline script, demo issues, and static
fallback transcript in `workflowAnimationData.ts`. Use vanilla JavaScript to
replay the timeline and CSS to transition from full-width terminal to
terminal/GitHub split view.

**Tech Stack:** Astro, static HTML fallback, vanilla JavaScript, CSS
Grid/Flexbox, existing GitHub mockup label styles, component-scoped
`workflow-animation.css`.

## Global Constraints

- Work in `/home/roche/projects/patchmill/.worktrees/docs-site-astro-starlight`.
- Do not add React, Svelte, Lottie, animation libraries, or a test framework.
- Keep all essential workflow information in server-rendered static HTML.
- Honor `prefers-reduced-motion: reduce` by skipping the animated replay and
  showing the final state.
- Use real buttons for Replay, Pause, and Skip animation.
- Verify with `cd site && npm run build` and manual browser/accessibility
  review.

---

## File Structure

- `site/src/components/workflowAnimationData.ts`: exports demo issue data,
  animation event timeline, and fallback terminal transcript.
- `site/src/components/WorkflowAnimation.astro`: renders static fallback, embeds
  JSON timeline data, and runs the vanilla-JS replay enhancer.
- `site/src/styles/workflow-animation.css`: owns full-width terminal, split
  layout, issue reveal, label animation, controls, responsive, and
  reduced-motion styles.
- `site/src/pages/index.astro`: imports and renders `<WorkflowAnimation />`.
- `site/src/styles/landing.css`: updates the proof section to a full-width
  single-column layout.

---

### Task 1: Replace stepper data with a timeline script

**Files:**

- Modify: `site/src/components/workflowAnimationData.ts`

**Interfaces:**

- Produces: `demoIssues`, `animationEvents`, and `staticTranscript`.
- Consumed by: `site/src/components/WorkflowAnimation.astro`.

- [ ] Define demo issues #42, #39, #37, and #34 with initial meta, final meta,
      label pools, and final labels.
- [ ] Define timeline events for typed terminal lines, interactive prompts,
      split transition, issue reveals, highlights, label updates, and meta
      updates.
- [ ] Define a compact static transcript containing `patchmill init`,
      provider/model choices, demo repo setup, `patchmill triage`, and
      `patchmill run-once` final state.

---

### Task 2: Replace the stepper component with continuous replay markup and JS

**Files:**

- Modify: `site/src/components/WorkflowAnimation.astro`

**Interfaces:**

- Consumes: `demoIssues`, `animationEvents`, and `staticTranscript`.
- Produces: full-width workflow demo markup, static fallback, replay controls,
  and a vanilla-JS timeline runner.

- [ ] Render intro copy, terminal panel, GitHub issue panel, Replay/Pause/Skip
      controls, polite live region, and embedded JSON timeline data.
- [ ] Server-render the static transcript and final GitHub issue state so no-JS
      and reduced-motion users still get the full workflow.
- [ ] In JavaScript, reset to terminal-only, type command characters, render
      prompts, split to the GitHub panel, reveal issues, update labels/meta, and
      support Replay/Pause/Skip.
- [ ] In reduced-motion mode, skip the replay and show the final state
      immediately.

---

### Task 3: Replace workflow styles with full-width terminal and split-view styling

**Files:**

- Modify: `site/src/styles/workflow-animation.css`
- Modify: `site/src/styles/landing.css`

**Interfaces:**

- Consumes: class names and data attributes from `WorkflowAnimation.astro`.
- Produces: full-width terminal-first visual treatment and responsive split
  layout.

- [ ] Style `.workflow-demo` to span the full proof-section width.
- [ ] Style terminal-first mode so the terminal occupies the full demo width
      before the split event.
- [ ] Style split mode so terminal and GitHub issues sit side-by-side on desktop
      and stack on mobile.
- [ ] Style issue reveal/highlight, label pop-in, controls, focus states,
      responsive breakpoints, and reduced-motion overrides.
- [ ] Update `.proof-section` in `landing.css` to one column and make feature
      bullets responsive.

---

### Task 4: Verification

**Files:**

- Inspect: `site/src/components/WorkflowAnimation.astro`
- Inspect: `site/src/components/workflowAnimationData.ts`
- Inspect: `site/src/styles/workflow-animation.css`
- Inspect: `site/src/styles/landing.css`

**Interfaces:**

- Consumes: implemented landing animation.
- Produces: verified working tree.

- [ ] Run `cd site && npm run build` and require exit 0.
- [ ] Verify generated HTML contains essential fallback content: setup command,
      provider/model choices, triage command, run-once command, and final
      `agent-done` label.
- [ ] Verify the old stepper controls are gone and Replay/Pause/Skip controls
      are present.
- [ ] Verify the data timeline includes split, issue-add, and issue-label
      events.
- [ ] Manually review `http://127.0.0.1:4321/` for smooth terminal typing, split
      timing, issue creation, triage label updates, run-once state change,
      mobile layout, and reduced-motion behavior.
