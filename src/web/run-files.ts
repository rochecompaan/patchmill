import fs from "node:fs/promises";
import { constants } from "node:fs";
import { relative, resolve, sep } from "node:path";

export const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const timestamp = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const lineLimit = 16 * 1024 * 1024;

/** Confined local reads. Record contents never choose a filesystem target. */
export function runFiles(root: string, warn: (message: string) => void) {
  root = resolve(root);
  const warning = () => warn("Could not read optional issue run files.");
  async function safe(path: string, directory: boolean): Promise<boolean> {
    const rel = relative(root, path);
    if (
      rel === ".." ||
      rel.startsWith(`..${sep}`) ||
      resolve(root, rel) !== path
    )
      return false;
    let current = root;
    try {
      const parts = rel ? rel.split(sep) : [];
      const initial = await fs.lstat(root);
      if (!initial.isDirectory() || initial.isSymbolicLink()) return false;
      for (const [index, part] of parts.entries()) {
        current = resolve(current, part);
        const stat = await fs.lstat(current);
        if (
          stat.isSymbolicLink() ||
          (index < parts.length - 1 || directory
            ? !stat.isDirectory()
            : !stat.isFile())
        )
          return false;
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") warning();
      return false;
    }
  }
  async function open(path: string) {
    if (!(await safe(path, false))) return;
    const file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!(await file.stat()).isFile()) {
      await file.close();
      return;
    }
    return file;
  }
  return {
    directory: (path: string) => safe(path, true),
    async list(path: string) {
      if (!(await safe(path, true))) return [];
      try {
        return (await fs.readdir(path, { withFileTypes: true })).sort((a, b) =>
          a.name.localeCompare(b.name),
        );
      } catch {
        warning();
        return [];
      }
    },
    async json(path: string): Promise<unknown> {
      let file;
      try {
        file = await open(path);
        if (!file) return;
        if ((await file.stat()).size > lineLimit) {
          warning();
          return;
        }
        return JSON.parse(await file.readFile("utf8"));
      } catch {
        warning();
        return;
      } finally {
        await file?.close();
      }
    },
    async *lines(path: string): AsyncGenerator<unknown> {
      let file;
      try {
        file = await open(path);
        if (!file) return;
        let pending = Buffer.alloc(0);
        let oversized = false;
        const parse = (line: Buffer): unknown => {
          if (!line.toString("utf8").trim()) return undefined;
          try {
            return JSON.parse(line.toString("utf8"));
          } catch {
            warning();
            return null;
          }
        };
        for await (const chunk of file.createReadStream({ autoClose: false })) {
          const buffer = chunk as Buffer;
          let start = 0;
          for (let end = 0; end < buffer.length; end++) {
            if (buffer[end] !== 10) continue;
            const length = pending.length + end - start;
            if (oversized || length > lineLimit) {
              warning();
              yield null;
            } else {
              const value = parse(
                Buffer.concat([pending, buffer.subarray(start, end)]),
              );
              if (value !== undefined) yield value;
            }
            pending = Buffer.alloc(0);
            oversized = false;
            start = end + 1;
          }
          if (pending.length + buffer.length - start > lineLimit) {
            oversized = true;
            pending = Buffer.alloc(0);
          }
          if (!oversized)
            pending = Buffer.concat([pending, buffer.subarray(start)]);
        }
        if (oversized) {
          warning();
          yield null;
        } else if (pending.length) {
          const value = parse(pending);
          if (value !== undefined) yield value;
        }
      } catch {
        warning();
        yield null;
      } finally {
        await file?.close();
      }
    },
  };
}
export type RunFiles = ReturnType<typeof runFiles>;
