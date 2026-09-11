import { sameRepositoryIdentity } from "./pull-requests.ts";

export type ParsedPullRequestUrl = Readonly<{
  protocol: "http:" | "https:";
  hostname: string;
  port: string;
  owner: string;
  repository: string;
  number: number;
  hasTrailingSlash: boolean;
}>;

function parse(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.username || url.password || url.search || url.hash
      ? undefined
      : url;
  } catch {
    return undefined;
  }
}

export function parsePullRequestUrl(
  prUrl: string,
  pathSegment: string,
): ParsedPullRequestUrl {
  const url = parse(prUrl);
  const match = url
    ? /^\/([^/]+)\/([^/]+)\/([^/]+)\/([1-9]\d*)(\/?)$/u.exec(url.pathname)
    : undefined;
  if (
    !url ||
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname ||
    !match ||
    match[3] !== pathSegment
  ) {
    throw new Error("Invalid pull request URL");
  }
  const number = Number(match[4]);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error("Invalid pull request URL");
  }
  return {
    protocol: url.protocol,
    hostname: url.hostname.toLowerCase(),
    port: url.port,
    owner: match[1]!,
    repository: match[2]!,
    number,
    hasTrailingSlash: match[5] === "/",
  };
}

export function pullRequestNumber(prUrl: string, pathSegment: string): number {
  return parsePullRequestUrl(prUrl, pathSegment).number;
}

/** Canonicalizes one provider URL only when it identifies its durable reference. */
export function canonicalPullRequestUrl(
  prUrl: string,
  reference: import("./pull-requests.ts").PullRequestReference,
): string | undefined {
  const segment =
    reference.targetRepository.provider === "github-gh" ? "pull" : "pulls";
  try {
    const parsed = parsePullRequestUrl(prUrl, segment);
    const authority = /^https?:\/\/([^/?#]+)/u.exec(prUrl)?.[1];
    const parsedAuthority = `${parsed.hostname}${
      parsed.port === "" ? "" : `:${parsed.port}`
    }`;
    if (
      authority?.toLowerCase() !== parsedAuthority.toLowerCase() ||
      !sameRepositoryIdentity(
        {
          provider: reference.targetRepository.provider,
          host: parsedAuthority,
          owner: parsed.owner,
          repository: parsed.repository,
        },
        reference.targetRepository,
      ) ||
      parsed.number !== reference.number
    )
      return undefined;
    return `${parsed.protocol}//${reference.targetRepository.host.toLowerCase()}/${reference.targetRepository.owner.toLowerCase()}/${reference.targetRepository.repository.toLowerCase()}/${segment}/${reference.number}`;
  } catch {
    return undefined;
  }
}

export function pullRequestUrlMatchesReference(
  prUrl: string,
  reference: import("./pull-requests.ts").PullRequestReference,
): boolean {
  return canonicalPullRequestUrl(prUrl, reference) !== undefined;
}

export function sameCanonicalUrl(left: string, right: string): boolean {
  const a = parse(left),
    b = parse(right);
  if (!a || !b) return false;
  const path = (url: URL) => url.pathname.replace(/\/$/u, "");
  return (
    a.protocol === b.protocol &&
    a.host.toLowerCase() === b.host.toLowerCase() &&
    path(a) === path(b)
  );
}
