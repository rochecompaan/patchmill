import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// Exercise the policy Astro loads, including any nested dependency resolution.
const requireFromAstro = createRequire(import.meta.resolve("astro"));
const CachePolicy = requireFromAstro("http-cache-semantics");

const originalRequest = {
  url: "https://cache.example/resource",
  headers: { host: "cache.example" },
};

function cachedResponse(headers = {}, options = {}) {
  return new CachePolicy(
    originalRequest,
    {
      status: 200,
      headers: { "cache-control": "max-age=60", age: "120", ...headers },
    },
    options,
  );
}

function incomingRequest(directive) {
  return {
    ...originalRequest,
    headers: { ...originalRequest.headers, "cache-control": directive },
  };
}

function assertRevalidation(policy, directive) {
  const request = incomingRequest(directive);
  assert.equal(policy.satisfiesWithoutRevalidation(request), false);
  const result = policy.evaluateRequest(request);
  assert.equal(result.response, undefined);
  assert.equal(result.revalidation.synchronous, true);
}

const restrictedResponses = [
  ["another user's session cookie", { "set-cookie": "session=victim-secret" }],
  ["proxy revalidation", { "cache-control": "max-age=60, proxy-revalidate" }],
  ["no-cache", { "cache-control": "max-age=60, no-cache" }],
  ["no-store", { "cache-control": "max-age=60, no-store" }],
  [
    "private response in a shared cache",
    { "cache-control": "max-age=60, private" },
  ],
  ["must-revalidate", { "cache-control": "max-age=60, must-revalidate" }],
];

for (const [name, headers] of restrictedResponses) {
  test(`max-stale cannot bypass ${name}`, () => {
    for (const directive of ["max-stale", "max-stale=999999"]) {
      assertRevalidation(cachedResponse(headers), directive);
    }
  });
}

test("a serialized session-cookie policy still requires revalidation", () => {
  const policy = cachedResponse({ "set-cookie": "session=victim-secret" });
  assertRevalidation(CachePolicy.fromObject(policy.toObject()), "max-stale");
});

test("stale-while-revalidate cannot bypass shared session-cookie restrictions", () => {
  const policy = cachedResponse({
    "cache-control": "max-age=60, stale-while-revalidate=999999",
    "set-cookie": "session=victim-secret",
  });
  assertRevalidation(policy, "");
});

test("ordinary expired public responses still accept max-stale", () => {
  const policy = cachedResponse({ "cache-control": "public, max-age=60" });
  assert.equal(
    policy.satisfiesWithoutRevalidation(incomingRequest("max-stale")),
    true,
  );
  assert.equal(
    policy.satisfiesWithoutRevalidation(incomingRequest("max-stale=999999")),
    true,
  );
  assertRevalidation(policy, "max-stale=1");
});

test("fresh public responses still use the cache", () => {
  const policy = cachedResponse({ "cache-control": "public, max-age=3600" });
  assert.equal(policy.satisfiesWithoutRevalidation(incomingRequest("")), true);
});

for (const directive of ["public", "immutable"]) {
  test(`explicit ${directive} cookie opt-in remains supported`, () => {
    const policy = cachedResponse({
      "cache-control": `${directive}, max-age=60`,
      "set-cookie": "theme=dark",
    });
    assert.equal(
      policy.satisfiesWithoutRevalidation(incomingRequest("max-stale")),
      true,
    );
  });
}

test("a private cache can still reuse its own session-cookie response", () => {
  const policy = cachedResponse(
    { "set-cookie": "session=owner" },
    { shared: false },
  );
  assert.equal(
    policy.satisfiesWithoutRevalidation(incomingRequest("max-stale")),
    true,
  );
});
