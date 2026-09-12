import { describe, expect, test } from "bun:test";

import {
  compileScenario,
  createInProcessWorkerFactory,
  createScenarioExport,
  createWorkerPlanningAdapter,
  createWorkerPlanningEndpoint,
  createWorkerPlanningRequest,
  generateClusterRegion,
  generateHierarchicalCluster,
  minimalScenario,
  planClusterRoute,
  planJourney,
  seconds,
  type ClusterRoutePlanningRequest,
  type RoutePlanningRequest,
  type WorkerPlanningProgress,
  type WorkerPlanningPort,
} from "../src/index";

const routeRequest: RoutePlanningRequest = Object.freeze({
  departureGateId: "gate:terra",
  destinationGateId: "gate:selene",
  shipProfileId: "ship:survey",
  departureCoordinateTime: seconds(0),
  dwells: Object.freeze([]),
  latestArrivalCoordinateTime: seconds(1e16),
  maximumStrategicWait: seconds(0),
  provenanceFilter: undefined,
  maxAlternatives: 4,
  searchBudget: undefined,
});

type ManualPort = {
  readonly port: WorkerPlanningPort;
  readonly posted: unknown[];
  readonly emitMessage: (message: unknown) => void;
  readonly emitError: (error: unknown) => void;
  terminated: boolean;
};

function manualPort(): ManualPort {
  const posted: unknown[] = [];
  let terminated = false;
  const listeners = {
    message: undefined as ((event: unknown) => void) | undefined,
    error: undefined as ((event: unknown) => void) | undefined,
  };
  const port: WorkerPlanningPort = {
    postMessage(message) {
      posted.push(message);
    },
    terminate() {
      terminated = true;
    },
    addEventListener(type, listener) {
      if (type === "message") {
        listeners.message = listener;
      } else if (type === "error") {
        listeners.error = listener;
      }
    },
    removeEventListener() {},
  };
  return {
    port,
    posted,
    emitMessage(message) {
      listeners.message?.({ data: message });
    },
    emitError(error) {
      listeners.error?.(error);
    },
    get terminated() {
      return terminated;
    },
  };
}

describe("worker planning adapter", () => {
  test("plans through the worker protocol with the same result as direct execution", async () => {
    const compiled = compileScenario(minimalScenario);
    if (!compiled.ok) {
      throw new Error("The minimal Scenario fixture must compile.");
    }
    const direct = planJourney(compiled.scenario, routeRequest);
    const adapter = createWorkerPlanningAdapter({
      workerFactory: createInProcessWorkerFactory(),
    });

    const task = adapter.plan(compiled.scenario, routeRequest);
    const worker = await task.promise;

    expect(worker.ok).toBe(true);
    if (worker.ok) {
      expect(worker.result).toEqual(direct);
      expect(worker.requestId).toBe(task.requestId);
      expect(worker.protocolVersion).toBe(1);
    }
    const persistedTask = adapter.plan(createScenarioExport(compiled.scenario), routeRequest);
    const persisted = await persistedTask.promise;
    expect(persisted.ok).toBe(worker.ok);
    if (persisted.ok && worker.ok) {
      expect(persisted.result).toEqual(worker.result);
    }
    await adapter.dispose();
  });

  test("generates a transport-safe Scenario with the same deterministic values as direct generation", async () => {
    const request = {
      logicalPopulation: 128,
      materializedSystemCount: 16,
      seed: "worker-generation",
      generatorVersion: "globular-v1",
    } as const;
    const direct = generateClusterRegion(request);
    const adapter = createWorkerPlanningAdapter({
      workerFactory: createInProcessWorkerFactory(),
    });

    const worker = await adapter.generate(request).promise;

    expect(worker.ok).toBe(true);
    if (worker.ok) {
      expect(worker.result.scenario).toEqual(createScenarioExport(direct.scenario));
      expect(worker.result.generatedSystemIds).toEqual(direct.generatedSystemIds);
      expect(worker.result.generatedGateIds).toEqual(direct.generatedGateIds);
      expect(worker.result.route).toEqual(direct.route);
    }
    await adapter.dispose();
  });

  test("refines through the same bounded hierarchical route seam as direct execution", async () => {
    const hierarchy = generateHierarchicalCluster({
      logicalPopulation: 10_000,
      seed: "worker-refinement",
      generatorVersion: "globular-v1",
    });
    const request: ClusterRoutePlanningRequest = {
      departureGateId: hierarchy.defaultDepartureGateId,
      destinationGateId: hierarchy.defaultDestinationGateId,
      shipProfileId: hierarchy.defaultShipProfileId,
      departureCoordinateTime: seconds(0),
      dwells: [],
      latestArrivalCoordinateTime: seconds(1e16),
      maximumStrategicWait: seconds(0),
      refinementDepth: 2,
      maxMaterializedSystems: 64,
      maxCandidateRoutes: 4,
    };
    const direct = planClusterRoute(hierarchy, request);
    const adapter = createWorkerPlanningAdapter({
      workerFactory: createInProcessWorkerFactory(),
    });

    const worker = await adapter.refine(hierarchy, request).promise;

    expect(worker.ok).toBe(true);
    if (worker.ok) {
      expect(worker.result).toEqual(direct);
    }
    await adapter.dispose();
  });

  test("cancels a representative generated route before refinement consumes useful work", async () => {
    const hierarchy = generateHierarchicalCluster({
      logicalPopulation: 100_000,
      seed: "worker-cancellation",
      generatorVersion: "globular-v1",
    });
    const request: ClusterRoutePlanningRequest = {
      departureGateId: hierarchy.defaultDepartureGateId,
      destinationGateId: hierarchy.defaultDestinationGateId,
      shipProfileId: hierarchy.defaultShipProfileId,
      departureCoordinateTime: seconds(0),
      dwells: [],
      latestArrivalCoordinateTime: seconds(1e16),
      maximumStrategicWait: seconds(0),
      refinementDepth: 6,
      maxMaterializedSystems: 128,
      maxCandidateRoutes: 8,
    };
    const progress: WorkerPlanningProgress[] = [];
    let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
    let responsiveTicks = 0;
    let resolveWorkerCancellation!: (cancelled: boolean) => void;
    const workerCancellation = new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 1_000);
      resolveWorkerCancellation = (cancelled) => {
        clearTimeout(timeout);
        resolve(cancelled);
      };
    });
    const nativeWorker = new Worker(new URL("../src/worker-planning-worker.ts", import.meta.url), {
      type: "module",
    });
    const heartbeat = setInterval(() => {
      responsiveTicks += 1;
    }, 1);
    const adapter = createWorkerPlanningAdapter({
      workerFactory: () => nativeWorker as unknown as WorkerPlanningPort,
    });
    const task = adapter.refine(hierarchy, request, {
      onProgress: (value) => {
        progress.push(value);
        if (value.stage === "refining" && cancellationTimer === undefined) {
          cancellationTimer = setTimeout(() => task.cancel(), 10);
        }
      },
    });
    nativeWorker.addEventListener("message", (event) => {
      const message = event.data as {
        readonly requestId?: string;
        readonly type?: string;
        readonly outcome?: string;
      };
      if (message.requestId === undefined || message.requestId !== task.requestId) {
        return;
      }
      if (message.type === "result") {
        resolveWorkerCancellation(message.outcome === "cancelled");
      }
    });

    const startedAt = Date.now();
    const result = await task.promise;
    clearInterval(heartbeat);
    if (cancellationTimer !== undefined) {
      clearTimeout(cancellationTimer);
    }
    const elapsedMs = Date.now() - startedAt;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome).toBe("cancelled");
      expect(result.error.code).toBe("cancelled");
    }
    expect(elapsedMs).toBeLessThan(2_000);
    expect(await workerCancellation).toBe(true);
    expect(responsiveTicks).toBeGreaterThan(0);
    expect(progress.some((value) => value.stage === "refining")).toBe(true);
    expect(progress.every((value) => value.requestId === task.requestId)).toBe(true);
    await adapter.dispose();
  });

  test("validates protocol payloads and keeps duplicate endpoint requests recoverable", async () => {
    const messages: unknown[] = [];
    const endpoint = createWorkerPlanningEndpoint({
      postMessage: (message) => messages.push(message),
    });
    endpoint.handleMessage({
      protocolVersion: 1,
      type: "request",
      requestId: "malformed-1",
      operation: "plan",
      payload: { request: {} },
    });

    const malformed = messages[0] as {
      readonly type: string;
      readonly requestId: string;
      readonly outcome: string;
      readonly error: { readonly code: string };
    };
    expect(malformed.type).toBe("result");
    expect(malformed.requestId).toBe("malformed-1");
    expect(malformed.outcome).toBe("malformed-message");
    expect(malformed.error.code).toBe("malformed-message");

    const validRequest = createWorkerPlanningRequest("duplicate-1", "plan", {
      scenario: minimalScenario,
      request: routeRequest,
    });
    endpoint.handleMessage(validRequest);
    endpoint.handleMessage(validRequest);
    expect(
      messages.some((message) => {
        if (typeof message !== "object" || message === null) {
          return false;
        }
        const candidate = message as {
          readonly type?: string;
          readonly error?: { readonly code?: string };
        };
        return candidate.type === "error" && candidate.error?.code === "duplicate-request";
      }),
    ).toBe(true);
    endpoint.dispose();
  });

  test("terminates a Worker that finishes starting after disposal", async () => {
    const latePort = manualPort();
    let resolveFactory!: (port: WorkerPlanningPort) => void;
    const adapter = createWorkerPlanningAdapter({
      workerFactory: () =>
        new Promise<WorkerPlanningPort>((resolve) => {
          resolveFactory = resolve;
        }),
    });
    const task = adapter.plan(minimalScenario, routeRequest);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const disposal = adapter.dispose();
    resolveFactory(latePort.port);
    await disposal;

    const result = await task.promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome).toBe("disposed");
    }
    expect(latePort.terminated).toBe(true);
    expect(adapter.activeRequestIds()).toEqual([]);
  });

  test("turns startup failures, malformed responses, and crashes into recoverable outcomes", async () => {
    const startupAdapter = createWorkerPlanningAdapter({
      workerFactory: () => {
        throw new Error("startup unavailable");
      },
    });
    const startup = await startupAdapter.plan(minimalScenario, routeRequest).promise;

    expect(startup.ok).toBe(false);
    if (!startup.ok) {
      expect(startup.outcome).toBe("startup-failed");
      expect(startup.error.code).toBe("startup-failed");
      expect(startup.error.cause).toBe("startup unavailable");
    }
    await startupAdapter.dispose();

    const malformedPort = manualPort();
    const malformedAdapter = createWorkerPlanningAdapter({
      workerFactory: () => malformedPort.port,
    });
    const malformedTask = malformedAdapter.plan(minimalScenario, routeRequest);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    malformedPort.emitMessage({
      protocolVersion: 99,
      type: "result",
      requestId: malformedTask.requestId,
      operation: "plan",
      ok: true,
      result: {},
    });
    const malformed = await malformedTask.promise;

    expect(malformed.ok).toBe(false);
    if (!malformed.ok) {
      expect(malformed.outcome).toBe("malformed-message");
      expect(malformed.error.code).toBe("protocol-version-mismatch");
    }
    await malformedAdapter.dispose();

    const invalidResultPort = manualPort();
    const invalidResultAdapter = createWorkerPlanningAdapter({
      workerFactory: () => invalidResultPort.port,
    });
    const invalidResultTask = invalidResultAdapter.plan(minimalScenario, routeRequest);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    invalidResultPort.emitMessage({
      protocolVersion: 1,
      type: "result",
      requestId: invalidResultTask.requestId,
      operation: "plan",
      ok: true,
      outcome: "success",
      result: {},
      error: undefined,
    });
    const invalidResult = await invalidResultTask.promise;
    expect(invalidResult.ok).toBe(false);
    if (!invalidResult.ok) {
      expect(invalidResult.outcome).toBe("malformed-message");
      expect(invalidResult.error.code).toBe("malformed-message");
    }
    await invalidResultAdapter.dispose();

    const crashedPort = manualPort();
    const crashedAdapter = createWorkerPlanningAdapter({
      workerFactory: () => crashedPort.port,
    });
    const crashedTask = crashedAdapter.plan(minimalScenario, routeRequest);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    crashedPort.emitError(new Error("worker stopped"));
    const crashed = await crashedTask.promise;

    expect(crashed.ok).toBe(false);
    if (!crashed.ok) {
      expect(crashed.outcome).toBe("worker-crashed");
      expect(crashed.error.code).toBe("worker-crashed");
      expect(crashed.error.cause).toBe("worker stopped");
    }
    await crashedAdapter.dispose();
  });

  test("recovers with a fresh port without accepting late messages from a crashed port", async () => {
    const compiled = compileScenario(minimalScenario);
    if (!compiled.ok) {
      throw new Error("The minimal Scenario fixture must compile.");
    }
    const direct = planJourney(compiled.scenario, routeRequest);
    const firstPort = manualPort();
    const secondPort = manualPort();
    let factoryCalls = 0;
    const adapter = createWorkerPlanningAdapter({
      workerFactory: () => {
        factoryCalls += 1;
        return factoryCalls === 1 ? firstPort.port : secondPort.port;
      },
    });
    const first = adapter.plan(minimalScenario, routeRequest);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    firstPort.emitError(new Error("first worker stopped"));
    const firstResult = await first.promise;
    expect(firstResult.ok).toBe(false);
    if (!firstResult.ok) {
      expect(firstResult.outcome).toBe("worker-crashed");
    }

    const second = adapter.plan(minimalScenario, routeRequest);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    firstPort.emitMessage({
      protocolVersion: 1,
      type: "result",
      requestId: second.requestId,
      operation: "plan",
      ok: true,
      outcome: "success",
      result: {},
      error: undefined,
    });
    secondPort.emitMessage({
      protocolVersion: 1,
      type: "result",
      requestId: second.requestId,
      operation: "plan",
      ok: true,
      outcome: "success",
      result: direct,
      error: undefined,
    });
    const secondResult = await second.promise;

    expect(secondResult.ok).toBe(true);
    expect(factoryCalls).toBe(2);
    expect(
      adapter.getDiagnostics().some((diagnostic) => diagnostic.code === "stale-response"),
    ).toBe(true);
    await adapter.dispose();
  });

  test("restarts a non-shared transport without settling unrelated requests", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crossOriginIsolated");
    Object.defineProperty(globalThis, "crossOriginIsolated", {
      configurable: true,
      value: false,
      writable: true,
    });
    let dispose: (() => Promise<void>) | undefined;
    try {
      const compiled = compileScenario(minimalScenario);
      if (!compiled.ok) {
        throw new Error("The minimal Scenario fixture must compile.");
      }
      const direct = planJourney(compiled.scenario, routeRequest);
      const firstPort = manualPort();
      const secondPort = manualPort();
      let factoryCalls = 0;
      const adapter = createWorkerPlanningAdapter({
        workerFactory: () => {
          factoryCalls += 1;
          return factoryCalls === 1 ? firstPort.port : secondPort.port;
        },
      });
      dispose = adapter.dispose;
      const cancelled = adapter.plan(compiled.scenario, routeRequest);
      const retained = adapter.plan(compiled.scenario, routeRequest);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(
        firstPort.posted.every((message) => {
          if (typeof message !== "object" || message === null) {
            return false;
          }
          return (
            (message as { readonly cancellationToken?: unknown }).cancellationToken === undefined
          );
        }),
      ).toBe(true);
      expect(cancelled.cancel()).toBe(true);
      const cancelledResult = await cancelled.promise;
      expect(cancelledResult.ok).toBe(false);
      if (!cancelledResult.ok) {
        expect(cancelledResult.outcome).toBe("cancelled");
      }

      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(firstPort.terminated).toBe(true);
      expect(factoryCalls).toBe(2);
      expect(
        secondPort.posted.some((message) => {
          if (typeof message !== "object" || message === null) {
            return false;
          }
          return (message as { readonly requestId?: string }).requestId === retained.requestId;
        }),
      ).toBe(true);

      firstPort.emitMessage({
        protocolVersion: 1,
        type: "result",
        requestId: retained.requestId,
        operation: "plan",
        ok: true,
        outcome: "success",
        result: direct,
        error: undefined,
      });
      secondPort.emitMessage({
        protocolVersion: 1,
        type: "result",
        requestId: retained.requestId,
        operation: "plan",
        ok: true,
        outcome: "success",
        result: direct,
        error: undefined,
      });
      const retainedResult = await retained.promise;
      expect(retainedResult.ok).toBe(true);
      expect(
        adapter.getDiagnostics().some((diagnostic) => diagnostic.code === "stale-response"),
      ).toBe(true);
    } finally {
      await dispose?.();
      if (originalDescriptor === undefined) {
        Reflect.deleteProperty(globalThis, "crossOriginIsolated");
      } else {
        Object.defineProperty(globalThis, "crossOriginIsolated", originalDescriptor);
      }
    }
  });

  test("ignores duplicate, stale, and out-of-order responses without crossing requests", async () => {
    const compiled = compileScenario(minimalScenario);
    if (!compiled.ok) {
      throw new Error("The minimal Scenario fixture must compile.");
    }
    const direct = planJourney(compiled.scenario, routeRequest);
    const fake = manualPort();
    const adapter = createWorkerPlanningAdapter({ workerFactory: () => fake.port });
    const first = adapter.plan(compiled.scenario, routeRequest);
    const second = adapter.plan(compiled.scenario, routeRequest);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const progress = (
      requestId: string,
      stage: "starting" | "planning",
      completedWork: number,
    ) => ({
      protocolVersion: 1 as const,
      type: "progress" as const,
      requestId,
      operation: "plan" as const,
      stage,
      completedWork,
      totalWork: 2,
      refinementQuality: undefined,
    });
    const result = (requestId: string) => ({
      protocolVersion: 1 as const,
      type: "result" as const,
      requestId,
      operation: "plan" as const,
      ok: true as const,
      outcome: "success" as const,
      result: direct,
      error: undefined,
    });

    fake.emitMessage(progress(first.requestId, "planning", 1));
    fake.emitMessage(progress(first.requestId, "starting", 0));
    fake.emitMessage(result(first.requestId));
    fake.emitMessage(result(first.requestId));
    fake.emitMessage(progress(first.requestId, "planning", 1));
    fake.emitMessage(result(second.requestId));

    const [firstResult, secondResult] = await Promise.all([first.promise, second.promise]);

    expect(firstResult).toEqual(result(first.requestId));
    expect(secondResult).toEqual(result(second.requestId));
    const diagnosticCodes = adapter.getDiagnostics().map((diagnostic) => diagnostic.code);
    expect(diagnosticCodes).toContain("out-of-order-progress");
    expect(diagnosticCodes).toContain("duplicate-response");
    expect(diagnosticCodes).toContain("stale-response");
    await adapter.dispose();
  });

  test("emits correlated monotone bounded progress for concurrent repeated requests", async () => {
    const compiled = compileScenario(minimalScenario);
    if (!compiled.ok) {
      throw new Error("The minimal Scenario fixture must compile.");
    }
    const progress: WorkerPlanningProgress[] = [];
    const adapter = createWorkerPlanningAdapter({
      workerFactory: createInProcessWorkerFactory(),
      onProgress: (value) => progress.push(value),
    });
    const first = adapter.plan(compiled.scenario, routeRequest);
    const second = adapter.plan(compiled.scenario, routeRequest);

    const [firstResult, secondResult] = await Promise.all([first.promise, second.promise]);

    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    expect(first.requestId).not.toBe(second.requestId);
    for (const requestId of [first.requestId, second.requestId]) {
      const requestProgress = progress.filter((value) => value.requestId === requestId);
      expect(requestProgress.length).toBeGreaterThan(0);
      expect(requestProgress.every((value) => value.totalWork > 0)).toBe(true);
      expect(requestProgress.every((value) => value.completedWork >= 0)).toBe(true);
      expect(
        requestProgress.every((value, index) => {
          const previous = requestProgress[index - 1];
          return previous === undefined || value.completedWork >= previous.completedWork;
        }),
      ).toBe(true);
      expect(requestProgress.at(-1)?.stage).toBe("completed");
    }
    expect(adapter.activeRequestIds()).toEqual([]);
    await adapter.dispose();
  });
});
