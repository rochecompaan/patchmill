import type { DoctorCheckResult } from "./checks.ts";

function prefix(status: DoctorCheckResult["status"]): string {
  if (status === "pass") return "✓";
  if (status === "warn") return "!";
  return "✗";
}

export function hasDoctorFailures(results: DoctorCheckResult[]): boolean {
  return results.some((result) => result.status === "fail");
}

export function formatDoctorReport(results: DoctorCheckResult[]): string[] {
  const lines = ["Patchmill doctor", ""];
  lines.push(
    ...results.map(
      (result) => `${prefix(result.status)} ${result.name}: ${result.message}`,
    ),
  );

  const remediation = results.flatMap((result) => result.remediation ?? []);
  if (remediation.length > 0) {
    lines.push("", ...remediation);
    return lines;
  }

  if (!hasDoctorFailures(results)) {
    lines.push(
      "",
      "Ready for safe dry runs.",
      "",
      "Next:",
      "  patchmill triage --dry-run",
    );
  }

  return lines;
}
