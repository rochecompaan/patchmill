import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_VISUAL_EVIDENCE_REFERENCE_DIR,
  validateVisualEvidenceReferences,
} from "./visual-evidence.ts";
import type { AgentIssueVisualEvidence, CommandRunner } from "./types.ts";

const MINIMAL_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);

type GitResponse = { code: number; stdout?: string; stderr?: string };

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-visual-evidence-"));
}

async function writeScreenshot(
  root: string,
  relativePath: string,
): Promise<void> {
  const fullPath = join(root, relativePath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, MINIMAL_PNG_BYTES);
}

function gitRunner(
  responses: GitResponse[],
): CommandRunner & { calls: string[] } {
  const calls: string[] = [];
  let index = 0;
  return {
    calls,
    async run(command, args) {
      calls.push([command, ...args].join(" "));
      const response = responses[index] ?? { code: 0 };
      index += 1;
      return {
        code: response.code,
        stdout: response.stdout ?? "",
        stderr: response.stderr ?? "",
      };
    },
  };
}

test("validateVisualEvidenceReferences accepts committed reference screenshots", async () => {
  const repoRoot = await tempRoot();
  await writeScreenshot(repoRoot, "docs/screenshots/dashboard.png");
  const runner = gitRunner([
    { code: 0, stdout: "docs/screenshots/dashboard.png\n" },
    { code: 0 },
    { code: 0 },
  ]);
  const events: string[] = [];
  const evidence: AgentIssueVisualEvidence[] = [
    {
      screenshotPath: "docs/screenshots/dashboard.png",
      caption: "Dashboard reference screenshot",
    },
  ];

  const validated = await validateVisualEvidenceReferences({
    repoRoot,
    evidence,
    runner,
    referenceScreenshotPaths: [DEFAULT_VISUAL_EVIDENCE_REFERENCE_DIR],
    onProgress: async (message) => events.push(message),
  });

  assert.deepEqual(validated, evidence);
  assert.deepEqual(events, [
    "validated 1 committed visual evidence reference screenshot",
  ]);
  assert.deepEqual(runner.calls, [
    "git ls-tree -r --name-only HEAD -- docs/screenshots/dashboard.png",
    "git diff --quiet -- docs/screenshots/dashboard.png",
    "git diff --cached --quiet -- docs/screenshots/dashboard.png",
  ]);
});

test("validateVisualEvidenceReferences rejects temporary screenshot paths", async () => {
  const repoRoot = await tempRoot();
  await writeScreenshot(repoRoot, ".tmp/dashboard.png");

  await assert.rejects(
    validateVisualEvidenceReferences({
      repoRoot,
      evidence: [{ screenshotPath: ".tmp/dashboard.png" }],
      runner: gitRunner([]),
      referenceScreenshotPaths: [DEFAULT_VISUAL_EVIDENCE_REFERENCE_DIR],
    }),
    /Visual evidence must be a committed reference screenshot under docs\/screenshots/u,
  );
});

test("validateVisualEvidenceReferences rejects screenshots missing from HEAD", async () => {
  const repoRoot = await tempRoot();
  await writeScreenshot(repoRoot, "docs/screenshots/dashboard.png");
  const runner = gitRunner([{ code: 0, stdout: "" }]);

  await assert.rejects(
    validateVisualEvidenceReferences({
      repoRoot,
      evidence: [{ screenshotPath: "docs/screenshots/dashboard.png" }],
      runner,
      referenceScreenshotPaths: [DEFAULT_VISUAL_EVIDENCE_REFERENCE_DIR],
    }),
    /Visual evidence screenshot is not committed in HEAD: docs\/screenshots\/dashboard\.png/u,
  );
});

test("validateVisualEvidenceReferences rejects committed screenshots with uncommitted changes", async () => {
  const repoRoot = await tempRoot();
  await writeScreenshot(repoRoot, "docs/screenshots/dashboard.png");
  const runner = gitRunner([
    { code: 0, stdout: "docs/screenshots/dashboard.png\n" },
    { code: 1 },
  ]);

  await assert.rejects(
    validateVisualEvidenceReferences({
      repoRoot,
      evidence: [{ screenshotPath: "docs/screenshots/dashboard.png" }],
      runner,
      referenceScreenshotPaths: [DEFAULT_VISUAL_EVIDENCE_REFERENCE_DIR],
    }),
    /Visual evidence screenshot has uncommitted changes: docs\/screenshots\/dashboard\.png/u,
  );
});
