# Issue #364: Parent spec verification

## Delivery

Sub-issue runs now receive their Parent spec as an extra fact. Each Sub-issue
still writes its own short spec through the existing stages and gates. The
parent link comes from GitHub's sub-issues API or a leading `Part of #N` body
line on Forgejo/Gitea. The Parent spec comes only from the fetched base ref.

The envelope gives a shell-quoted `git show` command, because the worktree copy
can be missing or old. The envelope and skill state the read-only rule. There is
no kernel enforcement. The console, planning dialog, and progress record show
the parent issue and path.

## Validation

| Command or check                                     | Result                                                  |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `npm ci`                                             | Passed; no dependency manifest changed.                 |
| Baseline `npm test`                                  | 1223 passed, zero failures.                             |
| Final `npm test`                                     | 1243 passed, zero failures; includes TypeScript checks. |
| `npm run lint`                                       | Passed: formatting, ESLint, and Markdown lint.          |
| `npm run build`                                      | Passed.                                                 |
| Skill installer, update, and console discovery tests | 12 passed, zero failures.                               |
| `node bin/patchmill.ts skills update` twice          | Second update makes no changes.                         |
| Source/installed planning skill comparison           | Identical.                                              |
| Managed pack resources and hashes                    | Reviewer verified all 80 entries.                       |
| Live GitHub adapter read: #357 parent                | Returned #356.                                          |
| Live GitHub adapter read: #364 parent                | Returned no parent.                                     |
| Nix build                                            | Not run; no dependency changes.                         |

The new behavior tests ran first without implementation and failed. They passed
after implementation. They cover parent lookup, base-only discovery, stale child
branches, child/parent coexistence, envelopes, terminal output, approval
dialogs, and old/new progress records.

## Independent review and fix pass

A fresh canonical `reviewer` reviewed base `5be867e` through `87e0f3d` with
`openai-codex/gpt-6.1-sol` at high thinking. Its Important finding was that a
failed lookup containing the phrase "No parent issue found" could silently
become no parent. The fix uses `gh api --include`, then requires all three: exit
code 1, HTTP 404, and the exact JSON no-parent message. Other errors propagate.
New HTTP 500 and process-error tests failed before the fix and passed after it.
Live reads then confirmed both parent and no-parent results.

The reviewer graded unquoted read commands as Minor. The implementer regraded
this as Important: spaces and apostrophes in a supported artifact directory
break the command. The fix quotes the complete ref/path argument. A real Git and
Bash regression failed before the fix and passed after it. The fix pass changed
the plan's literal unquoted example, not its discovery or workflow.

All validation commands passed again after this single fix pass. No Minor
finding remains deferred.

## Rulings

- Use approved approach A, not the issue's initial skip-stage proposal. The
  maintainer chose a child spec plus parent input. Cost if wrong: re-planning.
- Keep small parent methods in existing host adapters for locality. Cost if
  wrong: later extraction into focused modules.
- Keep the incidental generated cleanup-skill refresh from `skills update`. The
  shipped source was already newer than its installed copy. Source parity and
  idempotence passed. Cost if wrong: 41 incidental generated lines.
- Keep grandparents, cross-repository parents, unmerged parent specs, browser
  display, GitHub body fallback, and unsupported-API fallback out of scope. Cost
  if wrong: manual context or operator intervention.
- Do not certify parent design correctness or agent compliance. Keep the
  maintainer's envelope-only rule. Cost if wrong: design drift.
- GitHub Enterprise and live Forgejo compatibility remain unverified. Forgejo
  body parsing has adapter tests. Cost if wrong: a blocked run or no parent
  context on an unsupported host.

## Frontend review

Not applicable. This delivery changes terminal text, kernel facts, and agent
instructions. It changes no browser-visible layout or interaction.

## Human Reviewer Callouts (Non-Blocking)

- `Host` implementers must now provide `parentIssue`.
- Progress records gain `parentSpec`; readers retain compatibility with older
  records.
- No dependency changes, migrations, authentication changes, or irreversible
  operations were performed.
