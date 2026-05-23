import test from "node:test";
import assert from "node:assert/strict";
import { defaultVisualEvidenceUploader, uploadPrVisualEvidence } from "./visual-evidence.ts";
import type { AgentIssueVisualEvidence } from "./types.ts";
import type { VisualEvidenceUploader } from "../../src/host/visual-evidence.ts";

test("uploadPrVisualEvidence keeps evidence when no uploader is configured", async () => {
  const events: string[] = [];
  const evidence: AgentIssueVisualEvidence[] = [
    {
      screenshotPath: ".tmp/dashboard.png",
      caption: "Dashboard after selecting last 8 weeks",
      referencePaths: ["docs/reference-screenshots/web/01-dashboard.png"],
    },
  ];

  const uploaded = await uploadPrVisualEvidence({
    repoRoot: "/repo",
    prUrl: "https://forgejo.example/owner/patchmill/pulls/77",
    evidence,
    onProgress: async (message) => {
      events.push(message);
    },
  });

  assert.deepEqual(uploaded, evidence);
  assert.deepEqual(events, ["visual evidence present but no uploader configured; skipping host asset upload"]);
});

test("defaultVisualEvidenceUploader treats blank primary env vars as absent and falls back to Croprun compatibility env", () => {
  const uploader = defaultVisualEvidenceUploader({
    runner: {
      async run() {
        return { code: 0, stdout: "", stderr: "" };
      },
    },
    env: {
      PATCHMILL_FORGEJO_URL: "   ",
      PATCHMILL_FORGEJO_TOKEN: "",
      CROPRUN_AGENT_ISSUE_FORGEJO_URL: "https://forgejo.example",
      CROPRUN_AGENT_ISSUE_FORGEJO_TOKEN: "compat-token",
    },
  });

  assert.ok(uploader);
});

test("uploadPrVisualEvidence delegates to the configured uploader", async () => {
  const evidence: AgentIssueVisualEvidence[] = [
    {
      screenshotPath: ".tmp/dashboard.png",
      caption: "Dashboard after selecting last 8 weeks",
      referencePaths: ["docs/reference-screenshots/web/01-dashboard.png"],
    },
  ];

  let received: Parameters<VisualEvidenceUploader["uploadPrEvidence"]>[0] | undefined;
  const uploader: VisualEvidenceUploader = {
    async uploadPrEvidence(input) {
      received = input;
      return input.evidence?.map((entry) => ({ ...entry, url: `https://forgejo.example/${entry.screenshotPath}` })) ?? [];
    },
  };

  const uploaded = await uploadPrVisualEvidence({
    repoRoot: "/repo",
    prUrl: "https://forgejo.example/owner/patchmill/pulls/77",
    evidence,
    uploader,
  });

  assert.deepEqual(received, {
    repoRoot: "/repo",
    prUrl: "https://forgejo.example/owner/patchmill/pulls/77",
    evidence,
  });
  assert.deepEqual(uploaded, [
    {
      screenshotPath: ".tmp/dashboard.png",
      caption: "Dashboard after selecting last 8 weeks",
      referencePaths: ["docs/reference-screenshots/web/01-dashboard.png"],
      url: "https://forgejo.example/.tmp/dashboard.png",
    },
  ]);
});
