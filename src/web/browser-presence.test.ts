import assert from "node:assert/strict";
import { test } from "node:test";
import { createPageController } from "../../web/controller.js";
import type { PageState } from "../../web/controller.js";
import {
  presenceChanges,
  presenceNames,
  typingText,
} from "../../web/presence-view.js";
import type { IssueResponse, PresencePerson } from "./api-types.ts";
import { createSampleRunDataSource } from "./sample-data.ts";

async function liveIssue(): Promise<IssueResponse> {
  const data = await createSampleRunDataSource().snapshot();
  return {
    schemaVersion: 1,
    ...data,
    source: "live",
    issue: { ...data.details["298"]!, run: null, session: null },
  };
}

function setup(response: IssueResponse, name: () => string | null) {
  const sockets: {
    url: string;
    closed: boolean;
    handlers: Map<string, (e: { data?: string }) => void>;
  }[] = [];
  const states: PageState[] = [];
  const presence: (readonly PresencePerson[] | null)[] = [];
  const controller = createPageController({
    api: {
      board: async () => response,
      issue: async () => response,
      session: async () => ({ ok: true, duplicate: false }),
      typing: async () => true,
    } as never,
    events: (url) => {
      const socket = { url, closed: false, handlers: new Map() };
      sockets.push(socket);
      return {
        readyState: 1,
        close: () => {
          socket.closed = true;
        },
        addEventListener: (kind, fn) => {
          socket.handlers.set(kind, fn);
        },
      };
    },
    onState: (s) => states.push(s),
    onPresence: (people) => presence.push(people),
    name,
    visible: () => true,
    clock: { after: () => () => {} },
  });
  const people = (names: string[]): PresencePerson[] =>
    names.map((n) => ({ name: n, typing: false }));
  const push = (socket: (typeof sockets)[number], names: string[]) =>
    socket.handlers.get("presence")!({
      data: JSON.stringify({ kind: "presence", people: people(names) }),
    });
  return { controller, sockets, states, presence, push };
}
const issue298 = { view: "issue" as const, number: 298, artifactId: null };

test("the stream URL carries the saved name", async () => {
  const r = await liveIssue();
  const named = setup(r, () => "Ann Lee");
  await named.controller.navigate(issue298);
  assert.equal(named.sockets[0]!.url, "/api/issues/298/events?name=Ann%20Lee");
  const unnamed = setup(r, () => null);
  await unnamed.controller.navigate(issue298);
  assert.equal(unnamed.sockets[0]!.url, "/api/issues/298/events");
});

test("presence events reach onPresence without a new page state", async () => {
  const f = setup(await liveIssue(), () => "Ann");
  await f.controller.navigate(issue298);
  const count = f.states.length;
  f.push(f.sockets[0]!, ["Ann", "Ben"]);
  assert.deepEqual(
    f.presence.at(-1)?.map((p) => p.name),
    ["Ann", "Ben"],
  );
  assert.equal(f.states.length, count);
});

test("closing the stream reports null", async () => {
  const f = setup(await liveIssue(), () => "Ann");
  await f.controller.navigate(issue298);
  f.push(f.sockets[0]!, ["Ann"]);
  await f.controller.navigate({ view: "board" });
  assert.equal(f.sockets[0]!.closed, true);
  assert.equal(f.presence.at(-1), null);
});

test("rename reconnects with the new name", async () => {
  let name = "Ann";
  const f = setup(await liveIssue(), () => name);
  await f.controller.navigate(issue298);
  name = "Bea";
  f.controller.rename();
  assert.equal(f.sockets[0]!.closed, true);
  assert.equal(f.sockets.length, 2);
  assert.equal(f.sockets[1]!.url, "/api/issues/298/events?name=Bea");
});

test("a presence event on a closed stream is ignored", async () => {
  let name = "Ann";
  const f = setup(await liveIssue(), () => name);
  await f.controller.navigate(issue298);
  name = "Bea";
  f.controller.rename();
  const count = f.presence.length;
  f.push(f.sockets[0]!, ["Ann"]);
  assert.equal(f.presence.length, count);
});

const list = (...names: string[]): PresencePerson[] =>
  names.map((n) =>
    n.endsWith("*")
      ? { name: n.slice(0, -1), typing: true }
      : { name: n, typing: false },
  );

test("presenceNames puts me first and lists each name once", () => {
  assert.deepEqual(presenceNames("Ben", list("Ana", "Ben", "Cleo")), [
    "Ben",
    "Ana",
    "Cleo",
  ]);
  assert.deepEqual(presenceNames("Ben", null), ["Ben"]);
  assert.deepEqual(presenceNames("Ben", list()), ["Ben"]);
});

test("typingText names the people who type, without me", () => {
  assert.equal(typingText("Ana", list("Ana", "Ben")), "");
  assert.equal(typingText("Ana", list("Ana*", "Ben")), "");
  assert.equal(typingText("Ana", null), "");
  assert.equal(typingText("Ana", list("Ana", "Ben*")), "Ben is typing");
  assert.equal(
    typingText("Ana", list("Ana*", "Ben*", "Cleo*")),
    "Ben and Cleo are typing",
  );
  assert.equal(
    typingText("Ana", list("Ben*", "Cleo*", "Dee*")),
    "3 people are typing",
  );
});

test("presenceChanges announces joins and leaves of others", () => {
  assert.deepEqual(presenceChanges(null, list("Ana", "Ben"), "Ana"), []);
  assert.deepEqual(presenceChanges(list("Ana"), list("Ana", "Ben"), "Ana"), [
    "Ben joined the page.",
  ]);
  assert.deepEqual(presenceChanges(list("Ana", "Ben"), list("Ana"), "Ana"), [
    "Ben left the page.",
  ]);
  assert.deepEqual(
    presenceChanges(list("Ben", "Cleo"), list("Ana", "Ben*", "Dee"), "Ana"),
    ["Dee joined the page.", "Cleo left the page."],
  );
});
