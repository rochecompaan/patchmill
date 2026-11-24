import type { Stall, StallCall } from "./stall-watch.ts";

const MAX_COMMAND = 200;

/**
 * Agent-written command text as a short code span. The text goes into the
 * envelope Facts and a public issue comment, so its length and quoting are
 * limited on purpose.
 */
export function quoteCommand(command: string): string {
  const flat = command.replace(/\s+/g, " ").trim().replaceAll("`", "'");
  const cut =
    flat.length > MAX_COMMAND ? `${flat.slice(0, MAX_COMMAND - 1)}…` : flat;
  return `\`${cut}\``;
}

/** "10 minutes", "1 minute", "0.02 minutes". */
export function minutesText(ms: number): string {
  const value = Math.round((ms / 60_000) * 100) / 100;
  return `${value} ${value === 1 ? "minute" : "minutes"}`;
}

/** A short duration: "12 min" or "40 s". */
export function durationText(ms: number): string {
  return ms >= 60_000
    ? `${Math.round(ms / 60_000)} min`
    : `${Math.round(ms / 1000)} s`;
}

export function callTool(call: Pick<StallCall, "tool" | "command">): string {
  return call.command !== undefined
    ? `${call.tool} ${quoteCommand(call.command)}`
    : call.tool;
}

export function callWhere(call: Pick<StallCall, "session" | "run">): string {
  if (call.run) return `subagent run ${call.run}`;
  return call.session === "implementation session"
    ? call.session
    : `subagent session ${call.session}`;
}

function callLine(call: StallCall): string {
  return `- ${callWhere(call)}: ${callTool(call)}, started ${call.startedAt}, ran ${durationText(call.runningMs)}`;
}

/** The recovery prompt after a Stall stop. */
export function recoveryPrompt(input: {
  stall: Stall;
  stopAfterMs: number;
  maxStalls: number;
  openEarlier: boolean;
  restart: boolean;
}): string {
  const { stall } = input;
  const of = input.maxStalls > 0 ? ` of ${input.maxStalls}` : "";
  const calls = stall.calls.length
    ? stall.calls.map(callLine).join("\n")
    : input.openEarlier
      ? "- none new: the calls of earlier stalls are still open"
      : "- none: the model reply made no progress";
  const runs = [
    ...new Set(stall.calls.flatMap((call) => (call.run ? [call.run] : []))),
  ];
  const stopped = input.restart
    ? "Patchmill restarted Pi. It stopped all commands and subagent runs of this session."
    : `Patchmill stopped the turn and any command of this session.${
        runs.length
          ? ` A call in a background subagent run can still be running: check run ${runs.join(", run ")} and stop it if it is stuck.`
          : ""
      }`;
  return [
    `Patchmill stopped your turn: the session and its subagent sessions showed no activity for ${minutesText(input.stopAfterMs)}. This is stall ${stall.number}${of}.`,
    `Stalled tool calls:\n${calls}`,
    `${stopped} Find out why the call made no progress. Then continue another way: for example, run a narrower command or give the command a shorter timeout. Do not run the same command again unchanged: a second stall of it stops the run. If you cannot continue, end with \`needs-input\` and say why.`,
  ].join("\n\n");
}

function stallLines(stall: Stall): string[] {
  const head =
    stall.kind === "stall-stop"
      ? `${stall.number}. No activity for ${durationText(stall.quietMs)} (stall stop).`
      : `${stall.number}. Command timeout after ${durationText(stall.quietMs)}.`;
  const calls = stall.calls.length
    ? stall.calls.map((call) => `   ${callLine(call)}`)
    : ["   - no open tool call"];
  const tried = stall.tried.length
    ? [`   Tried before it: ${stall.tried.join("; ")}`]
    : [];
  return [head, ...calls, ...tried];
}

/** The reason of the `needsInfo` stop at the Stall limit. */
export function blockReason(opening: string, stalls: readonly Stall[]): string {
  return [opening, "Stalls:", ...stalls.flatMap(stallLines)].join("\n");
}

/** The resume fact for the next Run attempt. */
export function previousStallsFact(stalls: readonly Stall[]): string {
  const seen = new Set<string>();
  const commands: string[] = [];
  for (const call of stalls.flatMap((stall) => stall.calls)) {
    const text = `${call.command !== undefined ? quoteCommand(call.command) : `\`${call.tool}\``} (${callWhere(call)})`;
    if (seen.has(text)) continue;
    seen.add(text);
    commands.push(text);
  }
  const list = commands.length ? commands.join(", ") : "none recorded";
  return `- Previous stalls: the last Run attempt stopped after repeated stalls. Stalled commands: ${list}. Do not run these commands again unchanged. Find out why they made no progress.`;
}
