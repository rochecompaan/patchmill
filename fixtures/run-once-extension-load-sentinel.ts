import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SENTINEL_PAYLOAD = "patchmill-run-once-extensions-loaded\n";

export default function runOnceExtensionLoadSentinel(_pi: ExtensionAPI): void {
  const sentinelPath = process.env.PATCHMILL_RUN_ONCE_EXTENSION_SENTINEL;
  if (!sentinelPath) {
    throw new Error("PATCHMILL_RUN_ONCE_EXTENSION_SENTINEL is required");
  }
  writeFileSync(sentinelPath, SENTINEL_PAYLOAD, "utf8");
}
