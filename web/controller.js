import { ApiRequestError } from "./api.js";
import { applyIssueUpdate } from "./live-issue.js";
/** @typedef {{readyState:number,close:()=>void,addEventListener:(name:string,fn:(event:{data?:string})=>void)=>void}} EventSourceLike */
/** @typedef {import('./api.js').ApiClient} ApiClient */
/** @typedef {import('./state.js').Route} Route */
/** @typedef {{route:Route,status:'loading'|'ready'|'unauthorized'|'not-found'|'error',board:import('./api.js').BoardResponse|null,issue:import('./api.js').IssueResponse|null,message:string|null,connection?:'connecting'|'live'|'reconnecting'|null}} PageState */
/** @param {{api:ApiClient,onState:(state:PageState)=>void,visible:()=>boolean,clock:{after:(ms:number,fn:()=>void)=>(()=>void)},events?:(url:string)=>EventSourceLike}} options */
export function createPageController({ api, onState, visible, clock, events }) {
  /** @type {PageState} */ let state = {
    route: { view: "board" },
    status: "loading",
    board: null,
    issue: null,
    message: null,
  };
  let generation = 0,
    disposed = false,
    busy = false;
  /** @type {AbortController|undefined} */ let active;
  /** @type {(()=>void)|undefined} */ let cancel;
  let published = "";
  /** @type {EventSourceLike|undefined} */ let stream;
  function closeStream() {
    const previous = stream;
    stream = undefined;
    previous?.close();
    state = { ...state, connection: null };
  }
  function connect() {
    if (
      !events ||
      stream ||
      state.issue?.source !== "live" ||
      state.issue.issue.run?.outcome !== "active"
    )
      return;
    const socket = events(
      `/api/issues/${state.issue.issue.summary.number}/events`,
    );
    stream = socket;
    state = { ...state, connection: "connecting" };
    const current = () => !disposed && stream === socket;
    socket.addEventListener("open", () => {
      if (current()) {
        state = { ...state, connection: "live" };
        publish();
      }
    });
    socket.addEventListener("error", () => {
      if (!current()) return;
      if (socket.readyState === 2) {
        closeStream();
        void load();
      } else {
        state = { ...state, connection: "reconnecting" };
        publish();
      }
    });
    for (const kind of ["reset", "header", "thread", "unavailable"])
      socket.addEventListener(kind, (event) => {
        if (!current() || !state.issue) return;
        try {
          const update =
            /** @type {import('../src/web/api-types.ts').IssueUpdate} */ (
              JSON.parse(event.data ?? "")
            );
          if (update.kind === "unavailable") {
            closeStream();
            publish();
            return;
          }
          state = { ...state, issue: applyIssueUpdate(state.issue, update) };
          if (state.issue?.issue.run?.outcome !== "active") {
            closeStream();
            publish();
            void load();
          } else publish();
        } catch {
          closeStream();
          void load();
        }
      });
  }
  function stopTimer() {
    cancel?.();
    cancel = undefined;
  }
  function publish() {
    const next = JSON.stringify(state);
    if (next === published) return;
    published = next;
    onState({ ...state });
  }
  async function load() {
    if (disposed || busy || state.status === "unauthorized") return;
    stopTimer();
    busy = true;
    const sequence = ++generation;
    active = new AbortController();
    const route = state.route;
    try {
      if (route.view === "not-found") {
        state = { ...state, status: "not-found" };
        publish();
        return;
      }
      if (route.view === "board") {
        const data = await api.board(active.signal);
        if (sequence !== generation) return;
        state = {
          ...state,
          status: "ready",
          board: data,
          issue: null,
          message: null,
        };
      } else {
        const data = await api.issue(route.number, active.signal);
        if (sequence !== generation) return;
        state = {
          ...state,
          status: "ready",
          issue: data,
          board: null,
          message: null,
        };
      }
      connect();
      publish();
    } catch (error) {
      if (sequence !== generation || disposed) return;
      const status = error instanceof ApiRequestError ? error.status : 0;
      state = {
        ...state,
        status:
          status === 401
            ? "unauthorized"
            : status === 404
              ? "not-found"
              : "error",
        board: null,
        issue: null,
        message:
          status === 401
            ? "Open the link printed by patchmill serve."
            : "Could not load data.",
      };
      publish();
    } finally {
      if (sequence === generation) {
        busy = false;
        if (
          !disposed &&
          state.status !== "unauthorized" &&
          state.route.view === "board" &&
          visible()
        )
          cancel = clock.after(15000, () => {
            void load();
          });
      }
    }
  }
  return {
    /** @param {Route} route */ async navigate(route) {
      stopTimer();
      closeStream();
      active?.abort();
      generation++;
      busy = false;
      state = {
        route,
        status: "loading",
        board: null,
        issue: null,
        message: null,
      };
      publish();
      await load();
    },
    async retry() {
      await load();
    },
    visibilityChanged() {
      stopTimer();
      if (visible() && state.route.view === "board") void load();
    },
    dispose() {
      disposed = true;
      closeStream();
      generation++;
      active?.abort();
      stopTimer();
    },
  };
}
