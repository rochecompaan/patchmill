import { createApi } from "./api.js";
import { createPageController } from "./controller.js";
import { parseRoute, createDraftStore } from "./state.js";
import { renderBoard } from "./board.js";
import { renderIssue } from "./issue.js";
import { readName, saveName, preferredTheme } from "./preferences.js";
import { el } from "./dom.js";
import { mountArtifactViewer } from "./artifacts.js";
const mount = /** @type {HTMLElement} */ (document.getElementById("app"));
const notice = /** @type {HTMLElement} */ (document.getElementById("notice"));
const nameDialog = /** @type {HTMLDialogElement} */ (
  document.getElementById("name-dialog")
);
const nameInput = /** @type {HTMLInputElement} */ (
  document.getElementById("name-input")
);
const nameError = /** @type {HTMLElement} */ (
  document.getElementById("name-error")
);
const themeSwitch = /** @type {HTMLButtonElement} */ (
  document.getElementById("theme-switch")
);
/** @type {import('./preferences.js').PreferenceStorage} */ let storage = null;
try {
  storage = localStorage;
} catch {
  /* Storage can be disabled. */
}
const viewer = mountArtifactViewer(
  /** @type {HTMLDialogElement} */ (document.getElementById("viewer")),
);
let linkedArtifact = "";
let name = readName(storage) ?? "You",
  renderKey = "";
const drafts = createDraftStore();
/** @type {import('./controller.js').PageState|undefined} */ let current;
/** @type {Map<string,Set<string>>} */ const openTools = new Map();
/** @param {string} [text] */
function showNote(text = "This comes with live chat. Nothing changed.") {
  notice.hidden = false;
  notice.textContent = text;
}
function captureDraft() {
  const input = document.querySelector("textarea");
  if (input?.dataset.issue)
    drafts.set(Number(input.dataset.issue), input.value);
}
function render() {
  if (!current) return;
  const state = current;
  const key =
    state.status === "ready"
      ? `${state.route.view}:${state.issue?.issue.summary.number ?? ""}:${state.board?.revision ?? state.issue?.revision}:${name}`
      : state.status + ":" + JSON.stringify(state.route);
  if (key === renderKey) return;
  const oldIssue = mount.querySelector(".ihead")?.getAttribute("data-issue");
  if (oldIssue)
    openTools.set(
      oldIssue,
      new Set(
        [...mount.querySelectorAll("details[open]")].map(
          (n) => n.getAttribute("data-key") ?? "",
        ),
      ),
    );
  const focused =
    document.activeElement instanceof HTMLTextAreaElement
      ? document.activeElement
      : null;
  const selection = focused
    ? { start: focused.selectionStart, end: focused.selectionEnd }
    : null;
  captureDraft();
  renderKey = key;
  if (state.status === "ready" && state.board)
    mount.replaceChildren(renderBoard(document, state.board));
  else if (state.status === "ready" && state.issue) {
    mount.replaceChildren(
      renderIssue(
        document,
        state.issue.issue,
        name,
        drafts.get(state.issue.issue.summary.number),
      ),
    );
    const currentStep = mount.querySelector("[aria-current=step]");
    currentStep?.scrollIntoView({ block: "nearest", inline: "center" });
  } else {
    const view = el(document, "section", "empty"),
      heading = el(
        document,
        "h1",
        "",
        state.status === "loading"
          ? "Loading sample data…"
          : state.status === "not-found"
            ? "Issue not found"
            : state.status === "unauthorized"
              ? "Open the printed link"
              : "Could not load data",
      );
    view.append(heading);
    if (state.message) view.append(el(document, "p", "", state.message));
    const back = el(document, "a", "back", "← Board");
    back.href = "#/board";
    view.append(back);
    if (state.status === "error") {
      const retry = el(document, "button", "btn", "Retry");
      retry.type = "button";
      retry.dataset.action = "reload";
      view.append(retry);
    }
    mount.replaceChildren(view);
  }
  (mount.querySelector(".composer") ?? mount).prepend(notice);
  const issueNumber = current.issue?.issue.summary.number;
  if (issueNumber)
    for (const details of mount.querySelectorAll("details"))
      if (openTools.get(String(issueNumber))?.has(details.dataset.key ?? ""))
        details.open = true;
  if (
    state.status === "ready" &&
    state.issue &&
    state.route.view === "issue" &&
    state.route.artifactId
  ) {
    const artifactId = state.route.artifactId;
    const key = `${state.route.number}:${artifactId}`;
    const artifact = state.issue.issue.artifacts.find(
      (a) => a.id === artifactId,
    );
    const origin = [...mount.querySelectorAll("button")].find(
      (b) => b.dataset.artifactId === artifact?.id,
    );
    if (artifact && origin && linkedArtifact !== key) {
      linkedArtifact = key;
      viewer.open(artifact, origin);
    }
  }
  if (focused && selection) {
    const input = mount.querySelector("textarea");
    if (input && !input.disabled) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(selection.start, selection.end);
    }
  }
}
const controller = createPageController({
  api: createApi(),
  onState: (state) => {
    current = state;
    render();
  },
  visible: () => !document.hidden,
  clock: {
    after: (ms, fn) => {
      const id = window.setTimeout(fn, ms);
      return () => window.clearTimeout(id);
    },
  },
});
function route() {
  viewer.close();
  linkedArtifact = "";
  captureDraft();
  notice.hidden = true;
  void controller.navigate(parseRoute(location.hash));
}
window.addEventListener("hashchange", route);
document.addEventListener("visibilitychange", () =>
  controller.visibilityChanged(),
);
window.addEventListener("pagehide", () => controller.dispose());
function updateName() {
  document
    .getElementById("me-name")
    ?.replaceChildren(document.createTextNode(name));
  document
    .getElementById("me-initials")
    ?.replaceChildren(document.createTextNode(name.slice(0, 2)));
}
function clearNameError() {
  nameError.hidden = true;
  nameError.textContent = "";
  nameInput.removeAttribute("aria-invalid");
}
nameInput.addEventListener("input", clearNameError);
function openName() {
  clearNameError();
  nameDialog.returnValue = "";
  nameInput.value = name === "You" ? "" : name;
  nameDialog.showModal();
  nameInput.focus();
}
document.getElementById("name-form")?.addEventListener("submit", (event) => {
  try {
    name = saveName(storage, nameInput.value);
  } catch (error) {
    event.preventDefault();
    nameError.textContent =
      error instanceof Error ? error.message : "Enter a valid name.";
    nameError.hidden = false;
    nameInput.setAttribute("aria-invalid", "true");
    nameInput.focus();
    return;
  }
  clearNameError();
  updateName();
  render();
});
const osTheme = matchMedia("(prefers-color-scheme: light)");
let chosen = false;
function syncTheme() {
  const light = document.documentElement.dataset.theme === "light";
  themeSwitch.setAttribute("aria-checked", String(light));
  themeSwitch.title = light ? "Switch to dark theme" : "Switch to light theme";
}
/** @param {'light'|'dark'} theme @param {boolean} [animate] */
function applyTheme(theme, animate = false) {
  const swap = () => {
    document.documentElement.dataset.theme = theme;
    syncTheme();
  };
  if (
    animate &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches &&
    document.startViewTransition
  ) {
    document.startViewTransition(swap);
  } else swap();
}
osTheme.addEventListener("change", () => {
  if (!chosen) applyTheme(preferredTheme(storage, osTheme.matches));
});
syncTheme();
document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const artifactTrigger = target.closest("button[data-artifact-id]");
  if (artifactTrigger instanceof HTMLButtonElement) {
    const artifact = current?.issue?.issue.artifacts.find(
      (a) => a.id === artifactTrigger.dataset.artifactId,
    );
    if (artifact) viewer.open(artifact, artifactTrigger);
    return;
  }
  const action = target.closest("[data-action]")?.getAttribute("data-action");
  if (action === "skip") {
    event.preventDefault();
    mount.focus({ preventScroll: true });
    mount.scrollIntoView({ block: "start" });
  } else if (action === "name") openName();
  else if (action === "cancel-name") nameDialog.close("cancel");
  else if (action === "theme") {
    chosen = true;
    const next =
      document.documentElement.dataset.theme === "light" ? "dark" : "light";
    try {
      storage?.setItem("patchmill-theme", next);
    } catch {
      /* Keep the choice for this page. */
    }
    applyTheme(next, true);
  } else if (action === "reload") void controller.retry();
  else if (action === "earlier")
    showNote("These are sample steps. No earlier history is loaded.");
  else if (
    action &&
    ["start", "pause", "resume", "retry", "stop-reply"].includes(action)
  )
    showNote();
});
document.addEventListener("submit", (event) => {
  if (
    event.target instanceof HTMLFormElement &&
    event.target.id === "composer"
  ) {
    event.preventDefault();
    const input = event.target.querySelector("textarea");
    if (input?.value.trim()) {
      captureDraft();
      showNote();
    }
  }
});
document.addEventListener("input", (event) => {
  if (event.target instanceof HTMLTextAreaElement) {
    captureDraft();
    event.target.rows = Math.min(
      7,
      Math.max(1, event.target.value.split("\n").length),
    );
  }
});
document.addEventListener("keydown", (event) => {
  if (
    event.target instanceof HTMLTextAreaElement &&
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing
  ) {
    event.preventDefault();
    event.target.form?.requestSubmit();
  }
});
document
  .getElementById("server-authority")
  ?.replaceChildren(document.createTextNode(location.host));
updateName();
route();
if (!readName(storage)) openName();
