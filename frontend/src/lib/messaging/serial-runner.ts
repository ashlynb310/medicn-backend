export interface SerialRunner {
  /** Runs the task, or marks a rerun if one is already in flight. */
  schedule(): Promise<void>;
  readonly running: boolean;
  /** Number of task executions (useful for assertions/diagnostics). */
  readonly runs: number;
}

/**
 * Serializes an async task so it never overlaps itself, while guaranteeing that
 * work requested DURING a run is not lost: a notification that arrives mid-run
 * schedules exactly one more pass afterwards.
 *
 * A failing task never drops a pending rerun — the task is responsible for
 * reporting its own errors.
 */
export function createSerialRunner(task: () => Promise<void>): SerialRunner {
  let running = false;
  let pending = false;
  let runs = 0;

  const loop = async () => {
    running = true;
    try {
      do {
        pending = false;
        runs += 1;
        try {
          await task();
        } catch {
          // The task surfaces its own errors; keep the loop alive so a pending
          // rerun still happens.
        }
      } while (pending);
    } finally {
      running = false;
    }
  };

  return {
    schedule() {
      if (running) {
        pending = true;
        return Promise.resolve();
      }
      return loop();
    },
    get running() {
      return running;
    },
    get runs() {
      return runs;
    },
  };
}
