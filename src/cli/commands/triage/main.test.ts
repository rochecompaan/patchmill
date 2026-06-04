import test from "node:test";
import assert from "node:assert/strict";
import { HELP_TEXT } from "./main.ts";

test("HELP_TEXT documents usage and active triage protection wording", () => {
  assert.match(HELP_TEXT, /Usage:/);
  assert.match(HELP_TEXT, /--help/);
  assert.match(HELP_TEXT, /-h/);
  assert.doesNotMatch(HELP_TEXT, /--execute/);
  assert.match(HELP_TEXT, /Automated issue triage/);
  assert.doesNotMatch(HELP_TEXT, /Automated Forgejo issue triage/);
  assert.match(
    HELP_TEXT,
    /Runs the configured triage skill against eligible untriaged open issues by default/,
  );
  assert.doesNotMatch(HELP_TEXT, /Defaults to showing this help/);
  assert.match(
    HELP_TEXT,
    /Preview configured triage skill decisions without mutating the configured issue host/,
  );
  assert.doesNotMatch(HELP_TEXT, /without mutating Forgejo/);
  assert.match(HELP_TEXT, /--dry-run/);
  assert.match(HELP_TEXT, /--issue <number>/);
  assert.match(HELP_TEXT, /--all/);
  assert.match(HELP_TEXT, /without active triage or protection labels/);
  assert.match(
    HELP_TEXT,
    /include issues already carrying triage or protection labels such as in-progress or blocked/,
  );
});
