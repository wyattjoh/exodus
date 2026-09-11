import { describe, expect, test } from "bun:test";

import {
  compileScenario,
  createJourneyModel,
  meters,
  metersCubedPerSecondSquared,
  metersPerSecond,
  multiLegJourneyRequest,
  multiLegJourneyScenario,
  minimalScenario,
  seconds,
  simulateMultiLegJourney,
  SPEED_OF_LIGHT,
  vector3,
} from "../src/index";

function requireScenario(input: unknown) {
  const result = compileScenario(input);
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }

  return result.scenario;
}

describe("multi-leg Journey Timeline", () => {
  test("composes the synthetic Journey through the public model seam", () => {
    const model = createJourneyModel();
    const scenario = requireScenario(multiLegJourneyScenario);
    const result = model.simulateJourney(scenario, multiLegJourneyRequest);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.timeline.phases.map((phase) => phase.kind)).toEqual([
      "departure-transition",
      "interstellar-cruise",
      "arrival-transition",
      "dwell",
      "in-system-transfer",
      "departure-transition",
      "interstellar-cruise",
      "arrival-transition",
    ]);
    expect(result.timeline.legs.map((leg) => leg.kind)).toEqual([
      "interstellar-cruise",
      "dwell",
      "in-system-transfer",
      "interstellar-cruise",
    ]);
    expect(result.timeline.departureGateId).toBe("gate:terra");
    expect(result.timeline.destinationGateId).toBe("gate:helios");
    expect(result.timeline.arrivalCoordinateTime.value).toBeGreaterThan(
      result.timeline.departureCoordinateTime.value,
    );

    for (const [index, phase] of result.timeline.phases.entries()) {
      expect(phase.endCoordinateTime.value).toBeGreaterThanOrEqual(phase.startCoordinateTime.value);
      expect(phase.end.clusterCoordinateTime.value).toBeGreaterThanOrEqual(
        phase.start.clusterCoordinateTime.value,
      );
      if (index > 0) {
        const previous = result.timeline.phases[index - 1];
        if (previous === undefined) {
          throw new Error("Expected every phase to have a preceding phase.");
        }
        expect(phase.startCoordinateTime.value).toBe(previous.endCoordinateTime.value);
        expect(phase.start.clusterCoordinateTime.value).toBe(
          previous.end.clusterCoordinateTime.value,
        );
        expect(phase.start.shipProperTime.value).toBe(previous.end.shipProperTime.value);
      }
    }

    const dwell = result.timeline.phases.find((phase) => phase.kind === "dwell");
    if (dwell?.dwell === undefined) {
      throw new Error("Expected a Dwell detail in the synthetic Journey.");
    }
    expect(dwell.dwell.duration.value).toBeGreaterThan(0);
    expect(dwell.dwell.properDuration.value).toBeLessThan(dwell.dwell.duration.value);
    expect(result.timeline.clocks.agingDifference.value).toBeGreaterThan(0);
    expect(result.timeline.events.some((event) => event.kind === "dwell-start")).toBe(true);
    expect(result.timeline.events.some((event) => event.kind === "transfer-arrival")).toBe(true);
  });

  test("integrates proper time along an orbiting Dwell Gate worldline", () => {
    const orbit = {
      semiMajorAxis: meters(1.5e11),
      eccentricity: 0,
      inclination: 0,
      longitudeOfAscendingNode: 0,
      argumentOfPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      gravitationalParameter: metersCubedPerSecondSquared(1.32712440018e20),
    } as const;
    const selenePosition = vector3(meters(3.6e16), meters(0), meters(0));
    const scenario = requireScenario({
      ...minimalScenario,
      orbitalAnchors: [minimalScenario.orbitalAnchors[0], minimalScenario.orbitalAnchors[1]],
      gates: [
        minimalScenario.gates[0],
        {
          ...minimalScenario.gates[1],
          positionAtEpoch: vector3(meters(3.6e16 + 1.5e11), meters(0), meters(0)),
          velocityAtEpoch: vector3(
            metersPerSecond(29_784.6918),
            metersPerSecond(0),
            metersPerSecond(0),
          ),
          orbitalElements: orbit,
        },
      ],
    });
    const duration = seconds(86_400);
    const result = simulateMultiLegJourney(scenario, {
      kind: "journey",
      departureGateId: "gate:terra",
      destinationGateId: "gate:selene",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
      legs: [
        { kind: "interstellar-cruise", destinationGateId: "gate:selene" },
        { kind: "dwell", gateId: "gate:selene", duration },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const dwell = result.timeline.phases[3]?.dwell;
    if (dwell === undefined) {
      throw new Error("Expected an orbiting Dwell phase.");
    }
    expect(dwell.arrivalPosition.y.value).not.toBe(dwell.departurePosition.y.value);
    expect(dwell.properDuration.value).toBeLessThan(duration.value);
    expect(dwell.properDuration.value).toBeGreaterThan(
      duration.value * Math.sqrt(1 - (30_000 / SPEED_OF_LIGHT.value) ** 2),
    );
  });

  test("keeps Dwell proper time and every completion epoch deterministic", () => {
    const scenario = requireScenario(multiLegJourneyScenario);
    const first = simulateMultiLegJourney(scenario, multiLegJourneyRequest);
    const second = simulateMultiLegJourney(scenario, multiLegJourneyRequest);

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    const dwell = first.timeline.legs.find((leg) => leg.kind === "dwell");
    if (dwell === undefined) {
      throw new Error("Expected a Dwell leg in the synthetic Journey.");
    }
    const arrivalTransition = first.timeline.phases[2];
    if (arrivalTransition === undefined) {
      throw new Error("Expected the first cruise arrival transition.");
    }
    expect(dwell.timeline.departureCoordinateTime.value).toBe(
      arrivalTransition.endCoordinateTime.value,
    );

    const transfer = first.timeline.legs.find((leg) => leg.kind === "in-system-transfer");
    if (transfer === undefined) {
      throw new Error("Expected an In-system Transfer leg in the synthetic Journey.");
    }
    expect(transfer.timeline.departureCoordinateTime.value).toBe(
      dwell.timeline.arrivalCoordinateTime.value,
    );
    expect(Number(first.timeline.arrivalCoordinateTime.value)).toBeCloseTo(
      Number(first.timeline.departureCoordinateTime.value) +
        Number(first.timeline.clocks.clusterCoordinateTime.value),
      6,
    );
    expect(first.timeline.clocks.shipProperTime.value).toBeLessThan(
      first.timeline.clocks.clusterCoordinateTime.value,
    );
  });
});
