import assert from "node:assert/strict";
import { test } from "node:test";
import { createTypingSignal } from "../../web/typing.js";
import { createApi } from "../../web/api.js";

function setup(result: () => Promise<unknown> = async () => true) {
  let now = 0;
  const sent: boolean[] = [];
  const signal = createTypingSignal({
    send: (typing: boolean) => {
      sent.push(typing);
      return result();
    },
    clock: { now: () => now },
  });
  return { signal, sent, at: (ms: number) => (now = ms) };
}

test("input with text sends true at most every interval", () => {
  const s = setup();
  for (const ms of [0, 1000, 2999]) {
    s.at(ms);
    s.signal.input(true);
  }
  assert.deepEqual(s.sent, [true]);
  s.at(3000);
  s.signal.input(true);
  assert.deepEqual(s.sent, [true, true]);
});

test("an empty composer sends false once after true", () => {
  const s = setup();
  s.signal.input(false);
  assert.deepEqual(s.sent, []);
  s.signal.input(true);
  s.signal.input(false);
  s.signal.input(false);
  assert.deepEqual(s.sent, [true, false]);
  s.at(100);
  s.signal.input(true);
  assert.deepEqual(s.sent, [true, false, true], "a new text starts at once");
});

test("sent clears once", () => {
  const s = setup();
  s.signal.input(true);
  s.signal.sent();
  s.signal.sent();
  assert.deepEqual(s.sent, [true, false]);
  s.at(10);
  s.signal.input(true);
  assert.deepEqual(s.sent, [true, false, true]);
});

test("a rejected send does not throw or change the throttle", async () => {
  const s = setup(() => Promise.reject(new Error("409")));
  assert.doesNotThrow(() => s.signal.input(true));
  s.at(1000);
  s.signal.input(true);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(s.sent, [true]);
  s.at(3000);
  s.signal.input(true);
  assert.deepEqual(s.sent, [true, true]);
});

test("dispose stops all sends", () => {
  const s = setup();
  s.signal.input(true);
  s.signal.dispose();
  s.signal.sent();
  s.at(5000);
  s.signal.input(true);
  s.signal.input(false);
  assert.deepEqual(s.sent, [true]);
});

test("api.typing posts the body and reports failure", async () => {
  const calls: { path: string; init: RequestInit }[] = [];
  let reply: () => Promise<Response> = async () =>
    new Response('{"accepted":true}', { status: 202 });
  const api = createApi((async (path: string, init: RequestInit) => {
    calls.push({ path, init });
    return reply();
  }) as typeof fetch);
  assert.equal(await api.typing(7, "Ann", true), true);
  assert.equal(calls[0]!.path, "/api/issues/7/typing");
  assert.equal(calls[0]!.init.method, "POST");
  assert.equal(calls[0]!.init.credentials, "same-origin");
  assert.equal(calls[0]!.init.body, '{"author":"Ann","typing":true}');
  reply = async () => new Response("{}", { status: 409 });
  assert.equal(await api.typing(7, "Ann", false), false);
  reply = async () => {
    throw new TypeError("offline");
  };
  assert.equal(await api.typing(7, "Ann", false), false);
});
