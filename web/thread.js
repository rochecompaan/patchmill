import {
  el,
  icon,
  person,
  personClass,
  agent,
  renderBlocks,
  elapsed,
} from "./dom.js";
/** @param {Document} doc @param {import('../src/web/api-types.ts').IssueDetail} issue */
export function renderThread(doc, issue) {
  const section = el(doc, "section", "thread");
  section.setAttribute("aria-label", "Issue thread");
  let stepLabel = "";
  for (const event of issue.thread) {
    if (event.kind === "divider") {
      const node = el(doc, "div", "ev-divider tone-" + event.tone);
      const text = el(doc, "span", "div-text");
      text.append(
        el(
          doc,
          "span",
          "glyph " +
            (event.tone === "advance"
              ? "g-plus"
              : event.tone === "blocked"
                ? "g-minus"
                : "g-eq"),
          event.tone === "advance" ? "+" : event.tone === "blocked" ? "−" : "=",
        ),
        el(doc, "span", "", event.text),
      );
      if (event.at) text.append(el(doc, "time", "", event.at.slice(11, 16)));
      node.append(text);
      section.append(node);
      continue;
    }
    const row = el(doc, "div", "ev"),
      gutter = el(doc, "div", "gutter"),
      body = el(doc, "div");
    row.dataset.eventId = event.id;
    row.append(gutter, body);
    switch (event.kind) {
      case "message": {
        row.classList.add("ev-msg", event.role);
        if (event.role === "person")
          row.classList.add(personClass(event.author));
        gutter.append(
          event.role === "agent" ? agent(doc) : person(doc, event.author),
        );
        const head = el(doc, "header", "msg-head");
        head.append(
          el(
            doc,
            "span",
            "msg-name",
            event.role === "agent" ? "agent" : event.author,
          ),
        );
        if (event.role === "agent" && stepLabel)
          head.append(
            el(
              doc,
              "span",
              "msg-tag",
              stepLabel +
                (stepLabel === "brainstorm" ? " · read-only tools" : ""),
            ),
          );
        if (event.at) head.append(el(doc, "time", "", event.at.slice(11, 16)));
        const prose = el(doc, "div", "prose");
        prose.append(renderBlocks(doc, event.blocks));
        body.append(head, prose);
        if (event.note) body.append(el(doc, "div", "msg-note", event.note));
        break;
      }
      case "tool": {
        row.classList.add("ev-machine");
        const details = el(
          doc,
          "details",
          "tool" + (event.state === "running" ? " is-running" : ""),
        );
        details.dataset.key = event.id;
        const summary = el(doc, "summary");
        summary.append(
          icon(doc, event.name === "subagent" ? "sym-head" : "icon-wrench"),
          el(doc, "span", "tool-name", event.name),
          el(
            doc,
            "span",
            "tool-args",
            "(" +
              Object.entries(event.arguments)
                .map(
                  ([k, v]) =>
                    k +
                    "=" +
                    String(typeof v === "string" ? v : JSON.stringify(v)),
                )
                .join(", ") +
              ")",
          ),
        );
        if (event.state === "running")
          summary.append(el(doc, "span", "tool-state", "running"));
        const detail = el(doc, "div", "tool-detail");
        detail.append(
          el(doc, "div", "td-label", "arguments"),
          el(doc, "pre", "", JSON.stringify(event.arguments, null, 2)),
        );
        if (event.result)
          detail.append(
            el(doc, "div", "td-label", "result"),
            el(doc, "pre", "", event.result),
          );
        details.append(summary, detail);
        body.append(details);
        break;
      }
      case "step": {
        stepLabel = event.label;
        row.classList.add("ev-machine", "ev-step");
        gutter.append(el(doc, "i", "node"));
        const line = el(doc, "div", "step-line");
        line.append(
          el(doc, "span", "step-num", String(event.number).padStart(2, "0")),
          doc.createTextNode(event.label),
        );
        body.append(line);
        break;
      }
      case "usage":
        row.classList.add("ev-machine");
        body.append(
          el(
            doc,
            "div",
            "tokens",
            `tokens: task ${(event.taskTokens / 1000).toFixed(1)}k total ${(event.totalTokens / 1000).toFixed(1)}k   time elapsed: ${elapsed(event.elapsedSeconds)}`,
          ),
        );
        break;
      case "error": {
        row.classList.add("ev-error");
        const box = el(doc, "div", "error-box");
        box.append(
          el(doc, "div", "error-title", "− " + event.title),
          el(doc, "pre", "", event.text),
        );
        body.append(box);
        break;
      }
      case "artifact": {
        const artifact = issue.artifacts.find((a) => a.id === event.artifactId);
        if (!artifact) continue;
        row.classList.add("ev-art");
        const card = el(doc, "div", "art-card"),
          text = el(doc, "span", "art-card-text");
        text.append(
          el(doc, "b", "", event.text),
          el(doc, "code", "", artifact.path),
        );
        const open = el(doc, "button", "btn btn-sm", "Open");
        open.type = "button";
        open.dataset.artifactId = artifact.id;
        open.setAttribute("aria-haspopup", "dialog");
        card.append(
          icon(doc, "icon-" + artifact.kind, "art-card-icon"),
          text,
          open,
        );
        body.append(card);
        break;
      }
      case "earlier": {
        const button = el(
          doc,
          "button",
          "earlier",
          "▸ " + event.text + ". Show earlier steps",
        );
        button.type = "button";
        button.dataset.action = "earlier";
        body.append(button);
        break;
      }
      case "progress":
        row.classList.add("ev-machine");
        body.append(el(doc, "div", "info-line", event.text));
        break;
    }
    section.append(row);
  }
  if (issue.summary.status === "working") {
    const row = el(doc, "div", "ev ev-live");
    row.append(
      agent(doc, true),
      el(doc, "div", "live-text", "The agent is working…"),
    );
    section.append(row);
  }
  return section;
}
