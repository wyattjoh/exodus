import {
  SPEED_OF_LIGHT,
  meters,
  metersCubedPerSecondSquared,
  type GravitationalParameter,
  type Kilograms,
  type Meters,
  type MetersPerSecond,
  type MetersPerSecondSquared,
  type PositionVector,
  type Seconds,
  type SIQuantity,
  type SIUnit,
  type SIValue,
  type Vector3,
  type VelocityVector,
} from "./quantities";
import { evaluateScenarioWorldlines as resolveScenarioWorldlines } from "./orbital";
import { simulateInSystemTransfer } from "./in-system-transfer";
import { simulateJourney, simulateMultiLegJourney } from "./simulation";
import type {
  InSystemTransferRequest,
  InSystemTransferSimulationResult,
} from "./in-system-transfer";
import type {
  InterstellarCruiseRequest,
  JourneyRequest,
  JourneySimulationResult,
  MultiLegJourneySimulationResult,
} from "./simulation";

const stableIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * A stable identifier for a compiled domain entity.
 *
 * Stable identifiers remain strings at the runtime seam so compiled results are straightforward to
 * serialize and compare. Scenario compilation validates their syntax and reference identity.
 */
export type StableId = string;

/**
 * Creates a validated stable domain identifier.
 *
 * @param value - The identifier to validate.
 * @returns The identifier branded as a stable domain identifier.
 * @throws RangeError when the identifier is empty, contains whitespace, or is too long.
 */
export function stableId(value: string): StableId {
  if (!stableIdentifierPattern.test(value)) {
    throw new RangeError(
      `Stable identifiers must match ${stableIdentifierPattern.source}; received ${JSON.stringify(value)}.`,
    );
  }

  return value as StableId;
}

/**
 * Domain entity categories that can be present in a minimal Scenario.
 */
export type DomainEntityType =
  | "scenario"
  | "system"
  | "orbital-anchor"
  | "gate"
  | "gate-connection"
  | "ship-profile";

/**
 * Kinds of orbital body that can anchor a Gate of Heaven.
 */
export type OrbitalAnchorKind = "star" | "planet" | "moon" | "barycenter";

/**
 * Keplerian orbital elements supplied at the Scenario epoch.
 *
 * Angles and mean anomaly are expressed in radians. The standard gravitational parameter may be
 * supplied as a tagged SI quantity, a numeric SI value for decoded JSON compatibility, or derived
 * from `centralMass` when the source provides a mass instead.
 */
export type KeplerianOrbitInput = {
  readonly semiMajorAxis: Meters;
  readonly eccentricity: number;
  readonly inclination: number;
  readonly longitudeOfAscendingNode: number;
  readonly argumentOfPeriapsis: number;
  readonly meanAnomalyAtEpoch: number;
  readonly gravitationalParameter?: GravitationalParameter | number | undefined;
  readonly standardGravitationalParameter?: GravitationalParameter | number | undefined;
  readonly mu?: GravitationalParameter | number | undefined;
  readonly centralMass?: Kilograms | number | undefined;
};

/**
 * Alias for callers that use the domain term Orbital Elements.
 */
export type OrbitalElementsInput = KeplerianOrbitInput;

/**
 * Normalized Keplerian orbital elements stored in a Compiled Scenario.
 */
export type CompiledKeplerianOrbit = {
  readonly semiMajorAxis: Meters;
  readonly eccentricity: number;
  readonly inclination: number;
  readonly longitudeOfAscendingNode: number;
  readonly argumentOfPeriapsis: number;
  readonly meanAnomalyAtEpoch: number;
  readonly gravitationalParameter: GravitationalParameter;
};

/**
 * Alias for the normalized Orbital Elements representation.
 */
export type CompiledOrbitalElements = CompiledKeplerianOrbit;

/**
 * A scenario-relative epoch label and its Cluster Coordinate Time origin.
 */
export type ScenarioEpoch = {
  readonly label: string;
  readonly coordinateTime: Seconds;
};

/**
 * A System input accepted by Scenario compilation.
 */
export type SystemInput = {
  readonly id: string;
  readonly designation: string;
  readonly name: string;
  readonly positionAtEpoch: PositionVector;
  readonly velocityAtEpoch: VelocityVector;
};

/**
 * An Orbital Anchor input accepted by Scenario compilation.
 */
export type OrbitalAnchorInput = {
  readonly id: string;
  readonly designation: string;
  readonly name: string;
  readonly kind: OrbitalAnchorKind;
  readonly systemId: string;
  readonly parentId: string | undefined;
  readonly positionAtEpoch: PositionVector;
  readonly velocityAtEpoch: VelocityVector;
  readonly orbitalElements?: KeplerianOrbitInput | undefined;
  readonly orbit?: KeplerianOrbitInput | undefined;
};

/**
 * A Gate of Heaven input accepted by Scenario compilation.
 */
export type GateInput = {
  readonly id: string;
  readonly designation: string;
  readonly name: string;
  readonly systemId: string;
  readonly orbitalAnchorId: string;
  readonly positionAtEpoch: PositionVector;
  readonly velocityAtEpoch: VelocityVector;
  readonly orbitalElements?: KeplerianOrbitInput | undefined;
  readonly orbit?: KeplerianOrbitInput | undefined;
};

/**
 * A bidirectional pairing between exactly two Gates of Heaven.
 */
export type GateConnectionInput = {
  readonly id: string;
  readonly designation: string;
  readonly name: string;
  readonly gateAId: string;
  readonly gateBId: string;
};

/**
 * The sublight capabilities and gate-travel equipment of one ship.
 */
export type ShipProfileInput = {
  readonly id: string;
  readonly designation: string;
  readonly name: string;
  readonly acceleration: MetersPerSecondSquared;
  readonly brakingAcceleration: MetersPerSecondSquared;
  readonly maximumSublightSpeed: MetersPerSecond;
  readonly hasZpzGenerator: boolean;
};

/**
 * A complete Scenario input for the initial headless Journey Model seam.
 */
export type ScenarioInput = {
  readonly id: string;
  readonly designation: string;
  readonly name: string;
  readonly epoch: ScenarioEpoch;
  readonly systems: readonly SystemInput[];
  readonly orbitalAnchors: readonly OrbitalAnchorInput[];
  readonly gates: readonly GateInput[];
  readonly gateConnections: readonly GateConnectionInput[];
  readonly shipProfiles: readonly ShipProfileInput[];
};

/**
 * A System after all identifiers, quantities, and references have been validated.
 */
export type CompiledSystem = Omit<SystemInput, "id"> & {
  readonly id: StableId;
};

/**
 * An Orbital Anchor after all identifiers, quantities, and references have been validated.
 */
export type CompiledOrbitalAnchor = Omit<
  OrbitalAnchorInput,
  "id" | "systemId" | "parentId" | "orbitalElements" | "orbit"
> & {
  readonly id: StableId;
  readonly systemId: StableId;
  readonly parentId: StableId | undefined;
  readonly orbitalElements: CompiledKeplerianOrbit | undefined;
};

/**
 * A Gate of Heaven after all identifiers, quantities, and references have been validated.
 */
export type CompiledGate = Omit<
  GateInput,
  "id" | "systemId" | "orbitalAnchorId" | "orbitalElements" | "orbit"
> & {
  readonly id: StableId;
  readonly systemId: StableId;
  readonly orbitalAnchorId: StableId;
  readonly orbitalElements: CompiledKeplerianOrbit | undefined;
};

/**
 * A Gate Connection after its two Gate references have been validated.
 */
export type CompiledGateConnection = Omit<GateConnectionInput, "id" | "gateAId" | "gateBId"> & {
  readonly id: StableId;
  readonly gateAId: StableId;
  readonly gateBId: StableId;
};

/**
 * A Ship Profile after all physical capabilities have been validated.
 */
export type CompiledShipProfile = Omit<ShipProfileInput, "id"> & {
  readonly id: StableId;
};

/**
 * An immutable lookup index for compiled entities.
 *
 * The index intentionally exposes no mutating Map methods. Values are read through `get` and
 * iteration is over the deterministic, identifier-sorted entries captured at compilation time.
 *
 * @typeParam Entity - The indexed entity type.
 */
export type ReadonlyEntityIndex<Entity extends { readonly id: StableId }> = {
  readonly get: (id: StableId) => Entity | undefined;
  readonly has: (id: StableId) => boolean;
  readonly keys: () => IterableIterator<StableId>;
  readonly values: () => IterableIterator<Entity>;
  readonly entries: () => IterableIterator<[StableId, Entity]>;
  readonly size: number;
};

/**
 * Read-only lookup indexes for the entities in a Compiled Scenario.
 */
export type CompiledScenarioIndex = {
  readonly systems: ReadonlyEntityIndex<CompiledSystem>;
  readonly orbitalAnchors: ReadonlyEntityIndex<CompiledOrbitalAnchor>;
  readonly gates: ReadonlyEntityIndex<CompiledGate>;
  readonly gateConnections: ReadonlyEntityIndex<CompiledGateConnection>;
  readonly shipProfiles: ReadonlyEntityIndex<CompiledShipProfile>;
};

/**
 * A validated, immutable realization of the Scenario domain data.
 */
export type CompiledScenario = {
  readonly id: StableId;
  readonly designation: string;
  readonly name: string;
  readonly epoch: ScenarioEpoch;
  readonly systems: readonly CompiledSystem[];
  readonly orbitalAnchors: readonly CompiledOrbitalAnchor[];
  readonly gates: readonly CompiledGate[];
  readonly gateConnections: readonly CompiledGateConnection[];
  readonly shipProfiles: readonly CompiledShipProfile[];
  readonly index: CompiledScenarioIndex;
};

/**
 * Validation issue categories returned by Scenario compilation.
 */
export type ValidationIssueCode =
  | "invalid-structure"
  | "invalid-quantity"
  | "invalid-value"
  | "duplicate-id"
  | "broken-reference"
  | "invalid-gate-pairing"
  | "orbital-cycle"
  | "invalid-orbital-elements";

/**
 * A structured explanation of one invalid Scenario input.
 */
export type ValidationIssue = {
  readonly code: ValidationIssueCode;
  readonly path: string;
  readonly message: string;
  readonly entityType: DomainEntityType | undefined;
  readonly entityId: string | undefined;
  readonly relatedId: string | undefined;
};

/**
 * The successful result of compiling a Scenario.
 */
export type CompileScenarioSuccess = {
  readonly ok: true;
  readonly scenario: CompiledScenario;
  readonly issues: readonly [];
};

/**
 * The unsuccessful result of compiling a Scenario.
 */
export type CompileScenarioFailure = {
  readonly ok: false;
  readonly scenario: undefined;
  readonly issues: readonly ValidationIssue[];
};

/**
 * The discriminated result returned by Scenario compilation.
 */
export type CompileScenarioResult = CompileScenarioSuccess | CompileScenarioFailure;

/**
 * Entity counts in a compiled Scenario.
 */
export type ScenarioEntityCounts = {
  readonly systems: number;
  readonly orbitalAnchors: number;
  readonly gates: number;
  readonly gateConnections: number;
  readonly shipProfiles: number;
};

/**
 * A compact inspection record for one System.
 */
export type SystemInspection = {
  readonly id: StableId;
  readonly designation: string;
  readonly name: string;
  readonly orbitalAnchorIds: readonly StableId[];
  readonly gateIds: readonly StableId[];
};

/**
 * A compact inspection record for one Gate of Heaven.
 */
export type GateInspection = {
  readonly id: StableId;
  readonly designation: string;
  readonly name: string;
  readonly systemId: StableId;
  readonly orbitalAnchorId: StableId;
  readonly pairedGateId: StableId | undefined;
};

/**
 * A compact inspection record for one Gate Connection.
 */
export type GateConnectionInspection = {
  readonly id: StableId;
  readonly designation: string;
  readonly name: string;
  readonly gateAId: StableId;
  readonly gateBId: StableId;
};

/**
 * A compact inspection record for one Ship Profile.
 */
export type ShipProfileInspection = {
  readonly id: StableId;
  readonly designation: string;
  readonly name: string;
  readonly acceleration: MetersPerSecondSquared;
  readonly brakingAcceleration: MetersPerSecondSquared;
  readonly maximumSublightSpeed: MetersPerSecond;
  readonly hasZpzGenerator: boolean;
};

/**
 * A deterministic, human-readable summary of a compiled Scenario.
 */
export type ScenarioInspection = {
  readonly scenarioId: StableId;
  readonly scenarioDesignation: string;
  readonly scenarioName: string;
  readonly epochLabel: string;
  readonly epochCoordinateTime: Seconds;
  readonly counts: ScenarioEntityCounts;
  readonly systems: readonly SystemInspection[];
  readonly gates: readonly GateInspection[];
  readonly gateConnections: readonly GateConnectionInspection[];
  readonly shipProfiles: readonly ShipProfileInspection[];
};

/**
 * The resolved worldline of one Orbital Anchor at a scenario-relative epoch.
 */
export type OrbitalAnchorWorldline = {
  readonly id: StableId;
  readonly systemId: StableId;
  readonly parentId: StableId | undefined;
  readonly coordinateTime: Seconds;
  readonly position: PositionVector;
  readonly velocity: VelocityVector;
};

/**
 * The resolved worldline of one Gate of Heaven at a scenario-relative epoch.
 */
export type GateWorldline = {
  readonly id: StableId;
  readonly systemId: StableId;
  readonly orbitalAnchorId: StableId;
  readonly coordinateTime: Seconds;
  readonly position: PositionVector;
  readonly velocity: VelocityVector;
};

/**
 * All route-relevant Orbital Anchor and Gate states at one scenario-relative epoch.
 */
export type ScenarioWorldlines = {
  readonly coordinateTime: Seconds;
  readonly orbitalAnchors: readonly OrbitalAnchorWorldline[];
  readonly gates: readonly GateWorldline[];
};

/**
 * Structured failure categories returned by worldline evaluation.
 */
export type WorldlineIssueCode =
  | "invalid-coordinate-time"
  | "invalid-orbital-elements"
  | "non-convergent-orbit"
  | "non-finite-worldline";

/**
 * A structured explanation of one worldline evaluation failure.
 */
export type WorldlineIssue = {
  readonly code: WorldlineIssueCode;
  readonly path: string;
  readonly message: string;
  readonly entityType: "orbital-anchor" | "gate";
  readonly entityId: StableId;
};

/**
 * A successful worldline evaluation result.
 */
export type ScenarioWorldlineSuccess = {
  readonly ok: true;
  readonly worldlines: ScenarioWorldlines;
  readonly orbitalAnchors: readonly OrbitalAnchorWorldline[];
  readonly gates: readonly GateWorldline[];
  readonly issues: readonly [];
};

/**
 * An unsuccessful worldline evaluation result.
 */
export type ScenarioWorldlineFailure = {
  readonly ok: false;
  readonly worldlines: undefined;
  readonly orbitalAnchors: readonly [];
  readonly gates: readonly [];
  readonly issues: readonly WorldlineIssue[];
};

/**
 * The discriminated result returned by worldline evaluation.
 */
export type ScenarioWorldlineResult = ScenarioWorldlineSuccess | ScenarioWorldlineFailure;

/**
 * The framework-independent interface for the initial Journey Model module.
 */
export type JourneyModel = {
  readonly compileScenario: (input: unknown) => CompileScenarioResult;
  readonly inspectScenario: (scenario: CompiledScenario) => ScenarioInspection;
  readonly formatScenarioInspection: (inspection: ScenarioInspection) => string;
  readonly evaluateWorldlines: (
    scenario: CompiledScenario,
    coordinateTime: Seconds,
  ) => ScenarioWorldlineResult;
  readonly simulateJourney: {
    (
      scenario: CompiledScenario,
      request: InSystemTransferRequest & { readonly kind: "in-system-transfer" },
    ): InSystemTransferSimulationResult;
    (scenario: CompiledScenario, request: InterstellarCruiseRequest): JourneySimulationResult;
    (scenario: CompiledScenario, request: JourneyRequest): MultiLegJourneySimulationResult;
    (
      scenario: CompiledScenario,
      request: unknown,
    ): JourneySimulationResult | MultiLegJourneySimulationResult | InSystemTransferSimulationResult;
  };
  readonly simulateMultiLegJourney: (
    scenario: CompiledScenario,
    request: unknown,
  ) => MultiLegJourneySimulationResult;
  readonly simulateInSystemTransfer: (
    scenario: CompiledScenario,
    request: unknown,
  ) => InSystemTransferSimulationResult;
};

type RecordValue = Record<string, unknown>;

type ParsedEntity = {
  readonly id: StableId;
  readonly path: string;
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: RecordValue, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function asStableId(value: string): StableId {
  return value as StableId;
}

function addIssue(
  issues: ValidationIssue[],
  code: ValidationIssueCode,
  path: string,
  message: string,
  entityType: DomainEntityType | undefined,
  entityId: string | undefined,
  relatedId: string | undefined,
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

function readRecord(
  record: RecordValue,
  key: string,
  path: string,
  issues: ValidationIssue[],
  entityType: DomainEntityType | undefined,
  entityId: string | undefined,
): RecordValue | undefined {
  const value = record[key];
  if (!isRecord(value)) {
    addIssue(
      issues,
      "invalid-structure",
      path,
      `${path} must be an object.`,
      entityType,
      entityId,
      undefined,
    );
    return undefined;
  }

  return value;
}

function readList(
  record: RecordValue,
  key: string,
  path: string,
  issues: ValidationIssue[],
): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    addIssue(
      issues,
      "invalid-structure",
      path,
      `${path} must be an array.`,
      undefined,
      undefined,
      undefined,
    );
    return [];
  }

  if (value.length === 0) {
    addIssue(
      issues,
      "invalid-structure",
      path,
      `${path} must contain at least one entity.`,
      undefined,
      undefined,
      undefined,
    );
  }

  return value;
}

function readText(
  record: RecordValue,
  key: string,
  path: string,
  issues: ValidationIssue[],
  entityType: DomainEntityType | undefined,
  entityId: string | undefined,
): string | undefined {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    addIssue(
      issues,
      "invalid-structure",
      path,
      `${path} must be a non-empty string.`,
      entityType,
      entityId,
      undefined,
    );
    return undefined;
  }

  return value;
}

function readIdentifier(
  record: RecordValue,
  key: string,
  path: string,
  issues: ValidationIssue[],
  entityType: DomainEntityType | undefined,
  entityId: string | undefined,
): string | undefined {
  const value = record[key];
  if (typeof value !== "string" || !stableIdentifierPattern.test(value)) {
    addIssue(
      issues,
      "invalid-structure",
      path,
      `${path} must be a stable identifier matching ${stableIdentifierPattern.source}.`,
      entityType,
      entityId,
      undefined,
    );
    return undefined;
  }

  return value;
}

function readRequiredReference(
  record: RecordValue,
  key: string,
  path: string,
  issues: ValidationIssue[],
  entityType: DomainEntityType,
  entityId: string | undefined,
): string | undefined {
  return readIdentifier(record, key, path, issues, entityType, entityId);
}

function readNullableReference(
  record: RecordValue,
  key: string,
  path: string,
  issues: ValidationIssue[],
  entityType: DomainEntityType,
  entityId: string | undefined,
): string | undefined {
  if (!hasOwn(record, key)) {
    addIssue(
      issues,
      "invalid-structure",
      path,
      `${path} must be present; use undefined when there is no parent reference.`,
      entityType,
      entityId,
      undefined,
    );
    return undefined;
  }

  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !stableIdentifierPattern.test(value)) {
    addIssue(
      issues,
      "invalid-structure",
      path,
      `${path} must be a stable identifier or undefined.`,
      entityType,
      entityId,
      undefined,
    );
    return undefined;
  }

  return value;
}

function readBoolean(
  record: RecordValue,
  key: string,
  path: string,
  issues: ValidationIssue[],
  entityType: DomainEntityType,
  entityId: string | undefined,
): boolean | undefined {
  const value = record[key];
  if (typeof value !== "boolean") {
    addIssue(
      issues,
      "invalid-structure",
      path,
      `${path} must be a boolean.`,
      entityType,
      entityId,
      undefined,
    );
    return undefined;
  }

  return value;
}

function readQuantity<Unit extends SIUnit>(
  value: unknown,
  expectedUnit: Unit,
  path: string,
  issues: ValidationIssue[],
  entityType: DomainEntityType,
  entityId: string | undefined,
): SIQuantity<Unit> | undefined {
  if (!isRecord(value) || value.unit !== expectedUnit || typeof value.value !== "number") {
    addIssue(
      issues,
      "invalid-quantity",
      path,
      `${path} must be a finite SI quantity with unit ${expectedUnit}.`,
      entityType,
      entityId,
      undefined,
    );
    return undefined;
  }

  if (!Number.isFinite(value.value)) {
    addIssue(
      issues,
      "invalid-quantity",
      path,
      `${path} must contain a finite numeric value.`,
      entityType,
      entityId,
      undefined,
    );
    return undefined;
  }

  return Object.freeze({
    value: value.value as SIValue<Unit>,
    unit: expectedUnit,
  });
}

function readVector<Unit extends SIUnit>(
  value: unknown,
  expectedUnit: Unit,
  path: string,
  issues: ValidationIssue[],
  entityType: DomainEntityType,
  entityId: string | undefined,
): Vector3<Unit> | undefined {
  if (!isRecord(value)) {
    addIssue(
      issues,
      "invalid-quantity",
      path,
      `${path} must be a three-dimensional SI vector.`,
      entityType,
      entityId,
      undefined,
    );
    return undefined;
  }

  const x = readQuantity(value.x, expectedUnit, `${path}.x`, issues, entityType, entityId);
  const y = readQuantity(value.y, expectedUnit, `${path}.y`, issues, entityType, entityId);
  const z = readQuantity(value.z, expectedUnit, `${path}.z`, issues, entityType, entityId);
  if (x === undefined || y === undefined || z === undefined) {
    return undefined;
  }

  return Object.freeze({ x, y, z });
}

function readPositiveQuantity<Unit extends SIUnit>(
  value: unknown,
  expectedUnit: Unit,
  path: string,
  issues: ValidationIssue[],
  entityType: DomainEntityType,
  entityId: string | undefined,
): SIQuantity<Unit> | undefined {
  const quantityValue = readQuantity(value, expectedUnit, path, issues, entityType, entityId);
  if (quantityValue === undefined) {
    return undefined;
  }

  if (quantityValue.value <= 0) {
    addIssue(
      issues,
      "invalid-value",
      path,
      `${path} must be greater than zero.`,
      entityType,
      entityId,
      undefined,
    );
    return undefined;
  }

  return quantityValue;
}

function readMaximumSublightSpeed(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  entityId: string | undefined,
): MetersPerSecond | undefined {
  const quantityValue = readPositiveQuantity(value, "m/s", path, issues, "ship-profile", entityId);
  if (quantityValue === undefined) {
    return undefined;
  }

  if (quantityValue.value >= SPEED_OF_LIGHT.value) {
    addIssue(
      issues,
      "invalid-value",
      path,
      `${path} must be below the speed of light.`,
      "ship-profile",
      entityId,
      undefined,
    );
    return undefined;
  }

  return quantityValue;
}

const GRAVITATIONAL_CONSTANT = 6.6743e-11;

function addOrbitalElementsIssue(
  issues: ValidationIssue[],
  path: string,
  message: string,
  entityType: DomainEntityType,
  entityId: string | undefined,
): void {
  addIssue(issues, "invalid-orbital-elements", path, message, entityType, entityId, undefined);
}

function readOrbitalScalar(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  entityType: DomainEntityType,
  entityId: string | undefined,
): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (
    isRecord(value) &&
    value.unit === "rad" &&
    typeof value.value === "number" &&
    Number.isFinite(value.value)
  ) {
    return value.value;
  }

  addOrbitalElementsIssue(
    issues,
    path,
    `${path} must be a finite angle in radians.`,
    entityType,
    entityId,
  );
  return undefined;
}

function readOrbitalQuantity(
  value: unknown,
  expectedUnit: "m" | "kg" | "m^3/s^2",
  path: string,
  issues: ValidationIssue[],
  entityType: DomainEntityType,
  entityId: string | undefined,
): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (
    isRecord(value) &&
    value.unit === expectedUnit &&
    typeof value.value === "number" &&
    Number.isFinite(value.value)
  ) {
    return value.value;
  }

  addOrbitalElementsIssue(
    issues,
    path,
    `${path} must be a finite SI quantity with unit ${expectedUnit}.`,
    entityType,
    entityId,
  );
  return undefined;
}

function readOrbitalElements(
  record: RecordValue,
  path: string,
  issues: ValidationIssue[],
  entityType: DomainEntityType,
  entityId: string | undefined,
): CompiledKeplerianOrbit | undefined {
  const hasOrbitalElements =
    hasOwn(record, "orbitalElements") && record.orbitalElements !== undefined;
  const hasOrbit = hasOwn(record, "orbit") && record.orbit !== undefined;
  if (!hasOrbitalElements && !hasOrbit) {
    return undefined;
  }
  if (hasOrbitalElements && hasOrbit) {
    addOrbitalElementsIssue(
      issues,
      path,
      `${path} must provide only one of orbitalElements or orbit.`,
      entityType,
      entityId,
    );
  }

  const elementsKey = hasOrbitalElements ? "orbitalElements" : "orbit";
  const elementsPath = `${path}.${elementsKey}`;
  const elements = record[elementsKey];
  if (!isRecord(elements)) {
    addOrbitalElementsIssue(
      issues,
      elementsPath,
      `${elementsPath} must be an object.`,
      entityType,
      entityId,
    );
    return undefined;
  }

  const semiMajorAxis = readOrbitalQuantity(
    elements.semiMajorAxis,
    "m",
    `${elementsPath}.semiMajorAxis`,
    issues,
    entityType,
    entityId,
  );
  const eccentricity = readOrbitalScalar(
    elements.eccentricity,
    `${elementsPath}.eccentricity`,
    issues,
    entityType,
    entityId,
  );
  const inclination = readOrbitalScalar(
    elements.inclination,
    `${elementsPath}.inclination`,
    issues,
    entityType,
    entityId,
  );
  const longitudeOfAscendingNode = readOrbitalScalar(
    elements.longitudeOfAscendingNode,
    `${elementsPath}.longitudeOfAscendingNode`,
    issues,
    entityType,
    entityId,
  );
  const argumentOfPeriapsis = readOrbitalScalar(
    elements.argumentOfPeriapsis,
    `${elementsPath}.argumentOfPeriapsis`,
    issues,
    entityType,
    entityId,
  );
  const meanAnomalyAtEpoch = readOrbitalScalar(
    elements.meanAnomalyAtEpoch,
    `${elementsPath}.meanAnomalyAtEpoch`,
    issues,
    entityType,
    entityId,
  );

  const gravitationalParameterValue =
    elements.gravitationalParameter ?? elements.standardGravitationalParameter ?? elements.mu;
  let gravitationalParameter: number | undefined;
  if (gravitationalParameterValue !== undefined) {
    gravitationalParameter = readOrbitalQuantity(
      gravitationalParameterValue,
      "m^3/s^2",
      `${elementsPath}.gravitationalParameter`,
      issues,
      entityType,
      entityId,
    );
  } else if (elements.centralMass !== undefined) {
    const centralMass = readOrbitalQuantity(
      elements.centralMass,
      "kg",
      `${elementsPath}.centralMass`,
      issues,
      entityType,
      entityId,
    );
    gravitationalParameter =
      centralMass === undefined ? undefined : centralMass * GRAVITATIONAL_CONSTANT;
  } else {
    addOrbitalElementsIssue(
      issues,
      `${elementsPath}.gravitationalParameter`,
      `${elementsPath} must provide gravitationalParameter, standardGravitationalParameter, mu, or centralMass.`,
      entityType,
      entityId,
    );
  }

  if (
    semiMajorAxis === undefined ||
    eccentricity === undefined ||
    inclination === undefined ||
    longitudeOfAscendingNode === undefined ||
    argumentOfPeriapsis === undefined ||
    meanAnomalyAtEpoch === undefined ||
    gravitationalParameter === undefined
  ) {
    return undefined;
  }

  if (semiMajorAxis <= 0 || gravitationalParameter <= 0) {
    addOrbitalElementsIssue(
      issues,
      elementsPath,
      `${elementsPath} requires positive semiMajorAxis and gravitationalParameter.`,
      entityType,
      entityId,
    );
  }
  if (eccentricity < 0 || eccentricity >= 1) {
    addOrbitalElementsIssue(
      issues,
      `${elementsPath}.eccentricity`,
      `${elementsPath}.eccentricity must be in the elliptic range [0, 1).`,
      entityType,
      entityId,
    );
  }

  if (semiMajorAxis <= 0 || gravitationalParameter <= 0 || eccentricity < 0 || eccentricity >= 1) {
    return undefined;
  }

  return Object.freeze({
    semiMajorAxis: meters(semiMajorAxis),
    eccentricity,
    inclination,
    longitudeOfAscendingNode,
    argumentOfPeriapsis,
    meanAnomalyAtEpoch,
    gravitationalParameter: metersCubedPerSecondSquared(gravitationalParameter),
  });
}

function readEpoch(record: RecordValue, issues: ValidationIssue[]): ScenarioEpoch | undefined {
  const epochRecord = readRecord(record, "epoch", "epoch", issues, "scenario", undefined);
  if (epochRecord === undefined) {
    return undefined;
  }

  const label = readText(epochRecord, "label", "epoch.label", issues, "scenario", undefined);
  const coordinateTime = readQuantity(
    epochRecord.coordinateTime,
    "s",
    "epoch.coordinateTime",
    issues,
    "scenario",
    undefined,
  );
  if (label === undefined || coordinateTime === undefined) {
    return undefined;
  }

  return Object.freeze({ label, coordinateTime });
}

function registerId(
  id: string | undefined,
  path: string,
  entityType: DomainEntityType,
  seen: Map<string, ParsedEntity>,
  issues: ValidationIssue[],
): StableId | undefined {
  if (id === undefined) {
    return undefined;
  }

  const existing = seen.get(id);
  if (existing !== undefined) {
    addIssue(
      issues,
      "duplicate-id",
      path,
      `${entityType} identifier ${JSON.stringify(id)} duplicates ${existing.path}.`,
      entityType,
      id,
      undefined,
    );
  } else {
    seen.set(id, { id: asStableId(id), path });
  }

  return asStableId(id);
}

function sortById<T extends { readonly id: StableId }>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values].sort((left, right) => left.id.localeCompare(right.id)));
}

function freezeList<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

function createEntityIndex<Entity extends { readonly id: StableId }>(
  values: readonly Entity[],
): ReadonlyEntityIndex<Entity> {
  const entities = new Map(values.map((entity) => [entity.id, entity]));
  return Object.freeze({
    get: (id: StableId): Entity | undefined => entities.get(id),
    has: (id: StableId): boolean => entities.has(id),
    keys: (): IterableIterator<StableId> => entities.keys(),
    values: (): IterableIterator<Entity> => entities.values(),
    entries: (): IterableIterator<[StableId, Entity]> => entities.entries(),
    size: entities.size,
  });
}

function issueComparator(left: ValidationIssue, right: ValidationIssue): number {
  const pathComparison = left.path.localeCompare(right.path);
  if (pathComparison !== 0) {
    return pathComparison;
  }

  return left.code.localeCompare(right.code);
}

function failure(issues: readonly ValidationIssue[]): CompileScenarioFailure {
  return Object.freeze({
    ok: false as const,
    scenario: undefined,
    issues: Object.freeze([...issues].sort(issueComparator)),
  });
}

function validateAnchorReferences(
  anchors: readonly CompiledOrbitalAnchor[],
  systems: ReadonlyMap<StableId, CompiledSystem>,
  issues: ValidationIssue[],
): void {
  const anchorById = new Map(anchors.map((anchor) => [anchor.id, anchor]));
  const anchorPaths = new Map(
    anchors.map((anchor) => [anchor.id, `orbitalAnchors[${anchors.indexOf(anchor)}]`]),
  );

  for (const anchor of anchors) {
    const anchorPath = anchorPaths.get(anchor.id) ?? "orbitalAnchors";
    const system = systems.get(anchor.systemId);
    if (system === undefined) {
      addIssue(
        issues,
        "broken-reference",
        `${anchorPath}.systemId`,
        `Orbital Anchor ${anchor.id} references missing System ${anchor.systemId}.`,
        "orbital-anchor",
        anchor.id,
        anchor.systemId,
      );
    }

    if (anchor.parentId === undefined) {
      continue;
    }

    const parent = anchorById.get(anchor.parentId);
    if (parent === undefined) {
      addIssue(
        issues,
        "broken-reference",
        `${anchorPath}.parentId`,
        `Orbital Anchor ${anchor.id} references missing parent ${anchor.parentId}.`,
        "orbital-anchor",
        anchor.id,
        anchor.parentId,
      );
      continue;
    }

    if (parent.systemId !== anchor.systemId) {
      addIssue(
        issues,
        "broken-reference",
        `${anchorPath}.parentId`,
        `Orbital Anchor ${anchor.id} and parent ${parent.id} must belong to the same System.`,
        "orbital-anchor",
        anchor.id,
        parent.id,
      );
    }

    if (parent.id === anchor.id) {
      addIssue(
        issues,
        "orbital-cycle",
        `${anchorPath}.parentId`,
        `Orbital Anchor ${anchor.id} cannot be its own parent.`,
        "orbital-anchor",
        anchor.id,
        parent.id,
      );
    }
  }

  const visitState = new Map<StableId, "visiting" | "visited">();
  const visit = (anchor: CompiledOrbitalAnchor): void => {
    if (visitState.get(anchor.id) === "visited") {
      return;
    }

    if (visitState.get(anchor.id) === "visiting") {
      const path = anchorPaths.get(anchor.id) ?? "orbitalAnchors";
      addIssue(
        issues,
        "orbital-cycle",
        `${path}.parentId`,
        `Orbital Anchor hierarchy contains a cycle at ${anchor.id}.`,
        "orbital-anchor",
        anchor.id,
        anchor.parentId,
      );
      return;
    }

    visitState.set(anchor.id, "visiting");
    if (anchor.parentId !== undefined) {
      const parent = anchorById.get(anchor.parentId);
      if (parent !== undefined) {
        visit(parent);
      }
    }
    visitState.set(anchor.id, "visited");
  };

  for (const anchor of anchors) {
    visit(anchor);
  }
}

function validateStationarySystems(
  systems: readonly CompiledSystem[],
  issues: ValidationIssue[],
): void {
  for (const [index, system] of systems.entries()) {
    const speed = Math.hypot(
      system.velocityAtEpoch.x.value,
      system.velocityAtEpoch.y.value,
      system.velocityAtEpoch.z.value,
    );
    if (speed !== 0) {
      addIssue(
        issues,
        "invalid-value",
        `systems[${index}].velocityAtEpoch`,
        `System ${system.id} must be stationary in the Cluster Frame; its epoch velocity must be zero.`,
        "system",
        system.id,
        undefined,
      );
    }
  }
}

function validateGateReferences(
  gates: readonly CompiledGate[],
  systems: ReadonlyMap<StableId, CompiledSystem>,
  anchors: ReadonlyMap<StableId, CompiledOrbitalAnchor>,
  issues: ValidationIssue[],
): void {
  const gatePaths = new Map(gates.map((gate, index) => [gate.id, `gates[${index}]`]));
  for (const gate of gates) {
    const gatePath = gatePaths.get(gate.id) ?? "gates";
    const system = systems.get(gate.systemId);
    if (system === undefined) {
      addIssue(
        issues,
        "broken-reference",
        `${gatePath}.systemId`,
        `Gate ${gate.id} references missing System ${gate.systemId}.`,
        "gate",
        gate.id,
        gate.systemId,
      );
    }

    const anchor = anchors.get(gate.orbitalAnchorId);
    if (anchor === undefined) {
      addIssue(
        issues,
        "broken-reference",
        `${gatePath}.orbitalAnchorId`,
        `Gate ${gate.id} references missing Orbital Anchor ${gate.orbitalAnchorId}.`,
        "gate",
        gate.id,
        gate.orbitalAnchorId,
      );
      continue;
    }

    if (anchor.systemId !== gate.systemId) {
      addIssue(
        issues,
        "broken-reference",
        `${gatePath}.orbitalAnchorId`,
        `Gate ${gate.id} and Orbital Anchor ${anchor.id} must belong to the same System.`,
        "gate",
        gate.id,
        anchor.id,
      );
    }
  }
}

function validateGateConnections(
  gates: readonly CompiledGate[],
  connections: readonly CompiledGateConnection[],
  issues: ValidationIssue[],
): void {
  const gateById = new Map(gates.map((gate) => [gate.id, gate]));
  const gatePaths = new Map(gates.map((gate, index) => [gate.id, `gates[${index}]`]));
  const connectionPaths = new Map(
    connections.map((connection, index) => [connection.id, `gateConnections[${index}]`]),
  );
  const assignedConnectionByGate = new Map<StableId, StableId>();

  for (const connection of connections) {
    const connectionPath = connectionPaths.get(connection.id) ?? "gateConnections";
    const gateA = gateById.get(connection.gateAId);
    const gateB = gateById.get(connection.gateBId);
    if (gateA === undefined) {
      addIssue(
        issues,
        "broken-reference",
        `${connectionPath}.gateAId`,
        `Gate Connection ${connection.id} references missing Gate ${connection.gateAId}.`,
        "gate-connection",
        connection.id,
        connection.gateAId,
      );
    }
    if (gateB === undefined) {
      addIssue(
        issues,
        "broken-reference",
        `${connectionPath}.gateBId`,
        `Gate Connection ${connection.id} references missing Gate ${connection.gateBId}.`,
        "gate-connection",
        connection.id,
        connection.gateBId,
      );
    }

    if (connection.gateAId === connection.gateBId) {
      addIssue(
        issues,
        "invalid-gate-pairing",
        connectionPath,
        `Gate Connection ${connection.id} must pair two distinct Gates of Heaven.`,
        "gate-connection",
        connection.id,
        connection.gateAId,
      );
      continue;
    }

    if (gateA !== undefined && gateB !== undefined && gateA.systemId === gateB.systemId) {
      addIssue(
        issues,
        "invalid-gate-pairing",
        connectionPath,
        `Gate Connection ${connection.id} must pair Gates in different Systems because it is interstellar.`,
        "gate-connection",
        connection.id,
        gateB.id,
      );
      continue;
    }

    if (gateA !== undefined && gateB !== undefined) {
      const existingA = assignedConnectionByGate.get(gateA.id);
      if (existingA !== undefined) {
        addIssue(
          issues,
          "invalid-gate-pairing",
          `${connectionPath}.gateAId`,
          `Gate ${gateA.id} already belongs to Gate Connection ${existingA}.`,
          "gate-connection",
          connection.id,
          gateA.id,
        );
      }
      const existingB = assignedConnectionByGate.get(gateB.id);
      if (existingB !== undefined) {
        addIssue(
          issues,
          "invalid-gate-pairing",
          `${connectionPath}.gateBId`,
          `Gate ${gateB.id} already belongs to Gate Connection ${existingB}.`,
          "gate-connection",
          connection.id,
          gateB.id,
        );
      }

      assignedConnectionByGate.set(gateA.id, connection.id);
      assignedConnectionByGate.set(gateB.id, connection.id);
    }
  }

  for (const gate of gates) {
    if (!assignedConnectionByGate.has(gate.id)) {
      addIssue(
        issues,
        "invalid-gate-pairing",
        `${gatePaths.get(gate.id) ?? "gates"}`,
        `Gate ${gate.id} is not assigned to a Gate Connection.`,
        "gate",
        gate.id,
        undefined,
      );
    }
  }
}

/**
 * Compiles and validates an unknown Scenario value at the Journey Model seam.
 *
 * Validation is structural and reference-aware: malformed quantities, duplicate identifiers,
 * missing references, orbital cycles, and invalid Gate pairings are returned as stable issues.
 * No partially compiled Scenario is returned when any issue is present.
 *
 * @param input - The candidate Scenario value, commonly decoded from JSON.
 * @returns A discriminated success or failure result with a compiled Scenario or issues.
 */
export function compileScenario(input: unknown): CompileScenarioResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    addIssue(
      issues,
      "invalid-structure",
      "$",
      "Scenario must be an object.",
      "scenario",
      undefined,
      undefined,
    );
    return failure(issues);
  }

  const scenarioIdValue = readIdentifier(input, "id", "id", issues, "scenario", undefined);
  const scenarioDesignation = readText(
    input,
    "designation",
    "designation",
    issues,
    "scenario",
    scenarioIdValue,
  );
  const scenarioName = readText(input, "name", "name", issues, "scenario", scenarioIdValue);
  const epoch = readEpoch(input, issues);
  const seenIds = new Map<string, ParsedEntity>();
  const scenarioId = registerId(scenarioIdValue, "id", "scenario", seenIds, issues);

  const systemsInput = readList(input, "systems", "systems", issues);
  const anchorsInput = readList(input, "orbitalAnchors", "orbitalAnchors", issues);
  const gatesInput = readList(input, "gates", "gates", issues);
  const connectionsInput = readList(input, "gateConnections", "gateConnections", issues);
  const shipProfilesInput = readList(input, "shipProfiles", "shipProfiles", issues);

  const systems: CompiledSystem[] = [];
  const anchors: CompiledOrbitalAnchor[] = [];
  const gates: CompiledGate[] = [];
  const connections: CompiledGateConnection[] = [];
  const shipProfiles: CompiledShipProfile[] = [];

  for (const [index, raw] of systemsInput.entries()) {
    const path = `systems[${index}]`;
    if (!isRecord(raw)) {
      addIssue(
        issues,
        "invalid-structure",
        path,
        `${path} must be an object.`,
        "system",
        undefined,
        undefined,
      );
      continue;
    }

    const idValue = readIdentifier(raw, "id", `${path}.id`, issues, "system", undefined);
    const id = registerId(idValue, `${path}.id`, "system", seenIds, issues);
    const designation = readText(
      raw,
      "designation",
      `${path}.designation`,
      issues,
      "system",
      idValue,
    );
    const name = readText(raw, "name", `${path}.name`, issues, "system", idValue);
    const positionAtEpoch = readVector(
      raw.positionAtEpoch,
      "m",
      `${path}.positionAtEpoch`,
      issues,
      "system",
      idValue,
    ) as PositionVector | undefined;
    const velocityAtEpoch = readVector(
      raw.velocityAtEpoch,
      "m/s",
      `${path}.velocityAtEpoch`,
      issues,
      "system",
      idValue,
    ) as VelocityVector | undefined;

    if (
      id !== undefined &&
      designation !== undefined &&
      name !== undefined &&
      positionAtEpoch !== undefined &&
      velocityAtEpoch !== undefined
    ) {
      systems.push(Object.freeze({ id, designation, name, positionAtEpoch, velocityAtEpoch }));
    }
  }

  for (const [index, raw] of anchorsInput.entries()) {
    const path = `orbitalAnchors[${index}]`;
    if (!isRecord(raw)) {
      addIssue(
        issues,
        "invalid-structure",
        path,
        `${path} must be an object.`,
        "orbital-anchor",
        undefined,
        undefined,
      );
      continue;
    }

    const idValue = readIdentifier(raw, "id", `${path}.id`, issues, "orbital-anchor", undefined);
    const id = registerId(idValue, `${path}.id`, "orbital-anchor", seenIds, issues);
    const designation = readText(
      raw,
      "designation",
      `${path}.designation`,
      issues,
      "orbital-anchor",
      idValue,
    );
    const name = readText(raw, "name", `${path}.name`, issues, "orbital-anchor", idValue);
    const kind = raw.kind;
    if (kind !== "star" && kind !== "planet" && kind !== "moon" && kind !== "barycenter") {
      addIssue(
        issues,
        "invalid-value",
        `${path}.kind`,
        `${path}.kind must be star, planet, moon, or barycenter.`,
        "orbital-anchor",
        idValue,
        undefined,
      );
    }
    const systemIdValue = readRequiredReference(
      raw,
      "systemId",
      `${path}.systemId`,
      issues,
      "orbital-anchor",
      idValue,
    );
    const parentIdValue = readNullableReference(
      raw,
      "parentId",
      `${path}.parentId`,
      issues,
      "orbital-anchor",
      idValue,
    );
    const positionAtEpoch = readVector(
      raw.positionAtEpoch,
      "m",
      `${path}.positionAtEpoch`,
      issues,
      "orbital-anchor",
      idValue,
    ) as PositionVector | undefined;
    const velocityAtEpoch = readVector(
      raw.velocityAtEpoch,
      "m/s",
      `${path}.velocityAtEpoch`,
      issues,
      "orbital-anchor",
      idValue,
    ) as VelocityVector | undefined;
    const orbitalElements = readOrbitalElements(raw, path, issues, "orbital-anchor", idValue);

    if (
      id !== undefined &&
      designation !== undefined &&
      name !== undefined &&
      (kind === "star" || kind === "planet" || kind === "moon" || kind === "barycenter") &&
      systemIdValue !== undefined &&
      positionAtEpoch !== undefined &&
      velocityAtEpoch !== undefined
    ) {
      anchors.push(
        Object.freeze({
          id,
          designation,
          name,
          kind,
          systemId: asStableId(systemIdValue),
          parentId: parentIdValue === undefined ? undefined : asStableId(parentIdValue),
          positionAtEpoch,
          velocityAtEpoch,
          orbitalElements,
        }),
      );
    }
  }

  for (const [index, raw] of gatesInput.entries()) {
    const path = `gates[${index}]`;
    if (!isRecord(raw)) {
      addIssue(
        issues,
        "invalid-structure",
        path,
        `${path} must be an object.`,
        "gate",
        undefined,
        undefined,
      );
      continue;
    }

    const idValue = readIdentifier(raw, "id", `${path}.id`, issues, "gate", undefined);
    const id = registerId(idValue, `${path}.id`, "gate", seenIds, issues);
    const designation = readText(
      raw,
      "designation",
      `${path}.designation`,
      issues,
      "gate",
      idValue,
    );
    const name = readText(raw, "name", `${path}.name`, issues, "gate", idValue);
    const systemIdValue = readRequiredReference(
      raw,
      "systemId",
      `${path}.systemId`,
      issues,
      "gate",
      idValue,
    );
    const orbitalAnchorIdValue = readRequiredReference(
      raw,
      "orbitalAnchorId",
      `${path}.orbitalAnchorId`,
      issues,
      "gate",
      idValue,
    );
    const positionAtEpoch = readVector(
      raw.positionAtEpoch,
      "m",
      `${path}.positionAtEpoch`,
      issues,
      "gate",
      idValue,
    ) as PositionVector | undefined;
    const velocityAtEpoch = readVector(
      raw.velocityAtEpoch,
      "m/s",
      `${path}.velocityAtEpoch`,
      issues,
      "gate",
      idValue,
    ) as VelocityVector | undefined;
    const orbitalElements = readOrbitalElements(raw, path, issues, "gate", idValue);

    if (
      id !== undefined &&
      designation !== undefined &&
      name !== undefined &&
      systemIdValue !== undefined &&
      orbitalAnchorIdValue !== undefined &&
      positionAtEpoch !== undefined &&
      velocityAtEpoch !== undefined
    ) {
      gates.push(
        Object.freeze({
          id,
          designation,
          name,
          systemId: asStableId(systemIdValue),
          orbitalAnchorId: asStableId(orbitalAnchorIdValue),
          positionAtEpoch,
          velocityAtEpoch,
          orbitalElements,
        }),
      );
    }
  }

  for (const [index, raw] of connectionsInput.entries()) {
    const path = `gateConnections[${index}]`;
    if (!isRecord(raw)) {
      addIssue(
        issues,
        "invalid-structure",
        path,
        `${path} must be an object.`,
        "gate-connection",
        undefined,
        undefined,
      );
      continue;
    }

    const idValue = readIdentifier(raw, "id", `${path}.id`, issues, "gate-connection", undefined);
    const id = registerId(idValue, `${path}.id`, "gate-connection", seenIds, issues);
    const designation = readText(
      raw,
      "designation",
      `${path}.designation`,
      issues,
      "gate-connection",
      idValue,
    );
    const name = readText(raw, "name", `${path}.name`, issues, "gate-connection", idValue);
    const gateAIdValue = readRequiredReference(
      raw,
      "gateAId",
      `${path}.gateAId`,
      issues,
      "gate-connection",
      idValue,
    );
    const gateBIdValue = readRequiredReference(
      raw,
      "gateBId",
      `${path}.gateBId`,
      issues,
      "gate-connection",
      idValue,
    );

    if (
      id !== undefined &&
      designation !== undefined &&
      name !== undefined &&
      gateAIdValue !== undefined &&
      gateBIdValue !== undefined
    ) {
      connections.push(
        Object.freeze({
          id,
          designation,
          name,
          gateAId: asStableId(gateAIdValue),
          gateBId: asStableId(gateBIdValue),
        }),
      );
    }
  }

  for (const [index, raw] of shipProfilesInput.entries()) {
    const path = `shipProfiles[${index}]`;
    if (!isRecord(raw)) {
      addIssue(
        issues,
        "invalid-structure",
        path,
        `${path} must be an object.`,
        "ship-profile",
        undefined,
        undefined,
      );
      continue;
    }

    const idValue = readIdentifier(raw, "id", `${path}.id`, issues, "ship-profile", undefined);
    const id = registerId(idValue, `${path}.id`, "ship-profile", seenIds, issues);
    const designation = readText(
      raw,
      "designation",
      `${path}.designation`,
      issues,
      "ship-profile",
      idValue,
    );
    const name = readText(raw, "name", `${path}.name`, issues, "ship-profile", idValue);
    const acceleration = readPositiveQuantity(
      raw.acceleration,
      "m/s^2",
      `${path}.acceleration`,
      issues,
      "ship-profile",
      idValue,
    ) as MetersPerSecondSquared | undefined;
    const brakingAcceleration = readPositiveQuantity(
      raw.brakingAcceleration,
      "m/s^2",
      `${path}.brakingAcceleration`,
      issues,
      "ship-profile",
      idValue,
    ) as MetersPerSecondSquared | undefined;
    const maximumSublightSpeed = readMaximumSublightSpeed(
      raw.maximumSublightSpeed,
      `${path}.maximumSublightSpeed`,
      issues,
      idValue,
    );
    const hasZpzGenerator = readBoolean(
      raw,
      "hasZpzGenerator",
      `${path}.hasZpzGenerator`,
      issues,
      "ship-profile",
      idValue,
    );

    if (
      id !== undefined &&
      designation !== undefined &&
      name !== undefined &&
      acceleration !== undefined &&
      brakingAcceleration !== undefined &&
      maximumSublightSpeed !== undefined &&
      hasZpzGenerator !== undefined
    ) {
      shipProfiles.push(
        Object.freeze({
          id,
          designation,
          name,
          acceleration,
          brakingAcceleration,
          maximumSublightSpeed,
          hasZpzGenerator,
        }),
      );
    }
  }

  if (
    scenarioId === undefined ||
    scenarioDesignation === undefined ||
    scenarioName === undefined ||
    epoch === undefined
  ) {
    return failure(issues);
  }

  const sortedSystems = sortById(systems);
  const sortedAnchors = sortById(anchors);
  const sortedGates = sortById(gates);
  const sortedConnections = sortById(connections);
  const sortedShipProfiles = sortById(shipProfiles);
  const systemById = new Map(sortedSystems.map((system) => [system.id, system]));
  const anchorById = new Map(sortedAnchors.map((anchor) => [anchor.id, anchor]));
  const gateById = new Map(sortedGates.map((gate) => [gate.id, gate]));

  validateStationarySystems(sortedSystems, issues);
  validateAnchorReferences(sortedAnchors, systemById, issues);
  validateGateReferences(sortedGates, systemById, anchorById, issues);
  validateGateConnections(sortedGates, sortedConnections, issues);

  if (issues.length > 0) {
    return failure(issues);
  }

  const compiled: CompiledScenario = Object.freeze({
    id: scenarioId,
    designation: scenarioDesignation,
    name: scenarioName,
    epoch,
    systems: freezeList(sortedSystems),
    orbitalAnchors: freezeList(sortedAnchors),
    gates: freezeList(sortedGates),
    gateConnections: freezeList(sortedConnections),
    shipProfiles: freezeList(sortedShipProfiles),
    index: Object.freeze({
      systems: createEntityIndex(sortedSystems),
      orbitalAnchors: createEntityIndex(sortedAnchors),
      gates: createEntityIndex(sortedGates),
      gateConnections: createEntityIndex(sortedConnections),
      shipProfiles: createEntityIndex(sortedShipProfiles),
    }),
  });

  return Object.freeze({ ok: true as const, scenario: compiled, issues: [] as const });
}

/**
 * Creates a deterministic inspection summary from a compiled Scenario.
 *
 * @param scenario - The validated Scenario to inspect.
 * @returns A stable summary containing counts, references, and physical profile values.
 */
export function inspectScenario(scenario: CompiledScenario): ScenarioInspection {
  const pairedGateById = new Map<StableId, StableId>();
  for (const connection of scenario.gateConnections) {
    pairedGateById.set(connection.gateAId, connection.gateBId);
    pairedGateById.set(connection.gateBId, connection.gateAId);
  }

  const systems = scenario.systems.map((system) =>
    Object.freeze({
      id: system.id,
      designation: system.designation,
      name: system.name,
      orbitalAnchorIds: freezeList(
        scenario.orbitalAnchors
          .filter((anchor) => anchor.systemId === system.id)
          .map((anchor) => anchor.id),
      ),
      gateIds: freezeList(
        scenario.gates.filter((gate) => gate.systemId === system.id).map((gate) => gate.id),
      ),
    }),
  );

  const gates = scenario.gates.map((gate) =>
    Object.freeze({
      id: gate.id,
      designation: gate.designation,
      name: gate.name,
      systemId: gate.systemId,
      orbitalAnchorId: gate.orbitalAnchorId,
      pairedGateId: pairedGateById.get(gate.id),
    }),
  );

  const gateConnections = scenario.gateConnections.map((connection) =>
    Object.freeze({
      id: connection.id,
      designation: connection.designation,
      name: connection.name,
      gateAId: connection.gateAId,
      gateBId: connection.gateBId,
    }),
  );

  const shipProfiles = scenario.shipProfiles.map((profile) =>
    Object.freeze({
      id: profile.id,
      designation: profile.designation,
      name: profile.name,
      acceleration: profile.acceleration,
      brakingAcceleration: profile.brakingAcceleration,
      maximumSublightSpeed: profile.maximumSublightSpeed,
      hasZpzGenerator: profile.hasZpzGenerator,
    }),
  );

  return Object.freeze({
    scenarioId: scenario.id,
    scenarioDesignation: scenario.designation,
    scenarioName: scenario.name,
    epochLabel: scenario.epoch.label,
    epochCoordinateTime: scenario.epoch.coordinateTime,
    counts: Object.freeze({
      systems: scenario.systems.length,
      orbitalAnchors: scenario.orbitalAnchors.length,
      gates: scenario.gates.length,
      gateConnections: scenario.gateConnections.length,
      shipProfiles: scenario.shipProfiles.length,
    }),
    systems: freezeList(systems),
    gates: freezeList(gates),
    gateConnections: freezeList(gateConnections),
    shipProfiles: freezeList(shipProfiles),
  });
}

/**
 * Resolves all route-relevant Orbital Anchor and Gate worldlines at a scenario-relative epoch.
 *
 * @param scenario - The immutable compiled Scenario to evaluate.
 * @param coordinateTime - The absolute Cluster Coordinate Time at which states are requested.
 * @returns Immutable worldline states or structured numerical diagnostics.
 */
export function evaluateWorldlines(
  scenario: CompiledScenario,
  coordinateTime: Seconds,
): ScenarioWorldlineResult {
  return resolveScenarioWorldlines(scenario, coordinateTime);
}

/**
 * Alias for evaluating a Scenario's route-relevant worldlines at an arbitrary epoch.
 *
 * @param scenario - The immutable compiled Scenario to evaluate.
 * @param coordinateTime - The absolute Cluster Coordinate Time at which states are requested.
 * @returns Immutable worldline states or structured numerical diagnostics.
 */
export const inspectScenarioAtTime = evaluateWorldlines;

function quantityText(quantityValue: SIQuantity<SIUnit>): string {
  return `${quantityValue.value} ${quantityValue.unit}`;
}

/**
 * Formats an inspection summary as deterministic plain text for logs and demonstrations.
 *
 * @param inspection - The inspection summary to format.
 * @returns A stable multi-line textual representation.
 */
export function formatScenarioInspection(inspection: ScenarioInspection): string {
  const lines: string[] = [
    `Scenario ${inspection.scenarioId} (${inspection.scenarioDesignation}): ${inspection.scenarioName}`,
    `Epoch: ${inspection.epochLabel} at ${quantityText(inspection.epochCoordinateTime)}`,
    `Counts: ${inspection.counts.systems} Systems, ${inspection.counts.orbitalAnchors} Orbital Anchors, ${inspection.counts.gates} Gates of Heaven, ${inspection.counts.gateConnections} Gate Connections, ${inspection.counts.shipProfiles} Ship Profiles`,
    "Systems:",
  ];

  for (const system of inspection.systems) {
    lines.push(
      `- ${system.id} (${system.designation}) ${system.name}; anchors=${system.orbitalAnchorIds.join(", ")}; gates=${system.gateIds.join(", ")}`,
    );
  }

  lines.push("Gates of Heaven:");
  for (const gate of inspection.gates) {
    lines.push(
      `- ${gate.id} (${gate.designation}) ${gate.name}; system=${gate.systemId}; anchor=${gate.orbitalAnchorId}; paired=${gate.pairedGateId ?? "undefined"}`,
    );
  }

  lines.push("Gate Connections:");
  for (const connection of inspection.gateConnections) {
    lines.push(
      `- ${connection.id} (${connection.designation}) ${connection.name}; ${connection.gateAId} <-> ${connection.gateBId}`,
    );
  }

  lines.push("Ship Profiles:");
  for (const profile of inspection.shipProfiles) {
    lines.push(
      `- ${profile.id} (${profile.designation}) ${profile.name}; acceleration=${quantityText(profile.acceleration)}; braking=${quantityText(profile.brakingAcceleration)}; maximumSublightSpeed=${quantityText(profile.maximumSublightSpeed)}; zpzGenerator=${profile.hasZpzGenerator ? "yes" : "no"}`,
    );
  }

  return lines.join("\n");
}

/**
 * Creates the framework-independent Journey Model interface.
 *
 * The current implementation is stateless: all Scenario data is supplied to each operation and
 * all results are returned as immutable values.
 *
 * @returns A Journey Model adapter exposing compilation, inspection, worldline evaluation, and cruise simulation operations.
 */
export function createJourneyModel(): JourneyModel {
  return Object.freeze({
    compileScenario,
    inspectScenario,
    formatScenarioInspection,
    evaluateWorldlines,
    simulateJourney,
    simulateMultiLegJourney,
    simulateInSystemTransfer,
  });
}
