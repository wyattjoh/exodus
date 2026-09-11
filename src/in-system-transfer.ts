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
import type { JourneyClockReading } from "./simulation";

const stableIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TRANSFER_MAX_SOLVER_ITERATIONS = 180;
const TRANSFER_TIME_TOLERANCE = 1e-7;
const TRANSFER_MAX_SEARCH_SECONDS = 1e12;
const TRANSFER_MINIMUM_DISTANCE = 1e-9;
const TRANSFER_MINIMUM_COAST_DURATION = 1e-9;
const TRANSFER_POSITION_RESIDUAL_TOLERANCE = 1;
const TRANSFER_VELOCITY_RESIDUAL_TOLERANCE = 1e-6;
const TRANSFER_SPEED_TOLERANCE = 1e-3;
const TRANSFER_ROOT_POSITION_SCALE = 1e-12;
const zeroVector: NumericVector3 = Object.freeze({ x: 0, y: 0, z: 0 });

/**
 * Maximum Cluster Coordinate Time searched while bracketing a moving-Gate transfer intercept.
 */
export const IN_SYSTEM_TRANSFER_MAX_SEARCH_SECONDS = TRANSFER_MAX_SEARCH_SECONDS;

/**
 * Position residual tolerance used by powered In-system Transfer interception (1 m).
 */
export const IN_SYSTEM_TRANSFER_POSITION_RESIDUAL_TOLERANCE = TRANSFER_POSITION_RESIDUAL_TOLERANCE;

/**
 * Velocity residual tolerance used by powered In-system Transfer interception.
 */
export const IN_SYSTEM_TRANSFER_VELOCITY_RESIDUAL_TOLERANCE = TRANSFER_VELOCITY_RESIDUAL_TOLERANCE;

/**
 * Base time residual tolerance used by powered In-system Transfer interception.
 */
export const IN_SYSTEM_TRANSFER_TIME_RESIDUAL_TOLERANCE = TRANSFER_TIME_TOLERANCE;

/**
 * The phases of a powered In-system Transfer.
 */
export type InSystemTransferPhaseKind = "acceleration" | "coast" | "braking";

/**
 * The observable events at the boundaries of a powered In-system Transfer.
 */
export type InSystemTransferEventKind =
  | "departure"
  | "acceleration-end"
  | "coast-start"
  | "flip"
  | "arrival";

/**
 * Position and velocity differences between the simulated ship and the destination Gate at
 * transfer completion.
 */
export type InSystemTransferTerminalResiduals = {
  readonly position: Meters;
  readonly velocity: MetersPerSecond;
};

/**
 * One powered In-system Transfer phase with its endpoint states and cumulative clocks.
 */
export type InSystemTransferPhase = {
  readonly kind: InSystemTransferPhaseKind;
  readonly clusterCoordinateDuration: Seconds;
  readonly shipProperDuration: Seconds;
  readonly agingDifference: Seconds;
  readonly start: JourneyClockReading;
  readonly end: JourneyClockReading;
  readonly startPosition: PositionVector;
  readonly endPosition: PositionVector;
  readonly startVelocity: VelocityVector;
  readonly endVelocity: VelocityVector;
};

/**
 * One event in the powered In-system Transfer timeline.
 */
export type InSystemTransferEvent = {
  readonly kind: InSystemTransferEventKind;
  readonly phase: InSystemTransferPhaseKind;
  readonly clocks: JourneyClockReading;
  readonly cumulativeClusterCoordinateTime: Seconds;
  readonly cumulativeShipProperTime: Seconds;
  readonly cumulativeAgingDifference: Seconds;
  readonly position: PositionVector;
  readonly velocity: VelocityVector;
};

/**
 * The complete result of one powered In-system Transfer.
 */
export type InSystemTransferTimeline = {
  readonly departureGateId: StableId;
  readonly destinationGateId: StableId;
  readonly shipProfileId: StableId;
  readonly departureCoordinateTime: Seconds;
  readonly arrivalCoordinateTime: Seconds;
  readonly timeResidual: Seconds;
  readonly distance: Meters;
  readonly transferDistance: Meters;
  readonly peakSpeed: MetersPerSecond;
  readonly coastSpeed: MetersPerSecond | undefined;
  readonly departurePosition: PositionVector;
  readonly departureVelocity: VelocityVector;
  readonly arrivalPosition: PositionVector;
  readonly arrivalVelocity: VelocityVector;
  readonly destinationPosition: PositionVector;
  readonly destinationVelocity: VelocityVector;
  readonly terminalResiduals: InSystemTransferTerminalResiduals;
  readonly positionResidual: Meters;
  readonly velocityResidual: MetersPerSecond;
  readonly phases: readonly InSystemTransferPhase[];
  readonly events: readonly InSystemTransferEvent[];
  readonly total: JourneyClockReading;
  readonly totalClusterCoordinateTime: Seconds;
  readonly totalShipProperTime: Seconds;
  readonly totalAgingDifference: Seconds;
};

/**
 * A request to simulate a powered In-system Transfer between two Gates in one System.
 */
export type InSystemTransferRequest = {
  readonly kind?: "in-system-transfer" | undefined;
  readonly departureGateId: StableId;
  readonly destinationGateId: StableId;
  readonly shipProfileId: StableId;
  readonly departureCoordinateTime?: Seconds | undefined;
};

/**
 * Structured failure categories produced while simulating a powered In-system Transfer.
 */
export type InSystemTransferIssueCode =
  | "invalid-request"
  | "unknown-gate"
  | "unknown-ship-profile"
  | "invalid-transfer-endpoints"
  | "missing-zpz-generator"
  | "invalid-ship-profile"
  | "invalid-coordinate-time"
  | "invalid-speed"
  | "invalid-distance"
  | "invalid-coordinate-state"
  | "invalid-orbital-elements"
  | "non-convergent-orbit"
  | "non-finite-worldline"
  | "infeasible-transfer"
  | "non-convergent-transfer";

/**
 * A structured explanation of one rejected transfer request or numerical solve.
 */
export type InSystemTransferIssue = {
  readonly code: InSystemTransferIssueCode;
  readonly path: string;
  readonly message: string;
  readonly entityType: DomainEntityType | undefined;
  readonly entityId: StableId | undefined;
  readonly relatedId: StableId | undefined;
};

/**
 * The successful result returned by powered In-system Transfer simulation.
 */
export type InSystemTransferSimulationSuccess = {
  readonly ok: true;
  readonly timeline: InSystemTransferTimeline;
  readonly issues: readonly [];
};

/**
 * The unsuccessful result returned by powered In-system Transfer simulation.
 */
export type InSystemTransferSimulationFailure = {
  readonly ok: false;
  readonly timeline: undefined;
  readonly issues: readonly InSystemTransferIssue[];
};

/**
 * The discriminated result returned by powered In-system Transfer simulation.
 */
export type InSystemTransferSimulationResult =
  | InSystemTransferSimulationSuccess
  | InSystemTransferSimulationFailure;

type RecordValue = Record<string, unknown>;

type Segment = {
  readonly kind: InSystemTransferPhaseKind;
  readonly coordinateDuration: number;
  readonly properDuration: number;
  readonly relativeDistance: number;
  readonly startRelativeSpeed: number;
  readonly endRelativeSpeed: number;
};

type TransferProfile = {
  readonly duration: number;
  readonly properDuration: number;
  readonly acceleration: Segment;
  readonly coast: Segment | undefined;
  readonly braking: Segment;
  readonly peakSpeed: number;
  readonly coastSpeed: number | undefined;
  readonly finalRelativeSpeed: number;
  readonly direction: NumericVector3;
  readonly distance: number;
  readonly transverseAcceleration: NumericVector3;
  readonly transverseBraking: NumericVector3;
};

type TransferEvaluation = {
  readonly duration: number;
  readonly target: GateWorldline;
  readonly profile: TransferProfile;
  readonly departurePosition: NumericVector3;
  readonly departureVelocity: NumericVector3;
  readonly shipPosition: NumericVector3;
  readonly shipVelocity: NumericVector3;
  readonly positionResidual: number;
  readonly velocityResidual: number;
};

type TargetEvaluation =
  | { readonly ok: true; readonly target: GateWorldline }
  | { readonly ok: false; readonly issues: readonly WorldlineIssue[] };

type ProfileResult =
  | { readonly ok: true; readonly profile: TransferProfile }
  | {
      readonly ok: false;
      readonly code: "invalid-distance" | "invalid-speed" | "infeasible-transfer";
      readonly message: string;
    };

type TransferSolution = TransferEvaluation & {
  readonly timeResidual: number;
  readonly general: GeneralTransferTrajectory | undefined;
};

type FourEvent = {
  readonly time: number;
  readonly position: NumericVector3;
};

type FourVelocity = {
  readonly time: number;
  readonly space: NumericVector3;
};

type GeneralTransferPhase = {
  readonly kind: InSystemTransferPhaseKind;
  readonly coordinateDuration: number;
  readonly properDuration: number;
  readonly startEvent: FourEvent;
  readonly endEvent: FourEvent;
  readonly startVelocity: NumericVector3;
  readonly endVelocity: NumericVector3;
};

type GeneralTransferTrajectory = {
  readonly duration: number;
  readonly properDuration: number;
  readonly target: GateWorldline;
  readonly phases: readonly GeneralTransferPhase[];
  readonly peakSpeed: number;
  readonly distance: number;
  readonly positionResidual: number;
  readonly velocityResidual: number;
  readonly timeResidual: number;
};

type GeneralSolveEvaluation = {
  readonly variables: readonly number[];
  readonly trajectory: GeneralTransferTrajectory;
  readonly residual: readonly number[];
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: RecordValue, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function addIssue(
  issues: InSystemTransferIssue[],
  code: InSystemTransferIssueCode,
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

function issueComparator(left: InSystemTransferIssue, right: InSystemTransferIssue): number {
  const pathComparison = left.path.localeCompare(right.path);
  if (pathComparison !== 0) {
    return pathComparison;
  }

  return left.code.localeCompare(right.code);
}

function failure(issues: readonly InSystemTransferIssue[]): InSystemTransferSimulationFailure {
  return Object.freeze({
    ok: false as const,
    timeline: undefined,
    issues: Object.freeze([...issues].sort(issueComparator)),
  });
}

function readRequestId(
  record: RecordValue,
  key: string,
  issues: InSystemTransferIssue[],
): StableId | undefined {
  const value = record[key];
  if (typeof value !== "string" || !stableIdentifierPattern.test(value)) {
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

  return value as StableId;
}

function readSeconds(
  value: unknown,
  path: string,
  issues: InSystemTransferIssue[],
): Seconds | undefined {
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

function numericPosition(value: PositionVector): NumericVector3 {
  return { x: value.x.value, y: value.y.value, z: value.z.value };
}

function numericVelocity(value: VelocityVector): NumericVector3 {
  return { x: value.x.value, y: value.y.value, z: value.z.value };
}

function positionVector(value: NumericVector3): PositionVector {
  return Object.freeze({
    x: meters(value.x),
    y: meters(value.y),
    z: meters(value.z),
  });
}

function velocityVector(value: NumericVector3): VelocityVector {
  return Object.freeze({
    x: metersPerSecond(value.x),
    y: metersPerSecond(value.y),
    z: metersPerSecond(value.z),
  });
}

function dotVector(left: NumericVector3, right: NumericVector3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function unitVector(value: NumericVector3): NumericVector3 | undefined {
  const magnitude = vectorMagnitude(value);
  if (!Number.isFinite(magnitude) || magnitude <= TRANSFER_MINIMUM_DISTANCE) {
    return undefined;
  }

  return scaleVector(value, 1 / magnitude);
}

function crossVector(left: NumericVector3, right: NumericVector3): NumericVector3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function fourVelocity(value: NumericVector3): FourVelocity {
  const speed = vectorMagnitude(value);
  const betaSquared = speed ** 2 / SPEED_OF_LIGHT.value ** 2;
  const gamma = 1 / Math.sqrt(1 - betaSquared);
  return {
    time: gamma * SPEED_OF_LIGHT.value,
    space: scaleVector(value, gamma),
  };
}

function velocityFromFour(value: FourVelocity): NumericVector3 {
  return scaleVector(value.space, SPEED_OF_LIGHT.value / value.time);
}

function boostEventToRest(value: FourEvent, boostVelocity: NumericVector3): FourEvent {
  const speedSquared = dotVector(boostVelocity, boostVelocity);
  if (speedSquared <= Number.EPSILON) {
    return value;
  }

  const c = SPEED_OF_LIGHT.value;
  const gamma = 1 / Math.sqrt(1 - speedSquared / c ** 2);
  const projection = dotVector(boostVelocity, value.position);
  return {
    time: gamma * (value.time - projection / c ** 2),
    position: addVector(
      addVector(
        value.position,
        scaleVector(boostVelocity, ((gamma - 1) * projection) / speedSquared),
      ),
      scaleVector(boostVelocity, -gamma * value.time),
    ),
  };
}

function boostEventFromRest(value: FourEvent, boostVelocity: NumericVector3): FourEvent {
  const speedSquared = dotVector(boostVelocity, boostVelocity);
  if (speedSquared <= Number.EPSILON) {
    return value;
  }

  const c = SPEED_OF_LIGHT.value;
  const gamma = 1 / Math.sqrt(1 - speedSquared / c ** 2);
  const projection = dotVector(boostVelocity, value.position);
  return {
    time: gamma * (value.time + projection / c ** 2),
    position: addVector(
      addVector(
        value.position,
        scaleVector(boostVelocity, ((gamma - 1) * projection) / speedSquared),
      ),
      scaleVector(boostVelocity, gamma * value.time),
    ),
  };
}

function boostVelocityToRest(value: FourVelocity, boostVelocity: NumericVector3): FourVelocity {
  const speedSquared = dotVector(boostVelocity, boostVelocity);
  if (speedSquared <= Number.EPSILON) {
    return value;
  }

  const c = SPEED_OF_LIGHT.value;
  const gamma = 1 / Math.sqrt(1 - speedSquared / c ** 2);
  const projection = dotVector(boostVelocity, value.space);
  return {
    time: gamma * (value.time - projection / c),
    space: addVector(
      addVector(value.space, scaleVector(boostVelocity, ((gamma - 1) * projection) / speedSquared)),
      scaleVector(boostVelocity, (-gamma * value.time) / c),
    ),
  };
}

function boostVelocityFromRest(value: FourVelocity, boostVelocity: NumericVector3): FourVelocity {
  const speedSquared = dotVector(boostVelocity, boostVelocity);
  if (speedSquared <= Number.EPSILON) {
    return value;
  }

  const c = SPEED_OF_LIGHT.value;
  const gamma = 1 / Math.sqrt(1 - speedSquared / c ** 2);
  const projection = dotVector(boostVelocity, value.space);
  return {
    time: gamma * (value.time + projection / c),
    space: addVector(
      addVector(value.space, scaleVector(boostVelocity, ((gamma - 1) * projection) / speedSquared)),
      scaleVector(boostVelocity, (gamma * value.time) / c),
    ),
  };
}

function clocks(clusterCoordinateTime: number, shipProperTime: number): JourneyClockReading {
  return Object.freeze({
    clusterCoordinateTime: seconds(clusterCoordinateTime),
    shipProperTime: seconds(shipProperTime),
    agingDifference: seconds(clusterCoordinateTime - shipProperTime),
  });
}

function segment(
  kind: InSystemTransferPhaseKind,
  coordinateDuration: number,
  properDuration: number,
  relativeDistance: number,
  startRelativeSpeed: number,
  endRelativeSpeed: number,
): Segment {
  return Object.freeze({
    kind,
    coordinateDuration,
    properDuration,
    relativeDistance,
    startRelativeSpeed,
    endRelativeSpeed,
  });
}

function rapidityForSpeed(speed: number): number {
  return Math.atanh(speed / SPEED_OF_LIGHT.value);
}

function gammaForRapidity(rapidity: number): number {
  return Math.cosh(rapidity);
}

function rapidityForGamma(gamma: number): number {
  if (gamma <= 1) {
    return 0;
  }

  return 2 * Math.asinh(Math.sqrt((gamma - 1) / 2));
}

function sinhForRapidity(rapidity: number): number {
  const gamma = gammaForRapidity(rapidity);
  const magnitude = Math.sqrt(Math.max(0, gamma * gamma - 1));
  return rapidity < 0 ? -magnitude : magnitude;
}

function speedForRapidity(rapidity: number): number {
  const gamma = gammaForRapidity(rapidity);
  return SPEED_OF_LIGHT.value * (sinhForRapidity(rapidity) / gamma);
}

function accelerationSegment(
  rapidity: number,
  acceleration: number,
  gamma = gammaForRapidity(rapidity),
): Segment {
  const c = SPEED_OF_LIGHT.value;
  const coordinateDuration = (c / acceleration) * Math.sqrt(Math.max(0, gamma * gamma - 1));
  const properDuration = (c / acceleration) * rapidity;
  const relativeDistance = (c ** 2 / acceleration) * (gamma - 1);
  return segment(
    "acceleration",
    coordinateDuration,
    properDuration,
    relativeDistance,
    0,
    speedForRapidity(rapidity),
  );
}

function brakingSegment(
  peakRapidity: number,
  finalRapidity: number,
  brakingAcceleration: number,
  peakGamma = gammaForRapidity(peakRapidity),
  finalGamma = gammaForRapidity(finalRapidity),
): Segment {
  const c = SPEED_OF_LIGHT.value;
  const peakSineh = Math.sqrt(Math.max(0, peakGamma * peakGamma - 1));
  const finalSineh =
    Math.sqrt(Math.max(0, finalGamma * finalGamma - 1)) * (finalRapidity < 0 ? -1 : 1);
  const coordinateDuration = (c / brakingAcceleration) * (peakSineh - finalSineh);
  const properDuration = (c / brakingAcceleration) * (peakRapidity - finalRapidity);
  const relativeDistance = (c ** 2 / brakingAcceleration) * (peakGamma - finalGamma);
  return segment(
    "braking",
    coordinateDuration,
    properDuration,
    relativeDistance,
    speedForRapidity(peakRapidity),
    speedForRapidity(finalRapidity),
  );
}

function profileForDistance(
  distance: number,
  finalRelativeSpeed: number,
  acceleration: number,
  brakingAcceleration: number,
  maximumSublightSpeed: number,
  direction: NumericVector3,
): ProfileResult {
  if (!Number.isFinite(distance) || distance <= TRANSFER_MINIMUM_DISTANCE) {
    return {
      ok: false,
      code: "invalid-distance",
      message: "In-system transfer requires a positive finite relative transfer distance.",
    };
  }
  if (
    !Number.isFinite(finalRelativeSpeed) ||
    !Number.isFinite(acceleration) ||
    !Number.isFinite(brakingAcceleration) ||
    !Number.isFinite(maximumSublightSpeed) ||
    acceleration <= 0 ||
    brakingAcceleration <= 0 ||
    maximumSublightSpeed <= 0 ||
    maximumSublightSpeed >= SPEED_OF_LIGHT.value
  ) {
    return {
      ok: false,
      code: "invalid-speed",
      message: "In-system transfer profile values must be finite and physically valid.",
    };
  }
  if (Math.abs(finalRelativeSpeed) >= maximumSublightSpeed) {
    return {
      ok: false,
      code: "infeasible-transfer",
      message: "The destination Gate's relative terminal speed exceeds the Ship Profile speed cap.",
    };
  }

  const finalRapidity = rapidityForSpeed(finalRelativeSpeed);
  const finalGamma = gammaForRapidity(finalRapidity);
  const c = SPEED_OF_LIGHT.value;
  const inverseAccelerationSum = 1 / acceleration + 1 / brakingAcceleration;
  const gammaPeak =
    Math.abs(finalRelativeSpeed) <= Number.EPSILON
      ? 1 + distance / (c ** 2 * inverseAccelerationSum)
      : (distance / c ** 2 + 1 / acceleration + finalGamma / brakingAcceleration) /
        inverseAccelerationSum;
  if (!Number.isFinite(gammaPeak) || gammaPeak < 1) {
    return {
      ok: false,
      code: "infeasible-transfer",
      message: "The selected distance and terminal velocity cannot be reached by the Ship Profile.",
    };
  }

  const peakRapidity = rapidityForGamma(gammaPeak);
  const capRapidity = rapidityForSpeed(maximumSublightSpeed);
  if (finalRapidity > capRapidity) {
    return {
      ok: false,
      code: "infeasible-transfer",
      message: "The destination Gate's relative terminal speed exceeds the Ship Profile speed cap.",
    };
  }

  const useCoast = peakRapidity > capRapidity;
  const selectedPeakRapidity = useCoast ? capRapidity : peakRapidity;
  if (selectedPeakRapidity + Number.EPSILON < finalRapidity) {
    return {
      ok: false,
      code: "infeasible-transfer",
      message:
        "The transfer would need to brake before the Ship Profile can reach the terminal speed.",
    };
  }

  const selectedPeakGamma = useCoast ? gammaForRapidity(selectedPeakRapidity) : gammaPeak;
  const accelerationPhase = accelerationSegment(
    selectedPeakRapidity,
    acceleration,
    selectedPeakGamma,
  );
  const brakingPhase = brakingSegment(
    selectedPeakRapidity,
    finalRapidity,
    brakingAcceleration,
    selectedPeakGamma,
    finalGamma,
  );
  const coastDistance = useCoast
    ? distance - accelerationPhase.relativeDistance - brakingPhase.relativeDistance
    : 0;
  if (
    coastDistance < -Math.max(TRANSFER_MINIMUM_DISTANCE, distance * TRANSFER_ROOT_POSITION_SCALE)
  ) {
    return {
      ok: false,
      code: "infeasible-transfer",
      message: "The powered transfer profile has no non-negative coast or braking solution.",
    };
  }

  const peakSpeed = speedForRapidity(selectedPeakRapidity);
  const coastDuration = Math.max(0, coastDistance) / peakSpeed;
  const coastPhase =
    coastDuration > TRANSFER_MINIMUM_COAST_DURATION
      ? segment(
          "coast",
          coastDuration,
          coastDuration / gammaForRapidity(selectedPeakRapidity),
          coastDistance,
          peakSpeed,
          peakSpeed,
        )
      : undefined;
  const duration =
    accelerationPhase.coordinateDuration +
    (coastPhase?.coordinateDuration ?? 0) +
    brakingPhase.coordinateDuration;
  const properDuration =
    accelerationPhase.properDuration +
    (coastPhase?.properDuration ?? 0) +
    brakingPhase.properDuration;

  return {
    ok: true,
    profile: Object.freeze({
      duration,
      properDuration,
      acceleration: accelerationPhase,
      coast: coastPhase,
      braking: brakingPhase,
      peakSpeed,
      coastSpeed: coastPhase === undefined ? undefined : peakSpeed,
      finalRelativeSpeed,
      direction,
      distance,
      transverseAcceleration: zeroVector,
      transverseBraking: zeroVector,
    }),
  };
}

function addEvents(left: FourEvent, right: FourEvent): FourEvent {
  return {
    time: left.time + right.time,
    position: addVector(left.position, right.position),
  };
}

function generalTrajectoryAt(
  scenario: CompiledScenario,
  destinationGateId: StableId,
  departureCoordinateTime: Seconds,
  departurePosition: NumericVector3,
  departureVelocity: NumericVector3,
  acceleration: number,
  brakingAcceleration: number,
  peakRapidityVector: NumericVector3,
  coastProperDuration: number,
  duration: number,
): GeneralSolveEvaluation | undefined {
  const targetResult = targetAt(
    scenario,
    destinationGateId,
    seconds(departureCoordinateTime.value + duration),
  );
  if (!targetResult.ok) {
    return undefined;
  }

  const targetPosition = numericPosition(targetResult.target.position);
  const targetVelocity = numericVelocity(targetResult.target.velocity);
  if (!speedIsValid(targetVelocity) || !speedIsValid(departureVelocity)) {
    return undefined;
  }

  const c = SPEED_OF_LIGHT.value;
  const peakRapidity = vectorMagnitude(peakRapidityVector);
  const peakDirection = unitVector(peakRapidityVector) ?? zeroVector;
  const peakGamma = Math.cosh(peakRapidity);
  const peakSpeed = c * Math.tanh(peakRapidity);
  const peakVelocity = scaleVector(peakDirection, peakSpeed);
  const accelerationEvent: FourEvent = {
    time: (c / acceleration) * Math.sinh(peakRapidity),
    position: scaleVector(peakDirection, (c ** 2 / acceleration) * (peakGamma - 1)),
  };
  const departureRestTargetEvent = boostEventToRest(
    {
      time: duration,
      position: subtractVector(targetPosition, departurePosition),
    },
    departureVelocity,
  );
  const targetRestVelocity = boostVelocityToRest(fourVelocity(targetVelocity), departureVelocity);
  const targetInPeakRest = boostVelocityToRest(targetRestVelocity, peakVelocity);
  const relativeGamma = Math.max(1, targetInPeakRest.time / c);
  const relativeVelocity = velocityFromFour(targetInPeakRest);
  const relativeDirection = unitVector(relativeVelocity) ?? zeroVector;
  const relativeRapidity = Math.acosh(relativeGamma);
  const brakingEventInPeakRest: FourEvent = {
    time: (c / brakingAcceleration) * Math.sinh(relativeRapidity),
    position: scaleVector(relativeDirection, (c ** 2 / brakingAcceleration) * (relativeGamma - 1)),
  };
  const brakingEvent = boostEventFromRest(brakingEventInPeakRest, peakVelocity);
  const coastEvent: FourEvent = {
    time: peakGamma * Math.max(0, coastProperDuration),
    position: scaleVector(peakVelocity, peakGamma * Math.max(0, coastProperDuration)),
  };
  const coastEnd = addEvents(accelerationEvent, coastEvent);
  const totalRestEvent = addEvents(coastEnd, brakingEvent);
  const targetRestTimeResidual = totalRestEvent.time - departureRestTargetEvent.time;
  const targetRestPositionResidual = subtractVector(
    totalRestEvent.position,
    departureRestTargetEvent.position,
  );
  const totalClusterEvent = boostEventFromRest(totalRestEvent, departureVelocity);
  const finalTargetResult = targetAt(
    scenario,
    destinationGateId,
    seconds(departureCoordinateTime.value + totalClusterEvent.time),
  );
  const finalTarget = finalTargetResult.ok ? finalTargetResult.target : targetResult.target;
  const finalTargetPosition = numericPosition(finalTarget.position);
  const finalTargetVelocity = numericVelocity(finalTarget.velocity);
  const accelerationClusterEvent = boostEventFromRest(accelerationEvent, departureVelocity);
  const coastClusterEvent = boostEventFromRest(coastEnd, departureVelocity);
  const clusterDepartureVelocity = departureVelocity;
  const clusterPeakVelocity = velocityFromFour(
    boostVelocityFromRest(fourVelocity(peakVelocity), departureVelocity),
  );
  const clusterArrivalVelocity = velocityFromFour(
    boostVelocityFromRest(targetRestVelocity, departureVelocity),
  );
  const relativeTargetPosition = subtractVector(targetPosition, departurePosition);
  const absoluteArrivalPosition = addVector(departurePosition, totalClusterEvent.position);
  const positionResidual = vectorMagnitude(
    subtractVector(absoluteArrivalPosition, finalTargetPosition),
  );
  const velocityResidual = vectorMagnitude(
    subtractVector(clusterArrivalVelocity, finalTargetVelocity),
  );
  const phaseAcceleration: GeneralTransferPhase = {
    kind: "acceleration",
    coordinateDuration: accelerationClusterEvent.time,
    properDuration: (c / acceleration) * peakRapidity,
    startEvent: { time: 0, position: departurePosition },
    endEvent: {
      time: accelerationClusterEvent.time,
      position: addVector(departurePosition, accelerationClusterEvent.position),
    },
    startVelocity: clusterDepartureVelocity,
    endVelocity: clusterPeakVelocity,
  };
  const phaseCoast: GeneralTransferPhase | undefined =
    coastProperDuration > TRANSFER_MINIMUM_COAST_DURATION
      ? {
          kind: "coast",
          coordinateDuration: coastClusterEvent.time - accelerationClusterEvent.time,
          properDuration: coastProperDuration,
          startEvent: phaseAcceleration.endEvent,
          endEvent: {
            time: coastClusterEvent.time,
            position: addVector(departurePosition, coastClusterEvent.position),
          },
          startVelocity: clusterPeakVelocity,
          endVelocity: clusterPeakVelocity,
        }
      : undefined;
  const phaseBraking: GeneralTransferPhase = {
    kind: "braking",
    coordinateDuration:
      totalClusterEvent.time - (phaseCoast?.endEvent.time ?? phaseAcceleration.endEvent.time),
    properDuration: (c / brakingAcceleration) * relativeRapidity,
    startEvent: phaseCoast?.endEvent ?? phaseAcceleration.endEvent,
    endEvent: {
      time: totalClusterEvent.time,
      position: absoluteArrivalPosition,
    },
    startVelocity: clusterPeakVelocity,
    endVelocity: clusterArrivalVelocity,
  };
  const phases =
    phaseCoast === undefined
      ? [phaseAcceleration, phaseBraking]
      : [phaseAcceleration, phaseCoast, phaseBraking];
  const normalizedResidual = [
    targetRestTimeResidual / Math.max(1, duration),
    targetRestPositionResidual.x / Math.max(1, vectorMagnitude(relativeTargetPosition)),
    targetRestPositionResidual.y / Math.max(1, vectorMagnitude(relativeTargetPosition)),
    targetRestPositionResidual.z / Math.max(1, vectorMagnitude(relativeTargetPosition)),
  ];

  return {
    variables: [],
    trajectory: Object.freeze({
      duration: totalClusterEvent.time,
      properDuration: phases.reduce((sum, phase) => sum + phase.properDuration, 0),
      // The target is re-evaluated at the constructed endpoint above, so the public timeline
      // has one arrival epoch even when the trial root is stopped by floating-point spacing.
      target: finalTarget,
      phases: Object.freeze(phases),
      peakSpeed: Math.max(
        vectorMagnitude(departureVelocity),
        vectorMagnitude(clusterPeakVelocity),
        vectorMagnitude(clusterArrivalVelocity),
      ),
      distance: vectorMagnitude(relativeTargetPosition),
      positionResidual,
      velocityResidual,
      timeResidual: 0,
    }),
    residual: Object.freeze(normalizedResidual),
  };
}

function residualMagnitude(value: readonly number[]): number {
  return Math.hypot(...value);
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | undefined {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index] ?? 0]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]?.[column] ?? 0) > Math.abs(augmented[pivot]?.[column] ?? 0)) {
        pivot = row;
      }
    }
    const pivotValue = augmented[pivot]?.[column] ?? 0;
    if (Math.abs(pivotValue) <= Number.EPSILON) {
      return undefined;
    }
    const pivotRow = augmented[pivot];
    const columnRow = augmented[column];
    if (pivotRow === undefined || columnRow === undefined) {
      return undefined;
    }
    augmented[column] = pivotRow;
    augmented[pivot] = columnRow;
    for (let row = column + 1; row < size; row += 1) {
      const rowValues = augmented[row];
      if (rowValues === undefined) {
        return undefined;
      }
      const factor = (rowValues[column] ?? 0) / pivotValue;
      for (let entry = column; entry <= size; entry += 1) {
        rowValues[entry] = (rowValues[entry] ?? 0) - factor * (pivotRow[entry] ?? 0);
      }
    }
  }
  const result = Array.from({ length: size }, () => 0);
  for (let row = size - 1; row >= 0; row -= 1) {
    const rowValues = augmented[row];
    if (rowValues === undefined) {
      return undefined;
    }
    let value = rowValues[size] ?? 0;
    for (let column = row + 1; column < size; column += 1) {
      value -= (rowValues[column] ?? 0) * (result[column] ?? 0);
    }
    result[row] = value / (rowValues[row] ?? 1);
  }
  return result;
}

function perpendicularBasis(
  value: NumericVector3,
): { readonly first: NumericVector3; readonly second: NumericVector3 } | undefined {
  const base = unitVector(value);
  if (base === undefined) {
    return undefined;
  }
  const reference = Math.abs(base.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const first = unitVector(crossVector(base, reference));
  if (first === undefined) {
    return undefined;
  }
  const second = unitVector(crossVector(base, first));
  return second === undefined ? undefined : { first, second };
}

function solveGeneralTransfer(
  scenario: CompiledScenario,
  destinationGateId: StableId,
  departureCoordinateTime: Seconds,
  departurePosition: NumericVector3,
  departureVelocity: NumericVector3,
  acceleration: number,
  brakingAcceleration: number,
  maximumSublightSpeed: number,
  initial: TransferEvaluation,
  issues: InSystemTransferIssue[],
): GeneralTransferTrajectory | undefined {
  const initialDuration = Math.max(initial.duration, initial.profile.duration);
  const initialTargetResult = targetAt(
    scenario,
    destinationGateId,
    seconds(departureCoordinateTime.value + initialDuration),
  );
  if (!initialTargetResult.ok) {
    return undefined;
  }
  const initialTargetPosition = numericPosition(initialTargetResult.target.position);
  const initialEvent = boostEventToRest(
    {
      time: initialDuration,
      position: subtractVector(initialTargetPosition, departurePosition),
    },
    departureVelocity,
  );
  const initialDirection = unitVector(initialEvent.position);
  const basis = initialDirection === undefined ? undefined : perpendicularBasis(initialDirection);
  if (basis === undefined || initialDirection === undefined) {
    addIssue(
      issues,
      "infeasible-transfer",
      `gates.${destinationGateId}`,
      "A three-dimensional powered transfer needs a non-zero departure-frame direction.",
      "gate",
      destinationGateId,
      undefined,
    );
    return undefined;
  }
  const direction = initialDirection;
  const initialRapidity = rapidityForSpeed(initial.profile.peakSpeed);
  const capRapidity = rapidityForSpeed(maximumSublightSpeed);
  const initialCoastProper =
    initial.profile.coast === undefined
      ? 0
      : initial.profile.coast.coordinateDuration / Math.cosh(capRapidity);
  const solveMode = (capped: boolean): GeneralTransferTrajectory | undefined => {
    const baseVariables = capped
      ? [0, 0, initialCoastProper, initialDuration]
      : [
          direction.x * initialRapidity,
          direction.y * initialRapidity,
          direction.z * initialRapidity,
          initialDuration,
        ];
    const evaluate = (variables: readonly number[]): GeneralSolveEvaluation | undefined => {
      const duration = Math.max(1e-9, variables[3] ?? 0);
      let peakRapidityVector: NumericVector3;
      let coastProperDuration: number;
      if (capped) {
        const first = variables[0] ?? 0;
        const second = variables[1] ?? 0;
        const orientation = unitVector(
          addVector(
            addVector(direction, scaleVector(basis.first, first)),
            scaleVector(basis.second, second),
          ),
        );
        if (orientation === undefined) {
          return undefined;
        }
        peakRapidityVector = scaleVector(orientation, capRapidity);
        coastProperDuration = Math.max(0, variables[2] ?? 0);
      } else {
        peakRapidityVector = { x: variables[0] ?? 0, y: variables[1] ?? 0, z: variables[2] ?? 0 };
        coastProperDuration = 0;
      }
      const result = generalTrajectoryAt(
        scenario,
        destinationGateId,
        departureCoordinateTime,
        departurePosition,
        departureVelocity,
        acceleration,
        brakingAcceleration,
        peakRapidityVector,
        coastProperDuration,
        duration,
      );
      if (result === undefined) {
        return undefined;
      }
      return {
        ...result,
        variables,
        residual: result.residual,
      };
    };
    let current = evaluate(baseVariables);
    if (current === undefined) {
      return undefined;
    }
    const residualTolerance = Math.min(
      1e-9,
      TRANSFER_POSITION_RESIDUAL_TOLERANCE / Math.max(1, vectorMagnitude(initialEvent.position)),
    );
    for (let iteration = 0; iteration < 48; iteration += 1) {
      const trajectoryTimeTolerance = timeTolerance(
        departureCoordinateTime,
        0,
        Math.max(current.trajectory.duration, current.variables[3] ?? 0),
      );
      if (
        residualMagnitude(current.residual) <= residualTolerance &&
        current.trajectory.timeResidual <= trajectoryTimeTolerance
      ) {
        return current.trajectory;
      }

      const jacobian: number[][] = [];
      for (let row = 0; row < 4; row += 1) {
        jacobian.push([]);
      }
      for (let column = 0; column < 4; column += 1) {
        const step =
          column === 3
            ? Math.max(1e-4, Math.abs(current.variables[column] ?? 0) * 1e-8)
            : capped && column === 2
              ? Math.max(1e-4, Math.abs(current.variables[column] ?? 0) * 1e-8)
              : 1e-7;
        const plusVariables = [...current.variables];
        plusVariables[column] = (plusVariables[column] ?? 0) + step;
        const plus = evaluate(plusVariables);
        if (plus === undefined) {
          return undefined;
        }
        const minusVariables = [...current.variables];
        minusVariables[column] = (minusVariables[column] ?? 0) - step;
        const minus = evaluate(minusVariables);
        if (minus === undefined) {
          return undefined;
        }
        for (let row = 0; row < 4; row += 1) {
          const jacobianRow = jacobian[row];
          if (jacobianRow !== undefined) {
            jacobianRow[column] =
              ((plus.residual[row] ?? 0) - (minus.residual[row] ?? 0)) / (2 * step);
          }
        }
      }
      const update = solveLinearSystem(
        jacobian,
        current.residual.map((value) => -value),
      );
      if (update === undefined) {
        return undefined;
      }
      let accepted: GeneralSolveEvaluation | undefined;
      for (const damping of [1, 0.5, 0.25, 0.125, 0.0625]) {
        const candidateVariables = current.variables.map((value, index) => {
          const candidate = value + (update[index] ?? 0) * damping;
          return index === 3 || (capped && index === 2) ? Math.max(1e-9, candidate) : candidate;
        });
        const candidate = evaluate(candidateVariables);
        if (
          candidate !== undefined &&
          residualMagnitude(candidate.residual) < residualMagnitude(current.residual)
        ) {
          accepted = candidate;
          break;
        }
      }
      if (accepted === undefined) {
        return undefined;
      }
      current = accepted;
    }
    return undefined;
  };

  let trajectory = solveMode(false);
  if (
    trajectory !== undefined &&
    trajectory.peakSpeed <= maximumSublightSpeed + TRANSFER_SPEED_TOLERANCE
  ) {
    return trajectory;
  }
  trajectory = solveMode(true);
  if (trajectory === undefined) {
    addIssue(
      issues,
      "non-convergent-transfer",
      `gates.${destinationGateId}`,
      "The full three-dimensional powered transfer solver did not converge.",
      "gate",
      destinationGateId,
      undefined,
    );
    return undefined;
  }
  if (trajectory.peakSpeed > maximumSublightSpeed + TRANSFER_SPEED_TOLERANCE) {
    addIssue(
      issues,
      "infeasible-transfer",
      "shipProfiles.maximumSublightSpeed",
      "The full three-dimensional powered trajectory exceeds the Ship Profile speed cap.",
      "ship-profile",
      undefined,
      destinationGateId,
    );
    return undefined;
  }
  return trajectory;
}

function targetAt(
  scenario: CompiledScenario,
  destinationGateId: StableId,
  coordinateTime: Seconds,
): TargetEvaluation {
  const result = evaluateGateWorldline(scenario, destinationGateId, coordinateTime);
  return result.ok ? { ok: true, target: result.state } : { ok: false, issues: result.issues };
}

function addWorldlineIssues(
  worldlineIssues: readonly WorldlineIssue[],
  issues: InSystemTransferIssue[],
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

function speedIsValid(value: NumericVector3): boolean {
  const speed = vectorMagnitude(value);
  return Number.isFinite(speed) && speed < SPEED_OF_LIGHT.value;
}

function evaluateAtDuration(
  scenario: CompiledScenario,
  destinationGateId: StableId,
  departureCoordinateTime: Seconds,
  departurePosition: NumericVector3,
  departureVelocity: NumericVector3,
  acceleration: number,
  brakingAcceleration: number,
  maximumSublightSpeed: number,
  duration: number,
):
  | { readonly ok: true; readonly evaluation: TransferEvaluation }
  | { readonly ok: false; readonly issues: readonly WorldlineIssue[] }
  | {
      readonly ok: false;
      readonly code: "invalid-distance" | "invalid-speed" | "infeasible-transfer";
      readonly message: string;
    } {
  const targetResult = targetAt(
    scenario,
    destinationGateId,
    seconds(departureCoordinateTime.value + duration),
  );
  if (!targetResult.ok) {
    return targetResult;
  }

  const targetPosition = numericPosition(targetResult.target.position);
  const targetVelocity = numericVelocity(targetResult.target.velocity);
  if (!speedIsValid(targetVelocity)) {
    return {
      ok: false,
      code: "invalid-speed",
      message: `Destination Gate ${destinationGateId} has a non-sublight velocity at the transfer endpoint.`,
    };
  }

  const elapsedDepartureDrift = scaleVector(departureVelocity, duration);
  const relativeDisplacement = subtractVector(
    subtractVector(targetPosition, departurePosition),
    elapsedDepartureDrift,
  );
  const distance = vectorMagnitude(relativeDisplacement);
  const direction = unitVector(relativeDisplacement);
  if (direction === undefined) {
    return {
      ok: false,
      code: "invalid-distance",
      message: "The destination Gate coincides with the departure ship's drift position.",
    };
  }

  const relativeVelocity = subtractVector(targetVelocity, departureVelocity);
  const finalRelativeSpeed = dotVector(relativeVelocity, direction);
  const profileResult = profileForDistance(
    distance,
    finalRelativeSpeed,
    acceleration,
    brakingAcceleration,
    maximumSublightSpeed,
    direction,
  );
  if (!profileResult.ok) {
    return profileResult;
  }

  const profile = profileResult.profile;
  const shipPosition = addVector(
    addVector(departurePosition, elapsedDepartureDrift),
    scaleVector(direction, profile.distance),
  );
  const shipVelocity = addVector(
    departureVelocity,
    scaleVector(direction, profile.finalRelativeSpeed),
  );
  return {
    ok: true,
    evaluation: Object.freeze({
      duration,
      target: targetResult.target,
      profile,
      departurePosition,
      departureVelocity,
      shipPosition,
      shipVelocity,
      positionResidual: vectorMagnitude(subtractVector(shipPosition, targetPosition)),
      velocityResidual: vectorMagnitude(subtractVector(shipVelocity, targetVelocity)),
    }),
  };
}

function representableSpacing(value: number): number {
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

function timeTolerance(departureCoordinateTime: Seconds, lower: number, upper: number): number {
  return Math.max(
    TRANSFER_TIME_TOLERANCE,
    representableSpacing(lower),
    representableSpacing(upper),
    representableSpacing(departureCoordinateTime.value + lower),
    representableSpacing(departureCoordinateTime.value + upper),
  );
}

function solveTransfer(
  scenario: CompiledScenario,
  destinationGateId: StableId,
  departureCoordinateTime: Seconds,
  departurePosition: NumericVector3,
  departureVelocity: NumericVector3,
  acceleration: number,
  brakingAcceleration: number,
  maximumSublightSpeed: number,
  issues: InSystemTransferIssue[],
): TransferSolution | undefined {
  const initial = evaluateAtDuration(
    scenario,
    destinationGateId,
    departureCoordinateTime,
    departurePosition,
    departureVelocity,
    acceleration,
    brakingAcceleration,
    maximumSublightSpeed,
    0,
  );
  if (!initial.ok) {
    if ("issues" in initial) {
      addWorldlineIssues(initial.issues, issues);
    } else {
      addIssue(
        issues,
        initial.code,
        `gates.${destinationGateId}`,
        initial.message,
        "gate",
        destinationGateId,
        undefined,
      );
    }
    return undefined;
  }

  if (vectorMagnitude(departureVelocity) > Number.EPSILON) {
    const general = solveGeneralTransfer(
      scenario,
      destinationGateId,
      departureCoordinateTime,
      departurePosition,
      departureVelocity,
      acceleration,
      brakingAcceleration,
      maximumSublightSpeed,
      initial.evaluation,
      issues,
    );
    if (general === undefined) {
      return undefined;
    }
    return Object.freeze({ ...initial.evaluation, timeResidual: 0, general });
  }

  let lowerDuration = 0;
  let lower = initial.evaluation;
  let upperDuration = Math.max(1, lower.profile.duration);
  let upper: TransferEvaluation | undefined;
  for (let expansion = 0; expansion < TRANSFER_MAX_SOLVER_ITERATIONS; expansion += 1) {
    if (!Number.isFinite(upperDuration) || upperDuration > TRANSFER_MAX_SEARCH_SECONDS) {
      break;
    }
    const candidate = evaluateAtDuration(
      scenario,
      destinationGateId,
      departureCoordinateTime,
      departurePosition,
      departureVelocity,
      acceleration,
      brakingAcceleration,
      maximumSublightSpeed,
      upperDuration,
    );
    if (!candidate.ok) {
      if ("issues" in candidate) {
        addWorldlineIssues(candidate.issues, issues);
      } else {
        addIssue(
          issues,
          candidate.code,
          `gates.${destinationGateId}`,
          candidate.message,
          "gate",
          destinationGateId,
          undefined,
        );
      }
      return undefined;
    }
    if (candidate.evaluation.profile.duration <= upperDuration) {
      upper = candidate.evaluation;
      break;
    }
    upperDuration *= 2;
  }

  if (upper === undefined) {
    addIssue(
      issues,
      "non-convergent-transfer",
      `gates.${destinationGateId}`,
      `No powered In-system Transfer intercept for Gate ${destinationGateId} was bracketed within the configured search horizon.`,
      "gate",
      destinationGateId,
      undefined,
    );
    return undefined;
  }

  let best =
    Math.abs(lower.profile.duration - lowerDuration) <
    Math.abs(upper.profile.duration - upperDuration)
      ? lower
      : upper;
  let interval = upperDuration - lowerDuration;
  let tolerance = timeTolerance(departureCoordinateTime, lowerDuration, upperDuration);
  let converged = false;
  for (let iteration = 0; iteration < TRANSFER_MAX_SOLVER_ITERATIONS; iteration += 1) {
    const midpointDuration = (lowerDuration + upperDuration) / 2;
    const midpointStagnated =
      midpointDuration === lowerDuration || midpointDuration === upperDuration;
    const midpoint = evaluateAtDuration(
      scenario,
      destinationGateId,
      departureCoordinateTime,
      departurePosition,
      departureVelocity,
      acceleration,
      brakingAcceleration,
      maximumSublightSpeed,
      midpointDuration,
    );
    if (!midpoint.ok) {
      if ("issues" in midpoint) {
        addWorldlineIssues(midpoint.issues, issues);
      } else {
        addIssue(
          issues,
          midpoint.code,
          `gates.${destinationGateId}`,
          midpoint.message,
          "gate",
          destinationGateId,
          undefined,
        );
      }
      return undefined;
    }

    const midpointResidual = midpoint.evaluation.profile.duration - midpointDuration;
    if (
      Math.abs(midpointResidual) < Math.abs(best.profile.duration - best.duration) ||
      Math.abs(midpoint.evaluation.positionResidual) < Math.abs(best.positionResidual)
    ) {
      best = midpoint.evaluation;
    }

    if (!midpointStagnated) {
      if (midpointResidual > 0) {
        lowerDuration = midpointDuration;
        lower = midpoint.evaluation;
      } else {
        upperDuration = midpointDuration;
        upper = midpoint.evaluation;
      }
      interval = upperDuration - lowerDuration;
    }
    tolerance = timeTolerance(departureCoordinateTime, lowerDuration, upperDuration);
    if (interval <= tolerance && best.positionResidual <= TRANSFER_POSITION_RESIDUAL_TOLERANCE) {
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
      "non-convergent-transfer",
      `gates.${destinationGateId}`,
      `Powered In-system Transfer for Gate ${destinationGateId} did not converge within the representable time tolerance of ${tolerance} s.`,
      "gate",
      destinationGateId,
      undefined,
    );
    return undefined;
  }

  const requiresGeneralTrajectory =
    vectorMagnitude(departureVelocity) > Number.EPSILON ||
    best.velocityResidual > TRANSFER_VELOCITY_RESIDUAL_TOLERANCE;
  const general = requiresGeneralTrajectory
    ? solveGeneralTransfer(
        scenario,
        destinationGateId,
        departureCoordinateTime,
        departurePosition,
        departureVelocity,
        acceleration,
        brakingAcceleration,
        maximumSublightSpeed,
        best,
        issues,
      )
    : undefined;
  if (requiresGeneralTrajectory && general === undefined) {
    return undefined;
  }

  return Object.freeze({ ...best, timeResidual: interval, general });
}

function lateralState(
  profile: TransferProfile,
  phaseKind: InSystemTransferPhaseKind,
  elapsed: number,
): { readonly position: NumericVector3; readonly velocity: NumericVector3 } {
  const accelerationDuration = profile.acceleration.coordinateDuration;
  const coastDuration = profile.coast?.coordinateDuration ?? 0;
  const time = Math.max(
    0,
    Math.min(
      elapsed,
      phaseKind === "acceleration"
        ? accelerationDuration
        : phaseKind === "coast"
          ? coastDuration
          : profile.braking.coordinateDuration,
    ),
  );
  const accelerationVelocity = scaleVector(profile.transverseAcceleration, accelerationDuration);
  const accelerationPosition = scaleVector(
    profile.transverseAcceleration,
    0.5 * accelerationDuration ** 2,
  );
  if (phaseKind === "acceleration") {
    return {
      position: scaleVector(profile.transverseAcceleration, 0.5 * time ** 2),
      velocity: scaleVector(profile.transverseAcceleration, time),
    };
  }

  const brakingStartPosition = addVector(
    accelerationPosition,
    scaleVector(accelerationVelocity, coastDuration),
  );
  if (phaseKind === "coast") {
    return {
      position: addVector(accelerationPosition, scaleVector(accelerationVelocity, time)),
      velocity: accelerationVelocity,
    };
  }

  return {
    position: addVector(
      addVector(brakingStartPosition, scaleVector(accelerationVelocity, time)),
      scaleVector(profile.transverseBraking, 0.5 * time ** 2),
    ),
    velocity: addVector(accelerationVelocity, scaleVector(profile.transverseBraking, time)),
  };
}

function properDurationForPhase(
  phase: Segment,
  profile: TransferProfile,
  departureVelocity: NumericVector3,
  direction: NumericVector3,
  peakRapidity: number,
): number {
  if (
    vectorMagnitude(departureVelocity) <= Number.EPSILON &&
    vectorMagnitude(profile.transverseAcceleration) <= Number.EPSILON &&
    vectorMagnitude(profile.transverseBraking) <= Number.EPSILON
  ) {
    return phase.properDuration;
  }

  const c = SPEED_OF_LIGHT.value;
  const samples = 32;
  let sum = 0;
  for (let index = 0; index <= samples; index += 1) {
    const fraction = index / samples;
    let relativeSpeed: number;
    if (phase.kind === "acceleration") {
      const rapidity = Math.asinh(sinhForRapidity(peakRapidity) * fraction);
      relativeSpeed = speedForRapidity(rapidity);
    } else if (phase.kind === "coast") {
      relativeSpeed = phase.startRelativeSpeed;
    } else {
      const finalRapidity = rapidityForSpeed(phase.endRelativeSpeed);
      const sinhRapidity =
        sinhForRapidity(peakRapidity) +
        (sinhForRapidity(finalRapidity) - sinhForRapidity(peakRapidity)) * fraction;
      const rapidity = Math.asinh(sinhRapidity);
      relativeSpeed = speedForRapidity(rapidity);
    }
    const lateralVelocity = lateralState(
      profile,
      phase.kind,
      phase.coordinateDuration * fraction,
    ).velocity;
    const velocity = addVector(
      addVector(departureVelocity, scaleVector(direction, relativeSpeed)),
      lateralVelocity,
    );
    const speedRatio = vectorMagnitude(velocity) / c;
    const integrand = speedRatio >= 1 ? 0 : Math.sqrt(1 - speedRatio ** 2);
    const coefficient = index === 0 || index === samples ? 1 : index % 2 === 0 ? 2 : 4;
    sum += coefficient * integrand;
  }
  return (phase.coordinateDuration / (3 * samples)) * sum;
}

function phasePosition(
  departurePosition: NumericVector3,
  departureVelocity: NumericVector3,
  direction: NumericVector3,
  coordinateTime: number,
  relativeDistance: number,
  lateralPosition: NumericVector3,
): NumericVector3 {
  return addVector(
    addVector(
      addVector(departurePosition, scaleVector(departureVelocity, coordinateTime)),
      scaleVector(direction, relativeDistance),
    ),
    lateralPosition,
  );
}

function phaseVelocity(
  departureVelocity: NumericVector3,
  direction: NumericVector3,
  relativeSpeed: number,
  lateralVelocity: NumericVector3,
): NumericVector3 {
  return addVector(
    addVector(departureVelocity, scaleVector(direction, relativeSpeed)),
    lateralVelocity,
  );
}

function makePhase(
  profilePhase: Segment,
  properDuration: number,
  start: JourneyClockReading,
  end: JourneyClockReading,
  startPosition: NumericVector3,
  endPosition: NumericVector3,
  startVelocity: NumericVector3,
  endVelocity: NumericVector3,
): InSystemTransferPhase {
  return Object.freeze({
    kind: profilePhase.kind,
    clusterCoordinateDuration: seconds(profilePhase.coordinateDuration),
    shipProperDuration: seconds(properDuration),
    agingDifference: seconds(profilePhase.coordinateDuration - properDuration),
    start,
    end,
    startPosition: positionVector(startPosition),
    endPosition: positionVector(endPosition),
    startVelocity: velocityVector(startVelocity),
    endVelocity: velocityVector(endVelocity),
  });
}

function event(
  kind: InSystemTransferEventKind,
  phase: InSystemTransferPhaseKind,
  reading: JourneyClockReading,
  position: NumericVector3,
  velocity: NumericVector3,
): InSystemTransferEvent {
  return Object.freeze({
    kind,
    phase,
    clocks: reading,
    cumulativeClusterCoordinateTime: reading.clusterCoordinateTime,
    cumulativeShipProperTime: reading.shipProperTime,
    cumulativeAgingDifference: reading.agingDifference,
    position: positionVector(position),
    velocity: velocityVector(velocity),
  });
}

function makeGeneralTimeline(
  departureGateId: StableId,
  destinationGateId: StableId,
  shipProfileId: StableId,
  departureCoordinateTime: Seconds,
  departure: GateWorldline,
  trajectory: GeneralTransferTrajectory,
): InSystemTransferTimeline {
  const phases: InSystemTransferPhase[] = [];
  const events: InSystemTransferEvent[] = [];
  let cumulativeProperTime = 0;
  for (const [index, trajectoryPhase] of trajectory.phases.entries()) {
    const startReading = clocks(trajectoryPhase.startEvent.time, cumulativeProperTime);
    cumulativeProperTime += trajectoryPhase.properDuration;
    const endReading = clocks(trajectoryPhase.endEvent.time, cumulativeProperTime);
    phases.push(
      makePhase(
        {
          kind: trajectoryPhase.kind,
          coordinateDuration: trajectoryPhase.coordinateDuration,
          properDuration: trajectoryPhase.properDuration,
          relativeDistance: vectorMagnitude(
            subtractVector(trajectoryPhase.endEvent.position, trajectoryPhase.startEvent.position),
          ),
          startRelativeSpeed: vectorMagnitude(trajectoryPhase.startVelocity),
          endRelativeSpeed: vectorMagnitude(trajectoryPhase.endVelocity),
        },
        trajectoryPhase.properDuration,
        startReading,
        endReading,
        trajectoryPhase.startEvent.position,
        trajectoryPhase.endEvent.position,
        trajectoryPhase.startVelocity,
        trajectoryPhase.endVelocity,
      ),
    );
    if (index === 0) {
      events.push(
        event(
          "departure",
          trajectoryPhase.kind,
          startReading,
          trajectoryPhase.startEvent.position,
          trajectoryPhase.startVelocity,
        ),
      );
    }
    if (trajectoryPhase.kind === "acceleration" && trajectory.phases.length === 3) {
      events.push(
        event(
          "acceleration-end",
          trajectoryPhase.kind,
          endReading,
          trajectoryPhase.endEvent.position,
          trajectoryPhase.endVelocity,
        ),
      );
      events.push(
        event(
          "coast-start",
          "coast",
          endReading,
          trajectoryPhase.endEvent.position,
          trajectoryPhase.endVelocity,
        ),
      );
    }
    if (trajectoryPhase.kind === "braking") {
      events.push(
        event(
          "flip",
          trajectoryPhase.kind,
          startReading,
          trajectoryPhase.startEvent.position,
          trajectoryPhase.startVelocity,
        ),
      );
    }
  }

  const total = clocks(trajectory.duration, cumulativeProperTime);
  const finalPhase = trajectory.phases[trajectory.phases.length - 1];
  const arrivalPosition = finalPhase?.endEvent.position ?? numericPosition(departure.position);
  const arrivalVelocity = finalPhase?.endVelocity ?? numericVelocity(departure.velocity);
  events.push(event("arrival", "braking", total, arrivalPosition, arrivalVelocity));
  const targetPosition = numericPosition(trajectory.target.position);
  const targetVelocity = numericVelocity(trajectory.target.velocity);
  const terminalResiduals = Object.freeze({
    position: meters(trajectory.positionResidual),
    velocity: metersPerSecond(trajectory.velocityResidual),
  });
  const coastPhase = trajectory.phases.find((phase) => phase.kind === "coast");
  return Object.freeze({
    departureGateId,
    destinationGateId,
    shipProfileId,
    departureCoordinateTime,
    arrivalCoordinateTime: seconds(departureCoordinateTime.value + trajectory.duration),
    timeResidual: seconds(trajectory.timeResidual),
    distance: meters(
      vectorMagnitude(subtractVector(targetPosition, numericPosition(departure.position))),
    ),
    transferDistance: meters(trajectory.distance),
    peakSpeed: metersPerSecond(trajectory.peakSpeed),
    coastSpeed:
      coastPhase === undefined
        ? undefined
        : metersPerSecond(vectorMagnitude(coastPhase.startVelocity)),
    departurePosition: departure.position,
    departureVelocity: departure.velocity,
    arrivalPosition: positionVector(arrivalPosition),
    arrivalVelocity: velocityVector(arrivalVelocity),
    destinationPosition: trajectory.target.position,
    destinationVelocity: trajectory.target.velocity,
    terminalResiduals,
    positionResidual: terminalResiduals.position,
    velocityResidual: terminalResiduals.velocity,
    phases: Object.freeze(phases),
    events: Object.freeze(events),
    total,
    totalClusterCoordinateTime: total.clusterCoordinateTime,
    totalShipProperTime: total.shipProperTime,
    totalAgingDifference: total.agingDifference,
  });
}

function makeTimeline(
  scenario: CompiledScenario,
  departureGateId: StableId,
  destinationGateId: StableId,
  shipProfileId: StableId,
  departureCoordinateTime: Seconds,
  departure: GateWorldline,
  solved: TransferSolution,
): InSystemTransferTimeline {
  const { profile, target, duration } = solved;
  const departurePosition = numericPosition(departure.position);
  const departureVelocity = numericVelocity(departure.velocity);
  const phases: InSystemTransferPhase[] = [];
  const events: InSystemTransferEvent[] = [];
  let cumulativeCoordinateTime = 0;
  let cumulativeProperTime = 0;
  let relativeDistance = 0;
  let phaseIndex = 0;
  const profilePhases = [profile.acceleration, profile.coast, profile.braking].filter(
    (candidate): candidate is Segment => candidate !== undefined,
  );

  for (const profilePhase of profilePhases) {
    const startCoordinateTime = cumulativeCoordinateTime;
    const startProperTime = cumulativeProperTime;
    const startDistance = relativeDistance;
    const endCoordinateTime = startCoordinateTime + profilePhase.coordinateDuration;
    const endDistance = startDistance + profilePhase.relativeDistance;
    const properDuration = properDurationForPhase(
      profilePhase,
      profile,
      departureVelocity,
      profile.direction,
      rapidityForSpeed(profile.peakSpeed),
    );
    cumulativeCoordinateTime = endCoordinateTime;
    cumulativeProperTime += properDuration;
    const startReading = clocks(startCoordinateTime, startProperTime);
    const endReading = clocks(cumulativeCoordinateTime, cumulativeProperTime);
    const startLateral = lateralState(profile, profilePhase.kind, 0);
    const endLateral = lateralState(profile, profilePhase.kind, profilePhase.coordinateDuration);
    const startPosition = phasePosition(
      departurePosition,
      departureVelocity,
      profile.direction,
      startCoordinateTime,
      startDistance,
      startLateral.position,
    );
    const endPosition = phasePosition(
      departurePosition,
      departureVelocity,
      profile.direction,
      endCoordinateTime,
      endDistance,
      endLateral.position,
    );
    const startVelocity = phaseVelocity(
      departureVelocity,
      profile.direction,
      profilePhase.startRelativeSpeed,
      startLateral.velocity,
    );
    const endVelocity = phaseVelocity(
      departureVelocity,
      profile.direction,
      profilePhase.endRelativeSpeed,
      endLateral.velocity,
    );
    phases.push(
      makePhase(
        profilePhase,
        properDuration,
        startReading,
        endReading,
        startPosition,
        endPosition,
        startVelocity,
        endVelocity,
      ),
    );
    if (phaseIndex === 0) {
      events.push(
        event("departure", profilePhase.kind, startReading, startPosition, startVelocity),
      );
    }
    if (profilePhase.kind === "acceleration" && profile.coast !== undefined) {
      events.push(
        event("acceleration-end", profilePhase.kind, endReading, endPosition, endVelocity),
      );
      events.push(event("coast-start", "coast", endReading, endPosition, endVelocity));
    }
    if (profilePhase.kind === "braking") {
      events.push(event("flip", profilePhase.kind, startReading, startPosition, startVelocity));
    }
    relativeDistance = endDistance;
    phaseIndex += 1;
  }

  const total = clocks(cumulativeCoordinateTime, cumulativeProperTime);
  const arrivalLateral = lateralState(profile, "braking", profile.braking.coordinateDuration);
  const arrivalPosition = phasePosition(
    departurePosition,
    departureVelocity,
    profile.direction,
    cumulativeCoordinateTime,
    profile.distance,
    arrivalLateral.position,
  );
  const arrivalVelocity = phaseVelocity(
    departureVelocity,
    profile.direction,
    profile.finalRelativeSpeed,
    arrivalLateral.velocity,
  );
  const arrivalTargetResult = targetAt(
    scenario,
    destinationGateId,
    seconds(departureCoordinateTime.value + cumulativeCoordinateTime),
  );
  const arrivalTarget = arrivalTargetResult.ok ? arrivalTargetResult.target : target;
  const actualDestinationPosition = numericPosition(arrivalTarget.position);
  const actualDestinationVelocity = numericVelocity(arrivalTarget.velocity);
  events.push(event("arrival", "braking", total, arrivalPosition, arrivalVelocity));
  const terminalResiduals = Object.freeze({
    position: meters(vectorMagnitude(subtractVector(arrivalPosition, actualDestinationPosition))),
    velocity: metersPerSecond(
      vectorMagnitude(subtractVector(arrivalVelocity, actualDestinationVelocity)),
    ),
  });
  const peakVelocity = phaseVelocity(
    departureVelocity,
    profile.direction,
    profile.peakSpeed,
    lateralState(profile, "acceleration", profile.acceleration.coordinateDuration).velocity,
  );
  const peakSpeed = Math.max(
    vectorMagnitude(departureVelocity),
    vectorMagnitude(peakVelocity),
    vectorMagnitude(arrivalVelocity),
  );

  return Object.freeze({
    departureGateId,
    destinationGateId,
    shipProfileId,
    departureCoordinateTime,
    arrivalCoordinateTime: seconds(departureCoordinateTime.value + cumulativeCoordinateTime),
    timeResidual: seconds(Math.abs(cumulativeCoordinateTime - duration)),
    distance: meters(vectorMagnitude(subtractVector(actualDestinationPosition, departurePosition))),
    transferDistance: meters(profile.distance),
    peakSpeed: metersPerSecond(peakSpeed),
    coastSpeed: profile.coastSpeed === undefined ? undefined : metersPerSecond(profile.coastSpeed),
    departurePosition: departure.position,
    departureVelocity: departure.velocity,
    arrivalPosition: positionVector(arrivalPosition),
    arrivalVelocity: velocityVector(arrivalVelocity),
    destinationPosition: arrivalTarget.position,
    destinationVelocity: arrivalTarget.velocity,
    terminalResiduals,
    positionResidual: terminalResiduals.position,
    velocityResidual: terminalResiduals.velocity,
    phases: Object.freeze(phases),
    events: Object.freeze(events),
    total,
    totalClusterCoordinateTime: total.clusterCoordinateTime,
    totalShipProperTime: total.shipProperTime,
    totalAgingDifference: total.agingDifference,
  });
}

/**
 * Simulates a powered three-dimensional In-system Transfer between two Gates in one System.
 *
 * The ship starts comoving with the departure Gate, accelerates with constant proper acceleration,
 * coasts only when the Ship Profile speed cap is reached, flips, and brakes with the configured
 * braking acceleration until its longitudinal velocity matches the destination Gate. The
 * destination Gate is evaluated on its moving worldline while a bounded fixed-point solve finds
 * the earliest intercept. Gravity, obstacles, propellant, and spacecraft operations are omitted.
 *
 * @param scenario - The immutable, previously compiled Scenario containing both Gates.
 * @param request - An unknown request value validated at this model seam.
 * @returns A complete immutable transfer timeline or structured transfer issues.
 */
export function simulateInSystemTransfer(
  scenario: CompiledScenario,
  request: unknown,
): InSystemTransferSimulationResult {
  const issues: InSystemTransferIssue[] = [];
  if (!isRecord(request)) {
    addIssue(
      issues,
      "invalid-request",
      "request",
      "In-system transfer request must be an object.",
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
      : undefined;
  const departureCoordinateTime =
    departureTimeValue === undefined
      ? scenario.epoch.coordinateTime
      : readSeconds(departureTimeValue, "request.departureCoordinateTime", issues);
  const departureGate =
    departureGateId === undefined ? undefined : scenario.index.gates.get(departureGateId);
  const destinationGate =
    destinationGateId === undefined ? undefined : scenario.index.gates.get(destinationGateId);
  const shipProfile =
    shipProfileId === undefined ? undefined : scenario.index.shipProfiles.get(shipProfileId);

  if (departureGate === undefined && departureGateId !== undefined) {
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
  if (destinationGate === undefined && destinationGateId !== undefined) {
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
  if (shipProfile === undefined && shipProfileId !== undefined) {
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
      `Ship Profile ${shipProfile.id} cannot be used for a Journey through Gates of Heaven without a ZPZ Generator.`,
      "ship-profile",
      shipProfile.id,
      undefined,
    );
  }
  if (
    departureGate !== undefined &&
    destinationGate !== undefined &&
    departureGate.id === destinationGate.id
  ) {
    addIssue(
      issues,
      "invalid-distance",
      "request.destinationGateId",
      "An In-system Transfer requires two distinct Gates of Heaven.",
      "gate",
      destinationGate.id,
      departureGate.id,
    );
  }
  if (
    departureGate !== undefined &&
    destinationGate !== undefined &&
    departureGate.systemId !== destinationGate.systemId
  ) {
    addIssue(
      issues,
      "invalid-transfer-endpoints",
      "request.destinationGateId",
      `In-system Transfer endpoints must belong to the same System; ${departureGate.id} and ${destinationGate.id} do not.`,
      "gate",
      departureGate.id,
      destinationGate.id,
    );
  }
  if (
    shipProfile !== undefined &&
    (!Number.isFinite(shipProfile.acceleration.value) ||
      !Number.isFinite(shipProfile.brakingAcceleration.value) ||
      !Number.isFinite(shipProfile.maximumSublightSpeed.value) ||
      shipProfile.acceleration.value <= 0 ||
      shipProfile.brakingAcceleration.value <= 0 ||
      shipProfile.maximumSublightSpeed.value <= 0 ||
      shipProfile.maximumSublightSpeed.value >= SPEED_OF_LIGHT.value)
  ) {
    addIssue(
      issues,
      "invalid-ship-profile",
      `shipProfiles.${shipProfile.id}`,
      `Ship Profile ${shipProfile.id} contains invalid powered-transfer capabilities.`,
      "ship-profile",
      shipProfile.id,
      undefined,
    );
  }

  if (
    issues.length > 0 ||
    departureGate === undefined ||
    destinationGate === undefined ||
    shipProfile === undefined ||
    departureCoordinateTime === undefined
  ) {
    return failure(issues);
  }

  const departureWorldline = evaluateGateWorldline(
    scenario,
    departureGate.id,
    departureCoordinateTime,
  );
  if (!departureWorldline.ok) {
    addWorldlineIssues(departureWorldline.issues, issues);
    return failure(issues);
  }
  const departurePosition = numericPosition(departureWorldline.state.position);
  const departureVelocity = numericVelocity(departureWorldline.state.velocity);
  if (!speedIsValid(departureVelocity)) {
    addIssue(
      issues,
      "invalid-speed",
      `gates.${departureGate.id}.velocity`,
      `Departure Gate ${departureGate.id} has a non-sublight velocity.`,
      "gate",
      departureGate.id,
      undefined,
    );
    return failure(issues);
  }

  const solved = solveTransfer(
    scenario,
    destinationGate.id,
    departureCoordinateTime,
    departurePosition,
    departureVelocity,
    shipProfile.acceleration.value,
    shipProfile.brakingAcceleration.value,
    shipProfile.maximumSublightSpeed.value,
    issues,
  );
  if (solved === undefined || issues.length > 0) {
    return failure(issues);
  }

  const timeline =
    solved.general === undefined
      ? makeTimeline(
          scenario,
          departureGate.id,
          destinationGate.id,
          shipProfile.id,
          departureCoordinateTime,
          departureWorldline.state,
          solved,
        )
      : makeGeneralTimeline(
          departureGate.id,
          destinationGate.id,
          shipProfile.id,
          departureCoordinateTime,
          departureWorldline.state,
          solved.general,
        );
  if (
    !Number.isFinite(timeline.totalClusterCoordinateTime.value) ||
    !Number.isFinite(timeline.totalShipProperTime.value) ||
    !Number.isFinite(timeline.timeResidual.value) ||
    !Number.isFinite(timeline.positionResidual.value) ||
    !Number.isFinite(timeline.velocityResidual.value)
  ) {
    addIssue(
      issues,
      "invalid-coordinate-state",
      `gates.${destinationGate.id}`,
      "Powered In-system Transfer produced a non-finite timeline or terminal residual.",
      "gate",
      destinationGate.id,
      undefined,
    );
    return failure(issues);
  }
  if (
    timeline.peakSpeed.value >
    shipProfile.maximumSublightSpeed.value + TRANSFER_SPEED_TOLERANCE
  ) {
    addIssue(
      issues,
      "infeasible-transfer",
      `shipProfiles.${shipProfile.id}.maximumSublightSpeed`,
      "The three-dimensional powered trajectory exceeds the Ship Profile speed cap.",
      "ship-profile",
      shipProfile.id,
      destinationGate.id,
    );
    return failure(issues);
  }
  const timeResidualTolerance = timeTolerance(
    departureCoordinateTime,
    0,
    timeline.totalClusterCoordinateTime.value,
  );
  if (
    timeline.timeResidual.value > timeResidualTolerance ||
    timeline.positionResidual.value > TRANSFER_POSITION_RESIDUAL_TOLERANCE ||
    timeline.velocityResidual.value > TRANSFER_VELOCITY_RESIDUAL_TOLERANCE
  ) {
    addIssue(
      issues,
      "non-convergent-transfer",
      `gates.${destinationGate.id}`,
      `Powered In-system Transfer residuals exceeded ${timeResidualTolerance} s, ${TRANSFER_POSITION_RESIDUAL_TOLERANCE} m, or ${TRANSFER_VELOCITY_RESIDUAL_TOLERANCE} m/s.`,
      "gate",
      destinationGate.id,
      undefined,
    );
    return failure(issues);
  }

  return Object.freeze({ ok: true as const, timeline, issues: [] as const });
}
