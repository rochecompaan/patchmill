/** @param {'sample'|'live'} source @param {string|null} syncedAt @param {number} nowMs */
export function syncText(source, syncedAt, nowMs) {
  if (source === "sample") return "Sample data";
  const at = syncedAt === null ? NaN : Date.parse(syncedAt);
  if (!Number.isFinite(at)) return "Not synced yet";
  return `synced ${Math.max(0, Math.floor((nowMs - at) / 1000))} s ago`;
}

/** @param {Pick<HTMLElement,'textContent'>} node
 * @param {{now:()=>number,every:(ms:number,fn:()=>void)=>(()=>void)}} clock */
export function mountSyncStatus(node, clock) {
  /** @type {{source:'sample'|'live',syncedAt:string|null}|null} */ let meta =
    null;
  let disposed = false;
  function render() {
    if (!disposed && meta)
      node.textContent = syncText(meta.source, meta.syncedAt, clock.now());
  }
  const stop = clock.every(1000, render);
  return {
    /** @param {{source:'sample'|'live',syncedAt:string|null}} next */
    update(next) {
      if (!disposed) {
        meta = next;
        render();
      }
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        stop();
      }
    },
  };
}
