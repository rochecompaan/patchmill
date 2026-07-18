import assert from "node:assert/strict";
import { test } from "node:test";
import type { DoctorCheckResult } from "./checks.ts";
import { formatDoctorReport } from "./reporting.ts";

const passing: DoctorCheckResult[] = [
  { name: "config", status: "pass", message: "patchmill.config.json" },
  { name: "git", status: "pass", message: "clean worktree" },
];

test("formatDoctorReport prints success checklist and next command", () => {
  assert.deepEqual(formatDoctorReport(passing), [
    "Patchmill doctor",
    "",
    "✓ config: patchmill.config.json",
    "✓ git: clean worktree",
    "",
    "Ready for safe dry runs.",
    "",
    "Next:",
    "  patchmill triage --dry-run",
  ]);
});

test("formatDoctorReport prints failures and remediation", () => {
  const lines = formatDoctorReport([
    ...passing,
    {
      name: "labels",
      status: "fail",
      message: "missing agent-ready, needs-info",
      remediation: [
        "Patchmill doctor is read-only and did not create labels.",
        "",
        "Run the approved repair flow:",
        "  patchmill doctor --fix",
        "",
        "You can edit label names in patchmill.config.json before running --fix.",
      ],
    },
  ]);

  assert.deepEqual(lines, [
    "Patchmill doctor",
    "",
    "✓ config: patchmill.config.json",
    "✓ git: clean worktree",
    "✗ labels: missing agent-ready, needs-info",
    "",
    "Patchmill doctor is read-only and did not create labels.",
    "",
    "Run the approved repair flow:",
    "  patchmill doctor --fix",
    "",
    "You can edit label names in patchmill.config.json before running --fix.",
  ]);
});

test("formatDoctorReport prints warnings but keeps next command", () => {
  const lines = formatDoctorReport([
    ...passing,
    {
      name: "paths",
      status: "warn",
      message: "worktree directory does not exist yet",
    },
  ]);

  assert.match(
    lines.join("\n"),
    /! paths: worktree directory does not exist yet/,
  );
  assert.match(lines.join("\n"), /Ready for safe dry runs/);
});

test("formatDoctorReport prepends Pi resource blocks", () => {
  assert.deepEqual(
    formatDoctorReport(passing, [
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
      "",
      "Patchmill doctor",
      "",
      "✓ config: patchmill.config.json",
      "✓ git: clean worktree",
      "",
      "Ready for safe dry runs.",
      "",
      "Next:",
      "  patchmill triage --dry-run",
    ],
  );
});
