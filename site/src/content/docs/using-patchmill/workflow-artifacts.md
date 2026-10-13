---
title: Workflow artifacts
description:
  Use verified repository artifacts and planning pull requests in fresh
  workflows.
---

A spec describes design and constraints; a plan describes implementation work.
For a fresh `planning-pr-v1` Issue run, an artifact is authoritative only when
it is either:

- one unambiguous regular file committed under the configured spec or plan
  directory on the freshly fetched target base; or
- an artifact committed in its assigned phase workspace and reviewed in its
  planning or implementation pull request.

The saved planning review-gate snapshot assigns each artifact to a phase. Zero
matching files means that phase creates the artifact; more than one match blocks
rather than guessing. A merged planning pull request becomes part of the fetched
base for the next phase, so reviewer edits are carried forward.

## Fresh workflow

Let ordinary Run-once own artifact publication and review:

```sh
patchmill run-once --issue N
```

An agent changes and commits only the requested artifact and its declared spec
companions. Plan commits still contain only the plan document. When its phase
has a planning review gate, Patchmill creates the non-closing planning pull
request, returns `review-pending`, and waits for a human to merge that exact
pull request. The implementation pull request carries remaining artifacts and
code, closes the issue, and is validated before terminal cleanup. See
[Run-once](/using-patchmill/run-once/) for the gate matrix and recovery steps.

## Spec companions

For meaningful browser-visible frontend changes, the managed planning wrapper
creates a full-page HTML mockup during brainstorming. It must open directly from
disk with no required network assets, installation, build, or local server.
Required CSS and JavaScript are embedded. Include responsive mobile and desktop
layouts, semantic HTML, visible keyboard focus, and applicable reduced motion.

The spec declares regular `.html` files under `docs/mockups/` in one top-level
section. With a spec under `docs/specs/`, use this exact format:

```markdown
## Companion artifacts

- `docs/mockups/YYYY-MM-DD-topic.html`:
  [Full-page mockup](../mockups/YYYY-MM-DD-topic.html)
```

The declaration is repository-relative. Its link resolves from the actual spec
directory to that same file. Code examples, quoted sections, and raw HTML do not
authorize companions. Remote, encoded, query, fragment, duplicate, traversal,
and mismatched paths are rejected. Symlinks and nonregular files are rejected.

Commit the spec and its companions together in the active phase workspace.
Missing, unlinked, fragment-only, or non-self-contained required mockups stop
the plan handoff. The normal `writing-plans` step reads the spec and referenced
mockup as inputs. Approved older specs without mockups remain valid.

Patchmill derives companion authority from the spec at its recorded Git commit,
not from a mutable checkout or a caller-supplied path list. Publication verifies
the spec and companions as committed regular files and rejects unrelated
changes. Revisions validate both spec trees. Removing a declaration can retire
its earlier declared companion; it cannot authorize unrelated deletion.

Resume, reviewer-edit adoption, merge reconciliation, and fetched-base handoffs
refresh verified evidence from the relevant immutable commit. Missing files or
stale saved companion arrays block rather than report false success. Older saved
spec evidence without the optional array is hydrated from its committed spec.
Plans have no companion authority and remain single-document artifacts.

The mockup supplies visual intent to implementation and frontend review. It does
not replace required committed implementation screenshots. Material differences
need a product or technical reason, not pixel-perfect reproduction. See
[Skills configuration](/guides/skills-configuration/#conditional-frontend-work)
for activation, precedence, independent review, and repair requirements.

## Legacy compatibility

`patchmill set-spec` and `patchmill set-plan` still publish deterministic issue
comments containing artifact kind, source path, normalized body, and SHA-256
checksum. Those comments are consumed only by unfinished legacy Issue runs; the
commands preserve their history and checksum behavior but are deprecated for
fresh work.

Likewise, upload handoffs and approval labels remain legacy compatibility data.
They do not authorize a fresh planning phase. For a fresh workflow, commit the
human-authored artifact to the target base before Run-once starts or allow the
assigned phase workspace to create it.
