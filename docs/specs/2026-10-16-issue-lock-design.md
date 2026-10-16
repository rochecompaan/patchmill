# Per-issue lock design revision

The maintainer approved this revision and the native dependency on 2026-10-16.
It replaces the lock design in Task 7 of the skills-first kernel plan. Task 14
must also use this contract for `patchmill release`.

## Purpose and limits

Only one cooperating Patchmill operation can own an issue within the same clone.
A crash must release ownership without a timeout or manual file removal. The
existing cross-clone label race remains outside this revision.

The previous `wx`/PID-check/unlink algorithm does not provide this guarantee. A
contender can read an empty file before its owner writes JSON. Two processes
that reclaim a stale file can also remove a new owner's lock.

Use OS-managed advisory locking through `fs-ext@2.1.1`. Advisory means that all
cooperating processes must acquire the same lock before they act. The guarantee
assumes a local filesystem with working advisory locks. Hostile users, manual
deletion of active lock internals, and network filesystem locking failures are
not covered. There are no heartbeats or stale timeouts.

## Ownership and file lifetime

The permanent file remains `.patchmill/runs/issue-N/lock`. An inode is the
filesystem object behind a path. The file must keep the same inode across
acquisition, release, and crash recovery.

1. Create the parent directory and open the file with `O_CREAT | O_RDWR`. Do not
   truncate or replace the file before acquiring ownership.
2. Attempt `fs-ext.flock(fd, "exnb", callback)` once. This requests an exclusive
   lock without waiting for another owner.
3. If the lock is held, close the contender's handle and throw `LockHeldError`.
   Missing diagnostic JSON does not change this result.
4. If another open or locking error occurs, close the handle and propagate it.
   Never fall back to PID checks or pathname deletion.
5. After acquisition, truncate and write `{pid, startedAt}` through the handle.
   Return only after the write completes. Close the handle if publication fails.
6. Retain the handle until release. Clear its JSON while still locked, then
   close it in `finally`. The OS releases ownership when the descriptor closes.

Repeated and concurrent `release()` calls share one promise. They perform no
writes or closes after the first release finishes. Clearing failures remain
visible but cannot prevent the close attempt. No old release call can modify a
successor's metadata or close a descriptor that the successor now uses.

Normal acquisition, release, and run-directory cleanup must never unlink or
replace the file or its containing directory while contenders can hold handles.
An empty permanent lock file is intentional coordination data, not workflow
state. When an owner exits, the OS releases the lock. A successor acquires the
same file and overwrites any empty, corrupt, or stale diagnostics.

## Public interface and diagnostic data

Keep `LockRecord`, `IssueLock`, `acquireLock(path, options?)`, and
`readLock(path)`. The acquisition options are `pid?: number` and
`now?: () => Date`. They affect metadata only. Remove the planned `alive` option
and `isProcessAlive` helper. No implemented caller requires either interface.

`LockHeldError.record` becomes `LockRecord | undefined`. The owner can hold the
OS lock before it publishes JSON. Error messages must support unknown ownership.
Even valid JSON can describe an earlier owner during publication.

`readLock` returns parsed metadata or `undefined` for missing, empty, or
malformed content. It propagates real filesystem errors. Treat wrong-shaped JSON
as malformed. It does not report whether the OS lock is currently held. Neither
a returned record nor its absence authorizes an operation.

## Command integration

The normal run holds the issue lock through claim, agent work, and label
cleanup. It releases the handle in `finally`. Run artifacts can be cleaned
without removing the permanent issue lock or its containing directory.

`patchmill release --issue N` must acquire this same lock before inspecting or
resetting issue labels. Contention returns exit code 1 without label mutation,
including when diagnostic metadata is unavailable. After acquisition, the
command resets `in-progress` to `agent-ready` when needed. It releases its
handle in `finally`, including after host errors. A diagnostic read followed by
an unprotected label mutation is not permitted.

## Dependencies and verification

Add `fs-ext` as a direct runtime dependency and suitable development typings.
Update `package-lock.json` and `npm-shrinkwrap.json` together. Keep their
contents identical. Refresh `nix/package.nix`'s dependency hash. Add native
build inputs only if the pinned Nix builder needs them. Do not change Pi or
skill-pack pins.

Use real locks, temporary directories, and IPC messages between fixture
processes. IPC means messages exchanged between the test and its children. Use
explicit acknowledgements to order each test. Timeouts only bound failures.

The tests must cover same-process contention, acquisition before JSON
publication, competing recovery of corrupt diagnostics, and preopened
contenders. They must also cover repeated release after successor acquisition,
owner exit, ordinary child descriptor inheritance, and cleanup after a failed
metadata write. Real filesystem and locking errors must remain visible.

Run the covering tests, full npm tests, lint, build, and the normal Nix package
build. Include a native-load or real locking check on the built package. Report
the tested OS, architecture, and Node version. Native compatibility on other
platforms remains unverified until their own builds run.

## Source evidence

- [Linux flock ownership and lifetime](https://man7.org/linux/man-pages/man2/flock.2.html)
- [Apple advisory-lock interface](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/flock.2.html)
- [fs-ext API and native dependency](https://github.com/baudehlo/node-fs-ext)
- [Node 22 filesystem API](https://nodejs.org/docs/latest-v22.x/api/fs.html)
