import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";

function keyFor(rootDir, path) {
  return relative(rootDir, path).split("\\").join("/");
}

async function collect(rootDir, path, snapshot) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
    throw new Error(
      `Tracked path must be a regular file or directory: ${keyFor(rootDir, path)}`,
    );
  if (info.isFile()) {
    snapshot.set(keyFor(rootDir, path), {
      content: await readFile(path),
      mode: info.mode & 0o777,
    });
    return;
  }
  const entries = await readdir(path, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries)
    await collect(rootDir, join(path, entry.name), snapshot);
}

export async function snapshotTrackedPaths(rootDir, relativeRoots) {
  const snapshot = new Map();
  for (const root of relativeRoots)
    await collect(rootDir, join(rootDir, root), snapshot);
  return snapshot;
}

export function changedTrackedFiles(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => {
      const left = before.get(path);
      const right = after.get(path);
      return (
        !left ||
        !right ||
        left.mode !== right.mode ||
        !left.content.equals(right.content)
      );
    })
    .sort();
}

export async function restoreTrackedPaths(rootDir, relativeRoots, snapshot) {
  for (const root of relativeRoots)
    await rm(join(rootDir, root), { recursive: true, force: true });
  for (const [path, entry] of snapshot) {
    const absolute = join(rootDir, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, entry.content, { mode: entry.mode });
    await chmod(absolute, entry.mode);
  }
}
