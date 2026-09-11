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

export type CanonicalPullRequestUrl = Readonly<{
  reference: import("./pull-requests.ts").PullRequestReference;
  url: string;
}>;

/** Parses and canonicalizes a provider URL for one durable repository identity. */
export function parseCanonicalPullRequestUrl(
  prUrl: string,
  targetRepository: import("./pull-requests.ts").RepositoryIdentity,
): CanonicalPullRequestUrl | undefined {
  const segment = targetRepository.provider === "github-gh" ? "pull" : "pulls";
  try {
    const parsed = parsePullRequestUrl(prUrl, segment);
    const parsedAuthority = `${parsed.hostname}${
      parsed.port === "" ? "" : `:${parsed.port}`
    }`;
    if (
      !sameRepositoryIdentity(
        {
          provider: targetRepository.provider,
          host: parsedAuthority,
          owner: parsed.owner,
          repository: parsed.repository,
        },
        targetRepository,
      )
    )
      return undefined;
    const reference = { targetRepository, number: parsed.number };
    return {
      reference,
      url: `${parsed.protocol}//${targetRepository.host.toLowerCase()}/${targetRepository.owner.toLowerCase()}/${targetRepository.repository.toLowerCase()}/${segment}/${parsed.number}`,
    };
  } catch {
    return undefined;
  }
}

/** Canonicalizes one provider URL only when it identifies its durable reference. */
export function canonicalPullRequestUrl(
  prUrl: string,
  reference: import("./pull-requests.ts").PullRequestReference,
): string | undefined {
  const canonical = parseCanonicalPullRequestUrl(
    prUrl,
    reference.targetRepository,
  );
  return canonical?.reference.number === reference.number
    ? canonical.url
    : undefined;
}

export function pullRequestUrlMatchesReference(
  prUrl: string,
  reference: import("./pull-requests.ts").PullRequestReference,
): boolean {
  return canonicalPullRequestUrl(prUrl, reference) !== undefined;
}

export function sameCanonicalUrl(left: string, right: string): boolean {
  const parseReference = (url: string) => {
    for (const [provider, segment] of [
      ["github-gh", "pull"],
      ["forgejo-tea", "pulls"],
    ] as const) {
      try {
        return { provider, parsed: parsePullRequestUrl(url, segment) };
      } catch {
        // Try the other supported provider shape.
      }
    }
    return undefined;
  };
  const a = parseReference(left);
  const b = parseReference(right);
  if (!a || !b || a.provider !== b.provider) return false;
  return (
    a.parsed.protocol === b.parsed.protocol &&
    a.parsed.number === b.parsed.number &&
    sameRepositoryIdentity(
      {
        provider: a.provider,
        host: `${a.parsed.hostname}${a.parsed.port ? `:${a.parsed.port}` : ""}`,
        owner: a.parsed.owner,
        repository: a.parsed.repository,
      },
      {
        provider: b.provider,
        host: `${b.parsed.hostname}${b.parsed.port ? `:${b.parsed.port}` : ""}`,
        owner: b.parsed.owner,
        repository: b.parsed.repository,
      },
    )
  );
}
