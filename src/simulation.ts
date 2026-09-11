import {
  SPEED_OF_LIGHT,
  meters,
  metersPerSecond,
  seconds,
  type Meters,
  type MetersPerSecond,
  type PositionVector,
  type Seconds,
  type VelocityVector,
} from "./quantities";
import { evaluateGateWorldline } from "./orbital";
import { simulateInSystemTransfer } from "./in-system-transfer";
import type {
  InSystemTransferEvent,
  InSystemTransferRequest,
  InSystemTransferSimulationResult,
  InSystemTransferTimeline,
} from "./in-system-transfer";
import {
  addVector,
  scaleVector,
  subtractVector,
  type NumericVector3,
  vectorMagnitude,
} from "./vector";
import type {
  CompiledScenario,
  DomainEntityType,
  GateWorldline,
  StableId,
  WorldlineIssue,
} from "./model";

const stableIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FIXED_CRUISE_BETA = 0.999;
const zeroSeconds = seconds(0);
const MAX_INTERCEPT_ITERATIONS = 160;
const INTERCEPT_POSITION_TOLERANCE_FACTOR = 1e-13;
const INTERCEPT_MINIMUM_POSITION_TOLERANCE = 1;
const INTERCEPT_TIME_TOLERANCE = 1e-7;

/**
 * The fixed Cluster Frame speed used by every initial-model Interstellar Cruise.
 */
export const INTERSTELLAR_CRUISE_SPEED: MetersPerSecond = metersPerSecond(
  FIXED_CRUISE_BETA * SPEED_OF_LIGHT.value,
);

/**
 * The maximum duration searched while bracketing a future Arrival Intercept.
 */
export const INTERCEPT_MAX_SEARCH_SECONDS = 1e16;

/**
 * The relative position-residual factor used by the intercept solver. This is a numerical
 * tolerance, not a physical uncertainty bound.
 */
export const INTERCEPT_POSITION_RESIDUAL_FACTOR = INTERCEPT_POSITION_TOLERANCE_FACTOR;

/**
 * Relative position-residual tolerance used while refining a moving-Gate intercept.
 */
export const INTERCEPT_POSITION_RESIDUAL_TOLERANCE = INTERCEPT_POSITION_TOLERANCE_FACTOR;

/**
 * Base absolute time-interval tolerance used while refining a moving-Gate intercept.
 *
 * The effective contract is the greater of this value and the IEEE-754 representable spacing at
 * the candidate duration and absolute arrival coordinate time. This keeps the bounded contract
 * explicit at long horizons where a smaller fixed tolerance cannot be represented.
 */
export const INTERCEPT_TIME_RESIDUAL_TOLERANCE = INTERCEPT_TIME_TOLERANCE;

/**
 * The kinds of elapsed-time phases in a Journey Timeline.
 */
export type JourneyPhaseKind =
  | "departure-transition"
  | "interstellar-cruise"
  | "arrival-transition"
  | "in-system-transfer"
  | "dwell";

/**
 * The observable events at the boundaries of Journey phases.
 */
export type JourneyEventKind =
  | "departure"
  | "gate-departure"
  | "cruise-departure"
  | "cruise-arrival"
  | "gate-arrival"
  | "arrival"
  | "dwell-start"
  | "dwell-end"
  | "transfer-departure"
  | "transfer-acceleration-end"
  | "transfer-coast-start"
  | "transfer-flip"
  | "transfer-arrival";

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
 * The numerical result of solving one moving destination-Gate intercept.
 */
export type ArrivalIntercept = {
  readonly destinationGateId: StableId;
  readonly coordinateTime: Seconds;
  readonly duration: Seconds;
  readonly position: PositionVector;
  readonly velocity: VelocityVector;
  readonly cruiseVelocity: VelocityVector;
  readonly positionResidual: Meters;
  readonly timeResidual: Seconds;
};

/**
 * An immutable Journey Timeline containing every transition, cruise, and cumulative clock reading.
 *
 * Endpoint states are evaluated on the departure and destination Gate worldlines. The arrival
 * transition therefore reports the destination Gate's instantaneous position and velocity rather
 * than reusing its state at the Journey departure epoch.
 */
export type JourneyTimeline = {
  readonly departureGateId: StableId;
  readonly destinationGateId: StableId;
  readonly shipProfileId: StableId;
  readonly departureCoordinateTime: Seconds;
  readonly arrivalCoordinateTime: Seconds;
  readonly distance: Meters;
  readonly cruiseSpeed: MetersPerSecond;
  readonly cruiseVelocity: VelocityVector;
  readonly departurePosition: PositionVector;
  readonly departureVelocity: VelocityVector;
  readonly arrivalPosition: PositionVector;
  readonly arrivalVelocity: VelocityVector;
  readonly arrivalIntercept: ArrivalIntercept;
  readonly phases: readonly JourneyPhase[];
  readonly events: readonly JourneyTimelineEvent[];
  readonly total: JourneyClockReading;
  readonly totalClusterCoordinateTime: Seconds;
  readonly totalShipProperTime: Seconds;
  readonly totalAgingDifference: Seconds;
};

/**
 * A Dwell timeline with the Gate worldline's integrated Ship Proper Time.
 */
export type JourneyDwellTimeline = {
  readonly kind: "dwell";
  readonly gateId: StableId;
  readonly shipProfileId: StableId;
  readonly departureCoordinateTime: Seconds;
  readonly arrivalCoordinateTime: Seconds;
  readonly duration: Seconds;
  readonly properDuration: Seconds;
  readonly agingDifference: Seconds;
  readonly departurePosition: PositionVector;
  readonly departureVelocity: VelocityVector;
  readonly arrivalPosition: PositionVector;
  readonly arrivalVelocity: VelocityVector;
  readonly clocks: JourneyClockReading;
};

/**
 * One phase in a composed Journey Timeline. `startCoordinateTime` and `endCoordinateTime` are
 * absolute Scenario times; `start` and `end` are cumulative clocks relative to Journey departure.
 */
export type MultiLegJourneyPhase = {
  readonly kind: JourneyPhaseKind;
  readonly stepIndex: number;
  readonly departureGateId: StableId;
  readonly destinationGateId: StableId;
  readonly startCoordinateTime: Seconds;
  readonly endCoordinateTime: Seconds;
  readonly clusterCoordinateDuration: Seconds;
  readonly shipProperDuration: Seconds;
  readonly agingDifference: Seconds;
  readonly start: JourneyClockReading;
  readonly end: JourneyClockReading;
  readonly startPosition: PositionVector;
  readonly endPosition: PositionVector;
  readonly startVelocity: VelocityVector;
  readonly endVelocity: VelocityVector;
  readonly cruise: JourneyTimeline | undefined;
  readonly transfer: InSystemTransferTimeline | undefined;
  readonly dwell: JourneyDwellTimeline | undefined;
};

/**
 * A composed Journey event with an absolute epoch and cumulative clocks.
 */
export type MultiLegJourneyTimelineEvent = JourneyTimelineEvent & {
  readonly coordinateTime: Seconds;
  readonly stepIndex: number;
  readonly gateId: StableId | undefined;
  readonly position: PositionVector | undefined;
  readonly velocity: VelocityVector | undefined;
};

/**
 * One elapsed-time leg and its detailed single-leg simulation result in a composed Journey.
 */
export type MultiLegJourneyLeg = {
  readonly kind: JourneyLegKind;
  readonly stepIndex: number;
  readonly departureGateId: StableId;
  readonly destinationGateId: StableId;
  readonly startCoordinateTime: Seconds;
  readonly endCoordinateTime: Seconds;
  readonly timeline: JourneyTimeline | InSystemTransferTimeline | JourneyDwellTimeline;
};

/**
 * An immutable end-to-end Journey Timeline for one ship and Ship Profile.
 */
export type MultiLegJourneyTimeline = {
  readonly kind: "journey";
  readonly departureGateId: StableId;
  readonly destinationGateId: StableId;
  readonly shipProfileId: StableId;
  readonly departureCoordinateTime: Seconds;
  readonly arrivalCoordinateTime: Seconds;
  readonly departurePosition: PositionVector;
  readonly departureVelocity: VelocityVector;
  readonly arrivalPosition: PositionVector;
  readonly arrivalVelocity: VelocityVector;
  readonly legs: readonly MultiLegJourneyLeg[];
  readonly phases: readonly MultiLegJourneyPhase[];
  readonly events: readonly MultiLegJourneyTimelineEvent[];
  readonly clocks: JourneyClockReading;
};

/**
 * The moving-Gate Interstellar Cruise request accepted at the Journey Model boundary.
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
 * Descriptive alias for the single Interstellar Cruise request accepted by the Journey seam.
 */
export type InterstellarCruiseRequest = JourneySimulationRequest;

/**
 * The supported elapsed-time legs in a composed Journey.
 */
export type JourneyLegKind = "interstellar-cruise" | "in-system-transfer" | "dwell";

/**
 * One Interstellar Cruise leg in a composed Journey. The departure Gate is the preceding leg's
 * destination and is therefore not repeated in the route.
 */
export type JourneyCruiseLeg = {
  readonly kind: "interstellar-cruise";
  readonly destinationGateId: StableId;
};

/**
 * One powered In-system Transfer leg in a composed Journey.
 */
export type JourneyTransferLeg = {
  readonly kind: "in-system-transfer";
  readonly destinationGateId: StableId;
};

/**
 * A Dwell leg whose Gate is the preceding leg's destination.
 */
export type JourneyDwellLeg = {
  readonly kind: "dwell";
  readonly duration: Seconds;
};

/**
 * One validated-shape leg supplied to a composed Journey request.
 */
export type JourneyLeg = JourneyCruiseLeg | JourneyTransferLeg | JourneyDwellLeg;

/**
 * A tagged composed Journey request using the `legs` property.
 */
export type MultiLegJourneyRequest = {
  readonly kind: "journey";
  readonly departureGateId: StableId;
  readonly destinationGateId: StableId;
  readonly shipProfileId: StableId;
  readonly departureCoordinateTime: Seconds | undefined;
  readonly legs: readonly JourneyLeg[];
};

/**
 * The composed Journey request accepted by the public Journey simulation seam.
 */
export type JourneyRequest = MultiLegJourneyRequest;

/**
 * A convenience request shape for callers that always use the model's fixed cruise speed.
 */
export type FixedGateCruiseRequest = Omit<InterstellarCruiseRequest, "cruiseSpeed"> & {
  readonly cruiseSpeed: undefined;
};

/**
 * Structured failure categories produced while simulating an Interstellar Cruise.
 */
export type SimulationIssueCode =
  | "invalid-request"
  | "unknown-gate"
  | "unknown-ship-profile"
  | "invalid-gate-pairing"
  | "missing-zpz-generator"
  | "invalid-distance"
  | "invalid-speed"
  | "non-stationary-gate"
  | "invalid-coordinate-time"
  | "invalid-orbital-elements"
  | "non-convergent-orbit"
  | "non-finite-worldline"
  | "non-convergent-intercept"
  | "invalid-journey-request"
  | "invalid-journey-step"
  | "invalid-dwell-duration"
  | "journey-endpoint-mismatch"
  | "invalid-coordinate-state"
  | "invalid-transfer-endpoints"
  | "invalid-ship-profile"
  | "infeasible-transfer"
  | "non-convergent-transfer";

/**
 * A structured explanation of one rejected Journey simulation request or numerical solve.
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
 * The successful result of a moving-Gate Interstellar Cruise simulation.
 */
export type JourneySimulationSuccess = {
  readonly ok: true;
  readonly timeline: JourneyTimeline;
  readonly issues: readonly [];
};

/**
 * The unsuccessful result of a moving-Gate Interstellar Cruise simulation.
 */
export type JourneySimulationFailure = {
  readonly ok: false;
  readonly timeline: undefined;
  readonly issues: readonly SimulationIssue[];
};

/**
 * The discriminated result returned by Interstellar Cruise simulation.
 */
export type JourneySimulationResult = JourneySimulationSuccess | JourneySimulationFailure;

/**
 * The successful result of a composed multi-leg Journey simulation.
 */
export type MultiLegJourneySimulationSuccess = {
  readonly ok: true;
  readonly timeline: MultiLegJourneyTimeline;
  readonly issues: readonly [];
};

/**
 * The unsuccessful result of a composed multi-leg Journey simulation.
 */
export type MultiLegJourneySimulationFailure = {
  readonly ok: false;
  readonly timeline: undefined;
  readonly issues: readonly SimulationIssue[];
};

/**
 * The discriminated result returned by composed multi-leg Journey simulation.
 */
export type MultiLegJourneySimulationResult =
  | MultiLegJourneySimulationSuccess
  | MultiLegJourneySimulationFailure;

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

type InterceptEvaluation = {
  readonly duration: number;
  readonly target: GateWorldline;
  readonly residual: number;
};

type InterceptSolution = InterceptEvaluation & {
  readonly timeResidual: number;
};

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
      "invalid-coordinate-time",
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
      "invalid-coordinate-time",
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

function vector(position: NumericVector3): PositionVector {
  return Object.freeze({
    x: meters(position.x),
    y: meters(position.y),
    z: meters(position.z),
  });
}

function velocity(value: NumericVector3): VelocityVector {
  return Object.freeze({
    x: metersPerSecond(value.x),
    y: metersPerSecond(value.y),
    z: metersPerSecond(value.z),
  });
}

function numericPosition(value: PositionVector): NumericVector3 {
  return { x: value.x.value, y: value.y.value, z: value.z.value };
}

function numericVelocity(value: VelocityVector): NumericVector3 {
  return { x: value.x.value, y: value.y.value, z: value.z.value };
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

function addWorldlineIssues(
  worldlineIssues: readonly WorldlineIssue[],
  issues: SimulationIssue[],
): void {
  for (const worldlineIssue of worldlineIssues) {
    addIssue(
      issues,
      worldlineIssue.code,
      worldlineIssue.path,
      worldlineIssue.message,
      worldlineIssue.entityType,
      worldlineIssue.entityId,
      undefined,
    );
  }
}

function targetResidual(
  departurePosition: NumericVector3,
  target: GateWorldline,
  cruiseSpeed: number,
  duration: number,
): number {
  const displacement = subtractVector(numericPosition(target.position), departurePosition);
  return vectorMagnitude(displacement) - cruiseSpeed * duration;
}

function representableTimeSpacing(value: number): number {
  const magnitude = Math.abs(value);
  if (!Number.isFinite(magnitude)) {
    return Number.POSITIVE_INFINITY;
  }
  if (magnitude === 0) {
    return Number.MIN_VALUE;
  }

  const exponent = Math.floor(Math.log2(magnitude));
  return exponent < -1022 ? Number.MIN_VALUE : 2 ** (exponent - 52);
}

function effectiveTimeResidualTolerance(
  departureCoordinateTime: Seconds,
  lowerDuration: number,
  upperDuration: number,
): number {
  return Math.max(
    INTERCEPT_TIME_TOLERANCE,
    representableTimeSpacing(lowerDuration),
    representableTimeSpacing(upperDuration),
    representableTimeSpacing(departureCoordinateTime.value + lowerDuration),
    representableTimeSpacing(departureCoordinateTime.value + upperDuration),
  );
}

function evaluateInterceptAt(
  scenario: CompiledScenario,
  destinationGateId: StableId,
  departurePosition: NumericVector3,
  departureCoordinateTime: Seconds,
  cruiseSpeed: MetersPerSecond,
  duration: number,
):
  | {
      readonly ok: true;
      readonly evaluation: InterceptEvaluation;
    }
  | {
      readonly ok: false;
      readonly issues: readonly WorldlineIssue[];
    } {
  const coordinateTime = seconds(departureCoordinateTime.value + duration);
  const result = evaluateGateWorldline(scenario, destinationGateId, coordinateTime);
  if (!result.ok) {
    return { ok: false, issues: result.issues };
  }

  return {
    ok: true,
    evaluation: {
      duration,
      target: result.state,
      residual: targetResidual(departurePosition, result.state, cruiseSpeed.value, duration),
    },
  };
}

function intercept(
  scenario: CompiledScenario,
  destinationGateId: StableId,
  departurePosition: NumericVector3,
  departureCoordinateTime: Seconds,
  cruiseSpeed: MetersPerSecond,
  issues: SimulationIssue[],
): InterceptSolution | undefined {
  const initial = evaluateInterceptAt(
    scenario,
    destinationGateId,
    departurePosition,
    departureCoordinateTime,
    cruiseSpeed,
    0,
  );
  if (!initial.ok) {
    addWorldlineIssues(initial.issues, issues);
    return undefined;
  }

  let lower = initial.evaluation;
  if (lower.residual <= 0) {
    addIssue(
      issues,
      "invalid-distance",
      "gates.positionAtEpoch",
      "Interstellar Cruise requires distinct departure and destination Gate positions.",
      "gate",
      destinationGateId,
      undefined,
    );
    return undefined;
  }

  let upperDuration = Math.max(1, lower.residual / cruiseSpeed.value);
  let upper: InterceptEvaluation | undefined;
  for (let expansion = 0; expansion < MAX_INTERCEPT_ITERATIONS; expansion += 1) {
    if (!Number.isFinite(upperDuration) || upperDuration > INTERCEPT_MAX_SEARCH_SECONDS) {
      break;
    }
    const candidate = evaluateInterceptAt(
      scenario,
      destinationGateId,
      departurePosition,
      departureCoordinateTime,
      cruiseSpeed,
      upperDuration,
    );
    if (!candidate.ok) {
      addWorldlineIssues(candidate.issues, issues);
      return undefined;
    }
    if (candidate.evaluation.residual <= 0) {
      upper = candidate.evaluation;
      break;
    }
    upperDuration *= 2;
  }

  if (upper === undefined) {
    addIssue(
      issues,
      "non-convergent-intercept",
      `gates.${destinationGateId}`,
      `No future Arrival Intercept for Gate ${destinationGateId} was bracketed within the configured search horizon.`,
      "gate",
      destinationGateId,
      undefined,
    );
    return undefined;
  }

  let best = Math.abs(lower.residual) < Math.abs(upper.residual) ? lower : upper;
  let timeResidual = upper.duration - lower.duration;
  let timeTolerance = effectiveTimeResidualTolerance(
    departureCoordinateTime,
    lower.duration,
    upper.duration,
  );
  let converged = false;
  const positionTolerance = Math.max(
    INTERCEPT_MINIMUM_POSITION_TOLERANCE,
    Math.max(Math.abs(lower.residual), Math.abs(upper.residual)) *
      INTERCEPT_POSITION_TOLERANCE_FACTOR,
  );
  for (let iteration = 0; iteration < MAX_INTERCEPT_ITERATIONS; iteration += 1) {
    const midpointDuration = (lower.duration + upper.duration) / 2;
    const midpointStagnated =
      midpointDuration === lower.duration || midpointDuration === upper.duration;
    const midpoint = evaluateInterceptAt(
      scenario,
      destinationGateId,
      departurePosition,
      departureCoordinateTime,
      cruiseSpeed,
      midpointDuration,
    );
    if (!midpoint.ok) {
      addWorldlineIssues(midpoint.issues, issues);
      return undefined;
    }

    if (Math.abs(midpoint.evaluation.residual) < Math.abs(best.residual)) {
      best = midpoint.evaluation;
    }

    if (!midpointStagnated) {
      if (midpoint.evaluation.residual > 0) {
        lower = midpoint.evaluation;
      } else {
        upper = midpoint.evaluation;
      }
      timeResidual = upper.duration - lower.duration;
    }
    timeTolerance = effectiveTimeResidualTolerance(
      departureCoordinateTime,
      lower.duration,
      upper.duration,
    );
    const positionConverged = Math.abs(midpoint.evaluation.residual) <= positionTolerance;
    const timeConverged = timeResidual <= timeTolerance;
    if (positionConverged && timeConverged) {
      best = midpoint.evaluation;
      converged = true;
      break;
    }
    if (midpointStagnated) {
      break;
    }
  }

  if (!converged) {
    addIssue(
      issues,
      "non-convergent-intercept",
      `gates.${destinationGateId}`,
      `Arrival Intercept for Gate ${destinationGateId} did not satisfy the position residual bound of ${positionTolerance} m and representable time residual bound of ${timeTolerance} s before refinement stopped.`,
      "gate",
      destinationGateId,
      undefined,
    );
    return undefined;
  }

  return Object.freeze({ ...best, timeResidual });
}

function timeline(
  departureGateId: StableId,
  destinationGateId: StableId,
  shipProfileId: StableId,
  departureCoordinateTime: Seconds,
  departure: GateWorldline,
  cruiseSpeed: MetersPerSecond,
  solvedIntercept: InterceptSolution,
): JourneyTimeline {
  const duration = solvedIntercept.duration;
  const destinationPosition = numericPosition(solvedIntercept.target.position);
  const departurePosition = numericPosition(departure.position);
  const displacement = subtractVector(destinationPosition, departurePosition);
  const displacementDistance = vectorMagnitude(displacement);
  const cruiseDirection = scaleVector(displacement, 1 / displacementDistance);
  const cruiseVelocity = scaleVector(cruiseDirection, cruiseSpeed.value);
  const shipArrivalPosition = addVector(departurePosition, scaleVector(cruiseVelocity, duration));
  const positionResidual = vectorMagnitude(
    subtractVector(shipArrivalPosition, destinationPosition),
  );
  const cruiseDuration = seconds(duration);
  const properDuration = seconds(duration * Math.sqrt(1 - FIXED_CRUISE_BETA ** 2));
  const departureReading = clocks(zeroSeconds, zeroSeconds);
  const cruiseDepartureReading = clocks(zeroSeconds, zeroSeconds);
  const cruiseArrivalReading = clocks(cruiseDuration, properDuration);
  const arrivalReading = cruiseArrivalReading;
  const phases = Object.freeze([
    phase("departure-transition", departureReading, cruiseDepartureReading),
    phase("interstellar-cruise", cruiseDepartureReading, cruiseArrivalReading),
    phase("arrival-transition", cruiseArrivalReading, arrivalReading),
  ]);
  const events = Object.freeze([
    event("departure", "departure-transition", departureReading),
    event("cruise-departure", "interstellar-cruise", cruiseDepartureReading),
    event("cruise-arrival", "interstellar-cruise", cruiseArrivalReading),
    event("arrival", "arrival-transition", arrivalReading),
  ]);
  const cruiseVelocityVector = velocity(cruiseVelocity);
  const arrivalIntercept: ArrivalIntercept = Object.freeze({
    destinationGateId,
    coordinateTime: seconds(departureCoordinateTime.value + duration),
    duration: cruiseDuration,
    position: solvedIntercept.target.position,
    velocity: solvedIntercept.target.velocity,
    cruiseVelocity: cruiseVelocityVector,
    positionResidual: meters(positionResidual),
    timeResidual: seconds(solvedIntercept.timeResidual),
  });

  return Object.freeze({
    departureGateId,
    destinationGateId,
    shipProfileId,
    departureCoordinateTime,
    arrivalCoordinateTime: arrivalIntercept.coordinateTime,
    distance: meters(cruiseSpeed.value * duration),
    cruiseSpeed,
    cruiseVelocity: cruiseVelocityVector,
    departurePosition: departure.position,
    departureVelocity: departure.velocity,
    arrivalPosition: arrivalIntercept.position,
    arrivalVelocity: arrivalIntercept.velocity,
    arrivalIntercept,
    phases,
    events,
    total: arrivalReading,
    totalClusterCoordinateTime: arrivalReading.clusterCoordinateTime,
    totalShipProperTime: arrivalReading.shipProperTime,
    totalAgingDifference: arrivalReading.agingDifference,
  });
}

type ParsedJourneyLeg =
  | {
      readonly kind: "interstellar-cruise";
      readonly destinationGateId: StableId;
    }
  | {
      readonly kind: "in-system-transfer";
      readonly destinationGateId: StableId;
    }
  | {
      readonly kind: "dwell";
      readonly duration: Seconds;
    };

type ParsedMultiLegJourneyRequest = {
  readonly departureGateId: StableId;
  readonly destinationGateId: StableId;
  readonly shipProfileId: StableId;
  readonly departureCoordinateTime: Seconds;
  readonly legs: readonly ParsedJourneyLeg[];
};

function isCompositeJourneyRequest(request: RecordValue): boolean {
  return request.kind === "journey";
}

function readJourneyLegId(
  value: unknown,
  path: string,
  issues: SimulationIssue[],
): StableId | undefined {
  if (typeof value === "string" && stableIdentifierPattern.test(value)) {
    return value as StableId;
  }

  addIssue(
    issues,
    "invalid-journey-step",
    path,
    `${path} must be a stable identifier string.`,
    undefined,
    undefined,
    undefined,
  );
  return undefined;
}

function readJourneyLegDuration(
  value: unknown,
  path: string,
  issues: SimulationIssue[],
): Seconds | undefined {
  if (!isRecord(value) || value.unit !== "s" || typeof value.value !== "number") {
    addIssue(
      issues,
      "invalid-dwell-duration",
      path,
      `${path} must be a finite SI duration with unit s.`,
      undefined,
      undefined,
      undefined,
    );
    return undefined;
  }
  if (!Number.isFinite(value.value) || value.value < 0) {
    addIssue(
      issues,
      "invalid-dwell-duration",
      path,
      `${path} must be finite and non-negative.`,
      undefined,
      undefined,
      undefined,
    );
    return undefined;
  }

  return seconds(value.value);
}

function readJourneyLeg(
  value: unknown,
  index: number,
  issues: SimulationIssue[],
): ParsedJourneyLeg | undefined {
  const path = `request.legs[${index}]`;
  if (!isRecord(value)) {
    addIssue(
      issues,
      "invalid-journey-step",
      path,
      `${path} must be an object.`,
      undefined,
      undefined,
      undefined,
    );
    return undefined;
  }

  const kind = value.kind;
  if (kind !== "interstellar-cruise" && kind !== "in-system-transfer" && kind !== "dwell") {
    addIssue(
      issues,
      "invalid-journey-step",
      `${path}.kind`,
      `${path}.kind must be interstellar-cruise, in-system-transfer, or dwell.`,
      undefined,
      undefined,
      undefined,
    );
    return undefined;
  }

  if (kind === "dwell") {
    const duration = readJourneyLegDuration(value.duration, `${path}.duration`, issues);
    return duration === undefined ? undefined : Object.freeze({ kind, duration });
  }

  const destinationGateId = readJourneyLegId(
    value.destinationGateId,
    `${path}.destinationGateId`,
    issues,
  );
  return destinationGateId === undefined ? undefined : Object.freeze({ kind, destinationGateId });
}

function readJourneyLegs(
  request: RecordValue,
  issues: SimulationIssue[],
): readonly ParsedJourneyLeg[] | undefined {
  if (!hasOwn(request, "legs")) {
    addIssue(
      issues,
      "invalid-journey-request",
      "request.legs",
      "A composed Journey request must provide a legs array.",
      undefined,
      undefined,
      undefined,
    );
    return undefined;
  }

  const values = request.legs;
  if (!Array.isArray(values) || values.length === 0) {
    addIssue(
      issues,
      "invalid-journey-request",
      "request.legs",
      "request.legs must be a non-empty array.",
      undefined,
      undefined,
      undefined,
    );
    return undefined;
  }

  const legs: ParsedJourneyLeg[] = [];
  for (const [index, value] of values.entries()) {
    const leg = readJourneyLeg(value, index, issues);
    if (leg !== undefined) {
      legs.push(leg);
    }
  }
  return Object.freeze(legs);
}

function readMultiLegJourneyRequest(
  request: RecordValue,
  defaultDepartureCoordinateTime: Seconds,
  issues: SimulationIssue[],
): ParsedMultiLegJourneyRequest | undefined {
  if (request.kind !== "journey") {
    addIssue(
      issues,
      "invalid-journey-request",
      "request.kind",
      "request.kind must be journey for a composed Journey request.",
      undefined,
      undefined,
      undefined,
    );
  }
  const departureGateId = readRequestId(request, "departureGateId", issues);
  const destinationGateId = readRequestId(request, "destinationGateId", issues);
  const shipProfileId = readRequestId(request, "shipProfileId", issues);
  const departureCoordinateTime = hasOwn(request, "departureCoordinateTime")
    ? request.departureCoordinateTime === undefined
      ? defaultDepartureCoordinateTime
      : readSeconds(request.departureCoordinateTime, "request.departureCoordinateTime", issues)
    : defaultDepartureCoordinateTime;
  const legs = readJourneyLegs(request, issues);
  if (
    departureGateId === undefined ||
    destinationGateId === undefined ||
    shipProfileId === undefined ||
    departureCoordinateTime === undefined ||
    legs === undefined
  ) {
    return undefined;
  }

  return Object.freeze({
    departureGateId,
    destinationGateId,
    shipProfileId,
    departureCoordinateTime,
    legs,
  });
}

function appendSimulationIssues(
  source: readonly SimulationIssue[],
  pathPrefix: string,
  issues: SimulationIssue[],
): void {
  for (const sourceIssue of source) {
    issues.push(
      Object.freeze({
        ...sourceIssue,
        path: `${pathPrefix}.${sourceIssue.path}`,
      }),
    );
  }
}

function appendTransferIssues(
  source: Readonly<InSystemTransferSimulationResult["issues"]>,
  pathPrefix: string,
  issues: SimulationIssue[],
): void {
  for (const sourceIssue of source) {
    issues.push(
      Object.freeze({
        ...sourceIssue,
        code: sourceIssue.code as SimulationIssueCode,
        path: `${pathPrefix}.${sourceIssue.path}`,
      }),
    );
  }
}

function gateHasKeplerianMotion(scenario: CompiledScenario, gateId: StableId): boolean {
  const gate = scenario.index.gates.get(gateId);
  if (gate === undefined || gate.orbitalElements !== undefined) {
    return gate !== undefined && gate.orbitalElements !== undefined;
  }

  let anchorId: StableId | undefined = gate.orbitalAnchorId;
  const visited = new Set<StableId>();
  while (anchorId !== undefined && !visited.has(anchorId)) {
    visited.add(anchorId);
    const anchor = scenario.index.orbitalAnchors.get(anchorId);
    if (anchor === undefined) {
      return false;
    }
    if (anchor.orbitalElements !== undefined) {
      return true;
    }
    anchorId = anchor.parentId;
  }
  return false;
}

function properTimeRate(velocityValue: VelocityVector): number | undefined {
  const speed = Math.hypot(velocityValue.x.value, velocityValue.y.value, velocityValue.z.value);
  if (!Number.isFinite(speed) || speed >= SPEED_OF_LIGHT.value) {
    return undefined;
  }
  return Math.sqrt(Math.max(0, 1 - speed ** 2 / SPEED_OF_LIGHT.value ** 2));
}

function integrateGateProperTime(
  scenario: CompiledScenario,
  gateId: StableId,
  departureCoordinateTime: Seconds,
  duration: Seconds,
  issues: SimulationIssue[],
): number | undefined {
  if (duration.value === 0) {
    return 0;
  }

  const startResult = evaluateGateWorldline(scenario, gateId, departureCoordinateTime);
  if (!startResult.ok) {
    addWorldlineIssues(startResult.issues, issues);
    return undefined;
  }
  const startRate = properTimeRate(startResult.state.velocity);
  if (startRate === undefined) {
    addIssue(
      issues,
      "invalid-speed",
      `gates.${gateId}.velocity`,
      `Gate ${gateId} has a non-sublight velocity during the Dwell.`,
      "gate",
      gateId,
      undefined,
    );
    return undefined;
  }
  if (!gateHasKeplerianMotion(scenario, gateId)) {
    return duration.value * startRate;
  }

  const cache = new Map<number, number | undefined>();
  const rateAt = (offset: number): number | undefined => {
    const cached = cache.get(offset);
    if (cached !== undefined || cache.has(offset)) {
      return cached;
    }
    const result = evaluateGateWorldline(
      scenario,
      gateId,
      seconds(departureCoordinateTime.value + offset),
    );
    if (!result.ok) {
      addWorldlineIssues(result.issues, issues);
      cache.set(offset, undefined);
      return undefined;
    }
    const rate = properTimeRate(result.state.velocity);
    if (rate === undefined) {
      addIssue(
        issues,
        "invalid-speed",
        `gates.${gateId}.velocity`,
        `Gate ${gateId} has a non-sublight velocity during the Dwell.`,
        "gate",
        gateId,
        undefined,
      );
    }
    cache.set(offset, rate);
    return rate;
  };

  const adaptiveSimpson = (
    left: number,
    right: number,
    leftValue: number,
    midpointValue: number,
    rightValue: number,
    whole: number,
    tolerance: number,
    depth: number,
  ): number | undefined => {
    const midpoint = (left + right) / 2;
    const leftMidpoint = (left + midpoint) / 2;
    const rightMidpoint = (midpoint + right) / 2;
    const leftMidpointValue = rateAt(leftMidpoint);
    const rightMidpointValue = rateAt(rightMidpoint);
    if (leftMidpointValue === undefined || rightMidpointValue === undefined) {
      return undefined;
    }
    const leftArea = ((midpoint - left) / 6) * (leftValue + 4 * leftMidpointValue + midpointValue);
    const rightArea =
      ((right - midpoint) / 6) * (midpointValue + 4 * rightMidpointValue + rightValue);
    const delta = leftArea + rightArea - whole;
    if (depth <= 0 || Math.abs(delta) <= 15 * tolerance) {
      return leftArea + rightArea + delta / 15;
    }
    const nextTolerance = tolerance / 2;
    const leftResult = adaptiveSimpson(
      left,
      midpoint,
      leftValue,
      leftMidpointValue,
      midpointValue,
      leftArea,
      nextTolerance,
      depth - 1,
    );
    const rightResult = adaptiveSimpson(
      midpoint,
      right,
      midpointValue,
      rightMidpointValue,
      rightValue,
      rightArea,
      nextTolerance,
      depth - 1,
    );
    return leftResult === undefined || rightResult === undefined
      ? undefined
      : leftResult + rightResult;
  };

  const intervalCount = 128;
  const intervalDuration = duration.value / intervalCount;
  let total = 0;
  for (let index = 0; index < intervalCount; index += 1) {
    const left = index * intervalDuration;
    const right = (index + 1) * intervalDuration;
    const midpoint = (left + right) / 2;
    const leftValue = rateAt(left);
    const midpointValue = rateAt(midpoint);
    const rightValue = rateAt(right);
    if (leftValue === undefined || midpointValue === undefined || rightValue === undefined) {
      return undefined;
    }
    const whole = ((right - left) / 6) * (leftValue + 4 * midpointValue + rightValue);
    const result = adaptiveSimpson(
      left,
      right,
      leftValue,
      midpointValue,
      rightValue,
      whole,
      Math.max(1e-10, (duration.value * 1e-13) / intervalCount),
      12,
    );
    if (result === undefined || !Number.isFinite(result)) {
      addIssue(
        issues,
        "invalid-coordinate-state",
        `gates.${gateId}`,
        `Gate ${gateId} produced a non-finite integrated Dwell proper time.`,
        "gate",
        gateId,
        undefined,
      );
      return undefined;
    }
    total += result;
  }
  return Number.isFinite(total) ? total : undefined;
}

function simulateDwell(
  scenario: CompiledScenario,
  gateId: StableId,
  shipProfileId: StableId,
  departureCoordinateTime: Seconds,
  duration: Seconds,
  issues: SimulationIssue[],
): JourneyDwellTimeline | undefined {
  const departureResult = evaluateGateWorldline(scenario, gateId, departureCoordinateTime);
  if (!departureResult.ok) {
    addWorldlineIssues(departureResult.issues, issues);
    return undefined;
  }
  const arrivalCoordinateTime = seconds(departureCoordinateTime.value + duration.value);
  const arrivalResult = evaluateGateWorldline(scenario, gateId, arrivalCoordinateTime);
  if (!arrivalResult.ok) {
    addWorldlineIssues(arrivalResult.issues, issues);
    return undefined;
  }
  const properDurationValue = integrateGateProperTime(
    scenario,
    gateId,
    departureCoordinateTime,
    duration,
    issues,
  );
  if (properDurationValue === undefined) {
    return undefined;
  }
  const properDuration = seconds(properDurationValue);
  const total = clocks(duration, properDuration);
  return Object.freeze({
    kind: "dwell" as const,
    gateId,
    shipProfileId,
    departureCoordinateTime,
    arrivalCoordinateTime,
    duration,
    properDuration,
    agingDifference: total.agingDifference,
    departurePosition: departureResult.state.position,
    departureVelocity: departureResult.state.velocity,
    arrivalPosition: arrivalResult.state.position,
    arrivalVelocity: arrivalResult.state.velocity,
    clocks: total,
  });
}

function multiLegPhase(
  kind: JourneyPhaseKind,
  stepIndex: number,
  departureGateId: StableId,
  destinationGateId: StableId,
  startCoordinateTime: Seconds,
  endCoordinateTime: Seconds,
  start: JourneyClockReading,
  end: JourneyClockReading,
  startPosition: PositionVector,
  endPosition: PositionVector,
  startVelocity: VelocityVector,
  endVelocity: VelocityVector,
  cruise: JourneyTimeline | undefined,
  transfer: InSystemTransferTimeline | undefined,
  dwell: JourneyDwellTimeline | undefined,
): MultiLegJourneyPhase {
  return Object.freeze({
    kind,
    stepIndex,
    departureGateId,
    destinationGateId,
    startCoordinateTime,
    endCoordinateTime,
    clusterCoordinateDuration: seconds(endCoordinateTime.value - startCoordinateTime.value),
    shipProperDuration: seconds(end.shipProperTime.value - start.shipProperTime.value),
    agingDifference: seconds(end.agingDifference.value - start.agingDifference.value),
    start,
    end,
    startPosition,
    endPosition,
    startVelocity,
    endVelocity,
    cruise,
    transfer,
    dwell,
  });
}

function multiLegEvent(
  kind: JourneyEventKind,
  phaseKind: JourneyPhaseKind,
  stepIndex: number,
  gateId: StableId | undefined,
  coordinateTime: Seconds,
  reading: JourneyClockReading,
  positionValue: PositionVector | undefined,
  velocityValue: VelocityVector | undefined,
): MultiLegJourneyTimelineEvent {
  return Object.freeze({
    kind,
    phase: phaseKind,
    clocks: reading,
    cumulativeClusterCoordinateTime: reading.clusterCoordinateTime,
    cumulativeShipProperTime: reading.shipProperTime,
    cumulativeAgingDifference: reading.agingDifference,
    coordinateTime,
    stepIndex,
    gateId,
    position: positionValue,
    velocity: velocityValue,
  });
}

function transferEventKind(kind: InSystemTransferEvent["kind"]): JourneyEventKind {
  switch (kind) {
    case "departure":
      return "transfer-departure";
    case "acceleration-end":
      return "transfer-acceleration-end";
    case "coast-start":
      return "transfer-coast-start";
    case "flip":
      return "transfer-flip";
    case "arrival":
      return "transfer-arrival";
  }
}

function cumulativeReading(
  departureCoordinateTime: number,
  currentCoordinateTime: number,
  shipProperTime: number,
): JourneyClockReading {
  return clocks(seconds(currentCoordinateTime - departureCoordinateTime), seconds(shipProperTime));
}

/**
 * Simulates a composed Journey containing Interstellar Cruises, In-system Transfers, and Dwells.
 *
 * Every leg starts at the actual absolute completion epoch returned by its predecessor. Cruise
 * transitions remain explicit zero-duration phases, while powered transfer detail is retained in
 * its leg timeline. A Dwell evaluates the Gate worldline throughout the interval and integrates
 * `sqrt(1 - |v|^2/c^2)` for Ship Proper Time.
 *
 * @param scenario - The immutable compiled Scenario containing all referenced Gates and the ship.
 * @param request - A tagged multi-leg request whose ordered phases are supplied in `legs`.
 * @returns An immutable end-to-end Journey Timeline or structured simulation issues.
 */
export function simulateMultiLegJourney(
  scenario: CompiledScenario,
  request: JourneyRequest,
): MultiLegJourneySimulationResult;

/**
 * Simulates a composed Journey request supplied through the public seam.
 *
 * @param scenario - The immutable compiled Scenario containing all referenced Gates and the ship.
 * @param request - An unknown request value validated at this model boundary.
 * @returns An immutable end-to-end Journey Timeline or structured simulation issues.
 */
export function simulateMultiLegJourney(
  scenario: CompiledScenario,
  request: unknown,
): MultiLegJourneySimulationResult;

export function simulateMultiLegJourney(
  scenario: CompiledScenario,
  request: unknown,
): MultiLegJourneySimulationResult {
  const issues: SimulationIssue[] = [];
  if (!isRecord(request)) {
    addIssue(
      issues,
      "invalid-journey-request",
      "request",
      "Composed Journey request must be an object.",
      undefined,
      undefined,
      undefined,
    );
    return failure(issues);
  }

  const parsed = readMultiLegJourneyRequest(request, scenario.epoch.coordinateTime, issues);
  if (parsed === undefined) {
    return failure(issues);
  }

  const departureGate = scenario.index.gates.get(parsed.departureGateId);
  const destinationGate = scenario.index.gates.get(parsed.destinationGateId);
  const shipProfile = scenario.index.shipProfiles.get(parsed.shipProfileId);
  if (departureGate === undefined) {
    addIssue(
      issues,
      "unknown-gate",
      "request.departureGateId",
      `Departure Gate ${parsed.departureGateId} does not exist in the compiled Scenario.`,
      "gate",
      parsed.departureGateId,
      undefined,
    );
  }
  if (destinationGate === undefined) {
    addIssue(
      issues,
      "unknown-gate",
      "request.destinationGateId",
      `Destination Gate ${parsed.destinationGateId} does not exist in the compiled Scenario.`,
      "gate",
      parsed.destinationGateId,
      undefined,
    );
  }
  if (shipProfile === undefined) {
    addIssue(
      issues,
      "unknown-ship-profile",
      "request.shipProfileId",
      `Ship Profile ${parsed.shipProfileId} does not exist in the compiled Scenario.`,
      "ship-profile",
      parsed.shipProfileId,
      undefined,
    );
  } else if (!shipProfile.hasZpzGenerator) {
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
  if (issues.length > 0 || departureGate === undefined || destinationGate === undefined) {
    return failure(issues);
  }

  const departureResult = evaluateGateWorldline(
    scenario,
    departureGate.id,
    parsed.departureCoordinateTime,
  );
  if (!departureResult.ok) {
    addWorldlineIssues(departureResult.issues, issues);
    return failure(issues);
  }

  const departureCoordinateTime = parsed.departureCoordinateTime.value;
  let currentCoordinateTime = departureCoordinateTime;
  let currentShipProperTime = 0;
  let currentGateId = departureGate.id;
  let currentPosition = departureResult.state.position;
  let currentVelocity = departureResult.state.velocity;
  const phases: MultiLegJourneyPhase[] = [];
  const events: MultiLegJourneyTimelineEvent[] = [];
  const legs: MultiLegJourneyLeg[] = [];

  for (const [stepIndex, leg] of parsed.legs.entries()) {
    const startCoordinateTime = currentCoordinateTime;
    const startReading = cumulativeReading(
      departureCoordinateTime,
      currentCoordinateTime,
      currentShipProperTime,
    );
    if (leg.kind === "interstellar-cruise") {
      const cruiseResult = simulateJourney(scenario, {
        departureGateId: currentGateId,
        destinationGateId: leg.destinationGateId,
        shipProfileId: parsed.shipProfileId,
        departureCoordinateTime: seconds(currentCoordinateTime),
        cruiseSpeed: undefined,
      });
      if (!cruiseResult.ok) {
        appendSimulationIssues(cruiseResult.issues, `legs[${stepIndex}]`, issues);
        break;
      }
      const cruise = cruiseResult.timeline;
      const endCoordinateTime = cruise.arrivalCoordinateTime.value;
      const endReading = cumulativeReading(
        departureCoordinateTime,
        endCoordinateTime,
        currentShipProperTime + cruise.totalShipProperTime.value,
      );
      const isFinalLeg = stepIndex === parsed.legs.length - 1;
      phases.push(
        multiLegPhase(
          "departure-transition",
          stepIndex,
          currentGateId,
          currentGateId,
          seconds(startCoordinateTime),
          seconds(startCoordinateTime),
          startReading,
          startReading,
          cruise.departurePosition,
          cruise.departurePosition,
          cruise.departureVelocity,
          cruise.departureVelocity,
          undefined,
          undefined,
          undefined,
        ),
      );
      events.push(
        multiLegEvent(
          stepIndex === 0 ? "departure" : "gate-departure",
          "departure-transition",
          stepIndex,
          currentGateId,
          seconds(startCoordinateTime),
          startReading,
          cruise.departurePosition,
          cruise.departureVelocity,
        ),
      );
      events.push(
        multiLegEvent(
          "cruise-departure",
          "interstellar-cruise",
          stepIndex,
          currentGateId,
          seconds(startCoordinateTime),
          startReading,
          cruise.departurePosition,
          cruise.cruiseVelocity,
        ),
      );
      phases.push(
        multiLegPhase(
          "interstellar-cruise",
          stepIndex,
          currentGateId,
          leg.destinationGateId,
          seconds(startCoordinateTime),
          seconds(endCoordinateTime),
          startReading,
          endReading,
          cruise.departurePosition,
          cruise.arrivalPosition,
          cruise.departureVelocity,
          cruise.cruiseVelocity,
          cruise,
          undefined,
          undefined,
        ),
      );
      events.push(
        multiLegEvent(
          "cruise-arrival",
          "interstellar-cruise",
          stepIndex,
          leg.destinationGateId,
          seconds(endCoordinateTime),
          endReading,
          cruise.arrivalPosition,
          cruise.cruiseVelocity,
        ),
      );
      phases.push(
        multiLegPhase(
          "arrival-transition",
          stepIndex,
          leg.destinationGateId,
          leg.destinationGateId,
          seconds(endCoordinateTime),
          seconds(endCoordinateTime),
          endReading,
          endReading,
          cruise.arrivalPosition,
          cruise.arrivalPosition,
          cruise.arrivalVelocity,
          cruise.arrivalVelocity,
          undefined,
          undefined,
          undefined,
        ),
      );
      events.push(
        multiLegEvent(
          isFinalLeg ? "arrival" : "gate-arrival",
          "arrival-transition",
          stepIndex,
          leg.destinationGateId,
          seconds(endCoordinateTime),
          endReading,
          cruise.arrivalPosition,
          cruise.arrivalVelocity,
        ),
      );
      legs.push(
        Object.freeze({
          kind: leg.kind,
          stepIndex,
          departureGateId: currentGateId,
          destinationGateId: leg.destinationGateId,
          startCoordinateTime: seconds(startCoordinateTime),
          endCoordinateTime: seconds(endCoordinateTime),
          timeline: cruise,
        }),
      );
      currentCoordinateTime = endCoordinateTime;
      currentShipProperTime = endReading.shipProperTime.value;
      currentGateId = leg.destinationGateId;
      currentPosition = cruise.arrivalPosition;
      currentVelocity = cruise.arrivalVelocity;
      continue;
    }

    if (leg.kind === "dwell") {
      const dwell = simulateDwell(
        scenario,
        currentGateId,
        parsed.shipProfileId,
        seconds(currentCoordinateTime),
        leg.duration,
        issues,
      );
      if (dwell === undefined || issues.length > 0) {
        break;
      }
      const endCoordinateTime = dwell.arrivalCoordinateTime.value;
      const endReading = cumulativeReading(
        departureCoordinateTime,
        endCoordinateTime,
        currentShipProperTime + dwell.properDuration.value,
      );
      phases.push(
        multiLegPhase(
          "dwell",
          stepIndex,
          currentGateId,
          currentGateId,
          seconds(startCoordinateTime),
          seconds(endCoordinateTime),
          startReading,
          endReading,
          dwell.departurePosition,
          dwell.arrivalPosition,
          dwell.departureVelocity,
          dwell.arrivalVelocity,
          undefined,
          undefined,
          dwell,
        ),
      );
      events.push(
        multiLegEvent(
          "dwell-start",
          "dwell",
          stepIndex,
          currentGateId,
          seconds(startCoordinateTime),
          startReading,
          dwell.departurePosition,
          dwell.departureVelocity,
        ),
      );
      events.push(
        multiLegEvent(
          "dwell-end",
          "dwell",
          stepIndex,
          currentGateId,
          seconds(endCoordinateTime),
          endReading,
          dwell.arrivalPosition,
          dwell.arrivalVelocity,
        ),
      );
      legs.push(
        Object.freeze({
          kind: leg.kind,
          stepIndex,
          departureGateId: currentGateId,
          destinationGateId: currentGateId,
          startCoordinateTime: seconds(startCoordinateTime),
          endCoordinateTime: seconds(endCoordinateTime),
          timeline: dwell,
        }),
      );
      currentCoordinateTime = endCoordinateTime;
      currentShipProperTime = endReading.shipProperTime.value;
      currentPosition = dwell.arrivalPosition;
      currentVelocity = dwell.arrivalVelocity;
      continue;
    }

    const transferResult = simulateInSystemTransfer(scenario, {
      kind: "in-system-transfer",
      departureGateId: currentGateId,
      destinationGateId: leg.destinationGateId,
      shipProfileId: parsed.shipProfileId,
      departureCoordinateTime: seconds(currentCoordinateTime),
    });
    if (!transferResult.ok) {
      appendTransferIssues(transferResult.issues, `legs[${stepIndex}]`, issues);
      break;
    }
    const transfer = transferResult.timeline;
    const endCoordinateTime = transfer.arrivalCoordinateTime.value;
    const endReading = cumulativeReading(
      departureCoordinateTime,
      endCoordinateTime,
      currentShipProperTime + transfer.totalShipProperTime.value,
    );
    phases.push(
      multiLegPhase(
        "in-system-transfer",
        stepIndex,
        currentGateId,
        leg.destinationGateId,
        seconds(startCoordinateTime),
        seconds(endCoordinateTime),
        startReading,
        endReading,
        transfer.departurePosition,
        transfer.arrivalPosition,
        transfer.departureVelocity,
        transfer.arrivalVelocity,
        undefined,
        transfer,
        undefined,
      ),
    );
    for (const transferEvent of transfer.events) {
      const eventReading = cumulativeReading(
        departureCoordinateTime,
        startCoordinateTime + transferEvent.cumulativeClusterCoordinateTime.value,
        currentShipProperTime + transferEvent.cumulativeShipProperTime.value,
      );
      events.push(
        multiLegEvent(
          transferEventKind(transferEvent.kind),
          "in-system-transfer",
          stepIndex,
          transferEvent.kind === "arrival" ? leg.destinationGateId : currentGateId,
          seconds(startCoordinateTime + transferEvent.cumulativeClusterCoordinateTime.value),
          eventReading,
          transferEvent.position,
          transferEvent.velocity,
        ),
      );
    }
    legs.push(
      Object.freeze({
        kind: leg.kind,
        stepIndex,
        departureGateId: currentGateId,
        destinationGateId: leg.destinationGateId,
        startCoordinateTime: seconds(startCoordinateTime),
        endCoordinateTime: seconds(endCoordinateTime),
        timeline: transfer,
      }),
    );
    currentCoordinateTime = endCoordinateTime;
    currentShipProperTime = endReading.shipProperTime.value;
    currentGateId = leg.destinationGateId;
    currentPosition = transfer.arrivalPosition;
    currentVelocity = transfer.arrivalVelocity;
  }

  if (issues.length > 0) {
    return failure(issues);
  }
  if (currentGateId !== parsed.destinationGateId) {
    addIssue(
      issues,
      "journey-endpoint-mismatch",
      "request.destinationGateId",
      `Journey ended at Gate ${currentGateId}, not the selected destination Gate ${parsed.destinationGateId}.`,
      "gate",
      currentGateId,
      parsed.destinationGateId,
    );
    return failure(issues);
  }

  const total = cumulativeReading(
    departureCoordinateTime,
    currentCoordinateTime,
    currentShipProperTime,
  );
  if (
    !Number.isFinite(currentCoordinateTime) ||
    !Number.isFinite(total.shipProperTime.value) ||
    !Number.isFinite(total.agingDifference.value)
  ) {
    addIssue(
      issues,
      "invalid-coordinate-state",
      "timeline.clocks",
      "Composed Journey produced a non-finite cumulative clock.",
      undefined,
      undefined,
      undefined,
    );
    return failure(issues);
  }

  const timeline: MultiLegJourneyTimeline = Object.freeze({
    kind: "journey",
    departureGateId: parsed.departureGateId,
    destinationGateId: parsed.destinationGateId,
    shipProfileId: parsed.shipProfileId,
    departureCoordinateTime: parsed.departureCoordinateTime,
    arrivalCoordinateTime: seconds(currentCoordinateTime),
    departurePosition: departureResult.state.position,
    departureVelocity: departureResult.state.velocity,
    arrivalPosition: currentPosition,
    arrivalVelocity: currentVelocity,
    legs: Object.freeze(legs),
    phases: Object.freeze(phases),
    events: Object.freeze(events),
    clocks: total,
  });
  return Object.freeze({ ok: true as const, timeline, issues: [] as const });
}

/**
 * Simulates one powered In-system Transfer when the request is explicitly tagged with
 * `kind: "in-system-transfer"`; otherwise this overload preserves the Interstellar Cruise seam.
 *
 * @param scenario - The immutable, previously compiled Scenario.
 * @param request - A tagged powered-transfer request.
 * @returns A powered In-system Transfer timeline or structured transfer issues.
 */
export function simulateJourney(
  scenario: CompiledScenario,
  request: InSystemTransferRequest & { readonly kind: "in-system-transfer" },
): InSystemTransferSimulationResult;

/**
 * Simulates a composed multi-leg Journey through the public Journey Model seam.
 *
 * @param scenario - The immutable compiled Scenario to simulate.
 * @param request - The tagged multi-leg Journey request.
 * @returns A complete composed Journey Timeline or deterministic structured simulation issues.
 */
export function simulateJourney(
  scenario: CompiledScenario,
  request: JourneyRequest,
): MultiLegJourneySimulationResult;

/**
 * Simulates one Interstellar Cruise through the public Journey Model seam.
 *
 * The endpoint Gates must be the paired members of one Gate Connection. Their worldlines are
 * evaluated at the requested departure epoch, and a bracketed numerical solve finds the earliest
 * future time at which a straight-line ship trajectory at exactly `0.999c` intersects the
 * destination Gate. Gate transitions remain ZPZ-protected zero-duration events; the arrival
 * transition leaves the ship with the destination Gate's instantaneous orbital velocity.
 *
 * @param scenario - The immutable, previously compiled Scenario to simulate.
 * @param request - The validated-shape Interstellar Cruise request.
 * @returns A complete immutable Journey Timeline or deterministic structured simulation issues.
 */
export function simulateJourney(
  scenario: CompiledScenario,
  request: InterstellarCruiseRequest,
): JourneySimulationResult;

/**
 * Simulates an unknown request through the public Journey Model seam.
 *
 * @param scenario - The immutable, previously compiled Scenario to simulate.
 * @param request - An unknown request value validated at this model boundary.
 * @returns A complete immutable Journey Timeline or deterministic structured simulation issues.
 */
export function simulateJourney(
  scenario: CompiledScenario,
  request: unknown,
): JourneySimulationResult | MultiLegJourneySimulationResult | InSystemTransferSimulationResult;

export function simulateJourney(
  scenario: CompiledScenario,
  request: unknown,
): JourneySimulationResult | MultiLegJourneySimulationResult | InSystemTransferSimulationResult {
  if (isRecord(request) && isCompositeJourneyRequest(request)) {
    return simulateMultiLegJourney(scenario, request);
  }
  if (isRecord(request) && request.kind === "in-system-transfer") {
    return simulateInSystemTransfer(scenario, request);
  }

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
  const departureCoordinateTime =
    !hasOwn(request, "departureCoordinateTime") || request.departureCoordinateTime === undefined
      ? scenario.epoch.coordinateTime
      : readSeconds(request.departureCoordinateTime, "request.departureCoordinateTime", issues);
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

  if (
    issues.length === 0 &&
    departureGate !== undefined &&
    destinationGate !== undefined &&
    departureCoordinateTime !== undefined &&
    cruiseSpeed !== undefined
  ) {
    const departureWorldline = evaluateGateWorldline(
      scenario,
      departureGate.id,
      departureCoordinateTime,
    );
    if (!departureWorldline.ok) {
      addWorldlineIssues(departureWorldline.issues, issues);
    } else {
      const departureSpeed = vectorMagnitude(numericVelocity(departureWorldline.state.velocity));
      if (!Number.isFinite(departureSpeed) || departureSpeed >= SPEED_OF_LIGHT.value) {
        addIssue(
          issues,
          "invalid-speed",
          `gates.${departureGate.id}.velocity`,
          "Departure Gate velocity must be finite and below the speed of light.",
          "gate",
          departureGate.id,
          undefined,
        );
      }

      const destinationAtEpoch = evaluateGateWorldline(
        scenario,
        destinationGate.id,
        departureCoordinateTime,
      );
      if (!destinationAtEpoch.ok) {
        addWorldlineIssues(destinationAtEpoch.issues, issues);
      } else {
        const destinationSpeed = vectorMagnitude(
          numericVelocity(destinationAtEpoch.state.velocity),
        );
        if (!Number.isFinite(destinationSpeed) || destinationSpeed >= SPEED_OF_LIGHT.value) {
          addIssue(
            issues,
            "invalid-speed",
            `gates.${destinationGate.id}.velocity`,
            "Destination Gate velocity must be finite and below the speed of light.",
            "gate",
            destinationGate.id,
            undefined,
          );
        }
      }

      if (issues.length === 0) {
        const departurePosition = numericPosition(departureWorldline.state.position);
        const solvedIntercept = intercept(
          scenario,
          destinationGate.id,
          departurePosition,
          departureCoordinateTime,
          cruiseSpeed,
          issues,
        );
        if (solvedIntercept !== undefined && issues.length === 0) {
          const arrivalSpeed = vectorMagnitude(numericVelocity(solvedIntercept.target.velocity));
          if (!Number.isFinite(arrivalSpeed) || arrivalSpeed >= SPEED_OF_LIGHT.value) {
            addIssue(
              issues,
              "invalid-speed",
              `gates.${destinationGate.id}.arrivalVelocity`,
              "Destination Gate velocity at the Arrival Intercept must be finite and below the speed of light.",
              "gate",
              destinationGate.id,
              undefined,
            );
          } else {
            const resultTimeline = timeline(
              departureGate.id,
              destinationGate.id,
              shipProfileId as StableId,
              departureCoordinateTime,
              departureWorldline.state,
              cruiseSpeed,
              solvedIntercept,
            );
            if (
              !Number.isFinite(resultTimeline.totalClusterCoordinateTime.value) ||
              !Number.isFinite(resultTimeline.totalShipProperTime.value) ||
              !Number.isFinite(resultTimeline.arrivalIntercept.positionResidual.value)
            ) {
              addIssue(
                issues,
                "non-finite-worldline",
                `gates.${destinationGate.id}`,
                "Interstellar Cruise produced a non-finite elapsed time or arrival residual.",
                "gate",
                destinationGate.id,
                undefined,
              );
            } else {
              return Object.freeze({
                ok: true as const,
                timeline: resultTimeline,
                issues: [] as const,
              });
            }
          }
        }
      }
    }
  }

  return failure(issues);
}

/**
 * Simulates an Interstellar Cruise under the explicit name used by the initial physics milestone.
 *
 * @param scenario - The immutable compiled Scenario containing the endpoint Gates.
 * @param request - The fixed-gate cruise request to validate and simulate.
 * @returns The same immutable result returned by {@link simulateJourney}.
 */
export const simulateFixedGateCruise = simulateJourney;
