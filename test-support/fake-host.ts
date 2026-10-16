import { readFileSync, writeFileSync } from "node:fs";
import type {
  Host,
  Issue,
  LabelDefinition,
  PullRequest,
  Repository,
} from "../src/host/types.ts";

export type FakeHostState = {
  repository: Repository;
  issues: Issue[];
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

  async viewIssue(n: number) {
    return this.call(`viewIssue:${n}`, (state) => this.issue(state, n));
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
    this.call(`commentIssue:${n}`, (state) => {
      this.issue(state, n).comments.push({
        author: "fake-host",
        body,
        createdAt: new Date().toISOString(),
      });
    });
  }

  async findPullRequestByHead(branch: string) {
    return this.call(`findPullRequestByHead:${branch}`, (state) =>
      state.pullRequests.find((pr) => pr.headBranch === branch),
    );
  }
}
