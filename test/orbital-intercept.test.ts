import { describe, expect, test } from "bun:test";

import {
  compileScenario,
  evaluateScenarioWorldlines,
  INTERCEPT_MAX_SEARCH_SECONDS,
  INTERCEPT_TIME_RESIDUAL_TOLERANCE,
  INTERSTELLAR_CRUISE_SPEED,
  minimalScenario,
  meters,
  metersCubedPerSecondSquared,
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

const solarMu = metersCubedPerSecondSquared(1.32712440018e20);
const lightYear = SPEED_OF_LIGHT.value * 31_557_600;
const distance = 3.8 * lightYear;
const zeroVelocity = vector3(metersPerSecond(0), metersPerSecond(0), metersPerSecond(0));
const sourceSystemPosition = vector3(meters(0), meters(0), meters(0));
const destinationSystemPosition = vector3(meters(distance), meters(0), meters(0));

const orbit = {
  semiMajorAxis: meters(1.5e11),
  eccentricity: 0,
  inclination: 0,
  longitudeOfAscendingNode: 0,
  argumentOfPeriapsis: 0,
  meanAnomalyAtEpoch: 0,
  gravitationalParameter: solarMu,
} as const;

const orbitingScenario: ScenarioInput = {
  ...minimalScenario,
  systems: [
    {
      ...at(minimalScenario.systems, 0),
      positionAtEpoch: sourceSystemPosition,
    },
    {
      ...at(minimalScenario.systems, 1),
      positionAtEpoch: destinationSystemPosition,
    },
  ],
  orbitalAnchors: [
    {
      ...at(minimalScenario.orbitalAnchors, 0),
      positionAtEpoch: sourceSystemPosition,
    },
    {
      id: "anchor:terra-planet",
      designation: "CEN-0001-P",
      name: "Terra Planet",
      kind: "planet",
      systemId: "system:terra",
      parentId: "anchor:terra-star",
      positionAtEpoch: vector3(meters(1.5e11), meters(0), meters(0)),
      velocityAtEpoch: vector3(
        metersPerSecond(0),
        metersPerSecond(29_784.6918),
        metersPerSecond(0),
      ),
      orbitalElements: orbit,
    },
    {
      id: "anchor:terra-moon",
      designation: "CEN-0001-M",
      name: "Terra Moon",
      kind: "moon",
      systemId: "system:terra",
      parentId: "anchor:terra-planet",
      positionAtEpoch: vector3(meters(1.504e11), meters(0), meters(0)),
      velocityAtEpoch: vector3(metersPerSecond(0), metersPerSecond(30_800), metersPerSecond(0)),
      orbitalElements: {
        ...orbit,
        semiMajorAxis: meters(4e8),
        gravitationalParameter: metersCubedPerSecondSquared(4.035e14),
      },
    },
    {
      ...at(minimalScenario.orbitalAnchors, 1),
      positionAtEpoch: destinationSystemPosition,
    },
  ],
  gates: [
    {
      ...at(minimalScenario.gates, 0),
      orbitalAnchorId: "anchor:terra-moon",
      positionAtEpoch: vector3(meters(1.504e11), meters(0), meters(0)),
      velocityAtEpoch: vector3(metersPerSecond(0), metersPerSecond(30_800), metersPerSecond(0)),
    },
    {
      ...at(minimalScenario.gates, 1),
      orbitalAnchorId: "anchor:selene-star",
      positionAtEpoch: vector3(meters(distance + 1.5e11), meters(0), meters(0)),
      velocityAtEpoch: vector3(
        metersPerSecond(0),
        metersPerSecond(29_784.6918),
        metersPerSecond(0),
      ),
      orbitalElements: orbit,
    },
  ],
};

describe("hierarchical Keplerian worldlines and moving-Gate cruises", () => {
  test("evaluates nested anchors and Gate states at arbitrary epochs", () => {
    const scenario = requireScenario(orbitingScenario);
    const worldlines = evaluateScenarioWorldlines(scenario, seconds(0));

    expect(worldlines.ok).toBe(true);
    if (!worldlines.ok) {
      return;
    }

    const planet = worldlines.orbitalAnchors.find((state) => state.id === "anchor:terra-planet");
    const moon = worldlines.orbitalAnchors.find((state) => state.id === "anchor:terra-moon");
    const gate = worldlines.gates.find((state) => state.id === "gate:terra");
    expect(planet?.position.x.value).toBeCloseTo(1.5e11, -2);
    expect(planet?.velocity.y.value).toBeCloseTo(29_744.7407, 0);
    expect(moon?.position.x.value).toBeCloseTo(1.504e11, -2);
    expect(gate?.position.x.value).toBeCloseTo(moon?.position.x.value ?? 0, -2);

    const period = 2 * Math.PI * Math.sqrt(1.5e11 ** 3 / solarMu.value);
    const afterPeriod = evaluateScenarioWorldlines(scenario, seconds(period));
    expect(afterPeriod.ok).toBe(true);
    if (afterPeriod.ok) {
      const afterPlanet = afterPeriod.orbitalAnchors.find(
        (state) => state.id === "anchor:terra-planet",
      );
      expect(afterPlanet?.position.x.value).toBeCloseTo(1.5e11, -2);
      expect(afterPlanet?.position.y.value).toBeCloseTo(0, -2);
    }
  });

  test("intercepts the future orbital position and arrives comoving with the Gate", () => {
    const scenario = requireScenario(orbitingScenario);
    const result = simulateJourney(scenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:selene",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
      cruiseSpeed: undefined,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.timeline.arrivalCoordinateTime.value).toBeGreaterThan(0);
    expect(result.timeline.arrivalPosition.x.value).toBeGreaterThan(distance);
    expect(result.timeline.arrivalVelocity.y.value).not.toBe(0);
    const arrivalWorldlines = evaluateScenarioWorldlines(
      scenario,
      result.timeline.arrivalCoordinateTime,
    );
    expect(arrivalWorldlines.ok).toBe(true);
    if (arrivalWorldlines.ok) {
      const destinationAtArrival = arrivalWorldlines.gates.find(
        (state) => state.id === "gate:selene",
      );
      expect(destinationAtArrival?.velocity).toEqual(result.timeline.arrivalVelocity);
      expect(destinationAtArrival?.position).toEqual(result.timeline.arrivalPosition);
    }
    expect(result.timeline.arrivalIntercept.position).toEqual(result.timeline.arrivalPosition);
    expect(result.timeline.arrivalIntercept.positionResidual.value).toBeLessThan(100_000);
    expect(result.timeline.arrivalIntercept.timeResidual.value).toBeLessThanOrEqual(
      INTERCEPT_TIME_RESIDUAL_TOLERANCE,
    );
    expect(result.timeline.phases.map((phase) => phase.kind)).toEqual([
      "departure-transition",
      "interstellar-cruise",
      "arrival-transition",
    ]);
  });

  test("accepts the representable time tolerance at the maximum search horizon", () => {
    const destinationPosition = vector3(
      meters(INTERSTELLAR_CRUISE_SPEED.value * INTERCEPT_MAX_SEARCH_SECONDS),
      meters(0),
      meters(0),
    );
    const scenario = requireScenario({
      ...minimalScenario,
      systems: [
        at(minimalScenario.systems, 0),
        {
          ...at(minimalScenario.systems, 1),
          positionAtEpoch: destinationPosition,
        },
      ],
      orbitalAnchors: [
        at(minimalScenario.orbitalAnchors, 0),
        {
          ...at(minimalScenario.orbitalAnchors, 1),
          positionAtEpoch: destinationPosition,
        },
      ],
      gates: [
        at(minimalScenario.gates, 0),
        {
          ...at(minimalScenario.gates, 1),
          positionAtEpoch: destinationPosition,
        },
      ],
    });
    const result = simulateJourney(scenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:selene",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
      cruiseSpeed: undefined,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.timeline.arrivalIntercept.timeResidual.value).toBeGreaterThan(
        INTERCEPT_TIME_RESIDUAL_TOLERANCE,
      );
      expect(result.timeline.arrivalIntercept.timeResidual.value).toBeLessThanOrEqual(2);
    }
  });

  test("rejects a superluminal destination Gate at the solved arrival epoch", () => {
    const eccentricity = 0.99;
    const semiMajorAxis = 1_000_000;
    const pericenter = semiMajorAxis * (1 - eccentricity);
    const gravitationalParameter =
      SPEED_OF_LIGHT.value ** 2 * semiMajorAxis * ((1 - eccentricity) / (1 + eccentricity)) * 1.21;
    const halfPeriod = Math.PI * Math.sqrt(semiMajorAxis ** 3 / gravitationalParameter);
    const destinationSystemDistance = INTERSTELLAR_CRUISE_SPEED.value * halfPeriod + pericenter;
    const destinationSystemPosition = vector3(
      meters(destinationSystemDistance),
      meters(0),
      meters(0),
    );
    const destinationGatePosition = vector3(
      meters(destinationSystemDistance + semiMajorAxis * (1 + eccentricity)),
      meters(0),
      meters(0),
    );
    const highEccentricityOrbit = {
      semiMajorAxis: meters(semiMajorAxis),
      eccentricity,
      inclination: 0,
      longitudeOfAscendingNode: 0,
      argumentOfPeriapsis: Math.PI,
      meanAnomalyAtEpoch: Math.PI,
      gravitationalParameter: metersCubedPerSecondSquared(gravitationalParameter),
    } as const;
    const scenario = requireScenario({
      ...minimalScenario,
      systems: [
        at(minimalScenario.systems, 0),
        {
          ...at(minimalScenario.systems, 1),
          positionAtEpoch: destinationSystemPosition,
        },
      ],
      orbitalAnchors: [
        at(minimalScenario.orbitalAnchors, 0),
        {
          ...at(minimalScenario.orbitalAnchors, 1),
          positionAtEpoch: destinationSystemPosition,
        },
      ],
      gates: [
        at(minimalScenario.gates, 0),
        {
          ...at(minimalScenario.gates, 1),
          positionAtEpoch: destinationGatePosition,
          velocityAtEpoch: zeroVelocity,
          orbitalElements: highEccentricityOrbit,
        },
      ],
    });
    const result = simulateJourney(scenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:selene",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
      cruiseSpeed: undefined,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.timeline).toBeUndefined();
      expect(
        result.issues.some(
          (issue) => issue.code === "invalid-speed" && issue.path.endsWith("arrivalVelocity"),
        ),
      ).toBe(true);
    }
  });

  test("rejects invalid orbital elements without a partial compiled Scenario", () => {
    const result = compileScenario({
      ...minimalScenario,
      orbitalAnchors: [
        {
          ...at(minimalScenario.orbitalAnchors, 0),
          orbitalElements: {
            ...orbit,
            eccentricity: 1,
          },
        },
        at(minimalScenario.orbitalAnchors, 1),
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.scenario).toBeUndefined();
      expect(result.issues.some((issue) => issue.code === "invalid-orbital-elements")).toBe(true);
    }
  });

  test("reports a structured issue when an intercept cannot converge", () => {
    const scenario = requireScenario({
      ...minimalScenario,
      gates: [
        at(minimalScenario.gates, 0),
        {
          ...at(minimalScenario.gates, 1),
          velocityAtEpoch: vector3(
            metersPerSecond(0.9995 * SPEED_OF_LIGHT.value),
            metersPerSecond(0),
            metersPerSecond(0),
          ),
        },
      ],
    });
    const result = simulateJourney(scenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:selene",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
      cruiseSpeed: undefined,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.timeline).toBeUndefined();
      expect(result.issues.some((issue) => issue.code === "non-convergent-intercept")).toBe(true);
    }
  });
});
