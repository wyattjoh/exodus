import {
  createWorkerPlanningAdapter,
  generateHierarchicalCluster,
  seconds,
  type ClusterRoutePlanningRequest,
  type WorkerPlanningPort,
  type WorkerPlanningProgress,
} from "../src/index";

const hierarchy = generateHierarchicalCluster({
  logicalPopulation: 100_000,
  seed: "worker-planning-demo",
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

const adapter = createWorkerPlanningAdapter({
  workerFactory: () =>
    new Worker(new URL("../src/worker-planning-worker.ts", import.meta.url), {
      type: "module",
    }) as unknown as WorkerPlanningPort,
});
let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
let responsiveTicks = 0;
const heartbeat = setInterval(() => {
  responsiveTicks += 1;
}, 1);
const progress: WorkerPlanningProgress[] = [];
const task = adapter.refine(hierarchy, request, {
  onProgress: (value) => {
    progress.push(value);
    if (value.stage === "refining" && cancellationTimer === undefined) {
      cancellationTimer = setTimeout(() => task.cancel(), 10);
    }
  },
});

try {
  const result = await task.promise;
  console.log(
    JSON.stringify({
      requestId: task.requestId,
      outcome: result.outcome,
      responsiveTicks,
      progressStages: progress.map((value) => value.stage),
    }),
  );
} finally {
  clearInterval(heartbeat);
  if (cancellationTimer !== undefined) {
    clearTimeout(cancellationTimer);
  }
  await adapter.dispose();
}
