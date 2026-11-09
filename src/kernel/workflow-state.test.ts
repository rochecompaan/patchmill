import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FakeHost, writeFakeHostState } from "../../test-support/fake-host.ts";
import { parseConfig } from "../config/config.ts";
import { StateStore } from "../state/store.ts";
import { LabelWorkflowState } from "./label-workflow.ts";
import { LocalWorkflowState } from "./local-workflow.ts";

for (const mode of ["labels", "local"] as const) {
  for (const outcome of ["post fails", "record fails", "success"] as const) {
    test(`${mode}: question then status protocol: ${outcome}`, async (t) => {
      const root = await fs.mkdtemp(join(tmpdir(), "patchmill-protocol-"));
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      const path = join(root, "host.json");
      writeFakeHostState(path, {});
      const host = new FakeHost(path);
      const store = new StateStore(root);
      const calls: string[] = [];
      host.commentIssue = async () => {
        calls.push("post");
        if (outcome === "post fails") throw new Error("denied");
        return "https://example.invalid/question";
      };
      const record = async () => {
        calls.push("record");
        if (outcome === "record fails") throw new Error("denied");
      };
      host.setLabels = record;
      store.appendStatus = record;
      const workflow =
        mode === "labels"
          ? new LabelWorkflowState(host, parseConfig({}).labels)
          : new LocalWorkflowState({
              host,
              store,
              now: () => new Date(),
              warn: () => {},
            });
      const result = workflow.setStatus(9, {
        status: "needsInfo",
        summary: "Q?",
        question: "Q?",
      });
      if (outcome === "success") assert.deepEqual(await result, []);
      else
        await assert.rejects(
          result,
          outcome === "post fails"
            ? /^Error: Comment failed:/
            : new RegExp(
                `${mode === "labels" ? "Label" : "Status"} update failed: denied \\(.* posted at https://example.invalid/question\\)`,
              ),
        );
      assert.deepEqual(
        calls,
        outcome === "post fails" ? ["post"] : ["post", "record"],
      );
    });
  }
}
