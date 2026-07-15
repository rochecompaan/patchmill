# Landing Page Workflow Animation Design

## Goal

Add an interactive landing-page animation that feels like a live Patchmill run:
commands type into a terminal, setup prompts are answered, demo issues appear in
GitHub as they are created, triage labels apply in real time, and `run-once`
moves one issue through `in-progress` to `agent-done`.

## Context

The docs site is an Astro/Starlight site in `site/`. The landing page is static
Astro markup in `site/src/pages/index.astro`, styled by
`site/src/styles/landing.css`. The previous static GitHub issues mockup is
replaced by a full-width interactive workflow demo that reuses the existing
GitHub issue visual language and label styles.

## Recommended Approach

Create a focused Astro component, `site/src/components/WorkflowAnimation.astro`,
backed by a typed timeline data module,
`site/src/components/workflowAnimationData.ts`. The component renders a complete
static transcript and final issue state for fallback, then a small vanilla-JS
enhancer resets the view and replays the live terminal/issue timeline when
motion is allowed. No framework or animation dependency is added.

## Interactive Script

1. Start with the terminal taking the full width of the demo.
2. Type `patchmill init` character-by-character.
3. Show provider selection interactively and select `GitHub via gh`.
4. Show model selection interactively and select `Claude Sonnet 4`.
5. Type
   `patchmill setup-test-repo --provider github-gh --repo patchmill-demo/team-lunch-poll`.
6. Stream demo repository setup output.
7. Split the demo into terminal left and GitHub issues right.
8. As the terminal creates each issue, reveal that issue in the GitHub panel
   with no labels.
9. Type `patchmill triage` and scan each issue.
10. Apply labels to each issue one-by-one as the terminal reports triage
    decisions.
11. Type `patchmill run-once`.
12. Highlight issue `#42`, replace `agent-ready` with `in-progress`, and update
    its meta text while the terminal shows agent work.
13. Replace `in-progress` with `agent-done` and show the final human-review
    handoff.

## Visual Design

Use the full width of the landing proof section. The terminal is visually
dominant at first, with a tall dark console and typed command output. The GitHub
panel appears only after demo issue creation starts, sliding into a split layout
beside the terminal. The interaction should read as one continuous live replay,
not discrete slides or jittering steps.

The aesthetic remains aligned with the current landing page: dark shell
background, green Patchmill accents, rounded panels, and the existing light
GitHub card style. Motion is purposeful and local: typed terminal characters,
panel split, issue reveals, label pops, and selected issue highlights.

## Accessibility and Reduced Motion

- All essential workflow information is present in server-rendered HTML via the
  static transcript and final issue state.
- The animation controls are real buttons: Replay, Pause, and Skip animation.
- A polite live region announces major workflow changes.
- `prefers-reduced-motion: reduce` skips the animation and shows the final
  static state.
- No essential information is available only through animation.

## Implementation Boundaries

- Add/update `site/src/components/WorkflowAnimation.astro` for markup and the
  vanilla-JS timeline runner.
- Add/update `site/src/components/workflowAnimationData.ts` for demo issues, the
  event timeline, and fallback transcript.
- Add/update `site/src/styles/workflow-animation.css` for full-width terminal,
  split layout, issue reveal, labels, controls, responsive behavior, and
  reduced-motion behavior.
- Modify `site/src/pages/index.astro` to render `<WorkflowAnimation />`.
- Modify `site/src/styles/landing.css` only for the full-width proof-section
  layout.
- Do not add React, Svelte, Lottie, animation libraries, or a test framework.

## Verification

Use direct verification rather than a new automated UI test framework. Verify
with:

- `cd site && npm run build`
- Static generated HTML checks for transcript, controls, essential commands,
  final labels, and reduced-motion hooks
- Browser review at `http://127.0.0.1:4321/` for desktop and mobile widths
- Manual review of Replay, Pause, Skip animation, and reduced-motion behavior
