import assert from "node:assert/strict";
import { test } from "node:test";
import { parseServeArgs } from "./args.ts";
test("serve has strict host and port flags with loopback defaults", () => {
  assert.deepEqual(parseServeArgs([]), {
    host: "127.0.0.1",
    port: 4280,
    sample: false,
  });
  assert.deepEqual(parseServeArgs(["--sample", "--port", "5000"]), {
    host: "127.0.0.1",
    port: 5000,
    sample: true,
  });
  assert.deepEqual(parseServeArgs(["--host", "::1", "--port", "5000"]), {
    host: "::1",
    port: 5000,
    sample: false,
  });
  for (const args of [
    ["--port", "0"],
    ["--port", "1.5"],
    ["--port", "65536"],
    ["--port"],
    ["--port", "1e2"],
    ["--host", ""],
    ["--host", " "],
    ["--host", "http://localhost"],
    ["--port", "1", "--port", "2"],
    ["--sample", "--sample"],
    ["--sample", "true"],
    ["--wat"],
    ["extra"],
  ])
    assert.throws(() => parseServeArgs(args));
  for (const flag of ["--help", "-h", "help"])
    assert.equal(parseServeArgs([flag]), "help");
});
