import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "./args.ts";

test("parseArgs requires provider", () => {
  assert.throws(
    () => parseArgs(["--repo", "OWNER/REPO"]),
    /--provider is required/,
  );
});

test("parseArgs requires repo", () => {
  assert.throws(
    () => parseArgs(["--provider", "github-gh"]),
    /--repo OWNER\/REPO is required/,
  );
});

test("parseArgs rejects unsupported providers", () => {
  assert.throws(
    () => parseArgs(["--provider", "gitlab", "--repo", "OWNER/REPO"]),
    /Unsupported provider: gitlab/,
  );
});

test("parseArgs rejects malformed repositories", () => {
  assert.throws(
    () => parseArgs(["--provider", "github-gh", "--repo", "OWNER"]),
    /--repo must use OWNER\/REPO/,
  );
});

test("parseArgs parses GitHub target", () => {
  assert.deepEqual(
    parseArgs(["--provider", "github-gh", "--repo", "OWNER/REPO"]),
    {
      showHelp: false,
      provider: "github-gh",
      target: { owner: "OWNER", repo: "REPO", slug: "OWNER/REPO" },
      reset: false,
    },
  );
});

test("parseArgs parses Forgejo login and reset", () => {
  assert.deepEqual(
    parseArgs([
      "--provider=forgejo-tea",
      "--repo=team/lunch",
      "--login",
      "demo-login",
      "--reset",
    ]),
    {
      showHelp: false,
      provider: "forgejo-tea",
      target: { owner: "team", repo: "lunch", slug: "team/lunch" },
      login: "demo-login",
      reset: true,
    },
  );
});

test("parseArgs rejects GitHub login", () => {
  assert.throws(
    () =>
      parseArgs([
        "--provider",
        "github-gh",
        "--repo",
        "OWNER/REPO",
        "--login",
        "unused",
      ]),
    /--login is only supported with forgejo-tea/,
  );
});

test("parseArgs returns help without requiring provider or repo", () => {
  assert.deepEqual(parseArgs(["--help"]), {
    showHelp: true,
    reset: false,
  });
});
