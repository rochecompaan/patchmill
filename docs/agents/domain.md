# Domain docs

How engineering skills should consume this repo's domain documentation.

## Before exploring

Read these when they exist:

- `GLOSSARY.md` at the repository root.
- `GLOSSARY-MAP.md` when present, then relevant context glossaries.
- Relevant system-wide or context-specific ADRs under `docs/adr/`.

If they do not exist, proceed silently. Domain-modeling workflows create them
when domain terms or architectural decisions are resolved.

## Layout

This is a single-context repository:

```text
/
├── GLOSSARY.md
├── docs/adr/
└── src/
```

## Use the glossary vocabulary

When output names a domain concept—for example in an issue title, proposal,
hypothesis, or test name—use the term defined in `GLOSSARY.md`. Avoid synonyms
that the glossary explicitly rejects.

If a needed concept is absent, reconsider whether it belongs to the project's
language. If it does, note the gap for domain modeling.

## Upstream naming and domain changes

Matt Pocock's domain-modeling skill uses `GLOSSARY.md` for terminology and
`GLOSSARY-MAP.md` for multiple contexts. Patchmill uses those names directly. Do
not create a map for this single-context repository.

In target repositories with legacy `CONTEXT.md` or `CONTEXT-MAP.md`, read those
files until their rename is authorized. Preserve existing language and surface
conflicting repository instructions before a rename. Do not create competing
glossaries.

Capture resolved terms in the canonical glossary during authorized planning.
Create or update domain documents only for resolved concepts or justified
architectural decisions. If an envelope excludes domain edits, record the
resolution and deferred destination in the specification instead.

## Flag ADR conflicts

Surface any conflict with an existing ADR instead of silently overriding it:

> Contradicts ADR-0007 (event-sourced orders), but may be worth reopening
> because…
