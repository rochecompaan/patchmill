import assert from "node:assert/strict";
import { test } from "node:test";
import { createServeAuth } from "./auth.ts";

test("root GET trades an exact Unicode token for a host-only session cookie", () => {
  const auth = createServeAuth("secret + ü");
  const result = auth.exchange(
    "GET",
    "/?view=board&token=secret%20%2B%20%C3%BC",
  );
  assert.equal(result.kind, "redirect");
  if (result.kind !== "redirect") assert.fail();
  assert.equal(result.location, "/?view=board");
  assert.equal(
    result.cookie,
    "patchmill_serve=secret%20%2B%20%C3%BC; HttpOnly; SameSite=Strict; Path=/",
  );
  assert.equal(auth.authenticated(result.cookie.split(";")[0]), true);
});
test("bad tokens and duplicate cookies cannot authenticate", () => {
  const auth = createServeAuth("secret");
  for (const query of [
    "token=",
    "token=wrong",
    "token=%zz",
    "token=%FF",
    "token=secret&token=secret",
  ])
    assert.deepEqual(auth.exchange("GET", "/?" + query), { kind: "invalid" });
  for (const [method, path] of [
    ["HEAD", "/?token=secret"],
    ["POST", "/?token=secret"],
    ["GET", "/api/board?token=secret"],
  ])
    assert.deepEqual(auth.exchange(method!, path!), { kind: "none" });
  for (const cookie of [
    undefined,
    "",
    "patchmill_serve=wrong",
    "patchmill_serve=%FF",
    "patchmill_serve=secret; patchmill_serve=secret",
  ])
    assert.equal(auth.authenticated(cookie), false);
  assert.equal(
    auth.authenticated("unrelated=value; patchmill_serve=secret"),
    true,
  );
});
test("generated tokens rotate, configured tokens persist, invalid config fails safely", () => {
  const first = createServeAuth(),
    second = createServeAuth();
  assert.match(first.token, /^[\w-]{43}$/);
  assert.notEqual(first.token, second.token);
  assert.equal(second.authenticated("patchmill_serve=" + first.token), false);
  assert.equal(
    createServeAuth("fixed").authenticated("patchmill_serve=fixed"),
    true,
  );
  for (const value of ["", "ü".repeat(513)])
    assert.throws(() => createServeAuth(value), /1.*1024/);
});
