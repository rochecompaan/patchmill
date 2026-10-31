import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { RepositorySetupHost } from "../../../host/types.ts";
import type { CommandRunner } from "../../../process/command.ts";
import { main as cliMain } from "../../main.ts";
import { main } from "./main.ts";

async function harness(
  t: TestContext,
  options: { exists?: boolean; fail?: string } = {},
) {
  const parent = await mkdtemp(join(tmpdir(), "setup-test-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const events: string[] = [];
  const errors: string[] = [];
  let exists = options.exists ?? false;
  const host: RepositorySetupHost = {
    displayName: "Fake",
    checkCli: async () => ({ ok: true, message: "ready" }),
    getRepository: async () =>
      exists
        ? { publicUrl: "https://host/o/r", gitRemoteUrl: "git@host:o/r.git" }
        : undefined,
    createPublicRepo: async () => {
      events.push("create");
      if (options.fail === "create") throw new Error("create failed");
      exists = true;
    },
    deleteRepo: async () => {
      events.push("delete");
      exists = false;
    },
    cloneCommand: () => "clone o/r",
    listLabels: async () => ["bug"],
    createLabel: async (_, label) => {
      events.push(`label:${label.name}`);
    },
    createIssue: async (_, issue) => {
      events.push(`issue:${issue.title}`);
      if (options.fail === "issue") throw new Error("issue failed");
    },
  };
  const runner: CommandRunner = async (command, args, runOptions) => {
    assert.equal(command, "git");
    events.push(args.join(" "));
    if (args[0] === "add")
      assert.match(
        await readFile(join(runOptions!.cwd!, "README.md"), "utf8"),
        /.+/,
      );
    return {
      code: options.fail === args[0] ? 1 : 0,
      stdout: "",
      stderr: "git failed",
    };
  };
  const run = (
    args = [
      "--provider",
      "forgejo-tea",
      "--repo",
      "o/r",
      "--login",
      "selected",
    ],
  ) =>
    main(args, {
      runner,
      tempParent: parent,
      output: { stdout: () => {}, stderr: (line: string) => errors.push(line) },
      createProvider: (provider, login, actualRunner, repoRoot) => {
        assert.equal(provider, "forgejo-tea");
        assert.equal(login, "selected");
        assert.equal(actualRunner, runner);
        assert.ok(repoRoot.startsWith(parent));
        return host;
      },
    });
  return { run, events, errors, parent };
}

test("reset deletes then creates, pushes fixture main and seeds all issues and missing labels", async (t) => {
  const h = await harness(t, { exists: true });
  assert.equal(
    await h.run([
      "--provider",
      "forgejo-tea",
      "--repo",
      "o/r",
      "--login",
      "selected",
      "--reset",
    ]),
    0,
  );
  assert.deepEqual(h.events.slice(0, 2), ["delete", "create"]);
  assert.ok(h.events.includes("init --initial-branch=main"));
  assert.ok(h.events.includes("push --set-upstream origin main"));
  assert.ok(h.events.includes("remote add origin git@host:o/r.git"));
  assert.ok(
    h.events.some((event) => event.includes("commit -m Seed demo repository")),
  );
  assert.equal(h.events.filter((e) => e.startsWith("issue:")).length, 12);
  assert.deepEqual(
    h.events.filter((e) => e.startsWith("label:")),
    ["label:feature", "label:docs", "label:polish"],
  );
  assert.deepEqual(await readdir(h.parent), []);
});
test("existing repository is refused without reset and never deleted", async (t) => {
  const h = await harness(t, { exists: true });
  assert.equal(await h.run(), 1);
  assert.deepEqual(h.events, []);
  assert.match(h.errors.join(" "), /reset/i);
  assert.deepEqual(await readdir(h.parent), []);
});
for (const fail of ["create", "push", "issue"]) {
  test(`failure at ${fail} rolls back only a repository created by this invocation`, async (t) => {
    const h = await harness(t, { fail });
    assert.equal(await h.run(), 1);
    assert.equal(
      h.events.filter((e) => e === "delete").length,
      fail === "create" ? 0 : 1,
    );
    assert.deepEqual(await readdir(h.parent), []);
  });
}
test("help and invalid arguments return without provider construction", async () => {
  const errors: string[] = [];
  const options = {
    output: { stdout: () => {}, stderr: (s: string) => errors.push(s) },
    createProvider: () => {
      throw new Error("must not construct");
    },
  };
  assert.equal(await main(["--help"], options), 0);
  assert.equal(await main(["--provider", "github-gh"], options), 1);
  assert.match(errors.join(" "), /--repo/);
  assert.equal(await main(["--unknown"], options), 1);
});
test("CLI registers setup-test-repo", async () => {
  assert.equal(await cliMain(["setup-test-repo", "--help"]), 0);
});

test("default construction uses the selected host and reports unavailable CLI without mutation", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "setup-default-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const errors: string[] = [];
  const calls: string[][] = [];
  assert.equal(
    await main(["--provider", "forgejo-tea", "--repo", "o/r"], {
      tempParent: parent,
      output: { stdout: () => {}, stderr: (line) => errors.push(line) },
      runner: async (command, args) => {
        calls.push([command, ...args]);
        return { code: -1, stdout: "", stderr: "tea not installed" };
      },
    }),
    1,
  );
  assert.deepEqual(calls, [["tea", "--help"]]);
  assert.match(errors.join(" "), /tea not installed/);
  assert.deepEqual(await readdir(parent), []);
});
