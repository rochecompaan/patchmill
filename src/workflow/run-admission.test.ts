import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
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

test("archives a demonstrably dead local registration after exact reconciliation", async () => {
  const ns = await namespace();
  try {
    const admissions = join(
      ns.commonDir,
      "patchmill",
      "run-once",
      "admissions",
    );
    await mkdir(admissions, { recursive: true });
    await writeFile(
      join(admissions, "dead.json"),
      `${JSON.stringify({
        version: 1,
        attemptId: "dead",
        ownerToken: "dead-token",
        mode: "explicit",
        pid: 99999999,
        hostname: hostname(),
      })}\n`,
    );
    await withRunAdmission(
      { namespace: ns, attemptId: "live", mode: "explicit", issueNumber: 1 },
      async () => undefined,
    );
    const archive = join(
      ns.commonDir,
      "patchmill",
      "run-once",
      "archive",
      "admissions",
    );
    const [file] = await readdir(archive);
    assert.ok(file);
    assert.match(await readFile(join(archive, file), "utf8"), /dead-token/);
  } finally {
    await rm(ns.commonDir, { recursive: true, force: true });
  }
});

test("malformed registrations fail closed", async () => {
  const ns = await namespace();
  try {
    const admissions = join(
      ns.commonDir,
      "patchmill",
      "run-once",
      "admissions",
    );
    await mkdir(admissions, { recursive: true });
    await writeFile(join(admissions, "unknown.json"), "not-json");
    await assert.rejects(
      withRunAdmission(
        { namespace: ns, attemptId: "live", mode: "explicit", issueNumber: 1 },
        async () => undefined,
      ),
      RunAdmissionConflictError,
    );
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
