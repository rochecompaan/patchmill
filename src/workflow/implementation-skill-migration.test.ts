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

// Catches readability-dependent migration and separator normalization after resolution.
test("retired managed references normalize separators before and after file removal", async (t) => {
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
      ].flatMap((form) => [form, form.replaceAll("/", "\\")]);
      await mkdir(join(root, path), { recursive: true });
      await writeFile(
        join(root, path, "SKILL.md"),
        "customized old managed skill\n",
      );
      for (const form of forms)
        await t.test(`readable: ${form}`, () => {
          assert.equal(
            retiredManagedImplementationSkill(form, root),
            name,
            form,
          );
        });
      await rm(join(root, path), { recursive: true });
      for (const form of forms)
        await t.test(`missing: ${form}`, () => {
          assert.equal(
            retiredManagedImplementationSkill(form, root),
            name,
            form,
          );
        });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("custom basenames do not trigger migration", () => {
  for (const name of names) {
    for (const path of [
      `skills/${name}`,
      `skills/${name}/SKILL.md`,
      `/other/.patchmill/skills/${name}`,
      `/other/.patchmill/skills/${name}/SKILL.md`,
      `.patchmill/skills/../../custom/${name}`,
      `${name}`,
      `.patchmill/skills/${name}/custom.md`,
      `.patchmill/skills/${name}-custom`,
      `superpowers:${name}`,
    ].flatMap((form) => [form, form.replaceAll("/", "\\")])) {
      assert.equal(
        retiredManagedImplementationSkill(path, "/repo"),
        undefined,
        path,
      );
    }
  }
});
