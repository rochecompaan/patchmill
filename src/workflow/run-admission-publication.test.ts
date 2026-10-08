import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  withRunAdmission,
  type RunRepositoryNamespace,
} from "./run-admission.ts";

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

// Rejecting a missing or incomplete owner immediately breaks ordinary overlap.
// Waiting must not turn an unknown record into takeover authority.
for (const window of ["missing", "empty", "releasing"] as const) {
  test(
    `explicit admission survives the ${window} guard-owner window`,
    { timeout: 10_000 },
    async (t) => {
      const root = await fs.mkdtemp(join(tmpdir(), "admission-publication-"));
      const guard = join(root, "patchmill", "run-once", "admission-guard");
      const ownerPath = join(guard, "owner.json");
      const namespace: RunRepositoryNamespace = {
        commonDir: root,
        cloneRoot: root,
        runStateDir: join(root, "state"),
        worktreeRoot: join(root, "workspaces"),
        todoRoot: { kind: "workspace-relative", path: ".pi/todos" },
        hostRepository: {
          provider: "github",
          host: "github.test",
          owner: "acme",
          repository: "repo",
        },
      };
      const paused = barrier(),
        observed = barrier(),
        resume = barrier();
      const nativeOpen = fs.open,
        nativeRead = fs.readFile,
        nativeRm = fs.rm;
      let intercepted = false,
        holding = false;
      const effects: string[] = [];
      t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        if (
          window !== "releasing" &&
          String(args[0]) === ownerPath &&
          !intercepted
        ) {
          intercepted = true;
          const handle =
            window === "empty" ? await nativeOpen(...args) : undefined;
          holding = true;
          paused.release();
          await resume.promise;
          holding = false;
          return handle ?? nativeOpen(...args);
        }
        return nativeOpen(...args);
      });
      t.mock.method(fs, "rm", async (...args: Parameters<typeof fs.rm>) => {
        if (
          window === "releasing" &&
          String(args[0]) === guard &&
          !intercepted
        ) {
          intercepted = true;
          await fs.unlink(ownerPath);
          holding = true;
          paused.release();
          await resume.promise;
          holding = false;
        }
        return nativeRm(...args);
      });
      t.mock.method(
        fs,
        "readFile",
        async (...args: Parameters<typeof fs.readFile>) => {
          try {
            return await nativeRead(...args);
          } finally {
            if (holding && String(args[0]) === ownerPath) observed.release();
          }
        },
      );
      syncBuiltinESMExports();
      const first = withRunAdmission(
        { namespace, mode: "explicit", attemptId: "first" },
        async () => {
          effects.push("first");
        },
      );
      const firstResult = Promise.allSettled([first]);
      let secondResult: Promise<PromiseSettledResult<void>[]> | undefined;
      try {
        await paused.promise;
        secondResult = Promise.allSettled([
          withRunAdmission(
            { namespace, mode: "explicit", attemptId: "second" },
            async () => {
              effects.push("second");
            },
          ),
        ]);
        await observed.promise;
        assert.deepEqual(effects, []);
        resume.release();
        assert.equal((await firstResult)[0]!.status, "fulfilled");
        assert.equal((await secondResult)[0]!.status, "fulfilled");
        assert.deepEqual(effects.sort(), ["first", "second"]);
        assert.deepEqual(
          await fs.readdir(join(root, "patchmill", "run-once", "admissions")),
          [],
        );
      } finally {
        resume.release();
        await firstResult;
        await secondResult;
        t.mock.restoreAll();
        syncBuiltinESMExports();
        await nativeRm(root, { recursive: true, force: true });
      }
    },
  );
}
