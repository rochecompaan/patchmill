import { resolve } from "node:path";
import {
  SessionManager,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createAgentSessionFromServices,
  InteractiveMode,
} from "@earendil-works/pi-coding-agent";
import type { PatchmillConfig } from "../config/config.ts";
import { provisionAgentDir } from "../cli/commands/init/agent-dir.ts";
import { runOneIssue, type RunOnceDeps } from "../kernel/run-once.ts";
import { resolvePhaseSkill } from "../kernel/phase-skill.ts";
import { resolvePiSubagentsPackageRoot } from "../pi/pi-subagents-package.ts";
import { createPatchmillExtension } from "./extension.ts";

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
  const sessionManager = SessionManager.continueRecent(
    repoRoot,
    resolve(repoRoot, config.paths.runsDir, "console/sessions"),
  );
  const factory = createPatchmillExtension({
    firstIssue: issue,
    startRun: (issue, human, observe) =>
      runOneIssue(
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
        { issue },
      ),
  });
  const runtime = await createAgentSessionRuntime(
    async (target) => {
      const services = await createAgentSessionServices({
        cwd: target.cwd,
        agentDir: target.agentDir,
        resourceLoaderOptions: {
          additionalExtensionPaths: [resolvePiSubagentsPackageRoot()],
          extensionFactories: [{ name: "patchmill", factory }],
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
      return { ...created, services, diagnostics: services.diagnostics };
    },
    { cwd: repoRoot, agentDir, sessionManager },
  );
  try {
    await new InteractiveMode(runtime).run();
  } finally {
    await runtime.dispose();
  }
  return 0;
}
