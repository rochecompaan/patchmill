import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertLockfilesMatchSuperpowersTarget,
  getCurrentSuperpowersVersion,
  tagForVersion,
  tarballUrlForVersion,
} from "./superpowers-upgrade-lib.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

test("repository Superpowers references and managed skills agree with the canonical pin", async (t) => {
  const metadataPath = join(
    rootDir,
    ".patchmill/skills/patchmill-skill-pack.json",
  );
  try {
    await access(metadataPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip(
        "project-local managed skills are not included in packaged source",
      );
      return;
    }
    throw error;
  }
  const [packageJson, packageLock, shrinkwrap, notices, metadata] =
    await Promise.all(
      [
        "package.json",
        "package-lock.json",
        "npm-shrinkwrap.json",
        "THIRD_PARTY_NOTICES.md",
        ".patchmill/skills/patchmill-skill-pack.json",
      ].map((path) =>
        path.endsWith(".json")
          ? readJson(join(rootDir, path))
          : readFile(join(rootDir, path), "utf8"),
      ),
    );
  const version = getCurrentSuperpowersVersion(packageJson);
  const tag = tagForVersion(version);
  const tarballUrl = tarballUrlForVersion(version);
  assertLockfilesMatchSuperpowersTarget({
    packageJson,
    packageLock,
    shrinkwrap,
    targetVersion: version,
  });
  const { PATCHMILL_RECOMMENDED_SKILL_PACK } = await import(
    pathToFileURL(join(rootDir, "src/workflow/skill-pack.ts")).href
  );
  assert.deepEqual(PATCHMILL_RECOMMENDED_SKILL_PACK.source, {
    type: "github-release",
    repository: "obra/superpowers",
    tag,
    tarballUrl,
  });
  assert.deepEqual(
    metadata.pack.source,
    PATCHMILL_RECOMMENDED_SKILL_PACK.source,
  );
  const noticeUrl = `https://github.com/obra/superpowers/tree/${tag}/skills`;
  assert.equal(
    (
      notices.match(
        new RegExp(noticeUrl.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu"),
      ) ?? []
    ).length,
    1,
  );
  const require = createRequire(import.meta.url);
  const superpowersPackage = require("superpowers/package.json");
  const superpowersRoot = dirname(require.resolve("superpowers/package.json"));
  assert.equal(superpowersPackage.version, version);
  for (const skill of PATCHMILL_RECOMMENDED_SKILL_PACK.skills.filter(
    ({ source }) => source === "superpowers",
  ))
    await t.test(`installed upstream skill exists: ${skill.name}`, () =>
      access(join(superpowersRoot, "skills", skill.name, "SKILL.md")),
    );
  for (const file of metadata.files) {
    const content = await readFile(join(rootDir, file.path));
    assert.equal(
      createHash("sha256").update(content).digest("hex"),
      file.sha256,
      `managed file hash: ${file.path}`,
    );
  }
});
