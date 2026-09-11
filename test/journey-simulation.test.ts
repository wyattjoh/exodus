import { describe, expect, test } from "bun:test";

import {
  compileScenario,
  minimalScenario,
  meters,
  metersPerSecond,
  seconds,
  simulateJourney,
  SPEED_OF_LIGHT,
  vector3,
  type ScenarioInput,
} from "../src/index";

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Expected an item at index ${index}.`);
  }

  return value;
}

function requireScenario(input: unknown) {
  const result = compileScenario(input);
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }

  return result.scenario;
}

function scenarioAtDistance(distance: number): ScenarioInput {
  const selenePosition = vector3(meters(distance), meters(0), meters(0));
  return {
    ...minimalScenario,
    systems: [
      at(minimalScenario.systems, 0),
      { ...at(minimalScenario.systems, 1), positionAtEpoch: selenePosition },
    ],
    orbitalAnchors: [
      at(minimalScenario.orbitalAnchors, 0),
      { ...at(minimalScenario.orbitalAnchors, 1), positionAtEpoch: selenePosition },
    ],
    gates: [
      at(minimalScenario.gates, 0),
      { ...at(minimalScenario.gates, 1), positionAtEpoch: selenePosition },
    ],
  };
}

const lightYear = SPEED_OF_LIGHT.value * 31_557_600;
// The analytic fixture tolerances are deliberately tighter than the displayed values in the ticket.
const analyticClusterYearsTolerance = 0.0001;
const analyticShipDaysTolerance = 0.05;
const cruiseRequest = {
  departureGateId: "gate:terra",
  destinationGateId: "gate:selene",
  shipProfileId: "ship:survey",
  departureCoordinateTime: seconds(0),
  cruiseSpeed: undefined,
} as const;

describe("fixed-gate Journey simulation", () => {
  test("returns departure, cruise, and arrival phases with both cumulative clocks", () => {
    const scenario = requireScenario(scenarioAtDistance(3.8 * lightYear));
    const result = simulateJourney(scenario, cruiseRequest);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.timeline.phases.map((phase) => phase.kind)).toEqual([
      "departure-transition",
      "interstellar-cruise",
      "arrival-transition",
    ]);
    expect(Number(result.timeline.phases[0]?.clusterCoordinateDuration.value)).toBe(0);
    expect(Number(result.timeline.phases[0]?.shipProperDuration.value)).toBe(0);
    expect(Number(result.timeline.phases[2]?.clusterCoordinateDuration.value)).toBe(0);
    expect(Number(result.timeline.phases[2]?.shipProperDuration.value)).toBe(0);

    const clusterYears = Number(result.timeline.total.clusterCoordinateTime.value) / 31_557_600;
    const shipDays = Number(result.timeline.total.shipProperTime.value) / 86_400;
    expect(Math.abs(clusterYears - 3.8038)).toBeLessThan(analyticClusterYearsTolerance);
    expect(Math.abs(shipDays - 62.12)).toBeLessThan(analyticShipDaysTolerance);
    expect(Number(result.timeline.total.agingDifference.value)).toBeCloseTo(
      Number(result.timeline.total.clusterCoordinateTime.value) -
        Number(result.timeline.total.shipProperTime.value),
      6,
    );

    expect(result.timeline.events.map((event) => event.kind)).toEqual([
      "departure",
      "cruise-departure",
      "cruise-arrival",
      "arrival",
    ]);
    expect(Number(result.timeline.events[0]?.cumulativeClusterCoordinateTime.value)).toBe(0);
    expect(Number(result.timeline.events[1]?.cumulativeShipProperTime.value)).toBe(0);
    expect(Number(result.timeline.events[2]?.cumulativeClusterCoordinateTime.value)).toBe(
      Number(result.timeline.total.clusterCoordinateTime.value),
    );
    expect(Number(result.timeline.events[3]?.cumulativeShipProperTime.value)).toBe(
      Number(result.timeline.total.shipProperTime.value),
    );
  });

  test("keeps cumulative clocks relative to the Journey departure epoch", () => {
    const scenario = requireScenario(scenarioAtDistance(3.8 * lightYear));
    const result = simulateJourney(scenario, {
      ...cruiseRequest,
      departureCoordinateTime: seconds(10_000),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(Number(result.timeline.departureCoordinateTime.value)).toBe(10_000);
    expect(Number(result.timeline.events[0]?.cumulativeClusterCoordinateTime.value)).toBe(0);
    expect(Number(result.timeline.total.clusterCoordinateTime.value)).toBe(
      Number(result.timeline.phases[1]?.clusterCoordinateDuration.value),
    );
    expect(Number(result.timeline.total.agingDifference.value)).toBeGreaterThan(0);
  });

  test("rejects a cruise speed that is not the fixed contract speed", () => {
    const scenario = requireScenario(scenarioAtDistance(3.8 * lightYear));
    const result = simulateJourney(scenario, {
      ...cruiseRequest,
      cruiseSpeed: metersPerSecond(0.5 * SPEED_OF_LIGHT.value),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === "invalid-speed")).toBe(true);
    }
  });

  test("rejects zero-distance endpoints and a ship without a ZPZ Generator", () => {
    const zeroDistance = requireScenario(scenarioAtDistance(0));
    const zeroDistanceResult = simulateJourney(zeroDistance, cruiseRequest);
    expect(zeroDistanceResult.ok).toBe(false);
    if (!zeroDistanceResult.ok) {
      expect(zeroDistanceResult.issues.some((issue) => issue.code === "invalid-distance")).toBe(
        true,
      );
    }

    const noZpzScenario = requireScenario({
      ...minimalScenario,
      shipProfiles: [
        {
          ...at(minimalScenario.shipProfiles, 0),
          hasZpzGenerator: false,
        },
      ],
    });
    const noZpzResult = simulateJourney(noZpzScenario, cruiseRequest);
    expect(noZpzResult.ok).toBe(false);
    if (!noZpzResult.ok) {
      expect(noZpzResult.issues.some((issue) => issue.code === "missing-zpz-generator")).toBe(true);
    }
  });

  test("rejects a non-stationary endpoint and a non-paired endpoint", () => {
    const movingScenario = requireScenario({
      ...minimalScenario,
      gates: [
        at(minimalScenario.gates, 0),
        {
          ...at(minimalScenario.gates, 1),
          velocityAtEpoch: vector3(metersPerSecond(1), metersPerSecond(0), metersPerSecond(0)),
        },
      ],
    });
    const movingResult = simulateJourney(movingScenario, cruiseRequest);
    expect(movingResult.ok).toBe(false);
    if (!movingResult.ok) {
      expect(movingResult.issues.some((issue) => issue.code === "non-stationary-gate")).toBe(true);
    }

    const nonPairedResult = simulateJourney(requireScenario(minimalScenario), {
      ...cruiseRequest,
      destinationGateId: cruiseRequest.departureGateId,
    });
    expect(nonPairedResult.ok).toBe(false);
    if (!nonPairedResult.ok) {
      expect(nonPairedResult.issues.some((issue) => issue.code === "invalid-gate-pairing")).toBe(
        true,
      );
    }
  });
});
