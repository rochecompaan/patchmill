import { withTeaContext } from "../../../host/forgejo-tea-context.ts";
import type {
  CommandRunner,
  IssueCommentSummary,
  IssueSummary,
  LabelChangePlan,
  LabelDefinition,
} from "./types.ts";

const ISSUE_PAGE_SIZE = 1000;
const COMMENT_PAGE_SIZE = 1000;
const ISSUE_FIELDS =
  "index,title,body,state,labels,author,created,updated,comments,url";

function parseJson(stdout: string, context: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `${context} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
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
      if (
        label &&
        typeof label === "object" &&
        "name" in label &&
        typeof label.name === "string"
      )
        return label.name;
      throw new Error(`Unexpected label payload: ${JSON.stringify(label)}`);
    })
    .sort((a, b) => a.localeCompare(b));
}

function issueNumber(value: unknown): number | undefined {
  if (Number.isInteger(value) && Number(value) > 0) return Number(value);
  if (typeof value === "string" && /^[1-9]\d*$/.test(value))
    return Number(value);
  return undefined;
}

function authorName(author: unknown): string | undefined {
  if (typeof author === "string") return author;
  if (
    author &&
    typeof author === "object" &&
    "login" in author &&
    typeof author.login === "string"
  )
    return author.login;
  return undefined;
}

function issueCreated(issue: Record<string, unknown>): string | undefined {
  for (const field of ["created", "createdAt", "created_at"]) {
    const value = issue[field];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function parseIssueComment(comment: unknown): IssueCommentSummary | undefined {
  if (!comment || typeof comment !== "object") return undefined;
  const entry = comment as Record<string, unknown>;
  if (typeof entry.body !== "string") return undefined;

  const parsed: IssueCommentSummary = { body: entry.body };
  const authorLogin = authorName(
    entry.author ?? entry.authorLogin ?? entry.user,
  );
  if (authorLogin !== undefined) parsed.authorLogin = authorLogin;
  for (const field of ["created", "createdAt", "created_at"]) {
    const value = entry[field];
    if (typeof value === "string") {
      parsed.created = value;
      break;
    }
  }
  return parsed;
}

function issueComments(comments: unknown): IssueCommentSummary[] | undefined {
  if (!Array.isArray(comments)) return undefined;
  return comments.flatMap((comment) => {
    const parsed = parseIssueComment(comment);
    return parsed ? [parsed] : [];
  });
}

function parseIssuePayload(entry: unknown): IssueSummary {
  if (!entry || typeof entry !== "object")
    throw new Error(`Unexpected issue payload: ${JSON.stringify(entry)}`);
  const issue = entry as Record<string, unknown>;
  const number = issueNumber(issue.index);
  if (number === undefined || typeof issue.title !== "string") {
    throw new Error(`Unexpected issue payload: ${JSON.stringify(entry)}`);
  }

  const parsedIssue: IssueSummary = {
    number,
    title: issue.title,
    body: typeof issue.body === "string" ? issue.body : "",
    state: typeof issue.state === "string" ? issue.state : "open",
    labels: labelNames(issue.labels),
    author: authorName(issue.author),
    created: issueCreated(issue),
    updated: typeof issue.updated === "string" ? issue.updated : undefined,
    comments: issueComments(issue.comments),
  };

  if (typeof issue.url === "string") parsedIssue.url = issue.url;
  if (typeof issue.html_url === "string" && !parsedIssue.url) {
    parsedIssue.url = issue.html_url;
  }

  return parsedIssue;
}

type IssueCommentPage = {
  comments: IssueCommentSummary[];
  rawCount: number;
};

async function fetchIssueCommentPage(
  runner: CommandRunner,
  repoRoot: string,
  issueNumber: number,
  page: number,
  teaLogin?: string,
): Promise<IssueCommentPage> {
  const endpoint = `/repos/{owner}/{repo}/issues/${issueNumber}/comments?page=${page}&limit=${COMMENT_PAGE_SIZE}`;
  const result = await runner.run(
    "tea",
    withTeaContext(["api", endpoint], repoRoot, teaLogin),
    { cwd: repoRoot },
  );
  if (result.code !== 0) {
    throw new Error(
      `tea issue comments API failed for #${issueNumber}: ${result.stderr || result.stdout}`,
    );
  }

  const parsed = parseJson(result.stdout, "tea issue comments API");
  if (!Array.isArray(parsed)) {
    throw new Error("tea issue comments API returned a non-array payload");
  }

  return {
    rawCount: parsed.length,
    comments: parsed.flatMap((entry) => {
      const comment = parseIssueComment(entry);
      return comment ? [comment] : [];
    }),
  };
}

async function fetchIssueComments(
  runner: CommandRunner,
  repoRoot: string,
  issueNumber: number,
  teaLogin?: string,
): Promise<IssueCommentSummary[]> {
  const comments: IssueCommentSummary[] = [];

  for (let page = 1; ; page += 1) {
    const pageResult = await fetchIssueCommentPage(
      runner,
      repoRoot,
      issueNumber,
      page,
      teaLogin,
    );
    comments.push(...pageResult.comments);
    if (pageResult.rawCount < COMMENT_PAGE_SIZE) break;
  }

  return comments;
}

export async function hydrateIssueComments(
  runner: CommandRunner,
  repoRoot: string,
  issues: IssueSummary[],
  teaLogin?: string,
): Promise<void> {
  for (const issue of issues) {
    issue.comments = await fetchIssueComments(
      runner,
      repoRoot,
      issue.number,
      teaLogin,
    );
  }
}

async function listIssuePage(
  runner: CommandRunner,
  repoRoot: string,
  state: "open" | "all",
  page: number,
  teaLogin?: string,
  keyword?: string,
): Promise<IssueSummary[]> {
  const args = [
    "issues",
    "list",
    "--state",
    state,
    "--fields",
    ISSUE_FIELDS,
    "--page",
    String(page),
    "--limit",
    String(ISSUE_PAGE_SIZE),
    "--output",
    "json",
  ];
  if (keyword) args.push("--keyword", keyword);

  const result = await runner.run(
    "tea",
    withTeaContext(args, repoRoot, teaLogin),
    { cwd: repoRoot },
  );
  if (result.code !== 0)
    throw new Error(
      `tea issues list failed: ${result.stderr || result.stdout}`,
    );
  const parsed = parseJson(result.stdout, "tea issues list");
  if (!Array.isArray(parsed))
    throw new Error("tea issues list returned a non-array payload");

  return parsed.map((entry) => parseIssuePayload(entry));
}

async function listIssuesByState(
  runner: CommandRunner,
  repoRoot: string,
  state: "open" | "all",
  teaLogin?: string,
): Promise<IssueSummary[]> {
  const issues: IssueSummary[] = [];

  for (let page = 1; ; page += 1) {
    const pageIssues = await listIssuePage(
      runner,
      repoRoot,
      state,
      page,
      teaLogin,
    );

    if (pageIssues.length === 0) break;
    issues.push(...pageIssues);
  }

  return issues.sort((a, b) => a.number - b.number);
}

export async function listOpenIssues(
  runner: CommandRunner,
  repoRoot: string,
  teaLogin?: string,
): Promise<IssueSummary[]> {
  return listIssuesByState(runner, repoRoot, "open", teaLogin);
}

export async function viewIssue(
  runner: CommandRunner,
  repoRoot: string,
  issueNumber: number,
  teaLogin?: string,
): Promise<IssueSummary> {
  for (let page = 1; ; page += 1) {
    const pageIssues = await listIssuePage(
      runner,
      repoRoot,
      "all",
      page,
      teaLogin,
      String(issueNumber),
    );
    const issue = pageIssues.find((entry) => entry.number === issueNumber);
    if (issue) return issue;
    if (pageIssues.length === 0) break;
  }

  throw new Error(`tea issue #${issueNumber} was not found`);
}

export async function listLabels(
  runner: CommandRunner,
  repoRoot: string,
  teaLogin?: string,
): Promise<string[]> {
  const result = await runner.run(
    "tea",
    withTeaContext(
      ["labels", "list", "--limit", "1000", "--output", "json"],
      repoRoot,
      teaLogin,
    ),
    { cwd: repoRoot },
  );
  if (result.code !== 0)
    throw new Error(
      `tea labels list failed: ${result.stderr || result.stdout}`,
    );
  const parsed = parseJson(result.stdout, "tea labels list");
  if (!Array.isArray(parsed))
    throw new Error("tea labels list returned a non-array payload");

  return parsed
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (
        entry &&
        typeof entry === "object" &&
        "name" in entry &&
        typeof entry.name === "string"
      )
        return entry.name;
      throw new Error(`Unexpected label payload: ${JSON.stringify(entry)}`);
    })
    .sort((a, b) => a.localeCompare(b));
}

export async function createLabel(
  runner: CommandRunner,
  repoRoot: string,
  label: LabelDefinition,
  teaLogin?: string,
): Promise<void> {
  const result = await runner.run(
    "tea",
    withTeaContext(
      [
        "labels",
        "create",
        "--name",
        label.name,
        "--color",
        label.color,
        "--description",
        label.description,
      ],
      repoRoot,
      teaLogin,
    ),
    { cwd: repoRoot },
  );
  if (result.code !== 0)
    throw new Error(
      `tea labels create failed for ${label.name}: ${result.stderr || result.stdout}`,
    );
}

export async function applyIssueLabels(
  runner: CommandRunner,
  repoRoot: string,
  change: LabelChangePlan,
  teaLogin?: string,
): Promise<void> {
  if (change.addLabels.length === 0 && change.removeLabels.length === 0) return;

  const args = ["issues", "edit", String(change.issueNumber)];
  if (change.removeLabels.length > 0) {
    args.push("--remove-labels", change.removeLabels.join(","));
  }
  if (change.addLabels.length > 0) {
    args.push("--add-labels", change.addLabels.join(","));
  }

  const result = await runner.run(
    "tea",
    withTeaContext(args, repoRoot, teaLogin),
    { cwd: repoRoot },
  );
  if (result.code !== 0) {
    throw new Error(
      `tea issues edit labels failed for #${change.issueNumber}: ${result.stderr || result.stdout}`,
    );
  }
}

export async function commentIssue(
  runner: CommandRunner,
  repoRoot: string,
  issueNumber: number,
  body: string,
  teaLogin?: string,
): Promise<void> {
  const result = await runner.run(
    "tea",
    withTeaContext(
      ["comment", String(issueNumber), "--", body],
      repoRoot,
      teaLogin,
    ),
    { cwd: repoRoot },
  );
  if (result.code !== 0)
    throw new Error(
      `tea comment failed for #${issueNumber}: ${result.stderr || result.stdout}`,
    );
}
