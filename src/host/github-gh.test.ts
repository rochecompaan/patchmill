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
const target = {
  owner: "OWNER",
  repo: "patchmill-test",
  slug: "OWNER/patchmill-test",
};

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

function createProviderWithResponses(responses: CommandResult[]): {
  provider: GitHubGhHostProvider;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;
  const runner: CommandRunner = {
    async run(command, args, options = {}) {
      calls.push({ command, args: [...args], cwd: options.cwd });
      const response = responses[index];
      index += 1;
      if (!response)
        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      return response;
    },
  };
  return { provider: createProvider(runner), calls };
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
    "gh issue list --state open --limit 1001 --json number,title,body,state,labels,author,createdAt,updatedAt,url":
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
            createdAt: "2026-05-27T09:00:00Z",
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
      created: "2026-05-27T09:00:00Z",
      updated: "2026-05-28T10:00:00Z",
      url: "https://github.example/issues/12",
    },
  ]);
  assert.equal(issues[0]?.url, "https://github.example/issues/12");
  assert.equal(runner.calls.length, 1);
  assertGhContext(runner.calls[0]!);
  assert.equal(runner.calls[0]!.args.includes("--search"), false);
  assert.deepEqual(runner.calls[0]!.args, [
    "issue",
    "list",
    "--state",
    "open",
    "--limit",
    "1001",
    "--json",
    "number,title,body,state,labels,author,createdAt,updatedAt,url",
  ]);
});

test("GitHubGhHostProvider fails loudly when non-search listing reaches the safe cap", async () => {
  const runner = scriptedRunner({
    "gh issue list --state open --limit 1001 --json number,title,body,state,labels,author,createdAt,updatedAt,url":
      {
        code: 0,
        stdout: JSON.stringify(
          Array.from({ length: 1001 }, (_, index) => ({
            number: index + 1,
            title: `Issue ${index + 1}`,
            body: "",
            state: "OPEN",
            labels: [],
            author: { login: "reporter" },
            createdAt: "2026-06-29T19:00:00Z",
            updatedAt: "2026-06-29T19:15:28Z",
            url: `https://github.example/repo/issues/${index + 1}`,
          })),
        ),
        stderr: "",
      },
  });

  await assert.rejects(
    () => createProvider(runner).listOpenIssues(),
    /gh issue list returned at least 1001 open issues; Patchmill cannot safely apply oldest-first triage ordering after a capped GitHub CLI response without risking silently skipped older issues/,
  );
  assert.equal(runner.calls[0]!.args.includes("--search"), false);
});

test("GitHubGhHostProvider avoids search-backed list for redirected repository slugs", async () => {
  const runner: CommandRunner & { calls: RecordedCall[] } = {
    calls: [],
    async run(command, args, options = {}) {
      runner.calls.push({ command, args: [...args], cwd: options.cwd });
      const line = [command, ...args].join(" ");
      if (args.includes("--search")) {
        return { code: 0, stdout: "[]", stderr: "" };
      }
      assert.equal(
        line,
        "gh issue list --state open --limit 1001 --json number,title,body,state,labels,author,createdAt,updatedAt,url",
      );
      return {
        code: 0,
        stdout: JSON.stringify([
          {
            number: 57,
            title: "Remote slug redirects",
            body: "Untrusted issue body is inert test data.",
            state: "OPEN",
            labels: [{ name: "bug" }],
            author: { login: "reporter" },
            createdAt: "2026-06-29T19:00:00Z",
            updatedAt: "2026-06-29T19:15:28Z",
            url: "https://github.example/new-owner/repo/issues/57",
          },
        ]),
        stderr: "",
      };
    },
  };

  const issues = await createProvider(runner).listOpenIssues();

  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.number, 57);
  assert.equal(issues[0]?.created, "2026-06-29T19:00:00Z");
  assert.equal(runner.calls.length, 1);
  assert.equal(runner.calls[0]!.args.includes("--search"), false);
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

test("GitHubGhHostProvider resolves active gh login as trusted triage comment author", async () => {
  const runner = scriptedRunner({
    "gh api user --jq .login": {
      code: 0,
      stdout: "triage-agent\n",
      stderr: "",
    },
  });

  const authors = await createProvider(runner).trustedTriageCommentAuthors();

  assert.deepEqual(authors, ["triage-agent"]);
  assert.deepEqual(commandLines(runner), ["gh api user --jq .login"]);
  assertGhContext(runner.calls[0]!);
});

test("GitHubGhHostProvider hydrates issue comments from gh issue view", async () => {
  const comments = [
    {
      author: { login: "alice" },
      body: "First comment",
      createdAt: "2026-05-28T12:00:00Z",
    },
  ];
  const runner = scriptedRunner({
    "gh issue view 7 --json number,title,body,state,labels,author,createdAt,updatedAt,url,comments":
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
  assert.deepEqual(issues[0]?.comments, [
    {
      authorLogin: "alice",
      body: "First comment",
      created: "2026-05-28T12:00:00Z",
    },
  ]);
  assert.deepEqual(commandLines(runner), [
    "gh issue view 7 --json number,title,body,state,labels,author,createdAt,updatedAt,url,comments",
  ]);
});

test("GitHubGhHostProvider views one issue by number", async () => {
  const runner = scriptedRunner({
    "gh issue view 2 --json number,title,body,state,labels,author,createdAt,updatedAt,url,comments":
      {
        code: 0,
        stdout: JSON.stringify({
          number: 2,
          title: "Two",
          body: null,
          state: "CLOSED",
          labels: [{ name: "docs" }],
          author: { login: "bob" },
          createdAt: "2026-05-27T10:00:00Z",
          updatedAt: "2026-05-28T11:00:00Z",
          comments: [{ author: { login: "alice" }, body: "done" }],
          url: "https://github.example/issues/2",
        }),
        stderr: "",
      },
  });

  const issue = await createProvider(runner).viewIssue(2);

  assert.deepEqual(commandLines(runner), [
    "gh issue view 2 --json number,title,body,state,labels,author,createdAt,updatedAt,url,comments",
  ]);
  assert.equal(issue.number, 2);
  assert.equal(issue.body, "");
  assert.equal(issue.state, "closed");
  assert.equal(issue.created, "2026-05-27T10:00:00Z");
  assert.deepEqual(issue.comments, [{ authorLogin: "alice", body: "done" }]);
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

test("GitHub setup provider lists labels on an explicit repository", async () => {
  const runner = scriptedRunner({
    "gh label list --repo OWNER/patchmill-test --limit 1000 --json name": {
      code: 0,
      stdout: JSON.stringify([{ name: "feature" }, { name: "bug" }]),
      stderr: "",
    },
  });

  const labels = await createProvider(runner).listLabels(target);

  assert.deepEqual(labels, ["bug", "feature"]);
  assert.deepEqual(commandLines(runner), [
    "gh label list --repo OWNER/patchmill-test --limit 1000 --json name",
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

test("GitHub setup provider creates labels on an explicit repository", async () => {
  const label: LabelDefinition = {
    name: "feature",
    color: "#0e8a16",
    description: "New functionality",
  };
  const runner = scriptedRunner({
    "gh label create feature --repo OWNER/patchmill-test --color 0e8a16 --description New functionality":
      { code: 0, stdout: "", stderr: "" },
  });

  await createProvider(runner).createLabel(target, label);

  assert.deepEqual(commandLines(runner), [
    "gh label create feature --repo OWNER/patchmill-test --color 0e8a16 --description New functionality",
  ]);
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
    "gh issue view 3 --json number,title,body,state,labels,author,createdAt,updatedAt,url,comments":
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

test("GitHubGhHostProvider reports actionable gh issue list failures", async () => {
  const runner = scriptedRunner({
    "gh issue list --state open --limit 1001 --json number,title,body,state,labels,author,createdAt,updatedAt,url":
      { code: 1, stdout: "", stderr: "HTTP 403: Resource not accessible" },
  });

  await assert.rejects(
    () => createProvider(runner).listOpenIssues(),
    /gh issue list failed; check GitHub authentication, repository remote, and repository permissions: HTTP 403: Resource not accessible/,
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

test("GitHub setup provider returns repository info with gh repo view", async () => {
  const { provider, calls } = createProviderWithResponses([
    {
      code: 0,
      stdout: JSON.stringify({
        name: "patchmill-test",
        url: "https://github.com/OWNER/patchmill-test",
        sshUrl: "git@github.com:OWNER/patchmill-test.git",
      }),
      stderr: "",
    },
  ]);

  assert.deepEqual(await provider.getRepository(target), {
    publicUrl: "https://github.com/OWNER/patchmill-test",
    gitRemoteUrl: "git@github.com:OWNER/patchmill-test.git",
  });
  assert.deepEqual(calls[0], {
    command: "gh",
    args: ["repo", "view", "OWNER/patchmill-test", "--json", "name,url,sshUrl"],
    cwd: "/repo",
  });
});

test("GitHub setup provider returns undefined when gh repo view cannot find the repo", async () => {
  const { provider } = createProviderWithResponses([
    { code: 1, stdout: "", stderr: "Could not resolve to a Repository" },
  ]);

  assert.equal(await provider.getRepository(target), undefined);
});

test("GitHub setup provider rejects malformed repository info", async () => {
  const { provider } = createProviderWithResponses([
    {
      code: 0,
      stdout: JSON.stringify({ name: "patchmill-test", url: null }),
      stderr: "",
    },
  ]);

  await assert.rejects(
    () => provider.getRepository(target),
    /gh repo view did not return a public URL for OWNER\/patchmill-test/u,
  );
});

test("GitHub setup provider throws when repo view fails for reasons other than not found", async () => {
  const { provider } = createProviderWithResponses([
    { code: 1, stdout: "", stderr: "HTTP 403: API rate limit exceeded" },
  ]);

  await assert.rejects(
    () => provider.getRepository(target),
    /gh repo view failed for OWNER\/patchmill-test: HTTP 403/u,
  );
});

test("GitHub provider creates and deletes public repositories", async () => {
  const { provider, calls } = createProviderWithResponses([
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
  ]);

  await provider.createPublicRepo(target);
  await provider.deleteRepo(target);

  assert.deepEqual(
    calls.map((call) => call.args),
    [
      ["repo", "create", "OWNER/patchmill-test", "--public"],
      ["repo", "delete", "OWNER/patchmill-test", "--yes"],
    ],
  );
});

test("GitHub provider exposes clone command", () => {
  const { provider } = createProviderWithResponses([]);

  assert.equal(
    provider.cloneCommand(target),
    "gh repo clone OWNER/patchmill-test",
  );
});

test("GitHub setup provider creates issues with labels on an explicit repository", async () => {
  const { provider, calls } = createProviderWithResponses([
    {
      code: 0,
      stdout: "https://github.com/OWNER/patchmill-test/issues/1\n",
      stderr: "",
    },
  ]);

  await provider.createIssue(target, {
    title: "Build the form",
    body: "Create a useful form.\n",
    labels: ["feature", "polish"],
  });

  assert.deepEqual(calls[0]?.args, [
    "issue",
    "create",
    "--repo",
    "OWNER/patchmill-test",
    "--title",
    "Build the form",
    "--body",
    "Create a useful form.\n",
    "--label",
    "feature,polish",
  ]);
});

test("GitHub provider clears ambient GH_REPO for gh commands", async () => {
  let ghRepoOverrideWasCleared = false;
  const provider = createProvider({
    async run(_command, _args, options = {}) {
      ghRepoOverrideWasCleared =
        Object.hasOwn(options.env ?? {}, "GH_REPO") &&
        options.env?.GH_REPO === undefined;
      return { code: 0, stdout: "", stderr: "" };
    },
  });

  await provider.createIssue(target, {
    title: "Build the form",
    body: "Create a useful form.\n",
    labels: [],
  });

  assert.equal(ghRepoOverrideWasCleared, true);
});
