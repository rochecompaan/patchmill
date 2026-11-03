import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "../config/config.ts";
import { provisionAgentDir } from "../cli/commands/init/agent-dir.ts";
import { consoleSkillPaths } from "./skills.ts";

test("console discovers the whole configured pack and provisions worker skill injection", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "console-skills-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ["planning", "implementation", "review"]) {
    await mkdir(join(root, "pack", name), { recursive: true });
    await writeFile(
      join(root, "pack", name, "SKILL.md"),
      `---\nname: ${name}\ndescription: Test ${name}\n---\nUse ${name}.\n`,
    );
  }
  const config = {
    ...DEFAULT_CONFIG,
    skills: {
      ...DEFAULT_CONFIG.skills,
      planning: "pack/planning",
      implementation: "pack/implementation",
    },
  };
  const paths = consoleSkillPaths(config, root);
  assert.deepEqual(paths, [join(root, "pack")]);
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: join(root, "agent"),
    noExtensions: true,
    noSkills: true,
    additionalSkillPaths: paths,
  });
  await loader.reload();
  assert.deepEqual(
    loader
      .getSkills()
      .skills.map((skill) => skill.name)
      .sort(),
    ["implementation", "planning", "review"],
  );
  await provisionAgentDir(root, "agent", paths);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  });
  const agents = await import(
    new URL(
      "../../node_modules/pi-subagents/src/agents/agents.js",
      import.meta.url,
    ).href
  );
  const skills = await import(
    new URL(
      "../../node_modules/pi-subagents/src/agents/skills.js",
      import.meta.url,
    ).href
  );
  const agent = agents
    .discoverAgents(root, "both", undefined, { globalNpmRoot: "/nonexistent" })
    .agents.find(
      (a: { name: string }) => a.name === "patchmill-implementation",
    );
  assert.ok(
    agent,
    await readFile(
      join(root, "agent/agents/patchmill-implementation.md"),
      "utf8",
    ),
  );
  const resolved = skills.resolveSkills(
    agent.skills,
    root,
    agent.skillPath,
    join(root, "agent/agents"),
  );
  assert.deepEqual(resolved.missing, []);
  assert.deepEqual(
    resolved.resolved.map((s: { name: string }) => s.name).sort(),
    ["implementation", "planning", "review"],
  );
});
