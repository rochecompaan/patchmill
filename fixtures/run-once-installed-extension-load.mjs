import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

const SENTINEL_PAYLOAD = "patchmill-run-once-extensions-loaded\n";
const OBSERVER_SUFFIX = "/src/pi/extensions/run-once-subagent-progress.ts";

/**
 * Verify that an installed Patchmill package loads every run-once extension
 * before the trailing sentinel fixture.
 */
export async function verifyInstalledRunOnceExtensions({
  packageRoot,
  profile,
  pi,
  piSubagentsRoot,
  piCommand,
  piCommandArgs = [],
  cwd,
  agentDir,
  sentinelPath,
  env,
}) {
  assert.equal(
    realpathSync(profile.additionalExtensionPaths[0]),
    realpathSync(piSubagentsRoot),
  );
  assert.equal(
    profile.additionalExtensionPaths[1]
      ?.replaceAll("\\", "/")
      .endsWith("/extensions/todos.ts"),
    true,
  );
  assert.equal(
    profile.additionalExtensionPaths[2]
      ?.replaceAll("\\", "/")
      .endsWith(OBSERVER_SUFFIX),
    true,
  );

  const observerPath = profile.additionalExtensionPaths[2];
  assert.ok(observerPath);
  mkdirSync(agentDir, { recursive: true });
  const loadedObserver = await pi.discoverAndLoadExtensions(
    [observerPath],
    packageRoot,
    agentDir,
  );
  assert.deepEqual(loadedObserver.errors, []);
  const observer = loadedObserver.extensions.find((extension) =>
    extension.resolvedPath.replaceAll("\\", "/").endsWith(OBSERVER_SUFFIX),
  );
  assert.ok(observer);
  for (const eventName of [
    "session_start",
    "tool_execution_update",
    "tool_execution_end",
  ]) {
    assert.ok((observer.handlers.get(eventName)?.length ?? 0) > 0);
  }

  const sentinelFixture = join(
    packageRoot,
    "fixtures",
    "run-once-extension-load-sentinel.ts",
  );
  assert.equal(existsSync(sentinelFixture), true);
  const result = spawnSync(
    piCommand,
    [
      ...piCommandArgs,
      "--mode",
      "rpc",
      "--no-session",
      "--offline",
      "-ne",
      ...profile.additionalExtensionPaths.flatMap((path) => ["-e", path]),
      "-e",
      sentinelFixture,
    ],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...env,
        PATCHMILL_RUN_ONCE_EXTENSION_SENTINEL: sentinelPath,
      },
      input: '{"type":"get_commands"}\n',
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /Failed to load extension|Cannot find module|ERR_MODULE_NOT_FOUND/iu,
  );
  assert.equal(readFileSync(sentinelPath, "utf8"), SENTINEL_PAYLOAD);
}
