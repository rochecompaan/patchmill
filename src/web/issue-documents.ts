import { createHash } from "node:crypto";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import type { PatchmillConfig } from "../config/config.ts";
import type { HostProviderId } from "../host/types.ts";
import { isArtifactFile, isIssueBranch } from "../kernel/names.ts";
import type { CommandRunner } from "../process/command.ts";
import type { Artifact, TextBlock } from "./api-types.ts";
import { createDocumentCache, type DocumentCache } from "./document-cache.ts";
import {
  markdownBlocks,
  markdownLinks,
  markdownTitle,
  type MarkdownLink,
} from "./markdown-blocks.ts";

export { createDocumentCache, type DocumentCache };

export type IssueFile = {
  readonly body: Buffer;
  readonly contentType: string;
};
export type IssueDocuments = {
  readonly artifacts: readonly Artifact[];
  file(id: string): Promise<IssueFile | null>;
};
export type DocumentRepositoryInput = {
  repoRoot: string;
  config: PatchmillConfig;
  baseBranch: string;
  repositoryUrl: string;
  provider: HostProviderId;
  runner: CommandRunner;
};

export const fileIdPattern = /^(mockup|diagram)-[0-9a-f]{12}$/;
const MARKDOWN_LIMIT = 1024 * 1024;
const HTML_LIMIT = 5 * 1024 * 1024;
const HTML_ENTRIES = 20;

/** Branch names that may be placed in a ref name without escaping. */
export function validBranchName(branch: string): boolean {
  return !!branch && !/[\s~^:?*[\\]|\.\./.test(branch);
}

/** An immutable host URL for one repository file at one commit. */
export function hostFileUrl(input: {
  repositoryUrl: string;
  provider: HostProviderId;
  commit: string;
  path: string;
}): string {
  const origin = new URL(input.repositoryUrl);
  if (
    !["https:", "http:"].includes(origin.protocol) ||
    origin.username ||
    origin.password
  )
    throw Error("Invalid repository URL.");
  const encoded = input.path.split("/").map(encodeURIComponent).join("/");
  return `${origin.href.replace(/\/$/, "")}/${input.provider === "github-gh" ? "blob" : "src/commit"}/${input.commit}/${encoded}`;
}

/** The configured spec and plan directories, relative and with `/`. */
export function artifactDirectories(
  repoRoot: string,
  config: PatchmillConfig,
): readonly { kind: "spec" | "plan"; path: string }[] {
  return (["spec", "plan"] as const).map((kind) => {
    const path = relative(
      repoRoot,
      resolve(
        repoRoot,
        kind === "spec" ? config.paths.specsDir : config.paths.plansDir,
      ),
    );
    if (
      !path ||
      path === ".." ||
      path.startsWith(`..${sep}`) ||
      isAbsolute(path)
    )
      throw Error("Artifact directory is outside the repository.");
    return { kind, path: path.split(sep).join("/") };
  });
}

type Ref = {
  name: string;
  branch: string;
  remote: boolean;
  label: string;
  commit: string;
};
type Entry = { blob: string; size: number };
type Parsed = {
  blocks: readonly TextBlock[];
  title: string | null;
  links: readonly MarkdownLink[];
};

/** A repository-relative HTML path for a document link, or null. */
function linkedPath(document: string, target: string): string | null {
  const bare = target.replace(/#.*$/, "");
  if (
    !/\.html?$/i.test(bare) ||
    /^[a-z][a-z0-9+.-]*:/i.test(bare) ||
    /^\/|[?\\%]/.test(bare)
  )
    return null;
  const path = posix.normalize(posix.join(posix.dirname(document), bare));
  return path.startsWith("../") || path === ".." || posix.isAbsolute(path)
    ? null
    : path;
}

/**
 * Finds the spec, plan, mockups and diagrams of an issue in committed Git
 * objects. A Git failure throws. A skipped document calls `warn`.
 */
export function createIssueDocumentReader(
  input: DocumentRepositoryInput & {
    warn(message: string): void;
    cache?: DocumentCache;
  },
): (issue: number, branches: readonly string[]) => Promise<IssueDocuments> {
  const cache = input.cache ?? createDocumentCache();
  const git = async (args: string[], allowed = [0]) => {
    const result = await input.runner("git", ["--literal-pathspecs", ...args], {
      cwd: input.repoRoot,
    });
    if (!allowed.includes(result.code)) throw Error(`git ${args[0]} failed.`);
    return result;
  };
  const blob = async (sha: string) =>
    (await git(["cat-file", "blob", sha])).stdout;
  const parsed = async (sha: string): Promise<Parsed> => {
    const cached = cache.get<Parsed>(`md:${sha}`);
    if (cached) return cached;
    const source = await blob(sha);
    const value = {
      blocks: markdownBlocks(source),
      title: markdownTitle(source),
      links: markdownLinks(source),
    };
    cache.set(`md:${sha}`, value, source.length * 2);
    return value;
  };
  const html = async (sha: string): Promise<Buffer> => {
    const cached = cache.get<Buffer>(`html:${sha}`);
    if (cached) return cached;
    const body = Buffer.from(await blob(sha), "utf8");
    cache.set(`html:${sha}`, body, body.length);
    return body;
  };
  return async (issue, branches) => {
    hostFileUrl({ ...input, commit: "0", path: "x" });
    const directories = artifactDirectories(input.repoRoot, input.config);
    const base = input.baseBranch;
    const names = [...new Set(branches)].filter(
      (b) => validBranchName(b) && b !== base,
    );
    const wanted: Omit<Ref, "commit">[] = [
      ...names
        .filter((b) => isIssueBranch(issue, b))
        .map((b) => ({
          name: `refs/heads/${b}`,
          branch: b,
          remote: false,
          label: `On local branch ${b}. Not pushed yet.`,
        })),
      ...names.map((b) => ({
        name: `refs/remotes/origin/${b}`,
        branch: b,
        remote: true,
        label: `On branch ${b}`,
      })),
      ...(validBranchName(base)
        ? [
            {
              name: `refs/remotes/origin/${base}`,
              branch: base,
              remote: true,
              label: `On ${base}`,
            },
          ]
        : []),
    ];
    const refs: Ref[] = [];
    for (const ref of wanted) {
      const result = await git(
        ["rev-parse", "--verify", "--quiet", `${ref.name}^{commit}`],
        [0, 1, 128],
      );
      const sha = result.stdout.trim();
      if (result.code === 0 && /^[a-f0-9]{40,64}$/.test(sha))
        refs.push({ ...ref, commit: sha });
    }
    const entries = new Map<string, Promise<Entry | null>>();
    const entry = (commit: string, path: string) => {
      const key = `${commit}:${path}`;
      if (!entries.has(key))
        entries.set(
          key,
          git(["ls-tree", "-l", "-z", "--full-tree", commit, "--", path]).then(
            (r) => {
              const m =
                /^100(?:644|755) blob ([a-f0-9]{40,64}) +(\d+)\t(.*)$/s.exec(
                  r.stdout.split("\0")[0] ?? "",
                );
              return m && m[3] === path
                ? { blob: m[1]!, size: Number(m[2]) }
                : null;
            },
          ),
        );
      return entries.get(key)!;
    };
    const trees = async (commit: string, directory: string) =>
      (
        await git([
          "ls-tree",
          "-z",
          "--full-tree",
          commit,
          "--",
          `${directory}/`,
        ])
      ).stdout
        .split("\0")
        .filter((e) => /^100(644|755) blob /.test(e))
        .map((e) => e.slice(e.indexOf("\t") + 1 + directory.length + 1));
    /** The first remote ref that holds the same blob decides the location. */
    const place = async (found: Ref, path: string, sha: string) => {
      for (const ref of refs)
        if (ref.remote && (await entry(ref.commit, path))?.blob === sha)
          return {
            commit: ref.commit.slice(0, 7),
            location: ref.label,
            draft: false,
            sourceUrl: hostFileUrl({ ...input, commit: ref.commit, path }),
          };
      return {
        commit: found.commit.slice(0, 7),
        location: found.label,
        draft: true,
        sourceUrl: null,
      };
    };
    const skip = (sha: string, path: string) => {
      if (cache.firstWarning(sha))
        input.warn(
          `Skipped ${path} for issue #${issue}: the file is too large.`,
        );
    };
    const artifacts: Artifact[] = [];
    const sources: {
      ref: Ref;
      path: string;
      links: readonly MarkdownLink[];
    }[] = [];
    for (const { kind, path: directory } of directories) {
      for (const ref of refs) {
        const name = (await trees(ref.commit, directory))
          .filter((n) => !n.includes("/") && isArtifactFile(kind, issue, n))
          .sort()
          .at(-1);
        if (!name) continue;
        const path = `${directory}/${name}`;
        const found = await entry(ref.commit, path);
        if (!found) break;
        if (found.size > MARKDOWN_LIMIT) {
          skip(found.blob, path);
          break;
        }
        const doc = await parsed(found.blob);
        artifacts.push({
          id: kind,
          kind,
          title: doc.title ?? name,
          path,
          ...(await place(ref, path, found.blob)),
          preview: { kind: "document", blocks: doc.blocks },
        });
        sources.push({ ref, path, links: doc.links });
        break;
      }
    }
    const files = new Map<string, string>();
    const seen = new Set<string>();
    for (const source of sources)
      for (const link of source.links) {
        if (files.size >= HTML_ENTRIES) break;
        const path = linkedPath(source.path, link.target);
        if (!path || seen.has(path)) continue;
        seen.add(path);
        const found = await entry(source.ref.commit, path);
        if (!found) continue;
        if (found.size > HTML_LIMIT) {
          skip(found.blob, path);
          continue;
        }
        const kind = path.endsWith("-show-me.html") ? "diagram" : "mockup";
        const id = `${kind}-${createHash("sha256").update(path).digest("hex").slice(0, 12)}`;
        files.set(id, found.blob);
        artifacts.push({
          id,
          kind,
          title: link.text.trim() || posix.basename(path),
          path,
          ...(await place(source.ref, path, found.blob)),
          preview: { kind: "page", url: `/files/issues/${issue}/${id}` },
        });
      }
    return {
      artifacts,
      async file(id) {
        const sha = fileIdPattern.test(id) ? files.get(id) : undefined;
        return sha
          ? { body: await html(sha), contentType: "text/html; charset=utf-8" }
          : null;
      },
    };
  };
}

/**
 * Ref names and objects of the issue's branches and the base, to notice a new
 * commit. Never throws: a Git failure gives `refs-unavailable`.
 */
export async function issueRefsFingerprint(input: {
  repoRoot: string;
  runner: CommandRunner;
  issue: number;
  baseBranch: string;
}): Promise<string> {
  try {
    const base = validBranchName(input.baseBranch)
      ? `refs/remotes/origin/${input.baseBranch}`
      : null;
    const result = await input.runner(
      "git",
      [
        "for-each-ref",
        "--format=%(refname) %(objectname)",
        "refs/heads/agent/",
        "refs/remotes/origin/agent/",
        ...(base ? [base] : []),
      ],
      { cwd: input.repoRoot },
    );
    if (result.code !== 0) return "refs-unavailable";
    return result.stdout
      .split("\n")
      .filter((line) => {
        const name = line.slice(0, line.lastIndexOf(" "));
        if (name === base) return true;
        const branch = name.replace(/^refs\/(heads|remotes\/origin)\//, "");
        return branch !== name && isIssueBranch(input.issue, branch);
      })
      .sort()
      .join("\n");
  } catch {
    return "refs-unavailable";
  }
}
