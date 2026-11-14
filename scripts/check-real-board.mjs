import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { startServeServer } from "../src/web/server.ts";
import { createServeAuth } from "../src/web/auth.ts";
import { createSampleRunDataSource } from "../src/web/sample-data.ts";
import { openBrowser } from "./browser-session.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const sample = await createSampleRunDataSource().snapshot();
const numbers = [298, 206, 250, 210, 276, 231, 247];
const issues = numbers.map((number) => {
  const original = sample.issues.find((i) => i.number === number);
  return {
    ...original,
    artifacts: [],
    terminal: false,
    title:
      number === 298
        ? 'An issue <img src="https://evil.test/asset"> stays text'
        : original.title,
    live: [250, 210, 247].includes(number),
    documentLinks:
      number === 250
        ? [
            {
              kind: "spec",
              url: "https://github.com/example/fixture/blob/abc/spec.md",
            },
            { kind: "plan", url: "javascript:alert(1)" },
          ]
        : [],
  };
});
const fixture = {
  repository: {
    name: "example/board-fixture",
    url: "https://github.com/example/board-fixture",
  },
  source: "live",
  revision: "real-board-fixture-v1",
  syncedAt: new Date(Date.now() - 12000).toISOString(),
  issues,
  details: Object.fromEntries(
    issues.map((summary) => [
      String(summary.number),
      {
        summary,
        participants: [],
        thread: [],
        artifacts: [],
        finalUsage: null,
      },
    ]),
  ),
};
const server = process.env.BOARD_URL
  ? null
  : await startServeServer({
      host: "127.0.0.1",
      port: 0,
      auth: createServeAuth(),
      source: { snapshot: async () => fixture, subscribe: () => () => {} },
    });
const url = process.env.BOARD_URL ?? server.url;
let browser;
const evidence = [];
try {
  browser = await openBrowser(url);
  await browser.until("document.querySelectorAll('.col').length===7");
  const actual = await browser.evaluate(
    "fetch('/api/board').then(r=>r.json())",
  );
  assert.equal(actual.source, "live");
  if (process.env.BOARD_REPO) {
    const repo = process.env.BOARD_REPO;
    const config = JSON.parse(
      await fs.readFile(`${repo}/patchmill.config.json`, "utf8"),
    );
    const hostIssues = JSON.parse(
      execFileSync(
        "gh",
        [
          "issue",
          "list",
          "--state",
          "open",
          "--limit",
          "1000",
          "--json",
          "number,title,labels",
        ],
        { cwd: repo, encoding: "utf8" },
      ),
    );
    const expected = [];
    for (const issue of hostIssues) {
      let excluded = issue.labels.some(
        (label) =>
          label.name === (config.labels?.unsuitable ?? "agent-unsuitable"),
      );
      if (config.workflow?.stateTracking === "local") {
        let status;
        try {
          status = JSON.parse(
            (
              await fs.readFile(
                `${repo}/.patchmill/state/status/${issue.number}.jsonl`,
                "utf8",
              )
            )
              .trim()
              .split("\n")
              .at(-1),
          ).status;
        } catch {}
        excluded = status === "unsuitable";
      }
      if (!excluded)
        expected.push({
          number: issue.number,
          title: issue.title,
          labels: issue.labels.map((l) => l.name).sort(),
        });
    }
    expected.sort((a, b) => a.number - b.number);
    const observed = actual.issues
      .map((i) => ({
        number: i.number,
        title: i.title,
        labels: i.labels.map((l) => l.name).sort(),
      }))
      .sort((a, b) => a.number - b.number);
    assert.deepEqual(observed, expected);
    evidence.push({
      comparison: "gh issue list",
      open: hostIssues.length,
      visible: expected.length,
      syncedAt: actual.syncedAt,
      liveIssues: actual.issues.filter((i) => i.live).map((i) => i.number),
    });
  } else {
    assert.equal(
      await browser.evaluate(
        "document.querySelector('a[href=\"#/issue/210\"]').closest('article').querySelector('.mk-live')?.textContent",
      ),
      "Live",
    );
    assert.equal(
      await browser.evaluate(
        "document.querySelector('a[href=\"#/issue/247\"]').closest('article').querySelector('.mk-live')?.textContent",
      ),
      "Live",
    );
    assert.equal(
      await browser.evaluate(
        "document.querySelector('a[href=\"#/issue/276\"]').closest('article').querySelectorAll('.mk-live').length",
      ),
      0,
    );
    assert.equal(
      await browser.evaluate(
        "document.querySelectorAll('.card-title img, a[href^=\"javascript:\"], a a').length",
      ),
      0,
    );
    assert.equal(
      await browser.evaluate(
        "document.querySelector('a[href=\"#/issue/250\"]').closest('article').querySelectorAll('.card-links a[href^=\"https:\"]').length",
      ),
      1,
    );
  }
  const issueNumber = process.env.BOARD_URL
    ? (actual.issues.find((i) => i.number === 302)?.number ??
      actual.issues[0]?.number)
    : 206;
  assert.ok(issueNumber);
  for (const width of [1440, 390]) {
    await browser.viewport(width);
    for (const theme of ["dark", "light"]) {
      await browser.evaluate(
        `document.documentElement.dataset.theme=${JSON.stringify(theme)};location.hash='#/board'`,
      );
      await browser.until("document.querySelectorAll('.col').length===7");
      const metrics = await browser.evaluate(
        "({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,sync:document.getElementById('sync-status')?.textContent})",
      );
      assert.equal(metrics.scrollWidth, metrics.clientWidth);
      assert.match(metrics.sync, /^synced \d+ s ago$/);
      evidence.push({ view: "board", width, theme, ...metrics });
      if (process.env.BOARD_SCREENSHOTS === "1")
        await browser.screenshot(
          `${root}docs/screenshots/issue-302-${process.env.BOARD_URL ? "repository" : "fixture"}-board-${width}-${theme}.png`,
        );
      await browser.evaluate(`location.hash='#/issue/${issueNumber}'`);
      await browser.until(
        "document.querySelector('.thread h2')?.textContent==='Thread not available yet'",
      );
      assert.equal(
        await browser.evaluate(
          "document.querySelector('.thread p')?.textContent",
        ),
        "Real issue threads come in a later update.",
      );
      assert.equal(
        await browser.evaluate(
          "document.querySelector('#composer-input')?.disabled",
        ),
        true,
      );
      assert.equal(
        await browser.evaluate(
          "document.querySelectorAll('.msg, .tool').length",
        ),
        0,
      );
      await browser.evaluate(
        "document.querySelector('.control button')?.click()",
      );
      assert.equal(
        await browser.evaluate("document.getElementById('notice').textContent"),
        "This comes with live chat. Nothing changed.",
      );
      await browser.evaluate(
        "document.getElementById('notice').hidden=true;document.querySelector('.back').focus()",
      );
      assert.equal(
        await browser.evaluate(
          "getComputedStyle(document.activeElement).outlineStyle",
        ),
        "solid",
      );
      if (process.env.BOARD_SCREENSHOTS === "1")
        await browser.screenshot(
          `${root}docs/screenshots/issue-302-${process.env.BOARD_URL ? "repository" : "fixture"}-issue-${width}-${theme}.png`,
        );
      evidence.push({
        view: "issue",
        width,
        theme,
        issue: issueNumber,
        disabledComposer: true,
      });
    }
  }
  assert.deepEqual(browser.exceptions, []);
  assert.ok(browser.requests.every((request) => request.method === "GET"));
  assert.ok(
    browser.requests.every(
      (request) => new URL(request.url).origin === new URL(url).origin,
    ),
  );
  const result = {
    source: process.env.BOARD_URL ? "repository" : "fixture",
    evidence,
    runtimeErrors: [],
    mutationRequests: [],
    foreignRequests: [],
  };
  if (process.env.BOARD_EVIDENCE)
    await fs.writeFile(
      process.env.BOARD_EVIDENCE,
      JSON.stringify(result, null, 2),
    );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await server?.close();
}
