import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import type {
  HostCliCheck,
  IssueHostProvider,
  IssueSummary,
  LabelChangePlan,
  LabelDefinition,
} from "../../../host/types.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import { ensureRequiredLabels } from "./setup.ts";

const policy = createTriagePolicy(
  DEFAULT_PATCHMILL_CONFIG.labels,
  DEFAULT_PATCHMILL_CONFIG.triage,
);
const requiredLabelNames = policy.allowedLabels.map((label) => label.name);

type FakeHostOptions = {
  existingLabels?: string[];
  failOnCreate?: string;
};

function fakeHost(options: FakeHostOptions = {}) {
  const created: string[] = [];
  const host: IssueHostProvider = {
    id: "github-gh",
    displayName: "GitHub via gh",
    async checkCli(): Promise<HostCliCheck> {
      return { ok: true, message: "ok" };
    },
    missingLabelRemediation(label: LabelDefinition): string {
      return `create ${label.name}`;
    },
    async listOpenIssues(): Promise<IssueSummary[]> {
      return [];
    },
    async hydrateIssueComments(
      issues: IssueSummary[],
    ): Promise<IssueSummary[]> {
      return issues;
    },
    async listLabels(): Promise<string[]> {
      return options.existingLabels ?? requiredLabelNames;
    },
    async createLabel(label: LabelDefinition): Promise<void> {
      if (label.name === options.failOnCreate) {
        throw new Error("host rejected label");
      }
      created.push(label.name);
    },
    async applyLabels(_change: LabelChangePlan): Promise<void> {
      return undefined;
    },
    async commentIssue(): Promise<void> {
      return undefined;
    },
  };

  return { host, created };
}

test("ensureRequiredLabels reports satisfied when no labels are missing", async () => {
  const { host, created } = fakeHost();

  const result = await ensureRequiredLabels({
    host,
    policy,
    isInteractive: false,
    assumeYes: false,
    command: "init",
  });

  assert.equal(result.status, "satisfied");
  assert.equal(result.missingCount, 0);
  assert.equal(result.createdCount, 0);
  assert.equal(created.length, 0);
  assert.match(result.message, /Required labels already exist/);
});

test("ensureRequiredLabels lists labels and skips creation when prompt is declined", async () => {
  const { host, created } = fakeHost({
    existingLabels: requiredLabelNames.filter((name) => name !== "agent-ready"),
  });
  let question = "";

  const result = await ensureRequiredLabels({
    host,
    policy,
    isInteractive: true,
    assumeYes: false,
    command: "init",
    prompt: async (value) => {
      question = value;
      return "no";
    },
  });

  assert.equal(result.status, "skipped");
  assert.deepEqual(created, []);
  assert.match(question, /agent-ready — Ready for automated agent processing/);
  assert.match(
    result.message,
    /agent-ready — Ready for automated agent processing/,
  );
  assert.match(
    result.message,
    /You can edit label names in patchmill\.config\.json after init/,
  );
  assert.match(result.message, /patchmill doctor --fix/);
});

test("ensureRequiredLabels creates missing labels after approval", async () => {
  const { host, created } = fakeHost({ existingLabels: [] });

  const result = await ensureRequiredLabels({
    host,
    policy,
    isInteractive: true,
    assumeYes: false,
    command: "doctor",
    prompt: async () => "y",
  });

  assert.equal(result.status, "created");
  assert.equal(result.missingCount, requiredLabelNames.length);
  assert.equal(result.createdCount, requiredLabelNames.length);
  assert.deepEqual(created, requiredLabelNames);
  assert.match(result.message, /Patchmill needs these labels on GitHub via gh/);
  assert.match(result.message, /Created 15 labels/);
});

test("ensureRequiredLabels creates without prompting when assumeYes is set", async () => {
  const { host, created } = fakeHost({
    existingLabels: requiredLabelNames.filter((name) => name !== "agent-ready"),
  });
  let prompted = false;

  const result = await ensureRequiredLabels({
    host,
    policy,
    isInteractive: false,
    assumeYes: true,
    command: "doctor",
    prompt: async () => {
      prompted = true;
      return "no";
    },
  });

  assert.equal(prompted, false);
  assert.equal(result.status, "created");
  assert.deepEqual(created, ["agent-ready"]);
  assert.match(result.message, /Created 1 label/);
});

test("ensureRequiredLabels skips in non-interactive mode without assumeYes", async () => {
  const { host, created } = fakeHost({
    existingLabels: requiredLabelNames.filter((name) => name !== "agent-ready"),
  });

  const result = await ensureRequiredLabels({
    host,
    policy,
    isInteractive: false,
    assumeYes: false,
    command: "init",
  });

  assert.equal(result.status, "skipped");
  assert.deepEqual(created, []);
  assert.match(result.message, /Skipped label creation/);
  assert.match(result.message, /patchmill doctor --fix/);
});

test("ensureRequiredLabels reports creation failures with label names", async () => {
  const { host, created } = fakeHost({
    existingLabels: requiredLabelNames.filter((name) => name !== "agent-ready"),
    failOnCreate: "agent-ready",
  });

  const result = await ensureRequiredLabels({
    host,
    policy,
    isInteractive: false,
    assumeYes: true,
    command: "doctor",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.createdCount, 0);
  assert.deepEqual(created, []);
  assert.match(result.message, /Failed to create label agent-ready/);
  assert.match(result.message, /host rejected label/);
});
