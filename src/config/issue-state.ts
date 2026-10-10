import {
  configError,
  isRecord,
  readOptionalLiteral,
  readOptionalStringArray,
} from "./parse-helpers.ts";
import type { PartialConfig } from "./partial.ts";
import type { PatchmillConfig } from "./types.ts";

function cloneStringArray(values: string[]): string[] {
  return [...values];
}

export function cloneIssueStateConfig(
  issueState: PatchmillConfig["issueState"],
): PatchmillConfig["issueState"] {
  return issueState.provider === "comments"
    ? {
        provider: "comments",
        ...(issueState.trustedAuthors === undefined
          ? {}
          : { trustedAuthors: cloneStringArray(issueState.trustedAuthors) }),
      }
    : { provider: "labels" };
}

export function mergeIssueStateConfig(
  base: PatchmillConfig["issueState"],
  update: PartialConfig["issueState"] | undefined,
): PatchmillConfig["issueState"] {
  if (update === undefined) return cloneIssueStateConfig(base);
  if (update.provider === "comments") {
    return {
      provider: "comments",
      ...("trustedAuthors" in update && update.trustedAuthors !== undefined
        ? { trustedAuthors: cloneStringArray(update.trustedAuthors) }
        : {}),
    };
  }
  if (update.provider === "labels") return { provider: "labels" };
  return cloneIssueStateConfig(base);
}

export function readIssueStateConfig(
  source: Record<string, unknown>,
): PartialConfig["issueState"] | undefined {
  const value = source.issueState;
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw configError("issueState", "an object", value);

  const provider = readOptionalLiteral(
    value,
    "provider",
    "issueState.provider",
    ["labels", "comments"],
  );
  const trustedAuthors = readOptionalStringArray(
    value,
    "trustedAuthors",
    "issueState.trustedAuthors",
  );
  if (trustedAuthors !== undefined) {
    for (const [index, author] of trustedAuthors.entries()) {
      if (author.trim().length === 0) {
        throw configError(
          `issueState.trustedAuthors[${index}]`,
          "a non-empty string",
          author,
        );
      }
    }
  }

  for (const key of Object.keys(value)) {
    if (key !== "provider" && key !== "trustedAuthors") {
      throw configError(
        `issueState.${key}`,
        "a supported issue-state setting",
        value[key],
      );
    }
  }

  if (provider === undefined && trustedAuthors === undefined) return undefined;
  if (provider === "labels") {
    if (trustedAuthors !== undefined) {
      throw configError(
        "issueState.trustedAuthors",
        'only valid when issueState.provider is "comments"',
        trustedAuthors,
      );
    }
    return { provider: "labels" };
  }
  if (provider === "comments") {
    return {
      provider: "comments",
      ...(trustedAuthors === undefined ? {} : { trustedAuthors }),
    };
  }
  throw configError("issueState.provider", "a configured provider", provider);
}
