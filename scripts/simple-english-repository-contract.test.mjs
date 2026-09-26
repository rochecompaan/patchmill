import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  SIMPLE_ENGLISH_REPOSITORY,
  SIMPLE_ENGLISH_TARBALL_URL,
} from "./repack-simple-english.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

function assertLockfilesMatchSimpleEnglishTarget({
  packageLock,
  shrinkwrap,
  targetVersion,
  targetSpec,
}) {
  for (const [label, lockfile] of [
    ["package-lock.json", packageLock],
    ["npm-shrinkwrap.json", shrinkwrap],
  ]) {
    assert.equal(
      lockfile.packages?.[""]?.dependencies?.["simple-english"],
      targetSpec,
      `${label} root dependency spec`,
    );
    const link = lockfile.packages?.["node_modules/simple-english"];
    assert.equal(link?.resolved, "vendor/simple-english", `${label} link`);
    assert.equal(link?.link, true, `${label} link flag`);
    const vendored = lockfile.packages?.["vendor/simple-english"];
    assert.equal(vendored?.version, targetVersion, `${label} version`);
    assert.equal(vendored?.license, "MIT", `${label} license`);
  }
}

test("repository SimpleEnglish references and managed skills agree with the canonical pin", async (t) => {
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

  const spec = packageJson.dependencies?.["simple-english"] ?? "";
  assert.equal(
    spec,
    "file:vendor/simple-english",
    "package.json must pin the vendored SimpleEnglish package",
  );
  const vendoredPackage = await readJson(
    join(rootDir, "vendor/simple-english/package.json"),
  );
  const version = vendoredPackage.version;
  assert.ok(
    version,
    "vendor/simple-english/package.json must record a version",
  );
  const tag = `v${version}`;

  assertLockfilesMatchSimpleEnglishTarget({
    packageLock,
    shrinkwrap,
    targetVersion: version,
    targetSpec: spec,
  });

  const { PATCHMILL_RECOMMENDED_SKILL_PACK } = await import(
    pathToFileURL(join(rootDir, "src/workflow/skill-pack.ts")).href
  );
  const expectedSource = {
    type: "github-release",
    repository: SIMPLE_ENGLISH_REPOSITORY,
    tag,
    tarballUrl: SIMPLE_ENGLISH_TARBALL_URL,
  };
  assert.deepEqual(PATCHMILL_RECOMMENDED_SKILL_PACK.additionalSources, [
    expectedSource,
  ]);
  assert.deepEqual(metadata.pack.additionalSources, [expectedSource]);
  assert.ok(
    PATCHMILL_RECOMMENDED_SKILL_PACK.skills.some(
      (skill) =>
        skill.name === "simple-english" && skill.source === "simple-english",
    ),
    "skill pack must include the simple-english skill",
  );

  const noticeUrl = `https://github.com/${SIMPLE_ENGLISH_REPOSITORY}/tree/${tag}/skills`;
  assert.equal(
    (
      notices.match(
        new RegExp(noticeUrl.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu"),
      ) ?? []
    ).length,
    1,
    `THIRD_PARTY_NOTICES.md must contain exactly one ${noticeUrl}`,
  );

  const require = createRequire(import.meta.url);
  const simpleEnglishRoot = dirname(
    require.resolve("simple-english/package.json"),
  );
  assert.equal(require("simple-english/package.json").version, version);
  for (const requiredFile of [
    "SKILL.md",
    "references/checklist.md",
    "references/use-cases.md",
  ]) {
    await t.test(`installed upstream skill file exists: ${requiredFile}`, () =>
      access(join(simpleEnglishRoot, "skills/simple-english", requiredFile)),
    );
  }
  for (const requiredFile of [
    "SKILL.md",
    "references/checklist.md",
    "references/use-cases.md",
  ]) {
    await t.test(
      `managed project-local skill file exists: ${requiredFile}`,
      () =>
        access(join(rootDir, ".patchmill/skills/simple-english", requiredFile)),
    );
  }
});
