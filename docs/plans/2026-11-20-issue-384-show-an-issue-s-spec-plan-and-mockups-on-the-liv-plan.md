# Issue documents on the live web issue page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the sibling `executing-plans`
> skill to implement this plan inline, task by task. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** The live issue page lists and opens the issue's spec, plan, mockups
and diagrams, also from a local branch that is not pushed yet (#384).

**Architecture:** A new deep module `src/web/issue-documents.ts` finds Issue
documents in Git objects (local Issue branch, then the pushed branch, then the
base). It returns `Artifact` entries and a `file(id)` lookup. A pure
`markdownBlocks()` turns each spec and plan into `TextBlock`s in
`IssueDetail.artifacts`. A new route `/files/issues/<n>/<id>` serves HTML
entries with a CSP `sandbox allow-scripts` profile. The viewer frames them with
`sandbox="allow-scripts"`.

**Tech Stack:** TypeScript on Node (`node:http`, `git` through `CommandRunner`),
plain browser JavaScript with JSDoc types, `node:test`.

**Spec:**
`docs/specs/2026-11-20-issue-384-show-an-issue-s-spec-plan-and-mockups-on-the-liv-design.md`

**Plan inputs:**

- The spec above, written on this branch.
- `docs/mockups/2026-11-20-issue-384-live-issue-documents.html`: the chips and
  the two viewer states.
- The spec's `## Visual explanation` (inline Mermaid).
- `GLOSSARY.md`: this branch adds **Issue document**.

**Execution:** inline through the sibling `executing-plans` skill. Planning
review of this plan and the spec happened before implementation.

## Global Constraints

- Add no npm dependency, browser framework or browser build step.
- Read Git objects only. No fetch, no checkout, no worktree read, no ref write.
- Never follow a symbolic link (`120000` tree entries are not documents).
- The browser never sends a path. The route takes only
  `^(mockup|diagram)-[0-9a-f]{12}$` IDs.
- Document CSP, exactly:
  `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts`
- Live frame: `sandbox="allow-scripts"` exactly. Sample frame:
  `sandbox="allow-same-origin"` exactly, as now.
- Live note:
  `Repository file. Scripts run in an isolated frame. The file cannot read this page or act as you.`
- Location text: `On local branch <branch>. Not pushed yet.`,
  `On branch <branch>`, `On <base>`.
- Limits: spec or plan 1 MiB, HTML 5 MiB, 20 HTML entries for each issue.
- Warning: `Could not read documents for issue #N.`
- A document failure never fails the issue page or the issue feed.
  `issueRefsFingerprint` returns `refs-unavailable` instead of throwing.
- One content cache for each live source, keyed by blob ID, 64 entries and 32
  MiB.

## Review Focus

1. A link like `../../../etc/passwd.html` or `../outside.html` in a spec. It
   must not be listed (Task 2 test `refuses links outside the documents`).
2. A local Issue branch with the same blob as `origin/<branch>`. It must be
   `draft: false` with a host URL, not "Not pushed yet" (Task 2 test
   `pushed blobs are not drafts`).
3. Issue 38 and issue 384 in one repository. The ref fingerprint and the local
   branch filter of issue 38 must not see `agent/issue-384-*` (Task 2 test
   `issue prefixes do not overlap`).
4. A percent-encoded path in the file route, such as
   `/files/issues/9/..%2fpackage.json`. It must be `404`, never a file (Task 3
   test `file route refuses path-like ids`).
5. A broken Git repository or missing refs. The issue page must load with
   `artifacts: []` and one warning (Task 4 test
   `document failure keeps the issue page`).

---

### Task 1: Markdown to text blocks

**Files:**

- Create: `src/web/markdown-blocks.ts`
- Test: `src/web/markdown-blocks.test.ts`

**Interfaces:**

- Produces: `markdownBlocks(source: string): readonly TextBlock[]` and
  `markdownTitle(source: string): string | null` (text of the first level-one
  ATX heading, inline markers removed).

- [ ] **Step 1: Write the failing tests**

  One test per row of the spec's "Markdown to text blocks" table:
  - `headings of any level become heading blocks`: `"# A\n\n### B"` →
    `[{kind:"heading",content:[{kind:"text",text:"A"}]}, {kind:"heading",content:[{kind:"text",text:"B"}]}]`.
  - `fenced code keeps raw text`: a ` ```mermaid ` block and a `~~~` block each
    give one `{kind:"code", text}` with inner lines unchanged, including
    `<script>` text.
  - `lists flatten nesting and join continuation lines`:
    `"- a\n  more\n  - b\n1. c"` → one unordered list with items `a more` and
    `b`, then one ordered list with item `c`.
  - `pipe tables become plain text cells`: the source
    `"| A | **B** |\n|---|---|\n| 1 | \u0060x\u0060 |"` gives
    `{kind:"table", headers:["A","B"], rows:[["1","x"]]}`.
  - `blockquotes and raw HTML are paragraphs of text`:
    `"> q\n\n<iframe src=x></iframe>"` → paragraphs `q` and
    `<iframe src=x></iframe>` as text.
  - `inline markers`: this source (as a JS string, `\u0060` is a backtick):

    ```text
    a \u0060c\u0060 **s** *e* _e_ [h](https://x.test) [r](../m.html) ![alt](i.png) [j](javascript:x)
    ```

    gives exactly, with adjacent text merged:
    `[text "a ", code "c", text " ", strong "s", text " ", emphasis "e", text " ", emphasis "e", text " ", link "h" href "https://x.test", text " r alt j"]`.

  - `unclosed markers stay text`: the source `"**a \u0060b"` gives one `text`
    item with the same characters.
  - `markdownTitle` returns `Title x` for `"intro\n# Title *x*\n"`, and `null`
    without a level-one heading.

- [ ] **Step 2: Run the tests and see them fail**

  Run: `node --test src/web/markdown-blocks.test.ts` Expected: FAIL, module not
  found.

- [ ] **Step 3: Implement `markdownBlocks` and `markdownTitle`**

  A line-based block scan, then an inline scan for each paragraph, list item and
  heading. Adjacent text items merge. Thematic breaks (`---`, `***`) and blank
  lines end a block. Keep the file under about 250 lines (sibling
  `module-size`).

- [ ] **Step 4: Run the tests and see them pass**

  Run: `node --test src/web/markdown-blocks.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat(web): parse Markdown into text blocks"`

### Task 2: Issue document reader

**Files:**

- Create: `src/web/issue-documents.ts`
- Modify: `src/web/document-links.ts` (import the moved helpers)
- Test: `src/web/issue-documents.test.ts`

**Interfaces:**

- Consumes: `markdownBlocks`, `markdownTitle` (Task 1); `isArtifactFile`,
  `isIssueBranch` (`src/kernel/names.ts`); `createKernelGit().treeFiles`.
- Produces:

  ```typescript
  export type IssueFile = {
    readonly body: Buffer;
    readonly contentType: string;
  };
  export type IssueDocuments = {
    readonly artifacts: readonly Artifact[];
    file(id: string): Promise<IssueFile | null>;
  };
  export type DocumentRepositoryInput = {
    repoRoot: string;
    config: PatchmillConfig;
    baseBranch: string;
    repositoryUrl: string;
    provider: HostProviderId;
    runner: CommandRunner;
  };
  // Opaque: only createDocumentCache() makes one. Blob ID → parsed result.
  export type DocumentCache = { readonly __brand: "DocumentCache" };
  export function createDocumentCache(): DocumentCache; // 64 entries, 32 MiB, oldest out
  export function createIssueDocumentReader(
    input: DocumentRepositoryInput & {
      warn(message: string): void;
      cache?: DocumentCache;
    },
  ): (issue: number, branches: readonly string[]) => Promise<IssueDocuments>;
  export function issueRefsFingerprint(input: {
    repoRoot: string;
    runner: CommandRunner;
    issue: number;
    baseBranch: string;
  }): Promise<string>;
  export const fileIdPattern: RegExp; // /^(mockup|diagram)-[0-9a-f]{12}$/
  export function validBranchName(branch: string): boolean;
  export function hostFileUrl(input: {
    repositoryUrl: string;
    provider: HostProviderId;
    commit: string;
    path: string;
  }): string;
  ```

  `DocumentRepositoryInput` replaces the private `RepositoryInput` of
  `document-links.ts`. `validBranchName` and `hostFileUrl` are extracted from
  the inline code at `document-links.ts:56` and `:95-97`, and
  `createDocumentLinkReader` calls them. `document-links.test.ts` must still
  pass unchanged. `issueRefsFingerprint` never throws: a failed `git` call
  returns `"refs-unavailable"`.

- [ ] **Step 1: Write the failing tests**

  Build a temporary repository as `document-links.test.ts` does. Use
  `runCommand` as the runner, `issue: 9`, branch `agent/issue-9-docs`, base
  `main`, provider `github-gh`, URL `https://host/owner/repo`. The spec has a
  level-one heading `Docs`, and links `[Full-page mockup](../mockups/m.html)`
  and `[](../specs/2026-11-20-issue-9-docs-design-show-me.html)`.
  - `local-only documents are drafts`: commit spec, plan, mockup and show-me
    file on `refs/heads/agent/issue-9-docs` only. Assert four artifacts in the
    order spec, plan, mockup, diagram. Spec: `id:"spec"`, `title:"Docs"`,
    `draft:true`, `sourceUrl:null`,
    `location:"On local branch agent/issue-9-docs. Not pushed yet."`, `commit` =
    7-hex short SHA, `preview.kind:"document"`. Mockup: `id` =
    `"mockup-" + sha256("docs/mockups/m.html").slice(0,12)`,
    `title:"Full-page mockup"`,
    `preview:{kind:"page",url:"/files/issues/9/<id>"}`. Diagram title is the
    file name.
  - `pushed blobs are not drafts`: set `refs/remotes/origin/agent/issue-9-docs`
    to the same commit. Assert `draft:false`,
    `location:"On branch agent/issue-9-docs"`, and `sourceUrl` =
    `https://host/owner/repo/blob/<full sha>/docs/specs/<name>`. Then add a
    local commit that changes only the plan. Spec stays `draft:false` and its
    `commit` is the remote commit; plan is `draft:true` with the local location
    text and the local commit.
  - `base blobs on an unpushed branch`: the spec is on `origin/main` and the
    same blob is on a local-only Issue branch that also adds a plan. Spec:
    `location:"On main"`, `draft:false`, `commit` and `sourceUrl` of the
    `origin/main` commit. Plan: the local location text.
  - `base documents`: only `origin/main` has a spec. Location `On main`.
  - `refuses links outside the documents`: links to `https://x.test/a.html`,
    `/abs.html`, `../../../outside.html`, `m.html?x`, `m%2e.html`, a
    symbolic-link blob `docs/mockups/link.html`, a missing file, and a `.md`
    target. None is listed.
  - `limits`: a 1 MiB + 1 byte spec on the local branch is not listed, the
    smaller spec on `origin/main` is not used instead, its links are not read,
    and `warn` is called once. 21 linked HTML files give 20 entries.
  - `cache spans readers`: two readers that share one `createDocumentCache()`
    run `cat-file` for a blob only once.
  - `file returns only listed HTML`: `file(mockupId)` returns the committed
    bytes with `text/html; charset=utf-8`. `file("spec")`, `file("plan")`,
    `file("mockup-000000000000")`, and the mockup ID of issue 10 return `null`.
  - `issue prefixes do not overlap`: with refs for `agent/issue-38-a` and
    `agent/issue-384-b`, `issueRefsFingerprint({issue:38,...})` does not change
    when the issue 384 ref moves, and changes when `agent/issue-38-a` moves or
    when `origin/main` moves. A branch `agent/issue-384-b` passed in `branches`
    for issue 38 is not read as a local ref.

- [ ] **Step 2: Run the tests and see them fail**

  Run: `node --test src/web/issue-documents.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement the reader**

  Per call: build the ref list from the spec's "Discovery" order, resolve each
  ref with `git rev-parse --verify <ref>^{commit}`, and for each kind take the
  newest `isArtifactFile` name on the first ref that has one (as
  `createDocumentLinkReader` does). Read blobs with `git cat-file blob <sha>`
  after `git ls-tree -z <commit> -- <path>` confirms mode `100644`/`100755` and
  gives the blob ID and size (`ls-tree -l`). Draft and `sourceUrl` compare blob
  IDs with `origin/<branch>` and `origin/<base>`. Keep the parsed result of each
  blob in the `cache` by blob ID: blocks, title and links for Markdown, bytes
  for HTML (a private cache when none is passed). Warn about an oversized blob
  once for each blob ID. `issueRefsFingerprint` runs
  `git for-each-ref --format=%(refname) %(objectname)` over `refs/heads/agent/`,
  `refs/remotes/origin/agent/` and `refs/remotes/origin/<base>`, then keeps
  lines where `isIssueBranch(issue, …)` holds for the branch part, plus the base
  line. Join with `\n`. Catch every failure and return `"refs-unavailable"`.

- [ ] **Step 4: Run the tests and see them pass**

  Run:
  `node --test src/web/issue-documents.test.ts src/web/document-links.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat(web): find Issue documents in Git refs"`

### Task 3: Document CSP profile and file route

**Files:**

- Modify: `src/web/response-headers.ts`, `src/web/response-headers.test.ts`
- Modify: `src/web/run-data.ts`, `src/web/request.ts`
- Create: `src/web/issue-file-route.ts`
- Test: `src/web/issue-file-route.test.ts`

**Interfaces:**

- Consumes: `IssueFile`, `fileIdPattern` (Task 2).
- Produces:
  - `setResponseHeaders(response, profile: "app" | "sample" | "document" = "app")`.
    `"sample"` is today's `preview = true`.
  - `RunDataSource.documentFile?(issue: number, id: string): Promise<IssueFile | null>`.
  - `issueFilePath(path: string): { issue: number; id: string } | "invalid" | null`
    (`null` when the path does not start with `/files/`).

- [ ] **Step 1: Write the failing tests**
  - `response-headers.test.ts`: change the server stub to call
    `setResponseHeaders(res, profile)` with `"sample"` for `/preview` and
    `"document"` for `/document`. Scope the existing
    `doesNotMatch(/unsafe-inline/)` assertion to `/` and `/preview`. Extend the
    loop with `/document`. Assert the exact document CSP from Global
    Constraints, `doesNotMatch /allow-same-origin/` for it, and the current
    values for `/` and `/preview`.
  - `issue-file-route.test.ts`, with `startWebFixture(t, { source })` where
    `source` is the sample source plus a `documentFile` stub that returns
    `<p>m</p>` only for `(9, "mockup-0123456789ab")`:
    - `file route serves listed HTML with the document CSP`: `GET` with the
      cookie → `200`, body `<p>m</p>`, `content-type`
      `text/html; charset=utf-8`, exact document CSP, `cache-control: no-store`.
      `HEAD` → `200`, empty body.
    - `file route refuses unknown ids and methods`: `mockup-ffffffffffff`,
      `spec`, issue `0`, issue `10` → `404` with body `Not found.`; `POST` with
      a same-origin `Origin` → `405`, `Allow: GET, HEAD`.
    - `file route refuses path-like ids`: `/files/issues/9/..%2fpackage.json`,
      `/files/issues/9/mockup-0123456789ab/x`, `/files/issues/9/%2e%2e` → `404`.
    - `file route needs authentication`: no cookie → `401`.
    - `sample mode has no file route`: the plain sample source → `404`.

- [ ] **Step 2: Run the tests and see them fail**

  Run:
  `node --test src/web/response-headers.test.ts src/web/issue-file-route.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement**

  In `request.ts`, after the session route and before the method check, call
  `issueFilePath(path)`. On a match, check the method (`405` with `Allow`), call
  `source.documentFile?.(issue, id)` only when `fileIdPattern` matches, and send
  the body after `setResponseHeaders(res, "document")`. Any other result is
  `404 Not found.` Change line 114 to `setResponseHeaders(res, "sample")`.

- [ ] **Step 4: Run the tests and see them pass**

  Run:
  `node --test src/web/response-headers.test.ts src/web/issue-file-route.test.ts src/web/server-security.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat(web): serve Issue document HTML in an isolated sandbox"`

### Task 4: Live adapter wiring

**Files:**

- Modify: `src/web/file-run-data.ts`, `src/web/file-issue-detail.ts`
- Test: `src/web/file-issue-selection.test.ts` (or a new
  `src/web/file-issue-documents.test.ts` if that file grows past about 400
  lines)

**Interfaces:**

- Consumes: `createIssueDocumentReader`, `issueRefsFingerprint` (Task 2);
  `RunDataSource.documentFile` (Task 3).
- Produces: `readIssueDetail(input & { artifacts: readonly Artifact[] })`.

- [ ] **Step 1: Write the failing tests**

  Use a fixture whose `repoRoot` is a real temporary Git repository with
  `runCommand` as the runner. Its `progress.json` records branch
  `agent/issue-9-…`, and the local branch has a spec and a linked mockup.
  - `live detail lists Issue documents`: `snapshot({issue:9})` detail has the
    spec and mockup artifacts. The board snapshot (`snapshot()`) reads no blob:
    assert that the runner never received `cat-file`.
  - `documentFile serves a listed mockup`: `source.documentFile(9, mockupId)`
    returns the bytes; `source.documentFile(10, mockupId)` returns `null`.
  - `document failure keeps the issue page`: a runner that fails every `git`
    call. The detail has `artifacts: []`, and `warn` received
    `Could not read documents for issue #9.` once, checked before any feed
    subscription. Then a feed subscriber for issue 9 still gets its `reset`
    update.
  - `documentFile follows page eligibility`: an issue with the `unsuitable`
    label and a closed issue return `null`, even with a matching mockup on their
    branch.
  - `a new commit updates the feed`: extend `file-live-feed.test.ts` style. A
    commit on the Issue branch, with run files unchanged, delivers a `header`
    update whose artifacts carry the new commit.

- [ ] **Step 2: Run the tests and see them fail**

  Run:
  `node --test src/web/file-issue-selection.test.ts src/web/file-live-feed.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement**

  In `projectIssue`, when `withDetail` is true, call the reader with the same
  branch list as `links`, catch and warn, and pass `artifacts` to
  `readIssueDetail`. Extract one private helper from `projectIssue` that returns
  the roles check, run observation, associated pull requests and branch list, or
  `null` for an issue the page would not show. `projectIssue` and the new
  `documentFile(issue, id)` both use it; `documentFile` then returns
  `reader(issue, branches).file(id)`. Create one `createDocumentCache()` when
  the source is created and pass it to every reader. Wrap the feed fingerprint:
  `issueFingerprint(...) + "\n" + issueRefsFingerprint(...)`.

- [ ] **Step 4: Run the tests and see them pass**

  Run: `node --test "src/web/*.test.ts"` — Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat(web): show Issue documents on the live issue page"`

### Task 5: Browser viewer and chips

**Files:**

- Modify: `web/links.js`, `web/artifacts.js`, `web/issue.js`, `README.md` ("Web
  board" section)
- Test: `src/web/browser-links.test.ts`

**Interfaces:**

- Produces: `safePreviewUrl(value)` accepts `/files/issues/<n>/<id>` where `<n>`
  matches `^[1-9]\d*$` and `<id>` matches `fileIdPattern`'s source; and
  `previewSandbox(url: string): "allow-scripts" | "allow-same-origin"`; and
  `remainingDocumentLinks(links: readonly DocumentLink[], artifacts: readonly Artifact[]): DocumentLink[]`.

- [ ] **Step 1: Write the failing tests**
  - `safePreviewUrl` accepts `/files/issues/384/mockup-0123456789ab` and
    `/files/issues/1/diagram-abcdefabcdef`. It refuses `/files/issues/0/…`,
    `/files/issues/9/spec`, `/files/issues/9/mockup-0123`,
    `/files/issues/9/mockup-0123456789ab/x`, `/files/issues/9/MOCKUP-…`,
    `/files/issues/9/mockup-0123456789ab?x`, and `/files/../index.html`. The
    current `/samples/` cases still pass.
  - `previewSandbox("/files/issues/9/mockup-0123456789ab")` is
    `"allow-scripts"`; `previewSandbox("/samples/board.html")` is
    `"allow-same-origin"`.
  - `remainingDocumentLinks` with spec and plan links and a spec artifact
    returns only the plan link; with no artifacts it returns both.

- [ ] **Step 2: Run the tests and see them fail**

  Run: `node --test src/web/browser-links.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

  `artifacts.js`: set `frame.setAttribute("sandbox", previewSandbox(local))` and
  choose the note: the live note from Global Constraints for `/files/`, the
  current sample note otherwise. `issue.js`: build the `documentLinks` row from
  `remainingDocumentLinks(issue.documentLinks, detail.artifacts)`; skip the row
  when none remain. `README.md`: add one short paragraph to "Web board": the
  live issue page shows Issue documents from local and pushed branches, and
  mockup scripts run in an isolated frame without access to the page or the API.

- [ ] **Step 4: Run the checks**

  Run: `node --test src/web/browser-links.test.ts && npm run lint:ts` Expected:
  PASS, no warnings.

- [ ] **Step 5: Commit**

  `git commit -m "feat(web): open live Issue documents in the viewer"`

### Task 6: Real-browser sandbox check and full verification

**Files:**

- Create: `scripts/check-document-sandbox.mjs`
- Modify: `package.json` (`test:web` runs the new script after the two current
  ones)

- [ ] **Step 1: Write the check**

  Start `startServeServer` with a source that is the sample source plus a
  `documentFile` that returns a mockup whose script stores three results in
  `window.results`. Each probe runs in its own `try`/`catch` and records either
  the value or `"threw"`: `document.cookie`, the outcome of
  `fetch("/api/board")` (awaited), and `parent.document.title`. Wrap `snapshot`
  so that the detail of sample issue 210 also has a `mockup` artifact, ID
  `mockup-0123456789ab`, with `preview.url`
  `/files/issues/210/mockup-0123456789ab`. With Chromium over CDP (as
  `check-serve-layout.mjs` does), open the issue, open the mockup chip, and
  evaluate `window.results` in the frame's execution context. Assert: cookie is
  `"threw"` or `""`, fetch is `"threw"`, `parent.document.title` is `"threw"`,
  and the frame's `self.origin` is `"null"`. In the page context, assert that
  the frame's `getAttribute("sandbox")` is exactly `"allow-scripts"`. Then open
  the file URL as a top-level tab and assert `self.origin === "null"`. Like the
  current scripts, it uses `CHROMIUM` or `chromium` and fails when neither
  starts. It never skips.

- [ ] **Step 2: Run the full verification**

  Run: `npm test && npm run lint && npm run test:web` Expected: all pass.
  `test:web` reports the sandbox check passed.

- [ ] **Step 3: Manual check of the acceptance criteria**

  Run `patchmill serve` against this repository while this branch is local-only.
  Open issue #384. Make sure that Spec, Plan and Mockup chips show `draft`, each
  opens, and the mockup's own toggles work in the frame. Request
  `/files/issues/384/mockup-000000000000` and make sure the result is `404`.
  Record the results in the implementation PR body.

- [ ] **Step 4: Commit**

  `git commit -m "test(web): check that Issue document frames are isolated"`

## Verification choices

- Tests cover behavior and security boundaries only: parsing, discovery, access
  rules, CSP, the frame sandbox value, and the feed update.
- No test asserts document prose or the glossary text. `npm run lint:md` checks
  them.
- No npm dependency changes, so the Nix build is not required.

## Visual explanation

```mermaid
flowchart TD
  T1["Task 1<br/>markdownBlocks()"] --> T2["Task 2<br/>issue-documents.ts"]
  T2 --> T3["Task 3<br/>CSP profile + /files route"]
  T2 --> T4["Task 4<br/>file-run-data wiring"]
  T3 --> T4
  T2 --> T5["Task 5<br/>links.js, artifacts.js, issue.js"]
  T3 --> T6["Task 6<br/>browser sandbox check"]
  T4 --> T6
  T5 --> T6
```

Tasks 1 and 2 build the server-side model. Tasks 3 to 5 attach it to the route,
the adapter and the browser. Task 6 proves isolation in a real browser.

## Companion artifacts

- `docs/mockups/2026-11-20-issue-384-live-issue-documents.html`:
  [Full-page mockup](../mockups/2026-11-20-issue-384-live-issue-documents.html)

## Planning review

### Pass 1: combined spec and plan review

- Scope: this plan and the spec
  (`docs/specs/2026-11-20-issue-384-show-an-issue-s-spec-plan-and-mockups-on-the-liv-design.md`),
  together, at the start-of-implementation boundary. No gate applies.
- Reviewer: `reviewer` agent, model `claude-bridge/claude-opus-5-5`, thinking
  `high`. Base revision `19d588e` (`main`); documents at `ba11d71`.
- Reviewed body SHA-256: spec
  `e8b904565fa5d2f7d2aee8edb0c5653506819b18f7dbca379e8e797524758141`, plan
  `51358a7bb75050fe0a7a8974681e9a5bba1062c8d547fefa165e19fb1bd16b34`. The plan
  was compared with that spec hash.
- Survey: the reviewer read the issue path through `apiResponse`, `projectIssue`
  and `readIssueDetail`; `document-links.ts`, `kernel/git.ts` and
  `kernel/names.ts`; the request order in `request.ts`, `publicPath`,
  `request-policy.ts` and `auth.ts`; the 1-second feed tick in `issue-feed.ts`;
  and `web/links.js`, `web/artifacts.js`, `web/issue.js`. It confirmed the
  current-state claims, the `RunDataSource` seam with two real adapters, and the
  sandbox reasoning.
- Findings (all suggestions, no blockers), all **Accepted** in `c05b915`:
  - S1: Task 1 test expectations contradicted the merge and title rules. Fixed
    the expected values.
  - S2: Task 6 assumed `document.cookie` returns `""` and that the check can
    skip. Probes now use try/catch, the frame's `sandbox` value is asserted, and
    the check never skips.
  - S3: location, commit and `sourceUrl` for a base blob on an unpushed branch.
    The first remote ref with the same blob now decides all three; a test was
    added.
  - S4: `issueRefsFingerprint` had no error contract and could stop the feed. It
    now returns `refs-unavailable`; the failure test subscribes.
  - S5: no `warn` on the reader and no fallback rule for oversized files. Added
    `warn` and a no-fallback rule with a test.
  - S6: `documentFile` duplicated branch and eligibility logic. One helper now
    serves the page and `documentFile`; eligibility test added.
  - S7: the per-snapshot cache re-parsed documents every second. The content
    cache now lives for the source and is keyed by blob ID.
  - S8: the existing header test would fail on `unsafe-inline`. The plan now
    scopes that assertion.
  - S9: the `documentLinks` filter had no test. Added pure
    `remainingDocumentLinks` with a test.
  - S10: README "Web board" was not updated. Added to Task 5.
  - S11: UTF-8 note, ref fingerprint coverage note, diagram name and mockup text
    fixed.
- Limits: read-only; no tests, browser or server were run.

### Pass 2: scoped confirmation

- Same reviewer, model and thinking; documents at `c05b915`. Reviewed body
  SHA-256: spec
  `5183793607ca0b5a784efb4fc75c08777d15e14587963ba9118940179f314c19`, plan
  `77426f537a1e1ddd2a0b58b3ff6f4d3286add742dfe59f3d495ef9b441b70459`.
- Result: S1–S11 adequate, no new contradiction, no blocker.
- New optional suggestions, all **Accepted** after confirmation with wording
  edits only: N1 check the warning count before subscribing; N2 the cache holds
  title and links too; N3 opaque cache type and a 32 MiB cap; N4 warn once per
  blob ID; N5 mockup table header. These edits were not re-confirmed by the
  reviewer.
- Limits: the reviewer did not render the mockup or run Chromium.

### Outcome

- Final body SHA-256: spec
  `64aa42c2082d639cffbe31576cc35a575937fba6c421a42c946d550841cfdd3c`, plan
  `bb1b2f62f30970eeaefc5ff11f0cb574b7ac1f8bbe5bf8c1f04c69a70291c38e`. The plan
  record compares with that spec hash.
- Outcome: `ready`.
