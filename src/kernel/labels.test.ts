import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG, type LabelsConfig } from "../config/config.ts";
import type { Host, LabelDefinition } from "../host/types.ts";
import {
  claimSwap,
  ensureLabels,
  labelCatalog,
  releaseSwap,
} from "./labels.ts";

const labels: LabelsConfig = {
  ready: "queue",
  inProgress: "working",
  needsInfo: "question",
  done: "finished",
  unsuitable: "manual",
  blocked: "waiting",
};
const names = ["queue", "working", "question", "finished", "manual", "waiting"];

function fakeHost(existing: LabelDefinition[]) {
  const stored = structuredClone(existing);
  let lists = 0;
  const unexpected = async (): Promise<never> => {
    throw new Error("Unexpected host operation");
  };
  const host: Host = {
    checkCli: unexpected,
    repository: unexpected,
    listOpenIssues: unexpected,
    viewIssue: unexpected,
    setLabels: unexpected,
    commentIssue: unexpected,
    pushRepository: unexpected,
    listPullRequests: unexpected,
    listLabels: async () => {
      lists++;
      return stored.map((label) => label.name);
    },
    createLabel: async (label) => {
      stored.push(structuredClone(label));
    },
  };
  return { host, stored, lists: () => lists };
}

test("catalog maps all six roles to configured names and keeps role metadata", () => {
  const custom = labelCatalog(labels);
  assert.deepEqual(
    custom.map((label) => label.name),
    names,
  );
  const defaults = labelCatalog(DEFAULT_CONFIG.labels);
  assert.equal(defaults.length, 6);
  assert.deepEqual(
    custom.map(({ color, description }) => ({ color, description })),
    defaults.map(({ color, description }) => ({ color, description })),
  );
  custom[0]!.name = "changed";
  assert.equal(labelCatalog(labels)[0]!.name, "queue");
});

test("ensureLabels lists once, creates only four missing names, and preserves existing metadata and unrelated labels", async () => {
  const existing = ["queue", "approved", "finished", "unrelated"].map(
    (name) => ({ name, color: "123456", description: "Keep me" }),
  );
  const h = fakeHost(existing);
  assert.deepEqual(await ensureLabels(h.host, labels), [
    "working",
    "question",
    "manual",
    "waiting",
  ]);
  assert.equal(h.lists(), 1);
  assert.deepEqual(h.stored.slice(0, 4), existing);
  assert.deepEqual(
    h.stored.slice(4),
    labelCatalog(labels).filter(
      (label) => !existing.some((old) => old.name === label.name),
    ),
  );
  assert.deepEqual(await ensureLabels(h.host, labels), []);
  assert.equal(h.stored.length, 8);
});

test("ensureLabels propagates list and create errors without continuing", async () => {
  const failure = new Error("host unavailable");
  const h = fakeHost([]);
  h.host.listLabels = async () => {
    throw failure;
  };
  await assert.rejects(
    ensureLabels(h.host, labels),
    (error) => error === failure,
  );
  assert.deepEqual(h.stored, []);
  h.host.listLabels = async () => [];
  let attempts = 0;
  h.host.createLabel = async () => {
    attempts++;
    throw failure;
  };
  await assert.rejects(
    ensureLabels(h.host, labels),
    (error) => error === failure,
  );
  assert.equal(attempts, 1);
});

test("claimSwap changes only the claim labels", () => {
  assert.deepEqual(claimSwap(labels), {
    add: ["working"],
    remove: ["queue", "question"],
  });
});

for (const [outcome, name] of [
  ["done", "finished"],
  ["needsInfo", "question"],
  ["inProgress", "working"],
] as const) {
  test(`releaseSwap maps ${outcome} and removes only inProgress`, () => {
    assert.deepEqual(releaseSwap(labels, outcome), {
      add: [name],
      remove: outcome === "inProgress" ? [] : ["working"],
    });
  });
}

test("two roles sharing a missing label create and return that name once", async () => {
  const shared = { ...labels, ready: "shared", blocked: "shared" };
  const h = fakeHost(
    Object.values(shared)
      .filter((name) => name !== "shared")
      .map((name) => ({ name, color: "123456", description: "Existing" })),
  );
  assert.deepEqual(await ensureLabels(h.host, shared), ["shared"]);
  assert.equal(h.stored.filter((label) => label.name === "shared").length, 1);
});
