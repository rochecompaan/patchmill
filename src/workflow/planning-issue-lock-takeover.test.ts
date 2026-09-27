import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  takeOverStalePlanningIssueLock,
  type PlanningLockObservation,
} from "./planning-issue-lock-takeover.ts";

type Record = { ownershipId: string; name: "stale" | "active" | "replacement" };
const oldOwner: Record = {
  ownershipId: "123e4567-e89b-42d3-a456-426614174000",
  name: "stale",
};
const transitionOwner: Record = {
  ownershipId: "123e4567-e89b-42d3-a456-426614174001",
  name: "active",
};

function classify(
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

async function observe(
  path: string,
): Promise<PlanningLockObservation<Record> | undefined> {
  try {
    const info = await stat(path);
    const bytes = info.isDirectory()
      ? await readFile(
          join(
            path,
            path.endsWith(".takeover") ? "owner.lock" : "owner.record",
          ),
        )
      : await readFile(path);
    return classify(path, bytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function createCanonicalDirectory(
  path: string,
): Promise<{ path: string }> {
  const temporary = `${path}.replacement.tmp`;
  await mkdir(temporary, { mode: 0o700 });
  const handle = await open(join(temporary, "owner.record"), "wx", 0o600);
  try {
    await handle.writeFile(
      `${JSON.stringify({ ...transitionOwner, name: "replacement" })}\n`,
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  return { path };
}

function adapter(canonicalPath: string) {
  return {
    observe,
    serialize: (record: Record) => Buffer.from(`${JSON.stringify(record)}\n`),
    createCanonical: () => createCanonicalDirectory(canonicalPath),
    conflict: (
      current: PlanningLockObservation<Record>,
      resource: string,
    ): never => {
      throw new Error(`${resource}:${current.classification}`);
    },
  };
}

test("archives a legacy stale owner before creating a complete directory replacement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-takeover-"));
  const canonicalPath = join(dir, "planning-pr-v1", "locks", "issue-187.lock");
  try {
    await mkdir(join(dir, "planning-pr-v1", "locks"), { recursive: true });
    const staleBytes = Buffer.from(`${JSON.stringify(oldOwner)}\n`);
    await writeFile(canonicalPath, staleBytes, { mode: 0o600 });
    const result = await takeOverStalePlanningIssueLock({
      runStateDir: dir,
      issueNumber: 187,
      canonicalPath,
      triggeringObservation: classify(canonicalPath, staleBytes),
      transitionOwner,
      adapter: adapter(canonicalPath),
    });
    assert.deepEqual(await readFile(result.evidence!.archivePath), staleBytes);
    assert.deepEqual(result.lock, { path: canonicalPath });
    assert.equal((await stat(canonicalPath)).isDirectory(), true);
    assert.equal(
      (await stat(join(canonicalPath, "owner.record"))).mode & 0o777,
      0o600,
    );
    assert.deepEqual(await readdir(canonicalPath), ["owner.record"]);
    await assert.rejects(
      stat(join(dir, "planning-pr-v1", "locks", "issue-187.takeover")),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("archives a stale transition directory intact before taking over", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-takeover-"));
  const root = join(dir, "planning-pr-v1");
  const canonicalPath = join(root, "locks", "issue-187.lock");
  const transitionPath = join(root, "locks", "issue-187.takeover");
  try {
    await mkdir(transitionPath, { recursive: true, mode: 0o700 });
    const staleTransition: Record = {
      ownershipId: "123e4567-e89b-42d3-a456-426614174002",
      name: "stale",
    };
    const transitionBytes = Buffer.from(`${JSON.stringify(staleTransition)}\n`);
    await writeFile(join(transitionPath, "owner.lock"), transitionBytes, {
      mode: 0o600,
    });
    const staleBytes = Buffer.from(`${JSON.stringify(oldOwner)}\n`);
    await writeFile(canonicalPath, staleBytes, { mode: 0o600 });
    await takeOverStalePlanningIssueLock({
      runStateDir: dir,
      issueNumber: 187,
      canonicalPath,
      triggeringObservation: classify(canonicalPath, staleBytes),
      transitionOwner,
      adapter: adapter(canonicalPath),
    });
    const archivedOwner = join(
      root,
      "archive",
      "issue-lock-transitions",
      "issue-187",
      staleTransition.ownershipId,
      "owner.lock",
    );
    assert.deepEqual(await readFile(archivedOwner), transitionBytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("never overwrites an existing stale-lock archive destination", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-takeover-"));
  const root = join(dir, "planning-pr-v1");
  const canonicalPath = join(root, "locks", "issue-187.lock");
  try {
    await mkdir(join(root, "locks"), { recursive: true });
    const staleBytes = Buffer.from(`${JSON.stringify(oldOwner)}\n`);
    await writeFile(canonicalPath, staleBytes, { mode: 0o600 });
    const archivePath = join(
      root,
      "archive",
      "issue-locks",
      "issue-187",
      `${oldOwner.ownershipId}.lock`,
    );
    await mkdir(join(root, "archive", "issue-locks", "issue-187"), {
      recursive: true,
    });
    await writeFile(archivePath, "existing evidence");
    await assert.rejects(
      takeOverStalePlanningIssueLock({
        runStateDir: dir,
        issueNumber: 187,
        canonicalPath,
        triggeringObservation: classify(canonicalPath, staleBytes),
        transitionOwner,
        adapter: adapter(canonicalPath),
      }),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "EEXIST",
    );
    assert.equal(await readFile(archivePath, "utf8"), "existing evidence");
    assert.deepEqual(await readFile(canonicalPath), staleBytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("active transition ownership blocks without mutating the canonical owner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "planning-takeover-"));
  const root = join(dir, "planning-pr-v1");
  const canonicalPath = join(root, "locks", "issue-187.lock");
  const transitionPath = join(root, "locks", "issue-187.takeover");
  try {
    await mkdir(transitionPath, { recursive: true, mode: 0o700 });
    await writeFile(
      join(transitionPath, "owner.lock"),
      `${JSON.stringify(transitionOwner)}\n`,
      { mode: 0o600 },
    );
    const staleBytes = Buffer.from(`${JSON.stringify(oldOwner)}\n`);
    await writeFile(canonicalPath, staleBytes, { mode: 0o600 });
    await assert.rejects(
      takeOverStalePlanningIssueLock({
        runStateDir: dir,
        issueNumber: 187,
        canonicalPath,
        triggeringObservation: classify(canonicalPath, staleBytes),
        transitionOwner: {
          ...transitionOwner,
          ownershipId: "123e4567-e89b-42d3-a456-426614174003",
        },
        adapter: adapter(canonicalPath),
      }),
      /takeover-transition:active/,
    );
    assert.deepEqual(await readFile(canonicalPath), staleBytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
