import type { Artifact } from "../api-types.ts";
import { sampleDocuments } from "./documents.ts";
export const sampleArtifacts: Readonly<Record<string, readonly Artifact[]>> = {
  "298": [],
  "282": [],
  "262": [],
  "227": [
    {
      id: "spec",
      kind: "spec",
      title: "Multi-run cost report",
      path: "docs/specs/2026-10-10-multi-run-cost-report-design.md",
      commit: "3e1a9c0",
      location: "Committed in the worktree. Not pushed yet.",
      draft: true,
      sourceUrl: null,
      preview: {
        kind: "document",
        blocks: sampleDocuments["227-spec"]!,
      },
    },
  ],
  "206": [],
  "233": [],
  "268": [],
  "194": [],
  "177": [],
  "250": [],
  "210": [
    {
      id: "spec",
      kind: "spec",
      title:
        "Add frontend design and independent design-review skills to UI workflows",
      path: "docs/specs/2026-10-08-design-review-skills-design.md",
      commit: "a41c7e2",
      location: "Merged into main",
      draft: false,
      sourceUrl:
        "https://github.com/rochecompaan/patchmill/blob/a41c7e2/docs/specs/2026-10-08-design-review-skills-design.md",
      preview: {
        kind: "document",
        blocks: sampleDocuments["210-spec"]!,
      },
    },
    {
      id: "plan",
      kind: "plan",
      title:
        "Plan: Add frontend design and independent design-review skills to UI workflows",
      path: "docs/plans/2026-10-08-design-review-skills.md",
      commit: "c93b0d5",
      location: "In plan PR #301, open",
      draft: false,
      sourceUrl:
        "https://github.com/rochecompaan/patchmill/blob/c93b0d5/docs/plans/2026-10-08-design-review-skills.md",
      preview: {
        kind: "document",
        blocks: sampleDocuments["210-plan"]!,
      },
    },
    {
      id: "mockup",
      kind: "mockup",
      title: "Design review comment",
      path: "docs/mockups/2026-10-08-design-review-skills.html",
      commit: "a41c7e2",
      location: "Merged into main",
      draft: false,
      sourceUrl:
        "https://github.com/rochecompaan/patchmill/blob/a41c7e2/docs/mockups/2026-10-08-design-review-skills.html",
      preview: {
        kind: "page",
        url: "/samples/design-review.html",
      },
    },
    {
      id: "diagram",
      kind: "diagram",
      title: "Design review in UI workflows",
      path: "docs/visuals/2026-10-08-design-review-skills.html",
      commit: "c93b0d5",
      location: "In plan PR #301, open",
      draft: false,
      sourceUrl:
        "https://github.com/rochecompaan/patchmill/blob/c93b0d5/docs/visuals/2026-10-08-design-review-skills.html",
      preview: {
        kind: "page",
        url: "/samples/planning-flow.html",
      },
    },
  ],
  "276": [
    {
      id: "spec",
      kind: "spec",
      title:
        "run-once drops comment author attribution, so trusted-owner answers are treated as untrusted",
      path: "docs/specs/2026-10-09-comment-author-trust-design.md",
      commit: "c5e7a21",
      location: "Merged into main",
      draft: false,
      sourceUrl:
        "https://github.com/rochecompaan/patchmill/blob/c5e7a21/docs/specs/2026-10-09-comment-author-trust-design.md",
      preview: {
        kind: "document",
        blocks: sampleDocuments["276-spec"]!,
      },
    },
    {
      id: "plan",
      kind: "plan",
      title:
        "Plan: run-once drops comment author attribution, so trusted-owner answers are treated as untrusted",
      path: "docs/plans/2026-10-09-comment-author-trust.md",
      commit: "08b3f6d",
      location: "Merged into main",
      draft: false,
      sourceUrl:
        "https://github.com/rochecompaan/patchmill/blob/08b3f6d/docs/plans/2026-10-09-comment-author-trust.md",
      preview: {
        kind: "document",
        blocks: sampleDocuments["276-plan"]!,
      },
    },
    {
      id: "diagram",
      kind: "diagram",
      title: "Comment authors in run-once",
      path: "docs/visuals/2026-10-09-comment-author-trust.html",
      commit: "08b3f6d",
      location: "Merged into main",
      draft: false,
      sourceUrl:
        "https://github.com/rochecompaan/patchmill/blob/08b3f6d/docs/visuals/2026-10-09-comment-author-trust.html",
      preview: {
        kind: "page",
        url: "/samples/planning-flow.html",
      },
    },
  ],
  "263": [
    {
      id: "spec",
      kind: "spec",
      title:
        "Prevent final-validation host gates from using two-minute shorthand timeouts",
      path: "docs/specs/2026-10-09-host-gate-timeout-units-design.md",
      commit: "61d0a9c",
      location: "Merged into main",
      draft: false,
      sourceUrl:
        "https://github.com/rochecompaan/patchmill/blob/61d0a9c/docs/specs/2026-10-09-host-gate-timeout-units-design.md",
      preview: {
        kind: "document",
        blocks: sampleDocuments["263-spec"]!,
      },
    },
    {
      id: "plan",
      kind: "plan",
      title:
        "Plan: Prevent final-validation host gates from using two-minute shorthand timeouts",
      path: "docs/plans/2026-10-09-host-gate-timeout-units.md",
      commit: "f27b8e3",
      location: "Merged into main",
      draft: false,
      sourceUrl:
        "https://github.com/rochecompaan/patchmill/blob/f27b8e3/docs/plans/2026-10-09-host-gate-timeout-units.md",
      preview: {
        kind: "document",
        blocks: sampleDocuments["263-plan"]!,
      },
    },
    {
      id: "diagram",
      kind: "diagram",
      title: "Host gate timeouts",
      path: "docs/visuals/2026-10-09-host-gate-timeout-units.html",
      commit: "f27b8e3",
      location: "Merged into main",
      draft: false,
      sourceUrl:
        "https://github.com/rochecompaan/patchmill/blob/f27b8e3/docs/visuals/2026-10-09-host-gate-timeout-units.html",
      preview: {
        kind: "page",
        url: "/samples/planning-flow.html",
      },
    },
  ],
  "231": [
    {
      id: "spec",
      kind: "spec",
      title: "Add shared run identity types and the normalized outcome seam",
      path: "docs/specs/2026-10-05-run-identity-seam-design.md",
      commit: "3fa91d0",
      location: "Merged into main",
      draft: false,
      sourceUrl:
        "https://github.com/rochecompaan/patchmill/blob/3fa91d0/docs/specs/2026-10-05-run-identity-seam-design.md",
      preview: {
        kind: "document",
        blocks: sampleDocuments["231-spec"]!,
      },
    },
    {
      id: "plan",
      kind: "plan",
      title:
        "Plan: Add shared run identity types and the normalized outcome seam",
      path: "docs/plans/2026-10-05-run-identity-seam.md",
      commit: "b6c27e5",
      location: "Merged into main",
      draft: false,
      sourceUrl:
        "https://github.com/rochecompaan/patchmill/blob/b6c27e5/docs/plans/2026-10-05-run-identity-seam.md",
      preview: {
        kind: "document",
        blocks: sampleDocuments["231-plan"]!,
      },
    },
  ],
  "173": [
    {
      id: "spec",
      kind: "spec",
      title: "Show blocked reasons on board cards",
      path: "docs/specs/2026-10-06-board-blocked-reasons-design.md",
      commit: "7b20e4f",
      location: "Merged into main",
      draft: false,
      sourceUrl:
        "https://github.com/rochecompaan/patchmill/blob/7b20e4f/docs/specs/2026-10-06-board-blocked-reasons-design.md",
      preview: {
        kind: "document",
        blocks: sampleDocuments["173-spec"]!,
      },
    },
    {
      id: "plan",
      kind: "plan",
      title: "Plan: Show blocked reasons on board cards",
      path: "docs/plans/2026-10-06-board-blocked-reasons.md",
      commit: "e18a3c9",
      location: "Merged into main",
      draft: false,
      sourceUrl:
        "https://github.com/rochecompaan/patchmill/blob/e18a3c9/docs/plans/2026-10-06-board-blocked-reasons.md",
      preview: {
        kind: "document",
        blocks: sampleDocuments["173-plan"]!,
      },
    },
    {
      id: "mockup",
      kind: "mockup",
      title: "Board: blocked reasons",
      path: "docs/mockups/2026-10-06-board-blocked-reasons.html",
      commit: "7b20e4f",
      location: "Merged into main",
      draft: false,
      sourceUrl:
        "https://github.com/rochecompaan/patchmill/blob/7b20e4f/docs/mockups/2026-10-06-board-blocked-reasons.html",
      preview: {
        kind: "page",
        url: "/samples/board.html",
      },
    },
    {
      id: "shots",
      kind: "shots",
      title: "Screenshots",
      path: "docs/screenshots/",
      commit: "5d2e8a1",
      location: "In PR #297, open",
      draft: false,
      sourceUrl:
        "https://github.com/rochecompaan/patchmill/blob/5d2e8a1/docs/screenshots/",
      preview: {
        kind: "gallery",
        shots: [
          {
            url: "/samples/board-columns.png",
            path: "docs/screenshots/173-board-blocked-reasons.png",
            caption:
              "The Blocked column shows each card's reason under its title.",
          },
          {
            url: "/samples/blocked-card.png",
            path: "docs/screenshots/173-blocked-card-focus.png",
            caption: "Keyboard focus on a blocked card shows the full reason.",
          },
          {
            url: "/samples/board-mobile.png",
            path: "docs/screenshots/173-board-narrow.png",
            caption: "At 390 px wide, the columns stack and reasons wrap.",
          },
        ],
      },
    },
  ],
  "247": [
    {
      id: "spec",
      kind: "spec",
      title:
        "Implementation orchestrator can exhaust spawn budget before an oracle-authorized repair",
      path: "docs/specs/2026-10-07-spawn-budget-repair-slot-design.md",
      commit: "9a1f3b7",
      location: "Merged into main",
      draft: false,
      sourceUrl:
        "https://github.com/rochecompaan/patchmill/blob/9a1f3b7/docs/specs/2026-10-07-spawn-budget-repair-slot-design.md",
      preview: {
        kind: "document",
        blocks: sampleDocuments["247-spec"]!,
      },
    },
    {
      id: "plan",
      kind: "plan",
      title:
        "Plan: Implementation orchestrator can exhaust spawn budget before an oracle-authorized repair",
      path: "docs/plans/2026-10-07-spawn-budget-repair-slot.md",
      commit: "2c84d1e",
      location: "Merged into main",
      draft: false,
      sourceUrl:
        "https://github.com/rochecompaan/patchmill/blob/2c84d1e/docs/plans/2026-10-07-spawn-budget-repair-slot.md",
      preview: {
        kind: "document",
        blocks: sampleDocuments["247-plan"]!,
      },
    },
  ],
  "232": [],
  "234": [],
  "236": [],
  "901": [
    {
      id: "spec",
      kind: "spec",
      title: "Multi-run cost report",
      path: "docs/specs/2026-10-10-multi-run-cost-report-design.md",
      commit: "3e1a9c0",
      location: "Committed in the worktree. Not pushed yet.",
      draft: true,
      sourceUrl: null,
      preview: {
        kind: "document",
        blocks: sampleDocuments["901-spec"]!,
      },
    },
  ],
};
