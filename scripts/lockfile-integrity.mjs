import { createHash } from "node:crypto";

function isGitResolvedUrl(resolved) {
  return /^(?:git(?:\+ssh|\+https|\+file|):|github:)/u.test(resolved);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchTarballIntegrity({
  fetchImpl,
  label,
  path,
  resolved,
  version,
}) {
  let response;
  try {
    response = await fetchImpl(resolved);
  } catch (error) {
    throw new Error(
      `${label}: unable to fetch ${path}@${version} from ${resolved}: ${errorMessage(error)}`,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(
      `${label}: unable to fetch ${path}@${version} from ${resolved} (${response.status} ${response.statusText})`,
    );
  }

  const tarball = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha512").update(tarball).digest("base64");
  return `sha512-${digest}`;
}

export async function repairMissingLockfileIntegrities(
  lockfiles,
  { fetchImpl = fetch } = {},
) {
  const integrityByUrl = new Map();

  for (const { label, lockfile } of lockfiles) {
    for (const [path, entry] of Object.entries(lockfile.packages ?? {})) {
      const resolved = entry?.resolved;
      if (
        path === "" ||
        entry?.link === true ||
        entry?.version === undefined ||
        resolved === undefined ||
        entry?.integrity !== undefined ||
        isGitResolvedUrl(resolved)
      ) {
        continue;
      }

      let url;
      try {
        url = new URL(resolved);
      } catch {
        throw new Error(
          `${label}: ${path}@${entry.version} is missing integrity and uses unsupported resolved URL ${resolved}`,
        );
      }
      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error(
          `${label}: ${path}@${entry.version} is missing integrity and uses unsupported resolved URL ${resolved}`,
        );
      }

      let integrityPromise = integrityByUrl.get(resolved);
      if (!integrityPromise) {
        integrityPromise = fetchTarballIntegrity({
          fetchImpl,
          label,
          path,
          resolved,
          version: entry.version,
        });
        integrityByUrl.set(resolved, integrityPromise);
      }
      entry.integrity = await integrityPromise;
    }
  }
}
