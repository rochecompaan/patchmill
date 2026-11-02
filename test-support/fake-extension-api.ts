import type {
  ExtensionAPI,
  ExtensionCommandContext,
  RegisteredCommand,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { fakeSubagents } from "./fake-subagents.ts";

export function fakeExtensionApi(events = fakeSubagents()) {
  const commands = new Map<
    string,
    Omit<RegisteredCommand, "name" | "sourceInfo">
  >();
  const tools = new Map<string, ToolDefinition>();
  type Handler = (
    event: unknown,
    ctx: { sessionManager: SessionManager },
  ) => Promise<void>;
  const handlers = new Map<string, Handler[]>();
  const userMessages: { text: unknown; options: unknown }[] = [];
  const messages: {
    message: { content: string; customType: string; display: boolean };
    options: unknown;
  }[] = [];
  const confirmations: { title: string; message: string }[] = [];
  const selections: { title: string; options: string[] }[] = [];
  const api = {
    events,
    registerCommand(
      name: string,
      command: Omit<RegisteredCommand, "name" | "sourceInfo">,
    ) {
      commands.set(name, command);
    },
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => {};
    },
    sendUserMessage(text: unknown, options: unknown) {
      userMessages.push({ text, options });
    },
    sendMessage(
      message: { content: string; customType: string; display: boolean },
      options: unknown,
    ) {
      messages.push({ message, options });
    },
  } as unknown as ExtensionAPI;
  return Object.assign(api, {
    tools,
    commands,
    async callCommand(
      args: string,
      switchSession = async (_path: string) => ({ cancelled: false }),
    ) {
      const command = commands.get("patchmill-issue");
      if (!command) throw new Error("Unknown command patchmill-issue");
      await command.handler(args, { switchSession } as ExtensionCommandContext);
      return messages.at(-1)?.message.content;
    },
    userMessages,
    messages,
    confirmations,
    selections,
    async fire(event: "session_start" | "session_shutdown") {
      for (const handler of handlers.get(event) ?? [])
        await handler({}, { sessionManager: SessionManager.inMemory() });
    },
    async callTool(
      name: string,
      params: unknown,
      options: { confirm?: boolean; select?: string } = { confirm: true },
    ) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Unknown tool ${name}`);
      const ctx = {
        ui: {
          select: async (title: string, choices: string[]) => {
            selections.push({ title, options: choices });
            return "select" in options ? options.select : choices[0];
          },
          confirm: async (title: string, message: string) => {
            confirmations.push({ title, message });
            return options.confirm;
          },
        },
      } as unknown as ExtensionToolContext;
      const result = await tool.execute(
        "test",
        params as any,
        undefined,
        undefined,
        ctx,
      );
      return result.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("");
    },
  });
}
