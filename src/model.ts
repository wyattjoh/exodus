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
import { planJourney, planRoute } from "./route-planning";
import type { RoutePlanningRequest, RoutePlanningResult } from "./route-planning";
import {
  generateClusterRegion,
  generateHierarchicalCluster,
  materializeClusterRegion,
  planClusterRoute,
} from "./cluster-generation";
import { createUnavailableScenarioPersistence } from "./scenario-persistence-adapter";
import type {
  ScenarioExportDocument,
  ScenarioExportOptions,
  ScenarioExportSource,
  ScenarioImportResult,
  ScenarioMigrationResult,
} from "./scenario-persistence";
import type { ScenarioPersistenceAdapter } from "./scenario-persistence-adapter";
import {
  isSupportedScenarioGeneratorVersion,
  SUPPORTED_SCENARIO_GENERATOR_VERSIONS,
} from "./generator-versions";
import type {
  ClusterGenerationRequest,
  ClusterRegionMaterializationRequest,
  ClusterRoutePlanningResult,
  GeneratedClusterRegion,
  HierarchicalClusterRegion,
} from "./cluster-generation";
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
  createCitation,
  createDisplayPrecision,
  createPropertyMetadata,
  createProvenance,
  createScenarioOverrideLayer,
  provisionalProvenance,
  type CanonicalClaim,
  type CanonicalIdentity,
  type CanonicalIdentityInput,
  type Citation,
  type CitationAuthority,
  type CitationInput,
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
const trustedCompiledScenarios = new WeakSet<object>();
const trustedCompiledScenarioIndexOwners = new WeakMap<object, CompiledScenario>();

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
 * The two seed types supported by deterministic Cluster generation.
 */
export type ScenarioSeedKind = "number" | "string";

/**
 * A normalized, typed seed identity retained by a Scenario export.
 */
export type ScenarioSeed = {
  readonly kind: ScenarioSeedKind;
  readonly type: ScenarioSeedKind;
  readonly value: string | number;
  readonly text: string;
  readonly identity: string;
};

/**
 * A seed accepted at the Scenario and persistence seams.
 */
export type ScenarioSeedInput =
  | string
  | number
  | {
      readonly kind?: ScenarioSeedKind | undefined;
      readonly type?: ScenarioSeedKind | undefined;
      readonly value?: string | number | undefined;
      readonly text?: string | undefined;
      readonly identity?: string | undefined;
    };

/**
 * Generation metadata that makes a procedural Scenario reproducible.
 */
export type ScenarioGenerationMetadata = {
  readonly generatorVersion: string;
  readonly seed: ScenarioSeed;
  readonly logicalPopulation: number;
};

/**
 * Generation metadata accepted while constructing a Scenario.
 */
export type ScenarioGenerationMetadataInput = {
  readonly generatorVersion: string;
  readonly seed: ScenarioSeedInput;
  readonly logicalPopulation: number;
};

/**
 * A source reference retained independently from property-level Provenance.
 */
export type ScenarioReferenceInput = {
  readonly id: string;
  readonly source?: string | undefined;
  readonly locator?: string | undefined;
  readonly title?: string | undefined;
  readonly url?: string | undefined;
  readonly authority?: CitationAuthority | undefined;
  readonly citation?: CitationInput | Citation | undefined;
  readonly citations?: readonly (CitationInput | Citation)[] | undefined;
  readonly note?: string | undefined;
};

/**
 * A normalized, immutable Scenario source reference.
 */
export type ScenarioReference = {
  readonly id: StableId;
  readonly source: string;
  readonly locator: string;
  readonly title: string | undefined;
  readonly url: string | undefined;
  readonly authority: CitationAuthority;
  readonly citation: Citation;
  readonly citations: readonly Citation[];
  readonly note: string | undefined;
};

/**
 * A JSON-friendly saved input for simulation or route planning.
 *
 * The runtime persistence seam validates and snapshots the record without replacing the existing
 * Journey and Route request types.
 */
export type SavedJourneyInput = Readonly<Record<string, unknown>>;

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
  readonly generatorVersion?: string | undefined;
  readonly seed?: ScenarioSeedInput | undefined;
  readonly logicalPopulation?: number | undefined;
  readonly generation?: ScenarioGenerationMetadataInput | undefined;
  readonly references?: readonly ScenarioReferenceInput[] | undefined;
  readonly canonicalClaims?: readonly ScenarioCanonicalClaimInput[] | undefined;
  readonly overrides?: readonly ScenarioOverrideLayerInput[] | undefined;
  readonly journeyInputs?: readonly SavedJourneyInput[] | undefined;
  readonly savedJourneyInputs?: readonly SavedJourneyInput[] | undefined;
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
  readonly generatorVersion: string | undefined;
  readonly seed: ScenarioSeed | undefined;
  readonly logicalPopulation: number | undefined;
  readonly generation: ScenarioGenerationMetadata | undefined;
  readonly references: readonly ScenarioReference[];
  readonly journeyInputs: readonly SavedJourneyInput[];
  readonly savedJourneyInputs: readonly SavedJourneyInput[];
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
  | "invalid-override"
  | "invalid-generation-metadata"
  | "unsupported-generator-version"
  | "invalid-reference";

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
  readonly planJourney: (
    scenario: CompiledScenario,
    request: RoutePlanningRequest | unknown,
  ) => RoutePlanningResult;
  readonly planRoute: (
    scenario: CompiledScenario,
    request: RoutePlanningRequest | unknown,
  ) => RoutePlanningResult;
  readonly planClusterRoute: (
    hierarchy: HierarchicalClusterRegion,
    request: unknown,
  ) => ClusterRoutePlanningResult;
  readonly generateClusterRegion: (request: ClusterGenerationRequest) => GeneratedClusterRegion;
  readonly generateHierarchicalCluster: (
    request: ClusterGenerationRequest,
  ) => HierarchicalClusterRegion;
  readonly materializeClusterRegion: (
    region: HierarchicalClusterRegion | GeneratedClusterRegion,
    request?: ClusterRegionMaterializationRequest,
  ) => GeneratedClusterRegion;
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
  readonly createScenarioExport: (
    source: ScenarioExportSource,
    options?: ScenarioExportOptions,
  ) => ScenarioExportDocument;
  readonly serializeScenario: (
    source: ScenarioExportSource,
    options?: ScenarioExportOptions,
  ) => string;
  readonly exportScenario: (
    source: ScenarioExportSource,
    options?: ScenarioExportOptions,
  ) => string;
  readonly importScenario: (input: unknown) => ScenarioImportResult;
  readonly migrateScenario: (input: unknown) => ScenarioMigrationResult;
};

type RecordValue = Record<string, unknown>;

/**
 * Normalizes a numeric or textual seed while preserving its type, exact text, and deterministic
 * identity. The object form is intentionally strict so imported JSON cannot silently coerce a
 * number into a string or accept a mismatched identity.
 *
 * @param input - A safe integer, exact string, or fully/partially described seed descriptor.
 * @returns An immutable normalized seed descriptor.
 * @throws RangeError when the seed is unsafe, empty, or internally inconsistent.
 */
export function createScenarioSeed(input: ScenarioSeedInput): ScenarioSeed {
  if (typeof input === "number") {
    if (!Number.isSafeInteger(input)) {
      throw new RangeError("Scenario numeric seeds must be safe integers.");
    }
    const text = String(input);
    return Object.freeze({
      kind: "number" as const,
      type: "number" as const,
      value: input,
      text,
      identity: `number:${text}`,
    });
  }
  if (typeof input === "string") {
    if (!isNonEmptyString(input)) {
      throw new RangeError("Scenario string seeds must be non-empty.");
    }
    return Object.freeze({
      kind: "string" as const,
      type: "string" as const,
      value: input,
      text: input,
      identity: `string:${input.length}:${input}`,
    });
  }
  if (!isRecord(input)) {
    throw new RangeError("Scenario seed must be a string, safe integer, or descriptor object.");
  }

  const descriptorKind = input.kind ?? input.type;
  const valueKind = typeof input.value === "number" ? "number" : "string";
  const kind = descriptorKind ?? (typeof input.value === "number" ? "number" : "string");
  if (descriptorKind !== undefined && descriptorKind !== "number" && descriptorKind !== "string") {
    throw new RangeError("Scenario seed descriptor kind must be number or string.");
  }
  if (input.kind !== undefined && input.type !== undefined && input.kind !== input.type) {
    throw new RangeError("Scenario seed descriptor kind and type must agree.");
  }
  if (kind === "number") {
    if (typeof input.value !== "number" || !Number.isSafeInteger(input.value)) {
      throw new RangeError("Numeric Scenario seed descriptors require a safe integer value.");
    }
    if (valueKind !== "number") {
      throw new RangeError("Numeric Scenario seed descriptors cannot use string values.");
    }
    const text = input.text ?? String(input.value);
    const identity = `number:${text}`;
    if (
      text !== String(input.value) ||
      (input.identity !== undefined && input.identity !== identity)
    ) {
      throw new RangeError("Scenario numeric seed text and identity do not match its value.");
    }
    return Object.freeze({
      kind: "number" as const,
      type: "number" as const,
      value: input.value,
      text,
      identity,
    });
  }

  const text = input.text ?? (typeof input.value === "string" ? input.value : undefined);
  if (text === undefined || !isNonEmptyString(text)) {
    throw new RangeError("String Scenario seed descriptors require non-empty text.");
  }
  if (input.value !== undefined && input.value !== text) {
    throw new RangeError("Scenario string seed value and text must be identical.");
  }
  const identity = `string:${text.length}:${text}`;
  if (input.identity !== undefined && input.identity !== identity) {
    throw new RangeError("Scenario string seed identity does not match its exact text.");
  }
  return Object.freeze({
    kind: "string" as const,
    type: "string" as const,
    value: text,
    text,
    identity,
  });
}

/**
 * Normalizes one source reference and all of its citations into an immutable record.
 *
 * @param input - Flat or nested citation fields with a stable reference identifier.
 * @returns An immutable normalized Scenario reference.
 * @throws RangeError when the identifier or citation data is invalid.
 */
export function createScenarioReference(input: ScenarioReferenceInput): ScenarioReference {
  if (!isRecord(input) || !isNonEmptyString(input.id) || !stableIdentifierPattern.test(input.id)) {
    throw new RangeError("Scenario references require a stable id.");
  }

  const citationInputs: (CitationInput | Citation)[] = [];
  if (
    isNonEmptyString(input.source) &&
    isNonEmptyString(input.locator) &&
    (input.authority !== undefined ||
      (input.citation === undefined && input.citations === undefined))
  ) {
    citationInputs.push({
      source: input.source,
      locator: input.locator,
      title: input.title,
      url: input.url,
      authority: input.authority,
    });
  }
  if (input.citation !== undefined) {
    citationInputs.push(input.citation);
  }
  if (input.citations !== undefined) {
    if (!Array.isArray(input.citations)) {
      throw new RangeError(`Scenario reference ${input.id} citations must be an array.`);
    }
    citationInputs.push(...input.citations);
  }
  if (citationInputs.length === 0) {
    throw new RangeError(`Scenario reference ${input.id} requires source and locator.`);
  }

  const citations = deduplicateScenarioCitations(
    citationInputs.map((citation) => createCitation(citation)),
  );
  const citation = citations[0];
  if (citation === undefined) {
    throw new RangeError(`Scenario reference ${input.id} requires at least one citation.`);
  }
  return Object.freeze({
    id: input.id as StableId,
    source: citation.source,
    locator: citation.locator,
    title: citation.title,
    url: citation.url,
    authority: citation.authority,
    citation,
    citations: Object.freeze(citations),
    note: input.note === undefined ? undefined : requireOptionalText(input.note, "note"),
  });
}

function deduplicateScenarioCitations(citations: readonly Citation[]): Citation[] {
  const seen = new Set<string>();
  const result: Citation[] = [];
  for (const citation of citations) {
    const key = `${citation.authority}\u0000${citation.source}\u0000${citation.locator}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(citation);
    }
  }
  return result;
}

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function requireOptionalText(value: unknown, field: string): string {
  if (!isNonEmptyString(value)) {
    throw new RangeError(`${field} must be a non-empty string when supplied.`);
  }
  return value;
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

function readScenarioGeneration(
  record: RecordValue,
  issues: ValidationIssue[],
): ScenarioGenerationMetadata | undefined {
  const rawGeneration = record.generation;
  let generation: RecordValue | undefined;
  if (rawGeneration !== undefined) {
    if (!isRecord(rawGeneration)) {
      addIssue(
        issues,
        "invalid-generation-metadata",
        "generation",
        "generation must be an object.",
        "scenario",
        undefined,
        undefined,
      );
    } else {
      generation = rawGeneration;
    }
  }

  const propertyVersion = rawPropertyValue(record, "generatorVersion");
  const propertySeed = rawPropertyValue(record, "generationSeed");
  const propertyPopulation = rawPropertyValue(record, "logicalPopulation");
  const generatorVersion =
    record.generatorVersion ?? generation?.generatorVersion ?? propertyVersion;
  const seed = record.seed ?? generation?.seed ?? propertySeed;
  const logicalPopulation =
    record.logicalPopulation ?? generation?.logicalPopulation ?? propertyPopulation;
  const hasMetadata =
    record.generatorVersion !== undefined ||
    record.seed !== undefined ||
    record.logicalPopulation !== undefined ||
    generation !== undefined ||
    propertyVersion !== undefined ||
    propertySeed !== undefined ||
    propertyPopulation !== undefined;
  if (!hasMetadata) {
    return undefined;
  }

  validateGenerationAliases(
    [
      { path: "generatorVersion", value: record.generatorVersion },
      { path: "generation.generatorVersion", value: generation?.generatorVersion },
      { path: "properties.generatorVersion", value: propertyVersion },
    ],
    "generatorVersion",
    issues,
    (value) => (typeof value === "string" ? value.trim() : value),
  );
  validateGenerationAliases(
    [
      { path: "logicalPopulation", value: record.logicalPopulation },
      { path: "generation.logicalPopulation", value: generation?.logicalPopulation },
      { path: "properties.logicalPopulation", value: propertyPopulation },
    ],
    "logicalPopulation",
    issues,
    (value) => value,
  );
  validateGenerationAliases(
    [
      { path: "seed", value: record.seed },
      { path: "generation.seed", value: generation?.seed },
      { path: "properties.generationSeed", value: propertySeed },
    ],
    "seed",
    issues,
    (value) => {
      try {
        return createScenarioSeed(value as ScenarioSeedInput).identity;
      } catch {
        return undefined;
      }
    },
  );

  if (typeof generatorVersion !== "string" || generatorVersion.trim().length === 0) {
    addIssue(
      issues,
      "invalid-generation-metadata",
      "generatorVersion",
      "generatorVersion must be a non-empty string.",
      "scenario",
      undefined,
      undefined,
    );
  } else if (!isSupportedScenarioGeneratorVersion(generatorVersion.trim())) {
    addIssue(
      issues,
      "unsupported-generator-version",
      "generatorVersion",
      `generatorVersion ${JSON.stringify(generatorVersion.trim())} is unavailable; supported metadata versions are ${SUPPORTED_SCENARIO_GENERATOR_VERSIONS.join(", ")}.`,
      "scenario",
      undefined,
      undefined,
    );
  }
  if (typeof logicalPopulation !== "number" || !Number.isSafeInteger(logicalPopulation)) {
    addIssue(
      issues,
      "invalid-generation-metadata",
      "logicalPopulation",
      "logicalPopulation must be a safe integer of at least two.",
      "scenario",
      undefined,
      undefined,
    );
  } else if (logicalPopulation < 2) {
    addIssue(
      issues,
      "invalid-generation-metadata",
      "logicalPopulation",
      "logicalPopulation must be a safe integer of at least two.",
      "scenario",
      undefined,
      undefined,
    );
  }

  let normalizedSeed: ScenarioSeed | undefined;
  try {
    if (seed === undefined) {
      throw new RangeError("seed is required when generation metadata is supplied.");
    }
    normalizedSeed = createScenarioSeed(seed as ScenarioSeedInput);
  } catch (error) {
    addIssue(
      issues,
      "invalid-generation-metadata",
      "seed",
      error instanceof Error ? error.message : "seed is invalid.",
      "scenario",
      undefined,
      undefined,
    );
  }
  if (
    typeof generatorVersion !== "string" ||
    generatorVersion.trim().length === 0 ||
    normalizedSeed === undefined ||
    typeof logicalPopulation !== "number" ||
    !Number.isSafeInteger(logicalPopulation) ||
    logicalPopulation < 2
  ) {
    return undefined;
  }
  return Object.freeze({
    generatorVersion: generatorVersion.trim(),
    seed: normalizedSeed,
    logicalPopulation,
  });
}

function validateGenerationAliases(
  values: readonly { readonly path: string; readonly value: unknown }[],
  field: "generatorVersion" | "logicalPopulation" | "seed",
  issues: ValidationIssue[],
  normalize: (value: unknown) => unknown,
): void {
  const supplied = values.filter(({ value }) => value !== undefined);
  const first = supplied[0];
  if (first === undefined || supplied.length < 2) {
    return;
  }
  let normalizedFirst: unknown;
  try {
    normalizedFirst = normalize(first.value);
  } catch {
    return;
  }
  for (const alias of supplied.slice(1)) {
    let normalized: unknown;
    try {
      normalized = normalize(alias.value);
    } catch {
      return;
    }
    if (normalizedFirst === undefined || normalized === undefined) {
      return;
    }
    if (Object.is(normalizedFirst, normalized) || deepEqual(normalizedFirst, normalized)) {
      continue;
    }
    addIssue(
      issues,
      "invalid-generation-metadata",
      field,
      `${first.path} must agree with ${alias.path}.`,
      "scenario",
      undefined,
      undefined,
    );
  }
}

function compileScenarioReferences(
  record: RecordValue,
  issues: ValidationIssue[],
): readonly ScenarioReference[] {
  const rawCanonicalReferences = record.references;
  const rawSourceReferences = record.sourceReferences;
  if (
    rawCanonicalReferences !== undefined &&
    rawSourceReferences !== undefined &&
    !deepEqual(rawCanonicalReferences, rawSourceReferences)
  ) {
    addIssue(
      issues,
      "invalid-reference",
      "references",
      "references and sourceReferences must agree when both are supplied.",
      "scenario",
      undefined,
      undefined,
    );
  }
  const rawReferences =
    rawCanonicalReferences !== undefined ? rawCanonicalReferences : rawSourceReferences;
  if (rawReferences === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(rawReferences)) {
    addIssue(
      issues,
      "invalid-reference",
      "references",
      "references must be an array.",
      "scenario",
      undefined,
      undefined,
    );
    return Object.freeze([]);
  }
  const references: ScenarioReference[] = [];
  const seenReferenceIds = new Set<string>();
  for (const [index, rawReference] of rawReferences.entries()) {
    try {
      const reference = createScenarioReference(rawReference as ScenarioReferenceInput);
      if (seenReferenceIds.has(reference.id)) {
        addIssue(
          issues,
          "duplicate-id",
          `references[${index}].id`,
          `Scenario reference id ${reference.id} is duplicated.`,
          "scenario",
          reference.id,
          undefined,
        );
        continue;
      }
      seenReferenceIds.add(reference.id);
      references.push(reference);
    } catch (error) {
      addIssue(
        issues,
        "invalid-reference",
        `references[${index}]`,
        error instanceof Error ? error.message : `references[${index}] is invalid.`,
        "scenario",
        undefined,
        undefined,
      );
    }
  }
  return Object.freeze(references.sort((left, right) => left.id.localeCompare(right.id)));
}

function snapshotSavedJourneyValue(
  value: unknown,
  path: string,
  seen: WeakSet<object> = new WeakSet<object>(),
): unknown {
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError(`${path} must contain only finite numbers.`);
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new RangeError(`${path} must contain only JSON-compatible values.`);
  }
  const objectValue = value as object;
  if (seen.has(objectValue)) {
    throw new RangeError(`${path} must not contain cyclic values.`);
  }
  seen.add(objectValue);
  if (Array.isArray(value)) {
    const copy = value.map((child, index) =>
      snapshotSavedJourneyValue(child, `${path}[${index}]`, seen),
    );
    seen.delete(objectValue);
    return Object.freeze(copy);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new RangeError(`${path} must contain plain JSON objects.`);
  }
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new RangeError(`${path}.${key} is not allowed in saved JSON.`);
    }
    copy[key] = snapshotSavedJourneyValue(
      (value as Record<string, unknown>)[key],
      `${path}.${key}`,
      seen,
    );
  }
  seen.delete(objectValue);
  return Object.freeze(copy);
}

function compileScenarioJourneyInputs(
  record: RecordValue,
  issues: ValidationIssue[],
): readonly SavedJourneyInput[] {
  const journeyInputs = record.journeyInputs;
  const savedJourneyInputs = record.savedJourneyInputs;
  if (journeyInputs !== undefined && savedJourneyInputs !== undefined) {
    try {
      const journeySnapshot = snapshotSavedJourneyValue(journeyInputs, "journeyInputs");
      const savedJourneySnapshot = snapshotSavedJourneyValue(
        savedJourneyInputs,
        "savedJourneyInputs",
      );
      if (!deepEqual(journeySnapshot, savedJourneySnapshot)) {
        addIssue(
          issues,
          "invalid-structure",
          "journeyInputs",
          "journeyInputs and savedJourneyInputs must agree when both are supplied.",
          "scenario",
          undefined,
          undefined,
        );
      }
    } catch {
      // The selected alias receives the detailed structural issue below.
    }
  }
  const rawInputs = journeyInputs !== undefined ? journeyInputs : savedJourneyInputs;
  if (rawInputs === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(rawInputs)) {
    addIssue(
      issues,
      "invalid-structure",
      "journeyInputs",
      "journeyInputs must be an array.",
      "scenario",
      undefined,
      undefined,
    );
    return Object.freeze([]);
  }
  const inputs: SavedJourneyInput[] = [];
  for (const [index, rawInput] of rawInputs.entries()) {
    try {
      const snapshot = snapshotSavedJourneyValue(rawInput, `journeyInputs[${index}]`);
      if (!isRecord(snapshot)) {
        throw new RangeError(`journeyInputs[${index}] must be an object.`);
      }
      inputs.push(snapshot as SavedJourneyInput);
    } catch (error) {
      addIssue(
        issues,
        "invalid-structure",
        `journeyInputs[${index}]`,
        error instanceof Error ? error.message : `journeyInputs[${index}] is invalid.`,
        "scenario",
        undefined,
        undefined,
      );
    }
  }
  return Object.freeze(inputs);
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
  const index = Object.freeze({
    get: (id: StableId): Entity | undefined => entities.get(id),
    has: (id: StableId): boolean => entities.has(id),
    keys: (): IterableIterator<StableId> => entities.keys(),
    values: (): IterableIterator<Entity> => entities.values(),
    entries: (): IterableIterator<[StableId, Entity]> => entities.entries(),
    size: entities.size,
  });
  return index;
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
  const value = hasOwn(properties, property) ? properties[property] : propertyProvenance[property];
  return isRecord(value) ? value : undefined;
}

function rawPropertyValue(record: RecordValue, property: string): unknown {
  const metadata = rawPropertyMetadata(record, property);
  if (metadata !== undefined) {
    const rawClaim = hasOwn(metadata, "claim") ? metadata.claim : metadata.canonicalClaim;
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
  validateEntityMetadataConsistency(record, entityType, entityId, propertyNames, path, issues);
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

function validateEntityMetadataConsistency(
  record: RecordValue,
  entityType: DomainEntityType,
  entityId: StableId,
  propertyNames: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  const properties = record.properties;
  const propertyProvenance = record.propertyProvenance;
  if (properties !== undefined && !isRecord(properties)) {
    addIssue(
      issues,
      "invalid-provenance",
      `${path}.properties`,
      `${path}.properties must be an object when supplied.`,
      entityType,
      entityId,
      undefined,
    );
  }
  if (propertyProvenance !== undefined && !isRecord(propertyProvenance)) {
    addIssue(
      issues,
      "invalid-provenance",
      `${path}.propertyProvenance`,
      `${path}.propertyProvenance must be an object when supplied.`,
      entityType,
      entityId,
      undefined,
    );
  }
  if (
    isRecord(properties) &&
    isRecord(propertyProvenance) &&
    !deepEqual(properties, propertyProvenance)
  ) {
    addIssue(
      issues,
      "invalid-provenance",
      `${path}.propertyProvenance`,
      `${path}.properties and ${path}.propertyProvenance must be equal when both are supplied.`,
      entityType,
      entityId,
      undefined,
    );
  }

  const metadataProperties = new Set(propertyNames);
  if (isRecord(properties)) {
    for (const property of Object.keys(properties)) {
      metadataProperties.add(property);
    }
  }
  if (isRecord(propertyProvenance)) {
    for (const property of Object.keys(propertyProvenance)) {
      metadataProperties.add(property);
    }
  }
  for (const property of metadataProperties) {
    const propertiesMetadata = isRecord(properties) ? properties[property] : undefined;
    const provenanceMetadata = isRecord(propertyProvenance)
      ? propertyProvenance[property]
      : undefined;
    validatePropertyMetadataAliases(
      propertiesMetadata,
      provenanceMetadata,
      `${path}.properties.${property}`,
      entityType,
      entityId,
      issues,
    );
    if (!hasOwn(record, property)) {
      continue;
    }
    const metadata = rawPropertyMetadata(record, property);
    if (metadata === undefined) {
      continue;
    }
    const selectedValue = rawPropertyValue(record, property);
    const directValue = record[property];
    if (
      selectedValue === undefined ||
      directValue === undefined ||
      deepEqual(selectedValue, directValue)
    ) {
      continue;
    }
    addIssue(
      issues,
      "invalid-provenance",
      `${path}.${property}`,
      `${path}.${property} must agree with its property metadata value.`,
      entityType,
      entityId,
      undefined,
    );
  }
}

function validatePropertyMetadataAliases(
  propertiesMetadata: unknown,
  provenanceMetadata: unknown,
  path: string,
  entityType: DomainEntityType,
  entityId: StableId,
  issues: ValidationIssue[],
): void {
  const records = [propertiesMetadata, provenanceMetadata].filter(isRecord);
  for (const metadata of records) {
    for (const [first, second] of [
      ["claim", "canonicalClaim"],
      ["bounds", "uncertainty"],
    ] as const) {
      if (
        hasOwn(metadata, first) &&
        hasOwn(metadata, second) &&
        !deepEqual(metadata[first], metadata[second])
      ) {
        addIssue(
          issues,
          "invalid-provenance",
          path,
          `${path}.${first} and ${path}.${second} must agree when both are supplied.`,
          entityType,
          entityId,
          undefined,
        );
      }
    }
    const values = ["selectedNominal", "nominal", "value"].filter((key) => hasOwn(metadata, key));
    const firstValue = values[0];
    if (firstValue !== undefined) {
      for (const key of values.slice(1)) {
        if (deepEqual(metadata[firstValue], metadata[key])) {
          continue;
        }
        addIssue(
          issues,
          "invalid-provenance",
          path,
          `${path} value aliases must agree when both are supplied.`,
          entityType,
          entityId,
          undefined,
        );
      }
    }
  }
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
  const overrides = record.overrides;
  const overrideLayers = record.overrideLayers;
  if (
    overrides !== undefined &&
    overrideLayers !== undefined &&
    !deepEqual(overrides, overrideLayers)
  ) {
    addIssue(
      issues,
      "invalid-override",
      "overrides",
      "overrides and overrideLayers must agree when both are supplied.",
      "scenario",
      undefined,
      undefined,
    );
  }
  const rawOverrides = overrides !== undefined ? overrides : overrideLayers;
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
  const seenClaimIds = new Set<string>();
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
    if (seenClaimIds.has(id)) {
      addIssue(
        issues,
        "duplicate-id",
        `${path}.id`,
        `Canonical Claim id ${id} is duplicated.`,
        "scenario",
        id,
        undefined,
      );
      continue;
    }
    seenClaimIds.add(id);
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
 * Returns whether a value was produced by this module's validated Scenario compilation pipeline.
 *
 * The trust marker is module-private and cannot be recreated by matching the CompiledScenario
 * object shape. Persistence uses this predicate to keep untrusted values on its safe snapshot
 * path, including objects that merely resemble compiled Scenarios. Cloned or spread compiled
 * objects intentionally lose the marker and must be revalidated before persistence.
 *
 * @param value - The candidate Scenario value.
 * @returns True only for a Scenario registered by successful compilation or a trusted derivation.
 */
export function isTrustedCompiledScenario(value: unknown): value is CompiledScenario {
  return typeof value === "object" && value !== null && trustedCompiledScenarios.has(value);
}

/**
 * Returns whether a value is an immutable lookup index created for a compiled Scenario.
 *
 * The index contains internal lookup functions and is therefore not part of the raw JSON input
 * graph. Persistence may use an index carrying this private marker only after resolving its exact
 * owning Scenario and proving an exact shallow-copy representation.
 *
 * @param value - The candidate index value.
 * @returns True only for an index created by this module.
 */
export function isTrustedCompiledScenarioIndex(value: unknown): value is CompiledScenarioIndex {
  return (
    typeof value === "object" && value !== null && trustedCompiledScenarioIndexOwners.has(value)
  );
}

/**
 * Resolves a trusted compiled index to the exact Scenario that owns it.
 *
 * The owner binding is module-private and is populated only after a successful compilation or
 * trusted immutable derivation. A trusted index copied from another Scenario therefore cannot
 * authorize a different parent object at the persistence boundary.
 *
 * @param value - The candidate compiled index.
 * @returns The exact owning Scenario, or undefined for an unbound value.
 */
export function getTrustedCompiledScenarioIndexOwner(value: unknown): CompiledScenario | undefined {
  if (!isTrustedCompiledScenarioIndex(value)) {
    return undefined;
  }
  return trustedCompiledScenarioIndexOwners.get(value);
}

function bindTrustedCompiledScenarioIndexOwner(scenario: CompiledScenario): void {
  trustedCompiledScenarioIndexOwners.set(scenario.index, scenario);
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
  const generation = readScenarioGeneration(input, issues);
  const references = compileScenarioReferences(input, issues);
  const journeyInputs = compileScenarioJourneyInputs(input, issues);
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
    generatorVersion: generation?.generatorVersion,
    seed: generation?.seed,
    logicalPopulation: generation?.logicalPopulation,
    generation,
    references,
    journeyInputs,
    savedJourneyInputs: journeyInputs,
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

  trustedCompiledScenarios.add(compiled);
  trustedCompiledScenarios.add(scenarioWithOverrides);
  bindTrustedCompiledScenarioIndexOwner(compiled);
  bindTrustedCompiledScenarioIndexOwner(scenarioWithOverrides);
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
  const cloned = Object.freeze({
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
  if (isTrustedCompiledScenario(scenario)) {
    trustedCompiledScenarios.add(cloned);
    bindTrustedCompiledScenarioIndexOwner(cloned);
  }
  return cloned;
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
 * @param persistence - Optional persistence implementation; the package entrypoint injects the
 * canonical adapter while direct core-module imports fail closed for persistence operations.
 * @returns A Journey Model adapter exposing compilation, generation, inspection, worldline evaluation, simulation, and explicit-network route-planning operations.
 */
export function createJourneyModel(
  persistence: ScenarioPersistenceAdapter = createUnavailableScenarioPersistence(),
): JourneyModel {
  return Object.freeze({
    compileScenario,
    inspectScenario,
    formatScenarioInspection,
    evaluateWorldlines,
    simulateJourney,
    simulateMultiLegJourney,
    simulateInSystemTransfer,
    planJourney,
    planRoute,
    planClusterRoute,
    generateClusterRegion,
    generateHierarchicalCluster,
    materializeClusterRegion,
    applyScenarioOverrides,
    compareScenarioOverrides,
    revertScenarioOverride,
    ...persistence,
  });
}
