import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { PI_TODO_ISSUE_SCOPE_ENV } from "../src/policy/todo-issue-scope.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import todosExtension, { todoCloseStatus } from "../extensions/todos.ts";
import { PI_TODO_DONE_STATUSES_ENV } from "../src/policy/todo-statuses.ts";

type RegisteredTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: () => void,
    ctx: {
      cwd: string;
      sessionManager: {
        getSessionId: () => string;
        getSessionFile: () => string;
      };
    },
  ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
};

function registerTodoTool(
  on?: (name: string, callback: (...args: never[]) => Promise<void>) => void,
): RegisteredTool {
  let tool: RegisteredTool | undefined;
  todosExtension({
    on: on ?? (() => undefined),
    registerCommand: () => undefined,
    registerTool: (registered: RegisteredTool) => {
      tool = registered;
    },
  } as never);
  assert.ok(tool);
  return tool;
}

test("shared todo scope preserves old completed tasks and refuses every foreign ID mutation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-shared-todos-"));
  const previousPath = process.env.PI_TODO_PATH;
  const previousScope = process.env[PI_TODO_ISSUE_SCOPE_ENV];
  process.env.PI_TODO_PATH = dir;
  process.env[PI_TODO_ISSUE_SCOPE_ENV] = JSON.stringify({
    titlePattern: "^issue-226-task-.*$",
    tags: ["issue-226"],
  });
  let startup!: (...args: never[]) => Promise<void>;
  const body = `${JSON.stringify({ id: "abcdef01", title: "issue-227-task-01-old", tags: ["issue-227"], status: "closed", created_at: "2020-01-01T00:00:00.000Z" })}\n\nDo not collect\n`;
  await writeFile(join(dir, "abcdef01.md"), body);
  const ctx = {
    cwd: dir,
    sessionManager: {
      getSessionId: () => "issue-226",
      getSessionFile: () => "issue-226.json",
    },
  };
  try {
    const tool = registerTodoTool((name, callback) => {
      if (name === "session_start") startup = callback;
    });
    await startup({} as never, ctx as never);
    assert.equal(
      await readFile(join(dir, "abcdef01.md"), "utf8").catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return undefined;
        throw error;
      }),
      body,
    );
    const signal = new AbortController().signal;
    const listed = await tool.execute(
      "list",
      { action: "list-all" },
      signal,
      () => undefined,
      ctx,
    );
    assert.doesNotMatch(listed.content[0].text, /issue-227/u);
    for (const action of [
      "get",
      "update",
      "append",
      "delete",
      "claim",
      "release",
    ]) {
      await assert.rejects(
        tool.execute(
          action,
          {
            action,
            id: "abcdef01",
            title: "issue-226-task-01-override",
            body: "overwrite",
            force: true,
          },
          signal,
          () => undefined,
          ctx,
        ),
        /another Issue/u,
      );
      assert.equal(await readFile(join(dir, "abcdef01.md"), "utf8"), body);
    }
    assert.deepEqual(
      (await readdir(dir)).filter((name) => name.endsWith(".lock")),
      [],
    );
    await assert.rejects(
      tool.execute(
        "foreign-create",
        { action: "create", title: "issue-227-task-01-new" },
        signal,
        () => undefined,
        ctx,
      ),
      /another Issue/u,
    );
    const created = await tool.execute(
      "own-create",
      { action: "create", title: "issue-226-task-01-new", tags: ["issue-226"] },
      signal,
      () => undefined,
      ctx,
    );
    assert.match(created.content[0].text, /issue-226-task-01-new/u);
  } finally {
    if (previousPath === undefined) delete process.env.PI_TODO_PATH;
    else process.env.PI_TODO_PATH = previousPath;
    if (previousScope === undefined)
      delete process.env[PI_TODO_ISSUE_SCOPE_ENV];
    else process.env[PI_TODO_ISSUE_SCOPE_ENV] = previousScope;
    await rm(dir, { recursive: true, force: true });
  }
});

test("todo extension groups complete todos as closed and blocks claims", async () => {
  const previous = process.env[PI_TODO_DONE_STATUSES_ENV];
  const previousTodoPath = process.env.PI_TODO_PATH;
  delete process.env[PI_TODO_DONE_STATUSES_ENV];
  delete process.env.PI_TODO_PATH;
  try {
    const tool = registerTodoTool();
    assert.equal(todoCloseStatus(), "closed");
    const schema = tool.parameters as {
      properties?: { status?: { enum?: string[] } };
    };
    assert.deepEqual(schema.properties?.status?.enum, [
      "open",
      "closed",
      "completed",
      "complete",
      "done",
    ]);
    const cwd = await mkdtemp(join(tmpdir(), "patchmill-todos-extension-"));
    await mkdir(join(cwd, ".pi", "todos"), { recursive: true });
    const ctx = {
      cwd,
      sessionManager: {
        getSessionId: () => "session-a",
        getSessionFile: () => "session-a.json",
      },
    };
    const signal = new AbortController().signal;

    const closedCreate = await tool.execute(
      "call-1",
      { action: "create", title: "finished", status: "complete" },
      signal,
      () => undefined,
      ctx,
    );
    await tool.execute(
      "call-2",
      { action: "create", title: "still open", status: "open" },
      signal,
      () => undefined,
      ctx,
    );
    const listed = await tool.execute(
      "call-3",
      { action: "list-all" },
      signal,
      () => undefined,
      ctx,
    );

    const closedTodo = JSON.parse(closedCreate.content[0]?.text ?? "") as {
      id: string;
    };
    const groups = JSON.parse(listed.content[0]?.text ?? "") as {
      open: Array<{ title: string }>;
      closed: Array<{ title: string }>;
    };
    assert.deepEqual(
      groups.closed.map((todo) => todo.title),
      ["finished"],
    );
    assert.deepEqual(
      groups.open.map((todo) => todo.title),
      ["still open"],
    );

    const claim = await tool.execute(
      "call-4",
      { action: "claim", id: closedTodo.id },
      signal,
      () => undefined,
      ctx,
    );
    assert.match(claim.content[0]?.text ?? "", /closed/);
  } finally {
    if (previous === undefined) delete process.env[PI_TODO_DONE_STATUSES_ENV];
    else process.env[PI_TODO_DONE_STATUSES_ENV] = previous;
    if (previousTodoPath === undefined) delete process.env.PI_TODO_PATH;
    else process.env.PI_TODO_PATH = previousTodoPath;
  }
});

test("todo extension uses configured terminal statuses in its guidance and grouping", async () => {
  const previous = process.env[PI_TODO_DONE_STATUSES_ENV];
  const previousTodoPath = process.env.PI_TODO_PATH;
  process.env[PI_TODO_DONE_STATUSES_ENV] = JSON.stringify(["shipped"]);
  delete process.env.PI_TODO_PATH;
  try {
    const tool = registerTodoTool();
    assert.match(
      tool.description,
      /Prefer status `shipped` when work is complete/,
    );
    assert.match(tool.description, /Accepted terminal statuses: shipped/);
    assert.equal(todoCloseStatus(), "shipped");
    const schema = tool.parameters as {
      properties?: { status?: { enum?: string[] } };
    };
    assert.deepEqual(schema.properties?.status?.enum, ["open", "shipped"]);
    assert.match(
      schema.properties?.status?.description ?? "",
      /Prefer `shipped` when work is complete/,
    );

    const cwd = await mkdtemp(
      join(tmpdir(), "patchmill-custom-todos-extension-"),
    );
    const ctx = {
      cwd,
      sessionManager: {
        getSessionId: () => "session-a",
        getSessionFile: () => "session-a.json",
      },
    };
    const signal = new AbortController().signal;
    await tool.execute(
      "call-1",
      { action: "create", title: "shipped work", status: "shipped" },
      signal,
      () => undefined,
      ctx,
    );
    const listed = await tool.execute(
      "call-2",
      { action: "list-all" },
      signal,
      () => undefined,
      ctx,
    );
    const groups = JSON.parse(listed.content[0]?.text ?? "") as {
      closed: Array<{ title: string }>;
    };
    assert.deepEqual(
      groups.closed.map((todo) => todo.title),
      ["shipped work"],
    );
  } finally {
    if (previous === undefined) delete process.env[PI_TODO_DONE_STATUSES_ENV];
    else process.env[PI_TODO_DONE_STATUSES_ENV] = previous;
    if (previousTodoPath === undefined) delete process.env.PI_TODO_PATH;
    else process.env.PI_TODO_PATH = previousTodoPath;
  }
});
