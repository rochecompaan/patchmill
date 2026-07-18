import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import {
  doctorPiResourceProfiles,
  profileContextArgs,
  profileExtensionArgs,
  profileSkillArgs,
  runOnceImplementationPiProfile,
  runOncePlanningPiProfile,
  triagePiProfile,
} from "./resource-profiles.ts";
import type { PatchmillSkillsConfig } from "../workflow/skills.ts";

async function withRepo<T>(fn: (repoRoot: string) => Promise<T>): Promise<T> {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-profile-"));
  try {
    return await fn(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

const skills: PatchmillSkillsConfig = {
  triage: "./skills/triage",
  planning: "./skills/planning",
  implementation: "./skills/implementation",
  developmentEnvironment: "./skills/development-environment",
  toolchain: "./skills/toolchain",
  review: "./skills/review",
  visualEvidence: "./skills/visual-evidence",
  landing: "./skills/landing",
};

test("run-once planning profile includes context and Patchmill run-once extensions", async () => {
  await withRepo(async (repoRoot) => {
    const profile = runOncePlanningPiProfile(skills, repoRoot);

    assert.equal(profile.id, "run-once-planning");
    assert.equal(profile.noContextFiles, false);
    assert.equal(profile.noPromptTemplates, false);
    assert.equal(profile.additionalExtensionPaths.length, 2);
    assert.equal(
      basename(profile.additionalExtensionPaths[0] ?? ""),
      "pi-subagents",
    );
    assert.equal(
      profile.additionalExtensionPaths[1]
        ?.replaceAll("\\", "/")
        .endsWith("/extensions/todos.ts"),
      true,
    );
    assert.deepEqual(profile.additionalSkillPaths, [
      join(repoRoot, "skills", "planning", "SKILL.md"),
    ]);
  });
});

test("run-once implementation profile includes every implementation-stage skill slot", async () => {
  await withRepo(async (repoRoot) => {
    assert.deepEqual(
      runOnceImplementationPiProfile(skills, repoRoot).additionalSkillPaths,
      [
        join(repoRoot, "skills", "toolchain", "SKILL.md"),
        join(repoRoot, "skills", "implementation", "SKILL.md"),
        join(repoRoot, "skills", "review", "SKILL.md"),
        join(repoRoot, "skills", "visual-evidence", "SKILL.md"),
        join(repoRoot, "skills", "landing", "SKILL.md"),
      ],
    );
  });
});

test("triage profile mirrors triage agents", async () => {
  await withRepo(async (repoRoot) => {
    const profile = triagePiProfile(skills, repoRoot);

    assert.equal(profile.id, "triage");
    assert.equal(profile.noContextFiles, true);
    assert.deepEqual(profile.additionalExtensionPaths, []);
    assert.deepEqual(profileContextArgs(profile), ["--no-context-files"]);
    assert.deepEqual(profileSkillArgs(profile), [
      "--skill",
      join(repoRoot, "skills", "triage", "SKILL.md"),
    ]);
  });
});

test("profile argument helpers render extension and skill flags", async () => {
  await withRepo(async (repoRoot) => {
    const profile = runOncePlanningPiProfile(skills, repoRoot);

    assert.deepEqual(profileExtensionArgs(profile), [
      "-e",
      profile.additionalExtensionPaths[0],
      "-e",
      profile.additionalExtensionPaths[1],
    ]);
    assert.deepEqual(profileSkillArgs(profile), [
      "--skill",
      join(repoRoot, "skills", "planning", "SKILL.md"),
    ]);
  });
});

test("doctorPiResourceProfiles returns every reported profile in stable order", async () => {
  await withRepo(async (repoRoot) => {
    assert.deepEqual(
      doctorPiResourceProfiles(skills, repoRoot).map((profile) => profile.id),
      [
        "run-once-planning",
        "run-once-development-environment",
        "run-once-implementation",
        "triage",
      ],
    );
  });
});
