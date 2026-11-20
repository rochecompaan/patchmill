/** @typedef {import('../src/web/api-types.ts').BoardResponse} BoardResponse */
/** @typedef {import('../src/web/api-types.ts').IssueResponse} IssueResponse */
/** @typedef {'start'|'messages'|'answers'|'stop-reply'|'pause'} SessionAction */
/** @typedef {{ok:true,duplicate:boolean}|{ok:false,status:number,code:string,message:string}} SessionResult */
/** @typedef {{board(signal?:AbortSignal):Promise<BoardResponse>,issue(number:number,signal?:AbortSignal):Promise<IssueResponse>,session(issue:number,action:SessionAction,body:Record<string,string>):Promise<SessionResult>,typing(issue:number,author:string,typing:boolean):Promise<boolean>}} ApiClient */
export class ApiRequestError extends Error {
  /** @param {number} status */
  constructor(status) {
    super(`HTTP request failed (${status}).`);
    this.status = status;
  }
}
/** @param {typeof fetch} fetcher @param {() => string} [requestId] @returns {ApiClient} */
export function createApi(
  fetcher = globalThis.fetch,
  requestId = () => globalThis.crypto.randomUUID(),
) {
  /** @param {string} path @param {AbortSignal|undefined} signal */
  async function get(path, signal) {
    const response = await fetcher(path, {
      method: "GET",
      credentials: "same-origin",
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new ApiRequestError(response.status);
    return response.json();
  }
  return {
    board: (signal) => get("/api/board", signal),
    /** A best-effort typing signal; it never throws. */
    async typing(issue, author, typing) {
      try {
        const response = await fetcher(`/api/issues/${issue}/typing`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author, typing }),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
    issue: async (number, signal) => {
      if (!Number.isSafeInteger(number) || number < 1)
        throw new ApiRequestError(400);
      return get("/api/issues/" + number, signal);
    },
    async session(issue, action, body) {
      const path =
        `/api/issues/${issue}/session` +
        (action === "start" ? "" : "/" + action);
      // One request ID for the input, so a retry counts once on the server.
      const init = {
        method: "POST",
        credentials: /** @type {const} */ ("same-origin"),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, requestId: requestId() }),
      };
      /** @type {Response} */ let response;
      try {
        response = await fetcher(path, init);
      } catch {
        try {
          response = await fetcher(path, init);
        } catch {
          return {
            ok: false,
            status: 0,
            code: "network_error",
            message: "Patchmill could not reach the server. Try again.",
          };
        }
      }
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        return { ok: true, duplicate: data?.duplicate === true };
      }
      const data = await response.json().catch(() => null);
      return {
        ok: false,
        status: response.status,
        code: String(data?.error?.code ?? "http_error"),
        message: String(
          data?.error?.message ?? `The request failed (${response.status}).`,
        ),
      };
    },
  };
}
