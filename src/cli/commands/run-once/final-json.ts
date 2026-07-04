function fencedJsonBody(stdout: string): string {
  const trimmed = stdout.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```\s*$/u);
  return fenced ? fenced[1] : trimmed;
}

export function finalJsonCandidates(stdout: string): Record<string, unknown>[] {
  const body = fencedJsonBody(stdout);
  const end = body.lastIndexOf("}");
  if (end < 0) return [];

  const candidates: Record<string, unknown>[] = [];
  for (
    let start = body.lastIndexOf("{", end);
    start >= 0;
    start = start === 0 ? -1 : body.lastIndexOf("{", start - 1)
  ) {
    try {
      candidates.push(
        JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>,
      );
    } catch {
      // The scanner tries every candidate opening brace before the final `}`;
      // malformed slices are expected until the complete final object is found.
      continue;
    }
  }

  return candidates;
}
