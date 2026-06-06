import assert from "node:assert/strict";
import { test } from "node:test";
import { ForgejoTeaHostProvider } from "./forgejo-tea.ts";
import type {
  LabelChangePlan,
  LabelDefinition,
  IssueSummary,
} from "./types.ts";
import type {
  CommandResult,
  CommandRunner,
} from "../cli/commands/triage/types.ts";

type RecordedCall = {
  command: string;
  args: string[];
  cwd?: string;
};

const repoRoot = "/repo";
const login = "bot";

function createFakeRunner(
  respond: (
    command: string,
    args: string[],
    cwd?: string,
  ) => CommandResult | Promise<CommandResult>,
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

function createProviderWithResponses(responses: CommandResult[]): {
  provider: ForgejoTeaHostProvider;
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
  return {
    provider: new ForgejoTeaHostProvider({
      runner,
      repoRoot,
      login: "triage-agent",
    }),
    calls,
  };
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

test("ForgejoTeaHostProvider reports CLI readiness", async () => {
  const calls: string[] = [];
  const provider = new ForgejoTeaHostProvider({
    repoRoot,
    login: "triage-agent",
    runner: {
      async run(command, args) {
        calls.push([command, ...args].join(" "));
        return { code: 0, stdout: "tea help", stderr: "" };
      },
    },
  });

  const result = await provider.checkCli();

  assert.deepEqual(result, {
    ok: true,
    message: "forgejo via tea as triage-agent",
  });
  assert.deepEqual(calls, ["tea --help"]);
});

test("ForgejoTeaHostProvider reports CLI failures with remediation", async () => {
  const provider = new ForgejoTeaHostProvider({
    repoRoot,
    runner: {
      async run() {
        return { code: 127, stdout: "", stderr: "tea: command not found" };
      },
    },
  });

  const result = await provider.checkCli();

  assert.deepEqual(result, {
    ok: false,
    message: "tea unavailable: tea: command not found",
    remediation: [
      "Install and authenticate tea, then rerun:",
      "  patchmill doctor",
    ],
  });
});

test("ForgejoTeaHostProvider delegates open issue listing to tea", async () => {
  const runner = createFakeRunner((_command, args) => {
    const page = flagValue(args, "--page");
    if (args[0] === "issues" && args[1] === "list" && page === "1") {
      return {
        code: 0,
        stdout: JSON.stringify([
          {
            index: 7,
            title: "Needs docs",
            body: "Update docs",
            state: "open",
            labels: [{ name: "docs" }],
          },
        ]),
        stderr: "",
      };
    }
    if (args[0] === "issues" && args[1] === "list" && page === "2") {
      return { code: 0, stdout: JSON.stringify([]), stderr: "" };
    }
    throw new Error(`Unexpected command: ${args.join(" ")}`);
  });

  const issues = await createProvider(runner).listOpenIssues();

  assert.deepEqual(issues, [
    {
      number: 7,
      title: "Needs docs",
      body: "Update docs",
      state: "open",
      labels: ["docs"],
      author: undefined,
      updated: undefined,
      comments: undefined,
    },
  ]);
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
    if (
      args[0] === "issues" &&
      args[1] === "7" &&
      args.includes("--comments")
    ) {
      return {
        code: 0,
        stdout:
          "## Comments\n\n**@ana** wrote on 2026-05-08 10:30:\n\nFirst comment.\n\n--------\n",
        stderr: "",
      };
    }
    if (
      args[0] === "issues" &&
      args[1] === "8" &&
      args.includes("--comments")
    ) {
      return {
        code: 0,
        stdout:
          "## Comments\n\n**@sam** wrote on 2026-05-08 11:45:\n\nSecond comment.\n\n--------\n",
        stderr: "",
      };
    }
    throw new Error(`Unexpected command: ${args.join(" ")}`);
  });

  const hydrated = await createProvider(runner).hydrateIssueComments(issues);

  assert.strictEqual(hydrated, issues);
  assert.deepEqual(hydrated[0]?.comments, [
    { author: "ana", created: "2026-05-08 10:30", body: "First comment." },
  ]);
  assert.deepEqual(hydrated[1]?.comments, [
    { author: "sam", created: "2026-05-08 11:45", body: "Second comment." },
  ]);
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
      return {
        code: 0,
        stdout: JSON.stringify([{ name: "agent-ready" }, { name: "bug" }]),
        stderr: "",
      };
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

test("ForgejoTeaHostProvider emits shell-safe missing-label remediation", () => {
  const label: LabelDefinition = {
    name: "agent ready; echo 'owned'",
    color: "#2ea043",
    description: "Ready for $(implementation) & review",
  };

  assert.equal(
    createProvider(
      createFakeRunner(() => ({ code: 0, stdout: "", stderr: "" })),
    ).missingLabelRemediation(label),
    "  tea labels create --name 'agent ready; echo '\"'\"'owned'\"'\"'' --color '#2ea043' --description 'Ready for $(implementation) & review'",
  );
});

test("ForgejoTeaHostProvider delegates label creation to tea", async () => {
  const label: LabelDefinition = {
    name: "agent-ready",
    color: "#2ea043",
    description: "Ready for implementation",
  };
  const runner = createFakeRunner((_command, args) => {
    if (args[0] === "labels" && args[1] === "create")
      return { code: 0, stdout: "", stderr: "" };
    throw new Error(`Unexpected command: ${args.join(" ")}`);
  });

  await createProvider(runner).createLabel(label);

  assert.equal(runner.calls.length, 1);
  assertTeaContext(runner.calls[0]!);
  assert.deepEqual(runner.calls[0]!.args.slice(0, 2), ["labels", "create"]);
  assert.equal(flagValue(runner.calls[0]!.args, "--name"), label.name);
  assert.equal(flagValue(runner.calls[0]!.args, "--color"), label.color);
  assert.equal(
    flagValue(runner.calls[0]!.args, "--description"),
    label.description,
  );
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
    if (args[0] === "issues" && args[1] === "edit")
      return { code: 0, stdout: "", stderr: "" };
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
    if (args[0] === "comment" && args[1] === String(issueNumber))
      return { code: 0, stdout: "", stderr: "" };
    throw new Error(`Unexpected command: ${args.join(" ")}`);
  });

  await createProvider(runner).commentIssue(issueNumber, body);

  assert.equal(runner.calls.length, 1);
  assertTeaContext(runner.calls[0]!);
  assert.deepEqual(runner.calls[0]!.args.slice(0, 2), [
    "comment",
    String(issueNumber),
  ]);
  const separatorIndex = runner.calls[0]!.args.indexOf("--");
  assert.ok(separatorIndex >= 0);
  assert.equal(runner.calls[0]!.args[separatorIndex + 1], body);
});

test("Forgejo provider checks repository existence with tea repos search", async () => {
  const { provider, calls } = createProviderWithResponses([
    {
      code: 0,
      stdout: JSON.stringify([
        {
          owner: { login: "OWNER" },
          name: "patchmill-test",
          url: "https://forgejo.example/OWNER/patchmill-test",
          ssh: "git@forgejo.example:OWNER/patchmill-test.git",
        },
      ]),
      stderr: "",
    },
  ]);

  assert.equal(
    await provider.repoExists({
      owner: "OWNER",
      repo: "patchmill-test",
      slug: "OWNER/patchmill-test",
    }),
    true,
  );
  assert.deepEqual(calls[0]?.args, [
    "repos",
    "search",
    "patchmill-test",
    "--owner",
    "OWNER",
    "--fields",
    "owner,name,ssh,url",
    "--limit",
    "50",
    "--output",
    "json",
    "--login",
    "triage-agent",
  ]);
});

test("Forgejo provider creates and deletes public repositories", async () => {
  const { provider, calls } = createProviderWithResponses([
    { code: 0, stdout: "{}", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
  ]);
  const target = {
    owner: "OWNER",
    repo: "patchmill-test",
    slug: "OWNER/patchmill-test",
  };

  await provider.createPublicRepo(target);
  await provider.deleteRepo(target);

  assert.deepEqual(
    calls.map((call) => call.args),
    [
      [
        "repos",
        "create",
        "--name",
        "patchmill-test",
        "--owner",
        "OWNER",
        "--output",
        "json",
        "--login",
        "triage-agent",
      ],
      [
        "repos",
        "delete",
        "--name",
        "patchmill-test",
        "--owner",
        "OWNER",
        "--force",
        "--login",
        "triage-agent",
      ],
    ],
  );
});

test("Forgejo provider reads clone and public URLs from repository info", async () => {
  const { provider } = createProviderWithResponses([
    {
      code: 0,
      stdout: JSON.stringify([
        {
          owner: "OWNER",
          name: "patchmill-test",
          url: "https://forgejo.example/OWNER/patchmill-test",
          ssh: "git@forgejo.example:OWNER/patchmill-test.git",
        },
      ]),
      stderr: "",
    },
    {
      code: 0,
      stdout: JSON.stringify([
        {
          owner: "OWNER",
          name: "patchmill-test",
          url: "https://forgejo.example/OWNER/patchmill-test",
          ssh: "git@forgejo.example:OWNER/patchmill-test.git",
        },
      ]),
      stderr: "",
    },
  ]);
  const target = {
    owner: "OWNER",
    repo: "patchmill-test",
    slug: "OWNER/patchmill-test",
  };

  assert.equal(
    await provider.gitRemoteUrl(target),
    "git@forgejo.example:OWNER/patchmill-test.git",
  );
  assert.equal(
    await provider.publicRepoUrl(target),
    "https://forgejo.example/OWNER/patchmill-test",
  );
  assert.equal(provider.cloneCommand(target), "tea clone OWNER/patchmill-test");
});

test("Forgejo provider creates issues with labels", async () => {
  const { provider, calls } = createProviderWithResponses([
    { code: 0, stdout: "", stderr: "" },
  ]);

  await provider.createIssue({
    title: "Build the form",
    body: "Create a useful form.\n",
    labels: ["feature", "polish"],
  });

  assert.deepEqual(calls[0]?.args, [
    "issues",
    "create",
    "--title",
    "Build the form",
    "--description",
    "Create a useful form.\n",
    "--labels",
    "feature,polish",
    "--repo",
    "/repo",
    "--login",
    "triage-agent",
  ]);
});
