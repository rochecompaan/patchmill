# Serve the Patchmill web page with sample data

- Issue: [#301](https://github.com/rochecompaan/patchmill/issues/301)
- Umbrella: [#300](https://github.com/rochecompaan/patchmill/issues/300)
- Status: Proposed specification for the interactive spec gate
- Scope: A complete, view-only page with sample data

## Intent

A team can open the Patchmill board and inspect an Issue run in a browser. This
first slice fixes the page structure, JSON contract, and access rules. Later
slices replace the sample provider without replacing the page or HTTP handlers.

The page shows the intended experience, including chat controls that do not work
yet. It must not suggest that a message reached an agent or changed a run.

## Inputs and decisions

The visual authority is
[`docs/mockups/web/run-once-workflow.html`](../mockups/web/run-once-workflow.html).
Its [notes](../mockups/web/run-once-workflow.md) define the board, controls,
themes, and delivery slices. Those files remain unchanged as the design record.

The maintainer explicitly included sample previews for all five artifact kinds:
specs, plans, mockups, diagrams, and screenshots. This includes the artifact
chips, thread cards, and preview drawer.

The issue and umbrella already select Node HTTP, TypeScript, plain browser
files, local fonts, and a read-only provider. The detailed contracts below are
specification choices, not additional maintainer instructions.

### Current repository

- `src/cli/main.ts` dispatches independent command modules. It has no `serve`
  command.
- `src/package-root.ts` finds installed assets relative to the package, not the
  current directory.
- npm runs compiled files under `dist/`. The Nix wrapper runs TypeScript from
  `$out/share/patchmill/`.
- `tsconfig.quality.json` currently checks TypeScript, but not browser
  JavaScript.
- The mockup is one HTML file. It fetches Google Fonts and simulates run changes
  in browser memory.
- `src/kernel/run-snapshot.ts` provides an internal progress projection. It is
  not the web contract or a public `snapshot`/`subscribe` provider.

The web server does not expose kernel `Facts`, private server paths, or raw Pi
session objects through its API. Artifact paths and tool arguments remain sample
display data. This slice does not change the kernel.

## Goals and boundaries

### Goals

- Provide `patchmill serve --host HOST --port PORT`.
- Serve the board, issue thread, and artifact previews from packaged assets.
- Keep both themes, the theme switch, and browser-local name storage.
- Require token authentication for the page, API, fonts, and sample previews.
- Define one typed JSON contract shared by the server and browser.
- Provide deterministic sample data for every state in the mockup.
- Keep all run access behind a read-only provider.
- Add no npm dependencies or browser build step.

### Non-goals

- Reading actual host issues, run files, sessions, or admission records.
- Starting, pausing, resuming, retrying, or stopping an Issue run.
- Sending messages, tracking actual viewers, or streaming updates.
- An EventSource route, polling real runs, or calculating live cost.
- Accounts, per-person access, TLS termination, or reverse-proxy support.
- Arbitrary worktree files, Git objects, Markdown conversion, or HTML uploads.

Real issues belong to #302, finished threads to #303, and live progress to #304.
Live chat and run controls need later connection work. They do not block this
slice.

### Anti-goals

- A button appears to change a run, even only in browser memory.
- An issue title, message, tool result, or name becomes executable HTML.
- A token, source file, or Pi log escapes through static file serving.
- The browser contacts another host to load fonts, images, scripts, or data.
- The page requires a repository config or host credentials to show samples.

## Approaches

| Approach                                       | Benefit                                                        | Cost or conflict                                                                  | Decision |
| ---------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------- |
| Split the mockup and add a typed HTTP boundary | Preserves the approved appearance and supports later providers | Requires safe DOM construction instead of copying mockup HTML interpolation       | Selected |
| Serve the mockup unchanged                     | Small initial change                                           | Retains external fonts, simulated mutations, and embedded data instead of the API | Rejected |
| Add a framework or bundler                     | Supplies component and build tooling                           | Conflicts with the agreed plain-file architecture and adds unnecessary tooling    | Rejected |

The implementation separates command lifetime, request security, HTTP routing,
provider data, and browser rendering. It does not put the whole feature in one
command module. Exact module names and helper boundaries belong to the plan.

## Command and process lifetime

`patchmill serve` defaults to host `127.0.0.1` and port `4280`. It needs no
Patchmill config, Git repository, host account, or network connection after
installation.

The command accepts `--host HOST`, `--port PORT`, and `--help`. Unknown
arguments, empty hosts, missing values, and ports outside `1..65535` produce a
short error and a nonzero exit. Hosts are bind addresses or DNS hostnames, not
URLs. Port `0` is available only through the internal server test seam.

After a successful bind, the command prints a usable URL such as:

```text
Patchmill sample data: http://127.0.0.1:4280/?token=SECRET
```

The URL escapes the token and brackets IPv6 addresses. It appears only after the
server listens successfully. The page identifies its data as sample data in the
existing sync-status position. It does not claim a GitHub sync occurred.

`PATCHMILL_SERVE_TOKEN` supplies the exact token. An explicitly empty value or a
value over 1024 UTF-8 bytes produces an error. Without the variable, each start
generates 32 cryptographically random bytes, encoded as base64url.

The process stays alive until interrupted. SIGINT and SIGTERM close the listener
and release its resources. A bind error produces a nonzero exit. Stopping this
server never signals an Issue run.

### Bind addresses and allowed authorities

The server constructs its allowed authorities once, after the bind. Each
includes the actual listening port. An authority is a hostname or IP address,
plus its port, as used in an HTTP `Host` header.

- A concrete bind allows the configured hostname or address and the actual bound
  IP address.
- A loopback bind also allows `localhost` at that port. It does not imply every
  port or every hostname that resolves to loopback.
- A wildcard bind (`0.0.0.0` or `::`) allows local interface IP addresses
  recorded at startup and loopback aliases at that port.
- A wildcard bind prints a loopback URL, not a URL containing a wildcard
  address. The command warns that the listener is available on the network.
- A changed network address requires a restart. There is no per-request DNS
  lookup or open-ended hostname suffix match.

Hostnames compare case-insensitively. IP literals use their canonical form. An
omitted port means HTTP port 80, not the configured listening port. IPv6
authorities require brackets. Missing or malformed authorities, duplicate Host
headers, credentials, and unexpected ports fail closed.

A rejected Host receives `421 Misdirected Request`, before any token exchange or
data access. The allowlist never derives from `Origin`, forwarded headers, or
the requested URL. `X-Forwarded-Host` and `X-Forwarded-Proto` grant no trust.

The default listener is local HTTP. A non-loopback bind is for a trusted network
or VPN. The command warns that HTTP does not encrypt the token or content. This
slice does not provide secure Internet hosting.

## Request security

### Order of checks

Every response gets the baseline headers first. Each ordinary HTTP request then
passes these checks, in order:

1. Validate the Host authority.
2. For methods other than GET and HEAD, validate Origin.
3. Authenticate through the root token exchange or cookie.
4. Enforce methods and route/path rules.
5. Read a snapshot or serve a packaged asset.

No failed check reaches the provider or reads an asset. The HTTP parser can
reject malformed protocol traffic before a request exists. That rejection must
not expose content or credentials.

### Token exchange and cookie

Only `GET /?token=...` can exchange a token for a cookie. Other query parameters
can remain, but duplicate `token` parameters fail with `401`. An incorrect,
empty, or malformed token also returns `401` without a cookie or redirect. A
valid cookie does not excuse an invalid token on this route.

A successful exchange returns `303 See Other` and a session cookie:

```text
Set-Cookie: patchmill_serve=<escaped-token>; HttpOnly; SameSite=Strict; Path=/
Location: /
```

The relative redirect keeps the original path and other query parameters but
removes the token. It cannot redirect to another authority. Browser fragments
remain client-side, so a printed link can also identify an issue view. The
exchange response contains no page scripts or assets.

The cookie has no Domain, Max-Age, or Expires attribute. It is host-only and
lasts for the browser session. Local HTTP cannot use a Secure cookie. Future
HTTPS support must add Secure rather than trust a forwarded header.

Every other request needs this cookie, including HEAD requests, API calls,
fonts, and previews. A token in another path or an Authorization header is not
an alternative. Duplicate authentication cookies or invalid cookie encoding fail
closed.

Without a valid cookie, the server returns `401` with a short HTML page: “Open
the link printed by patchmill serve.” It does not reveal a token, repository
name, issue title, or filesystem path. The page needs no assets. HEAD returns
the same headers without a body.

The server hashes candidate tokens with SHA-256 and compares fixed-size digests
with `crypto.timingSafeEqual`. Both query-token and cookie checks use this path,
including wrong-length inputs. No direct secret-string comparison or
secret-prefix test decides authentication.

The token exists only in the environment, server memory, printed link, and
HttpOnly cookie. The server never puts it in JSON, page markup, localStorage,
error output, or request logs. A generated token from an earlier start no longer
works. An environment token continues to work across starts.

### Origin and methods

Every method other than GET or HEAD needs a single Origin header. Its parsed
HTTP origin must equal the origin represented by the validated request Host and
the actual HTTP listener. Missing, foreign, malformed, and `null` origins
receive `403 Forbidden`.

No route changes state. After authentication, all non-GET/HEAD methods receive
`405 Method Not Allowed` with `Allow: GET, HEAD`. Thus a foreign POST gets
`403`, while an authenticated same-origin POST gets `405`. No CORS permission
headers are sent. An OPTIONS request does not bypass these checks.

GET and HEAD differ only in their response bodies. HEAD never exchanges a token
and never sends a body. Upgrade requests do not create a WebSocket or another
unauthenticated transport.

### Headers and safe content

All responses, including redirects and errors, send this CSP:

```text
default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; frame-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'self'
```

The ancestor rule permits same-origin preview frames and rejects foreign
parents. Preview responses use the tighter policy described under artifacts.

All responses also send:

```text
Cache-Control: no-store
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
```

There are no inline event handlers, executable inline scripts, inline style
attributes in generated markup, or unsafe CSP exceptions. The early theme script
is an external, same-origin file. Decorative data-URL images in the original
mockup become local assets. Browser-local forms cancel submission.

Issue and run text enters the DOM through text nodes or `textContent`.
Formatting uses a closed set of element constructors. No API field reaches
`innerHTML`, `srcdoc`, an event attribute, or executable CSS.

External issue, PR, and source links are ordinary explicit navigation, not
background fetches or embeds. They accept only HTTP or HTTPS URLs and use
`rel="noopener noreferrer"` for new tabs. A local asset URL must identify an
allowlisted packaged sample asset. `javascript:`, arbitrary `data:`, protocol-
relative URLs, and caller-supplied filesystem paths are not preview sources.

### Static confinement

`/` serves the application shell. Browser routes use `#/board` and `#/issue/N`,
as in the mockup. No catch-all route serves the shell for unknown HTTP paths.

Static files come only from the installed package's `web/` directory. They never
come from the working directory, repository root, or a run worktree. The handler
permits only public web assets and sample preview files. It does not expose
server TypeScript, type-import targets, config, notices outside `web/`, or
`.patchmill/`.

Path validation precedes URL normalization that can erase dot segments. The
handler rejects malformed escapes, NULs, backslashes, encoded separators, and
traversal segments, including encoded and double-encoded attempts. It resolves
the file's real path and enforces the `web/` directory boundary. Symlinks cannot
escape that boundary. Directories have no listing or implicit index behavior,
except the explicit root route.

An authenticated forbidden or absent path returns `404`, with no absolute path
in the response. Static responses use explicit MIME types, including
`text/javascript`, `text/css`, and `font/woff2`.

## Read-only data boundary

The server receives a `RunDataSource` dependency. The sample implementation
constructs its fixtures without reading GitHub, config, run files, or the
kernel. API handlers receive no second path to run data.

```ts
interface RunDataSource {
  snapshot(): Promise<RunDataSnapshot>;
  subscribe(listener: (change: RunDataChange) => void): () => void;
}

interface RunDataSnapshot {
  readonly repository: Repository;
  readonly source: "sample" | "live";
  readonly revision: string;
  readonly syncedAt: string | null;
  readonly issues: readonly IssueSummary[];
  readonly details: Readonly<Record<string, IssueDetail>>;
}

interface RunDataChange {
  readonly revision: string;
}
```

A snapshot is an immutable, internally consistent projection. Detail keys are
decimal issue numbers. Every listed issue has matching detail data. The provider
never exposes mutable fixture objects to callers.

`subscribe` returns an idempotent unsubscribe function. Changes identify a new
revision and tell readers to obtain a new snapshot. They do not define a
transport, append raw session events, or grant mutation capabilities. The sample
provider never emits changes. Its subscription is a safe no-op.

This interface is the read half of the umbrella's intended RunControl, not a
second workflow controller. #304 can consume subscriptions through EventSource.
This slice does not open an EventSource connection or invent a live-update
protocol.

## JSON API contract

`GET /api/board` returns `BoardResponse`. `GET /api/issues/:number` returns
`IssueResponse`. Both return `200` and `application/json; charset=utf-8`. Each
request obtains one provider snapshot and projects its response from that
snapshot.

The public types live in TypeScript under `src/`. Browser JSDoc imports those
types for checking only. The browser does not fetch or execute a `.ts` file.
Types use readonly arrays and explicit nulls for absent values. Optional fields
do not silently disappear from the JSON contract.

The following declarations define the version-one response shape. The plan can
split their source files without changing the wire contract.

```ts
type ColumnId =
  | "triage"
  | "ready"
  | "planning"
  | "review"
  | "implementing"
  | "code"
  | "blocked";

type IssueStatus =
  | "none"
  | "working"
  | "waiting"
  | "idle"
  | "paused"
  | "blocked"
  | "done";

type PhaseId =
  | "brainstorm"
  | "spec"
  | "spec-review"
  | "plan"
  | "plan-review"
  | "implement"
  | "code-review";

interface Repository {
  readonly name: string;
  readonly url: string;
}

interface Label {
  readonly name: string;
  readonly tone: "neutral" | "ready" | "info" | "blocked";
}

interface PullRequest {
  readonly number: number;
  readonly label: string;
  readonly url: string;
  readonly state: "open" | "merged" | "closed";
  readonly kind: "spec" | "plan" | "implementation";
}

interface ArtifactLink {
  readonly id: string;
  readonly kind: "spec" | "plan" | "mockup" | "diagram" | "shots";
  readonly title: string;
}

interface IssueSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly labels: readonly Label[];
  readonly column: ColumnId;
  readonly status: IssueStatus;
  readonly terminal: boolean;
  readonly phase: PhaseId | null;
  readonly step: string | null;
  readonly elapsedSeconds: number | null;
  readonly blockedReason: string | null;
  readonly pullRequests: readonly PullRequest[];
  readonly artifacts: readonly ArtifactLink[];
}

interface BoardResponse {
  readonly schemaVersion: 1;
  readonly repository: Repository;
  readonly source: "sample" | "live";
  readonly revision: string;
  readonly syncedAt: string | null;
  readonly issues: readonly IssueSummary[];
}

interface IssueResponse {
  readonly schemaVersion: 1;
  readonly repository: Repository;
  readonly source: "sample" | "live";
  readonly revision: string;
  readonly syncedAt: string | null;
  readonly issue: IssueDetail;
}

interface IssueDetail {
  readonly summary: IssueSummary;
  readonly participants: readonly string[];
  readonly thread: readonly ThreadEvent[];
  readonly artifacts: readonly Artifact[];
  readonly finalUsage: {
    readonly tokens: number | null;
    readonly cost: {
      readonly amount: string;
      readonly currency: string;
    } | null;
  } | null;
}

type Inline =
  | { readonly kind: "text" | "code"; readonly text: string }
  | { readonly kind: "strong" | "emphasis"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly href: string };

type TextBlock =
  | {
      readonly kind: "paragraph" | "heading";
      readonly content: readonly Inline[];
    }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly items: readonly (readonly Inline[])[];
    }
  | { readonly kind: "code"; readonly text: string }
  | {
      readonly kind: "table";
      readonly headers: readonly string[];
      readonly rows: readonly (readonly string[])[];
    };

type ThreadEvent = {
  readonly id: string;
  readonly at: string | null;
} & (
  | { readonly kind: "step"; readonly number: number; readonly label: string }
  | {
      readonly kind: "message";
      readonly author: string;
      readonly role: "agent" | "person";
      readonly blocks: readonly TextBlock[];
      readonly note: string | null;
    }
  | {
      readonly kind: "tool";
      readonly name: string;
      readonly arguments: Readonly<Record<string, unknown>>;
      readonly result: string | null;
      readonly state: "running" | "completed" | "stopped" | "failed";
    }
  | { readonly kind: "progress" | "earlier"; readonly text: string }
  | {
      readonly kind: "usage";
      readonly taskTokens: number;
      readonly totalTokens: number;
      readonly elapsedSeconds: number;
    }
  | {
      readonly kind: "divider";
      readonly tone: "advance" | "neutral" | "blocked";
      readonly text: string;
    }
  | { readonly kind: "error"; readonly title: string; readonly text: string }
  | {
      readonly kind: "artifact";
      readonly artifactId: string;
      readonly text: string;
    }
);

type Artifact = ArtifactLink & {
  readonly path: string;
  readonly commit: string | null;
  readonly location: string;
  readonly draft: boolean;
  readonly sourceUrl: string | null;
} & (
    | {
        readonly kind: "spec" | "plan";
        readonly preview: {
          readonly kind: "document";
          readonly blocks: readonly TextBlock[];
        };
      }
    | {
        readonly kind: "mockup" | "diagram";
        readonly preview: { readonly kind: "page"; readonly url: string };
      }
    | {
        readonly kind: "shots";
        readonly preview: {
          readonly kind: "gallery";
          readonly shots: readonly {
            readonly url: string;
            readonly path: string;
            readonly caption: string;
          }[];
        };
      }
  );
```

Numbers for issues and PRs are positive safe integers. Durations and token
counts are nonnegative. Timestamps use ISO 8601 UTC. Revision strings are opaque
equality values, not persisted workflow state. A sample snapshot uses a fixed
revision and `syncedAt: null`.

Thread events have stable IDs, appear oldest first, and contain no raw HTML. An
earlier-step summary keeps the mockup's collapsed-history appearance. Activating
it explains that only sample history is available. It fetches nothing and does
not create a history endpoint. Artifact events reference an artifact ID in the
same issue. Galleries contain at least one image.

Board artifact links open the issue's corresponding drawer. Board spec, plan,
and PR links are separate anchors, not nested inside the issue-card anchor. The
browser does not need an extra artifact API route for sample previews.

A malformed issue number returns `400`. A valid unknown issue returns `404`.
Unknown API routes return `404`. Provider errors return `500` without internal
paths, tokens, or stack traces. Authenticated route and provider errors use this
shape:

```ts
interface ApiError {
  readonly error: {
    readonly code: "invalid_issue" | "not_found" | "internal_error";
    readonly message: string;
  };
}
```

Authentication, Host, Origin, and method failures use the status and short
responses defined earlier. The browser handles `401` before attempting JSON
parsing. It tells the user to reopen the printed link instead of retrying
authentication in JavaScript.

## Sample coverage

The samples preserve representative mockup content. They do not claim to reflect
the current state of these GitHub issues. Each state has a separate, navigable
card. There is no state selector or MOCKUP bar in the served page.

| Example                             | Board column    | State and purpose                                |
| ----------------------------------- | --------------- | ------------------------------------------------ |
| #298 and #282                       | Triage          | No workflow label and needs-info                 |
| #206                                | Ready           | No run, disabled composer, Start planning        |
| #250                                | Planning        | Agent working, Pause and Stop reply              |
| #227                                | Planning        | Waiting for a reply, messages and draft spec     |
| #901, explicitly a synthetic sample | Planning        | Paused, Resume and disabled composer             |
| #210                                | Planning review | Idle during planning review, Pause and artifacts |
| #276                                | Implementing    | Working implementation, expanded tool details    |
| #263                                | Implementing    | Terminal-owned run, no chat controls             |
| #231 and #173                       | Code review     | Finished run, implementation PR, final cost      |
| #247                                | Blocked         | Error reason, Retry and disabled composer        |

The fixture set includes all seven board columns, both planning PR kinds, all
five artifact kinds, a draft artifact, and a finished gallery. Unsuitable issues
do not appear. Classification lives in the provider projection, not in DOM code.
This slice does not add new triage labels or reinterpret current workflow policy
from the mockup's historical labels.

## Page and interaction design

Frontend design applies. This issue creates browser-visible layout, navigation,
typography, themes, previews, and interaction states.

### Preserve the existing visual system

The full-page board and chronological thread are the main visual features. There
is no new hero, dashboard summary, sidebar, or application framework. The
explicit mockup overrides generic advice against dense cards, uppercase workflow
labels, or warm light backgrounds.

The implementation retains these tokens:

| Role            | Dark theme | Light theme |
| --------------- | ---------- | ----------- |
| Page background | `#08090b`  | `#f3f0ea`   |
| Panel           | `#121418`  | `#fffefb`   |
| Main text       | `#e4e4e4`  | `#1c1a17`   |
| Brass accent    | `#c4a882`  | `#7f6038`   |
| Live/advance    | `#39c96b`  | `#187a41`   |
| Stop/error      | `#ff4c4c`  | `#c42b2b`   |

Atkinson Hyperlegible Next serves body text and controls. Atkinson Hyperlegible
Mono serves issue numbers, steps, tool details, and small data. The base text
remains 15px with a 1.55 line height. The issue heading remains 22px on desktop
and 19px on narrow screens.

The top bar remains 56px tall. Board columns retain a 268px minimum width and
horizontal scrolling. The thread stays centered with an 880px maximum width. The
artifact drawer uses up to 860px and fills narrow screens.

```text
Board
+---------------------------------------------------------------+
| Patchmill | repository        Sample data | theme | name        |
+---------------------------------------------------------------+
| Triage | Ready | Planning | Planning review | ... | Blocked     |
| cards  | cards | cards    | cards           |     | reasons     |
+---------------------------------------------------------------+

Issue
+---------------------------------------------------------------+
| Patchmill | repository        Sample data | theme | name        |
+---------------------------------------------------------------+
| Board | #227 title                              Pause           |
| workflow rail | status | elapsed | PRs                         |
| Planning: Spec, Plan, Mockup, Diagram | Review: Screenshots     |
+---------------------------------------------------------------+
| chronological thread                         | artifact drawer |
| messages, tools, progress, artifact cards     | when opened     |
+---------------------------------------------------------------+
| Message the agent                            Send / Stop reply |
| view-only note                                                |
+---------------------------------------------------------------+
```

The product removes the striped MOCKUP bar and its reserved height. The composer
reaches the viewport bottom. The watermark centers in the remaining space. The
status position says “Sample data” and shows the current server authority rather
than the mockup's obsolete port.

### State-to-control mapping

Terminal ownership takes precedence over all other states.

| Issue state                             | Header control             | Composer                                |
| --------------------------------------- | -------------------------- | --------------------------------------- |
| No run                                  | Start planning             | Visible but disabled                    |
| Working                                 | Pause                      | Enabled, with Stop reply                |
| Waiting for reply                       | Pause                      | Enabled                                 |
| Idle during planning or planning review | Pause                      | Enabled                                 |
| Paused                                  | Resume                     | Visible but disabled                    |
| Blocked by an error                     | Retry                      | Visible but disabled                    |
| Terminal-owned run                      | Running in a terminal note | Terminal view-only note, no message box |
| Implementation PR open, or done         | None                       | Finished/review note, no message box    |

Every enabled run control and nonempty message submission shows: “This comes
with live chat. Nothing changed.” The note uses an accessible status region near
the control or composer. Enter submits a message. Shift+Enter inserts a newline.
Stop reply shows the same note.

These interactions send no mutation request, append no message or divider, and
change no sample status. A submitted draft stays in the input so the user does
not mistake its disappearance for delivery. Drafts stay in browser memory and
belong to their issue. Navigation never carries a draft into another issue.
Empty messages do nothing. Disabled controls retain the mockup's explanatory
hint.

The name prompt opens on the first visit. It accepts a trimmed, nonempty name of
up to 32 characters and stores it under `patchmill-name`. Cancel keeps a
browser-local “You” fallback. The name chip reopens the dialog. No name goes to
the server. The copy makes clear that live-chat names are not accounts. Storage
failure does not prevent use of the page.

The theme follows the OS until the user chooses a theme. The switch stores that
choice under `patchmill-theme` and maintains its accessible switch state. An
invalid stored choice falls back to the OS preference. The token never enters
either storage key.

### Artifacts and previews

Header chips and thread cards open the same drawer. The drawer shows the
artifact title, path, commit or draft state, and location. These are display
values, not paths that the server opens.

- Specs and plans use structured text blocks, including headings, lists, code,
  and tables. The page constructs safe elements instead of parsing Markdown or
  injecting HTML from JSON.
- Mockups and diagrams use a small set of authored HTML sample pages under
  `web/`. The drawer uses `sandbox="allow-same-origin"`. It does not allow
  scripts, forms, top navigation, or popups. These are packaged samples, not
  arbitrary provider HTML.
- During plan preparation, the maintainer selected this same-origin-only
  sandbox. Chromium treats stylesheet requests from an opaque sandbox as
  cross-site and omits the Strict cookie. Same-origin permission lets those
  authenticated requests work without script permission.
- Sample preview pages use external same-origin CSS and no inline scripts. Their
  own CSP sets `script-src 'none'`, `connect-src 'none'`, and
  `sandbox allow-same-origin`. This also restricts previews opened in a new tab.
  Preview pages use system fonts. They load no font files or foreign assets.
- Screenshots use packaged raster images, captions, thumbnails, previous/next
  buttons, and an announced image count. Keyboard arrows change the image.
- “Open in new tab” uses the same allowlisted local preview URL with no opener.
  Source links appear only for samples with a valid source URL.

Closing through Escape, the close button, or the backdrop restores focus to the
originating chip or card. The background is inert while the dialog is open.
Opening a preview never authenticates another host or reads a worktree.

The offline companion embeds its preview documents and draws sample gallery
images inline. These are planning-only substitutes for packaged product assets.
They do not authorize blob URLs, data URLs, or API HTML in production.

### Responsive behavior and accessibility

At widths under 760px, the repository and faint sync text hide, header controls
move below the title, and keyboard hints hide. Under 520px, the wheel replaces
the full wordmark. The theme and name controls remain usable. The board and
workflow rail scroll within their own regions, not the page. The drawer fills
the viewport without clipping its close control.

Semantic landmarks, labeled dialogs, visible keyboard focus, and tool `details`
elements remain. Mobile users can reach every control. Text labels carry state
as well as color. Reduced-motion preferences disable decorative animation and
theme-transition effects.

A loading state precedes the first response. API errors show a short message and
a read-only retry action. An unknown issue shows a not-found view with a Board
link. Refreshes and route changes cannot replace a newer response with an older
one. They preserve focus, open tool details, and the current draft where
practical.

The board refreshes through `fetch` every 15 seconds while visible, as the notes
require. A hidden tab stops the timer. Returning to the tab refreshes once
before restarting it. The fixed sample revision does not generate simulated
progress, changing elapsed values, or fake sync timestamps. Issue details load
on navigation. This slice adds no live issue subscription.

## Fonts, type checking, and packaging

The product commits normal-style variable WOFF2 files for weights 200–800 under
`web/fonts/`. These cover the mockup's 400, 500, and 700 weights without runtime
font downloads or conversion.

Use these upstream files and preserve their matching OFL notices:

| Family                     | Upstream revision                          | File under `fonts/webfonts/`           | SHA-256                                                            |
| -------------------------- | ------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------ |
| Atkinson Hyperlegible Next | `7925f50f649b3813257faf2f4c0b381011f434f1` | `AtkinsonHyperlegibleNext[wght].woff2` | `abde1ad5cf78b9ac575ef90d991f2e9101eb0b3b6668bde9a00e2e1e27d99afd` |
| Atkinson Hyperlegible Mono | `154d50362016cc3e873eb21d242cd0772384c8f9` | `AtkinsonHyperlegibleMono[wght].woff2` | `4cf41c5cacdb2e98311929f3a482e95b2299ca34e6f389e8968a9075e355d58a` |

The repositories are
[googlefonts/atkinson-hyperlegible-next](https://github.com/googlefonts/atkinson-hyperlegible-next)
and
[googlefonts/atkinson-hyperlegible-next-mono](https://github.com/googlefonts/atkinson-hyperlegible-next-mono).
Each revision contains `OFL.txt`. Add both copyright notices and the full SIL
Open Font License 1.1 text to `THIRD_PARTY_NOTICES.md` during implementation.
The companion mockup embeds these fonts and their notices in its own file.

`npm run check:types` enables `allowJs` and `checkJs`, includes `web/**/*.js`,
and checks browser DOM code with the shared response types. It emits no browser
files. The TypeScript build still compiles server code only.

npm `files` includes `web/`. Nix `postInstall` copies that same directory to
`$out/share/patchmill/web/`, beside its existing `package.json` and `src/`.
Asset resolution starts at the executing package's location and works from both
source TypeScript and compiled JavaScript. It never depends on the process's
current directory.

The npm tarball and Nix output include fonts, preview pages, styles, scripts,
images, and font notices. No new npm dependency, lockfile resolution, browser
compiler, or font download occurs at runtime.

## Verification contract

The plan must use behavior tests for security, request routing, API contracts,
and view-only behavior. Static configuration and document wording need direct
inspection, not brittle text-assertion tests.

### Automated behavior

- Exercise the server through real HTTP requests on an ephemeral loopback port.
- Prove token exchange, cookie flags, a token-free relative redirect, and the
  absence of a token in response bodies and logs.
- Cover missing, invalid, expired-generated, and environment-supplied tokens.
  Cover duplicate tokens and cookies and non-ASCII environment tokens.
- Prove that page, API, static assets, previews, and HEAD all require the
  cookie. HEAD bodies remain empty.
- Reject missing, foreign, malformed, duplicate, and wrong-port Host values.
  Exercise localhost, concrete bind addresses, and IPv6 where available.
- Reject a foreign or missing Origin on POST. Reject an authenticated
  same-origin POST with `405`. No request changes the fixture.
- Verify CSP and the baseline headers on success, redirects, and errors.
- Exercise plain, encoded, and double-encoded traversal, backslashes, malformed
  escapes, a sibling-prefix path, and a symlink outside `web/`.
- Verify both JSON response shapes and every sample status. Verify that board
  summaries match detail summaries, and artifact IDs resolve within an issue.
- Verify invalid and unknown issue responses, provider failure handling, and
  that API handlers use only the injected read-only provider.
- Prove that caller mutation cannot alter later sample snapshots and that
  unsubscribe is safe more than once.
- Exercise CLI defaults, argument errors, bind errors, link output, asset lookup
  outside a repository, and clean shutdown.
- Verify that hostile message text, titles, names, tool results, and URLs cannot
  execute script or request a foreign resource.

### Browser acceptance

Browser checks use the implementation, not only the companion mockup. The
implementation must include committed reference screenshots under the normal
visual-evidence workflow.

- Compare the board, issue header, thread, and drawer in dark and light themes.
- Use desktop and narrow mobile widths, including 390px.
- Inspect every state-to-control row and all five preview kinds.
- Use Send, Enter, Stop reply, Start planning, Pause, Resume, and Retry. Each
  enabled action shows the note and changes no thread, run, or board.
- Inspect network traffic to prove that those actions send no mutation requests
  and that page resources use only the current origin.
- Verify name persistence, cancel behavior, theme persistence, OS fallback,
  reduced motion, keyboard focus, and dialog focus restoration.
- Verify that sandboxed sample previews cannot run scripts, submit forms, read
  the parent, or access the API.
- Check loading, authentication loss, an API error, an unknown issue, and
  navigation during an outstanding request.

Use installed browser tooling without adding a package dependency. A browser
walkthrough and network capture can verify UI behavior that lacks a maintained
automation harness. Server security tests remain automated.

### Distribution and repository checks

- Run `npm test`, `npm run check:types`, and `npm run lint`.
- Build and inspect an npm tarball. Install it in a temporary directory and
  serve it from an unrelated working directory.
- Run `nix build`. Start the built wrapper from an unrelated directory and
  verify an authenticated page, both APIs, fonts, and previews.
- Inspect package contents and the font licenses directly. Do not add tests that
  only assert the text of `package.json` or `nix/package.nix`.

These are implementation acceptance checks. This specification stage changes
only the specification and its companion mockup. It does not claim that the
server, implementation tests, or package verification already exist.

## Companion artifacts

- `docs/mockups/2026-11-13-issue-301-patchmill-serve.html`:
  [Offline full-page mockup](../mockups/2026-11-13-issue-301-patchmill-serve.html)

The companion opens directly from disk without network access, installation, or
a server. It preserves the existing design, removes the MOCKUP bar, provides
separate sample states, and changes run actions to view-only notes. The original
files under `docs/mockups/web/` remain the historical record.
