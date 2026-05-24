import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  ForgejoVisualEvidenceUploader,
  hasForgejoVisualEvidenceConfig,
} from "./forgejo-visual-evidence.ts";
import {
  LEGACY_FORGEJO_TOKEN_ENV,
  LEGACY_FORGEJO_URL_ENV,
} from "../../test-support/legacy-seed.ts";
import type { CommandRunner } from "../../scripts/agent-issue/types.ts";
import type { AgentIssueVisualEvidence } from "../../scripts/agent-issue/types.ts";

const MINIMAL_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

async function writeMinimalPng(path: string): Promise<void> {
  await writeFile(path, MINIMAL_PNG_BYTES);
}

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

test("ForgejoVisualEvidenceUploader uploads screenshots and posts a PR comment", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "forgejo-visual-evidence-"));
  await mkdir(join(repoRoot, ".tmp"), { recursive: true });
  await writeMinimalPng(join(repoRoot, ".tmp", "dashboard.png"));

  const requests: Array<{ url: string; method?: string; body: unknown }> = [];
  const fetchImpl = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    requests.push({ url: String(url), method: init?.method, body: init?.body });
    if (String(url).endsWith("/assets")) {
      assert.equal(init?.method, "POST");
      assert.equal(
        init?.headers instanceof Headers
          ? init.headers.get("Authorization")
          : undefined,
        "token secret-token",
      );
      assert.ok(init?.body instanceof FormData);
      return Response.json({
        name: "dashboard.png",
        browser_download_url:
          "https://forgejo.example/attachments/dashboard.png",
      });
    }
    assert.equal(
      String(url),
      "https://forgejo.example/api/v1/repos/owner/patchmill/issues/77/comments",
    );
    assert.equal(init?.method, "POST");
    assert.equal(
      init?.headers instanceof Headers
        ? init.headers.get("Content-Type")
        : undefined,
      "application/json",
    );
    const payload = JSON.parse(String(init?.body));
    assert.match(payload.body, /Visual evidence/);
    assert.match(
      payload.body,
      /!\[Dashboard after selecting last 8 weeks\]\(https:\/\/forgejo\.example\/attachments\/dashboard\.png\)/,
    );
    assert.match(
      payload.body,
      /Reference: docs\/visual-baselines\/web\/01-dashboard\.png/,
    );
    return Response.json({ id: 123 });
  };

  const evidence: AgentIssueVisualEvidence[] = [
    {
      screenshotPath: ".tmp/dashboard.png",
      caption: "Dashboard after selecting last 8 weeks",
      referencePaths: ["docs/visual-baselines/web/01-dashboard.png"],
    },
  ];

  const uploader = new ForgejoVisualEvidenceUploader({
    runner: createGitRunner("https://forgejo.example/owner/patchmill.git"),
    env: {
      PATCHMILL_FORGEJO_URL: "https://forgejo.example",
      PATCHMILL_FORGEJO_TOKEN: "secret-token",
    },
    fetchImpl,
  });

  const uploaded = await uploader.uploadPrEvidence({
    repoRoot,
    prUrl: "https://forgejo.example/owner/patchmill/pulls/77",
    evidence,
  });

  assert.deepEqual(uploaded, [
    {
      screenshotPath: ".tmp/dashboard.png",
      caption: "Dashboard after selecting last 8 weeks",
      referencePaths: ["docs/visual-baselines/web/01-dashboard.png"],
      url: "https://forgejo.example/attachments/dashboard.png",
    },
  ]);
  assert.equal(requests.length, 2);
});

test("ForgejoVisualEvidenceUploader ignores removed legacy env variables", async () => {
  assert.equal(
    hasForgejoVisualEvidenceConfig({
      [LEGACY_FORGEJO_URL_ENV]: "https://forgejo.example/",
      [LEGACY_FORGEJO_TOKEN_ENV]: "legacy-token",
    } as NodeJS.ProcessEnv),
    false,
  );
});

test("ForgejoVisualEvidenceUploader escapes attachment URLs for Markdown destinations", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "forgejo-visual-evidence-markdown-"),
  );
  await mkdir(join(repoRoot, ".tmp"), { recursive: true });
  await writeMinimalPng(join(repoRoot, ".tmp", "dashboard.png"));

  let commentBody = "";
  const uploader = new ForgejoVisualEvidenceUploader({
    runner: createGitRunner("https://forgejo.example/owner/patchmill.git"),
    env: {
      PATCHMILL_FORGEJO_URL: "https://forgejo.example",
      PATCHMILL_FORGEJO_TOKEN: "secret-token",
    },
    fetchImpl: async (url, init) => {
      if (String(url).endsWith("/assets")) {
        return Response.json({
          browser_download_url:
            "https://forgejo.example/attachments/dashboard(after image).png",
        });
      }
      commentBody = JSON.parse(String(init?.body)).body as string;
      return Response.json({ id: 987 });
    },
  });

  const uploaded = await uploader.uploadPrEvidence({
    repoRoot,
    prUrl: "https://forgejo.example/owner/patchmill/pulls/77",
    evidence: [
      {
        screenshotPath: ".tmp/dashboard.png",
        caption: "Dashboard after change",
      },
    ],
  });

  assert.deepEqual(uploaded, [
    {
      screenshotPath: ".tmp/dashboard.png",
      caption: "Dashboard after change",
      url: "https://forgejo.example/attachments/dashboard%28after%20image%29.png",
    },
  ]);
  assert.match(
    commentBody,
    /!\[Dashboard after change\]\(https:\/\/forgejo\.example\/attachments\/dashboard%28after%20image%29\.png\)/,
  );
});

test("ForgejoVisualEvidenceUploader rejects non-http attachment URLs returned by Forgejo", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "forgejo-visual-evidence-invalid-url-"),
  );
  await mkdir(join(repoRoot, ".tmp"), { recursive: true });
  await writeMinimalPng(join(repoRoot, ".tmp", "dashboard.png"));

  const uploader = new ForgejoVisualEvidenceUploader({
    runner: createGitRunner("https://forgejo.example/owner/patchmill.git"),
    env: {
      PATCHMILL_FORGEJO_URL: "https://forgejo.example",
      PATCHMILL_FORGEJO_TOKEN: "secret-token",
    },
    fetchImpl: async (url) => {
      if (String(url).endsWith("/assets")) {
        return Response.json({ browser_download_url: "javascript:alert(1)" });
      }
      return Response.json({ id: 654 });
    },
  });

  await assert.rejects(
    () =>
      uploader.uploadPrEvidence({
        repoRoot,
        prUrl: "https://forgejo.example/owner/patchmill/pulls/77",
        evidence: [{ screenshotPath: ".tmp/dashboard.png" }],
      }),
    /valid http\(s\) attachment URL/,
  );
});

test("ForgejoVisualEvidenceUploader rejects screenshots outside the repo root", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "forgejo-visual-evidence-outside-"),
  );
  const outsidePath = join(dirname(repoRoot), "outside.png");
  await writeMinimalPng(outsidePath);

  let fetchCalls = 0;
  const uploader = new ForgejoVisualEvidenceUploader({
    runner: createGitRunner("https://forgejo.example/owner/patchmill.git"),
    env: {
      PATCHMILL_FORGEJO_URL: "https://forgejo.example",
      PATCHMILL_FORGEJO_TOKEN: "secret-token",
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return Response.json({});
    },
  });

  for (const screenshotPath of [outsidePath, "../outside.png"]) {
    await assert.rejects(
      () =>
        uploader.uploadPrEvidence({
          repoRoot,
          prUrl: "https://forgejo.example/owner/patchmill/pulls/77",
          evidence: [{ screenshotPath }],
        }),
      /Visual evidence screenshot path must stay within the repo root/,
    );
  }

  assert.equal(fetchCalls, 0);
});

test("ForgejoVisualEvidenceUploader rejects symlink escapes outside the repo root", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "forgejo-visual-evidence-symlink-"),
  );
  await mkdir(join(repoRoot, ".tmp"), { recursive: true });
  const outsidePath = join(dirname(repoRoot), "outside-symlink.png");
  await writeMinimalPng(outsidePath);
  await symlink(outsidePath, join(repoRoot, ".tmp", "escape.png"));

  let fetchCalls = 0;
  const uploader = new ForgejoVisualEvidenceUploader({
    runner: createGitRunner("https://forgejo.example/owner/patchmill.git"),
    env: {
      PATCHMILL_FORGEJO_URL: "https://forgejo.example",
      PATCHMILL_FORGEJO_TOKEN: "secret-token",
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return Response.json({});
    },
  });

  await assert.rejects(
    () =>
      uploader.uploadPrEvidence({
        repoRoot,
        prUrl: "https://forgejo.example/owner/patchmill/pulls/77",
        evidence: [{ screenshotPath: ".tmp/escape.png" }],
      }),
    /Visual evidence screenshot path must stay within the repo root/,
  );

  assert.equal(fetchCalls, 0);
});

test("ForgejoVisualEvidenceUploader rejects evidence when Forgejo config is missing", async () => {
  const uploader = new ForgejoVisualEvidenceUploader({
    runner: createGitRunner("https://forgejo.example/owner/patchmill.git"),
    env: {},
    fetchImpl: async () => Response.json({}),
  });

  await assert.rejects(
    () =>
      uploader.uploadPrEvidence({
        repoRoot: "/repo",
        prUrl: "https://forgejo.example/owner/patchmill/pulls/77",
        evidence: [{ screenshotPath: ".tmp/dashboard.png" }],
      }),
    /PATCHMILL_FORGEJO_URL and PATCHMILL_FORGEJO_TOKEN/,
  );
});

test("ForgejoVisualEvidenceUploader rejects non-image screenshot paths such as .env", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "forgejo-visual-evidence-env-"),
  );
  await writeFile(
    join(repoRoot, ".env"),
    "PATCHMILL_FORGEJO_TOKEN=secret\n",
    "utf8",
  );

  let fetchCalls = 0;
  const uploader = new ForgejoVisualEvidenceUploader({
    runner: createGitRunner("https://forgejo.example/owner/patchmill.git"),
    env: {
      PATCHMILL_FORGEJO_URL: "https://forgejo.example",
      PATCHMILL_FORGEJO_TOKEN: "secret-token",
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return Response.json({});
    },
  });

  await assert.rejects(
    () =>
      uploader.uploadPrEvidence({
        repoRoot,
        prUrl: "https://forgejo.example/owner/patchmill/pulls/77",
        evidence: [{ screenshotPath: ".env" }],
      }),
    /Visual evidence screenshot must use one of \.png, \.jpg, \.jpeg, \.gif, \.webp: \.env/,
  );

  assert.equal(fetchCalls, 0);
});

test("ForgejoVisualEvidenceUploader rejects text files renamed with an image extension", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "forgejo-visual-evidence-fake-png-"),
  );
  await mkdir(join(repoRoot, ".tmp"), { recursive: true });
  await writeFile(
    join(repoRoot, ".tmp", "notes.png"),
    "not really an image",
    "utf8",
  );

  let fetchCalls = 0;
  const uploader = new ForgejoVisualEvidenceUploader({
    runner: createGitRunner("https://forgejo.example/owner/patchmill.git"),
    env: {
      PATCHMILL_FORGEJO_URL: "https://forgejo.example",
      PATCHMILL_FORGEJO_TOKEN: "secret-token",
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return Response.json({});
    },
  });

  await assert.rejects(
    () =>
      uploader.uploadPrEvidence({
        repoRoot,
        prUrl: "https://forgejo.example/owner/patchmill/pulls/77",
        evidence: [{ screenshotPath: ".tmp/notes.png" }],
      }),
    /Visual evidence screenshot must contain PNG, JPEG, GIF, or WebP image bytes: \.tmp\/notes\.png/,
  );

  assert.equal(fetchCalls, 0);
});

test("ForgejoVisualEvidenceUploader sanitizes model-supplied PR comment fields", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "forgejo-visual-evidence-sanitize-"),
  );
  await mkdir(join(repoRoot, ".tmp"), { recursive: true });
  await writeMinimalPng(join(repoRoot, ".tmp", "dashboard.png"));

  const requests: Array<{ url: string; body: unknown }> = [];
  const uploader = new ForgejoVisualEvidenceUploader({
    runner: createGitRunner("https://forgejo.example/owner/patchmill.git"),
    env: {
      PATCHMILL_FORGEJO_URL: "https://forgejo.example",
      PATCHMILL_FORGEJO_TOKEN: "secret-token",
    },
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), body: init?.body });
      if (String(url).endsWith("/assets")) {
        return Response.json({
          browser_download_url:
            "https://forgejo.example/attachments/dashboard.png",
        });
      }
      return Response.json({ id: 789 });
    },
  });

  await uploader.uploadPrEvidence({
    repoRoot,
    prUrl: "https://forgejo.example/owner/patchmill/pulls/77",
    evidence: [
      {
        screenshotPath: ".tmp/dashboard.png",
        caption:
          "Looks good\n- injected bullet\n[click me](https://evil.example) `inline code`",
        referencePaths: [
          "docs/reference.png\n## injected heading ![image](https://evil.example/img.png)",
        ],
      },
    ],
  });

  const commentRequest = requests.find((request) =>
    request.url.endsWith("/comments"),
  );
  assert.ok(commentRequest);
  const payload = JSON.parse(String(commentRequest.body)) as { body: string };
  assert.doesNotMatch(payload.body, /\n- injected bullet/);
  assert.doesNotMatch(payload.body, /\[click me\]\(https:\/\/evil\.example\)/);
  assert.doesNotMatch(payload.body, /\n## injected heading/);
  assert.doesNotMatch(
    payload.body,
    /!\[image\]\(https:\/\/evil\.example\/img\.png\)/,
  );
  assert.match(
    payload.body,
    /- Looks good - injected bullet \\\[click me\\\]\\\(https:\/\/evil\.example\\\) \\`inline code\\`/,
  );
  assert.match(
    payload.body,
    /- Reference: docs\/reference\.png \\#\\# injected heading \\!\\\[image\\\]\\\(https:\/\/evil\.example\/img\.png\\\)/,
  );
});
