import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewWaitMessage } from "./review-wait.ts";

test("the first message names the PR, the merger, continue, cleanup, changes and stop", () => {
  assert.equal(
    reviewWaitMessage({ url: "https://x/pr/1", issue: 9, recheck: false }),
    `Pull request ready for review: https://x/pr/1

- You review and merge the pull request. Patchmill does not check for the merge by itself.
- After the merge, tell me to continue. Patchmill then confirms the merge and removes the worktrees and branches of issue #9.
- If the pull request needs changes, tell me what to change. I make the changes on the issue branch and push them. The wait continues.
- To stop the wait, quit or pause the session. The next start of issue #9 continues the wait.`,
  );
});

test("the recheck message says the PR is not merged yet", () => {
  assert.equal(
    reviewWaitMessage({ url: "https://x/pr/1", issue: 9, recheck: true }),
    `Pull request https://x/pr/1 is not merged yet. The wait continues.

- Merge the pull request, then tell me to continue.
- If the pull request needs changes, tell me what to change.
- To stop the wait, quit or pause the session.`,
  );
});
