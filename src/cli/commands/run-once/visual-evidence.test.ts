import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultVisualEvidenceUploader,
  uploadPrVisualEvidence,
} from "./visual-evidence.ts";
import {
  LEGACY_FORGEJO_TOKEN_ENV,
  LEGACY_FORGEJO_URL_ENV,
} from "../../../../test-support/legacy-seed.ts";
import type { AgentIssueVisualEvidence } from "./types.ts";
import type { VisualEvidenceUploader } from "../../../host/visual-evidence.ts";

test("uploadPrVisualEvidence keeps evidence when no uploader is configured", async () => {
  const events: string[] = [];
  const evidence: AgentIssueVisualEvidence[] = [
    {
      screenshotPath: ".tmp/dashboard.png",
      caption: "Dashboard after selecting last 8 weeks",
      referencePaths: ["docs/visual-baselines/web/01-dashboard.png"],
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
  assert.deepEqual(events, [
    "visual evidence present but no uploader configured; skipping host asset upload",
  ]);
});

test("defaultVisualEvidenceUploader returns no uploader when only removed legacy env variables are set", () => {
  const uploader = defaultVisualEvidenceUploader({
    runner: {
      async run() {
        return { code: 0, stdout: "", stderr: "" };
      },
    },
    env: {
      [LEGACY_FORGEJO_URL_ENV]: "https://forgejo.example",
      [LEGACY_FORGEJO_TOKEN_ENV]: "compat-token",
    } as NodeJS.ProcessEnv,
  });

  assert.equal(uploader, undefined);
});

test("uploadPrVisualEvidence delegates to the configured uploader", async () => {
  const evidence: AgentIssueVisualEvidence[] = [
    {
      screenshotPath: ".tmp/dashboard.png",
      caption: "Dashboard after selecting last 8 weeks",
      referencePaths: ["docs/visual-baselines/web/01-dashboard.png"],
    },
  ];

  let received:
    | Parameters<VisualEvidenceUploader["uploadPrEvidence"]>[0]
    | undefined;
  const uploader: VisualEvidenceUploader = {
    async uploadPrEvidence(input) {
      received = input;
      return (
        input.evidence?.map((entry) => ({
          ...entry,
          url: `https://forgejo.example/${entry.screenshotPath}`,
        })) ?? []
      );
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
      referencePaths: ["docs/visual-baselines/web/01-dashboard.png"],
      url: "https://forgejo.example/.tmp/dashboard.png",
    },
  ]);
});
