import { createApi } from "./api.js";
import { createPageController } from "./controller.js";
import { parseRoute, createDraftStore } from "./state.js";
import { renderPage } from "./page.js";
import { createViewState } from "./view-state.js";
import { readName, saveName, preferredTheme } from "./preferences.js";
import { mountArtifactViewer } from "./artifacts.js";
import { mountSyncStatus } from "./sync-status.js";
import { liveElapsedSeconds } from "./live-issue.js";
import { elapsed } from "./dom.js";
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
const syncStatus = mountSyncStatus(
  /** @type {HTMLElement} */ (document.getElementById("sync-status")),
  {
    now: () => Date.now(),
    every: (ms, fn) => {
      const id = window.setInterval(fn, ms);
      return () => window.clearInterval(id);
    },
  },
);
const announcement = document.createElement("p");
announcement.className = "visually-hidden";
announcement.setAttribute("role", "status");
mount.after(announcement);
let linkedArtifact = "";
let name = readName(storage) ?? "You";
const drafts = createDraftStore();
const viewState = createViewState(mount, drafts);
const { captureDraft } = viewState;
/** @type {import('./controller.js').PageState|undefined} */ let current;
/** @param {string} [text] */
function showNote(text = "This comes with live chat. Nothing changed.") {
  notice.hidden = false;
  notice.textContent = text;
}
/** @param {import('./controller.js').PageState} state */
function openLinkedArtifact(state) {
  if (
    state.status !== "ready" ||
    !state.issue ||
    state.route.view !== "issue" ||
    !state.route.artifactId
  )
    return;
  const artifactId = state.route.artifactId;
  const key = `${state.route.number}:${artifactId}`;
  const artifact = state.issue.issue.artifacts.find((a) => a.id === artifactId);
  const origin = [...mount.querySelectorAll("button")].find(
    (b) => b.dataset.artifactId === artifact?.id,
  );
  if (artifact && origin && linkedArtifact !== key) {
    linkedArtifact = key;
    viewer.open(artifact, origin);
  }
}
function render() {
  if (!current) return;
  const saved = viewState.capture();
  const sameIssue =
    saved.issue !== null &&
    current.issue?.issue.summary.number === Number(saved.issue);
  const scrollY = window.scrollY;
  const follow =
    window.innerHeight + scrollY >= document.documentElement.scrollHeight - 120;
  mount.classList.toggle(
    "live-issue",
    current.status === "ready" && current.issue?.source === "live",
  );
  mount.replaceChildren(renderPage(document, current, name, drafts));
  const meta = current.board ?? current.issue;
  if (meta) syncStatus.update(meta);
  const repository = meta?.repository;
  document
    .getElementById("repository-name")
    ?.replaceChildren(document.createTextNode(repository?.name ?? ""));
  (mount.querySelector(".composer") ?? mount).prepend(notice);
  viewState.restore(saved, { keepScroll: sameIssue });
  if (sameIssue)
    window.scrollTo({
      top: follow ? document.documentElement.scrollHeight : scrollY,
      behavior: "instant",
    });
  openLinkedArtifact(current);
}
const api = createApi();
/**
 * Send one Web session input as the saved name. Without a saved name, the
 * name dialog opens first.
 * @param {import('./api.js').SessionAction} action @param {Record<string,string>} [body]
 * @returns {Promise<boolean>}
 */
async function sessionInput(action, body = {}) {
  const issue = current?.issue;
  if (!issue?.sessions) {
    showNote();
    return false;
  }
  if (!readName(storage)) {
    openName();
    return false;
  }
  notice.hidden = true;
  const result = await api.session(issue.issue.summary.number, action, {
    ...body,
    author: name,
  });
  if (!result.ok) showNote(result.message);
  return result.ok;
}
const controller = createPageController({
  api,
  events: (url) => new EventSource(url),
  onState: (state) => {
    const previousBoard = current?.board;
    const wasActive = current?.issue?.issue.run?.outcome === "active";
    current = state;
    if (
      wasActive &&
      state.issue?.issue.run &&
      state.issue.issue.run.outcome !== "active"
    ) {
      announcement.textContent =
        state.issue.issue.run.outcome === "completed"
          ? "Run finished"
          : "Run stopped";
    }
    if (
      previousBoard &&
      state.board &&
      JSON.stringify({ ...previousBoard, syncedAt: null }) ===
        JSON.stringify({ ...state.board, syncedAt: null })
    ) {
      syncStatus.update(state.board);
      return;
    }
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
const elapsedTimer = window.setInterval(() => {
  const detail = current?.issue?.issue;
  const node = mount.querySelector("[data-live-elapsed]");
  if (detail && node) {
    const seconds = liveElapsedSeconds(detail, Date.now());
    if (seconds !== null) node.textContent = "elapsed " + elapsed(seconds);
  }
}, 1000);
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
window.addEventListener("pagehide", () => {
  controller.dispose();
  window.clearInterval(elapsedTimer);
  syncStatus.dispose();
});
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
  else if (action === "start" || action === "resume" || action === "retry")
    void sessionInput("start");
  else if (action === "pause" || action === "stop-reply")
    void sessionInput(action);
  else if (action === "answer") {
    const choice = target.closest("[data-action]");
    if (choice instanceof HTMLElement)
      void sessionInput("answers", {
        questionId: choice.dataset.question ?? "",
        choice: choice.dataset.choice ?? "",
      });
  }
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
      const number = current?.issue?.issue.summary.number;
      const text = input.value;
      void sessionInput("messages", { text }).then((ok) => {
        if (!ok || number === undefined) return;
        // Clear the draft only when it still holds the sent text.
        if (drafts.get(number) === text) drafts.set(number, "");
        if (input.isConnected && input.value === text) {
          input.value = "";
          input.rows = 1;
        }
      });
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
