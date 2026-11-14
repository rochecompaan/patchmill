import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "../config/config.ts";
import { installSkills } from "../cli/commands/init/skill-installer.ts";
import { provisionAgentDir } from "../cli/commands/init/agent-dir.ts";
import { consoleSkillPaths } from "./skills.ts";

test("discovers installed design siblings from configured pack paths", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "console-real-skills-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await installSkills({
    repoRoot: root,
    skillDir: "custom/pack",
    packageRoot: process.cwd(),
  });
  const config = {
    ...DEFAULT_CONFIG,
    skills: {
      ...DEFAULT_CONFIG.skills,
      planning: "custom/pack/patchmill-planning",
      implementation: "custom/pack/patchmill-implementation",
    },
  };
  const paths = consoleSkillPaths(config, root);
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: join(root, "agent"),
    noExtensions: true,
    noSkills: true,
    additionalSkillPaths: paths,
  });
  await loader.reload();
  const loaded = loader.getSkills().skills;
  for (const name of ["domain-modeling", "codebase-design"]) {
    const skill = loaded.find((entry) => entry.name === name);
    assert.ok(skill, `Missing installed skill ${name}`);
    assert.equal(skill.filePath, join(root, "custom/pack", name, "SKILL.md"));
  }
  await provisionAgentDir(root, "agent", paths);
  const worker = await readFile(
    join(root, "agent/agents/patchmill-implementation.md"),
    "utf8",
  );
  const { resolveSkills } = await import(
    new URL(
      "../../node_modules/pi-subagents/src/agents/skills.js",
      import.meta.url,
    ).href
  );
  const declared = worker.match(/^skills: (.+)$/m)![1]!.split(", ");
  const resolved = resolveSkills(
    declared,
    root,
    paths,
    join(root, "agent/agents"),
  );
  assert.deepEqual(resolved.missing, []);
  for (const name of ["domain-modeling", "codebase-design"])
    assert.ok(
      resolved.resolved.some((skill: { name: string }) => skill.name === name),
    );
});

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
