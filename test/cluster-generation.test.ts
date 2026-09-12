import { describe, expect, test } from "bun:test";

import {
  createJourneyModel,
  generateClusterRegion,
  MAX_CLUSTER_MATERIALIZED_SYSTEM_COUNT,
  minimalScenario,
  type GeneratedClusterRegion,
  type ScenarioInput,
} from "../src/index";

function generatedRegion(seed: string, materializedSystemCount = 24): GeneratedClusterRegion {
  return generateClusterRegion({
    logicalPopulation: 1_000_000,
    materializedSystemCount,
    seed,
    generatorVersion: "globular-v1",
  });
}

function radialDistance(
  position: GeneratedClusterRegion["generatedSystems"][number]["positionAtEpoch"],
): number {
  return Math.hypot(position.x.value, position.y.value, position.z.value);
}

function endpointDistance(
  region: GeneratedClusterRegion,
  gateAId: string,
  gateBId: string,
): number {
  const gates = new Map(region.generatedGates.map((gate) => [gate.id, gate]));
  const gateA = gates.get(gateAId);
  const gateB = gates.get(gateBId);
  if (gateA === undefined || gateB === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.hypot(
    gateA.positionAtEpoch.x.value - gateB.positionAtEpoch.x.value,
    gateA.positionAtEpoch.y.value - gateB.positionAtEpoch.y.value,
    gateA.positionAtEpoch.z.value - gateB.positionAtEpoch.z.value,
  );
}

function truncatedPlummerCdf(dimensionlessRadius: number): number {
  return dimensionlessRadius ** 3 / (1 + dimensionlessRadius ** 2) ** 1.5;
}

describe("deterministic generated Cluster regions", () => {
  test("reproduces every generated identity and value for identical inputs", () => {
    const first = generatedRegion("alpha-seed");
    const second = generatedRegion("alpha-seed");

    expect(first.logicalPopulation).toBe(1_000_000);
    expect(first.materializedSystemCount).toBe(24);
    expect(first.generatedSystemIds).toEqual(second.generatedSystemIds);
    expect(first.generatedOrbitalAnchorIds).toEqual(second.generatedOrbitalAnchorIds);
    expect(first.generatedGateIds).toEqual(second.generatedGateIds);
    expect(first.generatedConnectionIds).toEqual(second.generatedConnectionIds);
    expect(first.scenario.systems).toEqual(second.scenario.systems);
    expect(first.scenario.orbitalAnchors).toEqual(second.scenario.orbitalAnchors);
    expect(first.scenario.gates).toEqual(second.scenario.gates);
    expect(first.scenario.gateConnections).toEqual(second.scenario.gateConnections);
    expect(first.statistics).toEqual(second.statistics);
    expect(first.topology).toEqual(second.topology);
  });

  test("changes generated identities when the seed changes", () => {
    const first = generatedRegion("alpha-seed");
    const second = generatedRegion("beta-seed");

    expect(first.generatedSystemIds).not.toEqual(second.generatedSystemIds);
    expect(first.generatedGateIds).not.toEqual(second.generatedGateIds);
    expect(first.scenario.systems[0]?.positionAtEpoch).not.toEqual(
      second.scenario.systems[0]?.positionAtEpoch,
    );
  });

  test("keeps seed type and exact string text distinct", () => {
    const numeric = generateClusterRegion({
      logicalPopulation: 32,
      materializedSystemCount: 8,
      seed: 1,
      generatorVersion: "globular-v1",
    });
    const string = generateClusterRegion({
      logicalPopulation: 32,
      materializedSystemCount: 8,
      seed: "1",
      generatorVersion: "globular-v1",
    });
    const whitespace = generateClusterRegion({
      logicalPopulation: 32,
      materializedSystemCount: 8,
      seed: " 1 ",
      generatorVersion: "globular-v1",
    });
    const whitespaceRepeat = generateClusterRegion({
      logicalPopulation: 32,
      materializedSystemCount: 8,
      seed: " 1 ",
      generatorVersion: "globular-v1",
    });

    expect(numeric.seedIdentity).toBe("number:1");
    expect(string.seedIdentity).toBe("string:1:1");
    expect(whitespace.seedIdentity).toBe("string:3: 1 ");
    expect(numeric.generatedSystemIds).not.toEqual(string.generatedSystemIds);
    expect(string.generatedSystemIds).not.toEqual(whitespace.generatedSystemIds);
    expect(whitespace.generatedSystemIds).toEqual(whitespaceRepeat.generatedSystemIds);
  });

  test("rejects a materialized sample larger than the logical population", () => {
    expect(() =>
      generateClusterRegion({
        logicalPopulation: 2,
        materializedSystemCount: 3,
        seed: "population-bound",
        generatorVersion: "globular-v1",
      }),
    ).toThrow(/cannot exceed logicalPopulation/);

    const boundary = generateClusterRegion({
      logicalPopulation: 2,
      materializedSystemCount: 2,
      seed: "population-bound",
      generatorVersion: "globular-v1",
    });
    expect(boundary.generatedSystems).toHaveLength(2);
    expect(boundary.route.ok).toBe(true);
  });

  test("uses a centrally concentrated radial profile and a finite topology", () => {
    const region = generatedRegion("profile-seed", 96);

    expect(region.statistics.radialProfile).toBe("truncated-plummer");
    expect(region.statistics.sampleCount).toBe(96);
    expect(region.statistics.fractionWithinHalfRadius).toBeGreaterThan(
      region.statistics.uniformSphereExpectedFractionWithinHalfRadius,
    );
    expect(region.statistics.fractionWithinHalfRadius).toBeCloseTo(
      region.statistics.expectedFractionWithinHalfRadius,
      1,
    );
    expect(region.statistics.expectedMeanRadius.value).toBeGreaterThan(0);
    expect(region.statistics.radialConcentrationTolerance).toBeGreaterThan(0);
    expect(region.statistics.meanRadius.value).toBeLessThan(
      region.statistics.regionRadius.value * 0.75,
    );
    expect(region.topology.isConnected).toBe(true);
    expect(region.topology.backboneConnectionCount).toBe(95);
    expect(region.topology.shortcutConnectionCount).toBeGreaterThan(0);
    expect(region.topology.shortcutConnectionCount).toBeLessThan(region.topology.connectionCount);
    expect(region.topology.localLinkFraction).toBeGreaterThan(0.8);
  });

  test("measures locality from generated endpoint distances", () => {
    const region = generatedRegion("locality-seed", 96);
    const distances = region.scenario.gateConnections
      .filter((connection) => region.generatedConnectionIds.includes(connection.id))
      .map((connection) => ({
        distance: endpointDistance(region, connection.gateAId, connection.gateBId),
        kind: region.topology.connectionKinds[connection.id],
      }));
    const localCount = distances.filter(
      ({ distance }) => distance <= region.topology.localDistanceThreshold.value,
    ).length;
    const shortcutDistances = distances
      .filter(({ kind }) => kind === "shortcut")
      .map(({ distance }) => distance);

    expect(region.topology.localDistanceThreshold.value).toBeCloseTo(
      region.regionRadius.value * 0.25,
      12,
    );
    expect(localCount / distances.length).toBe(region.topology.localLinkFraction);
    expect(localCount / distances.length).toBeGreaterThan(0.8);
    expect(shortcutDistances.length).toBeGreaterThan(0);
    expect(Math.min(...shortcutDistances)).toBeGreaterThan(region.regionRadius.value * 0.4);
    expect(region.topology.shortcutLinkFraction).toBeLessThan(0.1);
  });

  test("pairs every generated Gate exactly once and plans a complete timeline", () => {
    const region = generatedRegion("route-seed", 16);
    const generatedGateIds = new Set(region.generatedGateIds);
    const assignedGateIds = new Set<string>();

    for (const connection of region.scenario.gateConnections) {
      if (!generatedGateIds.has(connection.gateAId) && !generatedGateIds.has(connection.gateBId)) {
        continue;
      }
      expect(assignedGateIds.has(connection.gateAId)).toBe(false);
      expect(assignedGateIds.has(connection.gateBId)).toBe(false);
      assignedGateIds.add(connection.gateAId);
      assignedGateIds.add(connection.gateBId);
    }

    expect(assignedGateIds).toEqual(generatedGateIds);
    expect(region.route.ok).toBe(true);
    if (!region.route.ok) {
      return;
    }
    expect(region.plan).toBe(region.route.plan);
    expect(region.plan?.timeline.legs.length).toBeGreaterThan(0);
    expect(region.plan?.timeline.phases.length).toBeGreaterThan(0);
    expect(region.plan?.timeline.clocks.clusterCoordinateTime.value).toBeGreaterThan(0);
    expect(
      region.plan?.timeline.events.at(-1)?.clocks.agingDifference.value,
    ).toBeGreaterThanOrEqual(0);
  });

  test("rejects invalid canonical anchor and Gate references instead of rewriting them", () => {
    const invalidAnchorSystem = {
      ...minimalScenario,
      orbitalAnchors: minimalScenario.orbitalAnchors.map((anchor, index) =>
        index === 0 ? { ...anchor, systemId: "system:missing" } : anchor,
      ),
    } as unknown as ScenarioInput;
    expect(() =>
      generateClusterRegion({
        logicalPopulation: 32,
        materializedSystemCount: 8,
        seed: "invalid-anchor-system",
        generatorVersion: "globular-v1",
        canonicalScenario: invalidAnchorSystem,
      }),
    ).toThrow(/Orbital Anchor.*unknown System/);

    const invalidGateSystem = {
      ...minimalScenario,
      gates: minimalScenario.gates.map((gate, index) =>
        index === 0 ? { ...gate, systemId: "system:missing" } : gate,
      ),
    } as unknown as ScenarioInput;
    expect(() =>
      generateClusterRegion({
        logicalPopulation: 32,
        materializedSystemCount: 8,
        seed: "invalid-gate-system",
        generatorVersion: "globular-v1",
        canonicalScenario: invalidGateSystem,
      }),
    ).toThrow(/Gate.*unknown System/);

    const invalidGateAnchor = {
      ...minimalScenario,
      gates: minimalScenario.gates.map((gate, index) =>
        index === 0 ? { ...gate, orbitalAnchorId: "anchor:missing" } : gate,
      ),
    } as unknown as ScenarioInput;
    expect(() =>
      generateClusterRegion({
        logicalPopulation: 32,
        materializedSystemCount: 8,
        seed: "invalid-gate-anchor",
        generatorVersion: "globular-v1",
        canonicalScenario: invalidGateAnchor,
      }),
    ).toThrow(/Gate.*unknown Orbital Anchor/);
  });

  test("rejects generated IDs that collide with canonical/base IDs", () => {
    const collisionRegion = generatedRegion("deliberate-id-collision", 8);
    const terra = minimalScenario.systems.find((system) => system.id === "system:terra");
    const collidingId = collisionRegion.generatedSystemIds[0];
    expect(terra).toBeDefined();
    expect(collidingId).toBeDefined();
    if (terra === undefined || collidingId === undefined) {
      return;
    }
    const collisionBase = {
      ...minimalScenario,
      systems: [...minimalScenario.systems, { ...terra, id: collidingId }],
    } as unknown as ScenarioInput;

    expect(() =>
      generateClusterRegion({
        logicalPopulation: 32,
        materializedSystemCount: 8,
        seed: "deliberate-id-collision",
        generatorVersion: "globular-v1",
        canonicalScenario: collisionBase,
      }),
    ).toThrow(/collides with a canonical\/base entity ID/);
  });

  test("matches the truncated-Plummer concentration across a bounded multi-seed sample", () => {
    const materializedSystemCount = 256;
    const seeds = Array.from({ length: 12 }, (_, index) => `radial-sample-${index}`);
    const first = generatedRegion(seeds[0] ?? "radial-sample-0", materializedSystemCount);
    // The configured scale is 0.2R, so the truncated sample ends at x=5 and R/2 is x=2.5.
    const expectedFraction = truncatedPlummerCdf(2.5) / truncatedPlummerCdf(5);
    // This is the analytic first moment of the same truncated Plummer CDF, scaled by 0.2R.
    const firstMoment = 2 - 3 / Math.sqrt(26) + 1 / 26 ** 1.5;
    const expectedMeanFraction = (0.2 * firstMoment) / truncatedPlummerCdf(5);
    let withinHalf = 0;
    let totalSamples = 0;
    let totalRadius = 0;

    for (const seed of seeds) {
      const region = generatedRegion(seed, materializedSystemCount);
      for (const system of region.generatedSystems) {
        const distance = radialDistance(system.positionAtEpoch);
        withinHalf += distance <= region.regionRadius.value / 2 ? 1 : 0;
        totalRadius += distance / region.regionRadius.value;
        totalSamples += 1;
      }
    }

    const observedFraction = withinHalf / totalSamples;
    const concentrationTolerance =
      4 * Math.sqrt((expectedFraction * (1 - expectedFraction)) / totalSamples) + 1 / totalSamples;
    const observedMeanFraction = totalRadius / totalSamples;
    expect(first.statistics.expectedFractionWithinHalfRadius).toBeCloseTo(expectedFraction, 12);
    expect(Math.abs(observedFraction - expectedFraction)).toBeLessThanOrEqual(
      concentrationTolerance,
    );
    expect(Math.abs(observedMeanFraction - expectedMeanFraction)).toBeLessThan(0.03);
  });

  test("materializes the maximum bounded region with a repeatable immediate route", () => {
    const request = {
      logicalPopulation: MAX_CLUSTER_MATERIALIZED_SYSTEM_COUNT,
      materializedSystemCount: MAX_CLUSTER_MATERIALIZED_SYSTEM_COUNT,
      seed: "maximum-bound",
      generatorVersion: "globular-v1",
    } as const;
    const startedAt = performance.now();
    const first = generateClusterRegion(request);
    const second = generateClusterRegion(request);
    const elapsedMilliseconds = performance.now() - startedAt;

    expect(elapsedMilliseconds).toBeLessThan(30_000);
    expect(first.generatedSystems).toHaveLength(MAX_CLUSTER_MATERIALIZED_SYSTEM_COUNT);
    expect(first.generatedSystems).toEqual(second.generatedSystems);
    expect(first.generatedConnections).toEqual(second.generatedConnections);
    expect(first.topology).toEqual(second.topology);
    expect(first.topology.isConnected).toBe(true);
    expect(first.route.ok).toBe(true);
    expect(first.timeline?.phases.length).toBeGreaterThan(0);
  }, 60_000);

  test("fills missing canonical properties without replacing canonical identity", () => {
    const base = {
      ...minimalScenario,
      systems: minimalScenario.systems.map((system, index) =>
        index === 0
          ? {
              ...system,
              positionAtEpoch: undefined,
              properties: undefined,
              canonicalIdentity: {
                id: "canon:terra",
                designation: "CANON-TERRA",
                name: "Terra",
                provenance: {
                  kind: "provisional" as const,
                  note: "Bundled identity fixture",
                },
              },
            }
          : system,
      ),
    } as unknown as ScenarioInput;

    const region = generateClusterRegion({
      logicalPopulation: 64,
      materializedSystemCount: 12,
      seed: "canonical-seed",
      generatorVersion: "globular-v1",
      canonicalScenario: base,
    });
    const terra = region.scenario.index.systems.get("system:terra");

    expect(terra?.canonicalIdentity.id).toBe("canon:terra");
    expect(terra?.canonicalIdentity.designation).toBe("CANON-TERRA");
    expect(terra?.positionAtEpoch.x.unit).toBe("m");
    expect(terra?.properties.positionAtEpoch?.provenance.kind).toBe("generated");
    expect(region.scenario.index.systems.has("system:terra")).toBe(true);
    expect(region.scenario.index.gates.has("gate:terra")).toBe(true);
    expect(region.route.ok).toBe(true);
  });

  test("uses a provisional 1g profile when the canonical base is silent", () => {
    const region = generatedRegion("profile-default", 8);
    const profile = region.scenario.shipProfiles.find(
      (candidate) => candidate.id === "ship:generated-survey",
    );

    expect(profile).toBeDefined();
    expect(profile?.acceleration.value).toBeCloseTo(9.80665, 12);
    expect(profile?.brakingAcceleration.value).toBeCloseTo(9.80665, 12);
    expect(profile?.provenance.kind).toBe("provisional");
    expect(profile?.properties.acceleration?.provenance.kind).toBe("provisional");
  });

  test("exposes generation through the framework-independent Journey Model", () => {
    const model = createJourneyModel();
    const region = model.generateClusterRegion({
      population: 16,
      materializedSystemCount: 8,
      seed: "factory-seed",
      generatorVersion: "globular-v1",
    });

    expect(region.ok).toBe(true);
    expect(region.route.ok).toBe(true);
    expect(region.timeline?.legs.length).toBeGreaterThan(0);
  });

  test("preserves bundled canonical identity across seeds", () => {
    const first = generateClusterRegion({
      logicalPopulation: 32,
      materializedSystemCount: 8,
      seed: "one",
      generatorVersion: "globular-v1",
      canonicalScenario: minimalScenario,
    });
    const second = generateClusterRegion({
      logicalPopulation: 32,
      materializedSystemCount: 8,
      seed: "two",
      generatorVersion: "globular-v1",
      canonicalScenario: minimalScenario,
    });

    expect(first.scenario.index.systems.get("system:terra")?.canonicalIdentity).toEqual(
      second.scenario.index.systems.get("system:terra")?.canonicalIdentity,
    );
    expect(first.scenario.index.systems.get("system:terra")?.canonicalIdentity.id).toBe(
      "system:terra",
    );
    expect(first.generatedSystemIds).not.toEqual(second.generatedSystemIds);
  });
});
