import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import type { AgentIssueVisualEvidence, CommandRunner } from "./types.ts";

export type VisualEvidenceEnv = Pick<
  NodeJS.ProcessEnv,
  "CROPRUN_AGENT_ISSUE_FORGEJO_URL" | "CROPRUN_AGENT_ISSUE_FORGEJO_TOKEN" | "CROPRUN_AGENT_ISSUE_FORGEJO_REPO"
>;

export type UploadPrVisualEvidenceInput = {
  runner: CommandRunner;
  repoRoot: string;
  prUrl: string;
  evidence: AgentIssueVisualEvidence[] | undefined;
  env?: VisualEvidenceEnv;
  fetchImpl?: typeof fetch;
};

type ForgejoConfig = {
  baseUrl: string;
  token: string;
  repo: string;
  prNumber: number;
};

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/u, "");
}

function parsePrNumber(prUrl: string): number {
  const match = /\/(?:pulls|pull)\/(\d+)(?:[/?#].*)?$/u.exec(prUrl);
  if (!match) throw new Error(`Cannot determine PR number from ${prUrl}`);
  return Number(match[1]);
}

function repoSlugFromRemoteUrl(url: string): string | undefined {
  const trimmed = url.trim().replace(/\.git$/u, "");
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

async function repoSlug(runner: CommandRunner, repoRoot: string, env: VisualEvidenceEnv): Promise<string> {
  if (env.CROPRUN_AGENT_ISSUE_FORGEJO_REPO) return env.CROPRUN_AGENT_ISSUE_FORGEJO_REPO;

  const result = await runner.run("git", ["config", "--get", "remote.origin.url"], { cwd: repoRoot });
  if (result.code !== 0) throw new Error(`git remote lookup failed: ${result.stderr || result.stdout}`);
  const repo = repoSlugFromRemoteUrl(result.stdout);
  if (!repo || !repo.includes("/")) {
    throw new Error("Cannot determine Forgejo repository slug; set CROPRUN_AGENT_ISSUE_FORGEJO_REPO=owner/repo");
  }
  return repo;
}

async function forgejoConfig(input: UploadPrVisualEvidenceInput): Promise<ForgejoConfig> {
  const env = input.env ?? process.env;
  if (!env.CROPRUN_AGENT_ISSUE_FORGEJO_URL || !env.CROPRUN_AGENT_ISSUE_FORGEJO_TOKEN) {
    throw new Error(
      "Visual evidence upload requires CROPRUN_AGENT_ISSUE_FORGEJO_URL and CROPRUN_AGENT_ISSUE_FORGEJO_TOKEN",
    );
  }

  return {
    baseUrl: normalizeBaseUrl(env.CROPRUN_AGENT_ISSUE_FORGEJO_URL),
    token: env.CROPRUN_AGENT_ISSUE_FORGEJO_TOKEN,
    repo: await repoSlug(input.runner, input.repoRoot, env),
    prNumber: parsePrNumber(input.prUrl),
  };
}

function apiUrl(config: ForgejoConfig, path: string): string {
  const [owner, ...repoParts] = config.repo.split("/");
  const repo = repoParts.join("/");
  return `${config.baseUrl}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`;
}

function authHeaders(config: ForgejoConfig): Headers {
  return new Headers({ Authorization: `token ${config.token}` });
}

async function uploadScreenshot(
  config: ForgejoConfig,
  fetchImpl: typeof fetch,
  repoRoot: string,
  evidence: AgentIssueVisualEvidence,
): Promise<AgentIssueVisualEvidence> {
  const screenshotPath = isAbsolute(evidence.screenshotPath)
    ? evidence.screenshotPath
    : join(repoRoot, evidence.screenshotPath);
  const bytes = await readFile(screenshotPath);
  const filename = basename(evidence.screenshotPath);
  const form = new FormData();
  form.append("attachment", new Blob([bytes]), filename);

  const response = await fetchImpl(apiUrl(config, `/issues/${config.prNumber}/assets`), {
    method: "POST",
    headers: authHeaders(config),
    body: form,
  });
  if (!response.ok) {
    throw new Error(`Forgejo visual evidence upload failed for ${evidence.screenshotPath}: ${response.status} ${await response.text()}`);
  }

  const parsed = await response.json() as Record<string, unknown>;
  const url = typeof parsed.browser_download_url === "string"
    ? parsed.browser_download_url
    : typeof parsed.download_url === "string"
      ? parsed.download_url
      : typeof parsed.url === "string"
        ? parsed.url
        : undefined;
  if (!url) throw new Error(`Forgejo upload response did not include an attachment URL for ${evidence.screenshotPath}`);
  return { ...evidence, url };
}

function markdownAlt(evidence: AgentIssueVisualEvidence): string {
  return evidence.caption ?? basename(evidence.screenshotPath);
}

function visualEvidenceComment(uploaded: AgentIssueVisualEvidence[]): string {
  const lines = ["Visual evidence", ""];
  for (const evidence of uploaded) {
    if (!evidence.url) continue;
    lines.push(`![${markdownAlt(evidence)}](${evidence.url})`);
    if (evidence.caption) lines.push(`- ${evidence.caption}`);
    lines.push(`- Uploaded screenshot: ${evidence.url}`);
    lines.push(`- Source path: \`${evidence.screenshotPath}\``);
    for (const referencePath of evidence.referencePaths ?? []) {
      lines.push(`- Reference: \`${referencePath}\``);
    }
    lines.push("");
  }
  lines.push("If the visual baseline intentionally changed, the relevant committed reference screenshot has been updated in this PR.");
  return lines.join("\n").trimEnd();
}

async function postEvidenceComment(
  config: ForgejoConfig,
  fetchImpl: typeof fetch,
  uploaded: AgentIssueVisualEvidence[],
): Promise<void> {
  const response = await fetchImpl(apiUrl(config, `/issues/${config.prNumber}/comments`), {
    method: "POST",
    headers: new Headers({
      Authorization: `token ${config.token}`,
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ body: visualEvidenceComment(uploaded) }),
  });
  if (!response.ok) {
    throw new Error(`Forgejo visual evidence comment failed: ${response.status} ${await response.text()}`);
  }
}

export async function uploadPrVisualEvidence(input: UploadPrVisualEvidenceInput): Promise<AgentIssueVisualEvidence[]> {
  const evidence = input.evidence ?? [];
  if (evidence.length === 0) return [];

  const config = await forgejoConfig(input);
  const fetchImpl = input.fetchImpl ?? fetch;
  const uploaded: AgentIssueVisualEvidence[] = [];
  for (const entry of evidence) {
    uploaded.push(await uploadScreenshot(config, fetchImpl, input.repoRoot, entry));
  }
  await postEvidenceComment(config, fetchImpl, uploaded);
  return uploaded;
}
