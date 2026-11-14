import { el, icon, externalLink, person, elapsed } from "./dom.js";
import { renderThread } from "./thread.js";
import { presentationFor } from "./state.js";
const phases = [
  "brainstorm",
  "spec",
  "spec-review",
  "plan",
  "plan-review",
  "implement",
  "code-review",
];
const labels = [
  "Brainstorm",
  "Spec",
  "Spec review",
  "Plan",
  "Plan review",
  "Implement",
  "Code review",
];
/** @param {Document} doc @param {string} action @param {string} text @param {string} [className] */
function button(doc, action, text, className = "btn") {
  const b = el(doc, "button", className);
  b.type = "button";
  b.dataset.action = action;
  b.append(
    icon(
      doc,
      "icon-" +
        ({
          start: "play",
          resume: "play",
          pause: "pause",
          retry: "retry",
          "stop-reply": "stop",
        }[action] ?? "play"),
    ),
    doc.createTextNode(text),
  );
  return b;
}
/** @param {Document} doc @param {import('../src/web/api-types.ts').IssueDetail} detail @param {string} name @param {string} draft */
export function renderIssue(doc, detail, name, draft) {
  const issue = detail.summary,
    p = presentationFor(issue),
    fragment = doc.createDocumentFragment(),
    header = el(doc, "header", "ihead"),
    inner = el(doc, "div", "ihead-inner");
  header.dataset.issue = String(issue.number);
  const back = el(doc, "a", "back", "← Board");
  back.href = "#/board";
  inner.append(back);
  const top = el(doc, "div", "ihead-top"),
    title = el(doc, "h1", "ititle");
  title.append(
    issue.number === 901
      ? el(doc, "span", "inum", "#901")
      : externalLink(doc, "#" + issue.number, issue.url, "inum"),
    doc.createTextNode(issue.title),
  );
  const control = el(doc, "div", "control");
  if (p.header === "terminal")
    control.append(el(doc, "span", "note-pill", "Running in a terminal"));
  else if (p.header) {
    const text = {
      start: "Start planning",
      pause: "Pause",
      resume: "Resume",
      retry: "Retry",
    }[p.header];
    control.append(
      button(
        doc,
        p.header,
        text,
        "btn" +
          (p.header === "start"
            ? " btn-primary"
            : p.header === "resume"
              ? " btn-live"
              : p.header === "retry"
                ? " btn-danger"
                : ""),
      ),
    );
  }
  top.append(title, control);
  inner.append(top);
  const rail = el(doc, "ol", "rail");
  rail.setAttribute("aria-label", "Workflow");
  const phase = phases.indexOf(issue.phase ?? "");
  phases.forEach((_, index) => {
    const li = el(
      doc,
      "li",
      index < phase
        ? "done"
        : index === phase
          ? "current" + (issue.status === "blocked" ? " is-blocked" : "")
          : "",
      labels[index],
    );
    if (index === phase) li.setAttribute("aria-current", "step");
    if ([2, 4, 6].includes(index)) li.append(el(doc, "span", "pr-tag", "PR"));
    rail.append(li);
  });
  inner.append(rail);
  const meta = el(doc, "div", "meta"),
    statusText = {
      none: "Not started",
      working: "Agent working",
      waiting: "Waiting for reply",
      idle: "Agent idle",
      paused: "Paused",
      blocked: "Blocked",
      done: "Finished",
    }[issue.status],
    status = el(doc, "span", "meta-item");
  status.append(
    el(
      doc,
      "i",
      "dot" +
        (issue.status === "working"
          ? " dot-live"
          : issue.status === "waiting"
            ? " dot-wait"
            : issue.status === "blocked"
              ? " dot-blocked"
              : ""),
    ),
    el(doc, "b", "", statusText),
  );
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
  if (issue.status === "done" && detail.finalUsage) {
    const usage = detail.finalUsage,
      cost = usage.cost
        ? `${usage.cost.currency === "USD" ? "$" : usage.cost.currency + " "}${usage.cost.amount}`
        : "not recorded";
    meta.append(
      el(
        doc,
        "span",
        "meta-item mono",
        `cost ${cost} · ${usage.tokens === null ? "not recorded" : (usage.tokens / 1000).toFixed(0) + "k"} tokens`,
      ),
    );
  }
  const here = el(doc, "span", "meta-item", "here now "),
    presence = el(doc, "span", "presence");
  for (const who of new Set([name, ...detail.participants]))
    presence.append(person(doc, who, true));
  here.append(presence);
  meta.append(here);
  inner.append(meta);
  const artifacts = el(doc, "div", "artifacts");
  for (const [group, kinds] of [
    ["Planning", ["spec", "plan", "mockup", "diagram"]],
    ["Code review", ["shots"]],
  ]) {
    const entries = detail.artifacts.filter((a) => kinds?.includes(a.kind));
    if (!entries.length) continue;
    const row = el(doc, "div", "art-group");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", String(group) + " artifacts");
    row.append(el(doc, "span", "art-label", String(group)));
    for (const a of entries) {
      const chip = el(doc, "button", "art-chip" + (a.draft ? " is-draft" : ""));
      chip.type = "button";
      chip.dataset.artifactId = a.id;
      chip.setAttribute("aria-haspopup", "dialog");
      chip.append(
        icon(doc, "icon-" + a.kind),
        doc.createTextNode(
          {
            spec: "Spec",
            plan: "Plan",
            mockup: "Mockup",
            diagram: "Diagram",
            shots: "Screenshots",
          }[a.kind],
        ),
      );
      if (a.draft) chip.append(el(doc, "span", "art-draft", "draft"));
      row.append(chip);
    }
    artifacts.append(row);
  }
  inner.append(artifacts);
  header.append(inner);
  fragment.append(header);
  const thread = renderThread(doc, detail);
  if (!detail.thread.length) {
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
  fragment.append(thread);
  const footer = el(doc, "footer", "composer");
  if (p.composer === "terminal" || p.composer === "finished") {
    footer.append(
      el(
        doc,
        "div",
        "note-bar",
        p.composer === "terminal"
          ? `View only. This run was started in a terminal with patchmill run-once --issue ${issue.number}.`
          : "This run has finished. Review continues on the implementation pull request.",
      ),
    );
  } else {
    const disabled = p.composer === "disabled",
      form = el(doc, "form", "composer-box" + (disabled ? " is-disabled" : ""));
    form.id = "composer";
    const input = el(doc, "textarea");
    input.id = "composer-input";
    input.dataset.issue = String(issue.number);
    input.rows = 1;
    input.placeholder = "Message the agent as " + name;
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
    footer.append(form);
    const hint = el(doc, "p", "composer-hint");
    hint.append(
      el(
        doc,
        "i",
        "dot" +
          (issue.status === "working"
            ? " dot-live"
            : issue.status === "waiting"
              ? " dot-wait"
              : issue.status === "blocked"
                ? " dot-blocked"
                : ""),
      ),
      el(
        doc,
        "span",
        "",
        issue.status === "none"
          ? "Click Start planning to brainstorm this issue with an agent."
          : issue.status === "paused"
            ? "This run is paused. Click Resume to keep chatting."
            : issue.status === "blocked"
              ? "This run is blocked. Fix the cause, then click Retry."
              : issue.status === "waiting"
                ? "The agent is waiting for your reply."
                : issue.status === "working"
                  ? "The agent is working. Your message reaches it after its current tool call."
                  : "The agent is idle. Your message starts a new turn.",
      ),
      el(doc, "span", "kbd-hint", "Enter to send · Shift+Enter for a new line"),
    );
    footer.append(hint);
  }
  fragment.append(footer);
  return fragment;
}
