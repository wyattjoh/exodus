import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CLUSTER_ROUTE_HORIZON,
  generatedProvenance,
  generateHierarchicalCluster,
  materializeClusterRegion,
  minimalScenario,
  metersPerSecondSquared,
  planClusterRoute,
  rangeClaim,
  seconds,
  type ClusterRoutePlanningRequest,
  type HierarchicalClusterRegion,
} from "../src/index";

function generatedCluster(seed = "bounded-cluster"): HierarchicalClusterRegion {
  return generateHierarchicalCluster({
    logicalPopulation: 10_000_000,
    seed,
    generatorVersion: "globular-v1",
  });
}

function routeRequest(region: HierarchicalClusterRegion, refinementDepth: number) {
  return {
    departureGateId: region.defaultDepartureGateId,
    destinationGateId: region.defaultDestinationGateId,
    shipProfileId: region.defaultShipProfileId,
    departureCoordinateTime: seconds(0),
    dwells: [],
    latestArrivalCoordinateTime: DEFAULT_CLUSTER_ROUTE_HORIZON,
    maximumStrategicWait: seconds(0),
    refinementDepth,
    maxMaterializedSystems: 256,
    maxCandidateRoutes: 16,
  };
}

describe("bounded hierarchical Cluster routes", () => {
  test("describes million-System populations without materializing the population", () => {
    const region = generatedCluster();

    expect(region.logicalPopulation).toBe(10_000_000);
    expect(region.root.logicalSystemCount).toBe(10_000_000);
    expect(region.root.children.length).toBeGreaterThan(1);
    expect(region.materializedSystemCount).toBe(0);

    const child = region.root.children[0];
    if (child === undefined) {
      throw new Error("Expected a deterministic root child region.");
    }
    const materialized = materializeClusterRegion(region, {
      regionId: child.id,
      materializedSystemCount: 32,
      logicalSystemIndices: undefined,
      routeRequest: undefined,
    });
    const repeated = materializeClusterRegion(region, {
      regionId: child.id,
      materializedSystemCount: 32,
      logicalSystemIndices: undefined,
      routeRequest: undefined,
    });

    expect(materialized.generatedSystems).toHaveLength(32);
    expect(materialized.generatedSystems).toEqual(repeated.generatedSystems);
    expect(materialized.generatedSystemIds).toEqual(repeated.generatedSystemIds);
    expect(materialized.generatedSystemIds).not.toHaveLength(10_000_000);
  });

  test("returns reproducible bounded route bounds and preserves exact endpoints", () => {
    const region = generatedCluster();
    const shallow = planClusterRoute(region, routeRequest(region, 0));
    const deep = planClusterRoute(region, routeRequest(region, 3));
    const repeated = planClusterRoute(region, routeRequest(region, 3));

    expect(shallow.ok).toBe(true);
    expect(deep.ok).toBe(true);
    expect(deep).toEqual(repeated);
    if (!shallow.ok || !deep.ok) {
      return;
    }

    expect(deep.plan.departureGateId).toBe(region.defaultDepartureGateId);
    expect(deep.plan.destinationGateId).toBe(region.defaultDestinationGateId);
    expect(deep.plan.gateIds[0]).toBe(region.defaultDepartureGateId);
    expect(deep.plan.gateIds.at(-1)).toBe(region.defaultDestinationGateId);
    expect(deep.refinementQuality).toBe("hierarchical-bounded");
    expect(deep.globallyOptimal).toBe(false);
    expect(deep.optimality).toBe("best-known-upper-bound");
    expect(deep.earliestArrivalLowerBound.value).toBeLessThanOrEqual(
      deep.bestKnownUpperBound.value,
    );
    expect(deep.bounds.lower.value).toBe(deep.earliestArrivalLowerBound.value);
    expect(deep.bounds.upper.value).toBeGreaterThanOrEqual(deep.bestKnownUpperBound.value);
    expect(deep.search.refinementDepth).toBe(3);
    expect(deep.search.completedRefinementDepth).toBe(3);
    expect(deep.search.candidateGraphEdgeCount).toBeGreaterThan(0);
    expect(deep.search.materializedSystemCount).toBeLessThanOrEqual(256);
    expect(deep.plan.arrivalCoordinateTime.value).toBeLessThanOrEqual(
      shallow.plan.arrivalCoordinateTime.value,
    );
  });

  test("retains the baseline upper bound under a tight deeper refinement budget", () => {
    const region = generatedCluster("cluster-route-benchmark-6");
    const request: ClusterRoutePlanningRequest = {
      ...routeRequest(region, 0),
      refinementDepth: 0,
      maxCandidateRoutes: 1,
      searchBudget: {
        maxCandidateRoutes: 1,
        maxSearchStates: 10_000,
      },
    };
    const deeperRequest: ClusterRoutePlanningRequest = {
      ...request,
      refinementDepth: 3,
    };
    const shallow = planClusterRoute(region, request);
    const deep = planClusterRoute(region, deeperRequest);

    expect(shallow.ok).toBe(true);
    expect(deep.ok).toBe(true);
    if (!shallow.ok || !deep.ok) {
      return;
    }
    expect(deep.bestKnownUpperBound.value).toBeLessThanOrEqual(shallow.bestKnownUpperBound.value);
    expect(deep.plan.arrivalCoordinateTime.value).toBe(shallow.plan.arrivalCoordinateTime.value);
    expect(deep.refinement.completedDepth).toBe(0);
    expect(deep.refinement.searchExhausted).toBe(true);
    expect(deep.search.candidateRoutesEvaluated).toBeLessThanOrEqual(1);
    expect(deep.search.candidateRouteKeys.length).toBeLessThanOrEqual(1);
  });

  test("rejects a syntactically valid but nonexistent hierarchy edge", () => {
    const region = generatedCluster();
    const edgeSeparator = region.defaultDepartureGateId.lastIndexOf(":h-");
    if (edgeSeparator < 0) {
      throw new Error("Expected a hierarchical departure Gate identity.");
    }
    const forgedDepartureGateId = `${region.defaultDepartureGateId.slice(0, edgeSeparator)}:h-1-999:a`;
    const result = planClusterRoute(region, {
      ...routeRequest(region, 0),
      departureGateId: forgedDepartureGateId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.outcome).toBe("invalid");
    expect(result.search).toBeUndefined();
    expect(result.issues.some((issue) => issue.code === "unknown-gate")).toBe(true);
  });

  test("rejects a syntactically valid but unmaterialized region edge", () => {
    const region = generatedCluster();
    const edgeSeparator = region.defaultDepartureGateId.lastIndexOf(":h-");
    if (edgeSeparator < 0) {
      throw new Error("Expected a hierarchical departure Gate identity.");
    }
    const forgedDepartureGateId = `${region.defaultDepartureGateId.slice(0, edgeSeparator)}:region-1-999:a`;
    const result = planClusterRoute(region, {
      ...routeRequest(region, 0),
      departureGateId: forgedDepartureGateId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.outcome).toBe("invalid");
    expect(result.search).toBeUndefined();
    expect(result.issues.some((issue) => issue.code === "unknown-gate")).toBe(true);
  });

  test("routes exact canonical endpoints through the compiled base Scenario", () => {
    const region = generateHierarchicalCluster({
      logicalPopulation: 10_000,
      seed: "canonical-endpoints",
      generatorVersion: "globular-v1",
      canonicalScenario: minimalScenario,
    });
    const request: ClusterRoutePlanningRequest = {
      departureGateId: "gate:terra",
      destinationGateId: "gate:selene",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
      dwells: [],
      latestArrivalCoordinateTime: DEFAULT_CLUSTER_ROUTE_HORIZON,
      maximumStrategicWait: seconds(0),
      refinementDepth: 0,
      maxMaterializedSystems: 256,
      maxCandidateRoutes: 16,
    };
    const result = planClusterRoute(region, request);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.plan.departureGateId).toBe("gate:terra");
    expect(result.plan.destinationGateId).toBe("gate:selene");
    expect(result.plan.gateIds).toEqual(["gate:terra", "gate:selene"]);
    expect(result.plan.connectionIds).toEqual(["connection:terra-selene"]);

    const mixed = planClusterRoute(region, {
      ...request,
      destinationGateId: region.defaultDestinationGateId,
    });
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) {
      expect(mixed.outcome).toBe("invalid");
      expect(mixed.issues[0]?.message).toContain("Mixed canonical");
    }
  });

  test("accepts materialized endpoint Gates and preserves Provenance filtering", () => {
    const region = generatedCluster();
    const child = region.root.children[0];
    if (child === undefined) {
      throw new Error("Expected a deterministic child region.");
    }
    const materialized = materializeClusterRegion(region, {
      regionId: child.id,
      materializedSystemCount: 32,
    });
    const request = {
      departureGateId: materialized.routeRequest.departureGateId,
      destinationGateId: materialized.routeRequest.destinationGateId,
      shipProfileId: region.defaultShipProfileId,
      departureCoordinateTime: { unit: "s" as const, value: 0 },
      dwells: [],
      latestArrivalCoordinateTime: DEFAULT_CLUSTER_ROUTE_HORIZON,
      maximumStrategicWait: { unit: "s" as const, value: 0 },
      refinementDepth: 0,
      maxMaterializedSystems: 256,
      maxCandidateRoutes: 16,
    };
    const selected = planClusterRoute(region, request);

    expect(selected.ok).toBe(true);
    if (!selected.ok) {
      return;
    }
    expect(selected.plan.departureGateId).toBe(request.departureGateId);
    expect(selected.plan.destinationGateId).toBe(request.destinationGateId);
    expect(selected.plan.gateIds[0]).toBe(request.departureGateId);
    expect(selected.plan.gateIds.at(-1)).toBe(request.destinationGateId);

    const canonicalOnly = planClusterRoute(region, {
      ...request,
      provenanceFilter: {
        allowedKinds: ["novel"],
        excludedKinds: undefined,
        allowedAuthorities: undefined,
        minimumAuthority: undefined,
      },
    });
    expect(canonicalOnly.ok).toBe(false);
    if (!canonicalOnly.ok) {
      expect(canonicalOnly.outcome).toBe("invalid");
      expect(canonicalOnly.issues.some((issue) => issue.code === "provenance-filtered")).toBe(true);
    }
  });

  test("propagates route uncertainty from a canonical Ship Profile", () => {
    const profile = minimalScenario.shipProfiles[0];
    if (profile === undefined) {
      throw new Error("Expected the minimal Ship Profile.");
    }
    const provenance = generatedProvenance("bounded-route-uncertainty@1");
    const uncertainProfile = {
      ...profile,
      properties: {
        acceleration: {
          provenance,
          claim: rangeClaim({
            lower: metersPerSecondSquared(9),
            upper: metersPerSecondSquared(11),
            nominal: profile.acceleration,
            provenance,
          }),
        },
      },
    };
    const hierarchy = generateHierarchicalCluster({
      logicalPopulation: 10_000,
      seed: "bounded-uncertainty",
      generatorVersion: "globular-v1",
      canonicalScenario: {
        ...minimalScenario,
        shipProfiles: [uncertainProfile],
      },
    });
    const result = planClusterRoute(hierarchy, {
      ...routeRequest(hierarchy, 1),
      shipProfileId: hierarchy.defaultShipProfileId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.plan.uncertainty.hasUncertainty).toBe(true);
    expect(result.plan.uncertainty.propertyPaths).toContain(
      `${hierarchy.defaultShipProfileId}.acceleration`,
    );
    expect(result.conservativeUpperBound.value).toBeGreaterThanOrEqual(
      result.bestKnownUpperBound.value,
    );
  });
});
