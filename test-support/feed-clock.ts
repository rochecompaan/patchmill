export function feedClock() {
  let now = 0;
  const tasks = new Set<{ at: number; ms: number; fn: () => void }>();
  function timer(ms: number, fn: () => void, repeat: boolean) {
    const task = { at: now + ms, ms: repeat ? ms : 0, fn };
    tasks.add(task);
    return () => tasks.delete(task);
  }
  return {
    now: () => now,
    every: (ms: number, fn: () => void) => timer(ms, fn, true),
    after: (ms: number, fn: () => void) => timer(ms, fn, false),
    async advance(ms: number) {
      now += ms;
      for (const t of [...tasks])
        if (t.at <= now) {
          if (t.ms) t.at = now + t.ms;
          else tasks.delete(t);
          t.fn();
        }
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
    get intervals() {
      return [...tasks].filter((t) => t.ms).length;
    },
  };
}
