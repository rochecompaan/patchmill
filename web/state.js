/** @typedef {import('../src/web/api-types.ts').IssueSummary} IssueSummary */
/** @typedef {{view:'board'}|{view:'issue',number:number,artifactId:string|null}|{view:'not-found'}} Route */
/** @typedef {'start'|'pause'|'resume'|'retry'} RunAction */
/** @typedef {{className:string,label:string,dot:boolean}} Marker */
/** @typedef {{header:RunAction|'terminal'|null,composer:'enabled'|'disabled'|'terminal'|'finished',stopReply:boolean,dotClass:string,cardClass:string,marker:Marker|null,statusLabel:string,composerHint:string,showStep:boolean,control:{label:string,className:string}|null}} Presentation */
/** @typedef {{label:string,header:RunAction|null,hint:string,dotClass?:string,cardClass?:string,marker?:Marker,showStep?:boolean,disabled?:boolean}} StatusPresentation */

/** @type {readonly {id:import('../src/web/api-types.ts').PhaseId,label:string,pr:boolean}[]} */
export const PHASES = [
  { id: "brainstorm", label: "Brainstorm", pr: false },
  { id: "spec", label: "Spec", pr: false },
  { id: "spec-review", label: "Spec review", pr: true },
  { id: "plan", label: "Plan", pr: false },
  { id: "plan-review", label: "Plan review", pr: true },
  { id: "implement", label: "Implement", pr: false },
  { id: "code-review", label: "Code review", pr: true },
];

/** @type {Record<IssueSummary['status'],StatusPresentation>} */
const statuses = {
  none: {
    label: "Not started",
    header: "start",
    disabled: true,
    hint: "Click Start planning to brainstorm this issue with an agent.",
  },
  working: {
    label: "Agent working",
    header: "pause",
    showStep: true,
    dotClass: "dot dot-live",
    cardClass: "is-live",
    marker: { className: "mk mk-live", label: "Live", dot: true },
    hint: "The agent is working. Your message reaches it after its current tool call.",
  },
  waiting: {
    label: "Waiting for reply",
    header: "pause",
    showStep: true,
    dotClass: "dot dot-wait",
    cardClass: "is-waiting",
    marker: { className: "mk mk-wait", label: "Waiting for reply", dot: true },
    hint: "The agent is waiting for your reply.",
  },
  idle: {
    label: "Agent idle",
    header: "pause",
    showStep: true,
    hint: "The agent is idle. Your message starts a new turn.",
  },
  paused: {
    label: "Paused",
    header: "resume",
    disabled: true,
    showStep: true,
    marker: { className: "mk mk-paused", label: "Paused", dot: false },
    hint: "This run is paused. Click Resume to keep chatting.",
  },
  blocked: {
    label: "Blocked",
    header: "retry",
    disabled: true,
    dotClass: "dot dot-blocked",
    cardClass: "is-blocked",
    hint: "This run is blocked. Fix the cause, then click Retry.",
  },
  done: {
    label: "Finished",
    header: null,
    hint: "This run has finished. Review continues on the implementation pull request.",
  },
};
const controls = {
  start: { label: "Start planning", className: "btn btn-primary" },
  pause: { label: "Pause", className: "btn" },
  resume: { label: "Resume", className: "btn btn-live" },
  retry: { label: "Retry", className: "btn btn-danger" },
};

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
  const status = statuses[issue.status];
  const finished =
    issue.status === "done" ||
    issue.pullRequests.some(
      (p) => p.kind === "implementation" && p.state === "open",
    );
  const header = issue.terminal ? "terminal" : finished ? null : status.header;
  return {
    header,
    composer: issue.terminal
      ? "terminal"
      : finished
        ? "finished"
        : status.disabled
          ? "disabled"
          : "enabled",
    stopReply: !issue.terminal && !finished && issue.status === "working",
    dotClass: status.dotClass ?? "dot",
    cardClass: status.cardClass ?? "",
    marker: status.marker ?? null,
    statusLabel: status.label,
    composerHint: issue.terminal
      ? `View only. This run was started in a terminal with patchmill run-once --issue ${issue.number}.`
      : finished
        ? statuses.done.hint
        : status.hint,
    showStep: status.showStep ?? false,
    control: header && header !== "terminal" ? controls[header] : null,
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
