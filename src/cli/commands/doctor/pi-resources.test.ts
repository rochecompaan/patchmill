import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  compactProfileBlock,
  formatPiResourceBlocks,
  loadDoctorPiResources,
  piResourceDiscoveryFailureCheck,
  piResourceWarningCheck,
} from "./pi-resources.ts";

const repoRoot = "/repo/project";

test("compactProfileBlock builds sorted compact sections", () => {
  const block = compactProfileBlock({
    label: "run-once planning",
    contextFiles: [join(repoRoot, "AGENTS.md")],
    skillNames: ["github", "brainstorming"],
    promptNames: ["review-loop", "parallel-review"],
    extensionPaths: [
      join(repoRoot, "extensions", "todos.ts"),
      join(repoRoot, "extensions", "pi-remote", "extension", "index.ts"),
    ],
    repoRoot,
  });

  assert.deepEqual(block, {
    label: "run-once planning",
    sections: [
      { heading: "Context", items: ["AGENTS.md"] },
      { heading: "Skills", items: ["brainstorming", "github"] },
      { heading: "Prompts", items: ["/parallel-review", "/review-loop"] },
      { heading: "Extensions", items: ["extension", "todos.ts"] },
    ],
  });
});

test("formatPiResourceBlocks prints profile blocks", () => {
  assert.deepEqual(
    formatPiResourceBlocks([
      {
        label: "run-once planning",
        sections: [
          { heading: "Context", items: ["AGENTS.md"] },
          { heading: "Skills", items: ["github"] },
        ],
      },
    ]),
    [
      "[Pi resources: run-once planning]",
      "",
      "[Context]",
      "  AGENTS.md",
      "",
      "[Skills]",
      "  github",
    ],
  );
});

test("compactProfileBlock omits empty categories", () => {
  assert.deepEqual(
    compactProfileBlock({
      label: "triage",
      contextFiles: [],
      skillNames: [],
      promptNames: ["review-loop"],
      extensionPaths: [],
      repoRoot,
    }),
    {
      label: "triage",
      sections: [{ heading: "Prompts", items: ["/review-loop"] }],
    },
  );
});

test("piResourceWarningCheck returns undefined without warnings", () => {
  assert.equal(piResourceWarningCheck([]), undefined);
});

test("piResourceWarningCheck reports skipped packages without failing", () => {
  assert.deepEqual(
    piResourceWarningCheck(["skipped missing package npm:@acme/pi-tools"]),
    {
      name: "pi resources",
      status: "warn",
      message: "skipped missing package npm:@acme/pi-tools",
      remediation: [
        "Patchmill doctor listed Pi resources without installing missing packages or executing extensions.",
        "Install or update skipped Pi package sources outside doctor, and inspect or fix the listed static Pi resource diagnostics, then rerun:",
        "  patchmill doctor",
      ],
    },
  );
});

test("piResourceDiscoveryFailureCheck creates a non-failing warning", () => {
  assert.deepEqual(piResourceDiscoveryFailureCheck(new Error("boom")), {
    name: "pi resources",
    status: "warn",
    message: "could not list Pi resources: boom",
    remediation: [
      "Patchmill doctor could not list Pi's startup resources.",
      "The readiness checks still ran; fix the Pi resource discovery error, then rerun:",
      "  patchmill doctor",
    ],
  });
});

test("non-mutating discovery skips missing configured package sources", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "patchmill-doctor-resources-"));
  try {
    await writeFile(
      join(tmp, "patchmill.config.json"),
      JSON.stringify({ host: { provider: "forgejo-tea", repo: "OWNER/repo" } }),
      "utf8",
    );
    await mkdir(join(tmp, ".patchmill", "pi-agent"), { recursive: true });
    await writeFile(
      join(tmp, ".patchmill", "pi-agent", "settings.json"),
      JSON.stringify({ packages: ["npm:@missing/package@1.0.0"] }),
      "utf8",
    );

    const report = await loadDoctorPiResources(tmp, {});

    assert.equal(report.check?.status, "warn");
    assert.match(
      report.check?.message ?? "",
      /skipped missing package npm:@missing\/package@1\.0\.0/,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
