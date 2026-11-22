import { acquireLifetimeLock } from "../src/kernel/runner/lifetime-lock.ts";
import { runCommand } from "../src/process/command.ts";

// Holds the lifetime lock of <repoRoot> until the test kills this process.
const [repoRoot] = process.argv.slice(2);
process.on("disconnect", () => {});
await acquireLifetimeLock({
  repoRoot,
  runner: runCommand,
  now: () => new Date(),
  log: () => {},
});
setInterval(() => {}, 60000);
process.send({ event: "acquired", pid: process.pid });
