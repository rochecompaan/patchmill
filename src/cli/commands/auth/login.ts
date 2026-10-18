import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function login(pi: ExtensionAPI): void {
  let opened = false;
  pi.on("session_start", (_event, context) => {
    if (opened || context.mode !== "tui") return;
    opened = true;
    // CLI messages go to the model. Submit through the ready editor so Pi
    // handles /login itself, including its provider picker and credential store.
    context.ui.setEditorText("/login");
    process.stdin.emit("data", Buffer.from("\r"));
  });
}
