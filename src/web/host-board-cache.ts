import type { Host, Issue, PullRequest } from "../host/types.ts";

type HostBoardData = {
  issues: readonly Issue[];
  pullRequests: readonly PullRequest[];
  syncedAt: string;
};

/** One rate limit shared by every reader, including failed refresh attempts. */
export function createHostBoardCache(input: {
  host: Pick<Host, "listOpenIssues" | "listOpenPullRequests">;
  now: () => Date;
  warn: (message: string) => void;
}) {
  let cached: HostBoardData | undefined;
  let inFlight: Promise<HostBoardData> | undefined;
  let nextAttemptAt = -Infinity;
  let failure: Error | undefined;
  return {
    read(): Promise<HostBoardData> {
      if (inFlight) return inFlight;
      if (input.now().getTime() < nextAttemptAt)
        return cached ? Promise.resolve(cached) : Promise.reject(failure);
      nextAttemptAt = input.now().getTime() + 60000;
      const refresh = async (): Promise<HostBoardData> => {
        try {
          const [issues, pullRequests] = await Promise.all([
            input.host.listOpenIssues(),
            input.host.listOpenPullRequests(),
          ]);
          cached = {
            issues: structuredClone(issues),
            pullRequests: structuredClone(pullRequests),
            syncedAt: input.now().toISOString(),
          };
          failure = undefined;
          return cached;
        } catch {
          failure = new Error("Could not refresh host board data.");
          input.warn(failure.message);
          if (cached) return cached;
          throw failure;
        }
      };
      inFlight = refresh().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
}
