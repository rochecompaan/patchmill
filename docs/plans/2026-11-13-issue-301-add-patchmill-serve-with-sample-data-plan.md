# Patchmill Serve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the sibling `executing-plans`
> skill for inline execution, task by task. Steps use checkbox (`- [ ]`) syntax
> for tracking. This kernel plan does not require implementer subagents or
> per-task reviewers.

**Goal:** Serve the complete Patchmill page with authenticated sample JSON data
and safe, view-only controls.

**Architecture:** A Node HTTP server applies request security before it reads a
provider snapshot or a packaged asset. A read-only sample provider supplies the
shared TypeScript wire contract. Plain browser modules construct safe DOM nodes
and fetch only same-origin JSON.

**Tech Stack:** Node.js built-ins, TypeScript, browser JavaScript with JSDoc,
HTML, CSS, and the existing Node test runner.

**Spec:**
[Approved design](../specs/2026-11-13-issue-301-add-patchmill-serve-with-sample-data-design.md),
including the maintainer's same-origin-only preview sandbox decision.

## Global Constraints

- Work only in the supplied issue worktree and branch. Never push `main`,
  force-push, merge, change labels, or post issue comments.
- Use Node.js `>=22.19.0`. Add no npm dependencies, framework, bundler, or
  browser build step.
- Default to `127.0.0.1:4280`. Public CLI ports are integers in `1..65535`.
  Internal server tests can use `0`.
- Use `PATCHMILL_SERVE_TOKEN` exactly when present. Reject an empty value or
  more than 1024 UTF-8 bytes. Otherwise generate 32 random bytes as base64url.
- Exchange only `GET /?token=...`. Return `303` and
  `patchmill_serve=<escaped-token>; HttpOnly; SameSite=Strict; Path=/`.
- Apply Host, Origin, authentication, method, and route checks in that order.
  Reject a wrong Host with `421`, a bad unsafe-method Origin with `403`, and
  missing authentication with `401`.
- Allow only GET and HEAD after authentication. Return `405` and
  `Allow: GET, HEAD` for other methods with a valid Origin.
- Send `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and
  `X-Content-Type-Options: nosniff` on all ordinary responses.
- Use this exact CSP:
  `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; frame-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'self'`.
- Preview responses replace script and connection permissions with
  `script-src 'none'` and `connect-src 'none'`, then add
  `sandbox allow-same-origin`.
- Use `sandbox="allow-same-origin"` for packaged preview iframes. Never grant
  `allow-scripts`, forms, popups, or top navigation.
- Import the response types through browser JSDoc. Do not fetch or execute
  server `.ts` files in the browser.
- Use text nodes and a closed set of DOM constructors. Never put API text into
  `innerHTML`, `srcdoc`, executable CSS, or event attributes.
- Preserve both themes and the mockup's visual system. Remove the MOCKUP bar and
  simulated run mutations.
- Use the exact note: “This comes with live chat. Nothing changed.” Keep
  submitted drafts in memory, scoped to their issue.
- Store a trimmed name of at most 32 characters under `patchmill-name`. Use
  `patchmill-theme` for the theme choice.
- Refresh a visible board every 15 seconds. Stop its timer while hidden. Add no
  EventSource route or connection.
- Keep real issues, run files, live chat, mutations, admission records, and
  kernel changes outside this slice.
- Ship local fonts, images, scripts, styles, and previews through npm and Nix.
  Run the Nix build after package manifest changes.

## Inputs

Read these before Task 1:

- [Specification](../specs/2026-11-13-issue-301-add-patchmill-serve-with-sample-data-design.md).
- [Offline full-page companion](../mockups/2026-11-13-issue-301-patchmill-serve.html).
- [Original full-page mockup](../mockups/web/run-once-workflow.html).
- [Original mockup notes and state table](../mockups/web/run-once-workflow.md).
- `AGENTS.md`, `CONTEXT.md`, `package.json`, `src/cli/main.ts`,
  `src/package-root.ts`, and `nix/package.nix`.

Keep both historical files under `docs/mockups/web/` unchanged. The companion is
a visual reference, not production code to serve unchanged.

The specification and companion already accompany this issue branch. The
maintainer chose same-origin-only preview sandboxes during planning. A Chromium
probe showed that an opaque sandbox omits the Strict cookie from stylesheet
requests. The selected sandbox sends that cookie without enabling scripts.

## Review Focus

These five conditions need deliberate review. Their regression cases appear in
the owning tasks.

1. Authenticated preview CSS must load without enabling preview scripts,
   including a preview opened in a new tab. Task 9 owns this case.
2. Duplicate or misleading raw Host and Origin headers must not bypass checks
   through Node's normalized header object. Tasks 3 and 5 own this case.
3. URL normalization must not hide encoded traversal or a symlink escape. Tasks
   4 and 5 own this case.
4. An old successful fetch must not restore stale issue data after navigation or
   authentication loss. Task 7 owns this case.
5. npm and Nix must resolve assets from the executing package, not an unrelated
   working directory. Tasks 4 and 10 own this case.

## File Structure

The feature has one delivery boundary: the secured server, browser page, and
installed assets must work together. Separate files isolate behavior without
creating separate projects.

| Area              | Files and responsibility                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| Wire contract     | `src/web/api-types.ts`: export the specification's response, thread, and artifact types unchanged                   |
| Read boundary     | `src/web/run-data.ts`: export `RunDataSource`, `RunDataSnapshot`, and `RunDataChange`                               |
| Fixtures          | `src/web/sample-data.ts` and `src/web/samples/{board,threads,artifacts,documents}.ts`: immutable sample projections |
| Authentication    | `src/web/auth.ts`: token generation, digest comparison, cookie parsing, and root exchange                           |
| Request policy    | `src/web/request-policy.ts`: allowed authorities and Origin validation                                              |
| Response policy   | `src/web/response-headers.ts`: baseline and preview headers                                                         |
| Assets            | `src/web/assets.ts`: public asset map, package-root resolution, and confined reads                                  |
| HTTP              | `src/web/api.ts`: JSON projection. `src/web/server.ts`: listener lifetime and ordered request handling              |
| CLI               | `src/cli/commands/serve/{args,main}.ts`: strict flags, startup output, and shutdown                                 |
| Browser logic     | `web/{api,state,controller,links}.js`: requests, presentation rules, routing, drafts, and safe URLs                 |
| Browser rendering | `web/{dom,board,issue,thread,artifacts}.js`: safe DOM construction and the artifact drawer                          |
| Browser lifetime  | `web/{app,preferences,theme-init}.js`: bootstrap, events, name storage, and themes                                  |
| Presentation      | `web/index.html`, `web/styles/{base,board,issue,thread,artifacts}.css`, and `web/images/grain.svg`                  |
| Fonts             | `web/fonts/atkinson-hyperlegible-{next,mono}.woff2` and `THIRD_PARTY_NOTICES.md`                                    |
| Preview assets    | `web/samples/{board,design-review,planning-flow}.html`, `web/samples/preview.css`, and three PNG samples            |
| Distribution      | `package.json`, `nix/package.nix`, and `scripts/smoke-{serve,packed-artifact}.mjs`                                  |
| Tests             | Focused `src/web/*.test.ts`, `src/cli/commands/serve/*.test.ts`, and `test-support/web-fixture.ts`                  |

Keep production modules near 200 meaningful lines where practical. Split
independent behavior before a module exceeds roughly 400 lines. Declarative
fixture data and CSS can be larger, with clear sections. Do not turn `app.js` or
`server.ts` into the extracted 4,000-line mockup.

## Testing Value Gate

- Maintain automated tests for authentication, request security, confinement,
  JSON contracts, CLI lifetime, and pure browser behavior.
- Use real Node HTTP requests for security integration. Use `node:net` for
  malformed raw requests that `fetch` normalizes.
- Import browser logic from TypeScript tests under `src/web/`. This keeps the
  existing `npm test` discovery pattern.
- Use installed browser tooling for real DOM, cookie, sandbox, network,
  keyboard, and visual acceptance. Do not install Playwright or a DOM emulator.
- Use direct inspection, `tsc`, lint, checksums, package smoke runs, and Nix
  builds for configuration, licenses, and distribution.
- Add no tests that only assert document text, static config, dependency
  versions, or smoke-script structure. Keep existing package tests intact.

Run each behavior test before its implementation and observe the intended
failure. Do not treat an unrelated setup error as the required red result. For
browser tasks, record the failed acceptance assertion before implementing the
missing behavior.

---

### Task 1: Define the wire contract and immutable sample provider

**Files:**

- Create: `src/web/api-types.ts`, `src/web/run-data.ts`,
  `src/web/sample-data.ts`.
- Create: `src/web/samples/board.ts`, `src/web/samples/threads.ts`,
  `src/web/samples/artifacts.ts`, `src/web/samples/documents.ts`.
- Test: `src/web/sample-data.test.ts`.

**Interfaces:**

- Consumes: the specification's exact TypeScript declarations and sample
  coverage table.
- Produces: all public wire types from `api-types.ts`. The three read-boundary
  types from `run-data.ts`.
- Produces: `createSampleRunDataSource(): RunDataSource` from `sample-data.ts`.
- `snapshot(): Promise<RunDataSnapshot>` returns a deeply frozen, consistent
  projection. `subscribe(listener): () => void` never emits for this provider.

- [ ] **Step 1: Write the provider contract tests.**

```ts
const source = createSampleRunDataSource();
const snapshot = await source.snapshot();
assert.equal(snapshot.source, "sample");
assert.equal(snapshot.syncedAt, null);
assert.deepEqual(
  new Set(snapshot.issues.map((i) => i.status)),
  new Set(["none", "working", "waiting", "idle", "paused", "blocked", "done"]),
);
assert.equal(new Set(snapshot.issues.map((i) => i.column)).size, 7);
assert.equal(Reflect.set(snapshot.issues[0]!, "title", "changed"), false);
assert.deepEqual((await source.snapshot()).issues, snapshot.issues);
```

Add named cases with these assertions:

| Test name                                                | Assertions                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `every board summary has matching issue detail`          | Each decimal detail key exists and its summary deeply equals the board entry                                              |
| `sample threads and artifacts satisfy the wire contract` | Stable unique event IDs, required null fields, chronological UTC times, all event variants, and valid artifact references |
| `all artifact kinds and both planning PR kinds exist`    | Five artifact kinds, spec and plan PRs, a draft document, and a nonempty screenshot gallery                               |
| `sample subscriptions are inert and idempotent`          | A listener receives no event. Unsubscribe twice does not throw                                                            |

- [ ] **Step 2: Run the failing tests.**

Run: `node --test src/web/sample-data.test.ts`. Expected: the missing provider
or its missing contract fails.

- [ ] **Step 3: Implement the types and sample projection.**

Copy the public declarations from the specification, with type-only exports. Use
revision `sample-v1`, source `sample`, and `syncedAt: null`. Use fixture
builders only to avoid repeated typed literals. Do not add an HTML parser.

Include `#298`, `#282`, `#206`, `#250`, `#227`, `#901`, `#210`, `#276`, `#263`,
`#231`, `#173`, and `#247`. Keep #901 explicitly synthetic and avoid a
fabricated GitHub issue link for it. Exclude unsuitable issues. Add
representative spec-review and plan-review PR metadata.

Translate message and document markup into `TextBlock` data. Keep tool arguments
as JSON-compatible objects and results as text. Derive artifact links from each
detail's artifact list. Use the sample asset URLs defined in Task 9.

Freeze nested arrays and objects before exposing the snapshot. Keep the provider
free of host, filesystem, config, and kernel imports.

- [ ] **Step 4: Run the green tests and type check.**

Run: `node --test src/web/sample-data.test.ts && npm run check:types`. Expected:
all provider cases pass and TypeScript reports no errors.

- [ ] **Step 5: Commit this deliverable.**

Run: `git add src/web && git commit -m "feat(web): add typed sample run data"`.
Expected: a commit containing the provider, fixtures, and tests.

### Task 2: Implement token exchange and cookie authentication

**Files:**

- Create: `src/web/auth.ts`.
- Test: `src/web/auth.test.ts`.

**Interfaces:**

- Produces: `createServeAuth(environmentToken?: string): ServeAuth`.
- `ServeAuth` exposes a readonly `token`,
  `authenticated(cookieHeader: string | undefined): boolean`, and
  `exchange(method: string, rawTarget: string): TokenExchange`.
- `TokenExchange` is `{ kind: "none" }`, `{ kind: "invalid" }`, or
  `{ kind: "redirect"; location: string; cookie: string }`.
- Only CLI composition reads the environment. The auth module receives the value
  explicitly.

- [ ] **Step 1: Write token and cookie behavior tests.**

```ts
const auth = createServeAuth("secret + ü");
const exchange = auth.exchange(
  "GET",
  "/?view=board&token=secret%20%2B%20%C3%BC",
);
assert.equal(exchange.kind, "redirect");
if (exchange.kind !== "redirect") assert.fail("missing exchange");
assert.equal(exchange.location, "/?view=board");
assert.equal(
  exchange.cookie,
  "patchmill_serve=secret%20%2B%20%C3%BC; HttpOnly; SameSite=Strict; Path=/",
);
assert.equal(auth.authenticated(exchange.cookie.split(";")[0]), true);
```

Add cases for wrong, empty, malformed, duplicate, and different-length query
tokens. Assert `kind: "invalid"`. Assert that HEAD, non-root paths, and other
methods never exchange a token.

Assert that missing, wrong, malformed, and duplicate authentication cookies
fail. An unrelated cookie can coexist with the auth cookie. Reject duplicate
auth names across joined Cookie headers.

Assert that empty and over-1024-byte environment values throw without echoing
them. Assert that two generated tokens are 43-character base64url strings and do
not authenticate each other's cookies. Equal environment tokens survive a
restart. Generated tokens do not.

- [ ] **Step 2: Run the failing tests.**

Run: `node --test src/web/auth.test.ts`. Expected: authentication behavior is
absent or fails its assertions.

- [ ] **Step 3: Implement authentication in `auth.ts`.**

Use `randomBytes(32)`, SHA-256, and `timingSafeEqual` on fixed-size digests.
Share the digest check between exchange and cookie validation. Do not compare
secret strings or reject candidates based on the secret's length.

Validate percent encoding before parsing token values. Remove only `token`
parameters from the relative root redirect. Never accept an absolute redirect
target. Encode cookie values with `encodeURIComponent`. Decode strictly on
input. Reject duplicate authentication names.

- [ ] **Step 4: Run the green tests and inspect the security primitive.**

Run: `node --test src/web/auth.test.ts && npm run check:types`. Expected: all
cases pass. Inspect the digest comparison directly. A timing benchmark is not
evidence of constant-time comparison.

- [ ] **Step 5: Commit this deliverable.**

Run:
`git add src/web/auth.ts src/web/auth.test.ts && git commit -m "feat(web): add token and cookie authentication"`.
Expected: a commit with no token in its message or artifacts.

### Task 3: Validate request authorities and Origin headers

**Files:**

- Create: `src/web/request-policy.ts`, `src/web/response-headers.ts`.
- Test: `src/web/request-policy.test.ts`, `src/web/response-headers.test.ts`.

**Interfaces:**

- Produces: `createRequestPolicy(binding: Binding): RequestPolicy`.
- `Binding` contains `host: string`, actual `address: string`, actual
  `port: number`, and startup `interfaces: readonly string[]`.
- `RequestPolicy.authority(rawHeaders: readonly string[]): string | null`
  returns a normalized allowed authority.
- `RequestPolicy.originAllowed(method: string, rawHeaders: readonly string[], authority: string): boolean`
  checks unsafe methods.
- Produces:
  `setResponseHeaders(response: ServerResponse, preview?: boolean): void`.

- [ ] **Step 1: Write policy tests using raw header arrays.**

```ts
const policy = createRequestPolicy({
  host: "127.0.0.1",
  address: "127.0.0.1",
  port: 4280,
  interfaces: [],
});
assert.equal(policy.authority(["Host", "localhost:4280"]), "localhost:4280");
assert.equal(policy.authority(["Host", "evil.example:4280"]), null);
assert.equal(
  policy.authority(["Host", "localhost:4280", "host", "evil.example"]),
  null,
);
assert.equal(
  policy.originAllowed(
    "POST",
    ["Origin", "http://localhost:4280"],
    "localhost:4280",
  ),
  true,
);
assert.equal(
  policy.originAllowed(
    "POST",
    ["Origin", "https://elsewhere.test"],
    "localhost:4280",
  ),
  false,
);
```

Add cases for missing Host, wrong ports, and omitted port at listeners 80
and 4280. Cover credentials, invalid brackets, IPv6 canonical forms, hostname
case, and forwarded headers. Assert that forwarded headers cannot make a foreign
Host valid.

For wildcard binds, allow only startup interface IPs and loopback authorities.
Reject arbitrary DNS names and wildcard literals as usable browser authorities.
For unsafe methods, reject missing, duplicate, `null`, credential-bearing,
path-bearing, query-bearing, fragment-bearing, and foreign Origin values.

Test actual HTTP responses from a tiny Node fixture for the header helper.
Assert the specification's exact CSP and three baseline headers. Assert preview
CSP includes `sandbox allow-same-origin`, no script permission, and no
connection permission.

- [ ] **Step 2: Run the failing policy tests.**

Run:
`node --test src/web/request-policy.test.ts src/web/response-headers.test.ts`.
Expected: the missing policy or header behavior fails.

- [ ] **Step 3: Implement startup-bound policy and headers.**

Count Host and Origin entries through `rawHeaders`, not only `request.headers`.
Parse an authority without credentials, paths, or suffix matching. Treat an
omitted port as 80. Canonicalize hostname case and IP literals. Preserve IPv6
brackets in authorities.

Build the allowlist once from the configured host, actual bind, and startup
interface addresses. Do no per-request DNS resolution. Match a serialized HTTP
Origin to the validated request authority. Reject URL suffixes and credentials.

Set the complete baseline policy on every response. The preview variant tightens
scripts and connections and adds its response-level sandbox. Do not add CORS
headers or CSP inline exceptions.

- [ ] **Step 4: Run the green tests.**

Run:
`node --test src/web/request-policy.test.ts src/web/response-headers.test.ts && npm run check:types`.
Expected: all policy and response-header cases pass.

- [ ] **Step 5: Commit this deliverable.**

Run:
`git add src/web/request-policy* src/web/response-headers* && git commit -m "feat(web): enforce request authority and response policies"`.
Expected: a focused security-policy commit.

### Task 4: Confine static reads to packaged web assets

**Files:**

- Create: `src/web/assets.ts`.
- Reuse unchanged: `src/package-root.ts`.
- Test: `src/web/assets.test.ts`.

**Interfaces:**

- Produces: `resolveWebRoot(moduleUrl: string | URL = import.meta.url): string`.
- Produces:
  `readWebAsset(webRoot: string, rawTarget: string): Promise<WebAsset | null>`.
- `WebAsset` contains `body: Buffer`, `contentType: string`, and
  `preview: boolean`.
- Maintain an explicit public URL-to-relative-file map in `assets.ts`. Tasks 7–9
  extend it for their actual asset files.

- [ ] **Step 1: Write confined-read and package-root tests.**

Create temporary package roots containing `package.json`, a fake source or
compiled module location, and a small `web/` tree. Never change the process
working directory in parallel tests.

```ts
assert.equal(
  resolveWebRoot(pathToFileURL(join(pkg, "src/web/assets.ts"))),
  join(pkg, "web"),
);
assert.equal(
  resolveWebRoot(pathToFileURL(join(pkg, "dist/src/web/assets.js"))),
  join(pkg, "web"),
);
assert.equal(
  (await readWebAsset(webRoot, "/"))?.contentType,
  "text/html; charset=utf-8",
);
for (const target of [
  "/../package.json",
  "/%2e%2e/package.json",
  "/%252e%252e/package.json",
  "/..%2fpackage.json",
  "/..%5cpackage.json",
  "/%00",
  "/%zz",
  "/missing",
  "/src/web/api-types.ts",
]) {
  assert.equal(await readWebAsset(webRoot, target), null);
}
```

Make the fixture's allowed `/app.js` a symlink to an outside file. Assert no
bytes escape. Repeat with an outside directory whose name shares the web-root
prefix. Assert no directory listings or catch-all shell responses. Assert
explicit JS, CSS, SVG, PNG, HTML, and WOFF2 MIME types.

- [ ] **Step 2: Run the failing asset tests.**

Run: `node --test src/web/assets.test.ts`. Expected: confinement or
package-relative lookup is missing.

- [ ] **Step 3: Implement raw-path validation and asset reads.**

Resolve the package from the executing module URL through `findPackageRoot`. Do
not read `process.cwd()` for asset lookup. Map `/` explicitly to `index.html`.

Validate the raw path before a URL parser can erase traversal. Decode once and
reject residual encoded attempts. Reject malformed escapes, NULs, backslashes,
separators encoded as path data, and dot traversal segments.

Resolve the candidate and root through `realpath`. Require a regular file inside
the root's directory boundary and an entry in the public map. Return null for
absent or forbidden files. Do not expose private absolute paths in errors. Mark
only the three packaged sample HTML pages as previews.

- [ ] **Step 4: Run the green tests.**

Run: `node --test src/web/assets.test.ts && npm run check:types`. Expected: all
confined-read and source/compiled lookup cases pass.

- [ ] **Step 5: Commit this deliverable.**

Run:
`git add src/web/assets* && git commit -m "feat(web): confine static serving to packaged assets"`.
Expected: a focused asset-boundary commit.

### Task 5: Compose the secured HTTP server and JSON routes

**Files:**

- Create: `src/web/api.ts`, `src/web/server.ts`, `test-support/web-fixture.ts`.
- Test: `src/web/server-security.test.ts`, `src/web/server-api.test.ts`.

**Interfaces:**

- Consumes: `RunDataSource`, `ServeAuth`, request policy, response headers, and
  the asset reader from Tasks 1–4.
- Produces: `startServeServer(options: ServeOptions): Promise<Serving>`.
- `ServeOptions` has `host: string`, `port: number`, `source: RunDataSource`,
  `auth: ServeAuth`, and optional `webRoot: string`.
- `Serving` has readonly `origin: string`, `url: string`,
  `networkExposed: boolean`, `closed: Promise<void>`, and
  `close(): Promise<void>`.
- `api.ts` exports
  `apiResponse(rawPath: string, source: RunDataSource): Promise<{ status: number; body: BoardResponse | IssueResponse | ApiError } | null>`.
- Produces:
  `startWebFixture(t: TestContext, overrides?: Partial<ServeOptions>): Promise<WebFixture>`
  from `test-support/web-fixture.ts`.
- `WebFixture` exposes `origin`, an encoded auth `cookie`,
  `request(path, options)`, and `rawRequest(text)`. Both request methods return
  `{ status: number; headers: IncomingHttpHeaders; body: string; bytes: Buffer }`.
- Request options accept an optional method, Node outgoing headers, and a
  cookie. Use `node:http` for normal requests and `node:net` for raw requests.
- Defaults are loopback port 0, token `test-token`, the sample provider, and a
  temporary public asset tree. Register teardown through `t.after`. Support a
  real `webRoot` override for Task 9.

- [ ] **Step 1: Write real HTTP security and API tests.**

```ts
const fixture = await startWebFixture(t);
assert.equal((await fixture.request("/api/board")).status, 401);
const login = await fixture.request("/?token=test-token");
assert.equal(login.status, 303);
assert.equal(login.headers.location, "/");
assert.match(
  String(login.headers["set-cookie"]),
  /HttpOnly; SameSite=Strict; Path=\//,
);
const board = await fixture.request("/api/board", { cookie: fixture.cookie });
assert.equal(board.status, 200);
assert.equal(JSON.parse(board.body).schemaVersion, 1);
const detail = await fixture.request("/api/issues/227", {
  cookie: fixture.cookie,
});
assert.deepEqual(
  JSON.parse(detail.body).issue.summary,
  JSON.parse(board.body).issues.find(
    (issue: IssueSummary) => issue.number === 227,
  ),
);
```

Add these named integration groups:

| Group                                        | Required assertions                                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `authentication gates every resource`        | Page, API, JS, fonts, images, previews, unknown paths, and HEAD need the cookie. A token on `/api/board` does not replace it                                             |
| `exchange is root GET only`                  | Duplicate/wrong tokens give 401. A valid cookie does not excuse an invalid root token. Redirect retains unrelated query parameters without token or authority            |
| `raw request policy runs before data access` | Wrong Host gives 421. Foreign/missing/duplicate Origin on POST gives 403. Authenticated same-origin POST gives 405 and Allow. Rejected requests make zero provider calls |
| `normalization cannot bypass confinement`    | Raw HTTP paths with plain, encoded, double-encoded, backslash, and symlink escapes give 404 after auth and reveal no outside bytes                                       |
| `all responses carry policy`                 | Assert baseline headers on 200, 303, 400, 401, 403, 404, 405, 421, and 500. Previews use the tighter CSP                                                                 |
| `HEAD is bodyless`                           | Compare GET/HEAD status and content headers for shell, API, static files, and errors. HEAD never exchanges a token                                                       |
| `API projects one snapshot per request`      | An injected counting provider supplies both routes. Each accepted API request calls snapshot once. Static requests call it zero times                                    |
| `API failures are bounded`                   | Invalid/unsafe issue number gives 400. Valid missing issue and unknown API route give 404. Rejected provider promise gives sanitized 500                                 |
| `API responses retain their declared shape`  | Decode both routes, inspect required fields and variants, nulls, artifact references, and every sample state against Task 1's contract                                   |
| `listener shutdown is idempotent`            | Close twice, await closed, release the port, and leave no test handles or unhandled rejections                                                                           |

Use HTTP/1.0 to exercise a missing Host at the policy layer. A parser-level
rejection of malformed HTTP/1.1 traffic must expose no data. Do not require
application headers on a rejection that occurs before Node creates a request.

- [ ] **Step 2: Run the failing HTTP tests.**

Run: `node --test src/web/server-security.test.ts src/web/server-api.test.ts`.
Expected: the server or its security/JSON assertions fail.

- [ ] **Step 3: Implement routing and listener lifetime.**

Install baseline headers before Host, Origin, auth, method, and route
processing. Use raw request targets until confinement checks finish. Apply the
root exchange before cookie authentication only for its one allowed route and
method.

Project API output from exactly one snapshot. Parse issue numbers as positive
safe decimal integers. Keep unknown API paths separate from static lookup. Do
not expose a file API, history endpoint, or mutation route.

Serve assets only after all request checks pass. Tighten the headers for preview
HTML. Send HEAD headers without a body. Catch asynchronous provider and file
errors. Return sanitized errors without tokens or internal paths. Reject
upgrades and CONNECT without creating a transport.

After binding, construct the policy from `server.address()` and
`os.networkInterfaces()`. Use a usable bracketed loopback URL for wildcard
listeners. Resolve `closed` on shutdown and reject startup errors before
returning a URL. Reject `closed` for later listener failures so the CLI can
report failure. Make `close` safe more than once and close idle connections.

- [ ] **Step 4: Run the green integration tests.**

Run: `node --test src/web/*.test.ts && npm run check:types`. Expected: all
server, provider, authentication, policy, and confinement tests pass with no
open handles.

- [ ] **Step 5: Commit this deliverable.**

Run:
`git add src/web test-support/web-fixture.ts && git commit -m "feat(web): serve authenticated sample JSON and assets"`.
Expected: a complete tested server boundary, without CLI wiring yet.

### Task 6: Wire the CLI and its process lifetime

**Files:**

- Create: `src/cli/commands/serve/args.ts`, `src/cli/commands/serve/main.ts`.
- Modify: `src/cli/main.ts`, `src/cli/main.test.ts`, `README.md`.
- Test: `src/cli/commands/serve/args.test.ts`,
  `src/cli/commands/serve/main.test.ts`.

**Interfaces:**

- Consumes: `createServeAuth`, `createSampleRunDataSource`, and
  `startServeServer`.
- Produces:
  `parseServeArgs(args: readonly string[]): { host: string; port: number } | "help"`.
- Produces:
  `main(args?: string[], options?: ServeMainOptions): Promise<number>`.
- `ServeMainOptions` optionally injects `output: CliOutput`,
  `env: NodeJS.ProcessEnv`, and `startServer: typeof startServeServer`.
- The command owns signals and console output. The server owns sockets and its
  closed promise.

- [ ] **Step 1: Write strict flag and command-lifetime tests.**

```ts
assert.deepEqual(parseServeArgs([]), { host: "127.0.0.1", port: 4280 });
assert.deepEqual(parseServeArgs(["--host", "::1", "--port", "5000"]), {
  host: "::1",
  port: 5000,
});
for (const args of [
  ["--port", "0"],
  ["--port", "1.5"],
  ["--port", "65536"],
  ["--port"],
  ["--host", ""],
  ["--host", "http://localhost"],
  ["--wat"],
  ["extra"],
]) {
  assert.throws(() => parseServeArgs(args));
}
```

Reject duplicate flags, scientific notation, and whitespace-only hosts.
Recognize `--help`, `-h`, and `help` without effects.

Inject a deferred fake `Serving` to prove that main waits for closed. Assert
that its URL appears only after startup. Assert that main closes once on SIGINT
or SIGTERM. Assert listener counts return to their original values after success
and errors. Assert bind errors return 1 without a link. Assert help never
creates auth or a server, even with an invalid environment token.

Use the real executable with `serve --help` from a temporary, non-repository
directory. Assert exit 0 and command-specific help. Retain the existing
executable bootstrap tests.

- [ ] **Step 2: Run the failing CLI tests.**

Run: `node --test src/cli/commands/serve/*.test.ts src/cli/main.test.ts`.
Expected: flags, registration, or process-lifetime behavior is missing.

- [ ] **Step 3: Implement command composition and usage documentation.**

Register `serve` in `COMMANDS` and `HELP_TEXT`. Keep config, host
authentication, Pi launch, and run ownership out of this command.

Print `Patchmill sample data: <url>` once after binding. Warn for network
exposure and unencrypted HTTP, without printing request URLs or environment
values separately. On signals, close the server and await its completion. Remove
signal listeners in `finally`.

Add the README command row and a short sample-server section. Describe defaults,
the printed link, persistent environment token, view-only controls, all-local
assets, and trusted-network limits. State that this sample command works without
a repository or provider account.

- [ ] **Step 4: Run the green CLI tests.**

Run:
`node --test src/cli/commands/serve/*.test.ts src/cli/main.test.ts bin/patchmill.test.ts && npm run check:types`.
Expected: all CLI cases pass, with no retained signal listeners.

- [ ] **Step 5: Commit this deliverable.**

Run:
`git add src/cli README.md && git commit -m "feat(cli): add patchmill serve command"`.
Expected: a registered, documented command with tested lifetime behavior.

### Task 7: Add typed browser requests, presentation rules, and race-safe state

**Files:**

- Create: `web/api.js`, `web/state.js`, `web/controller.js`.
- Modify: `tsconfig.quality.json`, `package.json`, `eslint.config.js`,
  `src/web/assets.ts`.
- Test: `src/web/browser-client.test.ts`, `src/web/browser-state.test.ts`.

**Interfaces:**

- Produces: `createApi(fetcher = globalThis.fetch): ApiClient` from `api.js`.
- `ApiClient.board(signal?: AbortSignal): Promise<BoardResponse>` and
  `issue(number: number, signal?: AbortSignal): Promise<IssueResponse>` use GET
  and `credentials: "same-origin"`.
- Produces: `ApiRequestError` with numeric `status`. Handle 401 before JSON
  parsing.
- Produces: `parseRoute(hash: string): Route`,
  `presentationFor(summary: IssueSummary): Presentation`, and
  `createDraftStore()` from `state.js`.
- `Route` is `{ view: "board" }`,
  `{ view: "issue"; number: number; artifactId: string | null }`, or
  `{ view: "not-found" }`.
- `Presentation.header` is
  `"start" | "pause" | "resume" | "retry" | "terminal" | null`. Its `composer`
  is `"enabled" | "disabled" | "terminal" | "finished"`, and `stopReply` is
  boolean.
- The draft store exposes `get(number: number): string` and
  `set(number: number, text: string): void`.
- Produces:
  `createPageController({ api, onState, visible, clock }): PageController` from
  `controller.js`.
- `clock.after(delayMs, callback)` returns a cancellation function. The
  controller exposes async `navigate(route)` and `retry()`, plus
  `visibilityChanged()` and `dispose()`.
- Export JSDoc typedefs for these interfaces. `onState(state: PageState): void`
  receives `route: Route`, `status`, `board: BoardResponse | null`,
  `issue: IssueResponse | null`, and `message: string | null`.
- `PageState.status` is
  `"loading" | "ready" | "unauthorized" | "not-found" | "error"`.
  `visible(): boolean` reports document visibility. A new route clears unrelated
  data. Authentication loss clears both responses.

- [ ] **Step 1: Write browser-logic tests without a DOM emulator.**

```ts
const drafts = createDraftStore();
drafts.set(250, "Keep this draft");
assert.equal(drafts.get(227), "");
assert.equal(drafts.get(250), "Keep this draft");
assert.equal(presentationFor(working).header, "pause");
assert.equal(presentationFor(working).stopReply, true);
assert.equal(presentationFor(terminalWorking).composer, "terminal");
assert.equal(presentationFor(paused).header, "resume");
```

Use typed Task 1 summaries for every state-table row. Assert terminal ownership
wins. An open implementation PR or done status has no run control or message
box.

Inject a recording fetcher. Assert only `/api/board` and positive-number
`/api/issues/N` GET requests with same-origin credentials. A 401 HTML response
must produce an auth error without attempting JSON parsing. Cover API 404, 500,
invalid JSON, and transport rejection.

Inject deferred API promises and a fake clock. Resolve issue B before issue A
and assert B remains visible. After a newer request receives 401, resolve an
older successful board request and assert no data returns. Assert 15,000ms
polling only on a visible board and no overlapping requests. Assert one
immediate refresh on return. Assert no timer after disposal or authentication
loss.

- [ ] **Step 2: Run the failing browser-logic tests.**

Run: `node --test src/web/browser-client.test.ts src/web/browser-state.test.ts`.
Expected: missing browser modules or incorrect state behavior fails.

- [ ] **Step 3: Implement the modules and browser checking.**

Use JSDoc imports from `../src/web/api-types.ts`. Keep these modules free of
top-level DOM access so Node tests can import them.

Use request generations and cancellation to ignore stale results. Retain the
current view during a background board refresh. Emit the loading view only
without current data for that route. A 401 clears displayed data, stops polling,
and tells the user to reopen the printed link.

Enable `allowJs` and `checkJs`, and add `web/**/*.js` to the quality config.
Keep the server build include unchanged. Extend ESLint's command and staged-file
configuration for `web/**/*.js`. Provide browser globals, with a classic-script
override for `theme-init.js`.

Add the three module URLs to the static map. Do not serve JSDoc import targets.

- [ ] **Step 4: Run the green tests and prove browser JS checking.**

Run:
`node --test src/web/browser-client.test.ts src/web/browser-state.test.ts && npm run check:types && npm run lint`.
Expected: all commands pass.

Temporarily add a browser JS probe with
`/** @type {number} */ const probe = "wrong";`. Run `npm run check:types` and
observe its failure at that file. Remove the probe and rerun successfully. Never
commit the probe or add a config-text test.

- [ ] **Step 5: Commit this deliverable.**

Run:
`git add web src/web tsconfig.quality.json package.json eslint.config.js && git commit -m "feat(web): add typed browser client and page state"`.
Expected: tested browser logic with no new dependency or build step. Rerun Nix
after the complete packaging change in Task 10.

### Task 8: Build the board, thread, themes, and view-only controls

**Files:**

- Create: `web/index.html`, `web/app.js`, `web/dom.js`, `web/board.js`,
  `web/issue.js`, `web/thread.js`.
- Create: `web/preferences.js`, `web/theme-init.js`, `web/links.js`.
- Create: `web/styles/base.css`, `web/styles/board.css`, `web/styles/issue.css`,
  `web/styles/thread.css`, `web/images/grain.svg`.
- Create: `web/fonts/atkinson-hyperlegible-next.woff2`,
  `web/fonts/atkinson-hyperlegible-mono.woff2`.
- Modify: `THIRD_PARTY_NOTICES.md`, `src/web/assets.ts`.
- Test: `src/web/browser-links.test.ts`, `src/web/browser-preferences.test.ts`.
  Real-browser acceptance below.

**Interfaces:**

- Consumes: `ApiClient`, `PageController`, `Route`, presentation rules, draft
  store, and shared wire types from Tasks 1 and 7.
- Produces: `renderBoard(document: Document, board: BoardResponse): HTMLElement`
  from `board.js`.
- Produces:
  `renderIssue(document: Document, issue: IssueDetail, name: string, draft: string): DocumentFragment`
  from `issue.js`.
- Produces: `renderThread(document: Document, issue: IssueDetail): HTMLElement`
  from `thread.js`.
- Produces:
  `renderBlocks(document: Document, blocks: readonly TextBlock[]): DocumentFragment`
  from `dom.js`.
- Produces: `safeExternalUrl(value: string): string | null` from `links.js`.
- Produces: `readName(storage: PreferenceStorage): string | null`,
  `saveName(storage: PreferenceStorage, value: string): string`, and
  `preferredTheme(storage: PreferenceStorage, osLight: boolean): "light" | "dark"`
  from `preferences.js`.
- `PreferenceStorage` is `Pick<Storage, "getItem" | "setItem"> | null`.
  `saveName` rejects an invalid name, returns a valid trimmed name, and
  tolerates a storage-write error. `readName` returns null for absent or invalid
  data.
- `app.js` mounts the real DOM, controller, preferences, and delegated events.
  Renderers emit stable event IDs and `data-artifact-id` triggers for Task 9.

- [ ] **Step 1: Write URL and preference regression tests and record browser
      acceptance failures.**

Assert that external links accept HTTP/HTTPS and reject `javascript:`, `data:`,
protocol-relative, and malformed URLs. Cover mixed-case schemes and leading
whitespace. Assert that storage exceptions do not prevent fallback. Assert that
invalid stored themes use OS preference. Assert that empty names fail and valid
names trim to at most 32 characters.

Run: `npm run patchmill -- serve --host 127.0.0.1 --port 4280`. Expected: a
listening server prints its token link. If port 4280 is busy, use another
explicit port without stopping another process. Open the printed link privately.
Before the page exists, record the failure of these browser assertions:

```js
console.assert(document.querySelectorAll(".col").length === 7);
console.assert(document.querySelector(".mockbar") === null);
console.assert(document.querySelector("#theme-switch") !== null);
```

After implementation, inspect the actual Network panel and DOM rather than only
the companion. Use the semantic selectors from the mockup where practical.

- [ ] **Step 2: Run the failing unit tests.**

Run:
`node --test src/web/browser-links.test.ts src/web/browser-preferences.test.ts`.
Expected: link or preference behavior is absent.

- [ ] **Step 3: Implement the page and local assets.**

Extract the approved layout, CSS tokens, SVG symbols, and responsive
breakpoints. Use the specification's 56px top bar, 268px board columns, 880px
thread, and typography. Move the decorative SVG data URL to
`web/images/grain.svg`. Use classes and SVG presentation attributes instead of
inline style markup.

Extract the two unmodified WOFF2 files from the companion's embedded font data.
Verify their SHA-256 values against the specification. Declare normal weights
`200 800`. Copy both copyright notices and the complete OFL 1.1 text into
`THIRD_PARTY_NOTICES.md`. Inspect licenses and checksums directly.

Load the classic external `theme-init.js` before the first paint. Follow OS
changes until a valid saved choice exists. Preserve supported theme animation
and reduced-motion behavior. Mount an accessible first-visit name dialog and the
name chip. Cancel keeps “You”. Store no token or draft in localStorage.

Render cards as an article with separate issue, artifact, and PR anchors. Render
messages, tools, errors, progress, and document blocks with safe constructors.
Put tool args/results in text nodes inside native `details` elements. Display
final cost only for finished runs.

Wire every run action and nonempty submission to the exact view-only note.
Cancel form navigation, support Enter and Shift+Enter, and respect IME
composition. Do not append events, clear drafts, or call a mutation endpoint.
Capture a draft under its old issue number before navigation and restore only
that issue's draft.

Preserve keyboard focus, open tool details, and scroll positions during relevant
updates. Skip unnecessary DOM replacement when the board revision is unchanged.
Show bounded loading, error/retry, not-found, and authentication-loss views.

Update the static map for every new public HTML, JS, CSS, SVG, and font asset.
Do not copy the companion's inline scripts, raw HTML fixture rendering, blob
URLs, or data-URL fonts into production.

- [ ] **Step 4: Run unit, type, lint, and browser checks.**

Run:
`node --test src/web/browser-*.test.ts && npm run check:types && npm run lint`.
Expected: all commands pass.

In the running app, verify these observable assertions:

| Case                                                          | Required result                                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Board, desktop and 390px, both themes                         | Seven accessible columns scroll inside the board. Page width does not overflow                                                  |
| All sample control states                                     | The specification's header/composer table matches, including terminal and finished cases                                        |
| Send, Enter, Stop reply, Start planning, Pause, Resume, Retry | The exact note appears. Thread and sample responses remain unchanged. No mutation request appears                               |
| Draft navigation                                              | A draft for #250 does not appear in #227 and returns when #250 reopens                                                          |
| Name and theme                                                | First prompt, Cancel, editing, persistence, OS fallback, blocked storage, and reduced motion all work                           |
| Hostile fixture values                                        | Titles, names, messages, tool results, and URLs display as text or rejected links. No script executes or foreign request occurs |
| Error and request races                                       | Loading, API failure, unknown issue, 401, and delayed navigation do not show stale data                                         |

Use a browser-only response override or an injected test provider for hostile
fixture values. Do not add a production debug endpoint. Verify the absence of
CSP violations during ordinary use.

- [ ] **Step 5: Commit this deliverable.**

Run:
`git add web src/web THIRD_PARTY_NOTICES.md && git commit -m "feat(web): render sample board and view-only issue threads"`.
Expected: a working page in both themes with local fonts and safe rendering.

### Task 9: Complete safe artifact previews and screenshot galleries

**Files:**

- Create: `web/artifacts.js`, `web/styles/artifacts.css`.
- Create: `web/samples/board.html`, `web/samples/design-review.html`,
  `web/samples/planning-flow.html`, `web/samples/preview.css`.
- Create: `web/samples/board-columns.png`, `web/samples/blocked-card.png`,
  `web/samples/board-mobile.png`.
- Modify: `web/app.js`, `web/links.js`, `web/index.html`, `src/web/assets.ts`.
- Test: extend `src/web/browser-links.test.ts`, `src/web/server-api.test.ts`,
  and `src/web/server-security.test.ts`.

**Interfaces:**

- Consumes: `Artifact`, `renderBlocks`, safe external links, stable artifact
  IDs, and Task 3's preview response policy.
- Produces:
  `mountArtifactViewer(dialog: HTMLDialogElement): { open(artifact: Artifact, trigger: HTMLElement): void; close(): void }`.
- Produces: `safePreviewUrl(value: string): string | null` from `links.js`,
  restricted to the six sample page/image URLs listed in this task.
- Sample mockups use `/samples/board.html` and `/samples/design-review.html`.
  Diagrams use `/samples/planning-flow.html`. Galleries use the three PNG URLs.

- [ ] **Step 1: Add preview boundary tests and record failed drawer
      acceptance.**

```ts
assert.equal(safePreviewUrl("/samples/board.html"), "/samples/board.html");
for (const value of [
  "/api/board",
  "/src/web/api-types.ts",
  "//evil.test/a.html",
  "https://evil.test/a.html",
  "data:text/html,hello",
  "/samples/../index.html",
]) {
  assert.equal(safePreviewUrl(value), null);
}
```

Use `startWebFixture(t, { webRoot: resolveWebRoot() })` to fetch every local
preview URL referenced by sample API responses. Assert 200 and the correct MIME
type. Without a cookie, assert 401 for each. For sample HTML, assert
`script-src 'none'`, `connect-src 'none'`, and `sandbox allow-same-origin` in
the response policy.

Before the drawer implementation, record failure to open an artifact from both
its header chip and thread card. Record the missing gallery navigation or focus
restoration.

- [ ] **Step 2: Run the failing preview tests.**

Run:
`node --test src/web/browser-links.test.ts src/web/server-api.test.ts src/web/server-security.test.ts`.
Expected: the new preview URL or serving assertions fail until the assets and
boundary are implemented.

- [ ] **Step 3: Implement the drawer and authored samples.**

Show title, repository-relative path, commit/draft, and location using safe text
nodes. Use `renderBlocks` for specs and plans. Load only allowlisted packaged
HTML in `sandbox="allow-same-origin"` iframes. Do not grant scripts or add raw
HTML to API data.

Use external `preview.css` and system fonts in the three authored sample pages.
They must work with the response-level sandbox and restrictive CSP. Keep the
samples scriptless when opened directly as well as inside the drawer.

Produce three raster sample images from synthetic content with browser tooling.
Use them for a nonempty gallery with captions, thumbnails, previous/next
controls, keyboard arrows, and an announced count. These gallery fixtures are
not implementation visual evidence.

Support direct board artifact links through `artifactId`. Use the same drawer
for a chip and a thread card. Escape, close-button, and backdrop dismissal
restore the original trigger's focus. Keep the background inert and the close
control visible on narrow screens. Use `noopener noreferrer` on new-tab and
source links.

- [ ] **Step 4: Run green tests and actual browser sandbox checks.**

Run:
`node --test src/web/browser-links.test.ts src/web/server-api.test.ts src/web/server-security.test.ts && npm run check:types && npm run lint`.
Expected: all automated cases pass.

In a real browser, open all five artifact kinds in both themes at desktop and
390px widths. Assert that preview stylesheet requests carry the auth cookie and
return 200. Verify the computed preview style, not only the iframe's load event.

Inspect `sandbox="allow-same-origin"` and the preview response CSP. Attempt a
script and a form submission in a disposable preview test state. Assert no
script runs, no parent state changes, and no API request occurs. Repeat the
script restriction for “Open in new tab”. Separate these deliberate policy
violations from ordinary-use console checks.

Use gallery arrows and thumbnails, then close through each dismissal path.
Assert the correct image count and focus restoration. The page must make no
foreign resource request.

- [ ] **Step 5: Commit this deliverable.**

Run:
`git add web src/web && git commit -m "feat(web): add sandboxed sample artifact previews"`.
Expected: all approved artifact previews work without weakening authentication
or script restrictions.

### Task 10: Verify npm and Nix distribution from unrelated directories

**Files:**

- Modify: `package.json`, `nix/package.nix`,
  `scripts/smoke-packed-artifact.mjs`.
- Create: `scripts/smoke-serve.mjs`.
- Reuse: the existing package and CLI tests. Do not add configuration-text
  assertions.

**Interfaces:**

- Consumes: the registered CLI, package-relative asset resolver, and complete
  web asset set.
- Produces:
  `smokeServe(command: string, args: readonly string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<void>`
  from `scripts/smoke-serve.mjs`, documented through JSDoc.
- The helper also supports `node scripts/smoke-serve.mjs -- COMMAND [ARGS...]`
  for a built wrapper. It creates its own temporary working directory by
  default.
- The helper captures startup output privately, follows the printed token
  exchange with Node HTTP, owns its child process, and always terminates and
  awaits it.

- [ ] **Step 1: Add a functional installed-server smoke check and observe
      missing assets.**

Create the smoke helper as the acceptance harness before testing package
behavior. Extend the packed-artifact smoke run to invoke it against the
installed binary before `git init` or `patchmill init`. Use an unrelated empty
directory and no Patchmill config. A missing helper import is not the intended
red result.

Before adding `web/` to the package files, run
`node scripts/smoke-packed-artifact.mjs`. Expected: the installed server cannot
load its missing web assets. This is a package behavior failure, not a test of
manifest text.

The helper must assert unauthorized 401, successful token exchange, cookie
flags, and a token-free redirect. It must load authenticated HTML, both JSON
routes, JS, CSS, WOFF2, PNG, and sample HTML/CSS. Assert MIME types and preview
CSP. Exercise HEAD and clean SIGTERM shutdown.

- [ ] **Step 2: Package the complete web asset set.**

Add `web` to npm `files`. In Nix `postInstall`, copy `$package_dir/web` to
`$out/share/patchmill/web`, beside the copied package manifest and TypeScript
sources. Keep the existing wrapper entrypoint and package-root strategy.

Use only Node built-ins in the helper. Select an available local port and retry
only a bounded EADDRINUSE race. Wait for actual startup output with a timeout,
not a fixed sleep. Do not print a secret URL or depend on provider credentials.
Clean temporary directories, sockets, and child processes on failure as well as
success.

Call the helper from `smoke-packed-artifact.mjs` without replacing its existing
checks. Keep npm dependencies unchanged. Do not rewrite lockfiles or
`npmDepsHash` unless an actual dependency-resolution change requires it.

- [ ] **Step 3: Run the green package smoke and Nix build.**

Run: `node scripts/smoke-packed-artifact.mjs`. Expected: npm pack, temporary
installation, all existing smoke checks, and the new installed server checks
pass.

Run: `nix build .#patchmill --print-build-logs`. Expected: the build, package
test phase, and install checks pass. This build is mandatory because
`package.json` changes.

Run: `node scripts/smoke-serve.mjs -- "$PWD/result/bin/patchmill"`. Expected:
the Nix wrapper passes the same HTTP, API, font, preview, and shutdown checks
from an unrelated directory.

Inspect the npm tarball listing, Nix output, and notices directly. Verify the
two font hashes against the specification. Keep temporary tarballs, `dist/`,
caches, and `result` out of commits.

- [ ] **Step 4: Run the complete repository checks.**

Run: `npm test && npm run check:types && npm run lint && npm run build`.
Expected: all commands exit 0. Browser files remain unbundled under `web/`. The
build compiles server code only.

- [ ] **Step 5: Commit this deliverable.**

Run:
`git add package.json nix/package.nix scripts/smoke-serve.mjs scripts/smoke-packed-artifact.mjs && git commit -m "build: package and verify serve assets for npm and Nix"`.
Expected: a distribution commit with functional installation evidence and no
added dependency.

## Final Validation, Visual Evidence, and Delivery

- [ ] Use the approved running implementation from this issue worktree. Wait for
      visible board or issue content before browser checks.
- [ ] Repeat the specification's browser acceptance after all integration
      changes. Cover both themes, desktop and 390px widths, all control states,
      and every artifact kind.
- [ ] Inspect network traffic: no foreign resource requests, no mutation
      requests from controls, and authenticated preview CSS succeeds. Verify no
      ordinary-use CSP errors.
- [ ] Use `patchmill-visual-evidence` to commit actual implementation
      screenshots, not captures of the companion or sample gallery fixtures.
- [ ] Save at least `docs/screenshots/serve-board-dark.png`,
      `serve-board-light.png`, `serve-issue-dark.png`, `serve-issue-light.png`,
      `serve-issue-mobile.png`, and `serve-artifact-preview-mobile.png` under
      that directory. Include a gallery capture if the drawer evidence does not
      show it.
- [ ] Capture the token-free address after authentication. Use only sample
      content and browser-local test names. Keep authentication files and
      network captures with secrets outside committed evidence.
- [ ] Commit evidence with a descriptive message such as
      `docs: add serve interface reference screenshots`.
- [ ] Rerun `npm test`, `npm run check:types`, and `npm run lint`. Repeat
      package or Nix smoke checks after any repair that affects installed
      behavior.
- [ ] Complete the normal implementation workflow's whole-branch review and
      applicable `patchmill-frontend-review`. Supply the spec, both mockups,
      final head, validation evidence, and screenshots. This plan adds no
      per-task review orchestration.
- [ ] Resolve findings under the implementation workflow. Refresh affected
      screenshots and rerun validation after repairs.
- [ ] Keep the spec, this plan, implementation, and screenshots together in the
      implementation PR. Describe the sandbox clarification, view-only
      boundaries, tests, distribution checks, and evidence paths there.
- [ ] Push only the supplied issue branch. Do not merge, change labels, or post
      issue comments from this plan.

## Plan Self-Review

The plan covers command lifetime, access, assets, provider, JSON routes, the
full page, all artifacts, fonts, browser checking, and both distributions. Each
of the five Review Focus conditions has an owning regression check. Public types
remain the specification's contract. Internal task signatures line up at their
consumers.

The only product clarification is the maintainer-selected same-origin-only
preview sandbox. It appears in the specification and companion. No real-data or
live-control work enters this plan.

## Planning Handoff

This session writes planning documents only. Commit and push this plan with the
narrowly updated spec and companion before calling the planning submit tool. Do
not begin Task 1 or open a separate planning PR. The kernel starts
implementation after the interactive planning result is accepted.
