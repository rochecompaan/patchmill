import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findPackageRoot } from "./package-root.ts";
import { assertInstalledPiSubagentsMatchesRootPin } from "./pi/pi-subagents-package.ts";

/** Fails before CLI dispatch when source dependencies do not match Patchmill's pins. */
export function assertPatchmillRuntimeDependencyPins(
  moduleUrl = import.meta.url,
): void {
  const packageRoot = findPackageRoot(dirname(fileURLToPath(moduleUrl)));
  assertInstalledPiSubagentsMatchesRootPin(join(packageRoot, "package.json"));
}
