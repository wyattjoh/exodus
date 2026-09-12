import { describe, expect, test } from "bun:test";

import {
  compileScenario,
  createJourneyModel,
  meters,
  metersPerSecond,
  metersPerSecondSquared,
  multiLegJourneyScenario,
  planJourney,
  seconds,
  simulateMultiLegJourney,
  vector3,
  type JourneyLeg,
  type ScenarioInput,
} from "../src/index";

function requireScenario(input: unknown) {
  const result = compileScenario(input);
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }

  return result.scenario;
}

const zeroVelocity = vector3(metersPerSecond(0), metersPerSecond(0), metersPerSecond(0));
const shipProfile = {
  id: "ship:route",
  designation: "SHIP-ROUTE",
  name: "Route Test Ship",
  acceleration: metersPerSecondSquared(10),
  brakingAcceleration: metersPerSecondSquared(10),
  maximumSublightSpeed: metersPerSecond(0.2 * 299_792_458),
  hasZpzGenerator: true,
} as const;

function gate(id: string, systemId: string, x: number, y: number): ScenarioInput["gates"][number] {
  const position = vector3(meters(x), meters(y), meters(0));
  return {
    id,
    designation: id.toUpperCase().replaceAll(":", "-"),
    name: id,
    systemId,
    orbitalAnchorId: `anchor:${systemId.slice("system:".length)}`,
    positionAtEpoch: position,
    velocityAtEpoch: zeroVelocity,
    orbitalElements: undefined,
    orbit: undefined,
  };
}

function simulateExpectedRoute(
  scenario: ReturnType<typeof requireScenario>,
  legs: readonly JourneyLeg[],
) {
  const result = simulateMultiLegJourney(scenario, {
    kind: "journey",
    departureGateId: "gate:start",
    destinationGateId: "gate:destination",
    shipProfileId: "ship:route",
    departureCoordinateTime: seconds(0),
    legs,
  });
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }
  return result.timeline;
}

function routeScenario(): ScenarioInput {
  const systemDefinitions = [
    ["system:start", 0, 0],
    ["system:detour", 0, 1e17],
    ["system:branch-one", 3.3333333333333332e16, 3.3333333333333332e16],
    ["system:branch-two", 6.6666666666666664e16, 6.6666666666666664e16],
    ["system:destination", 1e17, 1e17],
  ] as const;
  const systems = systemDefinitions.map(([id, x, y]) => ({
    id,
    designation: id.toUpperCase().replaceAll(":", "-"),
    name: id,
    positionAtEpoch: vector3(meters(x), meters(y), meters(0)),
    velocityAtEpoch: zeroVelocity,
  }));
  const orbitalAnchors = systemDefinitions.map(([systemId, x, y]) => ({
    id: `anchor:${systemId.slice("system:".length)}`,
    designation: `${systemId.toUpperCase().replaceAll(":", "-")}-A`,
    name: `${systemId} Primary`,
    kind: "star" as const,
    systemId,
    parentId: undefined,
    positionAtEpoch: vector3(meters(x), meters(y), meters(0)),
    velocityAtEpoch: zeroVelocity,
    orbitalElements: undefined,
    orbit: undefined,
  }));
  const gates = [
    gate("gate:start", "system:start", 0, 0),
    gate("gate:branch", "system:start", 1e9, 0),
    gate("gate:detour-entry", "system:detour", 0, 1e17),
    gate("gate:detour-exit", "system:detour", 0, 1e17 + 1e9),
    gate(
      "gate:branch-one-entry",
      "system:branch-one",
      3.3333333333333332e16,
      3.3333333333333332e16,
    ),
    gate("gate:branch-one-exit", "system:branch-one", 3.3333333333333332e16, 3.333333433333333e16),
    gate(
      "gate:branch-two-entry",
      "system:branch-two",
      6.6666666666666664e16,
      6.6666666666666664e16,
    ),
    gate("gate:branch-two-exit", "system:branch-two", 6.6666666666666664e16, 6.666666766666666e16),
    gate("gate:destination-entry", "system:destination", 1e17, 1e17 - 1e9),
    gate("gate:destination", "system:destination", 1e17, 1e17),
  ];
  const connection = (id: string, gateAId: string, gateBId: string) => ({
    id,
    designation: id.toUpperCase().replaceAll(":", "-"),
    name: id,
    gateAId,
    gateBId,
  });

  return {
    id: "scenario:route",
    designation: "SCN-ROUTE",
    name: "Explicit Route Network",
    epoch: { label: "T+0", coordinateTime: seconds(0) },
    systems,
    orbitalAnchors,
    gates,
    gateConnections: [
      connection("connection:start-detour", "gate:start", "gate:detour-entry"),
      connection("connection:detour-destination", "gate:detour-exit", "gate:destination"),
      connection("connection:branch-one", "gate:branch", "gate:branch-one-entry"),
      connection("connection:branch-two", "gate:branch-one-exit", "gate:branch-two-entry"),
      connection("connection:branch-destination", "gate:branch-two-exit", "gate:destination-entry"),
    ],
    shipProfiles: [shipProfile],
  };
}

describe("explicit Gate-network route planning", () => {
  test("expands selected Dwells and required in-system Transfers through multiple Gates", () => {
    const model = createJourneyModel();
    const scenario = requireScenario(multiLegJourneyScenario);
    const result = model.planJourney(scenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:helios",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
      dwells: [{ gateId: "gate:aurora-entry", duration: seconds(2 * 86_400) }],
      maxAlternatives: undefined,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.plan.gateIds).toEqual([
      "gate:terra",
      "gate:aurora-entry",
      "gate:aurora-exit",
      "gate:helios",
    ]);
    expect(result.plan.connectionIds).toEqual([
      "connection:terra-aurora-entry",
      "connection:aurora-exit-helios",
    ]);
    expect(result.plan.gateLegCount).toBe(2);
    expect(result.plan.timeline.legs.map((leg) => leg.kind)).toEqual([
      "interstellar-cruise",
      "dwell",
      "in-system-transfer",
      "interstellar-cruise",
    ]);
    expect(result.plan.timeline.clocks.clusterCoordinateTime.value).toBe(
      result.plan.clusterCoordinateTime.value,
    );
    expect(result.plan.timeline.clocks.shipProperTime.value).toBe(result.plan.shipProperTime.value);
    expect(result.plan.timeline.clocks.agingDifference.value).toBe(
      result.plan.agingDifference.value,
    );
    expect(result.alternatives).toHaveLength(0);
  });

  test("matches an independent public-seam oracle for the earliest nominal Cluster time", () => {
    const scenario = requireScenario(routeScenario());
    const directTimeline = simulateExpectedRoute(scenario, [
      { kind: "interstellar-cruise", destinationGateId: "gate:detour-entry" },
      { kind: "in-system-transfer", destinationGateId: "gate:detour-exit" },
      { kind: "interstellar-cruise", destinationGateId: "gate:destination" },
    ]);
    const branchTimeline = simulateExpectedRoute(scenario, [
      { kind: "in-system-transfer", destinationGateId: "gate:branch" },
      { kind: "interstellar-cruise", destinationGateId: "gate:branch-one-entry" },
      { kind: "in-system-transfer", destinationGateId: "gate:branch-one-exit" },
      { kind: "interstellar-cruise", destinationGateId: "gate:branch-two-entry" },
      { kind: "in-system-transfer", destinationGateId: "gate:branch-two-exit" },
      { kind: "interstellar-cruise", destinationGateId: "gate:destination-entry" },
      { kind: "in-system-transfer", destinationGateId: "gate:destination" },
    ]);
    const oracleRoutes = [
      {
        gateIds: ["gate:start", "gate:detour-entry", "gate:detour-exit", "gate:destination"],
        connectionIds: ["connection:start-detour", "connection:detour-destination"],
        timeline: directTimeline,
      },
      {
        gateIds: [
          "gate:start",
          "gate:branch",
          "gate:branch-one-entry",
          "gate:branch-one-exit",
          "gate:branch-two-entry",
          "gate:branch-two-exit",
          "gate:destination-entry",
          "gate:destination",
        ],
        connectionIds: [
          "connection:branch-one",
          "connection:branch-two",
          "connection:branch-destination",
        ],
        timeline: branchTimeline,
      },
    ];
    const expectedWinner = oracleRoutes.reduce((earliest, candidate) =>
      Number(candidate.timeline.clocks.clusterCoordinateTime.value) <
      Number(earliest.timeline.clocks.clusterCoordinateTime.value)
        ? candidate
        : earliest,
    );

    const result = planJourney(scenario, {
      departureGateId: "gate:start",
      destinationGateId: "gate:destination",
      shipProfileId: "ship:route",
      departureCoordinateTime: seconds(0),
      dwells: [],
      maxAlternatives: undefined,
      searchBudget: { maxCandidateRoutes: 10, maxSearchStates: 100 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.search.candidateRoutesEvaluated).toBe(2);
    expect(result.alternatives).toHaveLength(1);
    expect(result.plan.gateIds).toEqual(expectedWinner.gateIds);
    expect(result.plan.connectionIds).toEqual(expectedWinner.connectionIds);
    expect(result.plan.gateLegCount).toBe(expectedWinner.connectionIds.length);
    expect(Number(result.plan.clusterCoordinateTime.value)).toBeCloseTo(
      Number(expectedWinner.timeline.clocks.clusterCoordinateTime.value),
      6,
    );
    expect(Number(result.plan.shipProperTime.value)).toBeGreaterThan(0);
    expect(Number(result.plan.agingDifference.value)).toBeGreaterThan(0);
    const alternative = result.alternatives[0];
    if (alternative === undefined) {
      throw new Error("Expected the direct itinerary as a valid alternative.");
    }
    const otherOracle = oracleRoutes.find((route) => route !== expectedWinner);
    if (otherOracle === undefined) {
      throw new Error("Expected an independent oracle alternative.");
    }
    expect(alternative.gateIds).toEqual(otherOracle.gateIds);
    expect(alternative.connectionIds).toEqual(otherOracle.connectionIds);
    expect(Number(alternative.clusterCoordinateTime.value)).toBeCloseTo(
      Number(otherOracle.timeline.clocks.clusterCoordinateTime.value),
      6,
    );
    expect(alternative.gateLegCount).toBe(otherOracle.connectionIds.length);
  });

  test("returns incomplete without a partial plan when the finite search budget is exhausted", () => {
    const scenario = requireScenario(routeScenario());
    const result = planJourney(scenario, {
      departureGateId: "gate:start",
      destinationGateId: "gate:destination",
      shipProfileId: "ship:route",
      departureCoordinateTime: seconds(0),
      dwells: [],
      maxAlternatives: 0,
      searchBudget: { maxCandidateRoutes: 1, maxSearchStates: 100 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.outcome).toBe("incomplete");
    expect(result.plan).toBeUndefined();
    expect(result.bestPlan).toBeUndefined();
    expect(result.alternatives).toEqual([]);
    expect(result.search?.candidateRoutesEvaluated).toBe(1);
    expect(result.issues.some((issue) => issue.code === "search-budget-exhausted")).toBe(true);
  });

  test("supports a zero-leg Journey when both exact endpoints are the same Gate", () => {
    const scenario = requireScenario(routeScenario());
    const result = planJourney(scenario, {
      departureGateId: "gate:start",
      destinationGateId: "gate:start",
      shipProfileId: "ship:route",
      departureCoordinateTime: seconds(0),
      dwells: [],
      maxAlternatives: undefined,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.plan.gateIds).toEqual(["gate:start"]);
    expect(result.plan.connectionIds).toEqual([]);
    expect(result.plan.gateLegCount).toBe(0);
    expect(result.plan.timeline.legs.map((leg) => leg.kind)).toEqual(["dwell"]);
    expect(Number(result.plan.timeline.clocks.clusterCoordinateTime.value)).toBe(0);
  });

  test("returns structured disconnected and invalid outcomes", () => {
    const scenarioInput = routeScenario();
    const isolatedSystemA = {
      id: "system:isolated-a",
      designation: "SYSTEM-ISOLATED-A",
      name: "Isolated A",
      positionAtEpoch: vector3(meters(2e17), meters(0), meters(0)),
      velocityAtEpoch: zeroVelocity,
    } as const;
    const isolatedSystemB = {
      id: "system:isolated-b",
      designation: "SYSTEM-ISOLATED-B",
      name: "Isolated B",
      positionAtEpoch: vector3(meters(2e17 + 1e9), meters(0), meters(0)),
      velocityAtEpoch: zeroVelocity,
    } as const;
    const isolatedAnchorA = {
      id: "anchor:isolated-a",
      designation: "ANCHOR-ISOLATED-A",
      name: "Isolated A Primary",
      kind: "star" as const,
      systemId: isolatedSystemA.id,
      parentId: undefined,
      positionAtEpoch: isolatedSystemA.positionAtEpoch,
      velocityAtEpoch: zeroVelocity,
      orbitalElements: undefined,
      orbit: undefined,
    } as const;
    const isolatedAnchorB = {
      id: "anchor:isolated-b",
      designation: "ANCHOR-ISOLATED-B",
      name: "Isolated B Primary",
      kind: "star" as const,
      systemId: isolatedSystemB.id,
      parentId: undefined,
      positionAtEpoch: isolatedSystemB.positionAtEpoch,
      velocityAtEpoch: zeroVelocity,
      orbitalElements: undefined,
      orbit: undefined,
    } as const;
    const isolatedGateA = gate("gate:isolated-a", isolatedSystemA.id, 2e17, 0);
    const isolatedGateB = gate("gate:isolated-b", isolatedSystemB.id, 2e17 + 1e9, 0);
    const disconnectedScenario = requireScenario({
      ...scenarioInput,
      systems: [...scenarioInput.systems, isolatedSystemA, isolatedSystemB],
      orbitalAnchors: [...scenarioInput.orbitalAnchors, isolatedAnchorA, isolatedAnchorB],
      gates: [...scenarioInput.gates, isolatedGateA, isolatedGateB],
      gateConnections: [
        ...scenarioInput.gateConnections,
        {
          id: "connection:isolated",
          designation: "CONNECTION-ISOLATED",
          name: "Isolated Connection",
          gateAId: isolatedGateA.id,
          gateBId: isolatedGateB.id,
        },
      ],
    });

    const disconnected = planJourney(disconnectedScenario, {
      departureGateId: "gate:start",
      destinationGateId: "gate:isolated-a",
      shipProfileId: "ship:route",
      departureCoordinateTime: seconds(0),
      dwells: [],
      maxAlternatives: undefined,
    });
    expect(disconnected.ok).toBe(false);
    if (disconnected.ok) {
      return;
    }
    expect(disconnected.outcome).toBe("disconnected");
    expect(disconnected.issues.some((issue) => issue.code === "disconnected")).toBe(true);

    const invalid = planJourney(disconnectedScenario, {
      departureGateId: "gate:missing",
      destinationGateId: "gate:isolated-a",
      shipProfileId: "ship:route",
      departureCoordinateTime: seconds(0),
      dwells: [],
      maxAlternatives: undefined,
    });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) {
      return;
    }
    expect(invalid.outcome).toBe("invalid");
    expect(invalid.issues.some((issue) => issue.code === "unknown-gate")).toBe(true);
  });
});
