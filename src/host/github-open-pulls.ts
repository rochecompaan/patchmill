import type { PullRequest } from "./types.ts";

type RawPull = {
  number: number;
  html_url: string;
  state: string;
  draft: boolean;
  body: string | null;
  head: { ref: string; repo: { full_name: string } | null };
  base: { ref: string };
};

/** gh --paginate --slurp returns an array of REST response pages. */
export function parseGitHubOpenPullRequests(text: string): PullRequest[] {
  const pages = JSON.parse(text) as RawPull[][];
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page)))
    throw new Error("gh returned invalid open pull request pages");
  return pages.flat().map((raw) => {
    if (
      !Number.isSafeInteger(raw.number) ||
      raw.number < 1 ||
      raw.state !== "open" ||
      typeof raw.html_url !== "string" ||
      typeof raw.head?.ref !== "string" ||
      typeof raw.base?.ref !== "string" ||
      !(raw.head.repo === null || typeof raw.head.repo?.full_name === "string")
    )
      throw new Error("gh returned invalid open pull request fields");
    return {
      number: raw.number,
      url: raw.html_url,
      state: "open",
      draft: raw.draft === true,
      body: raw.body ?? "",
      headRepository: raw.head.repo?.full_name ?? null,
      headBranch: raw.head.ref,
      baseBranch: raw.base.ref,
    };
  });
}
