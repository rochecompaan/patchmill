import assert from "node:assert/strict";
import { test } from "node:test";
import { createApi, ApiRequestError, newRequestId } from "../../web/api.js";
test("browser client uses only same-origin GET routes and handles 401 before JSON", async () => {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const api = createApi(async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response("{}", { status: 200 });
  });
  await api.board();
  await api.issue(227);
  assert.deepEqual(
    requests.map((r) => r.url),
    ["/api/board", "/api/issues/227"],
  );
  requests.forEach((r) => {
    assert.equal(r.init?.method, "GET");
    assert.equal(r.init?.credentials, "same-origin");
  });
  const denied = createApi(
    async () => new Response("<p>Open the link</p>", { status: 401 }),
  );
  await assert.rejects(
    denied.board(),
    (e) => e instanceof ApiRequestError && e.status === 401,
  );
  for (const status of [404, 500])
    await assert.rejects(
      createApi(async () => new Response("error", { status })).issue(227),
      (e) => e instanceof ApiRequestError && e.status === status,
    );
  await assert.rejects(api.issue(0));
});

test("request IDs work without randomUUID, as on a plain-HTTP host", () => {
  // Browsers give randomUUID only to secure contexts (HTTPS or localhost).
  const insecure = {
    getRandomValues: (array: Uint8Array<ArrayBuffer>) =>
      globalThis.crypto.getRandomValues(array),
  };
  const ids = new Set(Array.from({ length: 50 }, () => newRequestId(insecure)));
  assert.equal(ids.size, 50);
  for (const id of ids)
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  // A secure context keeps using randomUUID.
  assert.equal(
    newRequestId({ ...insecure, randomUUID: () => "from-random-uuid" }),
    "from-random-uuid",
  );
});
