import {
  createWorkerPlanningAdapter,
  type WorkerPlanningAdapter,
  type WorkerPlanningPort,
} from "../src/index";

/**
 * Creates the native module Worker factory used by the browser calculator.
 *
 * @returns A Worker-like port factory compatible with the framework-independent adapter.
 * @throws Error when the browser does not expose module Workers.
 */
export function createBrowserWorkerFactory(): () => WorkerPlanningPort {
  return () => {
    if (typeof Worker === "undefined") {
      throw new Error("This browser does not provide module Workers for route planning.");
    }
    return new Worker(new URL("../src/worker-planning-worker.ts", import.meta.url), {
      type: "module",
    }) as unknown as WorkerPlanningPort;
  };
}

/**
 * Creates the browser calculator's worker-planning adapter.
 *
 * @returns An adapter that keeps generation and route planning off the interface thread.
 */
export function createBrowserWorkerPlanningAdapter(): WorkerPlanningAdapter {
  return createWorkerPlanningAdapter({
    workerFactory: createBrowserWorkerFactory(),
    requestIdPrefix: "calculator-request",
  });
}
