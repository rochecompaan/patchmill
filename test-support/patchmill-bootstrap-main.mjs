import { spawnSync } from "node:child_process";

if (process.env.PI_PACKAGE_DIR !== undefined) {
  throw new Error("PI_PACKAGE_DIR reached the CLI module");
}

export function main() {
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `process.stdout.write(JSON.stringify({
        piPackageDir: process.env.PI_PACKAGE_DIR ?? null,
        providerCredential: process.env.ANTHROPIC_API_KEY,
        parentSession: process.env.PI_SUBAGENT_PARENT_SESSION,
        sentinel: process.env.PATCHMILL_TEST_SENTINEL,
      }));`,
    ],
    { encoding: "utf8" },
  );

  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error(
      `child environment probe failed (${child.status}): ${child.stderr}`,
    );
  }

  process.stdout.write(child.stdout);
  return 23;
}
