import assert from "node:assert/strict";
import { test } from "node:test";
import { ForgejoTeaHostProvider } from "./forgejo-tea.ts";
import type { LabelChangePlan, LabelDefinition, IssueSummary } from "./types.ts";
import type { CommandResult, CommandRunner } from "../../scripts/agent-issue-triage/types.ts";

type RecordedCall = {
  command: string;
  args: string[];
  cwd?: string;
};

const repoRoot = "/repo";
const login = "bot";

function createFakeRunner(
  respond: (command: string, args: string[], cwd?: string) => CommandResult | Promise<CommandResult>,
): CommandRunner & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async run(command, args, options = {}) {
      calls.push({ command, args: [...args], cwd: options.cwd });
      return respond(command, args, options.cwd);
    },
  };
}

function createProvider(runner: CommandRunner): ForgejoTeaHostProvider {
  return new ForgejoTeaHostProvider({ runner, repoRoot, login });
}

function assertTeaContext(call: RecordedCall): void {
  assert.equal(call.command, "tea");
  assert.equal(call.cwd, repoRoot);
  assert.ok(call.args.includes("--repo"));
  assert.ok(call.args.includes(repoRoot));
  assert.ok(call.args.includes("--login"));
  assert.ok(call.args.includes(login));

  const separatorIndex = call.args.indexOf("--");
  const repoIndex = call.args.indexOf("--repo");
  const loginIndex = call.args.indexOf("--login");
  if (separatorIndex !== -1) {
    assert.ok(repoIndex >= 0 && repoIndex < separatorIndex);
    assert.ok(loginIndex >= 0 && loginIndex < separatorIndex);
  }
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

test("ForgejoTeaHostProvider delegates open issue listing to tea", async () => {
  const runner = createFakeRunner((_command, args) => {
    const page = flagValue(args, "--page");
    if (args[0] === "issues" && args[1] === "list" && page === "1") {
      return {
        code: 0,
        stdout: JSON.stringify([{ index: 7, title: "Needs docs", body: "Update docs", state: "open", labels: [{ name: "docs" }] }]),
        stderr: "",
      };
    }
    if (args[0] === "issues" && args[1] === "list" && page === "2") {
      return { code: 0, stdout: JSON.stringify([]), stderr: "" };
    }
    throw new Error(`Unexpected command: ${args.join(" ")}`);
  });

  const issues = await createProvider(runner).listOpenIssues();

  assert.deepEqual(issues, [{ number: 7, title: "Needs docs", body: "Update docs", state: "open", labels: ["docs"], author: undefined, updated: undefined, comments: undefined }]);
  assert.equal(runner.calls.length, 2);
  assertTeaContext(runner.calls[0]!);
  assert.deepEqual(runner.calls[0]!.args.slice(0, 2), ["issues", "list"]);
  assert.equal(flagValue(runner.calls[0]!.args, "--state"), "open");
  assert.equal(flagValue(runner.calls[0]!.args, "--output"), "json");
  assert.equal(flagValue(runner.calls[0]!.args, "--page"), "1");
  assertTeaContext(runner.calls[1]!);
  assert.equal(flagValue(runner.calls[1]!.args, "--page"), "2");
});

test("ForgejoTeaHostProvider hydrates issue comments through tea and returns the hydrated array", async () => {
  const issues: IssueSummary[] = [
    { number: 7, title: "First", body: "", state: "open", labels: [] },
    { number: 8, title: "Second", body: "", state: "open", labels: [] },
  ];
  const runner = createFakeRunner((_command, args) => {
    if (args[0] === "issues" && args[1] === "7" && args.includes("--comments")) {
      return { code: 0, stdout: "## Comments\n\n**@ana** wrote on 2026-05-08 10:30:\n\nFirst comment.\n\n--------\n", stderr: "" };
    }
    if (args[0] === "issues" && args[1] === "8" && args.includes("--comments")) {
      return { code: 0, stdout: "## Comments\n\n**@sam** wrote on 2026-05-08 11:45:\n\nSecond comment.\n\n--------\n", stderr: "" };
    }
    throw new Error(`Unexpected command: ${args.join(" ")}`);
  });

  const hydrated = await createProvider(runner).hydrateIssueComments(issues);

  assert.strictEqual(hydrated, issues);
  assert.deepEqual(hydrated[0]?.comments, [{ author: "ana", created: "2026-05-08 10:30", body: "First comment." }]);
  assert.deepEqual(hydrated[1]?.comments, [{ author: "sam", created: "2026-05-08 11:45", body: "Second comment." }]);
  assert.equal(runner.calls.length, 2);
  for (const [index, issueNumber] of ["7", "8"].entries()) {
    assertTeaContext(runner.calls[index]!);
    assert.equal(runner.calls[index]!.args[0], "issues");
    assert.equal(runner.calls[index]!.args[1], issueNumber);
    assert.ok(runner.calls[index]!.args.includes("--comments"));
  }
});

test("ForgejoTeaHostProvider delegates label listing to tea", async () => {
  const runner = createFakeRunner((_command, args) => {
    if (args[0] === "labels" && args[1] === "list") {
      return { code: 0, stdout: JSON.stringify([{ name: "agent-ready" }, { name: "bug" }]), stderr: "" };
    }
    throw new Error(`Unexpected command: ${args.join(" ")}`);
  });

  const labels = await createProvider(runner).listLabels();

  assert.deepEqual(labels, ["agent-ready", "bug"]);
  assert.equal(runner.calls.length, 1);
  assertTeaContext(runner.calls[0]!);
  assert.deepEqual(runner.calls[0]!.args.slice(0, 2), ["labels", "list"]);
  assert.equal(flagValue(runner.calls[0]!.args, "--output"), "json");
});

test("ForgejoTeaHostProvider delegates label creation to tea", async () => {
  const label: LabelDefinition = { name: "agent-ready", color: "#2ea043", description: "Ready for implementation" };
  const runner = createFakeRunner((_command, args) => {
    if (args[0] === "labels" && args[1] === "create") return { code: 0, stdout: "", stderr: "" };
    throw new Error(`Unexpected command: ${args.join(" ")}`);
  });

  await createProvider(runner).createLabel(label);

  assert.equal(runner.calls.length, 1);
  assertTeaContext(runner.calls[0]!);
  assert.deepEqual(runner.calls[0]!.args.slice(0, 2), ["labels", "create"]);
  assert.equal(flagValue(runner.calls[0]!.args, "--name"), label.name);
  assert.equal(flagValue(runner.calls[0]!.args, "--color"), label.color);
  assert.equal(flagValue(runner.calls[0]!.args, "--description"), label.description);
});

test("ForgejoTeaHostProvider delegates label application to tea", async () => {
  const change: LabelChangePlan = {
    issueNumber: 12,
    oldLabels: ["bug"],
    newLabels: ["agent-ready"],
    addLabels: ["agent-ready"],
    removeLabels: ["bug"],
  };
  const runner = createFakeRunner((_command, args) => {
    if (args[0] === "issues" && args[1] === "edit") return { code: 0, stdout: "", stderr: "" };
    throw new Error(`Unexpected command: ${args.join(" ")}`);
  });

  await createProvider(runner).applyLabels(change);

  assert.equal(runner.calls.length, 1);
  assertTeaContext(runner.calls[0]!);
  assert.deepEqual(runner.calls[0]!.args.slice(0, 2), ["issues", "edit"]);
  assert.equal(runner.calls[0]!.args[2], String(change.issueNumber));
  assert.equal(flagValue(runner.calls[0]!.args, "--remove-labels"), "bug");
  assert.equal(flagValue(runner.calls[0]!.args, "--add-labels"), "agent-ready");
});

test("ForgejoTeaHostProvider delegates issue comments to tea", async () => {
  const issueNumber = 9;
  const body = "Automated triage needs more information.";
  const runner = createFakeRunner((_command, args) => {
    if (args[0] === "comment" && args[1] === String(issueNumber)) return { code: 0, stdout: "", stderr: "" };
    throw new Error(`Unexpected command: ${args.join(" ")}`);
  });

  await createProvider(runner).commentIssue(issueNumber, body);

  assert.equal(runner.calls.length, 1);
  assertTeaContext(runner.calls[0]!);
  assert.deepEqual(runner.calls[0]!.args.slice(0, 2), ["comment", String(issueNumber)]);
  const separatorIndex = runner.calls[0]!.args.indexOf("--");
  assert.ok(separatorIndex >= 0);
  assert.equal(runner.calls[0]!.args[separatorIndex + 1], body);
});
