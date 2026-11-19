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
          id: control.id,
        }
      : null;
    return {
      issue,
      selection,
      focus,
      railScroll: mount.querySelector(".rail")?.scrollLeft ?? 0,
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
                  ? node.getAttribute("data-action") === f.action
                  : !!f.id && node.id === f.id),
        );
        // A session control can be replaced (Start → Pause) or removed (an
        // answered question). Keep focus on a stable control nearby.
        const fallback =
          !control && f.action && SESSION_ACTIONS.has(f.action)
            ? (mount.querySelector(".ihead .control button") ??
              mount.querySelector("#composer-input:not(:disabled)"))
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
