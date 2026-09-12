import { describe, expect, test } from "bun:test";

import {
  compileScenario,
  minimalScenario,
  meters,
  metersPerSecond,
  metersPerSecondSquared,
  sampleInSystemTransferAt,
  seconds,
  simulateInSystemTransfer,
  simulateJourney,
  SPEED_OF_LIGHT,
  vector3,
  type CompiledScenario,
  type ScenarioInput,
} from "../src/index";

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Expected an item at index ${index}.`);
  }

  return value;
}

function requireScenario(input: ScenarioInput) {
  const result = compileScenario(input);
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }

  return result.scenario;
}

type TransferPosition = ScenarioInput["gates"][number]["positionAtEpoch"];
type TransferVelocity = ScenarioInput["gates"][number]["velocityAtEpoch"];

function transferScenario(
  destinationPosition: number | TransferPosition,
  maximumSublightSpeed = 0.2 * SPEED_OF_LIGHT.value,
  destinationVelocity: TransferVelocity = vector3(
    metersPerSecond(0),
    metersPerSecond(0),
    metersPerSecond(0),
  ),
  departureVelocity: TransferVelocity = vector3(
    metersPerSecond(0),
    metersPerSecond(0),
    metersPerSecond(0),
  ),
): ScenarioInput {
  const departureGate = {
    ...at(minimalScenario.gates, 0),
    velocityAtEpoch: departureVelocity,
  };
  const remoteGate = at(minimalScenario.gates, 1);
  const position =
    typeof destinationPosition === "number"
      ? vector3(meters(destinationPosition), meters(0), meters(0))
      : destinationPosition;
  const destinationGate = {
    ...departureGate,
    id: "gate:terra-transfer-destination",
    designation: "GATE-CEN-0001-TRANSFER",
    name: "Terra Transfer Gate of Heaven",
    positionAtEpoch: position,
    velocityAtEpoch: destinationVelocity,
  };
  const remoteTransferGate = {
    ...remoteGate,
    id: "gate:selene-transfer",
    designation: "GATE-CEN-0002-TRANSFER",
    name: "Selene Transfer Gate of Heaven",
  };

  return {
    ...minimalScenario,
    gates: [departureGate, remoteGate, destinationGate, remoteTransferGate],
    gateConnections: [
      at(minimalScenario.gateConnections, 0),
      {
        id: "connection:terra-transfer-selene-transfer",
        designation: "LINK-CEN-0001-0002-TRANSFER",
        name: "Terra Transfer Link",
        gateAId: destinationGate.id,
        gateBId: remoteTransferGate.id,
      },
    ],
    shipProfiles: [
      {
        ...at(minimalScenario.shipProfiles, 0),
        acceleration: metersPerSecondSquared(10),
        brakingAcceleration: metersPerSecondSquared(10),
        maximumSublightSpeed: metersPerSecond(maximumSublightSpeed),
      },
    ],
  };
}

describe("powered In-system Transfer", () => {
  test("simulates an analytic acceleration-and-braking transfer", () => {
    const distance = 1_000_000_000;
    const acceleration = 10;
    const scenario = requireScenario(transferScenario(distance));
    const result = simulateInSystemTransfer(scenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:terra-transfer-destination",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const gammaPeak = 1 + distance / (SPEED_OF_LIGHT.value ** 2 * (2 / acceleration));
    const betaPeak = Math.sqrt(gammaPeak ** 2 - 1) / gammaPeak;
    const accelerationDuration =
      (SPEED_OF_LIGHT.value / acceleration) * Math.sqrt(gammaPeak ** 2 - 1);
    const expectedDuration = 2 * accelerationDuration;
    const expectedProperDuration =
      2 * (SPEED_OF_LIGHT.value / acceleration) * 2 * Math.asinh(Math.sqrt((gammaPeak - 1) / 2));

    expect(result.timeline.phases.map((phase) => phase.kind)).toEqual(["acceleration", "braking"]);
    expect(result.timeline.peakSpeed.value).toBeCloseTo(SPEED_OF_LIGHT.value * betaPeak, 3);
    expect(result.timeline.totalClusterCoordinateTime.value).toBeCloseTo(expectedDuration, 6);
    expect(result.timeline.totalShipProperTime.value).toBeCloseTo(expectedProperDuration, 6);
    expect(result.timeline.arrivalCoordinateTime.value).toBeCloseTo(expectedDuration, 6);
    expect(result.timeline.terminalResiduals.position.value).toBeLessThan(1e-3);
    expect(result.timeline.terminalResiduals.velocity.value).toBeLessThan(1e-9);
    expect(result.timeline.phases[0]?.end.clusterCoordinateTime.value).toBeCloseTo(
      accelerationDuration,
      6,
    );
    expect(result.timeline.phases[1]?.end.clusterCoordinateTime.value).toBeCloseTo(
      expectedDuration,
      6,
    );
  });

  test("samples powered phases from the authoritative solution without endpoint interpolation", () => {
    const scenario = requireScenario(transferScenario(1e9));
    const result = simulateInSystemTransfer(scenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:terra-transfer-destination",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const midpoint = result.timeline.totalClusterCoordinateTime.value / 2;
    const sampled = sampleInSystemTransferAt(result.timeline, seconds(midpoint));
    const accelerationEnd = sampleInSystemTransferAt(
      result.timeline,
      result.timeline.phases[0]?.end.clusterCoordinateTime ?? seconds(0),
    );
    expect(sampled.phase).toBe("braking");
    expect(sampled.velocity.x.value).toBeGreaterThan(0);
    expect(sampled.properTime.value).toBeGreaterThan(0);
    expect(accelerationEnd.phase).toBe("braking");
    expect(accelerationEnd.position.x.value).toBeGreaterThan(0);
    expect(
      sampled.position.x.value ===
        (Number(result.timeline.departurePosition.x.value) +
          Number(result.timeline.arrivalPosition.x.value)) /
          2,
    ).toBe(false);
  });

  test("exposes the same transfer through the tagged Journey seam", () => {
    const scenario = requireScenario(transferScenario(1e9));
    const result = simulateJourney(scenario, {
      kind: "in-system-transfer",
      departureGateId: "gate:terra",
      destinationGateId: "gate:terra-transfer-destination",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.timeline.phases.map((phase) => phase.kind)).toEqual([
        "acceleration",
        "braking",
      ]);
    }
  });

  test("accelerates to a profile cap, coasts, flips, and brakes", () => {
    const distance = 1e13;
    const acceleration = 10;
    const maximumSpeed = 0.01 * SPEED_OF_LIGHT.value;
    const scenario = requireScenario(transferScenario(distance, maximumSpeed));
    const result = simulateInSystemTransfer(scenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:terra-transfer-destination",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const gamma = 1 / Math.sqrt(1 - 0.01 ** 2);
    const rapidity = Math.atanh(0.01);
    const accelerationDuration = (SPEED_OF_LIGHT.value / acceleration) * gamma * 0.01;
    const poweredDistance = 2 * (SPEED_OF_LIGHT.value ** 2 / acceleration) * (gamma - 1);
    const coastDuration = (distance - poweredDistance) / maximumSpeed;
    const expectedDuration = 2 * accelerationDuration + coastDuration;
    const expectedProperDuration =
      2 * (SPEED_OF_LIGHT.value / acceleration) * rapidity + coastDuration / gamma;

    expect(result.timeline.phases.map((phase) => phase.kind)).toEqual([
      "acceleration",
      "coast",
      "braking",
    ]);
    expect(result.timeline.coastSpeed?.value).toBeCloseTo(maximumSpeed, 3);
    expect(result.timeline.peakSpeed.value).toBeCloseTo(maximumSpeed, 3);
    expect(result.timeline.totalClusterCoordinateTime.value).toBeCloseTo(expectedDuration, 3);
    expect(result.timeline.totalShipProperTime.value).toBeCloseTo(expectedProperDuration, 3);
    expect(result.timeline.events.some((event) => event.kind === "flip")).toBe(true);
  });

  test("intercepts a three-dimensional moving Gate and reports terminal residuals", () => {
    const destinationPosition = vector3(meters(3e9), meters(4e9), meters(12e9));
    const destinationVelocity = vector3(metersPerSecond(0), metersPerSecond(0), metersPerSecond(0));
    const scenario = requireScenario(
      transferScenario(destinationPosition, undefined, destinationVelocity),
    );
    const result = simulateInSystemTransfer(scenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:terra-transfer-destination",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const distance = 13e9;
    const gammaPeak = 1 + distance / (SPEED_OF_LIGHT.value ** 2 * (2 / 10));
    const expectedDuration = 2 * (SPEED_OF_LIGHT.value / 10) * Math.sqrt(gammaPeak ** 2 - 1);
    const expectedProperDuration =
      2 * (SPEED_OF_LIGHT.value / 10) * 2 * Math.asinh(Math.sqrt((gammaPeak - 1) / 2));

    expect(result.timeline.arrivalCoordinateTime.value).toBeGreaterThan(0);
    expect(result.timeline.totalClusterCoordinateTime.value).toBeCloseTo(expectedDuration, 4);
    expect(result.timeline.totalShipProperTime.value).toBeCloseTo(expectedProperDuration, 4);
    expect(result.timeline.terminalResiduals.position.value).toBeLessThan(1e-3);
    expect(result.timeline.terminalResiduals.velocity.value).toBeLessThan(1e-9);
    expect(result.timeline.events.at(-1)?.kind).toBe("arrival");
  });

  test("intercepts a moving target while matching its terminal velocity", () => {
    const scenario = requireScenario(
      transferScenario(
        1e9,
        0.2 * SPEED_OF_LIGHT.value,
        vector3(metersPerSecond(1_000), metersPerSecond(0), metersPerSecond(0)),
      ),
    );
    const result = simulateInSystemTransfer(scenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:terra-transfer-destination",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.timeline.destinationPosition.x.value).toBeGreaterThan(1e9);
    expect(result.timeline.terminalResiduals.position.value).toBeLessThan(1e-3);
    expect(result.timeline.terminalResiduals.velocity.value).toBeLessThan(1e-6);
  });

  test("uses Lorentz-transformed clocks for comoving Gates", () => {
    const separation = 1e9;
    const sharedSpeed = 0.5 * SPEED_OF_LIGHT.value;
    const scenario = requireScenario(
      transferScenario(
        separation,
        0.9 * SPEED_OF_LIGHT.value,
        vector3(metersPerSecond(sharedSpeed), metersPerSecond(0), metersPerSecond(0)),
        vector3(metersPerSecond(sharedSpeed), metersPerSecond(0), metersPerSecond(0)),
      ),
    );
    const result = simulateInSystemTransfer(scenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:terra-transfer-destination",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const sharedGamma = 1 / Math.sqrt(1 - 0.5 ** 2);
    const restFrameSeparation = sharedGamma * separation;
    const transferProperTime =
      2 *
      (SPEED_OF_LIGHT.value / 10) *
      2 *
      Math.asinh(
        Math.sqrt((1 + restFrameSeparation / (SPEED_OF_LIGHT.value ** 2 * (2 / 10)) - 1) / 2),
      );
    const transferRestCoordinateTime =
      2 *
      (SPEED_OF_LIGHT.value / 10) *
      Math.sqrt((1 + restFrameSeparation / (SPEED_OF_LIGHT.value ** 2 * (2 / 10))) ** 2 - 1);
    const expectedClusterDuration =
      sharedGamma *
      (transferRestCoordinateTime +
        (sharedSpeed * restFrameSeparation) / SPEED_OF_LIGHT.value ** 2);

    expect(result.timeline.totalShipProperTime.value).toBeCloseTo(transferProperTime, 4);
    expect(result.timeline.totalClusterCoordinateTime.value).toBeCloseTo(
      expectedClusterDuration,
      4,
    );
    expect(result.timeline.arrivalCoordinateTime.value).toBeCloseTo(expectedClusterDuration, 4);
    expect(result.timeline.peakSpeed.value).toBeLessThan(0.9 * SPEED_OF_LIGHT.value);
    expect(result.timeline.terminalResiduals.position.value).toBeLessThan(1);
    expect(result.timeline.terminalResiduals.velocity.value).toBeLessThan(1e-6);
  });

  test("solves a transverse moving-target intercept without exceeding the speed cap", () => {
    const scenario = requireScenario(
      transferScenario(
        vector3(meters(3e9), meters(4e9), meters(12e9)),
        0.2 * SPEED_OF_LIGHT.value,
        vector3(metersPerSecond(1_000), metersPerSecond(0), metersPerSecond(0)),
      ),
    );
    const result = simulateInSystemTransfer(scenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:terra-transfer-destination",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.timeline.terminalResiduals.position.value).toBeLessThan(1);
    expect(result.timeline.terminalResiduals.velocity.value).toBeLessThan(1e-6);
    expect(result.timeline.peakSpeed.value).toBeLessThanOrEqual(0.2 * SPEED_OF_LIGHT.value + 1e-3);
  });

  test("solves transverse motion on a coast-capped trajectory", () => {
    const scenario = requireScenario(
      transferScenario(
        vector3(meters(3e11), meters(4e11), meters(12e11)),
        0.01 * SPEED_OF_LIGHT.value,
        vector3(metersPerSecond(1_000), metersPerSecond(0), metersPerSecond(0)),
      ),
    );
    const result = simulateInSystemTransfer(scenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:terra-transfer-destination",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.timeline.phases.map((phase) => phase.kind)).toEqual([
      "acceleration",
      "coast",
      "braking",
    ]);
    expect(result.timeline.terminalResiduals.position.value).toBeLessThan(1e-3);
    expect(result.timeline.terminalResiduals.velocity.value).toBeLessThan(1e-6);
    expect(result.timeline.peakSpeed.value).toBeLessThanOrEqual(0.01 * SPEED_OF_LIGHT.value + 1e-3);
  });

  test("keeps both clocks finite and monotonic for a days-long capped transfer", () => {
    const scenario = requireScenario(transferScenario(1e15));
    const result = simulateInSystemTransfer(scenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:terra-transfer-destination",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const gamma = 1 / Math.sqrt(1 - 0.2 ** 2);
    const accelerationDuration = (SPEED_OF_LIGHT.value / 10) * gamma * 0.2;
    const poweredDistance = 2 * (SPEED_OF_LIGHT.value ** 2 / 10) * (gamma - 1);
    const coastDuration = (1e15 - poweredDistance) / (0.2 * SPEED_OF_LIGHT.value);
    const expectedDuration = 2 * accelerationDuration + coastDuration;

    expect(result.timeline.totalClusterCoordinateTime.value).toBeGreaterThan(86_400 * 30);
    expect(result.timeline.totalClusterCoordinateTime.value).toBeCloseTo(expectedDuration, 3);
    expect(result.timeline.totalShipProperTime.value).toBeGreaterThan(0);
    expect(result.timeline.totalShipProperTime.value).toBeLessThan(
      result.timeline.totalClusterCoordinateTime.value,
    );
    for (const phase of result.timeline.phases) {
      expect(phase.end.clusterCoordinateTime.value).toBeGreaterThanOrEqual(
        phase.start.clusterCoordinateTime.value,
      );
      expect(phase.end.shipProperTime.value).toBeGreaterThanOrEqual(
        phase.start.shipProperTime.value,
      );
    }
  });

  test("distinguishes infeasible profiles from non-convergent transfers", () => {
    const infeasibleScenario = requireScenario(
      transferScenario(
        1e9,
        0.2 * SPEED_OF_LIGHT.value,
        vector3(
          metersPerSecond(0.3 * SPEED_OF_LIGHT.value),
          metersPerSecond(0),
          metersPerSecond(0),
        ),
      ),
    );
    const infeasible = simulateInSystemTransfer(infeasibleScenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:terra-transfer-destination",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
    });
    expect(infeasible.ok).toBe(false);
    if (!infeasible.ok) {
      expect(infeasible.issues.some((issue) => issue.code === "infeasible-transfer")).toBe(true);
    }

    const noZpzScenario = requireScenario({
      ...transferScenario(1e9),
      shipProfiles: [
        {
          ...at(minimalScenario.shipProfiles, 0),
          hasZpzGenerator: false,
        },
      ],
    });
    const noZpz = simulateInSystemTransfer(noZpzScenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:terra-transfer-destination",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
    });
    expect(noZpz.ok).toBe(false);
    if (!noZpz.ok) {
      expect(noZpz.issues.some((issue) => issue.code === "missing-zpz-generator")).toBe(true);
    }

    const invalidProfileBase = requireScenario(transferScenario(1e9));
    const invalidProfile = Object.freeze({
      ...at(invalidProfileBase.shipProfiles, 0),
      acceleration: metersPerSecondSquared(0),
    });
    const invalidScenario = Object.freeze({
      ...invalidProfileBase,
      index: Object.freeze({
        ...invalidProfileBase.index,
        shipProfiles: Object.freeze({
          ...invalidProfileBase.index.shipProfiles,
          get: () => invalidProfile,
        }),
      }),
    }) as unknown as CompiledScenario;
    const invalidProfileResult = simulateInSystemTransfer(invalidScenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:terra-transfer-destination",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
    });
    expect(invalidProfileResult.ok).toBe(false);
    if (!invalidProfileResult.ok) {
      expect(
        invalidProfileResult.issues.some((issue) => issue.code === "invalid-ship-profile"),
      ).toBe(true);
    }

    const nonConvergentScenario = requireScenario(transferScenario(1e20));
    const nonConvergent = simulateInSystemTransfer(nonConvergentScenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:terra-transfer-destination",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
    });
    expect(nonConvergent.ok).toBe(false);
    if (!nonConvergent.ok) {
      expect(nonConvergent.issues.some((issue) => issue.code === "non-convergent-transfer")).toBe(
        true,
      );
    }
  });
});
