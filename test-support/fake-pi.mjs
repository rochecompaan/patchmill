import fs from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
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
  '{"usage":{"input":100,"output":20,"cost":{"total":0.05}}}\n' +
    (step.sessionEntries ?? [])
      .map((entry) => `${JSON.stringify(entry)}\n`)
      .join(""),
);
async function sideEffects(s = step) {
  for (const { args, allowFailure } of s.git ?? []) {
    try {
      await promisify(execFile)("git", args);
    } catch (error) {
      if (!allowFailure) throw error;
    }
  }
  for (const [path, content] of Object.entries(s.writeFiles ?? {})) {
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, content);
  }
  const git = promisify(execFile);
  if (s.commit) {
    await git("git", ["add", "-A"]);
    await git("git", ["commit", "-m", s.commit]);
  }
  if (s.push) await git("git", ["push", "-u", "origin", "HEAD"]);
  if (s.pullRequest) {
    const stateFile = process.env.PATCHMILL_FAKE_HOST_STATE;
    if (!stateFile) throw new Error("PATCHMILL_FAKE_HOST_STATE is required");
    const { stdout } = await git("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
    const headBranch = stdout.trim();
    // Read after git finishes so host changes made during that command survive.
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    const headRepository =
      state.pushRepository ??
      `${state.repository.owner}/${state.repository.repo}`;
    const existing = state.pullRequests.find(
      (pr) =>
        pr.headBranch === headBranch && pr.headRepository === headRepository,
    );
    if (existing) {
      Object.assign(existing, s.pullRequest, { headBranch });
    } else {
      const number =
        Math.max(0, ...state.pullRequests.map((pr) => pr.number)) + 1;
      state.pullRequests.push({
        number,
        url: `https://example.invalid/pulls/${number}`,
        state: "open",
        draft: true,
        body: "",
        headRepository,
        baseBranch: state.repository.defaultBranch,
        ...s.pullRequest,
        headBranch,
      });
    }
    writeFileSync(stateFile, JSON.stringify(state));
  }
  if (s.issuePatch) {
    const stateFile = process.env.PATCHMILL_FAKE_HOST_STATE;
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    Object.assign(state.issues[0], s.issuePatch);
    writeFileSync(stateFile, JSON.stringify(state));
  }
}

if (process.argv.includes("--mode")) {
  const { runRpc } = await import("./fake-pi-rpc.mjs");
  await runRpc({ step, script, sideEffects, sessionDir });
} else {
  await sideEffects();
  if (step.stdout !== undefined) console.log(step.stdout);
  if (step.stderr !== undefined) console.error(step.stderr);
  for (const name of step.printEnv ?? []) console.log(process.env[name] ?? "");
  if (step.sleepMs)
    await new Promise((resolve) => setTimeout(resolve, step.sleepMs));
  if (step.result !== undefined && step.result !== null)
    console.log(`\`\`\`json\n${JSON.stringify(step.result)}\n\`\`\``);
  process.exitCode = step.exitCode ?? 0;
}
