import type { Host } from "../../../host/types.ts";
import { blockerNote } from "../../../kernel/workflow-state.ts";
import { cleanValue } from "../../../kernel/terminal-layout.ts";
import type { StateStore } from "../../../state/store.ts";
import { checkStateRepository } from "../../../state/sync.ts";

export type BlockerHost = Pick<Host, "repository" | "listIssueDependencies">;
const message = (error: unknown) =>
  cleanValue(error instanceof Error ? error.message : String(error));

export async function readBlockers(
  candidates: number[],
  host: BlockerHost,
  store: StateStore,
  warn: (message: string) => void,
): Promise<Map<number, string>> {
  const results = new Map<number, string>();
  if (!candidates.length) return results;
  let repository: string;
  try {
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
          const open = await Promise.all(
            dependencies
              .filter((d) => d.state === "open")
              .map(async (d) => {
                if (d.repository.toLowerCase() !== repository.toLowerCase())
                  return `${cleanValue(d.repository)}#${d.number}`;
                let note = "";
                try {
                  note = blockerNote(
                    (await store.readStatus(d.number)).at(-1)?.status,
                  );
                } catch {
                  // Status is best effort; the dependency still blocks work.
                }
                return `#${d.number}${note}`;
              }),
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
