import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { retiredManagedImplementationSkill } from "./implementation-skill-migration.ts";

const names = [
  "subagent-dev-with-validation-and-pr-checks",
  "subagent-dev-with-codex-and-thermo-reviews",
  "single-subagent-dev-with-codex-and-thermo-reviews",
];

// Catches readability-dependent migration and basename-only classification.
test("retired managed references have the same migration before and after file removal", async () => {
  const root = await mkdtemp(join(tmpdir(), "migration-identity-"));
  try {
    for (const name of names) {
      const path = `.patchmill/skills/${name}`;
      const forms = [
        path,
        `${path}/`,
        `${path}/SKILL.md`,
        `./.patchmill/skills/../skills/${name}/SKILL.md/`,
        join(root, path),
        join(root, path, "SKILL.md"),
      ];
      await mkdir(join(root, path), { recursive: true });
      await writeFile(
        join(root, path, "SKILL.md"),
        "customized old managed skill\n",
      );
      for (const form of forms)
        assert.equal(retiredManagedImplementationSkill(form, root), name);
      await rm(join(root, path), { recursive: true });
      for (const form of forms)
        assert.equal(retiredManagedImplementationSkill(form, root), name);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("custom basenames do not trigger migration", () => {
  for (const name of names) {
    for (const path of [
      `skills/${name}`,
      `/other/.patchmill/skills/${name}`,
      `${name}`,
      `.patchmill/skills/${name}/custom.md`,
      `.patchmill/skills/${name}-custom`,
      `superpowers:${name}`,
    ]) {
      assert.equal(
        retiredManagedImplementationSkill(path, "/repo"),
        undefined,
        path,
      );
    }
  }
});
