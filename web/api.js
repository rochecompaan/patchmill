/** @typedef {import('../src/web/api-types.ts').BoardResponse} BoardResponse */
/** @typedef {import('../src/web/api-types.ts').IssueResponse} IssueResponse */
/** @typedef {{board(signal?:AbortSignal):Promise<BoardResponse>,issue(number:number,signal?:AbortSignal):Promise<IssueResponse>}} ApiClient */
export class ApiRequestError extends Error {
  /** @param {number} status */
  constructor(status) {
    super(`HTTP request failed (${status}).`);
    this.status = status;
  }
}
/** @param {typeof fetch} fetcher @returns {ApiClient} */
export function createApi(fetcher = globalThis.fetch) {
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
    issue: async (number, signal) => {
      if (!Number.isSafeInteger(number) || number < 1)
        throw new ApiRequestError(400);
      return get("/api/issues/" + number, signal);
    },
  };
}
