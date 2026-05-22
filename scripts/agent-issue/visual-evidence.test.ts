import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadPrVisualEvidence } from "./visual-evidence.ts";
import type { AgentIssueVisualEvidence, CommandRunner } from "./types.ts";

function createGitRunner(remoteUrl: string): CommandRunner {
  return {
    async run(command, args, options = {}) {
      assert.equal(command, "git");
      assert.deepEqual(args, ["config", "--get", "remote.origin.url"]);
      assert.equal(options.cwd, options.cwd);
      return { code: 0, stdout: `${remoteUrl}\n`, stderr: "" };
    },
  };
}

test("uploadPrVisualEvidence uploads screenshots and posts a PR comment with uploaded URLs", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "visual-evidence-"));
  await mkdir(join(repoRoot, ".tmp"), { recursive: true });
  await writeFile(join(repoRoot, ".tmp", "dashboard.png"), "png bytes", "utf8");

  const requests: Array<{ url: string; method?: string; body: unknown }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push({ url: String(url), method: init?.method, body: init?.body });
    if (String(url).endsWith("/assets")) {
      assert.equal(init?.method, "POST");
      assert.equal(init?.headers instanceof Headers ? init.headers.get("Authorization") : undefined, "token secret-token");
      assert.ok(init?.body instanceof FormData);
      return Response.json({
        name: "dashboard.png",
        browser_download_url: "https://forgejo.example/attachments/dashboard.png",
      });
    }
    assert.equal(String(url), "https://forgejo.example/api/v1/repos/owner/croprun/issues/77/comments");
    assert.equal(init?.method, "POST");
    assert.equal(init?.headers instanceof Headers ? init.headers.get("Content-Type") : undefined, "application/json");
    const payload = JSON.parse(String(init?.body));
    assert.match(payload.body, /Visual evidence/);
    assert.match(payload.body, /!\[Dashboard after selecting last 8 weeks\]\(https:\/\/forgejo\.example\/attachments\/dashboard\.png\)/);
    assert.match(payload.body, /Reference: `docs\/reference-screenshots\/web\/01-dashboard\.png`/);
    return Response.json({ id: 123 });
  };

  const evidence: AgentIssueVisualEvidence[] = [
    {
      screenshotPath: ".tmp/dashboard.png",
      caption: "Dashboard after selecting last 8 weeks",
      referencePaths: ["docs/reference-screenshots/web/01-dashboard.png"],
    },
  ];

  const uploaded = await uploadPrVisualEvidence({
    runner: createGitRunner("https://forgejo.example/owner/croprun.git"),
    repoRoot,
    prUrl: "https://forgejo.example/owner/croprun/pulls/77",
    evidence,
    env: {
      CROPRUN_AGENT_ISSUE_FORGEJO_URL: "https://forgejo.example",
      CROPRUN_AGENT_ISSUE_FORGEJO_TOKEN: "secret-token",
    },
    fetchImpl,
  });

  assert.deepEqual(uploaded, [
    {
      screenshotPath: ".tmp/dashboard.png",
      caption: "Dashboard after selecting last 8 weeks",
      referencePaths: ["docs/reference-screenshots/web/01-dashboard.png"],
      url: "https://forgejo.example/attachments/dashboard.png",
    },
  ]);
  assert.equal(requests.length, 2);
});

test("uploadPrVisualEvidence rejects evidence when Forgejo upload config is missing", async () => {
  await assert.rejects(
    () =>
      uploadPrVisualEvidence({
        runner: createGitRunner("https://forgejo.example/owner/croprun.git"),
        repoRoot: "/repo",
        prUrl: "https://forgejo.example/owner/croprun/pulls/77",
        evidence: [{ screenshotPath: ".tmp/dashboard.png" }],
        env: {},
        fetchImpl: async () => Response.json({}),
      }),
    /CROPRUN_AGENT_ISSUE_FORGEJO_URL and CROPRUN_AGENT_ISSUE_FORGEJO_TOKEN/,
  );
});
