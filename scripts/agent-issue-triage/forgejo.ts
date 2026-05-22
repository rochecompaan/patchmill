import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CommandRunner, IssueSummary, LabelChangePlan, LabelDefinition } from "./types.ts";

const ISSUE_PAGE_SIZE = 1000;

function insertBeforeSeparator(args: string[], extraArgs: string[]): string[] {
  const separator = args.indexOf("--");
  if (separator === -1) return [...args, ...extraArgs];
  return [...args.slice(0, separator), ...extraArgs, ...args.slice(separator)];
}

function commonGitConfigPath(gitDir: string): string {
  const commonDirPath = join(gitDir, "commondir");
  if (!existsSync(commonDirPath)) return join(gitDir, "config");
  const commonDir = readFileSync(commonDirPath, "utf8").trim();
  return join(resolve(gitDir, commonDir), "config");
}

function gitConfigPath(repoRoot: string): string | undefined {
  const gitPath = join(repoRoot, ".git");
  if (!existsSync(gitPath)) return undefined;
  if (statSync(gitPath).isDirectory()) return commonGitConfigPath(gitPath);
  const gitMetadata = readFileSync(gitPath, "utf8");
  if (/^gitdir:/u.test(gitMetadata)) {
    const gitDir = gitMetadata.replace(/^gitdir:\s*/u, "").trim();
    return commonGitConfigPath(resolve(repoRoot, gitDir));
  }
  return undefined;
}

function originRemoteUrl(config: string): string | undefined {
  const lines = config.split(/\r?\n/u);
  let inOrigin = false;
  for (const line of lines) {
    const section = /^\s*\[remote\s+"([^"]+)"\]\s*$/u.exec(line);
    if (section) {
      inOrigin = section[1] === "origin";
      continue;
    }
    if (!inOrigin) continue;
    const url = /^\s*url\s*=\s*(\S+)\s*$/u.exec(line);
    if (url) return url[1];
  }
  return undefined;
}

function repoSlugFromRemoteUrl(url: string): string | undefined {
  const trimmed = url.replace(/\.git$/u, "");
  const sshUrl = /^ssh:\/\/[^@]+@[^/]+\/(.+)$/u.exec(trimmed);
  if (sshUrl) return sshUrl[1];
  const scpLikeUrl = /^[^@]+@[^:]+:(.+)$/u.exec(trimmed);
  if (scpLikeUrl) return scpLikeUrl[1];
  try {
    const parsed = new URL(trimmed);
    return parsed.pathname.replace(/^\/+/, "");
  } catch {
    return undefined;
  }
}

function teaRepo(repoRoot: string): string {
  try {
    const configPath = gitConfigPath(repoRoot);
    if (!configPath || !existsSync(configPath)) return repoRoot;
    const remoteUrl = originRemoteUrl(readFileSync(configPath, "utf8"));
    return remoteUrl ? (repoSlugFromRemoteUrl(remoteUrl) ?? repoRoot) : repoRoot;
  } catch {
    return repoRoot;
  }
}

function withTeaContext(args: string[], repoRoot: string, teaLogin?: string): string[] {
  const repoArgs = insertBeforeSeparator(args, ["--repo", teaRepo(repoRoot)]);
  if (!teaLogin) return repoArgs;
  return insertBeforeSeparator(repoArgs, ["--login", teaLogin]);
}

function parseJson(stdout: string, context: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${context} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function labelNames(labels: unknown): string[] {
  if (typeof labels === "string") {
    return labels
      .split(/[,\s]+/u)
      .map((label) => label.trim())
      .filter((label) => label.length > 0)
      .sort((a, b) => a.localeCompare(b));
  }
  if (!Array.isArray(labels)) throw new Error("Unexpected labels payload");
  return labels
    .map((label) => {
      if (typeof label === "string") return label;
      if (label && typeof label === "object" && "name" in label && typeof label.name === "string") return label.name;
      throw new Error(`Unexpected label payload: ${JSON.stringify(label)}`);
    })
    .sort((a, b) => a.localeCompare(b));
}

function issueNumber(value: unknown): number | undefined {
  if (Number.isInteger(value) && Number(value) > 0) return Number(value);
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return Number(value);
  return undefined;
}

function authorName(author: unknown): string | undefined {
  if (typeof author === "string") return author;
  if (author && typeof author === "object" && "login" in author && typeof author.login === "string") return author.login;
  return undefined;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/gu, "");
}

function normalizeTeaLine(line: string): string {
  return stripAnsi(line).replace(/\s+$/u, "").replace(/^ {0,2}/u, "");
}

function trimBlankEdges(lines: string[]): string[] {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed[0].trim().length === 0) trimmed.shift();
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim().length === 0) trimmed.pop();
  return trimmed;
}

function parseIssueComments(stdout: string): unknown[] {
  const lines = stdout.split(/\r?\n/u).map(normalizeTeaLine);
  const commentsStart = lines.findIndex((line) => line.trim() === "## Comments");
  if (commentsStart < 0) return [];

  const comments: Array<{ author: string; created: string; body: string }> = [];
  let current: { author: string; created: string; bodyLines: string[] } | undefined;

  const flush = () => {
    if (!current) return;
    comments.push({
      author: current.author,
      created: current.created,
      body: trimBlankEdges(current.bodyLines).join("\n"),
    });
    current = undefined;
  };

  for (const line of lines.slice(commentsStart + 1)) {
    const header = /^\*\*@([^*]+)\*\* wrote on ([^:]+:\d{2}):$/u.exec(line.trim());
    if (header) {
      flush();
      current = { author: header[1], created: header[2], bodyLines: [] };
      continue;
    }

    if (line.trim() === "--------") {
      flush();
      continue;
    }

    current?.bodyLines.push(line);
  }

  flush();
  return comments;
}

async function fetchIssueComments(runner: CommandRunner, repoRoot: string, issueNumber: number, teaLogin?: string): Promise<unknown[]> {
  const result = await runner.run(
    "tea",
    withTeaContext(["issues", String(issueNumber), "--comments"], repoRoot, teaLogin),
    { cwd: repoRoot },
  );
  if (result.code !== 0) throw new Error(`tea issue comments failed for #${issueNumber}: ${result.stderr || result.stdout}`);
  return parseIssueComments(result.stdout);
}

export async function hydrateIssueComments(runner: CommandRunner, repoRoot: string, issues: IssueSummary[], teaLogin?: string): Promise<void> {
  for (const issue of issues) {
    issue.comments = await fetchIssueComments(runner, repoRoot, issue.number, teaLogin);
  }
}

export async function listOpenIssues(runner: CommandRunner, repoRoot: string, teaLogin?: string): Promise<IssueSummary[]> {
  const issues: IssueSummary[] = [];

  for (let page = 1; ; page += 1) {
    const result = await runner.run(
      "tea",
      withTeaContext([
        "issues",
        "list",
        "--state",
        "open",
        "--fields",
        "index,title,body,state,labels,author,updated,comments",
        "--page",
        String(page),
        "--limit",
        String(ISSUE_PAGE_SIZE),
        "--output",
        "json",
      ], repoRoot, teaLogin),
      { cwd: repoRoot },
    );
    if (result.code !== 0) throw new Error(`tea issues list failed: ${result.stderr || result.stdout}`);
    const parsed = parseJson(result.stdout, "tea issues list");
    if (!Array.isArray(parsed)) throw new Error("tea issues list returned a non-array payload");

    const pageIssues = parsed.map((entry) => {
      if (!entry || typeof entry !== "object") throw new Error(`Unexpected issue payload: ${JSON.stringify(entry)}`);
      const issue = entry as Record<string, unknown>;
      const number = issueNumber(issue.index);
      if (number === undefined || typeof issue.title !== "string") {
        throw new Error(`Unexpected issue payload: ${JSON.stringify(entry)}`);
      }

      return {
        number,
        title: issue.title,
        body: typeof issue.body === "string" ? issue.body : "",
        state: typeof issue.state === "string" ? issue.state : "open",
        labels: labelNames(issue.labels),
        author: authorName(issue.author),
        updated: typeof issue.updated === "string" ? issue.updated : undefined,
        comments: Array.isArray(issue.comments) ? issue.comments : undefined,
      };
    });

    if (pageIssues.length === 0) break;
    issues.push(...pageIssues);
  }

  return issues.sort((a, b) => a.number - b.number);
}

export async function listLabels(runner: CommandRunner, repoRoot: string, teaLogin?: string): Promise<string[]> {
  const result = await runner.run("tea", withTeaContext(["labels", "list", "--limit", "1000", "--output", "json"], repoRoot, teaLogin), { cwd: repoRoot });
  if (result.code !== 0) throw new Error(`tea labels list failed: ${result.stderr || result.stdout}`);
  const parsed = parseJson(result.stdout, "tea labels list");
  if (!Array.isArray(parsed)) throw new Error("tea labels list returned a non-array payload");

  return parsed
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && "name" in entry && typeof entry.name === "string") return entry.name;
      throw new Error(`Unexpected label payload: ${JSON.stringify(entry)}`);
    })
    .sort((a, b) => a.localeCompare(b));
}

export async function createLabel(runner: CommandRunner, repoRoot: string, label: LabelDefinition, teaLogin?: string): Promise<void> {
  const result = await runner.run(
    "tea",
    withTeaContext(["labels", "create", "--name", label.name, "--color", label.color, "--description", label.description], repoRoot, teaLogin),
    { cwd: repoRoot },
  );
  if (result.code !== 0) throw new Error(`tea labels create failed for ${label.name}: ${result.stderr || result.stdout}`);
}

export async function applyIssueLabels(runner: CommandRunner, repoRoot: string, change: LabelChangePlan, teaLogin?: string): Promise<void> {
  if (change.addLabels.length === 0 && change.removeLabels.length === 0) return;

  const args = ["issues", "edit", String(change.issueNumber)];
  if (change.removeLabels.length > 0) {
    args.push("--remove-labels", change.removeLabels.join(","));
  }
  if (change.addLabels.length > 0) {
    args.push("--add-labels", change.addLabels.join(","));
  }

  const result = await runner.run("tea", withTeaContext(args, repoRoot, teaLogin), { cwd: repoRoot });
  if (result.code !== 0) {
    throw new Error(`tea issues edit labels failed for #${change.issueNumber}: ${result.stderr || result.stdout}`);
  }
}

export async function commentIssue(runner: CommandRunner, repoRoot: string, issueNumber: number, body: string, teaLogin?: string): Promise<void> {
  const result = await runner.run("tea", withTeaContext(["comment", String(issueNumber), "--", body], repoRoot, teaLogin), { cwd: repoRoot });
  if (result.code !== 0) throw new Error(`tea comment failed for #${issueNumber}: ${result.stderr || result.stdout}`);
}
