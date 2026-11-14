import { renderBoard } from "./board.js";
import { renderIssue } from "./issue.js";
import { el } from "./dom.js";
/** @typedef {import('./controller.js').PageState} PageState */
/** @typedef {ReturnType<import('./state.js').createDraftStore>} DraftStore */

/** @param {Document} doc @param {PageState} state */
function renderStatus(doc, state) {
  const labels = {
    loading: "Loading sample data…",
    "not-found": "Issue not found",
    unauthorized: "Open the printed link",
    error: "Could not load data",
    ready: "Could not load data",
  };
  const view = el(doc, "section", "empty");
  view.append(el(doc, "h1", "", labels[state.status]));
  if (state.message) view.append(el(doc, "p", "", state.message));
  const back = el(doc, "a", "back", "← Board");
  back.href = "#/board";
  view.append(back);
  if (state.status === "error") {
    const retry = el(doc, "button", "btn", "Retry");
    retry.type = "button";
    retry.dataset.action = "reload";
    view.append(retry);
  }
  return view;
}

/** @param {Document} doc @param {PageState} state @param {string} name @param {DraftStore} drafts */
export function renderPage(doc, state, name, drafts) {
  if (state.status === "ready" && state.board)
    return renderBoard(doc, state.board);
  if (state.status === "ready" && state.issue)
    return renderIssue(
      doc,
      state.issue.issue,
      name,
      drafts.get(state.issue.issue.summary.number),
    );
  return renderStatus(doc, state);
}
