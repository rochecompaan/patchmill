import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "../config/defaults.ts";
import { automationProtectionLabels, requiredLabels } from "./labels.ts";

test("requiredLabels derives automation labels from config", () => {
  const labels = requiredLabels({ ...DEFAULT_PATCHMILL_CONFIG.labels, ready: "ready-for-bots" });
  assert.ok(labels.some((label) => label.name === "ready-for-bots"));
});

test("requiredLabels derives configured type labels", () => {
  const labels = requiredLabels({
    ...DEFAULT_PATCHMILL_CONFIG.labels,
    types: ["incident", "maintenance"],
  });

  assert.deepEqual(
    labels
      .filter((label) => ["incident", "maintenance"].includes(label.name))
      .map((label) => ({ name: label.name, color: label.color, description: label.description })),
    [
      { name: "incident", color: "#d73a4a", description: "Incident" },
      { name: "maintenance", color: "#a2eeef", description: "Maintenance" },
    ],
  );
});

test("requiredLabels derives priority labels from config", () => {
  const labels = requiredLabels({
    ...DEFAULT_PATCHMILL_CONFIG.labels,
    priorities: ["priority:urgent", DEFAULT_PATCHMILL_CONFIG.labels.priorities[3]!],
  });

  assert.deepEqual(
    labels
      .filter((label) => ["priority:urgent", "priority:low"].includes(label.name))
      .map((label) => ({ name: label.name, color: label.color, description: label.description })),
    [
      { name: "priority:urgent", color: "#cf222e", description: "Urgent priority" },
      { name: "priority:low", color: "#8b949e", description: "Low priority" },
    ],
  );
});

test("automationProtectionLabels includes configured done label", () => {
  const labels = automationProtectionLabels({ ...DEFAULT_PATCHMILL_CONFIG.labels, done: "factory-done" });
  assert.ok(labels.has("factory-done"));
});

test("requiredLabels clones default type definitions", () => {
  const first = requiredLabels(DEFAULT_PATCHMILL_CONFIG.labels);
  const bug = first.find((label) => label.name === "bug");
  assert.ok(bug);
  bug.description = "Mutated";

  const second = requiredLabels(DEFAULT_PATCHMILL_CONFIG.labels);
  const freshBug = second.find((label) => label.name === "bug");
  assert.ok(freshBug);
  assert.equal(freshBug.description, "Something is broken");
  assert.notEqual(freshBug, bug);
});
