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
import {
  createDisplayPrecision,
  createPropertyMetadata,
  createProvenance,
  createScenarioOverrideLayer,
  provisionalProvenance,
  type CanonicalClaim,
  type CanonicalIdentity,
  type CanonicalIdentityInput,
  type ConservativeBounds,
  type DisplayPrecision,
  type PropertyMetadata,
  type PropertyMetadataInput,
  type Provenance,
  type ProvenanceInput,
  type ScenarioOverrideChange,
  type ScenarioOverrideLayer,
  type ScenarioOverrideLayerInput,
} from "./provenance";

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
 * Provenance metadata accepted on an entity while retaining the legacy raw-property input shape.
 */
export type EntityProvenanceInput = {
  readonly canonicalIdentity?: CanonicalIdentityInput | undefined;
  readonly provenance?: Provenance | ProvenanceInput | undefined;
  readonly properties?: Readonly<Record<string, PropertyMetadataInput<unknown>>> | undefined;
  readonly propertyProvenance?:
    | Readonly<Record<string, PropertyMetadataInput<unknown>>>
    | undefined;
};

/**
 * Complete provenance metadata stored on every compiled entity.
 */
export type CompiledEntityProvenance = {
  readonly canonicalIdentity: CanonicalIdentity;
  readonly provenance: Provenance;
  readonly properties: Readonly<Record<string, PropertyMetadata<unknown>>>;
  readonly propertyProvenance: Readonly<Record<string, PropertyMetadata<unknown>>>;
};

/**
 * A Canonical Claim attached to a Scenario-level journey or catalog fact.
 */
export type ScenarioCanonicalClaimInput = {
  readonly id: string;
  readonly subject: string;
  readonly property: string;
  readonly claim: CanonicalClaim<unknown> | Record<string, unknown>;
};

/**
 * A normalized Scenario-level Canonical Claim record.
 */
export type ScenarioCanonicalClaim = {
  readonly id: StableId;
  readonly subject: string;
  readonly property: string;
  readonly claim: CanonicalClaim<unknown>;
};

/**
 * A compact uncertainty summary derived from ranged Scenario properties.
 */
export type ScenarioUncertainty = {
  readonly hasUncertainty: boolean;
  readonly relativeFactor: number;
  readonly absoluteSeconds: number;
  readonly propertyPaths: readonly string[];
  readonly displayPrecision: DisplayPrecision;
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
} & EntityProvenanceInput;

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
} & EntityProvenanceInput;

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
} & EntityProvenanceInput;

/**
 * A bidirectional pairing between exactly two Gates of Heaven.
 */
export type GateConnectionInput = {
  readonly id: string;
  readonly designation: string;
  readonly name: string;
  readonly gateAId: string;
  readonly gateBId: string;
} & EntityProvenanceInput;

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
} & EntityProvenanceInput;

/**
 * A complete Scenario input for the headless Journey Model seam.
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
  readonly canonicalClaims?: readonly ScenarioCanonicalClaimInput[] | undefined;
  readonly overrides?: readonly ScenarioOverrideLayerInput[] | undefined;
} & EntityProvenanceInput;

/**
 * A System after all identifiers, quantities, references, and provenance have been validated.
 */
export type CompiledSystem = Omit<SystemInput, "id" | keyof EntityProvenanceInput> & {
  readonly id: StableId;
} & CompiledEntityProvenance;

/**
 * An Orbital Anchor after all identifiers, quantities, references, and provenance have been validated.
 */
export type CompiledOrbitalAnchor = Omit<
  OrbitalAnchorInput,
  "id" | "systemId" | "parentId" | "orbitalElements" | "orbit" | keyof EntityProvenanceInput
> & {
  readonly id: StableId;
  readonly systemId: StableId;
  readonly parentId: StableId | undefined;
  readonly orbitalElements: CompiledKeplerianOrbit | undefined;
} & CompiledEntityProvenance;

/**
 * A Gate of Heaven after all identifiers, quantities, references, and provenance have been validated.
 */
export type CompiledGate = Omit<
  GateInput,
  "id" | "systemId" | "orbitalAnchorId" | "orbitalElements" | "orbit" | keyof EntityProvenanceInput
> & {
  readonly id: StableId;
  readonly systemId: StableId;
  readonly orbitalAnchorId: StableId;
  readonly orbitalElements: CompiledKeplerianOrbit | undefined;
} & CompiledEntityProvenance;

/**
 * A Gate Connection after its two Gate references and provenance have been validated.
 */
export type CompiledGateConnection = Omit<
  GateConnectionInput,
  "id" | "gateAId" | "gateBId" | keyof EntityProvenanceInput
> & {
  readonly id: StableId;
  readonly gateAId: StableId;
  readonly gateBId: StableId;
} & CompiledEntityProvenance;

/**
 * A Ship Profile after its physical capabilities and provenance have been validated.
 */
export type CompiledShipProfile = Omit<ShipProfileInput, "id" | keyof EntityProvenanceInput> & {
  readonly id: StableId;
} & CompiledEntityProvenance;

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
  readonly canonicalIdentity: CanonicalIdentity;
  readonly provenance: Provenance;
  readonly properties: Readonly<Record<string, PropertyMetadata<unknown>>>;
  readonly propertyProvenance: Readonly<Record<string, PropertyMetadata<unknown>>>;
  readonly canonicalClaims: readonly ScenarioCanonicalClaim[];
  readonly overrideLayers: readonly ScenarioOverrideLayer[];
  readonly overrides: readonly ScenarioOverrideLayer[];
  readonly uncertainty: ScenarioUncertainty;
  readonly overrideBase: CompiledScenario | undefined;
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
  | "invalid-orbital-elements"
  | "invalid-provenance"
  | "invalid-citation"
  | "invalid-claim"
  | "invalid-precision"
  | "invalid-override";

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
  readonly applyScenarioOverrides: (
    scenario: CompiledScenario,
    layers: readonly ScenarioOverrideLayerInput[],
  ) => CompiledScenario;
  readonly compareScenarioOverrides: (
    before: CompiledScenario,
    after: CompiledScenario,
  ) => readonly import("./provenance").OverrideChangeComparison[];
  readonly revertScenarioOverride: (
    scenario: CompiledScenario,
    layerId: string,
  ) => CompiledScenario;
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

const DEFAULT_PROVENANCE = provisionalProvenance("No source provenance was supplied.");
const CORE_SYSTEM_PROPERTIES = [
  "designation",
  "name",
  "positionAtEpoch",
  "velocityAtEpoch",
] as const;
const CORE_ANCHOR_PROPERTIES = [
  "designation",
  "name",
  "kind",
  "systemId",
  "parentId",
  "positionAtEpoch",
  "velocityAtEpoch",
  "orbitalElements",
] as const;
const CORE_GATE_PROPERTIES = [
  "designation",
  "name",
  "systemId",
  "orbitalAnchorId",
  "positionAtEpoch",
  "velocityAtEpoch",
  "orbitalElements",
] as const;
const CORE_CONNECTION_PROPERTIES = ["designation", "name", "gateAId", "gateBId"] as const;
const CORE_SHIP_PROPERTIES = [
  "designation",
  "name",
  "acceleration",
  "brakingAcceleration",
  "maximumSublightSpeed",
  "hasZpzGenerator",
] as const;
const SUPPORTED_OVERRIDE_PROPERTIES: Readonly<Record<DomainEntityType, readonly string[]>> =
  Object.freeze({
    scenario: ["designation", "name", "epoch"],
    system: CORE_SYSTEM_PROPERTIES,
    "orbital-anchor": CORE_ANCHOR_PROPERTIES,
    gate: CORE_GATE_PROPERTIES,
    "gate-connection": CORE_CONNECTION_PROPERTIES,
    "ship-profile": CORE_SHIP_PROPERTIES,
  });

function metadataRecord(
  record: RecordValue,
  key: "properties" | "propertyProvenance",
): RecordValue {
  const value = record[key];
  return isRecord(value) ? value : {};
}

function rawPropertyMetadata(record: RecordValue, property: string): RecordValue | undefined {
  const properties = metadataRecord(record, "properties");
  const propertyProvenance = metadataRecord(record, "propertyProvenance");
  const value = properties[property] ?? propertyProvenance[property];
  return isRecord(value) ? value : undefined;
}

function rawPropertyValue(record: RecordValue, property: string): unknown {
  const metadata = rawPropertyMetadata(record, property);
  if (metadata !== undefined) {
    const rawClaim = metadata.claim ?? metadata.canonicalClaim;
    if (isRecord(rawClaim)) {
      if (rawClaim.kind === "exact" && hasOwn(rawClaim, "value")) {
        return rawClaim.value;
      }
      if (rawClaim.kind === "range") {
        return hasOwn(rawClaim, "nominal") ? rawClaim.nominal : rawClaim.lower;
      }
    }
    if (hasOwn(metadata, "nominal")) {
      return metadata.nominal;
    }
    if (hasOwn(metadata, "value")) {
      return metadata.value;
    }
  }
  return record[property];
}

function provenanceInputForProperty(
  metadata: RecordValue | undefined,
): Provenance | ProvenanceInput | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  if (metadata.provenance !== undefined) {
    return metadata.provenance as Provenance | ProvenanceInput;
  }
  if (
    metadata.kind === "novel" ||
    metadata.kind === "supplementary-official" ||
    metadata.kind === "provisional" ||
    metadata.kind === "generated" ||
    metadata.kind === "override"
  ) {
    return metadata as ProvenanceInput;
  }
  return undefined;
}

function metadataInputForProperty(
  metadata: RecordValue | undefined,
): PropertyMetadataInput<unknown> | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  if (provenanceInputForProperty(metadata) !== undefined && !hasOwn(metadata, "provenance")) {
    return { provenance: provenanceInputForProperty(metadata) };
  }
  return metadata as PropertyMetadataInput<unknown>;
}

function metadataIssueCode(message: string): ValidationIssueCode {
  if (message.includes("citation")) {
    return "invalid-citation";
  }
  if (message.includes("Claim") || message.includes("claim")) {
    return "invalid-claim";
  }
  if (message.includes("precision")) {
    return "invalid-precision";
  }
  return "invalid-provenance";
}

function normalizeEntityProvenance(
  record: RecordValue,
  entityType: DomainEntityType,
  entityId: StableId,
  designation: string,
  name: string,
  propertyNames: readonly string[],
  path: string,
  issues: ValidationIssue[],
): CompiledEntityProvenance {
  let entityProvenance = DEFAULT_PROVENANCE;
  if (record.provenance !== undefined) {
    try {
      entityProvenance = createProvenance(record.provenance as ProvenanceInput);
    } catch (error) {
      addIssue(
        issues,
        "invalid-provenance",
        `${path}.provenance`,
        error instanceof Error ? error.message : `${path}.provenance is invalid.`,
        entityType,
        entityId,
        undefined,
      );
    }
  }

  const identityInput = record.canonicalIdentity;
  let canonicalIdentity: CanonicalIdentity;
  try {
    if (identityInput === undefined) {
      canonicalIdentity = Object.freeze({
        id: entityId,
        designation,
        name,
        provenance: entityProvenance,
      });
    } else if (typeof identityInput === "string") {
      if (!stableIdentifierPattern.test(identityInput)) {
        throw new RangeError("Canonical identity id must be a stable identifier.");
      }
      canonicalIdentity = Object.freeze({
        id: identityInput,
        designation,
        name,
        provenance: entityProvenance,
      });
    } else if (isRecord(identityInput)) {
      const identityId = identityInput.id === undefined ? entityId : identityInput.id;
      if (typeof identityId !== "string" || !stableIdentifierPattern.test(identityId)) {
        throw new RangeError("Canonical identity id must be a stable identifier.");
      }
      const identityProvenance =
        identityInput.provenance === undefined
          ? entityProvenance
          : createProvenance(identityInput.provenance as ProvenanceInput);
      canonicalIdentity = Object.freeze({
        id: identityId,
        designation:
          identityInput.designation === undefined
            ? designation
            : readIdentityText(identityInput.designation, "canonicalIdentity.designation"),
        name:
          identityInput.name === undefined
            ? name
            : readIdentityText(identityInput.name, "canonicalIdentity.name"),
        provenance: identityProvenance,
      });
    } else {
      throw new RangeError("canonicalIdentity must be an object or stable identifier.");
    }
  } catch (error) {
    addIssue(
      issues,
      "invalid-provenance",
      `${path}.canonicalIdentity`,
      error instanceof Error ? error.message : `${path}.canonicalIdentity is invalid.`,
      entityType,
      entityId,
      undefined,
    );
    canonicalIdentity = Object.freeze({
      id: entityId,
      designation,
      name,
      provenance: entityProvenance,
    });
  }

  const propertyNamesWithMetadata = new Set(propertyNames);
  for (const key of ["properties", "propertyProvenance"] as const) {
    for (const property of Object.keys(metadataRecord(record, key))) {
      propertyNamesWithMetadata.add(property);
    }
  }
  const properties: Record<string, PropertyMetadata<unknown>> = {};
  for (const property of propertyNamesWithMetadata) {
    const propertyMetadata = rawPropertyMetadata(record, property);
    try {
      properties[property] = createPropertyMetadata(property, rawPropertyValue(record, property), {
        ...metadataInputForProperty(propertyMetadata),
        provenance:
          provenanceInputForProperty(propertyMetadata) ??
          (propertyMetadata === undefined ? entityProvenance : undefined),
      });
    } catch (error) {
      addIssue(
        issues,
        metadataIssueCode(error instanceof Error ? error.message : ""),
        `${path}.properties.${property}`,
        error instanceof Error ? error.message : `${path}.properties.${property} is invalid.`,
        entityType,
        entityId,
        undefined,
      );
      properties[property] = createPropertyMetadata(property, rawPropertyValue(record, property), {
        provenance: entityProvenance,
      });
    }
  }
  const immutableProperties = Object.freeze(properties);
  return Object.freeze({
    canonicalIdentity,
    provenance: entityProvenance,
    properties: immutableProperties,
    propertyProvenance: immutableProperties,
  });
}

function readIdentityText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RangeError(`${path} must be a non-empty string.`);
  }
  return value;
}

function compileScenarioOverrides(
  record: RecordValue,
  issues: ValidationIssue[],
): readonly ScenarioOverrideLayer[] {
  const rawOverrides = record.overrides;
  if (rawOverrides === undefined) {
    return [];
  }
  if (!Array.isArray(rawOverrides)) {
    addIssue(
      issues,
      "invalid-override",
      "overrides",
      "overrides must be an array.",
      "scenario",
      undefined,
      undefined,
    );
    return [];
  }
  const layers: ScenarioOverrideLayer[] = [];
  for (const [index, rawLayer] of rawOverrides.entries()) {
    try {
      layers.push(createScenarioOverrideLayer(rawLayer as ScenarioOverrideLayerInput));
    } catch (error) {
      addIssue(
        issues,
        "invalid-override",
        `overrides[${index}]`,
        error instanceof Error ? error.message : `overrides[${index}] is invalid.`,
        "scenario",
        undefined,
        undefined,
      );
    }
  }
  return Object.freeze(layers);
}

function compileScenarioClaims(
  record: RecordValue,
  issues: ValidationIssue[],
): readonly ScenarioCanonicalClaim[] {
  const rawClaims = record.canonicalClaims;
  if (rawClaims === undefined) {
    return [];
  }
  if (!Array.isArray(rawClaims)) {
    addIssue(
      issues,
      "invalid-structure",
      "canonicalClaims",
      "canonicalClaims must be an array.",
      "scenario",
      undefined,
      undefined,
    );
    return [];
  }
  const claims: ScenarioCanonicalClaim[] = [];
  for (const [index, rawClaim] of rawClaims.entries()) {
    const path = `canonicalClaims[${index}]`;
    if (!isRecord(rawClaim)) {
      addIssue(
        issues,
        "invalid-claim",
        path,
        `${path} must be an object.`,
        "scenario",
        undefined,
        undefined,
      );
      continue;
    }
    const id = rawClaim.id;
    const subject = rawClaim.subject;
    const property = rawClaim.property;
    if (
      typeof id !== "string" ||
      !stableIdentifierPattern.test(id) ||
      typeof subject !== "string" ||
      subject.trim().length === 0 ||
      typeof property !== "string" ||
      property.trim().length === 0
    ) {
      addIssue(
        issues,
        "invalid-claim",
        path,
        `${path} requires a stable id, subject, and property.`,
        "scenario",
        id as string | undefined,
        undefined,
      );
      continue;
    }
    try {
      const metadata = createPropertyMetadata(property, undefined, {
        claim: rawClaim.claim as Record<string, unknown>,
      });
      if (metadata.claim === undefined) {
        throw new RangeError(
          `${path}.claim must be an exact, range, or qualitative Canonical Claim.`,
        );
      }
      claims.push(
        Object.freeze({
          id: asStableId(id),
          subject,
          property,
          claim: metadata.claim,
        }),
      );
    } catch (error) {
      addIssue(
        issues,
        metadataIssueCode(error instanceof Error ? error.message : "claim"),
        `${path}.claim`,
        error instanceof Error ? error.message : `${path}.claim is invalid.`,
        "scenario",
        asStableId(id),
        undefined,
      );
    }
  }
  return Object.freeze(claims);
}

function numericComponents(value: unknown): readonly number[] {
  if (typeof value === "number" && Number.isFinite(value)) {
    return [value];
  }
  if (isRecord(value)) {
    if (typeof value.value === "number" && Number.isFinite(value.value)) {
      return [value.value];
    }
    return Object.values(value).flatMap((child) => numericComponents(child));
  }
  if (Array.isArray(value)) {
    return value.flatMap((child) => numericComponents(child));
  }
  return [];
}

function rangeRelativeWidth(
  lower: unknown,
  upper: unknown,
  nominal: unknown,
): { readonly relative: number; readonly absolute: number } {
  const lowerValues = numericComponents(lower);
  const upperValues = numericComponents(upper);
  const nominalValues = numericComponents(nominal);
  const count = Math.min(lowerValues.length, upperValues.length, nominalValues.length);
  if (count === 0) {
    return { relative: 0, absolute: 0 };
  }
  let squaredWidth = 0;
  let squaredMagnitude = 0;
  for (let index = 0; index < count; index += 1) {
    const lowerValue = lowerValues[index] ?? 0;
    const upperValue = upperValues[index] ?? 0;
    const nominalValue = nominalValues[index] ?? 0;
    squaredWidth += ((upperValue - lowerValue) / 2) ** 2;
    squaredMagnitude += nominalValue ** 2;
  }
  const absolute = Math.sqrt(squaredWidth);
  const magnitude = Math.sqrt(squaredMagnitude);
  return {
    relative: absolute / Math.max(1, magnitude),
    absolute,
  };
}

function explicitSecondsRangeWidth(
  lower: unknown,
  upper: unknown,
  nominal: unknown,
): number | undefined {
  const lowerValue = explicitSecondsValue(lower);
  const upperValue = explicitSecondsValue(upper);
  const nominalValue = explicitSecondsValue(nominal);
  if (lowerValue === undefined || upperValue === undefined || nominalValue === undefined) {
    return undefined;
  }
  return Math.abs(upperValue - lowerValue) / 2;
}

function explicitSecondsValue(value: unknown): number | undefined {
  if (!isRecord(value) || value.unit !== "s" || typeof value.value !== "number") {
    return undefined;
  }
  return Number.isFinite(value.value) ? value.value : undefined;
}

function scenarioUncertainty(
  scenarioProperties: Readonly<Record<string, PropertyMetadata<unknown>>>,
  entities: readonly CompiledEntityProvenance[],
  canonicalClaims: readonly ScenarioCanonicalClaim[],
): ScenarioUncertainty {
  let relativeFactor = 0;
  let absoluteSeconds = 0;
  let hasUncertainty = false;
  const propertyPaths: string[] = [];
  let bestPrecision: DisplayPrecision | undefined;
  const visit = (
    path: string,
    properties: Readonly<Record<string, PropertyMetadata<unknown>>>,
  ): void => {
    for (const [property, metadata] of Object.entries(properties)) {
      const precision = metadata.displayPrecision;
      if (
        bestPrecision === undefined ||
        precision.significantDigits < bestPrecision.significantDigits
      ) {
        bestPrecision = precision;
      }
      const bounds = metadata.bounds;
      if (bounds === undefined) {
        continue;
      }
      const width = rangeRelativeWidth(bounds.lower, bounds.upper, bounds.nominal);
      if (width.absolute <= 0) {
        continue;
      }
      hasUncertainty = true;
      const timeWidth = explicitSecondsRangeWidth(bounds.lower, bounds.upper, bounds.nominal);
      if (timeWidth !== undefined && timeWidth > 0) {
        relativeFactor += width.relative;
        absoluteSeconds += timeWidth;
      }
      propertyPaths.push(`${path}.${property}`);
    }
  };
  visit("scenario", scenarioProperties);
  for (const entity of entities) {
    visit(entity.canonicalIdentity.id, entity.properties);
  }
  for (const claim of canonicalClaims) {
    if (claim.claim.kind !== "range") {
      continue;
    }
    const width = rangeRelativeWidth(claim.claim.lower, claim.claim.upper, claim.claim.nominal);
    if (width.absolute <= 0) {
      continue;
    }
    hasUncertainty = true;
    const timeWidth = explicitSecondsRangeWidth(
      claim.claim.lower,
      claim.claim.upper,
      claim.claim.nominal,
    );
    if (timeWidth !== undefined && timeWidth > 0) {
      relativeFactor += width.relative;
      absoluteSeconds += timeWidth;
    }
    propertyPaths.push(`canonicalClaims.${claim.id}`);
    if (
      bestPrecision === undefined ||
      claim.claim.precision.significantDigits < bestPrecision.significantDigits
    ) {
      bestPrecision = claim.claim.precision;
    }
  }
  return Object.freeze({
    hasUncertainty,
    relativeFactor: Math.max(0, relativeFactor),
    absoluteSeconds: Number.isFinite(absoluteSeconds) ? absoluteSeconds : 0,
    propertyPaths: Object.freeze(propertyPaths.sort()),
    displayPrecision: bestPrecision ?? createDisplayPrecision({}, "default"),
  });
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
    { ...input, designation: rawPropertyValue(input, "designation") },
    "designation",
    "designation",
    issues,
    "scenario",
    scenarioIdValue,
  );
  const scenarioName = readText(
    { ...input, name: rawPropertyValue(input, "name") },
    "name",
    "name",
    issues,
    "scenario",
    scenarioIdValue,
  );
  const epoch = readEpoch({ ...input, epoch: rawPropertyValue(input, "epoch") }, issues);
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
      { ...raw, designation: rawPropertyValue(raw, "designation") },
      "designation",
      `${path}.designation`,
      issues,
      "system",
      idValue,
    );
    const name = readText(
      { ...raw, name: rawPropertyValue(raw, "name") },
      "name",
      `${path}.name`,
      issues,
      "system",
      idValue,
    );
    const positionAtEpoch = readVector(
      rawPropertyValue(raw, "positionAtEpoch"),
      "m",
      `${path}.positionAtEpoch`,
      issues,
      "system",
      idValue,
    ) as PositionVector | undefined;
    const velocityAtEpoch = readVector(
      rawPropertyValue(raw, "velocityAtEpoch"),
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
      const metadata = normalizeEntityProvenance(
        raw,
        "system",
        id,
        designation,
        name,
        CORE_SYSTEM_PROPERTIES,
        path,
        issues,
      );
      systems.push(
        Object.freeze({ id, designation, name, positionAtEpoch, velocityAtEpoch, ...metadata }),
      );
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
      { ...raw, designation: rawPropertyValue(raw, "designation") },
      "designation",
      `${path}.designation`,
      issues,
      "orbital-anchor",
      idValue,
    );
    const name = readText(
      { ...raw, name: rawPropertyValue(raw, "name") },
      "name",
      `${path}.name`,
      issues,
      "orbital-anchor",
      idValue,
    );
    const kind = rawPropertyValue(raw, "kind");
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
    const referenceRecord = {
      ...raw,
      systemId: rawPropertyValue(raw, "systemId"),
      parentId: rawPropertyValue(raw, "parentId"),
    };
    const systemIdValue = readRequiredReference(
      referenceRecord,
      "systemId",
      `${path}.systemId`,
      issues,
      "orbital-anchor",
      idValue,
    );
    const parentIdValue = readNullableReference(
      referenceRecord,
      "parentId",
      `${path}.parentId`,
      issues,
      "orbital-anchor",
      idValue,
    );
    const positionAtEpoch = readVector(
      rawPropertyValue(raw, "positionAtEpoch"),
      "m",
      `${path}.positionAtEpoch`,
      issues,
      "orbital-anchor",
      idValue,
    ) as PositionVector | undefined;
    const velocityAtEpoch = readVector(
      rawPropertyValue(raw, "velocityAtEpoch"),
      "m/s",
      `${path}.velocityAtEpoch`,
      issues,
      "orbital-anchor",
      idValue,
    ) as VelocityVector | undefined;
    const orbitalElements = readOrbitalElements(
      {
        ...raw,
        orbitalElements: rawPropertyValue(raw, "orbitalElements"),
        orbit: rawPropertyValue(raw, "orbit"),
      },
      path,
      issues,
      "orbital-anchor",
      idValue,
    );
    if (
      id !== undefined &&
      designation !== undefined &&
      name !== undefined &&
      (kind === "star" || kind === "planet" || kind === "moon" || kind === "barycenter") &&
      systemIdValue !== undefined &&
      positionAtEpoch !== undefined &&
      velocityAtEpoch !== undefined
    ) {
      const metadata = normalizeEntityProvenance(
        raw,
        "orbital-anchor",
        id,
        designation,
        name,
        CORE_ANCHOR_PROPERTIES,
        path,
        issues,
      );
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
          ...metadata,
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
      { ...raw, designation: rawPropertyValue(raw, "designation") },
      "designation",
      `${path}.designation`,
      issues,
      "gate",
      idValue,
    );
    const name = readText(
      { ...raw, name: rawPropertyValue(raw, "name") },
      "name",
      `${path}.name`,
      issues,
      "gate",
      idValue,
    );
    const referenceRecord = {
      ...raw,
      systemId: rawPropertyValue(raw, "systemId"),
      orbitalAnchorId: rawPropertyValue(raw, "orbitalAnchorId"),
    };
    const systemIdValue = readRequiredReference(
      referenceRecord,
      "systemId",
      `${path}.systemId`,
      issues,
      "gate",
      idValue,
    );
    const orbitalAnchorIdValue = readRequiredReference(
      referenceRecord,
      "orbitalAnchorId",
      `${path}.orbitalAnchorId`,
      issues,
      "gate",
      idValue,
    );
    const positionAtEpoch = readVector(
      rawPropertyValue(raw, "positionAtEpoch"),
      "m",
      `${path}.positionAtEpoch`,
      issues,
      "gate",
      idValue,
    ) as PositionVector | undefined;
    const velocityAtEpoch = readVector(
      rawPropertyValue(raw, "velocityAtEpoch"),
      "m/s",
      `${path}.velocityAtEpoch`,
      issues,
      "gate",
      idValue,
    ) as VelocityVector | undefined;
    const orbitalElements = readOrbitalElements(
      {
        ...raw,
        orbitalElements: rawPropertyValue(raw, "orbitalElements"),
        orbit: rawPropertyValue(raw, "orbit"),
      },
      path,
      issues,
      "gate",
      idValue,
    );
    if (
      id !== undefined &&
      designation !== undefined &&
      name !== undefined &&
      systemIdValue !== undefined &&
      orbitalAnchorIdValue !== undefined &&
      positionAtEpoch !== undefined &&
      velocityAtEpoch !== undefined
    ) {
      const metadata = normalizeEntityProvenance(
        raw,
        "gate",
        id,
        designation,
        name,
        CORE_GATE_PROPERTIES,
        path,
        issues,
      );
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
          ...metadata,
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
      { ...raw, designation: rawPropertyValue(raw, "designation") },
      "designation",
      `${path}.designation`,
      issues,
      "gate-connection",
      idValue,
    );
    const name = readText(
      { ...raw, name: rawPropertyValue(raw, "name") },
      "name",
      `${path}.name`,
      issues,
      "gate-connection",
      idValue,
    );
    const referenceRecord = {
      ...raw,
      gateAId: rawPropertyValue(raw, "gateAId"),
      gateBId: rawPropertyValue(raw, "gateBId"),
    };
    const gateAIdValue = readRequiredReference(
      referenceRecord,
      "gateAId",
      `${path}.gateAId`,
      issues,
      "gate-connection",
      idValue,
    );
    const gateBIdValue = readRequiredReference(
      referenceRecord,
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
      const metadata = normalizeEntityProvenance(
        raw,
        "gate-connection",
        id,
        designation,
        name,
        CORE_CONNECTION_PROPERTIES,
        path,
        issues,
      );
      connections.push(
        Object.freeze({
          id,
          designation,
          name,
          gateAId: asStableId(gateAIdValue),
          gateBId: asStableId(gateBIdValue),
          ...metadata,
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
      { ...raw, designation: rawPropertyValue(raw, "designation") },
      "designation",
      `${path}.designation`,
      issues,
      "ship-profile",
      idValue,
    );
    const name = readText(
      { ...raw, name: rawPropertyValue(raw, "name") },
      "name",
      `${path}.name`,
      issues,
      "ship-profile",
      idValue,
    );
    const acceleration = readPositiveQuantity(
      rawPropertyValue(raw, "acceleration"),
      "m/s^2",
      `${path}.acceleration`,
      issues,
      "ship-profile",
      idValue,
    ) as MetersPerSecondSquared | undefined;
    const brakingAcceleration = readPositiveQuantity(
      rawPropertyValue(raw, "brakingAcceleration"),
      "m/s^2",
      `${path}.brakingAcceleration`,
      issues,
      "ship-profile",
      idValue,
    ) as MetersPerSecondSquared | undefined;
    const maximumSublightSpeed = readMaximumSublightSpeed(
      rawPropertyValue(raw, "maximumSublightSpeed"),
      `${path}.maximumSublightSpeed`,
      issues,
      idValue,
    );
    const booleanRecord = { ...raw, hasZpzGenerator: rawPropertyValue(raw, "hasZpzGenerator") };
    const hasZpzGenerator = readBoolean(
      booleanRecord,
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
      const metadata = normalizeEntityProvenance(
        raw,
        "ship-profile",
        id,
        designation,
        name,
        CORE_SHIP_PROPERTIES,
        path,
        issues,
      );
      shipProfiles.push(
        Object.freeze({
          id,
          designation,
          name,
          acceleration,
          brakingAcceleration,
          maximumSublightSpeed,
          hasZpzGenerator,
          ...metadata,
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

  const scenarioMetadata = normalizeEntityProvenance(
    input,
    "scenario",
    scenarioId,
    scenarioDesignation,
    scenarioName,
    ["designation", "name", "epoch"],
    "scenario",
    issues,
  );
  const canonicalClaims = compileScenarioClaims(input, issues);
  const overrideLayers = compileScenarioOverrides(input, issues);
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

  const immutableSystems = freezeList(sortedSystems);
  const immutableAnchors = freezeList(sortedAnchors);
  const immutableGates = freezeList(sortedGates);
  const immutableConnections = freezeList(sortedConnections);
  const immutableShipProfiles = freezeList(sortedShipProfiles);
  const entityProvenance = [
    ...immutableSystems,
    ...immutableAnchors,
    ...immutableGates,
    ...immutableConnections,
    ...immutableShipProfiles,
  ];
  const uncertainty = scenarioUncertainty(
    scenarioMetadata.properties,
    entityProvenance,
    canonicalClaims,
  );
  const compiled: CompiledScenario = Object.freeze({
    id: scenarioId,
    designation: scenarioDesignation,
    name: scenarioName,
    epoch,
    systems: immutableSystems,
    orbitalAnchors: immutableAnchors,
    gates: immutableGates,
    gateConnections: immutableConnections,
    shipProfiles: immutableShipProfiles,
    canonicalIdentity: scenarioMetadata.canonicalIdentity,
    provenance: scenarioMetadata.provenance,
    properties: scenarioMetadata.properties,
    propertyProvenance: scenarioMetadata.propertyProvenance,
    canonicalClaims,
    overrideLayers: Object.freeze([]),
    overrides: Object.freeze([]),
    uncertainty,
    overrideBase: undefined,
    index: Object.freeze({
      systems: createEntityIndex(sortedSystems),
      orbitalAnchors: createEntityIndex(sortedAnchors),
      gates: createEntityIndex(sortedGates),
      gateConnections: createEntityIndex(sortedConnections),
      shipProfiles: createEntityIndex(sortedShipProfiles),
    }),
  });
  let scenarioWithOverrides: CompiledScenario;
  try {
    scenarioWithOverrides =
      overrideLayers.length === 0 ? compiled : applyScenarioOverrides(compiled, overrideLayers);
  } catch (error) {
    addIssue(
      issues,
      "invalid-override",
      "overrides",
      error instanceof Error ? error.message : "overrides reference an invalid Scenario property.",
      "scenario",
      scenarioId,
      undefined,
    );
    return failure(issues);
  }

  return Object.freeze({ ok: true as const, scenario: scenarioWithOverrides, issues: [] as const });
}

function entityCollection(
  scenario: CompiledScenario,
  entityType: string,
):
  | readonly (
      | CompiledSystem
      | CompiledOrbitalAnchor
      | CompiledGate
      | CompiledGateConnection
      | CompiledShipProfile
    )[]
  | undefined {
  switch (entityType) {
    case "system":
      return scenario.systems;
    case "orbital-anchor":
      return scenario.orbitalAnchors;
    case "gate":
      return scenario.gates;
    case "gate-connection":
      return scenario.gateConnections;
    case "ship-profile":
      return scenario.shipProfiles;
    default:
      return undefined;
  }
}

function supportedOverrideProperties(entityType: string): readonly string[] | undefined {
  if (!Object.prototype.hasOwnProperty.call(SUPPORTED_OVERRIDE_PROPERTIES, entityType)) {
    return undefined;
  }
  return SUPPORTED_OVERRIDE_PROPERTIES[entityType as DomainEntityType];
}

function normalizeOverrideProperty(property: string): string {
  if (typeof property !== "string") {
    throw new RangeError("Override property must be a supported property name.");
  }
  const name = property.startsWith("properties.") ? property.slice("properties.".length) : property;
  if (name.length === 0 || name.includes(".")) {
    throw new RangeError(`Override property ${JSON.stringify(property)} is not supported.`);
  }
  return name;
}

function normalizeOverrideChangeForScenario(
  scenario: CompiledScenario,
  change: ScenarioOverrideChange,
): ScenarioOverrideChange {
  if (!stableIdentifierPattern.test(change.entityId)) {
    throw new RangeError(
      `Override ${change.property} requires a stable entity identifier, received ${JSON.stringify(change.entityId)}.`,
    );
  }
  const property = normalizeOverrideProperty(change.property);
  const supported = supportedOverrideProperties(change.entityType);
  if (supported === undefined || !supported.includes(property)) {
    throw new RangeError(`Override property ${change.entityType}.${property} is not supported.`);
  }
  if (change.entityType === "scenario") {
    if (change.entityId !== scenario.id) {
      throw new RangeError(
        `Override ${change.property} references Scenario ${change.entityId}, not ${scenario.id}.`,
      );
    }
  } else {
    const collection = entityCollection(scenario, change.entityType);
    if (collection === undefined) {
      throw new RangeError(`Unsupported override entity type ${change.entityType}.`);
    }
    if (!collection.some((entity) => entity.id === change.entityId)) {
      throw new RangeError(
        `Override ${change.property} references missing ${change.entityType} ${change.entityId}.`,
      );
    }
  }
  const normalizedValue = normalizeOverridePropertyValue(
    scenario,
    change.entityType as DomainEntityType,
    change.entityId as StableId,
    property,
    change.value,
  );
  return Object.freeze({ ...change, value: normalizedValue });
}

function normalizeOverridePropertyValue(
  scenario: CompiledScenario,
  entityType: DomainEntityType,
  entityId: StableId,
  property: string,
  value: unknown,
): unknown {
  const path = `${entityType}.${entityId}.${property}`;
  switch (entityType) {
    case "scenario":
      if (property === "designation" || property === "name") {
        return normalizeOverrideText(value, path);
      }
      if (property === "epoch") {
        return normalizeOverrideEpoch(value, path);
      }
      break;
    case "system":
      if (property === "designation" || property === "name") {
        return normalizeOverrideText(value, path);
      }
      if (property === "positionAtEpoch") {
        return normalizeOverrideVector(value, "m", path, entityType, entityId);
      }
      if (property === "velocityAtEpoch") {
        return normalizeOverrideVector(value, "m/s", path, entityType, entityId);
      }
      break;
    case "orbital-anchor":
      if (property === "designation" || property === "name") {
        return normalizeOverrideText(value, path);
      }
      if (property === "kind") {
        return normalizeOverrideAnchorKind(value, path);
      }
      if (property === "systemId") {
        return normalizeOverrideReference(value, path, scenario.index.systems.has);
      }
      if (property === "parentId") {
        return normalizeOptionalOverrideReference(value, path, scenario.index.orbitalAnchors.has);
      }
      if (property === "positionAtEpoch") {
        return normalizeOverrideVector(value, "m", path, entityType, entityId);
      }
      if (property === "velocityAtEpoch") {
        return normalizeOverrideVector(value, "m/s", path, entityType, entityId);
      }
      if (property === "orbitalElements") {
        return normalizeOverrideOrbitalElements(value, path, entityType, entityId);
      }
      break;
    case "gate":
      if (property === "designation" || property === "name") {
        return normalizeOverrideText(value, path);
      }
      if (property === "systemId") {
        return normalizeOverrideReference(value, path, scenario.index.systems.has);
      }
      if (property === "orbitalAnchorId") {
        return normalizeOverrideReference(value, path, scenario.index.orbitalAnchors.has);
      }
      if (property === "positionAtEpoch") {
        return normalizeOverrideVector(value, "m", path, entityType, entityId);
      }
      if (property === "velocityAtEpoch") {
        return normalizeOverrideVector(value, "m/s", path, entityType, entityId);
      }
      if (property === "orbitalElements") {
        return normalizeOverrideOrbitalElements(value, path, entityType, entityId);
      }
      break;
    case "gate-connection":
      if (property === "designation" || property === "name") {
        return normalizeOverrideText(value, path);
      }
      if (property === "gateAId" || property === "gateBId") {
        return normalizeOverrideReference(value, path, scenario.index.gates.has);
      }
      break;
    case "ship-profile":
      if (property === "designation" || property === "name") {
        return normalizeOverrideText(value, path);
      }
      if (property === "acceleration" || property === "brakingAcceleration") {
        return normalizeOverridePositiveQuantity(value, "m/s^2", path, entityType, entityId);
      }
      if (property === "maximumSublightSpeed") {
        return normalizeOverrideMaximumSublightSpeed(value, path, entityId);
      }
      if (property === "hasZpzGenerator") {
        if (typeof value !== "boolean") {
          throw new RangeError(`${path} must be a boolean.`);
        }
        return value;
      }
      break;
  }
  throw new RangeError(`Override property ${entityType}.${property} is not supported.`);
}

function normalizeOverrideText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RangeError(`${path} must be a non-empty string.`);
  }
  return value;
}

function normalizeOverrideAnchorKind(value: unknown, path: string): OrbitalAnchorKind {
  if (value === "star" || value === "planet" || value === "moon" || value === "barycenter") {
    return value;
  }
  throw new RangeError(`${path} must be a supported Orbital Anchor kind.`);
}

function normalizeOverrideReference(
  value: unknown,
  path: string,
  hasReference: (id: StableId) => boolean,
): StableId {
  if (typeof value !== "string" || !stableIdentifierPattern.test(value)) {
    throw new RangeError(`${path} must be a stable identifier string.`);
  }
  const id = value as StableId;
  if (!hasReference(id)) {
    throw new RangeError(`${path} references missing entity ${value}.`);
  }
  return id;
}

function normalizeOptionalOverrideReference(
  value: unknown,
  path: string,
  hasReference: (id: StableId) => boolean,
): StableId | undefined {
  return value === undefined ? undefined : normalizeOverrideReference(value, path, hasReference);
}

function normalizeOverrideVector<Unit extends SIUnit>(
  value: unknown,
  expectedUnit: Unit,
  path: string,
  entityType: DomainEntityType,
  entityId: StableId,
): Vector3<Unit> {
  const issues: ValidationIssue[] = [];
  const parsed = readVector(value, expectedUnit, path, issues, entityType, entityId);
  if (parsed === undefined) {
    throwOverrideValidationError(path, issues);
  }
  return parsed;
}

function normalizeOverridePositiveQuantity<Unit extends SIUnit>(
  value: unknown,
  expectedUnit: Unit,
  path: string,
  entityType: DomainEntityType,
  entityId: StableId,
): SIQuantity<Unit> {
  const issues: ValidationIssue[] = [];
  const parsed = readPositiveQuantity(value, expectedUnit, path, issues, entityType, entityId);
  if (parsed === undefined) {
    throwOverrideValidationError(path, issues);
  }
  return parsed;
}

function normalizeOverrideMaximumSublightSpeed(
  value: unknown,
  path: string,
  entityId: StableId,
): MetersPerSecond {
  const issues: ValidationIssue[] = [];
  const parsed = readMaximumSublightSpeed(value, path, issues, entityId);
  if (parsed === undefined) {
    throwOverrideValidationError(path, issues);
  }
  return parsed;
}

function normalizeOverrideEpoch(value: unknown, path: string): ScenarioEpoch {
  const issues: ValidationIssue[] = [];
  const parsed = readEpoch({ epoch: value }, issues);
  if (parsed === undefined) {
    throwOverrideValidationError(path, issues);
  }
  return parsed;
}

function normalizeOverrideOrbitalElements(
  value: unknown,
  path: string,
  entityType: DomainEntityType,
  entityId: StableId,
): CompiledKeplerianOrbit | undefined {
  if (value === undefined) {
    return undefined;
  }
  const issues: ValidationIssue[] = [];
  const parsed = readOrbitalElements(
    { orbitalElements: value },
    path,
    issues,
    entityType,
    entityId,
  );
  if (parsed === undefined || issues.length > 0) {
    throwOverrideValidationError(path, issues);
  }
  return parsed;
}

function throwOverrideValidationError(path: string, issues: readonly ValidationIssue[]): never {
  throw new RangeError(issues[0]?.message ?? `${path} is invalid.`);
}

function validateCompiledScenarioInvariants(scenario: CompiledScenario): void {
  const issues: ValidationIssue[] = [];
  const systems = new Map(scenario.systems.map((system) => [system.id, system]));
  const anchors = new Map(scenario.orbitalAnchors.map((anchor) => [anchor.id, anchor]));
  validateStationarySystems(scenario.systems, issues);
  validateAnchorReferences(scenario.orbitalAnchors, systems, issues);
  validateGateReferences(scenario.gates, systems, anchors, issues);
  validateGateConnections(scenario.gates, scenario.gateConnections, issues);
  const issue = issues[0];
  if (issue !== undefined) {
    throw new RangeError(issue.message);
  }
}

function replaceEntityProperty(
  entity:
    | CompiledSystem
    | CompiledOrbitalAnchor
    | CompiledGate
    | CompiledGateConnection
    | CompiledShipProfile,
  change: import("./provenance").ScenarioOverrideChange,
): typeof entity {
  const property = change.property.startsWith("properties.")
    ? change.property.slice("properties.".length)
    : change.property;
  const properties = {
    ...entity.properties,
    [property]: createPropertyMetadata(property, change.value, {
      claim: change.claim,
      provenance: change.provenance,
    }),
  };
  const updated = change.property.startsWith("properties.")
    ? entity
    : { ...entity, [property]: change.value };
  return Object.freeze({
    ...updated,
    properties: Object.freeze(properties),
    propertyProvenance: Object.freeze(properties),
  }) as typeof entity;
}

function replaceEntity(
  scenario: CompiledScenario,
  change: import("./provenance").ScenarioOverrideChange,
): CompiledScenario {
  if (change.entityType === "scenario") {
    if (change.entityId !== scenario.id) {
      throw new RangeError(
        `Override ${change.property} references Scenario ${change.entityId}, not ${scenario.id}.`,
      );
    }
    const property = change.property.startsWith("properties.")
      ? change.property.slice("properties.".length)
      : change.property;
    const properties = {
      ...scenario.properties,
      [property]: createPropertyMetadata(property, change.value, {
        claim: change.claim,
        provenance: change.provenance,
      }),
    };
    const updated = change.property.startsWith("properties.")
      ? scenario
      : { ...scenario, [property]: change.value };
    return cloneCompiledScenario(updated as CompiledScenario, {
      properties: Object.freeze(properties),
      propertyProvenance: Object.freeze(properties),
    });
  }

  const collection = entityCollection(scenario, change.entityType);
  if (collection === undefined) {
    throw new RangeError(`Unsupported override entity type ${change.entityType}.`);
  }
  const index = collection.findIndex((entity) => entity.id === change.entityId);
  if (index < 0) {
    throw new RangeError(
      `Override ${change.property} references missing ${change.entityType} ${change.entityId}.`,
    );
  }
  const entity = collection[index];
  if (entity === undefined) {
    throw new RangeError(`Override ${change.entityId} resolved to no entity.`);
  }
  const replacement = replaceEntityProperty(entity, change);
  const replacements = [...collection];
  replacements[index] = replacement;
  const systems =
    change.entityType === "system" ? (replacements as CompiledSystem[]) : scenario.systems;
  const orbitalAnchors =
    change.entityType === "orbital-anchor"
      ? (replacements as CompiledOrbitalAnchor[])
      : scenario.orbitalAnchors;
  const gates = change.entityType === "gate" ? (replacements as CompiledGate[]) : scenario.gates;
  const gateConnections =
    change.entityType === "gate-connection"
      ? (replacements as CompiledGateConnection[])
      : scenario.gateConnections;
  const shipProfiles =
    change.entityType === "ship-profile"
      ? (replacements as CompiledShipProfile[])
      : scenario.shipProfiles;
  return cloneCompiledScenario(scenario, {
    systems,
    orbitalAnchors,
    gates,
    gateConnections,
    shipProfiles,
  });
}

function cloneCompiledScenario(
  scenario: CompiledScenario,
  replacements: {
    readonly systems?: readonly CompiledSystem[];
    readonly orbitalAnchors?: readonly CompiledOrbitalAnchor[];
    readonly gates?: readonly CompiledGate[];
    readonly gateConnections?: readonly CompiledGateConnection[];
    readonly shipProfiles?: readonly CompiledShipProfile[];
    readonly properties?: Readonly<Record<string, PropertyMetadata<unknown>>>;
    readonly propertyProvenance?: Readonly<Record<string, PropertyMetadata<unknown>>>;
    readonly overrideLayers?: readonly ScenarioOverrideLayer[];
    readonly overrideBase?: CompiledScenario | undefined;
  },
): CompiledScenario {
  const systems = replacements.systems ?? scenario.systems;
  const orbitalAnchors = replacements.orbitalAnchors ?? scenario.orbitalAnchors;
  const gates = replacements.gates ?? scenario.gates;
  const gateConnections = replacements.gateConnections ?? scenario.gateConnections;
  const shipProfiles = replacements.shipProfiles ?? scenario.shipProfiles;
  const properties = replacements.properties ?? scenario.properties;
  const entities = [...systems, ...orbitalAnchors, ...gates, ...gateConnections, ...shipProfiles];
  const uncertainty = scenarioUncertainty(properties, entities, scenario.canonicalClaims);
  return Object.freeze({
    ...scenario,
    systems: freezeList(systems),
    orbitalAnchors: freezeList(orbitalAnchors),
    gates: freezeList(gates),
    gateConnections: freezeList(gateConnections),
    shipProfiles: freezeList(shipProfiles),
    properties,
    propertyProvenance: replacements.propertyProvenance ?? properties,
    overrideLayers: Object.freeze(replacements.overrideLayers ?? scenario.overrideLayers),
    overrides: Object.freeze(replacements.overrideLayers ?? scenario.overrideLayers),
    uncertainty,
    overrideBase:
      replacements.overrideBase === undefined ? scenario.overrideBase : replacements.overrideBase,
    index: Object.freeze({
      systems: createEntityIndex(systems),
      orbitalAnchors: createEntityIndex(orbitalAnchors),
      gates: createEntityIndex(gates),
      gateConnections: createEntityIndex(gateConnections),
      shipProfiles: createEntityIndex(shipProfiles),
    }),
  });
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== typeof right || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]),
      )
    );
  }
  return false;
}

function scenarioPropertyValue(
  scenario: CompiledScenario,
  change: {
    readonly entityType: string;
    readonly entityId: string;
    readonly property: string;
  },
): unknown {
  if (change.entityType === "scenario") {
    if (change.entityId !== scenario.id) {
      return undefined;
    }
    return change.property.startsWith("properties.")
      ? scenario.properties[change.property.slice("properties.".length)]?.value
      : scenario[change.property as keyof CompiledScenario];
  }
  const entity = entityCollection(scenario, change.entityType)?.find(
    (candidate) => candidate.id === change.entityId,
  );
  if (entity === undefined) {
    return undefined;
  }
  return change.property.startsWith("properties.")
    ? entity.properties[change.property.slice("properties.".length)]?.value
    : entity[change.property as keyof typeof entity];
}

/**
 * Applies ordered immutable Scenario override layers.
 *
 * Later layers win for the same property, while the original compiled Scenario remains available
 * through the returned Scenario's override base for safe reversion.
 *
 * @param scenario - The immutable Scenario to overlay.
 * @param layers - Ordered override layers to apply.
 * @returns A new immutable Scenario containing the effective values and layer history.
 */
export function applyScenarioOverrides(
  scenario: CompiledScenario,
  layers: readonly ScenarioOverrideLayerInput[],
): CompiledScenario {
  if (!Array.isArray(layers)) {
    throw new RangeError("Scenario overrides must be supplied as an array of layers.");
  }
  const normalizedLayers = layers.map((layer) => createScenarioOverrideLayer(layer));
  const knownLayerIds = new Set(scenario.overrideLayers.map((layer) => layer.id));
  for (const layer of normalizedLayers) {
    if (knownLayerIds.has(layer.id)) {
      throw new RangeError(`Override layer ${layer.id} is already active in the Scenario.`);
    }
    knownLayerIds.add(layer.id);
  }
  const base = scenario.overrideBase ?? scenario;
  let current = scenario;
  const effectiveLayers: ScenarioOverrideLayer[] = [];
  for (const layer of normalizedLayers) {
    const effectiveChanges: ScenarioOverrideChange[] = [];
    for (const change of layer.changes) {
      const normalizedChange = normalizeOverrideChangeForScenario(current, change);
      current = replaceEntity(current, normalizedChange);
      effectiveChanges.push(normalizedChange);
    }
    effectiveLayers.push(
      Object.freeze({
        ...layer,
        changes: Object.freeze(effectiveChanges),
      }),
    );
  }
  validateCompiledScenarioInvariants(current);
  const allLayers = Object.freeze([...scenario.overrideLayers, ...effectiveLayers]);
  return cloneCompiledScenario(current, {
    overrideLayers: allLayers,
    overrideBase: base,
  });
}

/**
 * Compares effective Scenario values before and after an override operation.
 *
 * @param before - The original compiled Scenario.
 * @param after - The overridden compiled Scenario.
 * @returns Immutable property-level changes in layer order.
 */
export function compareScenarioOverrides(
  before: CompiledScenario,
  after: CompiledScenario,
): readonly import("./provenance").OverrideChangeComparison[] {
  const comparisons: import("./provenance").OverrideChangeComparison[] = [];
  for (const layer of after.overrideLayers) {
    for (const change of layer.changes) {
      const beforeValue = scenarioPropertyValue(before, change);
      const afterValue = scenarioPropertyValue(after, change);
      comparisons.push(
        Object.freeze({
          layerId: layer.id,
          entityType: change.entityType,
          entityId: change.entityId,
          property: change.property,
          before: beforeValue,
          after: afterValue,
          changed: !deepEqual(beforeValue, afterValue),
          provenance: change.provenance,
        }),
      );
    }
  }
  return Object.freeze(comparisons);
}

/**
 * Reverts one override layer and reapplies any remaining layers in their original order.
 *
 * @param scenario - A Scenario returned by {@link applyScenarioOverrides}.
 * @param layerId - The layer identifier to remove.
 * @returns A new immutable Scenario with the selected layer absent.
 * @throws RangeError when the layer is not active.
 */
export function revertScenarioOverride(
  scenario: CompiledScenario,
  layerId: string,
): CompiledScenario {
  if (!scenario.overrideLayers.some((layer) => layer.id === layerId)) {
    throw new RangeError(`Override layer ${layerId} is not active in the Scenario.`);
  }
  const base = scenario.overrideBase ?? scenario;
  const remaining = scenario.overrideLayers.filter((layer) => layer.id !== layerId);
  return remaining.length === 0 ? base : applyScenarioOverrides(base, remaining);
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
    applyScenarioOverrides,
    compareScenarioOverrides,
    revertScenarioOverride,
  });
}
