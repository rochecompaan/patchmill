import assert from "node:assert/strict";
import { test } from "node:test";
import { presentationFor } from "../../web/state.js";
import { personClass } from "../../web/dom.js";
import { createSampleRunDataSource } from "./sample-data.ts";

test("status presentation supplies consistent card, metadata, and composer feedback", async () => {
  const snapshot = await createSampleRunDataSource().snapshot();
  const expected = [
    [206, "Not started", "dot", "", null, "Click Start planning"],
    [
      250,
      "Agent working",
      "dot dot-live",
      "is-live",
      "Live",
      "The agent is working.",
    ],
    [
      227,
      "Waiting for reply",
      "dot dot-wait",
      "is-waiting",
      "Waiting for reply",
      "The agent is waiting",
    ],
    [901, "Paused", "dot", "", "Paused", "This run is paused."],
    [210, "Agent idle", "dot", "", null, "The agent is idle."],
    [
      247,
      "Blocked",
      "dot dot-blocked",
      "is-blocked",
      null,
      "This run is blocked.",
    ],
    [231, "Finished", "dot", "", null, "This run has finished."],
  ] as const;
  for (const [number, label, dotClass, cardClass, marker, hint] of expected) {
    const p = presentationFor(snapshot.details[number]!.summary);
    assert.equal(p.statusLabel, label);
    assert.equal(p.dotClass, dotClass);
    assert.equal(p.cardClass, cardClass);
    assert.equal(p.marker?.label ?? null, marker);
    assert.ok(p.composerHint.startsWith(hint), p.composerHint);
  }
  const terminal = presentationFor(snapshot.details[263]!.summary);
  assert.match(terminal.composerHint, /terminal.*263/);
});

test("avatar color selection hashes every name without a fixture exception", () => {
  assert.equal(personClass("a"), "who-3");
  assert.equal(personClass("f"), "who-3");
  assert.equal(personClass("roche"), "who-5");
});
