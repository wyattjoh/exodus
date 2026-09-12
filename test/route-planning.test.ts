import { describe, expect, test } from "bun:test";

import {
  compileScenario,
  createJourneyModel,
  generatedProvenance,
  meters,
  metersPerSecond,
  metersPerSecondSquared,
  minimalScenario,
  multiLegJourneyScenario,
  planJourney,
  rangeClaim,
  seconds,
  simulateMultiLegJourney,
  SPEED_OF_LIGHT,
  vector3,
  type JourneyDwellTimeline,
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

function movingDepartureScenario(): ScenarioInput {
  return {
    ...minimalScenario,
    gates: minimalScenario.gates.map((candidate) =>
      candidate.id === "gate:terra"
        ? {
            ...candidate,
            velocityAtEpoch: vector3(
              metersPerSecond(0.9995 * SPEED_OF_LIGHT.value),
              metersPerSecond(0),
              metersPerSecond(0),
            ),
          }
        : candidate,
    ),
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
      latestArrivalCoordinateTime: seconds(1e16),
      maximumStrategicWait: seconds(0),
      provenanceFilter: undefined,
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
      latestArrivalCoordinateTime: seconds(1e16),
      maximumStrategicWait: seconds(0),
      provenanceFilter: undefined,
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
      throw new Error("Expected the direct Route Plan as a valid alternative.");
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
      latestArrivalCoordinateTime: seconds(1e16),
      maximumStrategicWait: seconds(0),
      provenanceFilter: undefined,
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
      latestArrivalCoordinateTime: seconds(1e16),
      maximumStrategicWait: seconds(0),
      provenanceFilter: undefined,
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

  test("requires a finite latest-arrival or strategic-wait horizon", () => {
    const scenario = requireScenario(routeScenario());
    const result = planJourney(scenario, {
      departureGateId: "gate:start",
      destinationGateId: "gate:destination",
      shipProfileId: "ship:route",
      departureCoordinateTime: seconds(0),
      dwells: [],
      maxAlternatives: undefined,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.outcome).toBe("invalid");
    expect(result.issues.some((issue) => issue.code === "missing-horizon")).toBe(true);
  });

  test("keeps strategic Dwells bounded and inserts none when waiting cannot improve arrival", () => {
    const scenario = requireScenario(routeScenario());
    const result = planJourney(scenario, {
      departureGateId: "gate:start",
      destinationGateId: "gate:destination",
      shipProfileId: "ship:route",
      departureCoordinateTime: seconds(0),
      dwells: [],
      latestArrivalCoordinateTime: seconds(1e16),
      maximumStrategicWait: seconds(1_000_000),
      provenanceFilter: undefined,
      maxAlternatives: undefined,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.plan.strategicDwells).toEqual([]);
    expect(result.plan.strategicWaitDuration.value).toBeLessThanOrEqual(1_000_000);
    expect(result.plan.refinementQuality).toBe("bounded-strategic-dwell");
    expect(result.refinementQuality).toBe("bounded-strategic-dwell");
    expect(result.search.refinementQuality).toBe("bounded-strategic-dwell");
    expect(result.search.strategicDwellSearchComplete).toBe(false);
    expect(result.search.strategicDwellCandidatesEvaluated).toBeGreaterThan(0);
    expect(result.plan.arrivalBounds.upper.value).toBeLessThanOrEqual(1e16);
  });

  test("inserts a bounded strategic Dwell when a departure Gate moves faster than cruise", () => {
    const scenario = requireScenario(movingDepartureScenario());
    const latestArrivalCoordinateTime = seconds(200_000_000);
    const maximumStrategicWait = seconds(1_000_000);
    const zeroWaitBaseline = planJourney(scenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:selene",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
      dwells: [],
      latestArrivalCoordinateTime,
      maximumStrategicWait: seconds(0),
      provenanceFilter: undefined,
      maxAlternatives: 0,
    });

    expect(zeroWaitBaseline.ok).toBe(true);
    if (!zeroWaitBaseline.ok) {
      return;
    }
    expect(zeroWaitBaseline.plan.strategicDwells).toEqual([]);

    const optimized = planJourney(scenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:selene",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
      dwells: [],
      latestArrivalCoordinateTime,
      maximumStrategicWait,
      provenanceFilter: undefined,
      maxAlternatives: 0,
    });

    expect(optimized.ok).toBe(true);
    if (!optimized.ok) {
      return;
    }
    const dwell = optimized.plan.strategicDwells[0];
    if (dwell === undefined) {
      throw new Error("Expected a strategic Dwell insertion.");
    }
    expect(optimized.plan.timeline.legs.map((leg) => leg.kind)).toEqual([
      "dwell",
      "interstellar-cruise",
    ]);
    const dwellLeg = optimized.plan.timeline.legs.find((leg) => leg.kind === "dwell");
    if (dwellLeg === undefined) {
      throw new Error("Expected a Dwell Timeline entry.");
    }
    const dwellTimeline = dwellLeg.timeline as JourneyDwellTimeline;
    expect(dwellTimeline.kind).toBe("dwell");
    expect(dwellTimeline.gateId).toBe(dwell.locationGateId);
    expect(dwellTimeline.departureCoordinateTime.value).toBeCloseTo(
      dwell.startCoordinateTime.value,
      9,
    );
    expect(dwellTimeline.arrivalCoordinateTime.value).toBeCloseTo(dwell.endCoordinateTime.value, 9);
    expect(dwellTimeline.duration.value).toBeGreaterThan(0);
    expect(dwellTimeline.duration.value).toBeLessThanOrEqual(maximumStrategicWait.value);
    expect(dwellTimeline.duration.value).toBeCloseTo(dwell.duration.value, 9);
    expect(dwellTimeline.properDuration.value).toBeCloseTo(
      dwell.clockEffects.shipProperTime.value,
      9,
    );
    expect(dwellTimeline.agingDifference.value).toBeCloseTo(
      dwell.clockEffects.agingDifference.value,
      9,
    );
    expect(dwell.clockEffects.clusterCoordinateTime.value).toBeCloseTo(
      dwellTimeline.duration.value,
      9,
    );
    expect(dwell.arrivalTimeBenefit.value).toBeCloseTo(
      zeroWaitBaseline.plan.arrivalCoordinateTime.value -
        optimized.plan.arrivalCoordinateTime.value,
      9,
    );
    expect(dwell.arrivalTimeBenefit.value).toBeGreaterThan(0);
    expect(optimized.plan.arrivalCoordinateTime.value).toBeLessThan(
      zeroWaitBaseline.plan.arrivalCoordinateTime.value,
    );
    expect(optimized.plan.arrivalCoordinateTime.value).toBeLessThanOrEqual(
      latestArrivalCoordinateTime.value,
    );
    expect(optimized.plan.arrivalBounds.upper.value).toBeLessThanOrEqual(
      latestArrivalCoordinateTime.value,
    );
    expect(optimized.plan.refinementQuality).toBe("bounded-strategic-dwell");
    expect(optimized.search.strategicDwellSearchComplete).toBe(false);
  });

  test("does not prune a late prefix before bounded strategic-wait optimization", () => {
    const scenario = requireScenario(routeScenario());
    const result = planJourney(scenario, {
      departureGateId: "gate:start",
      destinationGateId: "gate:destination",
      shipProfileId: "ship:route",
      departureCoordinateTime: seconds(0),
      dwells: [],
      latestArrivalCoordinateTime: seconds(1),
      maximumStrategicWait: seconds(1_000_000),
      provenanceFilter: undefined,
      maxAlternatives: undefined,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.search?.routesPrunedByHorizon).toBe(0);
    expect(result.issues.some((issue) => issue.code === "no-valid-route")).toBe(true);
  });

  test("propagates route-property ranges into phase and arrival bounds", () => {
    const source = routeScenario();
    const destination = source.gates.find((candidate) => candidate.id === "gate:destination");
    if (destination === undefined) {
      throw new Error("Expected the destination Gate.");
    }
    const generated = generatedProvenance("route-test@1");
    const rangedDestination = {
      ...destination,
      properties: {
        positionAtEpoch: {
          provenance: generated,
          claim: rangeClaim({
            lower: vector3(meters(9.9e16), meters(9.9e16), meters(0)),
            upper: vector3(meters(1.01e17), meters(1.01e17), meters(0)),
            nominal: destination.positionAtEpoch,
            provenance: generated,
          }),
        },
      },
    };
    const scenario = requireScenario({
      ...source,
      gates: source.gates.map((candidate) =>
        candidate.id === destination.id ? rangedDestination : candidate,
      ),
    });
    const result = planJourney(scenario, {
      departureGateId: "gate:start",
      destinationGateId: "gate:destination",
      shipProfileId: "ship:route",
      departureCoordinateTime: seconds(0),
      dwells: [],
      latestArrivalCoordinateTime: seconds(1e16),
      maximumStrategicWait: seconds(0),
      provenanceFilter: undefined,
      maxAlternatives: undefined,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.plan.uncertainty.hasUncertainty).toBe(true);
    expect(result.plan.uncertainty.propertyPaths).toContain("gate:destination.positionAtEpoch");
    expect(result.plan.arrivalBounds.lower.value).toBeLessThanOrEqual(
      result.plan.arrivalCoordinateTime.value,
    );
    expect(result.plan.arrivalBounds.upper.value).toBeGreaterThan(
      result.plan.arrivalCoordinateTime.value,
    );
    expect(
      result.plan.timeline.phases.some(
        (phase) =>
          phase.bounds.clusterCoordinateDuration.upper.value >
          phase.clusterCoordinateDuration.value,
      ),
    ).toBe(true);
  });

  test("reports route alternatives whose conservative arrival ranges overlap the winner", () => {
    const source = routeScenario();
    const branchGate = source.gates.find((candidate) => candidate.id === "gate:branch-one-entry");
    if (branchGate === undefined) {
      throw new Error("Expected the first branch Entry Gate.");
    }
    const provenance = generatedProvenance("route-sensitivity@1");
    const scenario = requireScenario({
      ...source,
      gates: source.gates.map((candidate) =>
        candidate.id === branchGate.id
          ? {
              ...candidate,
              properties: {
                positionAtEpoch: {
                  provenance,
                  claim: rangeClaim({
                    lower: vector3(meters(0), meters(0), meters(0)),
                    upper: vector3(meters(1e17), meters(1e17), meters(0)),
                    nominal: branchGate.positionAtEpoch,
                    provenance,
                  }),
                },
              },
            }
          : candidate,
      ),
    });
    const result = planJourney(scenario, {
      departureGateId: "gate:start",
      destinationGateId: "gate:destination",
      shipProfileId: "ship:route",
      departureCoordinateTime: seconds(0),
      dwells: [],
      latestArrivalCoordinateTime: seconds(1e16),
      maximumStrategicWait: seconds(0),
      provenanceFilter: undefined,
      maxAlternatives: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.alternatives).toEqual([]);
    expect(result.sensitivity.length).toBeGreaterThan(0);
    expect(result.sensitivity).toEqual(result.sensitivityAlternatives);
    expect(result.sensitivity[0]?.overlapsNominalWinner).toBe(true);
    expect(result.plan.arrivalBounds.upper.value).toBeGreaterThan(
      result.plan.arrivalBounds.lower.value,
    );
  });

  test("reports an alternate whose conservative lower bound could beat the nominal winner", () => {
    const source = routeScenario();
    const directGate = source.gates.find((candidate) => candidate.id === "gate:detour-entry");
    if (directGate === undefined) {
      throw new Error("Expected the direct route Entry Gate.");
    }
    const provenance = generatedProvenance("route-sensitivity-lower-bound@1");
    const scenario = requireScenario({
      ...source,
      gates: source.gates.map((candidate) =>
        candidate.id === directGate.id
          ? {
              ...candidate,
              properties: {
                positionAtEpoch: {
                  provenance,
                  claim: rangeClaim({
                    lower: vector3(meters(0), meters(0), meters(0)),
                    upper: vector3(meters(1e17), meters(1e17), meters(0)),
                    nominal: directGate.positionAtEpoch,
                    provenance,
                  }),
                },
              },
            }
          : candidate,
      ),
    });
    const result = planJourney(scenario, {
      departureGateId: "gate:start",
      destinationGateId: "gate:destination",
      shipProfileId: "ship:route",
      departureCoordinateTime: seconds(0),
      dwells: [],
      latestArrivalCoordinateTime: seconds(1e16),
      maximumStrategicWait: seconds(0),
      provenanceFilter: undefined,
      maxAlternatives: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      result.sensitivity.some(
        (candidate) =>
          candidate.connectionIds.includes("connection:start-detour") &&
          candidate.couldBeatNominalWinner &&
          candidate.reason === "could-beat-nominal-winner",
      ),
    ).toBe(true);
  });

  test("filters generated Gate Connections without assigning them a nominal cost penalty", () => {
    const source = routeScenario();
    const generated = generatedProvenance("route-filter@1");
    const scenario = requireScenario({
      ...source,
      gateConnections: source.gateConnections.map((connection) =>
        connection.id === "connection:branch-one"
          ? { ...connection, provenance: generated }
          : connection,
      ),
    });
    const unfiltered = planJourney(scenario, {
      departureGateId: "gate:start",
      destinationGateId: "gate:destination",
      shipProfileId: "ship:route",
      departureCoordinateTime: seconds(0),
      dwells: [],
      latestArrivalCoordinateTime: seconds(1e16),
      maximumStrategicWait: seconds(0),
      provenanceFilter: undefined,
      maxAlternatives: undefined,
    });
    const filtered = planJourney(scenario, {
      departureGateId: "gate:start",
      destinationGateId: "gate:destination",
      shipProfileId: "ship:route",
      departureCoordinateTime: seconds(0),
      dwells: [],
      latestArrivalCoordinateTime: seconds(1e16),
      maximumStrategicWait: seconds(0),
      provenanceFilter: {
        allowedKinds: undefined,
        excludedKinds: ["generated"],
        allowedAuthorities: undefined,
        minimumAuthority: undefined,
      },
      maxAlternatives: undefined,
    });

    expect(unfiltered.ok).toBe(true);
    expect(filtered.ok).toBe(true);
    if (!unfiltered.ok || !filtered.ok) {
      return;
    }
    expect(unfiltered.plan.connectionIds).toContain("connection:branch-one");
    expect(filtered.plan.connectionIds).not.toContain("connection:branch-one");
    expect(filtered.plan.connectionIds).toContain("connection:start-detour");
    expect(filtered.plan.arrivalCoordinateTime.value).toBeGreaterThan(
      unfiltered.plan.arrivalCoordinateTime.value,
    );
    expect(filtered.issues).toEqual([]);
  });

  test("rejects a latest-arrival horizon that no route can satisfy", () => {
    const scenario = requireScenario(routeScenario());
    const result = planJourney(scenario, {
      departureGateId: "gate:start",
      destinationGateId: "gate:destination",
      shipProfileId: "ship:route",
      departureCoordinateTime: seconds(0),
      dwells: [],
      latestArrivalCoordinateTime: seconds(1),
      maximumStrategicWait: seconds(0),
      provenanceFilter: undefined,
      maxAlternatives: undefined,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === "horizon-exceeded")).toBe(true);
    expect(result.search?.routesPrunedByHorizon).toBeGreaterThan(0);
  });

  test("rejects a conservative arrival upper bound beyond a close numerical horizon", () => {
    const scenario = requireScenario(movingDepartureScenario());
    const baseline = planJourney(scenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:selene",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
      dwells: [],
      latestArrivalCoordinateTime: seconds(200_000_000),
      maximumStrategicWait: seconds(0),
      provenanceFilter: undefined,
      maxAlternatives: 0,
    });

    expect(baseline.ok).toBe(true);
    if (!baseline.ok) {
      return;
    }
    const baselineUpper = Number(baseline.plan.arrivalBounds.upper.value);
    const closeHorizon = seconds(baselineUpper - 5e-8);
    const result = planJourney(scenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:selene",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
      dwells: [],
      latestArrivalCoordinateTime: closeHorizon,
      maximumStrategicWait: seconds(0),
      provenanceFilter: undefined,
      maxAlternatives: 0,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === "horizon-exceeded")).toBe(true);
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
      latestArrivalCoordinateTime: seconds(1e16),
      maximumStrategicWait: seconds(0),
      provenanceFilter: undefined,
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
      latestArrivalCoordinateTime: seconds(1e16),
      maximumStrategicWait: seconds(0),
      provenanceFilter: undefined,
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
