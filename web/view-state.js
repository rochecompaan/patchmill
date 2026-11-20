const SESSION_ACTIONS = new Set([
  "start",
  "resume",
  "retry",
  "pause",
  "stop-reply",
  "answer",
]);
/** @param {HTMLElement} mount @param {ReturnType<import('./state.js').createDraftStore>} drafts */
export function createViewState(mount, drafts) {
  /** @type {Map<string,Set<string>>} */ const openTools = new Map();
  function captureDraft() {
    const input = mount.querySelector("textarea");
    if (input?.dataset.issue)
      drafts.set(Number(input.dataset.issue), input.value);
  }
  function issueNumber() {
    return mount.querySelector(".ihead")?.getAttribute("data-issue") ?? null;
  }
  /** Scrollable boxes, keyed by their thread entry and position in it. */
  function scrollBoxes() {
    /** @type {[string, Element][]} */ const boxes = [];
    for (const entry of mount.querySelectorAll("[data-key]"))
      entry
        .querySelectorAll("pre")
        .forEach((node, index) =>
          boxes.push([`${entry.getAttribute("data-key")}:${index}`, node]),
        );
    const input = mount.querySelector("textarea");
    if (input) boxes.push(["composer", input]);
    return boxes;
  }
  function boxScrolls() {
    /** @type {Map<string,{top:number,left:number}>} */ const at = new Map();
    for (const [key, node] of scrollBoxes())
      if (node.scrollTop || node.scrollLeft)
        at.set(key, { top: node.scrollTop, left: node.scrollLeft });
    return at;
  }
  function capture() {
    captureDraft();
    const issue = issueNumber();
    if (issue)
      openTools.set(
        issue,
        new Set(
          [...mount.querySelectorAll("details[open]")].map(
            (node) => node.getAttribute("data-key") ?? "",
          ),
        ),
      );
    const input = mount.querySelector("textarea");
    const selection =
      input && mount.ownerDocument.activeElement === input
        ? { start: input.selectionStart, end: input.selectionEnd }
        : null;
    const focused = mount.ownerDocument.activeElement;
    const control = focused && mount.contains(focused) ? focused : null;
    const focus = control
      ? {
          key: control.closest("[data-key]")?.getAttribute("data-key") ?? null,
          tag: control.tagName,
          href: control.getAttribute("href"),
          action: control.getAttribute("data-action"),
          // Answer buttons share one action; the choice tells them apart.
          choice: control.getAttribute("data-choice"),
          id: control.id,
        }
      : null;
    return {
      issue,
      selection,
      focus,
      railScroll: mount.querySelector(".rail")?.scrollLeft ?? 0,
      boxes: boxScrolls(),
    };
  }
  /** @param {ReturnType<typeof capture>} saved @param {{keepScroll?:boolean}} [options] */
  function restore(saved, options = {}) {
    const issue = issueNumber();
    for (const details of mount.querySelectorAll("details"))
      if (issue && openTools.get(issue)?.has(details.dataset.key ?? ""))
        details.open = true;
    if (!options.keepScroll)
      mount
        .querySelector("[aria-current=step]")
        ?.scrollIntoView({ block: "nearest", inline: "center" });
    if (options.keepScroll) {
      const rail = mount.querySelector(".rail");
      if (rail) rail.scrollLeft = saved.railScroll;
      // A render makes new boxes that start at the top. Put each scrolled
      // tool result, prompt and the composer back where the reader left it.
      for (const [key, node] of scrollBoxes()) {
        const at = saved.boxes.get(key);
        if (at) {
          node.scrollTop = at.top;
          node.scrollLeft = at.left;
        }
      }
      if (saved.focus) {
        const f = saved.focus;
        const control = [
          ...mount.querySelectorAll("summary,a,button,input,select"),
        ].find(
          (node) =>
            node.tagName === f.tag &&
            (f.key
              ? node.closest("[data-key]")?.getAttribute("data-key") === f.key
              : f.href
                ? node.getAttribute("href") === f.href
                : f.action
                  ? node.getAttribute("data-action") === f.action &&
                    node.getAttribute("data-choice") === f.choice
                  : !!f.id && node.id === f.id),
        );
        // A session control can be replaced (Start → Pause) or removed (an
        // answered question). Keep focus on a stable control nearby.
        // After an answer or Stop reply the composer is next; after a
        // header control, its replacement is.
        const header = mount.querySelector(".ihead .control button");
        const composer = mount.querySelector("#composer-input:not(:disabled)");
        const fallback =
          !control && f.action && SESSION_ACTIONS.has(f.action)
            ? f.action === "answer" || f.action === "stop-reply"
              ? (composer ?? header)
              : (header ?? composer)
            : null;
        const target = control ?? fallback;
        if (target instanceof HTMLElement)
          target.focus({ preventScroll: true });
      }
    }
    const input = mount.querySelector("textarea");
    if (saved.issue === issue && saved.selection && input && !input.disabled) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(saved.selection.start, saved.selection.end);
    }
  }
  return { capture, restore, captureDraft };
}
