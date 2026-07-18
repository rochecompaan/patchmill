import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
    extensionResources: [
      { path: join(repoRoot, "extensions", "todos.ts") },
      {
        path: join(
          repoRoot,
          "extensions",
          "pi-remote",
          "extension",
          "index.ts",
        ),
      },
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
      extensionResources: [],
      repoRoot,
    }),
    {
      label: "triage",
      sections: [{ heading: "Prompts", items: ["/review-loop"] }],
    },
  );
});

test("compactProfileBlock labels package-backed extensions with their source", () => {
  const block = compactProfileBlock({
    label: "run-once planning",
    contextFiles: [],
    skillNames: [],
    promptNames: [],
    extensionResources: [
      {
        path: join(
          repoRoot,
          ".pi",
          "packages",
          "acme",
          "extension",
          "index.ts",
        ),
        metadata: { source: "npm:@acme/pi-tools@1.0.0", origin: "package" },
      },
      { path: join(repoRoot, "extensions", "todos.ts") },
    ],
    repoRoot,
  });

  assert.deepEqual(block.sections, [
    {
      heading: "Extensions",
      items: ["npm:@acme/pi-tools@1.0.0: extension", "todos.ts"],
    },
  ]);
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

test("context files mirror Pi even when project package resources are untrusted", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "patchmill-doctor-context-"));
  try {
    await writeFile(
      join(tmp, "patchmill.config.json"),
      JSON.stringify({ host: { provider: "forgejo-tea", repo: "OWNER/repo" } }),
      "utf8",
    );
    await writeFile(join(tmp, "AGENTS.md"), "# project instructions\n", "utf8");
    await mkdir(join(tmp, ".agents", "skills"), { recursive: true });

    const report = await loadDoctorPiResources(tmp, {});
    const planning = report.blocks.find(
      (block) => block.label === "run-once planning",
    );
    const context = planning?.sections.find(
      (section) => section.heading === "Context",
    );

    assert.ok(context?.items.includes("AGENTS.md"));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("resource discovery does not create local Pi agent trust state", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "patchmill-doctor-trust-"));
  try {
    await writeFile(
      join(tmp, "patchmill.config.json"),
      JSON.stringify({ host: { provider: "forgejo-tea", repo: "OWNER/repo" } }),
      "utf8",
    );
    await mkdir(join(tmp, ".agents", "skills"), { recursive: true });

    await loadDoctorPiResources(tmp, {});

    assert.equal(existsSync(join(tmp, ".patchmill")), false);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
