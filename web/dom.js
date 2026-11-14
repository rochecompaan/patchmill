import { safeExternalUrl } from "./links.js";
/** @typedef {import('../src/web/api-types.ts').TextBlock} TextBlock */
/** @template {keyof HTMLElementTagNameMap} K @param {Document} doc @param {K} tag @param {string} [className] @param {string|number} [text] @returns {HTMLElementTagNameMap[K]} */
export function el(doc, tag, className = "", text = "") {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = String(text);
  return node;
}
/** @param {Document} doc @param {string} name @param {string} [className] */
export function icon(doc, name, className = "icon") {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = doc.createElementNS(svg.namespaceURI, "use");
  use.setAttribute("href", "#" + name);
  svg.append(use);
  return svg;
}
/** @param {Document} doc @param {string} text @param {string} url @param {string} [className] */
export function externalLink(doc, text, url, className = "") {
  const safe = safeExternalUrl(url);
  if (!safe) return el(doc, "span", className, text);
  const a = el(doc, "a", className, text);
  a.href = safe;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}
/** @param {string} name */
export function personClass(name) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return "who-" + (1 + (hash % 5));
}
/** @param {Document} doc @param {string} name @param {boolean} [small] */
export function person(doc, name, small = false) {
  const a = el(
    doc,
    "span",
    `av av-person ${personClass(name)}${small ? " sm" : ""}`,
    name.slice(0, 2),
  );
  a.title = name;
  return a;
}
/** @param {Document} doc @param {boolean} [live] */
export function agent(doc, live = false) {
  const node = el(doc, "span", "av av-agent" + (live ? " is-live" : ""));
  node.setAttribute("aria-hidden", "true");
  node.append(icon(doc, "sym-ring", "ring"), icon(doc, "sym-head", "head"));
  return node;
}
/** @param {Document} doc @param {readonly import('../src/web/api-types.ts').Inline[]} content */
function inline(doc, content) {
  const fragment = doc.createDocumentFragment();
  for (const item of content) {
    if (item.kind === "text") fragment.append(doc.createTextNode(item.text));
    else if (item.kind === "link")
      fragment.append(externalLink(doc, item.text, item.href));
    else
      fragment.append(
        el(
          doc,
          item.kind === "code"
            ? "code"
            : item.kind === "strong"
              ? "strong"
              : "em",
          "",
          item.text,
        ),
      );
  }
  return fragment;
}
/** @param {Document} doc @param {readonly TextBlock[]} blocks */
export function renderBlocks(doc, blocks) {
  const fragment = doc.createDocumentFragment();
  for (const block of blocks) {
    if (block.kind === "paragraph" || block.kind === "heading") {
      const node = el(doc, block.kind === "heading" ? "h2" : "p");
      node.append(inline(doc, block.content));
      fragment.append(node);
    } else if (block.kind === "list") {
      const list = el(doc, block.ordered ? "ol" : "ul");
      for (const item of block.items) {
        const li = el(doc, "li");
        li.append(inline(doc, item));
        list.append(li);
      }
      fragment.append(list);
    } else if (block.kind === "code")
      fragment.append(el(doc, "pre", "", block.text));
    else if (block.kind === "table") {
      const table = el(doc, "table"),
        head = el(doc, "thead"),
        tr = el(doc, "tr");
      for (const text of block.headers) tr.append(el(doc, "th", "", text));
      head.append(tr);
      table.append(head);
      const body = el(doc, "tbody");
      for (const row of block.rows) {
        const tr = el(doc, "tr");
        for (const cell of row) tr.append(el(doc, "td", "", cell));
        body.append(tr);
      }
      table.append(body);
      fragment.append(table);
    }
  }
  return fragment;
}
/** @param {number|null} seconds */
export function elapsed(seconds) {
  if (seconds === null) return "";
  const h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = Math.floor(seconds % 60);
  return h
    ? `${h}h ${m.toString().padStart(2, "0")}m`
    : `${m}m ${s.toString().padStart(2, "0")}s`;
}
