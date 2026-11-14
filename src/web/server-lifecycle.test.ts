import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("post-listen initialization failure releases the TCP listener", () => {
  const script = `
    import assert from 'node:assert/strict';
    import { createServer } from 'node:net';
    import { once } from 'node:events';
    import { startServeServer } from ${JSON.stringify(new URL("./server.ts", import.meta.url).href)};
    import { createServeAuth } from ${JSON.stringify(new URL("./auth.ts", import.meta.url).href)};
    import { createSampleRunDataSource } from ${JSON.stringify(new URL("./sample-data.ts", import.meta.url).href)};
    try {
      const probe = createServer();
      probe.listen(0, '127.0.0.1');
      await once(probe, 'listening');
      const port = probe.address().port;
      await new Promise(resolve => probe.close(resolve));
      const original = createServeAuth('test');
      const auth = { ...original, get token() { throw new Error('URL initialization failed'); } };
      await assert.rejects(startServeServer({host:'127.0.0.1',port,auth,source:createSampleRunDataSource()}), /URL initialization failed/);
      const replacement = createServer();
      replacement.listen(port, '127.0.0.1');
      await once(replacement, 'listening');
      await new Promise(resolve => replacement.close(resolve));
      process.exit(0);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    {
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
});
