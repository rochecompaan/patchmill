import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { readWebAsset, resolveWebRoot } from "./assets.ts";
test("public assets resolve from package roots and never escape through paths or symlinks", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "serve-assets-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "web"));
  await mkdir(join(root, "src/web"), { recursive: true });
  await mkdir(join(root, "dist/src/web"), { recursive: true });
  await writeFile(join(root, "package.json"), "{}");
  await writeFile(join(root, "web/index.html"), "<title>sample</title>");
  for (const module of ["src/web/assets.ts", "dist/src/web/assets.js"])
    assert.equal(
      resolveWebRoot(pathToFileURL(join(root, module))),
      join(root, "web"),
    );
  assert.equal(
    (await readWebAsset(join(root, "web"), "/"))?.contentType,
    "text/html; charset=utf-8",
  );
  for (const path of [
    "/../package.json",
    "/%2e%2e/package.json",
    "/%252e%252e/package.json",
    "/..%2fpackage.json",
    "/..%5cpackage.json",
    "/%00",
    "/%zz",
    "/missing",
    "/src/web/api-types.ts",
    "/web/",
    "//index.html",
    "/a/../index.html",
  ])
    assert.equal(await readWebAsset(join(root, "web"), path), null, path);
  await mkdir(join(root, "web-outside"));
  await writeFile(join(root, "web-outside/secret.js"), "private");
  await symlink(join(root, "web-outside/secret.js"), join(root, "web/app.js"));
  assert.equal(await readWebAsset(join(root, "web"), "/app.js"), null);
});
