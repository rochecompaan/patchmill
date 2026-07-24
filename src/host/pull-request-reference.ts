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
export function pullRequestNumber(prUrl: string, pathSegment: string): number {
  const url = parse(prUrl);
  const parts = url?.pathname.split("/").filter(Boolean);
  if (
    !url ||
    !parts ||
    parts.length !== 4 ||
    parts[2] !== pathSegment ||
    !/^[1-9]\d*$/u.test(parts[3])
  )
    throw new Error(`Invalid pull request URL: ${prUrl}`);
  return Number(parts[3]);
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
