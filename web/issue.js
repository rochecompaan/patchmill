import { el, icon, externalLink, person, elapsed } from "./dom.js";
import { renderThread } from "./thread.js";
import { presentationFor, PHASES } from "./state.js";
/** @typedef {import('../src/web/api-types.ts').IssueDetail} IssueDetail */
/** @typedef {import('../src/web/api-types.ts').IssueSummary} IssueSummary */
/** @typedef {import('./state.js').Presentation} Presentation */

/** @param {Document} doc @param {import('./state.js').RunAction|'stop-reply'} action @param {string} text @param {string} [className] */
function button(doc, action, text, className = "btn") {
  const b = el(doc, "button", className);
  b.type = "button";
  b.dataset.action = action;
  const symbol = {
    start: "play",
    resume: "play",
    pause: "pause",
    retry: "retry",
    "stop-reply": "stop",
  }[action];
  b.append(icon(doc, "icon-" + symbol), doc.createTextNode(text));
  return b;
}

/** @param {Document} doc @param {IssueSummary} issue */
function renderRail(doc, issue) {
  const rail = el(doc, "ol", "rail");
  rail.setAttribute("aria-label", "Workflow");
  const current = PHASES.findIndex((phase) => phase.id === issue.phase);
  PHASES.forEach((phase, index) => {
    const className =
      index < current
        ? "done"
        : index === current
          ? "current" + (issue.status === "blocked" ? " is-blocked" : "")
          : "";
    const step = el(doc, "li", className, phase.label);
    if (index === current) step.setAttribute("aria-current", "step");
    if (phase.pr) step.append(el(doc, "span", "pr-tag", "PR"));
    rail.append(step);
  });
  return rail;
}

/** @param {Document} doc @param {IssueDetail} detail @param {string} name @param {Presentation} p */
function renderMeta(doc, detail, name, p) {
  const issue = detail.summary;
  const meta = el(doc, "div", "meta"),
    status = el(doc, "span", "meta-item");
  status.append(el(doc, "i", p.dotClass), el(doc, "b", "", p.statusLabel));
  meta.append(status);
  if (issue.step)
    meta.append(el(doc, "span", "meta-item mono", "step " + issue.step));
  if (issue.elapsedSeconds !== null)
    meta.append(
      el(
        doc,
        "span",
        "meta-item mono",
        "elapsed " + elapsed(issue.elapsedSeconds),
      ),
    );
  for (const pr of issue.pullRequests) {
    const item = el(doc, "span", "meta-item");
    item.append(
      externalLink(doc, pr.label, pr.url, "pr-link"),
      el(doc, "span", "pr-state", pr.state),
    );
    meta.append(item);
  }
  if (detail.run) {
    for (const [label, value] of [
      ["started", detail.run.startedAt],
      ["ended", detail.run.finishedAt],
    ]) {
      if (!value || !Number.isFinite(Date.parse(value))) continue;
      const item = el(doc, "span", "meta-item run-time", label + " ");
      const time = el(
        doc,
        "time",
        "",
        new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "UTC",
        }).format(new Date(value)) + " UTC",
      );
      time.dateTime = value;
      item.append(time);
      meta.append(item);
    }
  }
  if (
    detail.run?.outcome !== "active" &&
    (detail.run || (issue.status === "done" && detail.finalUsage))
  ) {
    const usage = detail.finalUsage;
    const cost = usage?.cost
      ? new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: usage.cost.currency,
          minimumFractionDigits: 4,
          maximumFractionDigits: 4,
        }).format(Number(usage.cost.amount))
      : null;
    const tokens =
      usage?.tokens === null || usage?.tokens === undefined
        ? "tokens not recorded"
        : `${new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(usage.tokens)} tokens`;
    meta.append(
      el(
        doc,
        "span",
        "meta-item mono",
        usage
          ? `Cost, all retained attempts: ${cost ?? "not recorded"} · ${tokens}`
          : "Cost not recorded",
      ),
    );
  }
  const here = el(doc, "span", "meta-item", "here now "),
    presence = el(doc, "span", "presence");
  for (const who of new Set([name, ...detail.participants]))
    presence.append(person(doc, who, true));
  here.append(presence);
  meta.append(here);
  return meta;
}

/** @param {Document} doc @param {IssueDetail['artifacts']} entries */
function renderArtifactChips(doc, entries) {
  const artifacts = el(doc, "div", "artifacts");
  for (const [group, kinds] of [
    ["Planning", ["spec", "plan", "mockup", "diagram"]],
    ["Code review", ["shots"]],
  ]) {
    const items = entries.filter((a) => kinds?.includes(a.kind));
    if (!items.length) continue;
    const row = el(doc, "div", "art-group");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", String(group) + " artifacts");
    row.append(el(doc, "span", "art-label", String(group)));
    for (const artifact of items) {
      const chip = el(
        doc,
        "button",
        "art-chip" + (artifact.draft ? " is-draft" : ""),
      );
      chip.type = "button";
      chip.dataset.artifactId = artifact.id;
      chip.setAttribute("aria-haspopup", "dialog");
      const label = {
        spec: "Spec",
        plan: "Plan",
        mockup: "Mockup",
        diagram: "Diagram",
        shots: "Screenshots",
      }[artifact.kind];
      chip.append(
        icon(doc, "icon-" + artifact.kind),
        doc.createTextNode(label),
      );
      if (artifact.draft) chip.append(el(doc, "span", "art-draft", "draft"));
      row.append(chip);
    }
    artifacts.append(row);
  }
  return artifacts;
}

/** @param {Document} doc @param {IssueDetail} detail @param {string} name @param {Presentation} p */
function renderHeader(doc, detail, name, p) {
  const issue = detail.summary;
  const header = el(doc, "header", "ihead"),
    inner = el(doc, "div", "ihead-inner");
  header.dataset.issue = String(issue.number);
  const back = el(doc, "a", "back", "← Board");
  back.href = "#/board";
  inner.append(back);
  const top = el(doc, "div", "ihead-top"),
    title = el(doc, "h1", "ititle");
  title.append(
    externalLink(doc, "#" + issue.number, issue.url, "inum"),
    doc.createTextNode(issue.title),
  );
  const control = el(doc, "div", "control");
  if (p.header === "terminal")
    control.append(el(doc, "span", "note-pill", "Running in a terminal"));
  else if (p.header && p.control)
    control.append(button(doc, p.header, p.control.label, p.control.className));
  top.append(title, control);
  inner.append(
    top,
    renderRail(doc, issue),
    renderMeta(doc, detail, name, p),
    renderArtifactChips(doc, detail.artifacts),
  );
  if (issue.documentLinks.length) {
    const links = el(doc, "div", "artifacts");
    links.setAttribute("aria-label", "Planning documents");
    for (const link of issue.documentLinks)
      links.append(
        externalLink(
          doc,
          link.kind === "spec" ? "Spec" : "Plan",
          link.url,
          "art-chip document-link",
        ),
      );
    inner.append(links);
  }
  header.append(inner);
  return header;
}

/** @param {Document} doc @param {IssueSummary} issue @param {string} name @param {string} draft @param {Presentation} p @param {'sample'|'live'} source */
function renderComposer(doc, issue, name, draft, p, source) {
  const footer = el(doc, "footer", "composer");
  if (p.composer === "terminal" || p.composer === "finished") {
    footer.append(el(doc, "div", "note-bar", p.composerHint));
    return footer;
  }
  const disabled = p.composer === "disabled";
  const form = el(
    doc,
    "form",
    "composer-box" + (disabled ? " is-disabled" : ""),
  );
  form.id = "composer";
  const input = el(doc, "textarea");
  input.id = "composer-input";
  input.dataset.issue = String(issue.number);
  input.rows = 1;
  input.placeholder =
    source === "live"
      ? "Live chat is not available yet."
      : "Message the agent as " + name;
  input.setAttribute("aria-label", "Message the agent");
  input.value = draft;
  input.disabled = disabled;
  form.append(input);
  if (p.stopReply)
    form.append(button(doc, "stop-reply", "Stop reply", "btn btn-stop"));
  const send = el(doc, "button", "btn btn-primary", "Send");
  send.type = "submit";
  send.disabled = disabled;
  form.append(send);
  const hint = el(doc, "p", "composer-hint");
  hint.append(
    el(doc, "i", p.dotClass),
    el(doc, "span", "", p.composerHint),
    el(doc, "span", "kbd-hint", "Enter to send · Shift+Enter for a new line"),
  );
  footer.append(form, hint);
  return footer;
}

/** @param {Document} doc @param {IssueDetail} detail @param {string} name @param {string} draft @param {'sample'|'live'} [source] */
export function renderIssue(doc, detail, name, draft, source = "sample") {
  const p = presentationFor(detail.summary);
  if (source === "live") {
    p.statusLabel = !detail.run
      ? "No run yet"
      : {
          active: "Run active",
          completed: "Finished",
          stopped: "Stopped",
          incomplete: "Incomplete",
        }[detail.run.outcome];
    if (detail.run?.outcome === "active") p.dotClass = "dot dot-live";
  }
  const fragment = doc.createDocumentFragment();
  const active = source === "live" && detail.run?.outcome === "active";
  const thread = active
    ? el(doc, "section", "thread")
    : renderThread(doc, detail);
  thread.setAttribute("aria-label", "Issue thread");
  if (source === "live") {
    thread.classList.add("is-recorded");
    if (detail.body !== null)
      thread.append(el(doc, "div", "issue-body", detail.body));
    if (active || !detail.run) {
      const empty = el(doc, "div", "empty");
      empty.append(
        el(doc, "h2", "", active ? "Run active" : "No run yet"),
        el(
          doc,
          "p",
          "",
          active
            ? "Live progress comes in a later update."
            : "This issue has no recorded Issue run.",
        ),
      );
      thread.append(empty);
    }
  } else if (!detail.thread.length) {
    const empty = el(doc, "div", "empty");
    empty.append(
      icon(doc, "sym-wheel"),
      el(doc, "h2", "", "No run yet"),
      el(
        doc,
        "p",
        "",
        "Start planning to brainstorm this issue with an agent.",
      ),
      button(doc, "start", "Start planning", "btn btn-primary"),
    );
    thread.append(empty);
  }
  /** @type {Presentation} */
  const composer =
    source === "live" && p.composer !== "terminal" && p.composer !== "finished"
      ? {
          ...p,
          composer: "disabled",
          stopReply: false,
          composerHint: "View only. Messages come with live chat.",
        }
      : p;
  fragment.append(
    renderHeader(doc, detail, name, p),
    thread,
    renderComposer(doc, detail.summary, name, draft, composer, source),
  );
  return fragment;
}
