import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCommandRunner } from "./command.ts";

test(
  "owned Git cancellation stops a SIGTERM-resistant command group before its receipt",
  { timeout: 15_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "owned-git-"));
    const script = join(root, "command.mjs");
    await writeFile(
      script,
      `import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('child-ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'inherit'] });
process.on('SIGTERM', () => {});
child.stdout.on('data', () => console.log('ready:' + child.pid));
setInterval(() => {}, 1000);
`,
    );
    const runner = createCommandRunner();
    const abort = new AbortController();
    let group: number | undefined;
    let descendant: number | undefined;
    let stopped = false;
    let ready!: () => void;
    const barrier = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const running = runner.run(
      "git",
      ["-c", `alias.hold=!${process.execPath} ${script}`, "hold"],
      {
        cwd: root,
        signal: abort.signal,
        ownedGit: {
          shutdownMs: 100,
          onSpawn: async (pid: number) => {
            group = pid;
          },
          onStopped: async (verified: boolean) => {
            assert.equal(verified, true);
            stopped = true;
          },
        },
        onStdout: (chunk) => {
          const match = /ready:(\d+)/u.exec(chunk);
          if (match) {
            descendant = Number(match[1]);
            ready();
          }
        },
      },
    );
    try {
      await barrier;
      abort.abort();
      const result = await running;
      assert.notEqual(result.code, 0);
      assert.equal(stopped, true);
      // A killed orphan can remain a zombie until the host reaps it; it cannot mutate.
      try {
        const stat = await readFile(`/proc/${descendant}/stat`, "utf8");
        assert.match(stat, /\) Z /u);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    } finally {
      abort.abort();
      if (group) {
        try {
          process.kill(-group, "SIGKILL");
        } catch {
          /* already stopped */
        }
      }
      await running;
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "unverified detached Git helper shutdown is bounded and never receives a safe receipt",
  { timeout: 10_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "owned-git-detached-"));
    const script = join(root, "detached.mjs");
    await writeFile(
      script,
      `import { spawn } from 'node:child_process';
const child=spawn(process.execPath,['-e',"console.log('escaped:' + process.pid); setInterval(()=>{},1000)"],{detached:true,stdio:['ignore','inherit','inherit']});
setInterval(()=>{},1000);`,
    );
    const controller = new AbortController();
    let escaped: number | undefined;
    let ready!: () => void;
    const barrier = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const receipts: boolean[] = [];
    const result = createCommandRunner()
      .run("git", ["-c", `alias.hold=!${process.execPath} ${script}`, "hold"], {
        cwd: root,
        signal: controller.signal,
        onStdout: (text) => {
          const match = /escaped:(\d+)/u.exec(text);
          if (match) {
            escaped = Number(match[1]);
            ready();
          }
        },
        ownedGit: {
          shutdownMs: 100,
          onSpawn: async () => {},
          onStopped: async (verified) => {
            receipts.push(verified);
          },
        },
      })
      .then(
        () => "resolved",
        () => "rejected",
      );
    try {
      await barrier;
      controller.abort();
      const outcome = await Promise.race([
        result,
        new Promise<string>((resolve) =>
          setTimeout(() => resolve("deadline"), 2_000),
        ),
      ]);
      assert.equal(outcome, "rejected");
      assert.equal(receipts.includes(true), false);
    } finally {
      controller.abort();
      if (escaped) {
        try {
          process.kill(escaped, "SIGKILL");
        } catch {
          /* already stopped */
        }
      }
      await result;
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("owned lifecycle is rejected for non-Git commands before spawn", async () => {
  let receipt = false;
  await assert.rejects(
    createCommandRunner().run(
      process.execPath,
      ["-e", "console.log('effect')"],
      {
        ownedGit: {
          onSpawn: async () => {
            receipt = true;
          },
          onStopped: async () => {},
        },
      },
    ),
    /owned.*Git/iu,
  );
  assert.equal(receipt, false);
});
