import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  takeOverStalePlanningIssueLock,
  type PlanningLockObservation,
} from "./planning-issue-lock-takeover.ts";

type Record = { ownershipId: string; name: string };
const oldOwner = {
  ownershipId: "123e4567-e89b-42d3-a456-426614174000",
  name: "stale",
};
const transitionOwner = {
  ownershipId: "123e4567-e89b-42d3-a456-426614174001",
  name: "rescuer",
};

function observation(
  path: string,
  bytes: Buffer,
): PlanningLockObservation<Record> {
  const record = JSON.parse(bytes.toString("utf8")) as Record;
  return {
    classification: record.name === "stale" ? "stale" : "active",
    path,
    bytes,
    fingerprint: createHash("sha256").update(bytes).digest("hex"),
    record,
  };
}

test("archives authoritative stale bytes before creating one replacement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-takeover-"));
  const canonicalPath = join(dir, "planning-pr-v1", "locks", "issue-187.lock");
  try {
    await mkdir(join(dir, "planning-pr-v1", "locks"), { recursive: true });
    const staleBytes = Buffer.from(`${JSON.stringify(oldOwner)}\n`);
    await writeFile(canonicalPath, staleBytes);
    const read = async (path: string) => {
      try {
        const bytes = await readFile(path);
        return observation(path, bytes);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return undefined;
        throw error;
      }
    };
    const result = await takeOverStalePlanningIssueLock({
      runStateDir: dir,
      issueNumber: 187,
      canonicalPath,
      triggeringObservation: observation(canonicalPath, staleBytes),
      transitionOwner,
      adapter: {
        observe: read,
        serialize: (record) => Buffer.from(`${JSON.stringify(record)}\n`),
        createCanonical: async () => {
          const handle = await open(canonicalPath, "wx", 0o600);
          await handle.writeFile(
            `${JSON.stringify({ ...transitionOwner, name: "replacement" })}\n`,
          );
          await handle.close();
          return { path: canonicalPath };
        },
        conflict: (current): never => {
          throw new Error(`unexpected ${current.classification} conflict`);
        },
      },
    });
    assert.deepEqual(await readFile(result.evidence!.archivePath), staleBytes);
    assert.deepEqual(result.lock, { path: canonicalPath });
    assert.equal((await read(canonicalPath))?.record?.name, "replacement");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
