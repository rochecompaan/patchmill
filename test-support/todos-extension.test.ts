import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
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

function registerTodoTool(): RegisteredTool {
  let tool: RegisteredTool | undefined;
  todosExtension({
    on: () => undefined,
    registerCommand: () => undefined,
    registerTool: (registered: RegisteredTool) => {
      tool = registered;
    },
  } as never);
  assert.ok(tool);
  return tool;
}

test("todo extension groups complete todos as closed and blocks claims", async () => {
  const previous = process.env[PI_TODO_DONE_STATUSES_ENV];
  delete process.env[PI_TODO_DONE_STATUSES_ENV];
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
  }
});

test("todo extension uses configured terminal statuses in its guidance and grouping", async () => {
  const previous = process.env[PI_TODO_DONE_STATUSES_ENV];
  process.env[PI_TODO_DONE_STATUSES_ENV] = JSON.stringify(["shipped"]);
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
  }
});
