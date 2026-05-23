import { readFile, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import type { CommandRunner } from "../../scripts/agent-issue-triage/types.ts";
import type { AgentIssueVisualEvidence } from "../../scripts/agent-issue/types.ts";
import type { VisualEvidenceUploader } from "./visual-evidence.ts";

export type ForgejoVisualEvidenceEnv = Pick<
  NodeJS.ProcessEnv,
  | "PATCHMILL_FORGEJO_URL"
  | "PATCHMILL_FORGEJO_TOKEN"
  | "PATCHMILL_FORGEJO_REPO"
  | "CROPRUN_AGENT_ISSUE_FORGEJO_URL"
  | "CROPRUN_AGENT_ISSUE_FORGEJO_TOKEN"
  | "CROPRUN_AGENT_ISSUE_FORGEJO_REPO"
>;

export type ForgejoVisualEvidenceUploaderOptions = {
  runner: CommandRunner;
  env?: ForgejoVisualEvidenceEnv;
  fetchImpl?: typeof fetch;
};

type ForgejoConfig = {
  baseUrl: string;
  token: string;
  repo: string;
  prNumber: number;
};

const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Uint8Array.from([0xff, 0xd8, 0xff]);
const GIF87A_SIGNATURE = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
const GIF89A_SIGNATURE = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const RIFF_SIGNATURE = Uint8Array.from([0x52, 0x49, 0x46, 0x46]);
const WEBP_SIGNATURE = Uint8Array.from([0x57, 0x45, 0x42, 0x50]);

function trimmedEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function envValue(
  env: ForgejoVisualEvidenceEnv,
  primary: "PATCHMILL_FORGEJO_URL" | "PATCHMILL_FORGEJO_TOKEN" | "PATCHMILL_FORGEJO_REPO",
  fallback: "CROPRUN_AGENT_ISSUE_FORGEJO_URL" | "CROPRUN_AGENT_ISSUE_FORGEJO_TOKEN" | "CROPRUN_AGENT_ISSUE_FORGEJO_REPO",
): string | undefined {
  return trimmedEnvValue(env[primary]) ?? trimmedEnvValue(env[fallback]);
}

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

function apiUrl(config: ForgejoConfig, path: string): string {
  const [owner, ...repoParts] = config.repo.split("/");
  const repo = repoParts.join("/");
  return `${config.baseUrl}/api/v1/repos/${encodeURIComponent(owner ?? "")}/${encodeURIComponent(repo)}${path}`;
}

function authHeaders(config: ForgejoConfig): Headers {
  return new Headers({ Authorization: `token ${config.token}` });
}

function normalizeInlineText(value: string): string {
  return value
    .replace(/[\r\n]+/gu, " ")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_[\]()#!>])/gu, "\\$1");
}

function sanitizeMarkdownInline(value: string): string {
  return escapeMarkdownText(normalizeInlineText(value));
}

function normalizeHttpUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.toString().replace(/[()]/gu, (char) => char === "(" ? "%28" : "%29");
  } catch {
    return undefined;
  }
}

function hasByteSignature(bytes: Uint8Array, signature: Uint8Array, offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[offset + index] !== signature[index]) return false;
  }
  return true;
}

function hasSupportedImageMagic(bytes: Uint8Array): boolean {
  return hasByteSignature(bytes, PNG_SIGNATURE)
    || hasByteSignature(bytes, JPEG_SIGNATURE)
    || hasByteSignature(bytes, GIF87A_SIGNATURE)
    || hasByteSignature(bytes, GIF89A_SIGNATURE)
    || (hasByteSignature(bytes, RIFF_SIGNATURE) && hasByteSignature(bytes, WEBP_SIGNATURE, 8));
}

function assertScreenshotLikeEvidence(screenshotPath: string, bytes: Uint8Array): void {
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(extname(screenshotPath).toLowerCase())) {
    throw new Error(
      `Visual evidence screenshot must use one of ${Array.from(SUPPORTED_IMAGE_EXTENSIONS).join(", ")}: ${screenshotPath}`,
    );
  }
  if (!hasSupportedImageMagic(bytes)) {
    throw new Error(`Visual evidence screenshot must contain PNG, JPEG, GIF, or WebP image bytes: ${screenshotPath}`);
  }
}

function markdownAlt(evidence: AgentIssueVisualEvidence): string {
  return sanitizeMarkdownInline(evidence.caption ?? basename(evidence.screenshotPath));
}

function visualEvidenceComment(uploaded: AgentIssueVisualEvidence[]): string {
  const lines = ["Visual evidence", ""];
  for (const evidence of uploaded) {
    if (!evidence.url) continue;
    const url = normalizeHttpUrl(evidence.url);
    if (!url) throw new Error(`Visual evidence comment requires an http(s) attachment URL for ${evidence.screenshotPath}`);
    lines.push(`![${markdownAlt(evidence)}](${url})`);
    const caption = evidence.caption ? sanitizeMarkdownInline(evidence.caption) : undefined;
    if (caption) lines.push(`- ${caption}`);
    lines.push(`- Uploaded screenshot: ${url}`);
    lines.push(`- Source path: ${sanitizeMarkdownInline(evidence.screenshotPath)}`);
    for (const referencePath of evidence.referencePaths ?? []) {
      lines.push(`- Reference: ${sanitizeMarkdownInline(referencePath)}`);
    }
    lines.push("");
  }
  lines.push("If the visual baseline intentionally changed, the relevant committed reference screenshot has been updated in this PR.");
  return lines.join("\n").trimEnd();
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  const candidateRelativePath = relative(rootPath, candidatePath);
  return candidateRelativePath === ""
    || (!candidateRelativePath.startsWith("..") && candidateRelativePath !== ".." && !isAbsolute(candidateRelativePath));
}

async function resolveEvidencePath(repoRoot: string, screenshotPath: string): Promise<string> {
  const candidatePath = isAbsolute(screenshotPath)
    ? screenshotPath
    : resolve(repoRoot, screenshotPath);
  const canonicalCandidatePath = await realpath(candidatePath);
  if (!isWithinRoot(repoRoot, canonicalCandidatePath)) {
    throw new Error(`Visual evidence screenshot path must stay within the repo root: ${screenshotPath}`);
  }
  return canonicalCandidatePath;
}

export function hasForgejoVisualEvidenceConfig(env: ForgejoVisualEvidenceEnv = process.env): boolean {
  return Boolean(envValue(env, "PATCHMILL_FORGEJO_URL", "CROPRUN_AGENT_ISSUE_FORGEJO_URL"))
    && Boolean(envValue(env, "PATCHMILL_FORGEJO_TOKEN", "CROPRUN_AGENT_ISSUE_FORGEJO_TOKEN"));
}

export class ForgejoVisualEvidenceUploader implements VisualEvidenceUploader {
  private readonly options: ForgejoVisualEvidenceUploaderOptions;

  constructor(options: ForgejoVisualEvidenceUploaderOptions) {
    this.options = options;
  }

  async uploadPrEvidence(input: {
    repoRoot: string;
    prUrl: string;
    evidence: AgentIssueVisualEvidence[] | undefined;
  }): Promise<AgentIssueVisualEvidence[]> {
    const evidence = input.evidence ?? [];
    if (evidence.length === 0) return [];

    const config = await this.forgejoConfig(input.repoRoot, input.prUrl);
    const canonicalRepoRoot = await realpath(input.repoRoot);
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const uploaded: AgentIssueVisualEvidence[] = [];
    for (const entry of evidence) {
      uploaded.push(await this.uploadScreenshot(config, fetchImpl, canonicalRepoRoot, entry));
    }
    await this.postEvidenceComment(config, fetchImpl, uploaded);
    return uploaded;
  }

  private async forgejoConfig(repoRoot: string, prUrl: string): Promise<ForgejoConfig> {
    const env = this.options.env ?? process.env;
    const baseUrl = envValue(env, "PATCHMILL_FORGEJO_URL", "CROPRUN_AGENT_ISSUE_FORGEJO_URL");
    const token = envValue(env, "PATCHMILL_FORGEJO_TOKEN", "CROPRUN_AGENT_ISSUE_FORGEJO_TOKEN");
    if (!baseUrl || !token) {
      throw new Error("Visual evidence upload requires PATCHMILL_FORGEJO_URL and PATCHMILL_FORGEJO_TOKEN");
    }

    return {
      baseUrl: normalizeBaseUrl(baseUrl),
      token,
      repo: await this.repoSlug(repoRoot),
      prNumber: parsePrNumber(prUrl),
    };
  }

  private async repoSlug(repoRoot: string): Promise<string> {
    const env = this.options.env ?? process.env;
    const configuredRepo = envValue(env, "PATCHMILL_FORGEJO_REPO", "CROPRUN_AGENT_ISSUE_FORGEJO_REPO");
    if (configuredRepo) return configuredRepo;

    const result = await this.options.runner.run("git", ["config", "--get", "remote.origin.url"], { cwd: repoRoot });
    if (result.code !== 0) throw new Error(`git remote lookup failed: ${result.stderr || result.stdout}`);
    const repo = repoSlugFromRemoteUrl(result.stdout);
    if (!repo || !repo.includes("/")) {
      throw new Error("Cannot determine Forgejo repository slug; set PATCHMILL_FORGEJO_REPO=owner/repo");
    }
    return repo;
  }

  private async uploadScreenshot(
    config: ForgejoConfig,
    fetchImpl: typeof fetch,
    repoRoot: string,
    evidence: AgentIssueVisualEvidence,
  ): Promise<AgentIssueVisualEvidence> {
    const screenshotPath = await resolveEvidencePath(repoRoot, evidence.screenshotPath);
    const bytes = await readFile(screenshotPath);
    assertScreenshotLikeEvidence(evidence.screenshotPath, bytes);
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
    const normalizedUrl = url ? normalizeHttpUrl(url) : undefined;
    if (!normalizedUrl) {
      throw new Error(`Forgejo upload response did not include a valid http(s) attachment URL for ${evidence.screenshotPath}`);
    }
    return { ...evidence, url: normalizedUrl };
  }

  private async postEvidenceComment(
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
}
