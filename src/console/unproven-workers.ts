import { SubagentsClient, SubagentsRpcError } from "./subagents-client.ts";
import { stopWorkers } from "./stray-workers.ts";

type Proof = { pending?: Promise<void>; failure?: SubagentsRpcError };

/** One serialized exit proof per ID, shared by cleanup, recovery and shutdown. */
export function createUnprovenWorkers(client: SubagentsClient) {
  const proofs = new Map<string, Proof>();
  function proveExit(id: string): Promise<void> {
    const current = proofs.get(id);
    // Serializing attempts applies every result before a newer proof can start.
    if (current?.pending) return current.pending;
    const proof: Proof = {};
    proofs.set(id, proof);
    // Install the shared promise before any RPC can invoke event subscribers.
    proof.pending = Promise.resolve().then(async () => {
      try {
        const stopped = await stopWorkers(client, { ids: [id] });
        if (!stopped.ok) throw new Error("did not stop within the stop wait");
        proofs.delete(id);
      } catch (error) {
        proof.failure = new SubagentsRpcError(
          "stop_failed",
          `Worker ${id} exit is unproven: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw proof.failure;
      } finally {
        delete proof.pending;
      }
    });
    return proof.pending;
  }
  return {
    proveExit,
    async retry() {
      for (const id of [...proofs.keys()]) await proveExit(id);
    },
    state(id: string): "stopping" | "unresolved" | undefined {
      const proof = proofs.get(id);
      return proof ? (proof.pending ? "stopping" : "unresolved") : undefined;
    },
    async verifyExit() {
      for (;;) {
        const pending = [...proofs.values()].flatMap((proof) =>
          proof.pending ? [proof.pending] : [],
        );
        if (pending.length === 0) {
          for (const [id, proof] of proofs) {
            throw (
              proof.failure ??
              new SubagentsRpcError(
                "stop_failed",
                `Worker ${id} exit is unproven`,
              )
            );
          }
          return;
        }
        // Only drain proofs started by callers; never start another retry here.
        // A fresh proof may replace a failure while this await is settling.
        await Promise.allSettled(pending);
      }
    },
  };
}
