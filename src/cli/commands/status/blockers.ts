import type { Host } from "../../../host/types.ts";
import type { StateStore } from "../../../state/store.ts";
import { checkStateRepository } from "../../../state/sync.ts";

export type BlockerHost = Pick<Host, "repository" | "listIssueDependencies">;
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export async function readBlockers(
  candidates: number[],
  getHost: () => BlockerHost,
  store: StateStore,
  warn: (message: string) => void,
): Promise<Map<number, string>> {
  const results = new Map<number, string>();
  if (!candidates.length) return results;
  let host: BlockerHost;
  let repository: string | undefined;
  try {
    host = getHost();
    ({ repository } = await checkStateRepository(host, store));
  } catch (error) {
    warn(`Cannot read blockers: ${message(error)}`);
    for (const n of candidates) results.set(n, "Blockers unknown");
    return results;
  }
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, candidates.length) }, async () => {
      while (next < candidates.length) {
        const n = candidates[next++]!;
        try {
          const dependencies = await host.listIssueDependencies(n);
          const open = dependencies
            .filter((d) => d.state === "open")
            .map((d) =>
              d.repository.toLowerCase() === repository?.toLowerCase()
                ? `#${d.number}`
                : `${d.repository}#${d.number}`,
            );
          if (open.length) results.set(n, `Blocked by ${open.join(", ")}`);
        } catch (error) {
          results.set(n, "Blockers unknown");
          warn(`Cannot read blockers for issue #${n}: ${message(error)}`);
        }
      }
    }),
  );
  return results;
}
