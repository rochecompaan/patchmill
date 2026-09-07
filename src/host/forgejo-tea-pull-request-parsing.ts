import {
  PullRequestIdentityError,
  sameRepositoryIdentity,
  type PullRequestSummary,
  type RepositoryIdentity,
} from "./pull-requests.ts";
import {
  ForgejoTeaPullRequestError,
  type ForgejoPullRequestOperation,
} from "./forgejo-tea-pull-request-errors.ts";

export type ForgejoRemoteRepositoryCoordinates = {
  host: string;
  owner: string;
  repository: string;
  slug: string;
};

type ObjectValue = Record<string, unknown>;
function invalidInput(): never {
  throw new ForgejoTeaPullRequestError({
    category: "invalid-input",
    operation: "validate-input",
  });
}
function malformed(operation: ForgejoPullRequestOperation): never {
  throw new ForgejoTeaPullRequestError({
    category: "malformed-response",
    operation,
  });
}
function object(
  value: unknown,
  operation: ForgejoPullRequestOperation,
): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return malformed(operation);
  return value as ObjectValue;
}
function nonblank(
  value: unknown,
  operation: ForgejoPullRequestOperation,
): string {
  if (typeof value !== "string" || value.trim() === "")
    return malformed(operation);
  return value;
}
function urlCoordinates(
  value: string,
  operation: ForgejoPullRequestOperation,
): ForgejoRemoteRepositoryCoordinates {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return malformed(operation);
  }
  if (
    !/^https?:$/u.test(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return malformed(operation);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || parts.some((part) => part === ""))
    return malformed(operation);
  const [owner, repository] = parts;
  if (owner === undefined || repository === undefined)
    return malformed(operation);
  return {
    host: url.host.toLowerCase(),
    owner,
    repository,
    slug: `${owner}/${repository}`,
  };
}

export function validateForgejoRemoteName(remote: string): void {
  if (typeof remote !== "string" || remote.trim() === "") invalidInput();
}
export function validateForgejoBranchName(branch: string): void {
  if (
    typeof branch !== "string" ||
    branch.trim() !== branch ||
    !branch ||
    branch.startsWith("-") ||
    branch === "@" ||
    branch.includes("..") ||
    branch.includes("@{") ||
    /[\x00-\x20~^:?*[\\]/u.test(branch) ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.includes("//") ||
    branch.endsWith(".") ||
    branch
      .split("/")
      .some((part) => part.startsWith(".") || part.endsWith(".lock"))
  )
    invalidInput();
}
export function validateForgejoPullRequestNumber(number: number): void {
  if (!Number.isSafeInteger(number) || number <= 0) invalidInput();
}

export function parseForgejoRemoteUrl(
  remoteUrl: string,
): ForgejoRemoteRepositoryCoordinates {
  const fail = (): never => {
    throw new PullRequestIdentityError("unsupported Forgejo remote URL");
  };
  let host: string;
  let path: string;
  if (/^[^@\s/:]+@[^\s/:]+:[^\s]+$/u.test(remoteUrl)) {
    const match = /^[^@\s/:]+@([^\s/:]+):([^\s]+)$/u.exec(remoteUrl);
    const matchHost = match?.[1];
    const matchPath = match?.[2];
    if (matchHost === undefined || matchPath === undefined) return fail();
    host = matchHost;
    path = matchPath;
  } else {
    let url: URL;
    try {
      url = new URL(remoteUrl);
    } catch {
      return fail();
    }
    if (
      !/^https?:$|^ssh:$/u.test(url.protocol) ||
      url.search ||
      url.hash ||
      (url.protocol !== "ssh:" && (url.username || url.password))
    )
      return fail();
    host = url.host;
    path = url.pathname;
  }
  const parts = path.replace(/^\/+|\/+$/gu, "").split("/");
  if (parts.length !== 2 || parts.some((part) => !part)) return fail();
  const owner = parts[0];
  const last = parts[1];
  if (owner === undefined || last === undefined) return fail();
  const repository = last.endsWith(".git") ? last.slice(0, -4) : last;
  if (!repository) return fail();
  return {
    host: host.toLowerCase(),
    owner,
    repository,
    slug: `${owner}/${repository}`,
  };
}

export function normalizeForgejoRepository(
  payload: unknown,
  options: { operation: ForgejoPullRequestOperation; expectedHost?: string },
): RepositoryIdentity {
  const value = object(payload, options.operation);
  const name = nonblank(value.name, options.operation);
  const fullName = nonblank(value.full_name, options.operation);
  const owner = nonblank(
    object(value.owner, options.operation).login,
    options.operation,
  );
  const html = nonblank(value.html_url, options.operation);
  const coordinates = urlCoordinates(html, options.operation);
  const fullNameParts = fullName.split("/");
  if (fullNameParts.length !== 2 || fullNameParts.some((part) => !part))
    return malformed(options.operation);
  const identity = {
    provider: "forgejo-tea" as const,
    host: coordinates.host,
    owner,
    repository: name,
  };
  if (
    fullNameParts[0] !== owner ||
    fullNameParts[1] !== name ||
    coordinates.owner !== owner ||
    coordinates.repository !== name
  )
    throw new PullRequestIdentityError("repository fields disagree", {
      actual: identity,
    });
  if (
    options.expectedHost !== undefined &&
    coordinates.host.toLowerCase() !== options.expectedHost.toLowerCase()
  )
    throw new PullRequestIdentityError("repository host disagrees", {
      actual: identity,
    });
  return identity;
}

export function normalizeForgejoPullRequest(
  payload: unknown,
  options: {
    operation: ForgejoPullRequestOperation;
    expectedTargetRepository: RepositoryIdentity;
    expectedHeadRepository?: RepositoryIdentity;
    expectedNumber?: number;
  },
): PullRequestSummary {
  const value = object(payload, options.operation);
  const number = value.number;
  if (
    typeof number !== "number" ||
    !Number.isSafeInteger(number) ||
    number <= 0 ||
    (options.expectedNumber !== undefined && number !== options.expectedNumber)
  )
    return malformed(options.operation);
  const body = value.body;
  if (typeof body !== "string") return malformed(options.operation);
  const base = object(value.base, options.operation);
  const head = object(value.head, options.operation);
  const baseBranch = nonblank(base.ref, options.operation);
  const headBranch = nonblank(head.ref, options.operation);
  const headSha = nonblank(head.sha, options.operation);
  const targetRepository = normalizeForgejoRepository(base.repo, {
    operation: options.operation,
    expectedHost: options.expectedTargetRepository.host,
  });
  const headRepository = normalizeForgejoRepository(head.repo, {
    operation: options.operation,
    expectedHost: options.expectedTargetRepository.host,
  });
  if (
    !sameRepositoryIdentity(targetRepository, options.expectedTargetRepository)
  )
    throw new PullRequestIdentityError("pull request target disagrees", {
      expected: options.expectedTargetRepository,
      actual: targetRepository,
    });
  if (
    options.expectedHeadRepository &&
    !sameRepositoryIdentity(headRepository, options.expectedHeadRepository)
  )
    throw new PullRequestIdentityError("pull request head disagrees", {
      expected: options.expectedHeadRepository,
      actual: headRepository,
    });
  const html = nonblank(value.html_url, options.operation);
  let parsed: URL;
  try {
    parsed = new URL(html);
  } catch {
    return malformed(options.operation);
  }
  if (
    !/^https?:$/u.test(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    return malformed(options.operation);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const [urlOwner, urlRepository, pathKind, urlNumber] = parts;
  if (
    parts.length !== 4 ||
    pathKind !== "pulls" ||
    urlNumber !== String(number)
  )
    return malformed(options.operation);
  if (
    parsed.host.toLowerCase() !== targetRepository.host ||
    urlOwner !== targetRepository.owner ||
    urlRepository !== targetRepository.repository
  )
    throw new PullRequestIdentityError("pull request URL target disagrees");
  if (
    value.state === "open" &&
    value.merged === false &&
    value.merge_commit_sha === null
  )
    return {
      number,
      url: html,
      targetRepository,
      baseBranch,
      headRepository,
      headBranch,
      headSha,
      body,
      status: "open",
    };
  if (
    value.state === "closed" &&
    value.merged === true &&
    typeof value.merge_commit_sha === "string" &&
    value.merge_commit_sha.trim()
  )
    return {
      number,
      url: html,
      targetRepository,
      baseBranch,
      headRepository,
      headBranch,
      headSha,
      body,
      status: "merged",
      mergeCommit: value.merge_commit_sha,
    };
  if (
    value.state === "closed" &&
    value.merged === false &&
    value.merge_commit_sha === null
  )
    return {
      number,
      url: html,
      targetRepository,
      baseBranch,
      headRepository,
      headBranch,
      headSha,
      body,
      status: "closed-unmerged",
    };
  return malformed(options.operation);
}
