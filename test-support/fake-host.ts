import { readFileSync, writeFileSync } from "node:fs";
import type {
  Host,
  Issue,
  IssueDependency,
  LabelDefinition,
  PullRequest,
  Repository,
} from "../src/host/types.ts";

export type FakeHostState = {
  repository: Repository;
  /** owner/repo of origin; defaults to the repository, unlike a fork clone. */
  pushRepository?: string;
  issues: Issue[];
  dependencies: Record<string, IssueDependency[]>;
  labels: string[];
  pullRequests: PullRequest[];
  calls: string[];
};

export function writeFakeHostState(
  stateFile: string,
  state: Partial<FakeHostState>,
): void {
  writeFileSync(
    stateFile,
    JSON.stringify({
      repository: { owner: "fixture", repo: "repo", defaultBranch: "main" },
      issues: [],
      dependencies: {},
      labels: [],
      pullRequests: [],
      calls: [],
      ...state,
    }),
  );
}

export class FakeHost implements Host {
  private stateFile: string;

  constructor(stateFile: string) {
    this.stateFile = stateFile;
  }

  state(): FakeHostState {
    return JSON.parse(readFileSync(this.stateFile, "utf8"));
  }

  private call<T>(name: string, operation: (state: FakeHostState) => T): T {
    const state = this.state();
    state.calls.push(name);
    try {
      return operation(state);
    } finally {
      writeFakeHostState(this.stateFile, state);
    }
  }

  private issue(state: FakeHostState, n: number): Issue {
    const issue = state.issues.find((issue) => issue.number === n);
    if (!issue) throw new Error(`Issue ${n} was not found`);
    return issue;
  }

  async checkCli() {
    return this.call("checkCli", () => ({
      ok: true,
      message: "Fake host is ready",
      login: "owner",
    }));
  }

  async repository() {
    return this.call("repository", (state) => state.repository);
  }

  async listOpenIssues() {
    return this.call("listOpenIssues", (state) =>
      state.issues.filter((issue) => issue.state === "open"),
    );
  }

  async listIssuesSince(since?: string) {
    return this.call(`listIssuesSince:${since ?? ""}`, (state) =>
      state.issues.map((issue) => ({ ...issue, comments: [] })),
    );
  }

  async listCommentsSince(since?: string) {
    return this.call(`listCommentsSince:${since ?? ""}`, (state) =>
      state.issues.flatMap((issue) =>
        issue.comments.map((comment, index) => ({
          ...comment,
          issue: issue.number,
          url: comment.url ?? `${issue.url}#c${index}`,
        })),
      ),
    );
  }

  async viewIssue(n: number) {
    return this.call(`viewIssue:${n}`, (state) => this.issue(state, n));
  }

  async listIssueDependencies(n: number): Promise<IssueDependency[]> {
    return this.call(`listIssueDependencies:${n}`, (state) =>
      (state.dependencies?.[n] ?? []).map((dependency) => {
        const local =
          dependency.repository.toLowerCase() ===
          `${state.repository.owner}/${state.repository.repo}`.toLowerCase()
            ? state.issues.find((issue) => issue.number === dependency.number)
            : undefined;
        return { ...dependency, state: local?.state ?? dependency.state };
      }),
    );
  }

  async addIssueDependency(n: number, blocker: number): Promise<void> {
    this.call(`addIssueDependency:${n}:${blocker}`, (state) => {
      const issue = this.issue(state, blocker);
      const repository = `${state.repository.owner}/${state.repository.repo}`;
      const links = (state.dependencies ??= {});
      const dependencies = (links[n] ??= []);
      if (
        !dependencies.some(
          (link) =>
            link.number === blocker &&
            link.repository.toLowerCase() === repository.toLowerCase(),
        )
      )
        dependencies.push({ repository, number: blocker, state: issue.state });
    });
  }

  async listLabels() {
    return this.call("listLabels", (state) => state.labels);
  }

  async createLabel(label: LabelDefinition) {
    this.call(`createLabel:${label.name}`, (state) => {
      if (!state.labels.includes(label.name)) state.labels.push(label.name);
    });
  }

  async setLabels(n: number, add: string[], remove: string[]) {
    this.call(`setLabels:${n}`, (state) => {
      const issue = this.issue(state, n);
      issue.labels = [
        ...new Set([
          ...issue.labels.filter((label) => !remove.includes(label)),
          ...add,
        ]),
      ];
    });
  }

  async commentIssue(n: number, body: string) {
    return this.call(`commentIssue:${n}`, (state) => {
      const issue = this.issue(state, n);
      const url = `${issue.url}#c${issue.comments.length}`;
      issue.comments.push({
        url,
        author: "owner",
        body,
        createdAt: new Date().toISOString(),
      });
      return url;
    });
  }

  async updatePullRequestBody(n: number, body: string) {
    this.call(`updatePullRequestBody:${n}`, (state) => {
      const pr = state.pullRequests.find((pr) => pr.number === n);
      if (!pr) throw new Error(`Pull request ${n} was not found`);
      pr.body = body;
    });
  }

  async pushRepository() {
    return this.call(
      "pushRepository",
      (state) =>
        state.pushRepository ??
        `${state.repository.owner}/${state.repository.repo}`,
    );
  }

  async listPullRequests(branch: string) {
    return this.call(`listPullRequests:${branch}`, (state) =>
      state.pullRequests.filter((pr) => pr.headBranch === branch),
    );
  }
}
