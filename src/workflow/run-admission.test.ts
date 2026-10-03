import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  RunAdmissionConflictError,
  withRunAdmission,
  type RunRepositoryNamespace,
} from "./run-admission.ts";

async function namespace(): Promise<RunRepositoryNamespace> {
  const root = await mkdtemp(join(tmpdir(), "run-admission-"));
  return {
    commonDir: root,
    cloneRoot: root,
    hostRepository: {
      provider: "github",
      host: "github.example.test",
      owner: "patchmill",
      repository: "demo",
    },
    runStateDir: join(root, "state"),
    worktreeRoot: join(root, "workspaces"),
    todoRoot: { kind: "workspace-relative", path: ".pi/todos" },
  };
}

test("explicit attempts coexist", async () => {
  const ns = await namespace();
  try {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstEntered!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });
    const first = withRunAdmission(
      { namespace: ns, attemptId: "first", mode: "explicit", issueNumber: 1 },
      async () => {
        firstEntered();
        await firstBlocked;
      },
    );
    await firstStarted;
    await withRunAdmission(
      { namespace: ns, attemptId: "second", mode: "explicit", issueNumber: 2 },
      async () => undefined,
    );
    releaseFirst();
    await first;
  } finally {
    await rm(ns.commonDir, { recursive: true, force: true });
  }
});

test("automatic admission excludes every writer", async () => {
  const ns = await namespace();
  try {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const automatic = withRunAdmission(
      { namespace: ns, attemptId: "automatic", mode: "automatic" },
      async () => {
        entered();
        await blocked;
      },
    );
    await started;
    await assert.rejects(
      withRunAdmission(
        {
          namespace: ns,
          attemptId: "explicit",
          mode: "explicit",
          issueNumber: 2,
        },
        async () => undefined,
      ),
      RunAdmissionConflictError,
    );
    release();
    await automatic;
  } finally {
    await rm(ns.commonDir, { recursive: true, force: true });
  }
});

test("obsolete release preserves a replacement registration", async () => {
  const ns = await namespace();
  try {
    let firstAdmission: { recordPath: string; ownerToken: string } | undefined;
    await withRunAdmission(
      { namespace: ns, attemptId: "same", mode: "explicit", issueNumber: 1 },
      async (admission) => {
        firstAdmission = admission;
      },
    );
    await withRunAdmission(
      { namespace: ns, attemptId: "same", mode: "explicit", issueNumber: 1 },
      async () => undefined,
    );
    assert.ok(firstAdmission);
  } finally {
    await rm(ns.commonDir, { recursive: true, force: true });
  }
});
