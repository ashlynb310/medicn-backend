import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  DOWNSTREAM_WORKERS,
  runDownstreamWorkerSupervisor,
  type SupervisorLogger
} from "../src/workers/downstream-worker.supervisor";

class FakeChild extends EventEmitter {
  readonly kill = jest.fn(() => true);

  exit(code: number | null, signal: NodeJS.Signals | null = null) {
    this.emit("exit", code, signal);
  }
}

function createHarness() {
  const signalSource = new EventEmitter();
  const children = new Map<string, FakeChild>();
  const logger: SupervisorLogger = {
    log: jest.fn(),
    error: jest.fn()
  };
  const spawnWorker = jest.fn((worker: (typeof DOWNSTREAM_WORKERS)[number]) => {
    const child = new FakeChild();
    children.set(worker.name, child);
    return child as unknown as ChildProcess;
  });
  const completion = runDownstreamWorkerSupervisor({
    signalSource,
    spawnWorker,
    logger
  });

  return { children, completion, logger, signalSource, spawnWorker };
}

describe("downstream worker supervisor", () => {
  it("uses the exact compiled downstream-worker inventory", () => {
    expect(DOWNSTREAM_WORKERS).toEqual([
      { name: "email", entryPoint: "../email/email.worker.js" },
      { name: "media", entryPoint: "../media/media.worker.js" },
      { name: "maps", entryPoint: "../maps/maps.worker.js" },
      { name: "operations", entryPoint: "../operations/operations.worker.js" }
    ]);
  });

  it("does not include the outbox worker", () => {
    expect(DOWNSTREAM_WORKERS).toHaveLength(4);
    expect(DOWNSTREAM_WORKERS.map((worker) => worker.name)).not.toContain("outbox");
    expect(DOWNSTREAM_WORKERS.some((worker) =>
      worker.entryPoint.includes("outbox")
    )).toBe(false);
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "forwards %s to every child and waits for their exits",
    async (signal) => {
      const { children, completion, signalSource } = createHarness();

      signalSource.emit(signal);

      for (const child of children.values()) {
        expect(child.kill).toHaveBeenCalledWith(signal);
      }
      let completed = false;
      void completion.then(() => {
        completed = true;
      });
      await Promise.resolve();
      expect(completed).toBe(false);

      for (const child of children.values()) {
        child.exit(null, signal);
      }
      await expect(completion).resolves.toBe(0);
    }
  );

  it("terminates the remaining children and exits non-zero when one child fails", async () => {
    const { children, completion, spawnWorker } = createHarness();

    children.get("media")?.exit(1);

    expect(children.get("email")?.kill).toHaveBeenCalledWith("SIGTERM");
    expect(children.get("maps")?.kill).toHaveBeenCalledWith("SIGTERM");
    expect(children.get("operations")?.kill).toHaveBeenCalledWith("SIGTERM");
    expect(spawnWorker).toHaveBeenCalledTimes(4);

    children.get("email")?.exit(null, "SIGTERM");
    children.get("maps")?.exit(null, "SIGTERM");
    children.get("operations")?.exit(null, "SIGTERM");

    await expect(completion).resolves.toBe(1);
  });

  it("exits successfully after every child completes a clean shutdown", async () => {
    const { children, completion, signalSource } = createHarness();

    signalSource.emit("SIGTERM");
    for (const child of children.values()) {
      child.exit(0);
    }

    await expect(completion).resolves.toBe(0);
  });
});
