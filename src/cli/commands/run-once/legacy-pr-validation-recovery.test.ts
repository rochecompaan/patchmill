import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createLegacyPrScenario } from "../../../../test-support/run-once/legacy-pr-scenario.ts";
import { promptPath } from "../../../../test-support/run-once/mock-runner.ts";
import { runOneIssue } from "./pipeline.ts";

async function removeValidation(
  scenario: Awaited<ReturnType<typeof createLegacyPrScenario>>,
) {
  const state = JSON.parse(await scenario.raw());
  delete state.validation;
  await writeFile(
    join(scenario.config.runStateDir, "issue-226.json"),
    JSON.stringify(state),
  );
}

test("saved open legacy PR resumes missing validation against the same PR repeatedly", async () => {
  const scenario = await createLegacyPrScenario();
  const prompts: string[] = [];
  const saved = (await scenario.state())!;
  const runner = {
    ...scenario.runner,
    async run(...args: Parameters<typeof scenario.runner.run>) {
      if (args[0] === process.execPath) {
        prompts.push(await readFile(promptPath(args[1]), "utf8"));
        return {
          code: 0,
          stdout: JSON.stringify({
            status: "pr-created",
            prUrl: saved.prUrl,
            branch: scenario.branch,
            commits: saved.commits,
            validation: [
              "checks and independent review rerun against existing PR",
            ],
          }),
          stderr: "",
        };
      }
      return scenario.runner.run(...args);
    },
  };
  try {
    await scenario.git("fetch", "origin");
    for (let attempt = 0; attempt < 2; attempt++) {
      await removeValidation(scenario);
      const result = await runOneIssue(runner, {
        ...scenario.config,
        skills: { ...scenario.config.skills, developmentEnvironment: "" },
      });
      assert.equal(result.status, "pr-created", JSON.stringify(result));
      if (result.status !== "pr-created")
        assert.fail("validation did not resume");
      assert.equal(result.prUrl, saved.prUrl);
      assert.equal(prompts.length, attempt + 1);
      assert.ok(prompts.at(-1)!.includes(saved.prUrl!));
      const state = (await scenario.state())!;
      assert.equal(state.implementationPr?.url, saved.prUrl);
      assert.deepEqual(state.validation, [
        "checks and independent review rerun against existing PR",
      ]);
      assert.ok(scenario.selected.labels.includes("in-progress"));
    }
    assert.equal(
      (await runOneIssue(runner, scenario.config)).status,
      "pr-created",
    );
    assert.equal(
      prompts.length,
      2,
      "complete validation must not reenter agents",
    );
  } finally {
    await scenario.cleanup();
  }
});

test("validation recovery rejects replacement PR results without replacing the receipt", async () => {
  const scenario = await createLegacyPrScenario();
  const saved = (await scenario.state())!;
  let agents = 0;
  const runner = {
    ...scenario.runner,
    async run(...args: Parameters<typeof scenario.runner.run>) {
      if (args[0] === process.execPath) {
        agents++;
        return {
          code: 0,
          stdout: JSON.stringify({
            status: "pr-created",
            prUrl: "https://github.test/acme/repo/pull/18",
            branch: scenario.branch,
            commits: saved.commits,
            validation: ["replacement PR"],
          }),
          stderr: "",
        };
      }
      return scenario.runner.run(...args);
    },
  };
  try {
    await scenario.git("fetch", "origin");
    await removeValidation(scenario);
    const result = await runOneIssue(runner, {
      ...scenario.config,
      skills: { ...scenario.config.skills, developmentEnvironment: "" },
    });
    assert.equal(result.status, "blocked");
    assert.equal(agents, 1);
    assert.equal((await scenario.state())?.implementationPr?.url, saved.prUrl);
    assert.equal((await scenario.state())?.validation, undefined);
  } finally {
    await scenario.cleanup();
  }
});

test("missing validation cannot recreate a removed published workspace", async () => {
  const scenario = await createLegacyPrScenario({ removedWorkspace: true });
  try {
    await removeValidation(scenario);
    const result = await scenario.run();
    assert.equal(result.status, "blocked");
    await assert.rejects(
      readFile(join(scenario.workspace, "docs/plans/issue-226-legacy.md")),
      { code: "ENOENT" },
    );
    assert.equal(
      (await scenario.state())?.implementationPr?.url,
      "https://github.test/acme/repo/pull/17",
    );
  } finally {
    await scenario.cleanup();
  }
});
