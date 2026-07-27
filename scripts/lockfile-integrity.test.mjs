import assert from "node:assert/strict";
import { test } from "node:test";
import { repairMissingLockfileIntegrities } from "./lockfile-integrity.mjs";

const resolved = "https://registry.example.test/shared-1.0.0.tgz";
const expectedIntegrity =
  "sha512-B8POa95m3GJFaMFp1MsqEvsPvqIJoPCLbH2k06iUbfIjuNSkCqtohW801kLScBVmPs4lTysbJEGKUysB9lnEYw==";

function lockfile(packages) {
  return { packages: { "": {}, ...packages } };
}

test("repairs each missing registry integrity from the resolved tarball once", async () => {
  const packageLock = lockfile({
    "node_modules/shared": { version: "1.0.0", resolved },
    "node_modules/existing": {
      version: "2.0.0",
      resolved: "https://registry.example.test/existing-2.0.0.tgz",
      integrity: "sha512-existing",
    },
    "node_modules/git-package": {
      version: "3.0.0",
      resolved: "git+https://example.test/git-package.git#commit",
    },
  });
  const shrinkwrap = lockfile({
    "node_modules/nested/shared": { version: "1.0.0", resolved },
  });
  let fetchCount = 0;

  await repairMissingLockfileIntegrities(
    [
      { label: "package-lock.json", lockfile: packageLock },
      { label: "npm-shrinkwrap.json", lockfile: shrinkwrap },
    ],
    {
      fetchImpl: async (url) => {
        fetchCount += 1;
        assert.equal(url, resolved);
        return new Response("tarball bytes");
      },
    },
  );

  assert.equal(
    packageLock.packages["node_modules/shared"].integrity,
    expectedIntegrity,
  );
  assert.equal(
    shrinkwrap.packages["node_modules/nested/shared"].integrity,
    expectedIntegrity,
  );
  assert.equal(
    packageLock.packages["node_modules/existing"].integrity,
    "sha512-existing",
  );
  assert.equal(
    packageLock.packages["node_modules/git-package"].integrity,
    undefined,
  );
  assert.equal(fetchCount, 1);
});

test("rejects a missing integrity with an unsupported resolved URL", async () => {
  const packageLock = lockfile({
    "node_modules/local": {
      version: "1.0.0",
      resolved: "file:../local",
    },
  });

  await assert.rejects(
    repairMissingLockfileIntegrities([
      { label: "package-lock.json", lockfile: packageLock },
    ]),
    /package-lock\.json: node_modules\/local@1\.0\.0 is missing integrity and uses unsupported resolved URL file:\.\.\/local/u,
  );
});

test("reports the lockfile entry and status when a tarball fetch fails", async () => {
  const packageLock = lockfile({
    "node_modules/missing": {
      version: "4.0.0",
      resolved: "https://registry.example.test/missing-4.0.0.tgz",
    },
  });

  await assert.rejects(
    repairMissingLockfileIntegrities(
      [{ label: "package-lock.json", lockfile: packageLock }],
      {
        fetchImpl: async () =>
          new Response("not found", {
            status: 404,
            statusText: "Not Found",
          }),
      },
    ),
    /package-lock\.json: unable to fetch node_modules\/missing@4\.0\.0 from https:\/\/registry\.example\.test\/missing-4\.0\.0\.tgz \(404 Not Found\)/u,
  );
});
