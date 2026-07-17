import assert from "node:assert/strict";
import { test } from "node:test";
import * as piCodingAgent from "@earendil-works/pi-coding-agent";

const REQUIRED_INIT_RUNTIME_EXPORTS = [
  "AuthStorage",
  "ModelRegistry",
  "getAgentDir",
] as const;

test("resolved pi-coding-agent exports the runtime symbols used by patchmill init", () => {
  for (const exportName of REQUIRED_INIT_RUNTIME_EXPORTS) {
    assert.equal(
      exportName in piCodingAgent,
      true,
      `@earendil-works/pi-coding-agent must export ${exportName}`,
    );
    assert.notEqual(
      piCodingAgent[exportName],
      undefined,
      `@earendil-works/pi-coding-agent export ${exportName} must be defined`,
    );
  }
});
