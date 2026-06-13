import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import { createWorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import { ApprovalRequiredError } from "./workflow-state.ts";
import { selectIssue } from "./selection.ts";
import type { IssueSummary } from "./types.ts";

const {
  done,
  inProgress,
  needsInfo,
  ready,
  priorities: [critical, high, medium, low],
  unsuitable,
} = DEFAULT_PATCHMILL_CONFIG.labels;

function issue(number: number, labels: string[], state = "open"): IssueSummary {
  return {
    number,
    title: `Issue ${number}`,
    body: "",
    labels,
    state,
  };
}

function specApprovalPolicy(approvedLabel = "spec-approved") {
  return createWorkflowApprovalPolicy({
    ...DEFAULT_PATCHMILL_CONFIG.workflow,
    specApproval: {
      ...DEFAULT_PATCHMILL_CONFIG.workflow.specApproval,
      required: true,
      approvedLabel,
    },
  });
}

test("selectIssue chooses the highest-priority agent-ready issue", () => {
  const selected = selectIssue(
    [
      issue(8, [ready, medium]),
      issue(3, [ready, critical]),
      issue(2, [ready, high]),
      issue(1, [ready]),
    ],
    { readyLabel: ready },
  );

  assert.equal(selected?.number, 3);
});

test("selectIssue honors custom priority ordering", () => {
  const selected = selectIssue(
    [issue(4, [ready, "priority:p0"]), issue(2, [ready, "priority:p1"])],
    {
      readyLabel: ready,
      priorityLabels: ["priority:p1", "priority:p0"],
    },
  );

  assert.equal(selected?.number, 2);
});

test("selectIssue breaks ties by lowest issue number within a priority bucket", () => {
  const selected = selectIssue(
    [
      issue(12, [ready, high]),
      issue(4, [ready, high]),
      issue(9, [ready, high]),
    ],
    { readyLabel: ready },
  );

  assert.equal(selected?.number, 4);
});

test("selectIssue treats multiple priority labels as the highest priority present", () => {
  const selected = selectIssue(
    [issue(7, [ready, low, critical]), issue(2, [ready, high])],
    { readyLabel: ready },
  );

  assert.equal(selected?.number, 7);
});

test("selectIssue ignores issues with non-ready triage or protection labels", () => {
  const selected = selectIssue(
    [
      issue(1, [ready, critical, needsInfo]),
      issue(2, [ready, critical, unsuitable]),
      issue(3, [ready, critical, inProgress]),
      issue(4, [ready, critical, done]),
      issue(5, [ready, high]),
    ],
    { readyLabel: ready },
  );

  assert.equal(selected?.number, 5);
});

test("selectIssue uses triage policy ready label, protection labels, and priority ordering", () => {
  const triagePolicy = createTriagePolicy({
    ...DEFAULT_PATCHMILL_CONFIG.labels,
    ready: "ready-for-bots",
    needsInfo: "needs-clarification",
    unsuitable: "manual-only",
    inProgress: "claimed",
    done: "done-by-bot",
    blocked: "waiting",
    priorities: ["priority:p1", "priority:p2"],
  });

  const selected = selectIssue(
    [
      issue(1, ["ready-for-bots", "priority:p2", "claimed"]),
      issue(2, ["ready-for-bots", "priority:p2"]),
      issue(3, ["ready-for-bots", "priority:p1"]),
    ],
    {
      readyLabel: "ready-for-bots",
      triagePolicy,
    },
  );

  assert.equal(selected?.number, 3);
});

test("selectIssue honors custom excluded labels during automatic selection", () => {
  const selected = selectIssue(
    [issue(1, [ready, critical, "paused"]), issue(2, [ready, high])],
    {
      readyLabel: ready,
      excludedLabels: ["paused"],
    },
  );

  assert.equal(selected?.number, 2);
});

test("selectIssue combines custom excluded labels with state-map blockers", () => {
  const triagePolicy = createTriagePolicy(
    {
      ...DEFAULT_PATCHMILL_CONFIG.labels,
      ready: "ready-for-agent",
      unsuitable: "ready-for-human",
    },
    {
      stateMap: {
        "ready-for-agent": "agent-ready",
        "needs-info": "needs-info",
        "ready-for-human": "agent-unsuitable",
        wontfix: "agent-unsuitable",
      },
    },
  );

  const selected = selectIssue(
    [
      issue(1, ["ready-for-agent", critical, "needs-info"]),
      issue(2, ["ready-for-agent", high, "paused"]),
      issue(3, ["ready-for-agent", medium]),
    ],
    {
      readyLabel: "ready-for-agent",
      triagePolicy,
      excludedLabels: ["paused"],
    },
  );

  assert.equal(selected?.number, 3);
});

test("selectIssue blocks labels mapped to non-ready triage states", () => {
  const triagePolicy = createTriagePolicy(
    {
      ...DEFAULT_PATCHMILL_CONFIG.labels,
      ready: "ready-for-agent",
      unsuitable: "ready-for-human",
    },
    {
      stateMap: {
        "ready-for-agent": "agent-ready",
        "needs-info": "needs-info",
        "ready-for-human": "agent-unsuitable",
        wontfix: "agent-unsuitable",
      },
    },
  );

  const selected = selectIssue(
    [
      issue(1, ["ready-for-agent", critical, "ready-for-human"]),
      issue(2, ["ready-for-agent", critical, "wontfix"]),
      issue(3, ["ready-for-agent", critical, "needs-info"]),
      issue(5, ["ready-for-agent", high]),
    ],
    {
      readyLabel: "ready-for-agent",
      triagePolicy,
    },
  );

  assert.equal(selected?.number, 5);
});

test("selectIssue automatic selection includes agent-ready when spec approval is required", () => {
  const selected = selectIssue(
    [issue(1, [ready, critical]), issue(2, [ready, high, "spec-approved"])],
    { readyLabel: ready, approvalPolicy: specApprovalPolicy() },
  );

  assert.equal(selected?.number, 1);
});

test("selectIssue automatic selection includes spec-approved without agent-ready", () => {
  const selected = selectIssue(
    [issue(1, ["spec-approved", high]), issue(2, [ready, low])],
    { readyLabel: ready, approvalPolicy: specApprovalPolicy() },
  );

  assert.equal(selected?.number, 1);
});

test("selectIssue automatic selection includes plan-approved without agent-ready", () => {
  const policyWithPlan = createWorkflowApprovalPolicy({
    ...DEFAULT_PATCHMILL_CONFIG.workflow,
    planApproval: {
      ...DEFAULT_PATCHMILL_CONFIG.workflow.planApproval,
      required: true,
    },
  });

  const selected = selectIssue(
    [issue(1, ["plan-approved", high]), issue(2, [ready, low])],
    { readyLabel: ready, approvalPolicy: policyWithPlan },
  );

  assert.equal(selected?.number, 1);
});

test("selectIssue automatic selection ignores review-only workflow states", () => {
  const policyWithBoth = createWorkflowApprovalPolicy({
    specApproval: {
      ...DEFAULT_PATCHMILL_CONFIG.workflow.specApproval,
      required: true,
    },
    planApproval: {
      ...DEFAULT_PATCHMILL_CONFIG.workflow.planApproval,
      required: true,
    },
  });

  const selected = selectIssue(
    [issue(1, ["spec-review", critical]), issue(2, ["plan-review", high])],
    { readyLabel: ready, approvalPolicy: policyWithBoth },
  );

  assert.equal(selected, undefined);
});

test("selectIssue rejects explicit issue waiting for spec approval", () => {
  assert.throws(
    () =>
      selectIssue([issue(5, ["spec-review"])], {
        readyLabel: ready,
        issueNumber: 5,
        approvalPolicy: specApprovalPolicy("spec-ok"),
      }),
    (error: unknown) => {
      assert(error instanceof ApprovalRequiredError);
      assert.equal(error.missingLabel, "spec-ok");
      return true;
    },
  );
});

test("selectIssue accepts explicit spec-approved issue without agent-ready", () => {
  const selected = selectIssue([issue(5, ["spec-approved"])], {
    readyLabel: ready,
    issueNumber: 5,
    approvalPolicy: specApprovalPolicy(),
  });

  assert.equal(selected?.number, 5);
});

test("selectIssue returns no issue when no open agent-ready issue exists", () => {
  const selected = selectIssue(
    [issue(1, [critical]), issue(2, [ready], "closed"), issue(3, [needsInfo])],
    { readyLabel: ready },
  );

  assert.equal(selected, undefined);
});

test("selectIssue accepts an explicit open agent-ready issue", () => {
  const selected = selectIssue(
    [issue(5, [ready]), issue(6, [ready, critical])],
    { readyLabel: ready, issueNumber: 5 },
  );

  assert.equal(selected?.number, 5);
});

test("selectIssue rejects an explicit open issue without agent-ready", () => {
  assert.throws(
    () =>
      selectIssue([issue(5, [critical]), issue(6, [ready, low])], {
        readyLabel: ready,
        issueNumber: 5,
      }),
    new RegExp(`Issue #5 is open but not labeled ${ready}`),
  );
});

test("selectIssue rejects an explicit open issue that is in progress", () => {
  assert.throws(
    () =>
      selectIssue(
        [issue(7, [ready, critical, inProgress]), issue(8, [ready])],
        { readyLabel: ready, issueNumber: 7 },
      ),
    new RegExp(
      `Issue #7 is open but not eligible because it has ${inProgress}`,
    ),
  );
});

test("selectIssue rejects an explicit open issue that is already done", () => {
  assert.throws(
    () =>
      selectIssue([issue(9, [ready, critical, done]), issue(10, [ready])], {
        readyLabel: ready,
        issueNumber: 9,
      }),
    new RegExp(`Issue #9 is open but not eligible because it has ${done}`),
  );
});

test("selectIssue rejects an explicit open issue with a custom excluded label", () => {
  assert.throws(
    () =>
      selectIssue([issue(11, [ready, "paused"]), issue(12, [ready])], {
        readyLabel: ready,
        issueNumber: 11,
        excludedLabels: ["paused"],
      }),
    /Issue #11 is open but not eligible because it has paused/,
  );
});

test("selectIssue returns no issue when the explicit issue is not open", () => {
  const selected = selectIssue(
    [issue(9, [ready], "closed"), issue(10, [ready])],
    { readyLabel: ready, issueNumber: 9 },
  );

  assert.equal(selected, undefined);
});
