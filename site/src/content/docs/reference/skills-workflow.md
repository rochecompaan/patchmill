---
title: Skills workflow
description:
  The skills that each Patchmill phase uses, from triage to a ready pull
  request.
---

Each kernel phase loads one entry skill. The entry skill then reads its sibling
skills and supporting files from `.patchmill/skills/`. This page shows which
skills each phase uses and in what order. See
[Skills configuration](/guides/skills-configuration/) for how the pack is
installed, and [Agent workflow lifecycle](/reference/agent-workflow-lifecycle/)
for how merge gates connect the phases.

## Skill sources

| Prefix       | Source                                                      |
| ------------ | ----------------------------------------------------------- |
| `patchmill`  | Patchmill's own skills and supporting files                 |
| `sp`         | [Superpowers](https://github.com/obra/superpowers)          |
| `mp`         | [Matt Pocock skills](https://github.com/mattpocock/skills)  |
| `se`         | [SimpleEnglish](https://github.com/AminBlg/SimpleEnglish)   |
| `humanlayer` | [HumanLayer skills](https://github.com/humanlayer/skills)   |
| `anthropic`  | [Anthropic skills](https://github.com/anthropics/skills)    |
| `vercel`     | Vercel Web Interface Guidelines, pinned as a reference file |

## Where the skills fit

The [factory floor](/getting-started/factory-floor/) shows the whole flow from
triage to a merged pull request. This page zooms in on its triage, design
office, and assembly line stations.

Legend: blue = kernel entry skill, green = Patchmill sibling skill, light green
dashed = supporting file inside a skill directory, grey = upstream skill, white
dashed = upstream step that Patchmill skips. Italic text marks when a skill
applies.

## Triage

```mermaid
flowchart LR
    classDef entry fill:#1f6feb,color:#fff,stroke:#1f6feb

    E["triage-envelope.md<br/>3 allowed labels"] --> T["patchmill:patchmill-issue-triage<br/>read-only"]:::entry
    T --> J["json: label, comment, blockedBy"]
    J --> K["Kernel applies label,<br/>posts comment, links blockers"]
```

Triage reads no sibling skills.

## Planning

The order below follows `patchmill-planning`. Stage `spec` stops after the spec
and its planning PR. Stage `plan` and stage `implementation` continue to the
plan.

```mermaid
flowchart TD
    classDef entry fill:#1f6feb,color:#fff,stroke:#1f6feb
    classDef file fill:#dafbe1,color:#24292f,stroke:#2da44e,stroke-dasharray:4 2
    classDef up fill:#eaeef2,color:#24292f,stroke:#8c959f

    A["patchmill:patchmill-planning"]:::entry --> B["sp:brainstorming<br/>explore the issue, shape the spec"]:::up
    B --> C{"Changes architecture?"}
    C -- yes --> D["mp:domain-modeling<br/>glossary, contexts, ADRs"]:::up
    D --> E{"Changes modules,<br/>interfaces, seams?"}
    E -- yes --> F["mp:codebase-design<br/>+ DEEPENING.md"]:::up
    C -- no --> G
    E -- no --> G
    F --> G{"Frontend design applies?"}
    G -- yes --> H["anthropic:frontend-design<br/>docs/mockups/*.html"]:::up
    G -- no --> I
    H --> I["Write spec<br/>se:simple-english"]:::up
    I --> J["humanlayer:show-me<br/>## Visual explanation"]:::up
    J --> K{"Stage"}
    K -- spec --> PUB["Commit, push,<br/>spec planning PR"]
    K -- "plan / implementation" --> L["sp:writing-plans<br/>se:simple-english"]:::up
    L --> M["humanlayer:show-me<br/>plan visual"]:::up
    M --> N["Fresh reviewer<br/>patchmill:plan-review.md"]:::file
    N --> O["Record Plan review<br/>section in plan"]
    O --> PUB2["Commit, push;<br/>plan PR when the gate requires it"]
```

## Implementation

```mermaid
flowchart TD
    classDef entry fill:#1f6feb,color:#fff,stroke:#1f6feb
    classDef pm fill:#2da44e,color:#fff,stroke:#2da44e
    classDef file fill:#dafbe1,color:#24292f,stroke:#2da44e,stroke-dasharray:4 2
    classDef up fill:#eaeef2,color:#24292f,stroke:#8c959f
    classDef skip fill:#fff,color:#8c959f,stroke:#8c959f,stroke-dasharray:4 2

    A["patchmill:patchmill-implementation"]:::entry --> B{"Interactive per-task<br/>review requested?"}
    B -- no --> C["sp:executing-plans"]:::up
    B -- yes --> D["sp:subagent-driven-development"]:::up
    C --> E["patchmill:module-size<br/>focused modules"]:::pm
    D --> E
    E --> F{"Visible UI change?"}
    F -- yes --> G["patchmill:patchmill-visual-evidence<br/>committed screenshots"]:::pm
    F -- no --> H
    G --> H["Run project validation"]
    H --> I["Fresh reviewer<br/>sp:requesting-code-review<br/>+ patchmill:review-appendix.md"]:::up
    I --> J["One fix pass"]
    J --> K{"Frontend review applies?"}
    K -- yes --> L["patchmill:patchmill-frontend-review<br/>+ vercel:web-interface-guidelines.md"]:::pm
    K -- no --> M
    L --> M["Patchmill publish:<br/>draft PR, checks, ready PR"]
    C -.->|"final step skipped"| X["sp:finishing-a-development-branch"]:::skip
    X -.->|"replaced by"| M
```

## Human-only skills

`patchmill-plan`, `patchmill-label`, and `patchmill-cleanup` run only in a
human-controlled session. The kernel never loads them. See
[Interactive skills](/using-patchmill/interactive-skills/).
