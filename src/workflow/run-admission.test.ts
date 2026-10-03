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

test("foreign and malformed guard owners fail closed", async () => {
  const ns = await namespace();
  try {
    const guard = join(
      ns.commonDir,
      "patchmill",
      "run-once",
      "admission-guard",
    );
    await mkdir(guard, { recursive: true });
    await writeFile(join(guard, "owner.json"), "not-json");
    await assert.rejects(
      withRunAdmission(
        { namespace: ns, attemptId: "blocked", mode: "explicit" },
        async () => undefined,
      ),
      RunAdmissionConflictError,
    );
    await writeFile(
      join(guard, "owner.json"),
      `${JSON.stringify({
        version: 1,
        ownerToken: "foreign",
        pid: 1,
        hostname: "foreign.example.test",
      })}\n`,
    );
    await assert.rejects(
      withRunAdmission(
        { namespace: ns, attemptId: "blocked", mode: "explicit" },
        async () => undefined,
      ),
      RunAdmissionConflictError,
    );
  } finally {
    await rm(ns.commonDir, { recursive: true, force: true });
  }
});

test("live guard waits without registering an admission", async () => {
  const ns = await namespace();
  try {
    const root = join(ns.commonDir, "patchmill", "run-once");
    const guard = join(root, "admission-guard");
    await mkdir(guard, { recursive: true });
    await writeFile(
      join(guard, "owner.json"),
      `${JSON.stringify({
        version: 1,
        ownerToken: "live-guard",
        pid: process.pid,
        hostname: hostname(),
      })}\n`,
    );
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("stop wait")), 20);
    await assert.rejects(
      withRunAdmission(
        {
          namespace: ns,
          attemptId: "waiting",
          mode: "explicit",
          signal: controller.signal,
        },
        async () => undefined,
      ),
      /stop wait/,
    );
    await assert.rejects(
      readFile(join(root, "admissions", "waiting.json"), "utf8"),
      /ENOENT/,
    );
  } finally {
    await rm(ns.commonDir, { recursive: true, force: true });
  }
});

test("archives a dead guard and preserves each identical-time record", async () => {
  const ns = await namespace();
  try {
    const root = join(ns.commonDir, "patchmill", "run-once");
    const guard = join(root, "admission-guard");
    await mkdir(guard, { recursive: true });
    await writeFile(
      join(guard, "owner.json"),
      `${JSON.stringify({
        version: 1,
        ownerToken: "dead-guard",
        pid: 99999999,
        hostname: hostname(),
      })}\n`,
    );
    const admissions = join(root, "admissions");
    await mkdir(admissions, { recursive: true });
    for (const name of ["dead-a.json", "dead-b.json"]) {
      await writeFile(
        join(admissions, name),
        `${JSON.stringify({
          version: 1,
          attemptId: name,
          ownerToken: name,
          mode: "explicit",
          pid: 99999999,
          hostname: hostname(),
        })}\n`,
      );
    }
    await withRunAdmission(
      { namespace: ns, attemptId: "live", mode: "explicit" },
      async () => undefined,
    );
    assert.equal(
      (await readdir(join(root, "archive", "admissions"))).length,
      2,
    );
    assert.equal(
      (await readdir(join(root, "archive", "admission-guards"))).length,
      1,
    );
  } finally {
    await rm(ns.commonDir, { recursive: true, force: true });
  }
});

test("obsolete release preserves a replacement registration", async () => {
  const ns = await namespace();
  try {
    let recordPath = "";
    await withRunAdmission(
      { namespace: ns, attemptId: "same", mode: "explicit", issueNumber: 1 },
      async (admission) => {
        recordPath = admission.recordPath;
        await writeFile(
          admission.recordPath,
          `${JSON.stringify({
            version: 1,
            attemptId: "replacement",
            ownerToken: "replacement-token",
            mode: "explicit",
            pid: process.pid,
            hostname: hostname(),
          })}\n`,
        );
      },
    );
    assert.match(await readFile(recordPath, "utf8"), /replacement-token/);
  } finally {
    await rm(ns.commonDir, { recursive: true, force: true });
  }
});
