import assert from "node:assert/strict";
import { test } from "node:test";
import type { Host, PullRequest } from "../host/types.ts";
import { findPullRequest } from "./pull-request.ts";

const pr = (fields: Partial<PullRequest>): PullRequest => ({
  number: 1,
  url: "https://example.invalid/pulls/1",
  state: "open",
  draft: false,
  body: "",
  headRepository: "me/repo",
  headBranch: "agent/issue-9-x",
  baseBranch: "main",
  ...fields,
});

function host(pullRequests: PullRequest[], pushRepository = "me/repo") {
  const listed: string[] = [];
  return {
    listed,
    host: {
      pushRepository: async () => pushRepository,
      listPullRequests: async (branch: string) => {
        listed.push(branch);
        return pullRequests;
      },
    } as Pick<Host, "pushRepository" | "listPullRequests"> as Host,
  };
}

test("findPullRequest ignores a same-named head from another repository", async () => {
  const outsider = pr({ number: 2, headRepository: "outsider/repo" });
  const ours = pr({ number: 3, state: "merged" });
  const { host: h, listed } = host([outsider, ours]);
  assert.equal(await findPullRequest(h, "agent/issue-9-x", "main"), ours);
  assert.deepEqual(listed, ["agent/issue-9-x"]);
  assert.equal(
    await findPullRequest(host([outsider]).host, "agent/issue-9-x", "main"),
    undefined,
  );
});

test("findPullRequest accepts a fork head pushed from origin", async () => {
  const fork = pr({ headRepository: "Me/Repo" });
  assert.equal(
    await findPullRequest(
      host([fork], "me/repo").host,
      "agent/issue-9-x",
      "main",
    ),
    fork,
  );
});

test("findPullRequest ignores deleted head repositories and other branches", async () => {
  const { host: h } = host([
    pr({ headRepository: null }),
    pr({ headBranch: "agent/issue-9-other" }),
  ]);
  assert.equal(await findPullRequest(h, "agent/issue-9-x", "main"), undefined);
});

test("findPullRequest prefers open, then merged, then closed, whatever the base", async () => {
  const closed = pr({ number: 1, state: "closed" });
  const merged = pr({ number: 2, state: "merged" });
  const open = pr({ number: 3, state: "open", baseBranch: "release" });
  const find = (prs: PullRequest[]) =>
    findPullRequest(host(prs).host, "agent/issue-9-x", "main");
  assert.equal(await find([closed, merged, open]), open);
  assert.equal(await find([closed, merged]), merged);
  assert.equal(await find([closed]), closed);
});

test("findPullRequest prefers a replacement into the base within a state", async () => {
  const mistargeted = pr({ number: 1, state: "merged", baseBranch: "release" });
  const replacement = pr({ number: 2, state: "merged" });
  const find = (prs: PullRequest[]) =>
    findPullRequest(host(prs).host, "agent/issue-9-x", "main");
  assert.equal(await find([mistargeted, replacement]), replacement);
  assert.equal(await find([mistargeted]), mistargeted);
});
