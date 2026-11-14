import { el, icon, externalLink } from "./dom.js";
/** @typedef {import('../src/web/api-types.ts').BoardResponse} BoardResponse */
const columns = [
  ["triage", "Triage", "No workflow label, or needs-info"],
  ["ready", "Ready", "agent-ready"],
  ["planning", "Planning", "Brainstorm, spec or plan in progress"],
  ["review", "Planning review", "Spec or plan pull request open"],
  ["implementing", "Implementing", "Implementation step running"],
  ["code", "Code review", "Implementation pull request open"],
  ["blocked", "Blocked", "A run stopped by an error"],
];
/** @param {Document} doc @param {import('../src/web/api-types.ts').IssueSummary} issue */
function card(doc, issue) {
  const node = el(
    doc,
    "article",
    "card" +
      (issue.status === "working"
        ? " is-live"
        : issue.status === "waiting"
          ? " is-waiting"
          : issue.status === "blocked"
            ? " is-blocked"
            : ""),
  );
  const main = el(doc, "a", "card-main");
  main.href = "#/issue/" + issue.number;
  main.append(
    el(doc, "div", "card-num", "#" + issue.number),
    el(doc, "div", "card-title", issue.title),
  );
  node.append(main);
  if (
    issue.step &&
    ["working", "waiting", "idle", "paused"].includes(issue.status)
  )
    node.append(el(doc, "div", "card-step", issue.step));
  if (issue.blockedReason)
    node.append(el(doc, "div", "card-error", "− " + issue.blockedReason));
  const markers = el(doc, "div", "card-row");
  if (issue.status === "working" || issue.status === "waiting") {
    const marker = el(
      doc,
      "span",
      "mk " + (issue.status === "working" ? "mk-live" : "mk-wait"),
    );
    marker.append(
      el(doc, "i"),
      doc.createTextNode(
        issue.status === "working" ? "Live" : "Waiting for reply",
      ),
    );
    markers.append(marker);
  }
  if (issue.status === "paused")
    markers.append(el(doc, "span", "mk mk-paused", "Paused"));
  if (issue.terminal) markers.append(el(doc, "span", "mk mk-term", "Terminal"));
  for (const pr of issue.pullRequests) {
    const label = el(doc, "span", "card-pr");
    label.append(icon(doc, "icon-pr"), doc.createTextNode(pr.label));
    markers.append(label);
  }
  if (markers.childElementCount) node.append(markers);
  const labels = el(doc, "div", "card-row");
  for (const label of issue.labels)
    labels.append(
      el(
        doc,
        "span",
        "label " +
          {
            ready: "l-ready",
            info: "l-info",
            blocked: "l-blocked",
            neutral: "",
          }[label.tone],
        label.name,
      ),
    );
  if (labels.childElementCount) node.append(labels);
  const links = el(doc, "div", "card-row card-links");
  for (const a of issue.artifacts.filter(
    (a) => a.kind === "spec" || a.kind === "plan",
  )) {
    const link = el(doc, "a", "", a.kind === "spec" ? "Spec" : "Plan");
    link.href = `#/issue/${issue.number}?artifact=${encodeURIComponent(a.id)}`;
    links.append(link);
  }
  for (const pr of issue.pullRequests)
    links.append(externalLink(doc, pr.label, pr.url));
  if (links.childElementCount) node.append(links);
  return node;
}
/** @param {Document} doc @param {BoardResponse} data */
export function renderBoard(doc, data) {
  const section = el(doc, "section");
  section.setAttribute("aria-label", "Issues");
  section.append(icon(doc, "sym-wheel", "board-watermark"));
  const board = el(doc, "div", "board");
  for (const [id, name, description] of columns) {
    const issues = data.issues.filter((i) => i.column === id);
    const col = el(doc, "section", "col");
    col.setAttribute("aria-label", name ?? "");
    const head = el(doc, "header", "col-head"),
      title = el(doc, "div", "col-title");
    title.append(
      el(doc, "span", "", name),
      el(doc, "span", "col-count", issues.length),
    );
    head.append(title, el(doc, "div", "col-desc", description));
    const cards = el(doc, "div", "cards");
    for (const issue of issues) cards.append(card(doc, issue));
    if (!issues.length)
      cards.append(el(doc, "div", "col-empty", "Nothing here"));
    col.append(head, cards);
    board.append(col);
  }
  section.append(board);
  return section;
}
