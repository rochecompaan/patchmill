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
import { consoleSkillPaths } from "./skills.ts";
import {
  COMMAND_TIMEOUT_EXTENSION_PATH,
  commandLimits,
  commandLimitsEnv,
} from "../pi/command-timeout-extension.ts";
import { resolvePiSubagentsPackageRoot } from "../pi/pi-subagents-package.ts";
import { createConsoleSessionHost } from "./session-host.ts";
import { openIssueConsoleSession } from "./console-session.ts";
import type { StartRun } from "./controller.ts";
import { acquireConsoleLock, CONSOLE_SESSION_BUSY } from "./console-lock.ts";

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

/**
 * Sets the Command timeout limits on `env`, so that the Console session and
 * the pi-subagents runners it starts read them, and returns the extension
 * paths of the Console session.
 */
export function prepareConsoleExtensions(
  config: PatchmillConfig,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  Object.assign(env, commandLimitsEnv(commandLimits(config.pi)));
  return [resolvePiSubagentsPackageRoot(), COMMAND_TIMEOUT_EXTENSION_PATH];
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
  // Only one process writes an issue's Console session (terminal or web).
  const lock = await acquireConsoleLock(repoRoot, config.paths.runsDir, issue);
  if (!lock) {
    deps.output.stderr(CONSOLE_SESSION_BUSY(issue));
    return 1;
  }
  try {
    return await openConsole(config, deps, issue);
  } finally {
    await lock.release();
  }
}

async function openConsole(
  config: PatchmillConfig,
  deps: RunOnceDeps,
  issue: number,
): Promise<number> {
  const { repoRoot } = deps;
  const skillPaths = consoleSkillPaths(config, repoRoot);
  await provisionAgentDir(
    repoRoot,
    config.pi.agentDir,
    config.pi.timeoutMinutes,
    skillPaths,
  );
  const agentDir = resolve(repoRoot, config.pi.agentDir);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const additionalExtensionPaths = prepareConsoleExtensions(config);
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
    retro: { config, repoRoot, host: deps.host, now: deps.now },
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
          additionalExtensionPaths,
          extensionFactories: [{ name: "patchmill", factory: host.factory }],
          additionalSkillPaths: skillPaths,
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
