import { resolve } from "node:path";
import {
  createAgentSessionRuntime,
  createAgentSessionServices,
  createAgentSessionFromServices,
  InteractiveMode,
  type AgentSessionRuntime,
  type AgentSessionRuntimeDiagnostic,
} from "@earendil-works/pi-coding-agent";
import type { PatchmillConfig } from "../config/config.ts";
import { provisionAgentDir } from "../cli/commands/init/agent-dir.ts";
import { runOneIssue, type RunOnceDeps } from "../kernel/run-once.ts";
import { resolvePhaseSkill } from "../kernel/phase-skill.ts";
import { resolvePiSubagentsPackageRoot } from "../pi/pi-subagents-package.ts";
import { createConsoleSessionHost } from "./session-host.ts";
import { openIssueConsoleSession } from "./console-session.ts";
import type { StartRun } from "./controller.ts";

export function collectConsoleDiagnostics(
  diagnostics: AgentSessionRuntimeDiagnostic[],
  extensions: {
    errors: { path: string; error: string }[];
    warnings?: { path: string; warning: string }[];
  },
): AgentSessionRuntimeDiagnostic[] {
  return [
    ...diagnostics,
    ...extensions.errors.map(({ path, error }) => ({
      type: "error" as const,
      message: `Failed to load extension "${path}": ${error}`,
    })),
    ...(extensions.warnings ?? []).map(({ path, warning }) => ({
      type: "warning" as const,
      message: `Extension package "${path}": ${warning}`,
    })),
  ];
}

export async function runConsoleRuntime(
  runtime: Pick<AgentSessionRuntime, "diagnostics" | "dispose">,
  run: () => Promise<void>,
  stderr: (line: string) => void,
  beforeDispose: () => Promise<void> = async () => {},
  fatalSwitch?: Promise<string>,
): Promise<number> {
  // InteractiveMode disposes the host itself on quit and signals. Intercept that
  // boundary, not just the return from run(), before extension teardown begins.
  const dispose = runtime.dispose.bind(runtime);
  let disposal: Promise<void> | undefined;
  runtime.dispose = () =>
    (disposal ??= (async () => {
      try {
        await beforeDispose();
      } finally {
        await dispose();
      }
    })());
  try {
    for (const diagnostic of runtime.diagnostics) stderr(diagnostic.message);
    if (runtime.diagnostics.some((diagnostic) => diagnostic.type === "error"))
      return 1;
    const failure = await Promise.race([
      run().then(() => undefined),
      ...(fatalSwitch ? [fatalSwitch] : []),
    ]);
    if (failure !== undefined) {
      stderr(failure);
      return 1;
    }
    return 0;
  } finally {
    await runtime.dispose();
  }
}

export function createStartRun(
  config: PatchmillConfig,
  deps: RunOnceDeps,
  run: typeof runOneIssue = runOneIssue,
): StartRun {
  return (issue, human, observe) =>
    run(
      config,
      {
        ...deps,
        human,
        observe,
        output: {
          stdout: (line) => human.notify(line),
          stderr: (line) => human.notify(line),
        },
      },
      issue !== undefined ? { issue } : {},
    );
}

export async function startConsole(input: {
  config: PatchmillConfig;
  deps: RunOnceDeps;
  issue: number;
}): Promise<number> {
  const { config, deps, issue } = input;
  const { repoRoot } = deps;
  await provisionAgentDir(repoRoot, config.pi.agentDir);
  const agentDir = resolve(repoRoot, config.pi.agentDir);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const sessionManager = await openIssueConsoleSession(
    repoRoot,
    config.paths.runsDir,
    issue,
  );
  const fatalSwitch = Promise.withResolvers<string>();
  const host = createConsoleSessionHost({
    repoRoot,
    runsDir: config.paths.runsDir,
    issue,
    startRun: createStartRun(config, deps),
    onFatalSwitch: (nextIssue, error) =>
      fatalSwitch.resolve(
        `${error instanceof Error ? error.message : String(error)}\nRun \`patchmill run-once --interactive --issue ${nextIssue}\` to continue.`,
      ),
    // Called only by the user-initiated slash command, preserving the repo cwd.
    switchSession: (path) =>
      runtime.switchSession(path, { cwdOverride: repoRoot }),
  });
  const runtime = await createAgentSessionRuntime(
    async (target) => {
      const services = await createAgentSessionServices({
        cwd: target.cwd,
        agentDir: target.agentDir,
        resourceLoaderOptions: {
          additionalExtensionPaths: [resolvePiSubagentsPackageRoot()],
          extensionFactories: [{ name: "patchmill", factory: host.factory }],
          additionalSkillPaths: (["planning", "implementation"] as const).map(
            (phase) => resolvePhaseSkill(config, repoRoot, phase).path,
          ),
        },
      });
      const created = await createAgentSessionFromServices({
        services,
        sessionManager: target.sessionManager,
        ...(target.sessionStartEvent
          ? { sessionStartEvent: target.sessionStartEvent }
          : {}),
      });
      return {
        ...created,
        services,
        diagnostics: collectConsoleDiagnostics(
          services.diagnostics,
          services.resourceLoader.getExtensions(),
        ),
      };
    },
    { cwd: repoRoot, agentDir, sessionManager },
  );
  const mode = new InteractiveMode(runtime);
  try {
    return await runConsoleRuntime(
      runtime,
      () => mode.run(),
      deps.output.stderr,
      () => host.shutdown(),
      fatalSwitch.promise,
    );
  } finally {
    mode.stop();
  }
}
