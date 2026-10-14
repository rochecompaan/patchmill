import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createLegacyPrScenario } from "../../../../test-support/run-once/legacy-pr-scenario.ts";
import { promptPath } from "../../../../test-support/run-once/mock-runner.ts";
import { runOneIssue } from "./pipeline.ts";
import { captureLegacyImplementationPr } from "./legacy-pr-evidence.ts";

test("a head change after legacy checks cannot be captured as verified publication", async () => {
  const scenario = await createLegacyPrScenario();
  const saved = (await scenario.state())!;
  const runner = {
    ...scenario.runner,
    async run(...args: Parameters<typeof scenario.runner.run>) {
      const result = await scenario.runner.run(...args);
      if (args[0] === "gh" && args[1][0] === "pr" && args[1][1] === "view")
        return {
          ...result,
          stdout: JSON.stringify({
            ...JSON.parse(result.stdout),
            headRefOid: "c".repeat(40),
          }),
        };
      return result;
    },
  };
  try {
    await assert.rejects(
      captureLegacyImplementationPr({
        runner,
        config: scenario.config,
        state: saved,
      }),
      /head changed after verification/i,
    );
    assert.equal(
      (await scenario.state())?.implementationPr?.publication.headOid,
      saved.implementationPr?.publication.headOid,
    );
    assert.deepEqual(scenario.effects, []);
  } finally {
    await scenario.cleanup();
  }
});

for (const progress of ["published", "local", "merged-main"])
  test(`an advanced ${progress} legacy head reruns checks on the same workspace and PR`, async () => {
    const pushed = progress !== "local";
    const scenario = await createLegacyPrScenario();
    const saved = (await scenario.state())!;
    let agents = 0;
    try {
      await writeFile(
        join(scenario.workspace, "implementation.txt"),
        "more work\n",
      );
      await scenario.git("-C", scenario.workspace, "add", "implementation.txt");
      await scenario.git(
        "-C",
        scenario.workspace,
        "commit",
        "-m",
        "continue implementation",
      );
      if (progress === "merged-main") {
        await writeFile(join(scenario.root, "main.txt"), "upstream work\n");
        await scenario.git("add", "main.txt");
        await scenario.git("commit", "-m", "advance main");
        await scenario.git("push", "origin", "main");
        await scenario.git("-C", scenario.workspace, "fetch", "origin");
        await scenario.git(
          "-C",
          scenario.workspace,
          "merge",
          "--no-edit",
          "origin/main",
        );
      }
      const head = await scenario.git(
        "-C",
        scenario.workspace,
        "rev-parse",
        "HEAD",
      );
      let publishedHead = pushed
        ? head
        : saved.implementationPr!.publication.headOid;
      if (pushed)
        await scenario.git(
          "-C",
          scenario.workspace,
          "push",
          "origin",
          `HEAD:${scenario.branch}`,
        );
      await scenario.git("fetch", "origin");
      const runner = {
        ...scenario.runner,
        async run(...args: Parameters<typeof scenario.runner.run>) {
          if (args[0] === process.execPath) {
            agents++;
            const prompt = await readFile(promptPath(args[1]), "utf8");
            assert.ok(prompt.includes(saved.prUrl!));
            const state = (await scenario.state())!;
            assert.equal(
              state.validation,
              undefined,
              "old checks must not be reused",
            );
            assert.notEqual(state.checkpoints?.implementationCompleted, true);
            if (!pushed)
              await scenario.git(
                "-C",
                scenario.workspace,
                "push",
                "origin",
                `HEAD:${scenario.branch}`,
              );
            publishedHead = head;
            return {
              code: 0,
              stdout: JSON.stringify({
                status: "pr-created",
                prUrl: saved.prUrl,
                branch: scenario.branch,
                commits: [head],
                validation: ["checks rerun on advanced implementation"],
              }),
              stderr: "",
            };
          }
          const result = await scenario.runner.run(...args);
          if (args[0] === "gh" && args[1][0] === "pr" && args[1][1] === "view")
            return {
              ...result,
              stdout: JSON.stringify({
                ...JSON.parse(result.stdout),
                headRefOid: publishedHead,
              }),
            };
          return result;
        },
      };
      const result = await runOneIssue(runner, {
        ...scenario.config,
        skills: { ...scenario.config.skills, developmentEnvironment: "" },
      });
      assert.equal(result.status, "pr-created", JSON.stringify(result));
      assert.equal(agents, 1);
      const current = (await scenario.state())!;
      assert.equal(current.implementationPr?.url, saved.prUrl);
      assert.equal(current.implementationPr?.publication.headOid, head);
      assert.deepEqual(current.validation, [
        "checks rerun on advanced implementation",
      ]);
      assert.ok(scenario.selected.labels.includes("in-progress"));
    } finally {
      await scenario.cleanup();
    }
  });
