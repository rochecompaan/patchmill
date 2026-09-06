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
