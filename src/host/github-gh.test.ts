import assert from "node:assert/strict";
import { test } from "node:test";
import { GitHubGhHostProvider } from "./github-gh.ts";
import type {
  CommandResult,
  CommandRunner,
} from "../cli/commands/triage/types.ts";
import type { IssueSummary, LabelDefinition } from "./types.ts";

type RecordedCall = {
  command: string;
  args: string[];
  cwd?: string;
};

const repoRoot = "/repo";

function scriptedRunner(
  responses: Record<string, CommandResult>,
): CommandRunner & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async run(command, args, options = {}) {
      calls.push({ command, args: [...args], cwd: options.cwd });
      const key = [command, ...args].join(" ");
      const response = responses[key];
      if (!response) throw new Error(`Unexpected command: ${key}`);
      return response;
    },
  };
}

function createProvider(runner: CommandRunner): GitHubGhHostProvider {
  return new GitHubGhHostProvider({ runner, repoRoot });
}

function commandLines(runner: { calls: RecordedCall[] }): string[] {
  return runner.calls.map((call) => [call.command, ...call.args].join(" "));
}

function assertGhContext(call: RecordedCall): void {
  assert.equal(call.command, "gh");
  assert.equal(call.cwd, repoRoot);
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

test("GitHubGhHostProvider lists open issues", async () => {
  const runner = scriptedRunner({
    "gh issue list --state open --limit 1000 --json number,title,body,state,labels,author,updatedAt,url":
      {
        code: 0,
        stdout: JSON.stringify([
          {
            number: 42,
            title: "Fix dashboard",
            body: null,
            state: "OPEN",
            labels: [{ name: "agent-ready" }, { name: "bug" }],
            author: { login: "alice" },
            updatedAt: "2026-05-28T10:00:00Z",
            url: "https://github.example/issues/12",
          },
        ]),
        stderr: "",
      },
  });
  const provider = new GitHubGhHostProvider({ runner, repoRoot });

  const issues = await provider.listOpenIssues();

  assert.deepEqual(issues, [
    {
      number: 42,
      title: "Fix dashboard",
      body: "",
      state: "open",
      labels: ["agent-ready", "bug"],
      author: "alice",
      updated: "2026-05-28T10:00:00Z",
      url: "https://github.example/issues/12",
    },
  ]);
  assert.equal(issues[0]?.url, "https://github.example/issues/12");
  assert.equal(runner.calls.length, 1);
  assertGhContext(runner.calls[0]!);
});

test("GitHubGhHostProvider reports CLI readiness", async () => {
  const runner = scriptedRunner({
    "gh --version": { code: 0, stdout: "gh version 2.0.0", stderr: "" },
    "gh auth status": { code: 0, stdout: "Logged in", stderr: "" },
  });

  const result = await createProvider(runner).checkCli();

  assert.deepEqual(result, { ok: true, message: "github via gh" });
  assert.deepEqual(commandLines(runner), ["gh --version", "gh auth status"]);
  assertGhContext(runner.calls[0]!);
  assertGhContext(runner.calls[1]!);
});

test("GitHubGhHostProvider reports CLI version failures with remediation", async () => {
  const runner = scriptedRunner({
    "gh --version": { code: 1, stdout: "", stderr: "gh not found" },
  });

  const result = await createProvider(runner).checkCli();

  assert.deepEqual(result, {
    ok: false,
    message: "gh --version failed: gh not found",
    remediation: [
      "Install and authenticate gh, then rerun:",
      "  gh auth login",
      "  patchmill doctor",
    ],
  });
  assert.deepEqual(commandLines(runner), ["gh --version"]);
  assertGhContext(runner.calls[0]!);
});

test("GitHubGhHostProvider reports CLI authentication failures with remediation", async () => {
  const runner = scriptedRunner({
    "gh --version": { code: 0, stdout: "gh version 2.0.0", stderr: "" },
    "gh auth status": { code: 1, stdout: "", stderr: "not logged in" },
  });

  const result = await createProvider(runner).checkCli();

  assert.deepEqual(result, {
    ok: false,
    message: "gh auth status failed: not logged in",
    remediation: [
      "Install and authenticate gh, then rerun:",
      "  gh auth login",
      "  patchmill doctor",
    ],
  });
});

test("GitHubGhHostProvider hydrates issue comments from gh issue view", async () => {
  const comments = [{ author: { login: "alice" }, body: "First comment" }];
  const runner = scriptedRunner({
    "gh issue view 7 --json number,title,body,state,labels,author,updatedAt,url,comments":
      {
        code: 0,
        stdout: JSON.stringify({
          number: 7,
          title: "First",
          body: "",
          state: "OPEN",
          labels: [],
          author: { login: "ana" },
          updatedAt: "2026-05-28T10:00:00Z",
          comments,
          url: "https://github.example/issues/12",
        }),
        stderr: "",
      },
  });
  const issues: IssueSummary[] = [
    { number: 7, title: "First", body: "", state: "open", labels: [] },
  ];

  const hydrated = await createProvider(runner).hydrateIssueComments(issues);

  assert.strictEqual(hydrated, issues);
  assert.deepEqual(issues[0]?.comments, comments);
  assert.deepEqual(commandLines(runner), [
    "gh issue view 7 --json number,title,body,state,labels,author,updatedAt,url,comments",
  ]);
});

test("GitHubGhHostProvider views one issue by number", async () => {
  const runner = scriptedRunner({
    "gh issue view 2 --json number,title,body,state,labels,author,updatedAt,url,comments":
      {
        code: 0,
        stdout: JSON.stringify({
          number: 2,
          title: "Two",
          body: null,
          state: "CLOSED",
          labels: [{ name: "docs" }],
          author: { login: "bob" },
          updatedAt: "2026-05-28T11:00:00Z",
          comments: [{ body: "done" }],
          url: "https://github.example/issues/2",
        }),
        stderr: "",
      },
  });

  const issue = await createProvider(runner).viewIssue(2);

  assert.deepEqual(commandLines(runner), [
    "gh issue view 2 --json number,title,body,state,labels,author,updatedAt,url,comments",
  ]);
  assert.equal(issue.number, 2);
  assert.equal(issue.body, "");
  assert.equal(issue.state, "closed");
  assert.deepEqual(issue.comments, [{ body: "done" }]);
});

test("GitHubGhHostProvider lists labels", async () => {
  const runner = scriptedRunner({
    "gh label list --limit 1000 --json name": {
      code: 0,
      stdout: JSON.stringify([{ name: "agent-ready" }, { name: "bug" }]),
      stderr: "",
    },
  });

  const labels = await createProvider(runner).listLabels();

  assert.deepEqual(labels, ["agent-ready", "bug"]);
  assert.deepEqual(commandLines(runner), [
    "gh label list --limit 1000 --json name",
  ]);
});

test("GitHubGhHostProvider strips leading hash when creating labels", async () => {
  const label: LabelDefinition = {
    name: "agent-ready",
    color: "#2ea043",
    description: "Ready for implementation",
  };
  const runner = scriptedRunner({
    "gh label create agent-ready --color 2ea043 --description Ready for implementation":
      { code: 0, stdout: "", stderr: "" },
  });

  await createProvider(runner).createLabel(label);

  assert.equal(runner.calls.length, 1);
  assertGhContext(runner.calls[0]!);
  assert.deepEqual(runner.calls[0]!.args.slice(0, 3), [
    "label",
    "create",
    label.name,
  ]);
  assert.equal(flagValue(runner.calls[0]!.args, "--color"), "2ea043");
  assert.equal(
    flagValue(runner.calls[0]!.args, "--description"),
    label.description,
  );
});

test("GitHubGhHostProvider applies label additions and removals", async () => {
  const runner = scriptedRunner({
    "gh issue edit 12 --add-label agent-ready,bug --remove-label needs-info": {
      code: 0,
      stdout: "",
      stderr: "",
    },
  });

  await createProvider(runner).applyLabels({
    issueNumber: 12,
    oldLabels: ["needs-info"],
    newLabels: ["agent-ready", "bug"],
    addLabels: ["agent-ready", "bug"],
    removeLabels: ["needs-info"],
  });

  assert.deepEqual(commandLines(runner), [
    "gh issue edit 12 --add-label agent-ready,bug --remove-label needs-info",
  ]);
});

test("GitHubGhHostProvider does not call gh when no label changes are needed", async () => {
  const runner = scriptedRunner({});

  await createProvider(runner).applyLabels({
    issueNumber: 12,
    oldLabels: ["bug"],
    newLabels: ["bug"],
    addLabels: [],
    removeLabels: [],
  });

  assert.deepEqual(runner.calls, []);
});

test("GitHubGhHostProvider comments on issues", async () => {
  const body = "Automated triage needs more information.";
  const runner = scriptedRunner({
    "gh issue comment 9 --body Automated triage needs more information.": {
      code: 0,
      stdout: "",
      stderr: "",
    },
  });

  await createProvider(runner).commentIssue(9, body);

  assert.deepEqual(commandLines(runner), [
    "gh issue comment 9 --body Automated triage needs more information.",
  ]);
  assert.equal(flagValue(runner.calls[0]!.args, "--body"), body);
});

test("GitHubGhHostProvider command failures include gh and operation context", async () => {
  const issueRunner = scriptedRunner({
    "gh issue view 3 --json number,title,body,state,labels,author,updatedAt,url,comments":
      { code: 1, stdout: "", stderr: "not found" },
  });
  await assert.rejects(
    () => createProvider(issueRunner).viewIssue(3),
    /gh issue view failed for #3: not found/,
  );

  const labelRunner = scriptedRunner({
    "gh label create agent-ready --color 2ea043 --description Ready": {
      code: 1,
      stdout: "",
      stderr: "already exists",
    },
  });
  await assert.rejects(
    () =>
      createProvider(labelRunner).createLabel({
        name: "agent-ready",
        color: "#2ea043",
        description: "Ready",
      }),
    /gh label create failed for agent-ready: already exists/,
  );
});

test("GitHubGhHostProvider emits shell-safe missing-label remediation", () => {
  const provider = createProvider(
    scriptedRunner({ "gh --version": { code: 0, stdout: "", stderr: "" } }),
  );

  assert.equal(
    provider.missingLabelRemediation({
      name: "agent ready; echo 'owned'",
      color: "#2ea043",
      description: "Ready for $(implementation) & review",
    }),
    "  gh label create 'agent ready; echo '\"'\"'owned'\"'\"'' --color 2ea043 --description 'Ready for $(implementation) & review'",
  );
});
