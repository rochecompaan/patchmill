import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  explainProviderFailure,
  lastProviderFailure,
  providerFailure,
  providerFailureEntry,
  providerFailureNotice,
} from "./provider-failure.ts";
import type { ParsedResult } from "./result.ts";

const EXPIRED =
  "Your authentication token has expired. Please try refreshing it.";
const GUIDANCE =
  "The model provider refused the sign-in. Run patchmill auth in the repository, then send your message again. If it fails again, press Pause and then Resume.";
const SIGN_IN_REASON = (issue: number) =>
  `The model request failed: the provider refused the sign-in. Run patchmill auth in the repository, then run patchmill run-once --issue ${issue}.`;
const OTHER_REASON =
  "The model request failed. The CLI output and the log have the provider's message.";

const failed = (errorMessage?: string) => ({
  role: "assistant",
  content: [],
  stopReason: "error",
  ...(errorMessage === undefined ? {} : { errorMessage }),
});
const record = (message: unknown) =>
  JSON.stringify({
    type: "message",
    timestamp: "2026-11-23T10:00:00Z",
    message,
  });
const ok = {
  role: "assistant",
  content: [{ type: "text", text: "Done" }],
  stopReason: "stop",
};

async function tempDir(t: test.TestContext) {
  const dir = await fs.mkdtemp(join(os.tmpdir(), "provider-failure-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("providerFailure classifies sign-in failures", () => {
  for (const message of [
    EXPIRED,
    "401 Unauthorized",
    "Request failed: 403 forbidden",
    "Invalid API key",
    "API key is missing",
    "The access token expired",
    "Please log in again",
    "Unauthenticated",
  ])
    assert.deepEqual(providerFailure(failed(message)), {
      message,
      signIn: true,
    });
});

test("providerFailure keeps other errors without sign-in", () => {
  for (const message of [
    "Overloaded",
    "429 Too Many Requests: rate limit reached",
  ])
    assert.deepEqual(providerFailure(failed(message)), {
      message,
      signIn: false,
    });
});

test("aborted, stop, and non-assistant messages are not failures", () => {
  for (const message of [
    { ...failed("x"), stopReason: "aborted" },
    { ...failed("x"), stopReason: "stop" },
    { ...failed("x"), role: "user" },
    null,
    "text",
  ])
    assert.equal(providerFailure(message), undefined);
});

test("empty error message", () => {
  for (const message of [failed(""), failed()])
    assert.deepEqual(providerFailure(message), {
      message: "The request failed.",
      signIn: false,
    });
});

test("long message is cut", () => {
  assert.equal(providerFailure(failed("x".repeat(5000)))?.message.length, 2000);
});

test("entry and notice text", () => {
  assert.deepEqual(providerFailureEntry(failed(EXPIRED)), {
    title: "Sign-in failed",
    text: `${EXPIRED}\n\n${GUIDANCE}`,
  });
  assert.equal(
    providerFailureNotice(providerFailure(failed(EXPIRED))!),
    `The model request failed: ${EXPIRED} Run patchmill auth in the repository.`,
  );
  assert.deepEqual(providerFailureEntry(failed("Overloaded")), {
    title: "The agent's request failed",
    text: "Overloaded.",
  });
  assert.equal(
    providerFailureNotice(providerFailure(failed("Overloaded"))!),
    "The model request failed: Overloaded.",
  );
  assert.equal(providerFailureEntry(ok), undefined);
});

test("lastProviderFailure reads the newest session file", async (t) => {
  const dir = await tempDir(t);
  assert.equal(await lastProviderFailure(join(dir, "missing")), undefined);
  assert.equal(await lastProviderFailure(dir), undefined);

  await fs.writeFile(
    join(dir, "a.jsonl"),
    ["{broken", record(failed(EXPIRED)), ""].join("\n"),
  );
  assert.deepEqual(await lastProviderFailure(dir), {
    message: EXPIRED,
    signIn: true,
  });

  await fs.writeFile(
    join(dir, "a.jsonl"),
    [record(failed(EXPIRED)), record(ok), ""].join("\n"),
  );
  assert.equal(await lastProviderFailure(dir), undefined);
});

test("lastProviderFailure lets the newest of two files decide", async (t) => {
  const dir = await tempDir(t);
  const older = join(dir, "z-old.jsonl");
  const newer = join(dir, "a-new.jsonl");
  await fs.writeFile(older, record(ok) + "\n");
  await fs.writeFile(newer, record(failed(EXPIRED)) + "\n");
  await fs.utimes(older, new Date(1000), new Date(1000));
  await fs.utimes(newer, new Date(2000), new Date(2000));
  assert.equal((await lastProviderFailure(dir))?.message, EXPIRED);
  await fs.utimes(older, new Date(3000), new Date(3000));
  assert.equal(await lastProviderFailure(dir), undefined);
});

test("explainProviderFailure", async (t) => {
  const dir = await tempDir(t);
  const parsed: ParsedResult = {
    ok: true,
    result: { status: "done", summary: "s" },
  };
  const missing: ParsedResult = { ok: false, reason: "x", missing: true };
  assert.equal(await explainProviderFailure(missing, dir, 9), undefined);

  await fs.writeFile(join(dir, "s.jsonl"), record(failed(EXPIRED)) + "\n");
  assert.equal(await explainProviderFailure(parsed, dir, 9), undefined);

  const explained = await explainProviderFailure(missing, dir, 9);
  assert.ok(explained);
  assert.deepEqual(explained.result, {
    ok: false,
    reason: SIGN_IN_REASON(9),
    missing: true,
  });
  assert.doesNotMatch(
    explained.result.ok ? "" : explained.result.reason,
    /authentication token/,
  );
  assert.equal(explained.failure.signIn, true);

  const plain = await explainProviderFailure(
    { ok: false, reason: "bad json" },
    dir,
    9,
  );
  assert.deepEqual(plain?.result, { ok: false, reason: SIGN_IN_REASON(9) });

  await fs.writeFile(join(dir, "s.jsonl"), record(failed("Overloaded")) + "\n");
  const other = await explainProviderFailure(missing, dir, 9);
  assert.deepEqual(other?.result, {
    ok: false,
    reason: OTHER_REASON,
    missing: true,
  });
});
