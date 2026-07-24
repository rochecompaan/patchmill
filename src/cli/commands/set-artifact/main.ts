#!/usr/bin/env node
import { cwd } from "node:process";
import { pathToFileURL } from "node:url";
import { loadPatchmillConfigState } from "../../../config/load.ts";
import { createIssueHostProvider } from "../../../host/factory.ts";
import { type WorkflowArtifactKind } from "../../../workflow/artifacts/published-artifacts.ts";
import {
  publishWorkflowArtifact,
  type PublishComment,
} from "../../../workflow/artifacts/publish-artifact.ts";
export type { PublishComment } from "../../../workflow/artifacts/publish-artifact.ts";
import { createCommandRunner } from "../triage/command.ts";

export type SetArtifactOutput = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export type SetArtifactCommandOptions = {
  repoRoot?: string;
  env?: Record<string, string | undefined>;
  output?: SetArtifactOutput;
  publishComment?: PublishComment;
};

type ParsedArgs = {
  showHelp: boolean;
  issueNumber?: number;
  path?: string;
};

const DEFAULT_OUTPUT: SetArtifactOutput = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

function artifactName(kind: WorkflowArtifactKind): string {
  return kind === "spec" ? "spec" : "plan";
}

function artifactDescription(kind: WorkflowArtifactKind): string {
  return kind === "spec" ? "spec" : "implementation plan";
}

export function helpText(kind: WorkflowArtifactKind): string {
  const command = kind === "spec" ? "set-spec" : "set-plan";
  return `Usage:
  patchmill ${command} --issue <number> <path>

Set the authoritative ${artifactDescription(kind)} for an issue from a local file.
The file is published to the issue in Patchmill's deterministic artifact format.

Options:
  --help, -h          Show this help and exit.
  --issue <number>    Issue number to update.
  --host-login <name> Use a named host login when the provider supports named logins.
  --tea-login <name>  Compatibility alias for --host-login.
`;
}

function parsePositiveIssue(value: string | undefined): number {
  if (!value || value.startsWith("--")) {
    throw new Error("--issue requires a value");
  }
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error("--issue must be a positive integer");
  }
  return Number(value);
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = { showHelp: false };
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.showHelp = true;
      continue;
    }
    if (arg === "--issue") {
      parsed.issueNumber = parsePositiveIssue(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--host-login" || arg === "--tea-login") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      continue;
    }
    if (arg?.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (arg) positional.push(arg);
  }

  if (positional.length > 1) {
    throw new Error("Only one artifact path may be provided");
  }
  parsed.path = positional[0];
  return parsed;
}

async function defaultPublishComment(
  repoRoot: string,
  args: string[],
  env: Record<string, string | undefined>,
): Promise<PublishComment> {
  const { config } = await loadPatchmillConfigState(repoRoot, env, args);
  const host = createIssueHostProvider({
    runner: createCommandRunner(),
    repoRoot,
    host: config.host,
  });
  return (issueNumber, body) => host.commentIssue(issueNumber, body);
}

async function loadConfigForValidation(
  repoRoot: string,
  env: Record<string, string | undefined>,
  args: string[],
) {
  return (await loadPatchmillConfigState(repoRoot, env, args)).config;
}

export async function runSetArtifactCommand(
  kind: WorkflowArtifactKind,
  args: string[],
  options: SetArtifactCommandOptions = {},
): Promise<number> {
  const output = options.output ?? DEFAULT_OUTPUT;
  const parsed = parseArgs(args);
  if (parsed.showHelp) {
    output.stdout(helpText(kind));
    return 0;
  }
  if (parsed.issueNumber === undefined) {
    throw new Error("--issue is required");
  }
  if (!parsed.path) {
    throw new Error(`${artifactName(kind)} path is required`);
  }

  const repoRoot = options.repoRoot ?? cwd();
  const env = options.env ?? process.env;
  const config = await loadConfigForValidation(repoRoot, env, args);
  const expectedDir =
    kind === "spec" ? config.paths.specsDir : config.paths.plansDir;
  const publishComment =
    options.publishComment ??
    (await defaultPublishComment(repoRoot, args, env));
  const published = await publishWorkflowArtifact({
    kind,
    issueNumber: parsed.issueNumber,
    repoRoot,
    artifactPath: parsed.path,
    artifactDir: expectedDir,
    publishComment,
  });
  output.stdout(
    `Set ${artifactName(kind)} for issue #${parsed.issueNumber} from ${published.path}.`,
  );
  return 0;
}

export function createMain(
  kind: WorkflowArtifactKind,
): (args?: string[]) => Promise<number> {
  return async (args = process.argv.slice(2)): Promise<number> => {
    try {
      return await runSetArtifactCommand(kind, args);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  };
}

export const specMain = createMain("spec");
export const planMain = createMain("plan");

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  process.exitCode = await specMain();
}
