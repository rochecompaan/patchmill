# Run admission diagnostics

Run admission controls which attempts can share a local clone. Automatic
selection excludes every other writer for its full attempt. This change improves
the feedback without changing that rule.

A conflict with a locally observed live process returns `status: stopped`,
reason `run-admission-busy`, and exit code 0. The result explains the exclusion
and says that issue work did not start. It shows the record path, requested
mode, and recorded owner facts without the private owner token.

The feedback tells the user to wait for the recorded owner to stop. For
concurrent run-once commands, every invocation needs `--issue`. Automatic and
recovery attempts do not receive a retry command that substitutes the recorded
owner issue or changes the requested operation.

Unreadable, malformed, foreign-host, and permission-denied records remain errors
that require inspection. These conflicts use reason `run-admission-unverifiable`
and exit code 1. The feedback does not claim that these records prove an active
or dead owner.

Terminal output, redirected JSON, and JSONL run logs report the same result.
Expected live contention produces warning events rather than error events.
Neither diagnostic tells the user to delete admission records, remove guards, or
bypass admission through Issue lease repair.

Regression tests cover `run-once` and `run reset`, owner facts, safe retry
advice, record preservation, and reporting failures. Existing process tests keep
proving automatic exclusion and unchanged issue state. Admission guards,
dead-record cleanup, explicit concurrency, and Issue leases retain their
existing rules.
