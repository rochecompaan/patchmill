---
name: module-size
description: Use when creating, editing, reviewing, or refactoring code modules to keep files focused, readable, and maintainable as code grows.
---

# Module Size

## Overview

Prefer small, cohesive modules with one clear reason to change. Module size is a design signal: large files are not automatically wrong, but they demand an explicit structure or a split plan.

## When to Use

Use this skill when:

- Adding new code to an existing module.
- Creating a new file, package, component, service, hook, or utility.
- Reviewing a diff that makes a file substantially larger.
- Refactoring files that feel hard to scan, test, or reason about.
- Choosing whether to split code across modules.

## Size Guidelines

Treat these as prompts for judgment, not absolute laws:

- **Ideal module:** under ~200 lines of meaningful code.
- **Review carefully:** ~200–400 lines; ensure sections are cohesive and navigation is obvious.
- **Split pressure:** over ~400 lines; identify separable responsibilities before adding more.
- **Function/component target:** under ~40 lines when practical; extract helpers when branches, nesting, or setup obscure intent.
- **Tests/config/generated files:** can be larger, but should still have clear sections and focused fixtures.

Do not count comments, imports, or declarative data mechanically. Ask whether a reader can understand the module’s purpose and public surface quickly.

## Process

1. **Name the module’s responsibility** in one sentence. If the sentence needs “and”, “or”, or multiple domains, consider splitting.
2. **Check current size and growth direction** before editing. If the change pushes a file over a threshold, pause and evaluate structure.
3. **Locate independent axes of change:** parsing vs rendering, I/O vs pure logic, state vs presentation, domain rules vs adapters, CLI wiring vs implementation.
4. **Prefer extraction by behavior, not by type.** A useful split creates modules that can be named after what they do, not vague buckets like `helpers`, `utils`, or `misc`.
5. **Keep public APIs narrow.** Extract private helpers first; expose only stable, necessary functions/types.
6. **Preserve locality for tiny code.** Do not split a 20-line helper into a new file if it is only meaningful beside its caller.
7. **Refactor in safe steps:** move code without behavior changes, update imports, run tests/formatters, then make functional changes.
8. **Document intentional exceptions.** If a large module is kept together, add clear section headings or a short note explaining why.

## Split Patterns

Use these patterns when a module has grown past one responsibility:

- **Facade + internals:** keep a small public `index`/entry module and move implementation into focused files.
- **Pure core + shell:** separate deterministic logic from filesystem, network, process, or UI effects.
- **Parser/validator/executor:** split pipelines by stage when each stage has separate tests and failure modes.
- **Component + hooks + view helpers:** separate UI rendering from state management and data shaping.
- **Domain module + adapter:** keep business rules independent from framework or vendor-specific integration code.

## Review Checklist

Before finishing, verify:

- The module has one clear responsibility and one primary audience.
- New names are specific and domain-oriented.
- Imports do not introduce circular dependencies or a broad “god module”.
- Tests still cover moved behavior.
- The split reduces cognitive load rather than creating file-hopping.
- The final diff is easier to review than the original shape.

## Common Mistakes

- **Using line count as the only rule:** fix by identifying responsibilities and change boundaries.
- **Creating junk drawers:** avoid names like `utils`, `common`, and `helpers` unless the scope is narrow and obvious.
- **Splitting too early:** keep tightly coupled code together until a real seam appears.
- **Mixing refactor and behavior changes:** move code first, verify, then change behavior.
- **Hiding complexity behind barrels:** ensure re-export files do not obscure ownership or create dependency tangles.
