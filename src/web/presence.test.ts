import assert from "node:assert/strict";
import { test } from "node:test";
import { feedClock } from "../../test-support/feed-clock.ts";
import { createPresence } from "./presence.ts";
import type { PresencePerson } from "./api-types.ts";

function setup() {
  const clock = feedClock();
  let live = 0;
  const counted = {
    after(ms: number, fn: () => void) {
      live++;
      let done = false;
      const end = () => {
        if (!done) live--;
        done = true;
      };
      const cancel = clock.after(ms, () => {
        end();
        fn();
      });
      return () => {
        end();
        cancel();
      };
    },
  };
  const presence = createPresence({ clock: counted });
  const join = (issue: number, name: string | null) => {
    const lists: string[][] = [];
    const leave = presence.join(issue, name, (people) =>
      lists.push(people.map(show)),
    );
    return { lists, leave, last: () => lists.at(-1) };
  };
  return { clock, presence, join, timers: () => live };
}
const show = (p: PresencePerson) => (p.typing ? p.name + "*" : p.name);

test("join sends the current list at once and every change to every stream", () => {
  const s = setup();
  const ana = s.join(1, "Ana");
  assert.deepEqual(ana.lists, [["Ana"]]);
  const ben = s.join(1, "Ben");
  assert.deepEqual(ana.last(), ["Ana", "Ben"]);
  assert.deepEqual(ben.lists, [["Ana", "Ben"]]);
});

test("the same name in two streams counts once and stays until the last leave", () => {
  const s = setup();
  const a1 = s.join(1, "Ana");
  const a2 = s.join(1, "Ana");
  const ben = s.join(1, "Ben");
  assert.deepEqual(ben.lists, [["Ana", "Ben"]]);
  assert.equal(a1.lists.length, 2, "the second Ana tab changes nothing");
  a1.leave();
  assert.deepEqual(ben.lists, [["Ana", "Ben"]]);
  a2.leave();
  assert.deepEqual(ben.lists, [["Ana", "Ben"], ["Ben"]]);
});

test("an unnamed stream receives lists but is not listed", () => {
  const s = setup();
  const watcher = s.join(1, null);
  assert.deepEqual(watcher.lists, [[]]);
  const ana = s.join(1, "Ana");
  assert.deepEqual(watcher.last(), ["Ana"]);
  watcher.leave();
  assert.deepEqual(ana.lists, [["Ana"]]);
});

test("leave is idempotent and issues are independent", () => {
  const s = setup();
  const ana = s.join(1, "Ana");
  const ben = s.join(1, "Ben");
  ben.leave();
  ben.leave();
  assert.deepEqual(ana.lists, [["Ana"], ["Ana", "Ben"], ["Ana"]]);
  s.join(2, "Cleo");
  assert.equal(ana.lists.length, 3);
});

test("typing sets a flag once, refreshes the timer, and expires after typingMs", async () => {
  const s = setup();
  const ana = s.join(1, "Ana");
  s.join(1, "Ben");
  assert.equal(s.presence.typing(1, "Ben", true), true);
  assert.deepEqual(ana.last(), ["Ana", "Ben*"]);
  const count = ana.lists.length;
  await s.clock.advance(5000);
  assert.equal(s.presence.typing(1, "Ben", true), true);
  assert.equal(ana.lists.length, count, "a repeated signal sends nothing");
  await s.clock.advance(5999);
  assert.deepEqual(ana.last(), ["Ana", "Ben*"]);
  await s.clock.advance(1);
  assert.deepEqual(ana.last(), ["Ana", "Ben"]);
  assert.equal(s.timers(), 0);
});

test("typing false clears at once; typing for an absent name returns false", () => {
  const s = setup();
  const ana = s.join(1, "Ana");
  s.presence.typing(1, "Ana", true);
  assert.equal(s.presence.typing(1, "Ana", false), true);
  assert.deepEqual(ana.last(), ["Ana"]);
  assert.equal(s.timers(), 0);
  const count = ana.lists.length;
  assert.equal(s.presence.typing(1, "Ana", false), true);
  assert.equal(ana.lists.length, count);
  assert.equal(s.presence.typing(1, "Bob", true), false);
  assert.equal(s.presence.typing(9, "Ana", true), false);
  assert.equal(ana.lists.length, count);
});

test("the last leave clears the typing flag and its timer", async () => {
  const s = setup();
  const ana = s.join(1, "Ana");
  const ben = s.join(1, "Ben");
  s.presence.typing(1, "Ben", true);
  ben.leave();
  assert.deepEqual(ana.last(), ["Ana"]);
  assert.equal(s.timers(), 0);
  const count = ana.lists.length;
  await s.clock.advance(6000);
  assert.equal(ana.lists.length, count);
  const again = s.join(1, "Ben");
  assert.deepEqual(again.last(), ["Ana", "Ben"], "the flag did not survive");
});

test("a send that throws does not stop the others", () => {
  const s = setup();
  s.presence.join(1, "Ana", () => {
    throw new Error("closed");
  });
  const ben = s.join(1, "Ben");
  s.join(1, "Cleo");
  assert.deepEqual(ben.last(), ["Ana", "Ben", "Cleo"]);
});

test("a leave during a send is safe", () => {
  const s = setup();
  let leaveBen = () => {};
  const annLists: string[][] = [];
  s.presence.join(1, "Ann", (people) => {
    annLists.push(people.map(show));
    if (people.some((p) => p.name === "Cleo")) leaveBen();
  });
  const ben = s.join(1, "Ben");
  leaveBen = ben.leave;
  assert.doesNotThrow(() => s.join(1, "Cleo"));
  assert.deepEqual(annLists.at(-1), ["Ann", "Cleo"]);
});
