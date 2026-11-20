/**
 * Throttled typing signals for one issue page. The server clears a typing
 * flag a few seconds after the last `true`, so a sender that stops simply
 * expires. Every send is best effort.
 * @param {{send:(typing:boolean)=>Promise<unknown>,clock:{now:()=>number},intervalMs?:number}} options
 */
export function createTypingSignal({ send, clock, intervalMs = 3000 }) {
  let active = false;
  let lastTrue = -Infinity;
  let disposed = false;
  /** @param {boolean} typing */
  const post = (typing) => {
    active = typing;
    void send(typing).catch(() => {});
  };
  return {
    /** @param {boolean} hasText */
    input(hasText) {
      if (disposed) return;
      if (!hasText) {
        if (active) post(false);
        return;
      }
      const now = clock.now();
      if (active && now - lastTrue < intervalMs) return;
      lastTrue = now;
      post(true);
    },
    sent() {
      if (!disposed && active) post(false);
    },
    dispose() {
      disposed = true;
    },
  };
}
