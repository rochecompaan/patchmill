import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalBucketForLabels,
  defaultTriageStateMap,
  nonReadyStateLabels,
  validateTriageStateMap,
} from "./triage-state.ts";

test("defaultTriageStateMap maps configured bucket labels", () => {
  assert.deepEqual(
    defaultTriageStateMap({
      ready: "ready-for-agent",
      needsInfo: "needs-info",
      unsuitable: "ready-for-human",
    }),
    {
      "ready-for-agent": "agent-ready",
      "needs-info": "needs-info",
      "ready-for-human": "agent-unsuitable",
    },
  );
});

test("validateTriageStateMap accepts supported canonical buckets", () => {
  assert.deepEqual(
    validateTriageStateMap(
      {
        "ready-for-agent": "agent-ready",
        "needs-info": "needs-info",
        "ready-for-human": "agent-unsuitable",
      },
      "ready-for-agent",
    ),
    {
      "ready-for-agent": "agent-ready",
      "needs-info": "needs-info",
      "ready-for-human": "agent-unsuitable",
    },
  );
});

test("validateTriageStateMap rejects unsupported canonical buckets", () => {
  assert.throws(
    () =>
      validateTriageStateMap(
        {
          "ready-for-agent": "agent-ready",
          deferred: "later",
        } as Record<string, string>,
        "ready-for-agent",
      ),
    /triage\.stateMap\.deferred must be one of agent-ready, needs-info, agent-unsuitable/,
  );
});

test("validateTriageStateMap requires the ready label to map to agent-ready", () => {
  assert.throws(
    () =>
      validateTriageStateMap(
        {
          "ready-for-agent": "needs-info",
        },
        "ready-for-agent",
      ),
    /triage\.stateMap must map ready label ready-for-agent to agent-ready/,
  );
});

test("nonReadyStateLabels returns labels that should block run-once", () => {
  assert.deepEqual(
    nonReadyStateLabels({
      "ready-for-agent": "agent-ready",
      "needs-info": "needs-info",
      "ready-for-human": "agent-unsuitable",
      wontfix: "agent-unsuitable",
    }),
    ["needs-info", "ready-for-human", "wontfix"],
  );
});

test("canonicalBucketForLabels resolves labels by configured precedence", () => {
  const stateMap = {
    "ready-for-agent": "agent-ready",
    "needs-info": "needs-info",
    "ready-for-human": "agent-unsuitable",
  } as const;

  assert.equal(
    canonicalBucketForLabels(["bug", "ready-for-agent"], stateMap),
    "agent-ready",
  );
  assert.equal(
    canonicalBucketForLabels(["bug", "needs-info"], stateMap),
    "needs-info",
  );
  assert.equal(
    canonicalBucketForLabels(["bug", "ready-for-human"], stateMap),
    "agent-unsuitable",
  );
  assert.equal(canonicalBucketForLabels(["bug"], stateMap), undefined);
});
