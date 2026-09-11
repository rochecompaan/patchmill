import { planningImplementationFinishCheckpointKeys } from "./planning-state-types.ts";
import type { PlanningImplementationFinishCheckpoints } from "./planning-state-types.ts";
import {
  artifactPath,
  branch,
  fail,
  nonblankSingleLine,
  nonnegativeFinite,
  object,
  objectWithOptionalKeys,
  oid,
  safeUrl,
  singleLine,
} from "./planning-state-codec.ts";

export function implementationRunCost(value: unknown, path: string) {
  const parsed = object(
    value,
    ["stages", "promptTokens", "outputTokens", "estimatedCostUsd"],
    path,
  );
  if (!Array.isArray(parsed.stages)) fail("expected-array", `${path}.stages`);
  const model = (entry: unknown, entryPath: string) => {
    const parsedModel = object(
      entry,
      ["model", "promptTokens", "outputTokens", "estimatedCostUsd"],
      entryPath,
    );
    return {
      model: singleLine(parsedModel.model, `${entryPath}.model`),
      promptTokens: nonnegativeFinite(
        parsedModel.promptTokens,
        `${entryPath}.promptTokens`,
      ),
      outputTokens: nonnegativeFinite(
        parsedModel.outputTokens,
        `${entryPath}.outputTokens`,
      ),
      estimatedCostUsd: nonnegativeFinite(
        parsedModel.estimatedCostUsd,
        `${entryPath}.estimatedCostUsd`,
      ),
    };
  };
  return {
    stages: (parsed.stages as unknown[]).map((entry, index) => {
      const entryPath = `${path}.stages[${index}]`;
      const stage = object(
        entry,
        ["stage", "models", "promptTokens", "outputTokens", "estimatedCostUsd"],
        entryPath,
      );
      const models = stage.models;
      if (!Array.isArray(models)) fail("expected-array", `${entryPath}.models`);
      const modelEntries = models as unknown[];
      return {
        stage: singleLine(stage.stage, `${entryPath}.stage`),
        models: modelEntries.map((modelEntry, modelIndex) =>
          model(modelEntry, `${entryPath}.models[${modelIndex}]`),
        ),
        promptTokens: nonnegativeFinite(
          stage.promptTokens,
          `${entryPath}.promptTokens`,
        ),
        outputTokens: nonnegativeFinite(
          stage.outputTokens,
          `${entryPath}.outputTokens`,
        ),
        estimatedCostUsd: nonnegativeFinite(
          stage.estimatedCostUsd,
          `${entryPath}.estimatedCostUsd`,
        ),
      };
    }),
    promptTokens: nonnegativeFinite(
      parsed.promptTokens,
      `${path}.promptTokens`,
    ),
    outputTokens: nonnegativeFinite(
      parsed.outputTokens,
      `${path}.outputTokens`,
    ),
    estimatedCostUsd: nonnegativeFinite(
      parsed.estimatedCostUsd,
      `${path}.estimatedCostUsd`,
    ),
  };
}
export function implementationEvidence(value: unknown, path: string) {
  const parsed = objectWithOptionalKeys(
    value,
    ["status", "prUrl", "branch", "commits", "validation", "visualEvidence"],
    ["reviewSummary", "landingDecision", "runCostReport"],
    path,
  );
  if (parsed.status !== "pr-created")
    fail("invalid-implementation-status", `${path}.status`);
  const entries = (items: unknown, itemPath: string) => {
    if (!Array.isArray(items) || items.length === 0)
      fail("expected-nonempty-array", itemPath);
    return (items as unknown[]).map((entry: unknown, index: number) =>
      nonblankSingleLine(entry, `${itemPath}[${index}]`),
    );
  };
  if (!Array.isArray(parsed.visualEvidence))
    fail("expected-array", `${path}.visualEvidence`);
  return {
    status: "pr-created" as const,
    prUrl: safeUrl(parsed.prUrl, `${path}.prUrl`),
    branch: branch(parsed.branch, `${path}.branch`),
    commits: entries(parsed.commits, `${path}.commits`).map(
      (entry: string, index: number) => oid(entry, `${path}.commits[${index}]`),
    ),
    validation: entries(parsed.validation, `${path}.validation`),
    ...(parsed.reviewSummary === undefined
      ? {}
      : {
          reviewSummary: singleLine(
            parsed.reviewSummary,
            `${path}.reviewSummary`,
          ),
        }),
    ...(parsed.landingDecision === undefined
      ? {}
      : {
          landingDecision: singleLine(
            parsed.landingDecision,
            `${path}.landingDecision`,
          ),
        }),
    visualEvidence: (parsed.visualEvidence as unknown[]).map(
      (entry: unknown, index: number) => {
        const visualPath = `${path}.visualEvidence[${index}]`;
        const visual = objectWithOptionalKeys(
          entry,
          ["screenshotPath"],
          ["caption", "referencePaths", "url"],
          visualPath,
        );
        const references = visual.referencePaths;
        if (references !== undefined && !Array.isArray(references))
          fail("expected-array", `${visualPath}.referencePaths`);
        const referencePaths =
          references === undefined
            ? undefined
            : (references as unknown[]).map((reference, referenceIndex) =>
                artifactPath(
                  reference,
                  `${visualPath}.referencePaths[${referenceIndex}]`,
                ),
              );
        if (
          referencePaths !== undefined &&
          new Set(referencePaths).size !== referencePaths.length
        )
          fail("duplicate-value", `${visualPath}.referencePaths`);
        return {
          screenshotPath: artifactPath(
            visual.screenshotPath,
            `${visualPath}.screenshotPath`,
          ),
          ...(visual.caption === undefined
            ? {}
            : { caption: singleLine(visual.caption, `${visualPath}.caption`) }),
          ...(referencePaths === undefined ? {} : { referencePaths }),
          ...(visual.url === undefined
            ? {}
            : { url: safeUrl(visual.url, `${visualPath}.url`) }),
        };
      },
    ),
    ...(parsed.runCostReport === undefined
      ? {}
      : {
          runCostReport: implementationRunCost(
            parsed.runCostReport,
            `${path}.runCostReport`,
          ),
        }),
  };
}
export function implementationFinish(value: unknown, path: string) {
  const allowed = planningImplementationFinishCheckpointKeys;
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("expected-object", path);
  const parsed = value as Record<string, unknown>;
  for (const key of Object.keys(parsed))
    if (!(allowed as readonly string[]).includes(key))
      fail("unknown-key", `${path}.${key}`);
  for (const key of Object.keys(parsed))
    if (parsed[key] !== true) fail("invalid-checkpoint", `${path}.${key}`);
  for (let index = 1; index < allowed.length; index += 1)
    if (
      parsed[allowed[index]!] === true &&
      parsed[allowed[index - 1]!] !== true
    )
      fail("skipped-finish-checkpoint", `${path}.${allowed[index]}`);
  return parsed as PlanningImplementationFinishCheckpoints;
}
