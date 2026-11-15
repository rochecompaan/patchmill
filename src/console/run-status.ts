import { visibleWidth } from "@earendil-works/pi-tui";
import { formatPhaseStart } from "../kernel/console.ts";
import type { RunSnapshot } from "../kernel/run-snapshot.ts";
import { cleanValue } from "../kernel/terminal-layout.ts";

export const RUN_STATUS_KEY = "patchmill";
const separator = " \u00a0·\u00a0 ";
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const labels = {
  deriving: "preparing",
  "gate-wait": "awaiting approval",
  "review-wait": "awaiting review",
  blocked: "blocked",
  ended: "ended",
};

/** Keep the state visible by spending the remaining terminal columns on the title. */
export function formatRunStatus(snapshot: RunSnapshot, width: number): string {
  const { state, phase, session } = snapshot;
  const label =
    state === "planning" || state === "implementation"
      ? formatPhaseStart(phase ?? state, session)
      : labels[state];
  const prefix = `#${snapshot.issue}`;
  const suffix = separator + label;
  const title = cleanValue(snapshot.title ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return prefix + suffix;
  const full = `${prefix} ${title}${suffix}`;
  if (visibleWidth(full) <= width) return full;
  const budget = width - visibleWidth(prefix + " " + suffix);
  if (budget < 2) return prefix + suffix;
  let shortened = "";
  let used = 0;
  for (const { segment } of graphemes.segment(title)) {
    const columns = visibleWidth(segment);
    if (used + columns > budget - 1) break;
    shortened += segment;
    used += columns;
  }
  return `${prefix} ${shortened.trimEnd()}…${suffix}`;
}

export type RunStatusUi = {
  setStatus(key: string, text: string | undefined): void;
  columns(): number;
};
export type RunStatus = {
  show(snapshot: RunSnapshot): void;
  refresh(): void;
  clear(): void;
};

/** A stale or failing footer must not affect run decisions or shutdown. */
export function createRunStatus(ui: RunStatusUi): RunStatus {
  let current: RunSnapshot | undefined;
  const refresh = () => {
    if (!current) return;
    try {
      ui.setStatus(RUN_STATUS_KEY, formatRunStatus(current, ui.columns()));
    } catch {
      /* Display only. The Pi context may already be closed. */
    }
  };
  return {
    show(snapshot) {
      current = snapshot;
      refresh();
    },
    refresh,
    clear() {
      current = undefined;
      try {
        ui.setStatus(RUN_STATUS_KEY, undefined);
      } catch {
        /* Display only. The Pi context may already be closed. */
      }
    },
  };
}
