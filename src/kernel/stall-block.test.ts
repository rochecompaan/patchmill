import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readStallBlock, STALL_BLOCK_FILE } from "./stall-block.ts";
import { previousStallsFact } from "./stall-text.ts";

test("a record with the wrong shape is ignored, not a crash of later attempts", async (t) => {
  const dir = await fs.mkdtemp(join(tmpdir(), "patchmill-stall-block-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const stalls of [[{ number: 1 }], [null], ["x"], [{ calls: [null] }]]) {
    await fs.writeFile(join(dir, STALL_BLOCK_FILE), JSON.stringify({ stalls }));
    const read = await readStallBlock(dir);
    if (read) assert.doesNotThrow(() => previousStallsFact(read));
    assert.equal(read, undefined, JSON.stringify(stalls));
  }
});
