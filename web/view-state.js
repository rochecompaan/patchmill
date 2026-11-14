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
    return { issue, selection };
  }
  /** @param {ReturnType<typeof capture>} saved */
  function restore(saved) {
    const issue = issueNumber();
    for (const details of mount.querySelectorAll("details"))
      if (issue && openTools.get(issue)?.has(details.dataset.key ?? ""))
        details.open = true;
    mount
      .querySelector("[aria-current=step]")
      ?.scrollIntoView({ block: "nearest", inline: "center" });
    const input = mount.querySelector("textarea");
    if (saved.issue === issue && saved.selection && input && !input.disabled) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(saved.selection.start, saved.selection.end);
    }
  }
  return { capture, restore, captureDraft };
}
