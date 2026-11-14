import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequestPolicy, isLoopback } from "./request-policy.ts";

test("mapped IPv6 authorities retain valid embedded IPv4 notation", () => {
  const policy = createRequestPolicy({
    host: "::ffff:127.0.0.1",
    address: "::ffff:127.0.0.1",
    port: 4280,
    interfaces: [],
  });
  assert.equal(
    policy.authority(["Host", "[::ffff:127.0.0.1]:4280"]),
    "[::ffff:7f00:1]:4280",
  );
  assert.equal(
    policy.authority(["Host", "[::ffff:7f00:1]:4280"]),
    "[::ffff:7f00:1]:4280",
  );
  assert.equal(policy.authority(["Host", "localhost:4280"]), "localhost:4280");
  assert.equal(isLoopback("::ffff:127.0.0.1"), true);
});
const binding = {
  host: "127.0.0.1",
  address: "127.0.0.1",
  port: 4280,
  interfaces: [],
};
test("only one exact local authority is trusted, never forwarded or suffix names", () => {
  const p = createRequestPolicy(binding);
  for (const host of ["127.0.0.1:4280", "localhost:4280", "LOCALHOST:4280"])
    assert.equal(p.authority(["Host", host]), host.toLowerCase());
  for (const host of [
    "localhost",
    "localhost:4281",
    "localhost.evil:4280",
    "user@localhost:4280",
    "localhost:4280/path",
    "[::1",
    "0x7f000001:4280",
  ])
    assert.equal(p.authority(["Host", host]), null, host);
  assert.equal(p.authority([]), null);
  assert.equal(
    p.authority(["Host", "localhost:4280", "host", "localhost:4280"]),
    null,
  );
  assert.equal(
    p.authority([
      "Host",
      "evil.test:4280",
      "X-Forwarded-Host",
      "localhost:4280",
    ]),
    null,
  );
  assert.equal(
    createRequestPolicy({ ...binding, port: 80 }).authority([
      "Host",
      "localhost",
    ]),
    "localhost:80",
  );
});
test("unsafe methods need a single matching serialized HTTP Origin", () => {
  const p = createRequestPolicy(binding);
  assert.equal(p.originAllowed("GET", [], "localhost:4280"), true);
  assert.equal(
    p.originAllowed(
      "POST",
      ["Origin", "http://localhost:4280"],
      "localhost:4280",
    ),
    true,
  );
  for (const origin of [
    "null",
    "https://localhost:4280",
    "http://evil.test",
    "http://localhost:4280/",
    "http://localhost:4280/path",
    "http://user@localhost:4280",
    "http://localhost:4280?q=1",
    "http://localhost:4280#x",
  ])
    assert.equal(
      p.originAllowed("POST", ["Origin", origin], "localhost:4280"),
      false,
      origin,
    );
  assert.equal(p.originAllowed("POST", [], "localhost:4280"), false);
  assert.equal(
    p.originAllowed(
      "POST",
      ["Origin", "http://localhost:4280", "Origin", "http://localhost:4280"],
      "localhost:4280",
    ),
    false,
  );
});
test("wildcard listeners trust startup IPs but not wildcard authorities or arbitrary DNS", () => {
  const p = createRequestPolicy({
    host: "::",
    address: "::",
    port: 4280,
    interfaces: ["192.0.2.1", "2001:db8::1"],
  });
  for (const host of [
    "localhost:4280",
    "127.0.0.1:4280",
    "[::1]:4280",
    "192.0.2.1:4280",
    "[2001:db8::1]:4280",
  ])
    assert.equal(p.authority(["Host", host]), host);
  for (const host of ["[::]:4280", "0.0.0.0:4280", "office.test:4280"])
    assert.equal(p.authority(["Host", host]), null);
});
