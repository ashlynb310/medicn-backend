import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

export const DOWNSTREAM_WORKERS = [
  { name: "email", entryPoint: "../email/email.worker.js" },
  { name: "media", entryPoint: "../media/media.worker.js" },
  { name: "maps", entryPoint: "../maps/maps.worker.js" },
  { name: "operations", entryPoint: "../operations/operations.worker.js" }
] as const;

type ShutdownSignal = "SIGINT" | "SIGTERM";
type DownstreamWorker = (typeof DOWNSTREAM_WORKERS)[number];

export interface SupervisorLogger {
  log(message: string): void;
  error(message: string): void;
}

interface SignalSource {
  once(event: ShutdownSignal, listener: () => void): unknown;
  removeListener(event: ShutdownSignal, listener: () => void): unknown;
}

interface SupervisorDependencies {
  signalSource?: SignalSource;
  spawnWorker?: (worker: DownstreamWorker) => ChildProcess;
  logger?: SupervisorLogger;
}

interface ChildState {
  child: ChildProcess;
  settled: boolean;
  worker: DownstreamWorker;
}

const defaultLogger: SupervisorLogger = {
  log: (message) => process.stdout.write(`${message}\n`),
  error: (message) => process.stderr.write(`${message}\n`)
};

function spawnCompiledWorker(worker: DownstreamWorker) {
  return spawn(process.execPath, [resolve(__dirname, worker.entryPoint)], {
    env: process.env,
    shell: false,
    stdio: "inherit",
    windowsHide: true
  });
}

export function runDownstreamWorkerSupervisor(
  dependencies: SupervisorDependencies = {}
): Promise<number> {
  const logger = dependencies.logger ?? defaultLogger;
  const signalSource = dependencies.signalSource ?? process;
  const spawnWorker = dependencies.spawnWorker ?? spawnCompiledWorker;

  return new Promise((resolveCompletion) => {
    const children: ChildState[] = [];
    let mode: "running" | "shutdown" | "failure" = "running";
    let spawning = true;
    let completed = false;

    const finishIfReady = () => {
      if (completed || spawning || children.some((state) => !state.settled)) {
        return;
      }
      completed = true;
      signalSource.removeListener("SIGINT", handleSigint);
      signalSource.removeListener("SIGTERM", handleSigterm);
      resolveCompletion(mode === "shutdown" ? 0 : 1);
    };

    const forwardSignal = (signal: ShutdownSignal) => {
      for (const state of children) {
        if (state.settled) continue;
        try {
          state.child.kill(signal);
        } catch {
          logger.error(`worker_signal_failed worker=${state.worker.name}`);
        }
      }
    };

    const beginShutdown = (signal: ShutdownSignal) => {
      if (mode === "running") {
        mode = "shutdown";
        logger.log(`worker_supervisor_shutdown signal=${signal}`);
      }
      forwardSignal(signal);
      finishIfReady();
    };

    function handleSigint() {
      beginShutdown("SIGINT");
    }

    function handleSigterm() {
      beginShutdown("SIGTERM");
    }

    const beginFailure = (worker: DownstreamWorker, event: "exit" | "error") => {
      if (mode !== "running") return;
      mode = "failure";
      logger.error(`worker_${event}_unexpected worker=${worker.name}`);
      forwardSignal("SIGTERM");
    };

    const settleChild = (
      state: ChildState,
      event: "exit" | "error"
    ) => {
      if (state.settled) return;
      state.settled = true;
      beginFailure(state.worker, event);
      finishIfReady();
    };

    signalSource.once("SIGINT", handleSigint);
    signalSource.once("SIGTERM", handleSigterm);

    for (const worker of DOWNSTREAM_WORKERS) {
      if (mode !== "running") break;
      try {
        const child = spawnWorker(worker);
        const state: ChildState = { child, settled: false, worker };
        children.push(state);
        child.once("exit", () => settleChild(state, "exit"));
        child.once("error", () => settleChild(state, "error"));
        logger.log(`worker_started worker=${worker.name}`);
      } catch {
        mode = "failure";
        logger.error(`worker_spawn_failed worker=${worker.name}`);
        forwardSignal("SIGTERM");
      }
    }

    spawning = false;
    finishIfReady();
  });
}

if (require.main === module) {
  void runDownstreamWorkerSupervisor().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    () => {
      process.stderr.write("worker_supervisor_failed\n");
      process.exitCode = 1;
    }
  );
}
