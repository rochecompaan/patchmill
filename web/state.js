/** @typedef {import('../src/web/api-types.ts').IssueSummary} IssueSummary */
/** @typedef {{view:'board'}|{view:'issue',number:number,artifactId:string|null}|{view:'not-found'}} Route */
/** @typedef {{header:'start'|'pause'|'resume'|'retry'|'terminal'|null,composer:'enabled'|'disabled'|'terminal'|'finished',stopReply:boolean}} Presentation */
/** @param {string} hash @returns {Route} */
export function parseRoute(hash) {
  if (!hash || hash === "#/board" || hash === "#") return { view: "board" };
  const [path, query = ""] = hash.split("?");
  const match = /^#\/issue\/([1-9]\d*)$/.exec(path ?? "");
  if (!match || !Number.isSafeInteger(Number(match[1])))
    return { view: "not-found" };
  return {
    view: "issue",
    number: Number(match[1]),
    artifactId: new URLSearchParams(query).get("artifact"),
  };
}
/** @param {IssueSummary} issue @returns {Presentation} */
export function presentationFor(issue) {
  if (issue.terminal)
    return { header: "terminal", composer: "terminal", stopReply: false };
  if (
    issue.status === "done" ||
    issue.pullRequests.some(
      (p) => p.kind === "implementation" && p.state === "open",
    )
  )
    return { header: null, composer: "finished", stopReply: false };
  const header =
    issue.status === "none"
      ? "start"
      : issue.status === "paused"
        ? "resume"
        : issue.status === "blocked"
          ? "retry"
          : "pause";
  return {
    header,
    composer: ["none", "paused", "blocked"].includes(issue.status)
      ? "disabled"
      : "enabled",
    stopReply: issue.status === "working",
  };
}
/** @returns {{get:(number:number)=>string,set:(number:number,text:string)=>void}} */
export function createDraftStore() {
  /** @type {Map<number,string>} */ const drafts = new Map();
  return {
    /** @param {number} number */ get: (number) => drafts.get(number) ?? "",
    /** @param {number} number @param {string} text */ set: (number, text) => {
      drafts.set(number, text);
    },
  };
}
