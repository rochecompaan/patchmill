import type {
  AgentIssueProgressEvent,
  CommandResult,
} from "../../src/cli/commands/run-once/types.ts";
import type { Call } from "./mock-runner.ts";

export function commentBody(call: Call | undefined): string {
  const separator = call?.args.indexOf("--") ?? -1;
  return separator >= 0 ? (call?.args[separator + 1] ?? "") : "";
}

export function collectProgressEvents(): {
  events: AgentIssueProgressEvent[];
  progress: { event: (event: AgentIssueProgressEvent) => void };
} {
  const events: AgentIssueProgressEvent[] = [];
  return {
    events,
    progress: {
      event: (event) => {
        events.push(event);
      },
    },
  };
}

export function gitBaseContainmentResult(
  call: Call,
): CommandResult | undefined {
  if (call.command !== "git") return undefined;
  if (call.args[0] === "rev-parse" && call.args[1] === "--verify") {
    return { code: 0, stdout: "commit-sha\n", stderr: "" };
  }
  if (
    call.args[0] === "log" &&
    call.args[1] === "--oneline" &&
    call.args[2]?.startsWith("refs/remotes/")
  ) {
    return { code: 0, stdout: "", stderr: "" };
  }
  return undefined;
}

export function gitBaseContainmentFailure(
  call: Call,
): CommandResult | undefined {
  if (call.command !== "git") return undefined;
  if (call.args[0] === "rev-parse" && call.args[1] === "--verify") {
    return { code: 0, stdout: "commit-sha\n", stderr: "" };
  }
  if (
    call.args[0] === "log" &&
    call.args[1] === "--oneline" &&
    call.args[2]?.startsWith("refs/remotes/")
  ) {
    return {
      code: 0,
      stdout: "abc1234 chore: initialize Patchmill\n",
      stderr: "",
    };
  }
  return undefined;
}
