import {
  DEFAULT_CLUSTER_ROUTE_HORIZON,
  generateHierarchicalCluster,
  materializeClusterRegion,
  planClusterRoute,
  type HierarchicalClusterRegion,
} from "../src/index";

const POPULATIONS = [100_000, 1_000_000, 10_000_000] as const;
const MATERIALIZED_SYSTEM_COUNT = 64;
const ROUTE_DEPTHS = [0, 3, 6] as const;
const SEED = "cluster-route-benchmark-6";
const GENERATOR_VERSION = "globular-v1";

function collectNodeCount(region: HierarchicalClusterRegion): number {
  let count = 0;
  const pending = [region.root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    count += 1;
    pending.push(...node.children);
  }
  return count;
}

function memoryBytes(): number {
  return process.memoryUsage().rss;
}

function collectRouteRow(region: HierarchicalClusterRegion, refinementDepth: number) {
  const startedAt = performance.now();
  const result = planClusterRoute(region, {
    departureGateId: region.defaultDepartureGateId,
    destinationGateId: region.defaultDestinationGateId,
    shipProfileId: region.defaultShipProfileId,
    departureCoordinateTime: { unit: "s", value: 0 },
    dwells: [],
    latestArrivalCoordinateTime: DEFAULT_CLUSTER_ROUTE_HORIZON,
    maximumStrategicWait: { unit: "s", value: 0 },
    refinementDepth,
    maxMaterializedSystems: 256,
    maxCandidateRoutes: 16,
  });
  const latencyMilliseconds = performance.now() - startedAt;
  if (!result.ok) {
    return {
      refinementDepth,
      latencyMilliseconds,
      outcome: result.outcome,
      materializedSystemCount: result.search?.materializedSystemCount ?? 0,
      candidateGraphEdgeCount: result.search?.candidateGraphEdgeCount ?? 0,
      addedRefinementEdgeCount: result.search?.addedRefinementEdgeCount ?? 0,
    };
  }
  return {
    refinementDepth,
    latencyMilliseconds,
    outcome: result.outcome,
    materializedSystemCount: result.search.materializedSystemCount,
    lowerBoundSeconds: result.earliestArrivalLowerBound.value,
    upperBoundSeconds: result.bestKnownUpperBound.value,
    conservativeUpperBoundSeconds: result.conservativeUpperBound.value,
    refinementScore: result.refinementScore,
    candidateGraphEdgeCount: result.search.candidateGraphEdgeCount,
    addedRefinementEdgeCount: result.search.addedRefinementEdgeCount,
    candidateRoutesEvaluated: result.search.candidateRoutesEvaluated,
  };
}

const rows = [];
for (const logicalPopulation of POPULATIONS) {
  if (typeof Bun.gc === "function") {
    Bun.gc(true);
  }
  const beforeHierarchyBytes = memoryBytes();
  const hierarchyStartedAt = performance.now();
  const hierarchy = generateHierarchicalCluster({
    logicalPopulation,
    seed: SEED,
    generatorVersion: GENERATOR_VERSION,
  });
  const hierarchyLatencyMilliseconds = performance.now() - hierarchyStartedAt;
  const afterHierarchyBytes = memoryBytes();

  if (typeof Bun.gc === "function") {
    Bun.gc(true);
  }
  const materializationStartedAt = performance.now();
  const materialized = materializeClusterRegion(hierarchy, {
    materializedSystemCount: MATERIALIZED_SYSTEM_COUNT,
  });
  const materializationLatencyMilliseconds = performance.now() - materializationStartedAt;
  const afterMaterializationBytes = memoryBytes();

  rows.push({
    logicalPopulation,
    hierarchyNodeCount: collectNodeCount(hierarchy),
    hierarchyDepth: hierarchy.maxDepth,
    hierarchyLatencyMilliseconds,
    hierarchyRssDeltaBytes: Math.max(0, afterHierarchyBytes - beforeHierarchyBytes),
    materializedSystemCount: materialized.generatedSystems.length,
    materializationLatencyMilliseconds,
    materializationRssDeltaBytes: Math.max(0, afterMaterializationBytes - afterHierarchyBytes),
    routes: ROUTE_DEPTHS.map((refinementDepth) => collectRouteRow(hierarchy, refinementDepth)),
  });
}

console.log(
  JSON.stringify(
    {
      benchmark: "deterministic-hierarchical-cluster-route",
      seed: SEED,
      generatorVersion: GENERATOR_VERSION,
      materializedSystemCount: MATERIALIZED_SYSTEM_COUNT,
      routeDepths: ROUTE_DEPTHS,
      note: "RSS deltas are process-level observations; latency and memory are target-machine evidence, not universal limits.",
      rows,
    },
    null,
    2,
  ),
);
