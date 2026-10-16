import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const script = process.env.PATCHMILL_FAKE_PI_SCRIPT;
if (!script) throw new Error("PATCHMILL_FAKE_PI_SCRIPT is required");
const steps = JSON.parse(await fs.readFile(script, "utf8"));
if (!Array.isArray(steps)) throw new Error("Fake Pi script must be an array");
const counterPath = `${script}.counter`;
let invocation = 0;
try {
  invocation = Number(await fs.readFile(counterPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const step = steps[invocation];
if (!step) throw new Error(`No fake Pi step for invocation ${invocation + 1}`);
await fs.writeFile(counterPath, String(invocation + 1));
if (step.ignoreSigterm) process.on("SIGTERM", () => {});

const sessionFlag = process.argv.indexOf("--session-dir");
const sessionDir = sessionFlag >= 0 ? process.argv[sessionFlag + 1] : undefined;
if (!sessionDir) throw new Error("--session-dir is required");
await fs.mkdir(sessionDir, { recursive: true });
await fs.writeFile(
  join(sessionDir, "fake.jsonl"),
  '{"usage":{"input":100,"output":20,"cost":{"total":0.05}}}\n',
);
for (const [path, content] of Object.entries(step.writeFiles ?? {})) {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, content);
}
const git = promisify(execFile);
if (step.commit) {
  await git("git", ["add", "-A"]);
  await git("git", ["commit", "-m", step.commit]);
}
if (step.push) await git("git", ["push", "-u", "origin", "HEAD"]);
if (step.stdout !== undefined) console.log(step.stdout);
for (const name of step.printEnv ?? []) console.log(process.env[name] ?? "");
if (step.sleepMs)
  await new Promise((resolve) => setTimeout(resolve, step.sleepMs));
if (step.result !== undefined && step.result !== null)
  console.log(`\`\`\`json\n${JSON.stringify(step.result)}\n\`\`\``);
process.exitCode = step.exitCode ?? 0;
