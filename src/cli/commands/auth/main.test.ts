import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { Editor, ProcessTerminal, TuiMainScreen } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG } from "../../../config/config.ts";
import { runCommand } from "../../../process/command.ts";
import { authSpawnPlan, main } from "./main.ts";

test("auth opens login without saving a chat session and preserves repo-local credentials", () => {
  const config = structuredClone(DEFAULT_CONFIG);
  const pi = { command: "node", argsPrefix: ["pi.js"] };
  const plan = authSpawnPlan("/repo", config, pi);
  assert.deepEqual(plan.args, [
    "pi.js",
    "--no-session",
    "--extension",
    fileURLToPath(new URL("./login.ts", import.meta.url)),
  ]);
  assert.equal(plan.command, "node");
  assert.equal(plan.env.PI_CODING_AGENT_DIR, "/repo/.patchmill/pi-agent");
  assert.equal(plan.env.PATH, process.env.PATH);
  config.pi.agentDir = "custom/agent";
  assert.equal(
    authSpawnPlan("/repo", config, pi).env.PI_CODING_AGENT_DIR,
    "/repo/custom/agent",
  );
});

test("auth submits built-in login through the editor only once and only in a terminal", async (t) => {
  const plan = authSpawnPlan("/repo", DEFAULT_CONFIG, {
    command: "node",
    argsPrefix: ["pi.js"],
  });
  const extensionIndex = plan.args.indexOf("--extension");
  assert.notEqual(extensionIndex, -1, "auth must load its login startup hook");
  const { default: login } = (await import(
    pathToFileURL(plan.args[extensionIndex + 1]!).href
  )) as { default: ExtensionFactory };
  type StartHandler = (
    event: SessionStartEvent,
    context: ExtensionContext,
  ) => unknown;
  const hooks: { start?: StartHandler } = {};
  await login({
    on(_event: "session_start", handler: StartHandler) {
      hooks.start = handler;
      return () => {};
    },
  } as ExtensionAPI);
  assert.ok(hooks.start);

  const plain = (text: string) => text;
  const editor = new Editor(new TuiMainScreen(new ProcessTerminal()), {
    borderColor: plain,
    selectList: {
      selectedPrefix: plain,
      selectedText: plain,
      description: plain,
      scrollInfo: plain,
      noMatch: plain,
    },
  });
  const submitted: string[] = [];
  editor.onSubmit = (text) => submitted.push(text);
  const receiveInput = (data: Buffer) => editor.handleInput(data.toString());
  const wasFlowing = process.stdin.readableFlowing === true;
  process.stdin.on("data", receiveInput);
  t.after(() => {
    process.stdin.off("data", receiveInput);
    if (!wasFlowing) process.stdin.pause();
  });
  const context = {
    mode: "tui",
    ui: { setEditorText: (text: string) => editor.setText(text) },
  } as ExtensionContext;
  await hooks.start({ type: "session_start" }, { ...context, mode: "print" });
  assert.deepEqual(submitted, []);
  await hooks.start({ type: "session_start" }, context);
  await hooks.start({ type: "session_start" }, context);
  assert.deepEqual(submitted, ["/login"]);
});

test("auth refuses redirected input or output instead of entering Pi print mode", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-auth-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "patchmill.config.json"), "{}");
  const errors: string[] = [];
  assert.equal(
    await main([], {
      repoRoot: root,
      isInteractive: false,
      output: { stdout: () => {}, stderr: (line) => errors.push(line) },
      spawn: () => assert.fail("auth must not launch Pi without a terminal"),
    }),
    1,
  );
  assert.match(errors.join("\n"), /interactive terminal/i);
});

test("auth uses inherited terminal, returns child failures and reports spawn/config errors", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-auth-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "patchmill.config.json"), "{}");
  const errors: string[] = [];
  const options = {
    repoRoot: root,
    isInteractive: true,
    output: { stdout: () => {}, stderr: (s: string) => errors.push(s) },
  };
  for (const code of [0, 7]) {
    assert.equal(
      await main([], {
        ...options,
        piCommand: {
          command: process.execPath,
          argsPrefix: ["-e", `process.exit(${code})`, "--"],
        },
        spawn: (command, args, opts) => {
          assert.equal(opts?.stdio, "inherit");
          assert.equal(opts?.cwd, root);
          assert.equal(
            opts?.env?.PI_CODING_AGENT_DIR,
            join(root, ".patchmill/pi-agent"),
          );
          return spawn(command, args, opts);
        },
      }),
      code,
    );
  }
  assert.equal(
    await main([], {
      ...options,
      piCommand: { command: join(root, "missing"), argsPrefix: [] },
    }),
    1,
  );
  assert.match(errors.join("\n"), /ENOENT/);
  await writeFile(join(root, "patchmill.config.json"), '{"unknown":true}');
  assert.equal(await main([], options), 1);
  assert.match(errors.join("\n"), /unknown/);
  assert.equal(await main(["--bad"], options), 1);
});

test("root dispatches auth and doctor safely without config and still rejects retired run", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-dispatch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const command of ["auth", "doctor"]) {
    const help = await runCommand(
      process.execPath,
      [join(process.cwd(), "bin/patchmill.ts"), command, "--help"],
      { cwd: root },
    );
    assert.equal(help.code, 0, help.stderr);
    const failure = await runCommand(
      process.execPath,
      [join(process.cwd(), "bin/patchmill.ts"), command],
      { cwd: root },
    );
    assert.equal(failure.code, 1);
    assert.match(failure.stderr, /Missing.*patchmill.config.json/);
  }
  const retired = await runCommand(
    process.execPath,
    [join(process.cwd(), "bin/patchmill.ts"), "run"],
    { cwd: root },
  );
  assert.equal(retired.code, 1);
  assert.match(retired.stderr, /Unknown command: run/);
});
