import {
  SPEED_OF_LIGHT,
  meters,
  metersPerSecond,
  seconds,
  type Meters,
  type MetersPerSecond,
  type Seconds,
} from "./quantities";
import type { CompiledGate, CompiledScenario, DomainEntityType, StableId } from "./model";

const stableIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FIXED_CRUISE_BETA = 0.999;
const zeroSeconds = seconds(0);

/**
 * The fixed Cluster Frame speed used by every initial-model Interstellar Cruise.
 */
export const INTERSTELLAR_CRUISE_SPEED: MetersPerSecond = metersPerSecond(
  FIXED_CRUISE_BETA * SPEED_OF_LIGHT.value,
);

/**
 * The kinds of elapsed-time phases in a fixed-gate Journey Timeline.
 */
export type JourneyPhaseKind =
  | "departure-transition"
  | "interstellar-cruise"
  | "arrival-transition";

/**
 * The observable events at the boundaries of a fixed-gate Journey.
 */
export type JourneyEventKind = "departure" | "cruise-departure" | "cruise-arrival" | "arrival";

/**
 * The three clocks reported at one point in a Journey.
 */
export type JourneyClockReading = {
  readonly clusterCoordinateTime: Seconds;
  readonly shipProperTime: Seconds;
  readonly agingDifference: Seconds;
};

/**
 * A Journey event with cumulative Cluster Coordinate Time, Ship Proper Time, and Aging Difference.
 */
export type JourneyTimelineEvent = {
  readonly kind: JourneyEventKind;
  readonly phase: JourneyPhaseKind;
  readonly clocks: JourneyClockReading;
  readonly cumulativeClusterCoordinateTime: Seconds;
  readonly cumulativeShipProperTime: Seconds;
  readonly cumulativeAgingDifference: Seconds;
};

/**
 * One elapsed-time phase and its clock readings at the phase boundaries.
 */
export type JourneyPhase = {
  readonly kind: JourneyPhaseKind;
  readonly clusterCoordinateDuration: Seconds;
  readonly shipProperDuration: Seconds;
  readonly agingDifference: Seconds;
  readonly start: JourneyClockReading;
  readonly end: JourneyClockReading;
};

/**
 * A fixed-gate Journey Timeline containing every transition, cruise, and cumulative clock reading.
 */
export type JourneyTimeline = {
  readonly departureGateId: StableId;
  readonly destinationGateId: StableId;
  readonly shipProfileId: StableId;
  readonly departureCoordinateTime: Seconds;
  readonly distance: Meters;
  readonly cruiseSpeed: MetersPerSecond;
  readonly phases: readonly JourneyPhase[];
  readonly events: readonly JourneyTimelineEvent[];
  readonly total: JourneyClockReading;
  readonly totalClusterCoordinateTime: Seconds;
  readonly totalShipProperTime: Seconds;
  readonly totalAgingDifference: Seconds;
};

/**
 * The fixed-gate simulation request accepted at the Journey Model boundary.
 *
 * `cruiseSpeed` is explicit so callers can document the contract value; `undefined` selects the
 * model's fixed `0.999c` value. `departureCoordinateTime` is the absolute Scenario coordinate
 * time at which the Journey begins; `undefined` selects the Scenario epoch.
 */
export type JourneySimulationRequest = {
  readonly departureGateId: StableId;
  readonly destinationGateId: StableId;
  readonly shipProfileId: StableId;
  readonly departureCoordinateTime: Seconds | undefined;
  readonly cruiseSpeed: MetersPerSecond | undefined;
};

/**
 * A convenience request shape for callers that always use the model's fixed cruise speed.
 */
export type FixedGateCruiseRequest = Omit<JourneySimulationRequest, "cruiseSpeed"> & {
  readonly cruiseSpeed: undefined;
};

/**
 * Structured failure categories produced while simulating a fixed-gate Journey.
 */
export type SimulationIssueCode =
  | "invalid-request"
  | "unknown-gate"
  | "unknown-ship-profile"
  | "invalid-gate-pairing"
  | "missing-zpz-generator"
  | "invalid-distance"
  | "invalid-speed"
  | "non-stationary-gate";

/**
 * A structured explanation of one rejected Journey simulation request.
 */
export type SimulationIssue = {
  readonly code: SimulationIssueCode;
  readonly path: string;
  readonly message: string;
  readonly entityType: DomainEntityType | undefined;
  readonly entityId: StableId | undefined;
  readonly relatedId: StableId | undefined;
};

/**
 * The successful result of a fixed-gate Journey simulation.
 */
export type JourneySimulationSuccess = {
  readonly ok: true;
  readonly timeline: JourneyTimeline;
  readonly issues: readonly [];
};

/**
 * The unsuccessful result of a fixed-gate Journey simulation.
 */
export type JourneySimulationFailure = {
  readonly ok: false;
  readonly timeline: undefined;
  readonly issues: readonly SimulationIssue[];
};

/**
 * The discriminated result returned by fixed-gate Journey simulation.
 */
export type JourneySimulationResult = JourneySimulationSuccess | JourneySimulationFailure;

/**
 * Adds a deterministic structured simulation issue to an issue collection.
 *
 * @param issues - The mutable collection used during one simulation attempt.
 * @param code - The stable failure category.
 * @param path - The request or Scenario path associated with the failure.
 * @param message - A human-readable explanation.
 * @param entityType - The affected domain entity type, when known.
 * @param entityId - The affected domain entity identifier, when known.
 * @param relatedId - A related entity identifier, when known.
 */
function addIssue(
  issues: SimulationIssue[],
  code: SimulationIssueCode,
  path: string,
  message: string,
  entityType: DomainEntityType | undefined,
  entityId: StableId | undefined,
  relatedId: StableId | undefined,
): void {
  issues.push(
    Object.freeze({
      code,
      path,
      message,
      entityType,
      entityId,
      relatedId,
    }),
  );
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: RecordValue, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function issueComparator(left: SimulationIssue, right: SimulationIssue): number {
  const pathComparison = left.path.localeCompare(right.path);
  if (pathComparison !== 0) {
    return pathComparison;
  }

  return left.code.localeCompare(right.code);
}

function failure(issues: readonly SimulationIssue[]): JourneySimulationFailure {
  return Object.freeze({
    ok: false as const,
    timeline: undefined,
    issues: Object.freeze([...issues].sort(issueComparator)),
  });
}

function readRequestId(
  record: RecordValue,
  key: string,
  issues: SimulationIssue[],
): StableId | undefined {
  const value = record[key];
  if (typeof value !== "string") {
    addIssue(
      issues,
      "invalid-request",
      `request.${key}`,
      `request.${key} must be a stable identifier string.`,
      undefined,
      undefined,
      undefined,
    );
    return undefined;
  }

  if (stableIdentifierPattern.test(value)) {
    return value as StableId;
  }

  addIssue(
    issues,
    "invalid-request",
    `request.${key}`,
    `request.${key} must be a stable identifier.`,
    undefined,
    undefined,
    undefined,
  );
  return undefined;
}

function readSeconds(value: unknown, path: string, issues: SimulationIssue[]): Seconds | undefined {
  if (!isRecord(value) || value.unit !== "s" || typeof value.value !== "number") {
    addIssue(
      issues,
      "invalid-request",
      path,
      `${path} must be a finite SI quantity with unit s.`,
      undefined,
      undefined,
      undefined,
    );
    return undefined;
  }

  if (!Number.isFinite(value.value)) {
    addIssue(
      issues,
      "invalid-request",
      path,
      `${path} must contain a finite numeric value.`,
      undefined,
      undefined,
      undefined,
    );
    return undefined;
  }

  return seconds(value.value);
}

function readCruiseSpeed(
  record: RecordValue,
  issues: SimulationIssue[],
): MetersPerSecond | undefined {
  if (!hasOwn(record, "cruiseSpeed") || record.cruiseSpeed === undefined) {
    return INTERSTELLAR_CRUISE_SPEED;
  }

  const value = record.cruiseSpeed;
  if (!isRecord(value) || value.unit !== "m/s" || typeof value.value !== "number") {
    addIssue(
      issues,
      "invalid-speed",
      "request.cruiseSpeed",
      "request.cruiseSpeed must be a finite SI speed quantity.",
      undefined,
      undefined,
      undefined,
    );
    return undefined;
  }

  if (!Number.isFinite(value.value) || value.value <= 0 || value.value >= SPEED_OF_LIGHT.value) {
    addIssue(
      issues,
      "invalid-speed",
      "request.cruiseSpeed",
      `request.cruiseSpeed must be finite, greater than zero, and below ${SPEED_OF_LIGHT.value} m/s.`,
      undefined,
      undefined,
      undefined,
    );
    return undefined;
  }

  return metersPerSecond(value.value);
}

function gateSpeed(gate: CompiledGate): number {
  return Math.hypot(
    gate.velocityAtEpoch.x.value,
    gate.velocityAtEpoch.y.value,
    gate.velocityAtEpoch.z.value,
  );
}

function gateDistance(departureGate: CompiledGate, destinationGate: CompiledGate): number {
  return Math.hypot(
    destinationGate.positionAtEpoch.x.value - departureGate.positionAtEpoch.x.value,
    destinationGate.positionAtEpoch.y.value - departureGate.positionAtEpoch.y.value,
    destinationGate.positionAtEpoch.z.value - departureGate.positionAtEpoch.z.value,
  );
}

function paired(
  scenario: CompiledScenario,
  departureGateId: StableId,
  destinationGateId: StableId,
): boolean {
  return scenario.gateConnections.some(
    (connection) =>
      (connection.gateAId === departureGateId && connection.gateBId === destinationGateId) ||
      (connection.gateAId === destinationGateId && connection.gateBId === departureGateId),
  );
}

function clocks(clusterCoordinateTime: Seconds, shipProperTime: Seconds): JourneyClockReading {
  return Object.freeze({
    clusterCoordinateTime,
    shipProperTime,
    agingDifference: seconds(clusterCoordinateTime.value - shipProperTime.value),
  });
}

function phase(
  kind: JourneyPhaseKind,
  start: JourneyClockReading,
  end: JourneyClockReading,
): JourneyPhase {
  return Object.freeze({
    kind,
    clusterCoordinateDuration: seconds(
      end.clusterCoordinateTime.value - start.clusterCoordinateTime.value,
    ),
    shipProperDuration: seconds(end.shipProperTime.value - start.shipProperTime.value),
    agingDifference: seconds(end.agingDifference.value - start.agingDifference.value),
    start,
    end,
  });
}

function event(
  kind: JourneyEventKind,
  phaseKind: JourneyPhaseKind,
  reading: JourneyClockReading,
): JourneyTimelineEvent {
  return Object.freeze({
    kind,
    phase: phaseKind,
    clocks: reading,
    cumulativeClusterCoordinateTime: reading.clusterCoordinateTime,
    cumulativeShipProperTime: reading.shipProperTime,
    cumulativeAgingDifference: reading.agingDifference,
  });
}

function timeline(
  departureGate: CompiledGate,
  destinationGate: CompiledGate,
  shipProfileId: StableId,
  departureCoordinateTime: Seconds,
  distance: Meters,
  cruiseSpeed: MetersPerSecond,
): JourneyTimeline {
  const coordinateDuration = seconds(distance.value / cruiseSpeed.value);
  const properTimeFactor = Math.sqrt(1 - FIXED_CRUISE_BETA ** 2);
  const properDuration = seconds(coordinateDuration.value * properTimeFactor);
  const departure = clocks(zeroSeconds, zeroSeconds);
  const cruiseDeparture = clocks(zeroSeconds, zeroSeconds);
  const cruiseArrival = clocks(coordinateDuration, properDuration);
  const arrival = cruiseArrival;
  const phases = Object.freeze([
    phase("departure-transition", departure, cruiseDeparture),
    phase("interstellar-cruise", cruiseDeparture, cruiseArrival),
    phase("arrival-transition", cruiseArrival, arrival),
  ]);
  const events = Object.freeze([
    event("departure", "departure-transition", departure),
    event("cruise-departure", "interstellar-cruise", cruiseDeparture),
    event("cruise-arrival", "interstellar-cruise", cruiseArrival),
    event("arrival", "arrival-transition", arrival),
  ]);

  return Object.freeze({
    departureGateId: departureGate.id,
    destinationGateId: destinationGate.id,
    shipProfileId,
    departureCoordinateTime,
    distance,
    cruiseSpeed,
    phases,
    events,
    total: arrival,
    totalClusterCoordinateTime: arrival.clusterCoordinateTime,
    totalShipProperTime: arrival.shipProperTime,
    totalAgingDifference: arrival.agingDifference,
  });
}

/**
 * Simulates one fixed-gate Interstellar Cruise through the public Journey Model seam.
 *
 * The endpoint Gates must be the paired members of one Gate Connection and stationary in the
 * Cluster Frame. Gate transitions are ZPZ-protected zero-duration phases. The cruise travels at
 * exactly `0.999c`; its Ship Proper Time is derived from the special-relativistic Lorentz factor.
 *
 * @param scenario - The immutable, previously compiled Scenario to simulate.
 * @param request - An unknown request value validated at this model boundary.
 * @returns A complete immutable Journey Timeline or deterministic structured simulation issues.
 */
export function simulateJourney(
  scenario: CompiledScenario,
  request: unknown,
): JourneySimulationResult {
  const issues: SimulationIssue[] = [];
  if (!isRecord(request)) {
    addIssue(
      issues,
      "invalid-request",
      "request",
      "Journey simulation request must be an object.",
      undefined,
      undefined,
      undefined,
    );
    return failure(issues);
  }

  const departureGateId = readRequestId(request, "departureGateId", issues);
  const destinationGateId = readRequestId(request, "destinationGateId", issues);
  const shipProfileId = readRequestId(request, "shipProfileId", issues);
  const departureTimeValue = hasOwn(request, "departureCoordinateTime")
    ? request.departureCoordinateTime
    : hasOwn(request, "departureTime")
      ? request.departureTime
      : scenario.epoch.coordinateTime;
  const departureCoordinateTime =
    departureTimeValue === undefined
      ? scenario.epoch.coordinateTime
      : readSeconds(departureTimeValue, "request.departureCoordinateTime", issues);
  const cruiseSpeed = readCruiseSpeed(request, issues);

  const departureGate =
    departureGateId === undefined ? undefined : scenario.index.gates.get(departureGateId);
  const destinationGate =
    destinationGateId === undefined ? undefined : scenario.index.gates.get(destinationGateId);
  const shipProfile =
    shipProfileId === undefined ? undefined : scenario.index.shipProfiles.get(shipProfileId);

  if (departureGateId !== undefined && departureGate === undefined) {
    addIssue(
      issues,
      "unknown-gate",
      "request.departureGateId",
      `Departure Gate ${departureGateId} does not exist in the compiled Scenario.`,
      "gate",
      departureGateId,
      undefined,
    );
  }
  if (destinationGateId !== undefined && destinationGate === undefined) {
    addIssue(
      issues,
      "unknown-gate",
      "request.destinationGateId",
      `Destination Gate ${destinationGateId} does not exist in the compiled Scenario.`,
      "gate",
      destinationGateId,
      undefined,
    );
  }
  if (shipProfileId !== undefined && shipProfile === undefined) {
    addIssue(
      issues,
      "unknown-ship-profile",
      "request.shipProfileId",
      `Ship Profile ${shipProfileId} does not exist in the compiled Scenario.`,
      "ship-profile",
      shipProfileId,
      undefined,
    );
  }
  if (shipProfile !== undefined && !shipProfile.hasZpzGenerator) {
    addIssue(
      issues,
      "missing-zpz-generator",
      "shipProfile.hasZpzGenerator",
      `Ship Profile ${shipProfile.id} cannot travel through a Gate of Heaven without a ZPZ Generator.`,
      "ship-profile",
      shipProfile.id,
      undefined,
    );
  }

  if (
    departureGate !== undefined &&
    destinationGate !== undefined &&
    (departureGate.id === destinationGate.id ||
      !paired(scenario, departureGate.id, destinationGate.id))
  ) {
    addIssue(
      issues,
      "invalid-gate-pairing",
      "request.destinationGateId",
      `Gates ${departureGate.id} and ${destinationGate.id} are not paired by one Gate Connection.`,
      "gate",
      departureGate.id,
      destinationGate.id,
    );
  }

  if (cruiseSpeed !== undefined && cruiseSpeed.value !== INTERSTELLAR_CRUISE_SPEED.value) {
    addIssue(
      issues,
      "invalid-speed",
      "request.cruiseSpeed",
      `Interstellar Cruise speed must be exactly ${INTERSTELLAR_CRUISE_SPEED.value} m/s (0.999c).`,
      undefined,
      undefined,
      undefined,
    );
  }

  if (departureGate !== undefined && destinationGate !== undefined) {
    const departureSpeed = gateSpeed(departureGate);
    const destinationSpeed = gateSpeed(destinationGate);
    if (
      !Number.isFinite(departureSpeed) ||
      !Number.isFinite(destinationSpeed) ||
      departureSpeed >= SPEED_OF_LIGHT.value ||
      destinationSpeed >= SPEED_OF_LIGHT.value
    ) {
      addIssue(
        issues,
        "invalid-speed",
        "gates.velocityAtEpoch",
        "Fixed-gate simulation requires endpoint Gate velocities below the speed of light.",
        "gate",
        departureGate.id,
        destinationGate.id,
      );
    }
    if (departureSpeed !== 0) {
      addIssue(
        issues,
        "non-stationary-gate",
        "request.departureGateId",
        `Departure Gate ${departureGate.id} must be stationary in the Cluster Frame.`,
        "gate",
        departureGate.id,
        undefined,
      );
    }
    if (destinationSpeed !== 0) {
      addIssue(
        issues,
        "non-stationary-gate",
        "request.destinationGateId",
        `Destination Gate ${destinationGate.id} must be stationary in the Cluster Frame.`,
        "gate",
        destinationGate.id,
        undefined,
      );
    }

    const distanceValue = gateDistance(departureGate, destinationGate);
    if (!Number.isFinite(distanceValue) || distanceValue <= 0) {
      addIssue(
        issues,
        "invalid-distance",
        "gates.positionAtEpoch",
        "Fixed-gate simulation requires a finite, positive endpoint distance.",
        "gate",
        departureGate.id,
        destinationGate.id,
      );
    }

    if (issues.length === 0 && departureCoordinateTime !== undefined && cruiseSpeed !== undefined) {
      const distance = meters(distanceValue);
      const resultTimeline = timeline(
        departureGate,
        destinationGate,
        shipProfileId as StableId,
        departureCoordinateTime,
        distance,
        cruiseSpeed,
      );
      if (
        !Number.isFinite(resultTimeline.totalClusterCoordinateTime.value) ||
        !Number.isFinite(resultTimeline.totalShipProperTime.value)
      ) {
        addIssue(
          issues,
          "invalid-distance",
          "gates.positionAtEpoch",
          "Fixed-gate simulation produced a non-finite elapsed time.",
          "gate",
          departureGate.id,
          destinationGate.id,
        );
      } else {
        return Object.freeze({ ok: true as const, timeline: resultTimeline, issues: [] as const });
      }
    }
  }

  return failure(issues);
}

/**
 * Simulates the fixed-gate cruise under the explicit name used by the initial physics milestone.
 *
 * @param scenario - The immutable compiled Scenario containing the endpoint Gates.
 * @param request - The fixed-gate cruise request to validate and simulate.
 * @returns The same immutable result returned by {@link simulateJourney}.
 */
export const simulateFixedGateCruise = simulateJourney;
