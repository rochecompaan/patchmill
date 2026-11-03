import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { ExtensionSelectorComponent } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/extension-selector.js";
import { FooterComponent } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/footer.js";
import { createChatViewport } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/chat-viewport.js";
import { initTheme } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { renderLayoutFrame } from "../../node_modules/@earendil-works/pi-tui/dist/layout.js";
import { renderPlanningDialog } from "./planning-dialog.ts";

for (const highlight of ["D".repeat(72), "First decision\n".repeat(12)]) {
  test(`80×24 viewport keeps every approval choice visible with ${highlight.includes("\n") ? "multiline" : "maximal"} highlights`, () => {
    initTheme("dark");
    const dialog = renderPlanningDialog(
      {
        issue: {
          number: 6,
          title: "Persist polls locally ".repeat(9).slice(0, 183),
        },
        stage: "spec",
        branch: "agent/issue-6--spec",
        commit: "9064d2a",
        specPath:
          "docs/specs/2026-11-02-issue-6-persist-polls-locally-design.md",
        mockupPath:
          "docs/mockups/2026-11-02-issue-6-persist-polls-locally.html",
      },
      { required: true, pullRequest: true },
      Array<string>(5).fill(highlight),
    );
    const selector = new ExtensionSelectorComponent(
      dialog.title,
      dialog.options,
      () => {},
      () => {},
    );
    const footer = new FooterComponent(
      {
        sessionManager: SessionManager.inMemory(),
        getContextUsage: () => undefined,
        state: {},
      } as unknown as ConstructorParameters<typeof FooterComponent>[0],
      {
        getGitBranch: () => "agent/issue-6--spec",
        getExtensionStatuses: () => new Map(),
        getAvailableProviderCount: () => 1,
        onBranchChange: () => () => {},
      },
    );
    const viewport = createChatViewport({
      document: new Text("Planning conversation"),
      pendingMessages: new Container(),
      status: new Container(),
      widgetsAbove: new Spacer(1),
      editor: selector,
      footer,
    });
    const lines = renderLayoutFrame(viewport.root, 80, 24, () => {}).lines;
    const output = lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    for (const option of [
      "Approve and open a planning PR",
      "Approve without a PR (continue now)",
      "Request changes",
    ])
      assert.ok(output.includes(option), `${option} is clipped:\n${output}`);
    assert.match(output, /navigate/);
    assert.match(output, /no-model/);
    assert.match(output, /Approve the spec for issue #6:/);
    selector.dispose();
    footer.dispose();
  });
}
