# Domain docs

How engineering skills should consume this repo's domain documentation.

## Before exploring

Read these when they exist:

- `CONTEXT.md` at the repository root.
- Relevant ADRs under `docs/adr/`.

If they do not exist, proceed silently. Domain-modeling workflows create them
when domain terms or architectural decisions are resolved.

## Layout

This is a single-context repository:

```text
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

## Use the glossary vocabulary

When output names a domain concept—for example in an issue title, proposal,
hypothesis, or test name—use the term defined in `CONTEXT.md`. Avoid synonyms
that the glossary explicitly rejects.

If a needed concept is absent, reconsider whether it belongs to the project's
language. If it does, note the gap for domain modeling.

## Flag ADR conflicts

Surface any conflict with an existing ADR instead of silently overriding it:

> Contradicts ADR-0007 (event-sourced orders), but may be worth reopening
> because…
