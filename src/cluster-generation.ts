import {
  SPEED_OF_LIGHT,
  meters,
  metersPerSecond,
  metersPerSecondSquared,
  seconds,
  vector3,
  type Meters,
  type PositionVector,
  type VelocityVector,
} from "./quantities";
import {
  compileScenario,
  type CompiledGate,
  type CompiledGateConnection,
  type CompiledOrbitalAnchor,
  type CompiledScenario,
  type CompiledSystem,
  type EntityProvenanceInput,
  type GateConnectionInput,
  type GateInput,
  type OrbitalAnchorInput,
  type ScenarioEpoch,
  type ScenarioInput,
  type ShipProfileInput,
  type StableId,
  type SystemInput,
} from "./model";
import {
  generatedProvenance,
  provisionalProvenance,
  type Provenance,
  type PropertyMetadataInput,
} from "./provenance";
import {
  planJourney,
  type RoutePlan,
  type RoutePlanningRequest,
  type RoutePlanningResult,
} from "./route-planning";

/**
 * A seed accepted by the deterministic Cluster generator.
 *
 * Safe-integer seeds use their exact decimal spelling with a `number:` type tag. String seeds
 * use their exact text with a `string:` type tag; leading and trailing whitespace is significant
 * and is not trimmed. This makes numeric `1`, string `"1"`, and string `" 1 "` distinct
 * deterministic inputs.
 */
export type ClusterGenerationSeed = string | number;

/**
 * The finite inputs used to realize one generated Cluster region.
 *
 * `logicalPopulation` (or its `population` alias) describes the chosen logical Cluster
 * population. `materializedSystemCount` bounds the finite region emitted for this operation; it
 * defaults to a small prefix of a large logical population so a ten-million-System claim never
 * becomes an accidental ten-million-object allocation.
 */
export type ClusterGenerationRequest = {
  readonly logicalPopulation?: number | undefined;
  readonly population?: number | undefined;
  readonly seed: ClusterGenerationSeed;
  readonly generatorVersion?: string | undefined;
  readonly materializedSystemCount?: number | undefined;
  readonly regionRadius?: Meters | number | undefined;
  readonly epoch?: ScenarioEpoch | undefined;
  readonly scenarioId?: string | undefined;
  readonly designation?: string | undefined;
  readonly name?: string | undefined;
  readonly canonicalScenario?: ScenarioInput | CompiledScenario | undefined;
  readonly baseScenario?: ScenarioInput | CompiledScenario | undefined;
  readonly shipProfiles?: readonly ShipProfileInput[] | undefined;
  readonly routeRequest?: Readonly<Record<string, unknown>> | undefined;
};

/**
 * The radial statistics reported for a finite generated sample.
 *
 * These are descriptive sample statistics, not a proof that an arbitrarily small sample is a
 * globular cluster. The generator uses a truncated Plummer profile and reports the sample so
 * callers can audit concentration without mistaking it for a universal statistical guarantee.
 */
export type ClusterGenerationStatistics = {
  readonly radialProfile: "truncated-plummer";
  readonly profile: "truncated-plummer";
  readonly sampleCount: number;
  readonly regionRadius: Meters;
  readonly scaleRadius: Meters;
  readonly meanRadius: Meters;
  readonly medianRadius: Meters;
  readonly expectedMeanRadius: Meters;
  readonly fractionWithinHalfRadius: number;
  readonly expectedFractionWithinHalfRadius: number;
  readonly uniformSphereExpectedFractionWithinHalfRadius: number;
  readonly radialConcentrationTolerance: number;
  readonly radialDistances: readonly Meters[];
  readonly statisticalGuarantee: string;
};

/**
 * The finite topology accounting for a generated region.
 */
export type ClusterTopologyStatistics = {
  readonly connectionCount: number;
  readonly backboneConnectionCount: number;
  readonly shortcutConnectionCount: number;
  readonly attachmentConnectionCount: number;
  /** The distance threshold used to classify a geographically local link. */
  readonly localDistanceThreshold: Meters;
  readonly localLinkFraction: number;
  readonly shortcutLinkFraction: number;
  readonly isConnected: boolean;
  readonly backboneConnectionIds: readonly StableId[];
  readonly shortcutConnectionIds: readonly StableId[];
  readonly attachmentConnectionIds: readonly StableId[];
  readonly connectionKinds: Readonly<Record<StableId, "backbone" | "shortcut" | "attachment">>;
};

/**
 * The generated entities and route plan returned by `generateClusterRegion`.
 */
export type GeneratedClusterRegion = {
  readonly kind: "generated-cluster-region";
  readonly ok: true;
  readonly seed: ClusterGenerationSeed;
  readonly seedLabel: string;
  readonly seedIdentity: string;
  readonly seedHash: number;
  readonly generatorVersion: string;
  readonly logicalPopulation: number;
  readonly population: number;
  readonly materializedSystemCount: number;
  readonly regionRadius: Meters;
  readonly scenarioInput: ScenarioInput;
  readonly input: ScenarioInput;
  readonly scenario: CompiledScenario;
  readonly compiledScenario: CompiledScenario;
  readonly generatedSystems: readonly CompiledSystem[];
  readonly generatedOrbitalAnchors: readonly CompiledOrbitalAnchor[];
  readonly generatedGates: readonly CompiledGate[];
  readonly generatedConnections: readonly CompiledGateConnection[];
  readonly generatedSystemIds: readonly StableId[];
  readonly generatedOrbitalAnchorIds: readonly StableId[];
  readonly generatedGateIds: readonly StableId[];
  readonly generatedConnectionIds: readonly StableId[];
  readonly generatedSystemDesignations: readonly string[];
  readonly generatedOrbitalAnchorDesignations: readonly string[];
  readonly generatedGateDesignations: readonly string[];
  readonly generatedConnectionDesignations: readonly string[];
  readonly statistics: ClusterGenerationStatistics;
  readonly topology: ClusterTopologyStatistics;
  readonly routeRequest: RoutePlanningRequest;
  readonly route: RoutePlanningResult;
  readonly plan: RoutePlan | undefined;
  readonly routePlan: RoutePlan | undefined;
  readonly journeyTimeline: RoutePlan["timeline"] | undefined;
  readonly timeline: RoutePlan["timeline"] | undefined;
};

/**
 * The default generator version used when a caller does not provide one.
 */
export const DEFAULT_CLUSTER_GENERATOR_VERSION = "globular-v1";

/**
 * The default number of finite Systems materialized for a large logical population.
 */
export const DEFAULT_CLUSTER_MATERIALIZED_SYSTEM_COUNT = 64;

/**
 * The largest finite region accepted by the CPU reference generator.
 */
export const MAX_CLUSTER_MATERIALIZED_SYSTEM_COUNT = 4096;

/**
 * The default generated-region radius, approximately 52.9 light-years.
 */
export const DEFAULT_CLUSTER_REGION_RADIUS: Meters = meters(5e17);

/**
 * The default finite latest-arrival horizon supplied to the immediate generated route.
 */
export const DEFAULT_CLUSTER_ROUTE_HORIZON = seconds(1e16);

const GRAVITATIONAL_PROFILE_OUTER_SCALE = 0.2;
const SHORTCUT_MINIMUM_SYSTEM_COUNT = 16;
const SHORTCUTS_PER_SYSTEMS = 128;
const SHORTCUT_LONG_DISTANCE_FACTOR = 0.45;
/** Links at or below one quarter of the generated region radius are geographically local. */
const LOCAL_LINK_DISTANCE_FACTOR = 0.25;
const LIGHT_SPEED_FRACTION_FOR_DEFAULT_SHIP = 0.2;
const ZERO_VELOCITY: VelocityVector = vector3(
  metersPerSecond(0),
  metersPerSecond(0),
  metersPerSecond(0),
);
const ORIGIN: PositionVector = vector3(meters(0), meters(0), meters(0));
const stableIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type RecordValue = Record<string, unknown>;
type ScenarioEntity = RecordValue & EntityProvenanceInput;
type GeneratedConnectionKind = "backbone" | "shortcut" | "attachment";

type GeneratorContext = {
  readonly seed: ClusterGenerationSeed;
  readonly seedLabel: string;
  readonly seedIdentity: string;
  readonly seedHash: number;
  readonly generatorVersion: string;
  readonly versionToken: string;
  readonly seedToken: string;
  readonly logicalPopulation: number;
  readonly materializedSystemCount: number;
  readonly regionRadius: Meters;
  readonly scaleRadius: Meters;
  readonly generatedProvenance: Provenance;
  readonly provisionalProfileProvenance: Provenance;
};

type GeneratedPoint = {
  readonly index: number;
  readonly id: StableId;
  readonly position: PositionVector;
};

type GeneratedEdge = {
  readonly a: number;
  readonly b: number;
  readonly distance: number;
  readonly kind: Exclude<GeneratedConnectionKind, "attachment">;
};

type GeneratedRecords = {
  readonly systems: readonly ScenarioEntity[];
  readonly orbitalAnchors: readonly ScenarioEntity[];
  readonly gates: readonly ScenarioEntity[];
  readonly connections: readonly ScenarioEntity[];
  readonly generatedSystemIds: readonly StableId[];
  readonly generatedOrbitalAnchorIds: readonly StableId[];
  readonly generatedGateIds: readonly StableId[];
  readonly generatedConnectionIds: readonly StableId[];
  readonly generatedSystemDesignations: readonly string[];
  readonly generatedOrbitalAnchorDesignations: readonly string[];
  readonly generatedGateDesignations: readonly string[];
  readonly generatedConnectionDesignations: readonly string[];
  readonly gateIdsBySystem: ReadonlyMap<StableId, readonly StableId[]>;
  readonly routeDepartureGateId: StableId;
  readonly routeDestinationGateId: StableId;
  readonly connectionKinds: Readonly<Record<StableId, GeneratedConnectionKind>>;
  readonly backboneConnectionIds: readonly StableId[];
  readonly shortcutConnectionIds: readonly StableId[];
  readonly attachmentConnectionIds: readonly StableId[];
};

type NormalizedBase = {
  readonly id: string | undefined;
  readonly designation: string | undefined;
  readonly name: string | undefined;
  readonly epoch: ScenarioEpoch | undefined;
  readonly systems: readonly ScenarioEntity[];
  readonly orbitalAnchors: readonly ScenarioEntity[];
  readonly gates: readonly ScenarioEntity[];
  readonly connections: readonly ScenarioEntity[];
  readonly shipProfiles: readonly ScenarioEntity[];
  readonly canonicalClaims: readonly unknown[] | undefined;
  readonly overrides: readonly unknown[] | undefined;
  readonly properties: RecordValue;
  readonly canonicalIdentity: unknown;
  readonly provenance: unknown;
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: RecordValue, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stableIdentifier(value: unknown): value is string {
  return typeof value === "string" && stableIdentifierPattern.test(value);
}

function cloneRecord(value: unknown): RecordValue {
  return isRecord(value) ? { ...value } : {};
}

function cloneRecords(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.map((candidate) => cloneRecord(candidate)) : [];
}

function freezeRecords<T extends RecordValue>(values: readonly T[]): readonly T[] {
  return Object.freeze(values.map((value) => Object.freeze({ ...value })));
}

function hashString(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** A browser-compatible 128-bit deterministic digest for identity tokens. */
function digestString(value: string): string {
  const hashes = [2_166_136_261, 2_654_435_761, 2_246_822_519, 3_664_284_191];
  const primes = [16_777_619, 22_468_252, 32_416_190, 18_020_873];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    for (let lane = 0; lane < hashes.length; lane += 1) {
      const hash = hashes[lane];
      const prime = primes[lane];
      if (hash === undefined || prime === undefined) {
        continue;
      }
      hashes[lane] = Math.imul(hash ^ code, prime) >>> 0;
    }
  }
  return hashes.map((hash) => hash.toString(16).padStart(8, "0")).join("");
}

function hashParts(...parts: readonly (string | number)[]): number {
  return hashString(parts.map((part) => String(part)).join("\u0000"));
}

function unitRandom(...parts: readonly (string | number)[]): number {
  return (hashParts(...parts) + 0.5) / 4_294_967_296;
}

function compactToken(value: string, digestLength = 32): string {
  const readable = value.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "value";
  return `${readable}-${digestString(value).slice(0, digestLength)}`;
}

type ReadSeedResult = {
  readonly label: string;
  readonly identity: string;
  readonly hash: number;
};

function readSeed(value: ClusterGenerationSeed): ReadSeedResult {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError("Cluster generation seed numbers must be safe integers.");
    }
    const label = String(value);
    const identity = `number:${label}`;
    return { label, identity, hash: hashString(identity) };
  }
  if (!nonEmptyString(value)) {
    throw new RangeError("Cluster generation seed must be a non-empty string or safe integer.");
  }
  const identity = `string:${value.length}:${value}`;
  return { label: value, identity, hash: hashString(identity) };
}

function readPopulation(request: ClusterGenerationRequest): number {
  if (request.logicalPopulation !== undefined && request.population !== undefined) {
    if (request.logicalPopulation !== request.population) {
      throw new RangeError("logicalPopulation and population must agree when both are supplied.");
    }
  }
  const population = request.logicalPopulation ?? request.population;
  if (population === undefined || !Number.isSafeInteger(population) || population < 2) {
    throw new RangeError("Cluster logical population must be an integer of at least two Systems.");
  }
  return population;
}

function readMaterializedSystemCount(
  request: ClusterGenerationRequest,
  population: number,
): number {
  const defaultCount = Math.min(population, DEFAULT_CLUSTER_MATERIALIZED_SYSTEM_COUNT);
  const count = request.materializedSystemCount ?? defaultCount;
  if (!Number.isSafeInteger(count) || count < 2 || count > MAX_CLUSTER_MATERIALIZED_SYSTEM_COUNT) {
    throw new RangeError(
      `materializedSystemCount must be an integer from 2 through ${MAX_CLUSTER_MATERIALIZED_SYSTEM_COUNT}.`,
    );
  }
  if (count > population) {
    throw new RangeError(
      `materializedSystemCount (${count}) cannot exceed logicalPopulation (${population}).`,
    );
  }
  return count;
}

function readRegionRadius(value: Meters | number | undefined): Meters {
  if (value === undefined) {
    return DEFAULT_CLUSTER_REGION_RADIUS;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError("Cluster regionRadius must be a positive finite metre value.");
    }
    return meters(value);
  }
  if (value.unit !== "m" || !Number.isFinite(value.value) || value.value <= 0) {
    throw new RangeError("Cluster regionRadius must be a positive metre quantity.");
  }
  return meters(value.value);
}

function readGeneratorVersion(value: string | undefined): string {
  const version = value ?? DEFAULT_CLUSTER_GENERATOR_VERSION;
  if (!nonEmptyString(version)) {
    throw new RangeError("Cluster generatorVersion must be a non-empty string.");
  }
  return version.trim();
}

function readEpoch(value: unknown): ScenarioEpoch | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const label = value.label;
  const coordinateTime = value.coordinateTime;
  if (
    !nonEmptyString(label) ||
    !isRecord(coordinateTime) ||
    coordinateTime.unit !== "s" ||
    typeof coordinateTime.value !== "number" ||
    !Number.isFinite(coordinateTime.value)
  ) {
    throw new RangeError("Cluster epoch must contain a non-empty label and finite seconds.");
  }
  return Object.freeze({ label, coordinateTime: seconds(coordinateTime.value) });
}

function positionDistance(left: PositionVector, right: PositionVector): number {
  return Math.hypot(
    left.x.value - right.x.value,
    left.y.value - right.y.value,
    left.z.value - right.z.value,
  );
}

function positionValue(value: unknown): PositionVector | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    !isRecord(value.x) ||
    !isRecord(value.y) ||
    !isRecord(value.z) ||
    value.x.unit !== "m" ||
    value.y.unit !== "m" ||
    value.z.unit !== "m" ||
    typeof value.x.value !== "number" ||
    typeof value.y.value !== "number" ||
    typeof value.z.value !== "number" ||
    !Number.isFinite(value.x.value) ||
    !Number.isFinite(value.y.value) ||
    !Number.isFinite(value.z.value)
  ) {
    return undefined;
  }
  return value as unknown as PositionVector;
}

function positionWithOffset(
  position: PositionVector,
  offset: readonly [number, number, number],
): PositionVector {
  return vector3(
    meters(position.x.value + offset[0]),
    meters(position.y.value + offset[1]),
    meters(position.z.value + offset[2]),
  );
}

function fallbackPosition(context: GeneratorContext, key: string): PositionVector {
  return generatedPosition(context, key);
}

function generatedPosition(context: GeneratorContext, key: string): PositionVector {
  const maximumDimensionlessRadius = 1 / GRAVITATIONAL_PROFILE_OUTER_SCALE;
  const maximumProfileCdf =
    maximumDimensionlessRadius ** 3 / (1 + maximumDimensionlessRadius ** 2) ** 1.5;
  const radialSample = Math.min(
    maximumProfileCdf * (1 - Number.EPSILON),
    Math.max(
      Number.EPSILON,
      unitRandom(context.seedIdentity, context.generatorVersion, key, "radius") * maximumProfileCdf,
    ),
  );
  const cdfPower = radialSample ** (2 / 3);
  const dimensionlessRadius = Math.sqrt(cdfPower / Math.max(Number.EPSILON, 1 - cdfPower));
  const radius = Math.min(
    context.regionRadius.value,
    context.scaleRadius.value * dimensionlessRadius,
  );
  const cosine = 2 * unitRandom(context.seedIdentity, context.generatorVersion, key, "cosine") - 1;
  const azimuth =
    2 * Math.PI * unitRandom(context.seedIdentity, context.generatorVersion, key, "azimuth");
  const sine = Math.sqrt(Math.max(0, 1 - cosine ** 2));
  return vector3(
    meters(radius * sine * Math.cos(azimuth)),
    meters(radius * sine * Math.sin(azimuth)),
    meters(radius * cosine),
  );
}

function metadataRecord(record: RecordValue): RecordValue {
  return isRecord(record.properties) ? record.properties : {};
}

function metadataClaimValue(value: unknown): unknown {
  if (!isRecord(value)) {
    return undefined;
  }
  const claim = value.claim ?? value.canonicalClaim;
  if (isRecord(claim)) {
    if (claim.kind === "exact" && hasOwn(claim, "value")) {
      return claim.value;
    }
    if (claim.kind === "range") {
      return claim.nominal ?? claim.lower;
    }
  }
  return value.value ?? value.nominal;
}

function propertyValue(record: RecordValue, property: string): unknown {
  if (record[property] !== undefined) {
    return record[property];
  }
  return metadataClaimValue(metadataRecord(record)[property]);
}

function withGeneratedFallback(
  record: RecordValue,
  property: string,
  fallback: unknown,
  provenance: Provenance,
): RecordValue {
  if (record[property] !== undefined || propertyValue(record, property) !== undefined) {
    return record;
  }
  const properties = metadataRecord(record);
  return {
    ...record,
    [property]: fallback,
    properties: {
      ...properties,
      [property]: {
        ...(isRecord(properties[property]) ? properties[property] : {}),
        value: fallback,
        provenance,
      } satisfies PropertyMetadataInput<unknown>,
    },
  };
}

function propertyMetadata(
  names: readonly string[],
  provenance: Provenance,
): Readonly<Record<string, PropertyMetadataInput<unknown>>> {
  return Object.freeze(
    Object.fromEntries(names.map((name) => [name, Object.freeze({ provenance })])) as Record<
      string,
      PropertyMetadataInput<unknown>
    >,
  );
}

function generatedEntityMetadata(
  id: StableId,
  designation: string,
  name: string,
  provenance: Provenance,
  properties: readonly string[],
): EntityProvenanceInput {
  const identity = Object.freeze({ id, designation, name, provenance });
  const metadata = propertyMetadata(properties, provenance);
  return Object.freeze({
    canonicalIdentity: identity,
    provenance,
    properties: metadata,
    propertyProvenance: metadata,
  });
}

function provisionalEntityMetadata(
  provenance: Provenance,
  properties: readonly string[],
): EntityProvenanceInput {
  const metadata = propertyMetadata(properties, provenance);
  return Object.freeze({
    provenance,
    properties: metadata,
    propertyProvenance: metadata,
  });
}

function systemDesignation(context: GeneratorContext, index: number): string {
  return `GEN-${context.seedToken}-${String(index).padStart(4, "0")}`;
}

function generatedSystemId(context: GeneratorContext, index: number): StableId {
  return `system:generated:${context.versionToken}:${context.seedToken}:${String(index).padStart(4, "0")}` as StableId;
}

function generatedAnchorId(context: GeneratorContext, index: number): StableId {
  return `anchor:generated:${context.versionToken}:${context.seedToken}:${String(index).padStart(4, "0")}` as StableId;
}

function generatedGateId(
  context: GeneratorContext,
  edgeIndex: number,
  endpoint: "a" | "b",
): StableId {
  return `gate:generated:${context.versionToken}:${context.seedToken}:${String(edgeIndex).padStart(4, "0")}:${endpoint}` as StableId;
}

function generatedConnectionId(context: GeneratorContext, edgeIndex: number): StableId {
  return `connection:generated:${context.versionToken}:${context.seedToken}:${String(edgeIndex).padStart(4, "0")}` as StableId;
}

function attachmentToken(context: GeneratorContext, index: number, sourceGateId: string): string {
  return compactToken(
    `${context.seedIdentity}\u0000${context.generatorVersion}\u0000${index}\u0000${sourceGateId}`,
  );
}

function generatedAttachmentGateId(
  context: GeneratorContext,
  index: number,
  sourceGateId: string,
): StableId {
  return `gate:generated-attachment:${attachmentToken(context, index, sourceGateId)}` as StableId;
}

function generatedAttachmentConnectionId(
  context: GeneratorContext,
  index: number,
  sourceGateId: string,
): StableId {
  return `connection:generated-attachment:${attachmentToken(context, index, sourceGateId)}` as StableId;
}

function buildContext(request: ClusterGenerationRequest): GeneratorContext {
  const population = readPopulation(request);
  const materializedSystemCount = readMaterializedSystemCount(request, population);
  const seed = readSeed(request.seed);
  const generatorVersion = readGeneratorVersion(request.generatorVersion);
  const regionRadius = readRegionRadius(request.regionRadius);
  const scaleRadius = meters(regionRadius.value * GRAVITATIONAL_PROFILE_OUTER_SCALE);
  const versionToken = compactToken(generatorVersion);
  const seedToken = compactToken(seed.identity);
  return Object.freeze({
    seed: request.seed,
    seedLabel: seed.label,
    seedIdentity: seed.identity,
    seedHash: seed.hash,
    generatorVersion,
    versionToken,
    seedToken,
    logicalPopulation: population,
    materializedSystemCount,
    regionRadius,
    scaleRadius,
    generatedProvenance: generatedProvenance(
      `centauri-cluster-generator@${generatorVersion}/${seed.identity}`,
    ),
    provisionalProfileProvenance: provisionalProvenance(
      "A 1g ship profile is used because this Scenario supplied no canonical Ship Profile.",
    ),
  });
}

function sourceScenarioRecord(value: ScenarioInput | CompiledScenario | undefined): RecordValue {
  if (!isRecord(value)) {
    return {};
  }
  return {
    id: value.id,
    designation: value.designation,
    name: value.name,
    epoch: value.epoch,
    systems: cloneRecords(value.systems),
    orbitalAnchors: cloneRecords(value.orbitalAnchors),
    gates: cloneRecords(value.gates),
    gateConnections: cloneRecords(value.gateConnections),
    shipProfiles: cloneRecords(value.shipProfiles),
    canonicalClaims: Array.isArray(value.canonicalClaims) ? [...value.canonicalClaims] : undefined,
    overrides:
      Array.isArray(value.overrides) && !hasOwn(value, "index") ? [...value.overrides] : undefined,
    properties: cloneRecord(value.properties),
    propertyProvenance: cloneRecord(value.propertyProvenance),
    canonicalIdentity: value.canonicalIdentity,
    provenance: value.provenance,
  };
}

function fallbackId(prefix: string, context: GeneratorContext, index: number): StableId {
  return `${prefix}:canonical:${context.seedToken}:${String(index).padStart(4, "0")}` as StableId;
}

function fallbackName(prefix: string, id: string): string {
  return `${prefix} ${id}`;
}

function normalizeBaseScenario(
  value: ScenarioInput | CompiledScenario | undefined,
  context: GeneratorContext,
): NormalizedBase {
  const source = sourceScenarioRecord(value);
  const sourceSystems = cloneRecords(source.systems);
  const sourceAnchors = cloneRecords(source.orbitalAnchors);
  const sourceGates = cloneRecords(source.gates);
  const sourceConnections = cloneRecords(source.gateConnections);
  const sourceProfiles = cloneRecords(source.shipProfiles);
  const systems: ScenarioEntity[] = [];
  const systemIds = new Set<StableId>();

  for (const [index, raw] of sourceSystems.entries()) {
    const rawId = raw.id;
    const id = stableIdentifier(rawId) ? (rawId as StableId) : fallbackId("system", context, index);
    const designationValue = propertyValue(raw, "designation");
    const nameValue = propertyValue(raw, "name");
    const positionValue = propertyValue(raw, "positionAtEpoch");
    let normalized: RecordValue = {
      ...raw,
      id,
      designation: nonEmptyString(designationValue)
        ? designationValue
        : `CAN-${context.seedToken}-${String(index).padStart(4, "0")}`,
      name: nonEmptyString(nameValue) ? nameValue : fallbackName("Canonical System", id),
    };
    normalized = withGeneratedFallback(
      normalized,
      "positionAtEpoch",
      positionValue ?? fallbackPosition(context, `canonical-system:${id}`),
      context.generatedProvenance,
    );
    normalized = withGeneratedFallback(
      normalized,
      "velocityAtEpoch",
      ZERO_VELOCITY,
      context.generatedProvenance,
    );
    systems.push(normalized);
    systemIds.add(id);
  }

  const systemById = new Map(systems.map((system) => [system.id as StableId, system]));
  const anchors: ScenarioEntity[] = [];
  const anchorIdsBySystem = new Map<StableId, StableId[]>();
  for (const [index, raw] of sourceAnchors.entries()) {
    const rawId = raw.id;
    const id = stableIdentifier(rawId) ? (rawId as StableId) : fallbackId("anchor", context, index);
    const fallbackSystemId = [...systemIds][0];
    const rawSystemId = propertyValue(raw, "systemId");
    const hasValidSystemReference =
      stableIdentifier(rawSystemId) && systemIds.has(rawSystemId as StableId);
    if (rawSystemId !== undefined && !hasValidSystemReference) {
      throw new RangeError(
        `Canonical Orbital Anchor "${String(rawId ?? id)}" references unknown System "${String(rawSystemId)}".`,
      );
    }
    const systemId = hasValidSystemReference ? (rawSystemId as StableId) : fallbackSystemId;
    if (systemId === undefined) {
      continue;
    }
    const system = systemById.get(systemId);
    const designationValue = propertyValue(raw, "designation");
    const nameValue = propertyValue(raw, "name");
    const systemPosition =
      system === undefined ? ORIGIN : (propertyValue(system, "positionAtEpoch") as PositionVector);
    let normalized: RecordValue = {
      ...raw,
      id,
      designation: nonEmptyString(designationValue)
        ? designationValue
        : `CAN-${context.seedToken}-${String(index).padStart(4, "0")}-A`,
      name: nonEmptyString(nameValue) ? nameValue : fallbackName("Canonical Anchor", id),
      kind:
        raw.kind === "star" ||
        raw.kind === "planet" ||
        raw.kind === "moon" ||
        raw.kind === "barycenter"
          ? raw.kind
          : "star",
      systemId,
      parentId: propertyValue(raw, "parentId"),
    };
    normalized = withGeneratedFallback(
      normalized,
      "positionAtEpoch",
      positionValueOr(system, "positionAtEpoch", systemPosition),
      context.generatedProvenance,
    );
    normalized = withGeneratedFallback(
      normalized,
      "velocityAtEpoch",
      positionValueOr(system, "velocityAtEpoch", ZERO_VELOCITY),
      context.generatedProvenance,
    );
    anchors.push(normalized);
    const existing = anchorIdsBySystem.get(systemId);
    if (existing === undefined) {
      anchorIdsBySystem.set(systemId, [id]);
    } else {
      existing.push(id);
    }
  }

  const gates: ScenarioEntity[] = [];
  for (const [index, raw] of sourceGates.entries()) {
    const rawId = raw.id;
    const id = stableIdentifier(rawId) ? (rawId as StableId) : fallbackId("gate", context, index);
    const fallbackSystemId = [...systemIds][0];
    const rawSystemId = propertyValue(raw, "systemId");
    const hasValidSystemReference =
      stableIdentifier(rawSystemId) && systemIds.has(rawSystemId as StableId);
    if (rawSystemId !== undefined && !hasValidSystemReference) {
      throw new RangeError(
        `Canonical Gate "${String(rawId ?? id)}" references unknown System "${String(rawSystemId)}".`,
      );
    }
    const systemId = hasValidSystemReference ? (rawSystemId as StableId) : fallbackSystemId;
    if (systemId === undefined) {
      continue;
    }
    const rawAnchorId = propertyValue(raw, "orbitalAnchorId");
    let anchorIds = anchorIdsBySystem.get(systemId);
    if (
      rawAnchorId !== undefined &&
      (!stableIdentifier(rawAnchorId) ||
        anchorIds === undefined ||
        !anchorIds.includes(rawAnchorId as StableId))
    ) {
      throw new RangeError(
        `Canonical Gate "${String(rawId ?? id)}" references unknown Orbital Anchor "${String(rawAnchorId)}" in System "${systemId}".`,
      );
    }
    if (anchorIds === undefined || anchorIds.length === 0) {
      const anchorId = fallbackId("anchor", context, anchors.length);
      const system = systemById.get(systemId);
      const anchorPosition = positionValueOr(system, "positionAtEpoch", ORIGIN) as PositionVector;
      const anchor: ScenarioEntity = {
        id: anchorId,
        designation: `CAN-${context.seedToken}-${String(anchors.length).padStart(4, "0")}-A`,
        name: fallbackName("Generated Canonical Anchor", anchorId),
        kind: "star",
        systemId,
        parentId: undefined,
        positionAtEpoch: anchorPosition,
        velocityAtEpoch: positionValueOr(system, "velocityAtEpoch", ZERO_VELOCITY),
        orbitalElements: undefined,
        ...provisionalEntityMetadata(context.generatedProvenance, [
          "designation",
          "name",
          "kind",
          "systemId",
          "parentId",
          "positionAtEpoch",
          "velocityAtEpoch",
          "orbitalElements",
        ]),
      };
      anchors.push(anchor);
      anchorIds = [anchorId];
      anchorIdsBySystem.set(systemId, anchorIds);
    }
    const anchorId = rawAnchorId === undefined ? anchorIds[0] : (rawAnchorId as StableId);
    if (anchorId === undefined) {
      continue;
    }
    const anchor = anchors.find((candidate) => candidate.id === anchorId);
    const designationValue = propertyValue(raw, "designation");
    const nameValue = propertyValue(raw, "name");
    let normalized: RecordValue = {
      ...raw,
      id,
      designation: nonEmptyString(designationValue)
        ? designationValue
        : `CAN-${context.seedToken}-${String(index).padStart(4, "0")}-G`,
      name: nonEmptyString(nameValue) ? nameValue : fallbackName("Canonical Gate", id),
      systemId,
      orbitalAnchorId: anchorId,
    };
    normalized = withGeneratedFallback(
      normalized,
      "positionAtEpoch",
      positionValueOr(
        anchor,
        "positionAtEpoch",
        positionValueOr(systemById.get(systemId), "positionAtEpoch", ORIGIN),
      ),
      context.generatedProvenance,
    );
    normalized = withGeneratedFallback(
      normalized,
      "velocityAtEpoch",
      positionValueOr(anchor, "velocityAtEpoch", ZERO_VELOCITY),
      context.generatedProvenance,
    );
    gates.push(normalized);
  }

  const connections: ScenarioEntity[] = [];
  for (const [index, raw] of sourceConnections.entries()) {
    const rawId = raw.id;
    const id = stableIdentifier(rawId)
      ? (rawId as StableId)
      : fallbackId("connection", context, index);
    connections.push({
      ...raw,
      id,
      designation: nonEmptyString(propertyValue(raw, "designation"))
        ? propertyValue(raw, "designation")
        : `CAN-${context.seedToken}-${String(index).padStart(4, "0")}-L`,
      name: nonEmptyString(propertyValue(raw, "name"))
        ? propertyValue(raw, "name")
        : fallbackName("Canonical Gate Link", id),
    });
  }

  const profiles: ScenarioEntity[] = [];
  for (const [index, raw] of sourceProfiles.entries()) {
    const rawId = raw.id;
    const id = stableIdentifier(rawId) ? (rawId as StableId) : fallbackId("ship", context, index);
    let normalized: RecordValue = {
      ...raw,
      id,
      designation: nonEmptyString(propertyValue(raw, "designation"))
        ? propertyValue(raw, "designation")
        : `SHIP-CAN-${String(index).padStart(3, "0")}`,
      name: nonEmptyString(propertyValue(raw, "name"))
        ? propertyValue(raw, "name")
        : fallbackName("Canonical Ship", id),
    };
    normalized = withGeneratedFallback(
      normalized,
      "acceleration",
      metersPerSecondSquared(9.80665),
      context.provisionalProfileProvenance,
    );
    normalized = withGeneratedFallback(
      normalized,
      "brakingAcceleration",
      metersPerSecondSquared(9.80665),
      context.provisionalProfileProvenance,
    );
    normalized = withGeneratedFallback(
      normalized,
      "maximumSublightSpeed",
      metersPerSecond(LIGHT_SPEED_FRACTION_FOR_DEFAULT_SHIP * SPEED_OF_LIGHT.value),
      context.provisionalProfileProvenance,
    );
    normalized = withGeneratedFallback(
      normalized,
      "hasZpzGenerator",
      true,
      context.provisionalProfileProvenance,
    );
    profiles.push(normalized);
  }

  const epoch = readEpoch(source.epoch);
  return Object.freeze({
    id: typeof source.id === "string" ? source.id : undefined,
    designation: nonEmptyString(source.designation) ? source.designation : undefined,
    name: nonEmptyString(source.name) ? source.name : undefined,
    epoch,
    systems: freezeRecords(systems),
    orbitalAnchors: freezeRecords(anchors),
    gates: freezeRecords(gates),
    connections: freezeRecords(connections),
    shipProfiles: freezeRecords(profiles),
    canonicalClaims: Array.isArray(source.canonicalClaims)
      ? Object.freeze([...source.canonicalClaims])
      : undefined,
    overrides: Array.isArray(source.overrides) ? Object.freeze([...source.overrides]) : undefined,
    properties: cloneRecord(source.properties),
    canonicalIdentity: source.canonicalIdentity,
    provenance: source.provenance,
  });
}

function positionValueOr(
  record: RecordValue | undefined,
  property: string,
  fallback: unknown,
): unknown {
  return record === undefined ? fallback : (propertyValue(record, property) ?? fallback);
}

function addEdgeKey(a: number, b: number): string {
  return `${Math.min(a, b)}:${Math.max(a, b)}`;
}

/** Prim's algorithm with one cached nearest connected candidate per unconnected point. */
function buildBackbone(points: readonly GeneratedPoint[]): readonly GeneratedEdge[] {
  const connected = new Uint8Array(points.length);
  const nearestConnected = new Int32Array(points.length);
  const nearestDistance = new Float64Array(points.length);
  nearestConnected.fill(-1);
  nearestDistance.fill(Number.POSITIVE_INFINITY);
  connected[0] = 1;

  const origin = points[0];
  if (origin === undefined) {
    throw new RangeError("The generated point set could not produce a connectivity backbone.");
  }
  for (let candidate = 1; candidate < points.length; candidate += 1) {
    const point = points[candidate];
    if (point === undefined) {
      continue;
    }
    nearestConnected[candidate] = 0;
    nearestDistance[candidate] = positionDistance(origin.position, point.position);
  }

  const edges: GeneratedEdge[] = [];
  for (let step = 1; step < points.length; step += 1) {
    let bestCandidate = -1;
    let bestSource = Number.POSITIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let candidate = 1; candidate < points.length; candidate += 1) {
      if (connected[candidate] !== 0) {
        continue;
      }
      const source = nearestConnected[candidate] ?? -1;
      const distance = nearestDistance[candidate] ?? Number.POSITIVE_INFINITY;
      if (
        bestCandidate === -1 ||
        distance < bestDistance ||
        (distance === bestDistance &&
          (source < bestSource || (source === bestSource && candidate < bestCandidate)))
      ) {
        bestCandidate = candidate;
        bestSource = source;
        bestDistance = distance;
      }
    }
    const destination = points[bestCandidate];
    const source = points[bestSource];
    if (bestCandidate < 0 || destination === undefined || source === undefined) {
      throw new RangeError("The generated point set could not produce a connectivity backbone.");
    }
    connected[bestCandidate] = 1;
    edges.push({ a: bestSource, b: bestCandidate, distance: bestDistance, kind: "backbone" });

    for (let candidate = 1; candidate < points.length; candidate += 1) {
      if (connected[candidate] !== 0) {
        continue;
      }
      const point = points[candidate];
      if (point === undefined) {
        continue;
      }
      const distance = positionDistance(destination.position, point.position);
      const currentDistance = nearestDistance[candidate] ?? Number.POSITIVE_INFINITY;
      const currentSource = nearestConnected[candidate] ?? Number.POSITIVE_INFINITY;
      if (
        distance < currentDistance ||
        (distance === currentDistance && bestCandidate < currentSource)
      ) {
        nearestDistance[candidate] = distance;
        nearestConnected[candidate] = bestCandidate;
      }
    }
  }
  return Object.freeze(edges);
}

type ShortcutCandidate = {
  readonly a: number;
  readonly b: number;
  readonly distance: number;
  readonly score: number;
};

type FallbackShortcutCandidate = Omit<ShortcutCandidate, "score">;

function keepBestBounded<T>(
  candidates: T[],
  candidate: T,
  limit: number,
  compare: (left: T, right: T) => number,
): void {
  let insertionIndex = 0;
  while (
    insertionIndex < candidates.length &&
    compare(candidates[insertionIndex] as T, candidate) <= 0
  ) {
    insertionIndex += 1;
  }
  if (insertionIndex >= limit && candidates.length >= limit) {
    return;
  }
  candidates.splice(insertionIndex, 0, candidate);
  if (candidates.length > limit) {
    candidates.pop();
  }
}

function compareShortcutCandidates(left: ShortcutCandidate, right: ShortcutCandidate): number {
  return (
    right.score - left.score ||
    right.distance - left.distance ||
    left.a - right.a ||
    left.b - right.b
  );
}

function compareFallbackCandidates(
  left: FallbackShortcutCandidate,
  right: FallbackShortcutCandidate,
): number {
  return right.distance - left.distance || left.a - right.a || left.b - right.b;
}

/** Scan all pairs but retain only the bounded best long-distance/fallback candidates. */
function buildShortcuts(
  context: GeneratorContext,
  points: readonly GeneratedPoint[],
  backbone: readonly GeneratedEdge[],
): readonly GeneratedEdge[] {
  if (points.length < SHORTCUT_MINIMUM_SYSTEM_COUNT) {
    return Object.freeze([]);
  }
  const desired = Math.max(1, Math.floor(points.length / SHORTCUTS_PER_SYSTEMS));
  const used = new Set(backbone.map((edge) => addEdgeKey(edge.a, edge.b)));
  const candidates: ShortcutCandidate[] = [];
  const fallbackCandidates: FallbackShortcutCandidate[] = [];
  const longDistanceThreshold = context.regionRadius.value * SHORTCUT_LONG_DISTANCE_FACTOR;
  for (let a = 0; a < points.length; a += 1) {
    const source = points[a];
    if (source === undefined) {
      continue;
    }
    for (let b = a + 1; b < points.length; b += 1) {
      const key = addEdgeKey(a, b);
      if (used.has(key)) {
        continue;
      }
      const destination = points[b];
      if (destination === undefined) {
        continue;
      }
      const distance = positionDistance(source.position, destination.position);
      const fallbackCandidate = { a, b, distance };
      keepBestBounded(fallbackCandidates, fallbackCandidate, desired, compareFallbackCandidates);
      if (distance >= longDistanceThreshold) {
        keepBestBounded(
          candidates,
          {
            ...fallbackCandidate,
            score: hashParts(context.seedIdentity, context.generatorVersion, "shortcut", a, b),
          },
          desired,
          compareShortcutCandidates,
        );
      }
    }
  }

  const selected: GeneratedEdge[] = [];
  for (const candidate of candidates) {
    if (selected.length >= desired) {
      break;
    }
    const key = addEdgeKey(candidate.a, candidate.b);
    if (used.has(key)) {
      continue;
    }
    used.add(key);
    selected.push({ ...candidate, kind: "shortcut" });
  }
  for (const candidate of fallbackCandidates) {
    if (selected.length >= desired) {
      break;
    }
    const key = addEdgeKey(candidate.a, candidate.b);
    if (used.has(key)) {
      continue;
    }
    used.add(key);
    selected.push({ ...candidate, kind: "shortcut" });
  }
  return Object.freeze(selected);
}

function gateOffset(
  context: GeneratorContext,
  edgeIndex: number,
  endpoint: "a" | "b",
): readonly [number, number, number] {
  const radius =
    1e10 +
    unitRandom(context.seedIdentity, context.generatorVersion, "gate-offset", edgeIndex, endpoint) *
      1e10;
  const azimuth =
    2 *
    Math.PI *
    unitRandom(context.seedIdentity, context.generatorVersion, "gate-azimuth", edgeIndex, endpoint);
  const cosine =
    2 *
      unitRandom(
        context.seedIdentity,
        context.generatorVersion,
        "gate-cosine",
        edgeIndex,
        endpoint,
      ) -
    1;
  const sine = Math.sqrt(Math.max(0, 1 - cosine ** 2));
  return [radius * sine * Math.cos(azimuth), radius * sine * Math.sin(azimuth), radius * cosine];
}

function createGeneratedRecords(
  context: GeneratorContext,
  points: readonly GeneratedPoint[],
  edges: readonly GeneratedEdge[],
): GeneratedRecords {
  const systems: ScenarioEntity[] = [];
  const orbitalAnchors: ScenarioEntity[] = [];
  for (const point of points) {
    const systemId = point.id;
    const designation = systemDesignation(context, point.index);
    const name = `Generated System ${designation}`;
    const systemProperties = ["designation", "name", "positionAtEpoch", "velocityAtEpoch"] as const;
    systems.push({
      id: systemId,
      designation,
      name,
      positionAtEpoch: point.position,
      velocityAtEpoch: ZERO_VELOCITY,
      ...generatedEntityMetadata(
        systemId,
        designation,
        name,
        context.generatedProvenance,
        systemProperties,
      ),
    });
    const anchorId = generatedAnchorId(context, point.index);
    const anchorDesignation = anchorDesignationFor(context, point.index);
    const anchorName = `${name} Primary`;
    orbitalAnchors.push({
      id: anchorId,
      designation: anchorDesignation,
      name: anchorName,
      kind: "star",
      systemId,
      parentId: undefined,
      positionAtEpoch: point.position,
      velocityAtEpoch: ZERO_VELOCITY,
      orbitalElements: undefined,
      ...generatedEntityMetadata(
        anchorId,
        anchorDesignation,
        anchorName,
        context.generatedProvenance,
        [
          "designation",
          "name",
          "kind",
          "systemId",
          "parentId",
          "positionAtEpoch",
          "velocityAtEpoch",
          "orbitalElements",
        ],
      ),
    });
  }

  const gates: ScenarioEntity[] = [];
  const connections: ScenarioEntity[] = [];
  const gateIdsBySystemMutable = new Map<StableId, StableId[]>();
  const connectionKinds: Record<StableId, GeneratedConnectionKind> = {};
  const generatedSystemIds = points.map((point) => point.id);
  const generatedOrbitalAnchorIds = points.map((point) => generatedAnchorId(context, point.index));
  const generatedGateIds: StableId[] = [];
  const generatedConnectionIds: StableId[] = [];
  const generatedGateDesignations: string[] = [];
  const generatedConnectionDesignations: string[] = [];
  const backboneConnectionIds: StableId[] = [];
  const shortcutConnectionIds: StableId[] = [];
  const sortedEdges = [...edges].sort(
    (left, right) => left.a - right.a || left.b - right.b || left.kind.localeCompare(right.kind),
  );
  const degreeBySystem = new Map<number, number>();
  for (const edge of sortedEdges) {
    degreeBySystem.set(edge.a, (degreeBySystem.get(edge.a) ?? 0) + 1);
    degreeBySystem.set(edge.b, (degreeBySystem.get(edge.b) ?? 0) + 1);
  }
  const routeLeaf =
    points.find((point) => (degreeBySystem.get(point.index) ?? 0) === 1) ?? points[0];
  const routeEdge = sortedEdges.find(
    (edge) => edge.a === routeLeaf?.index || edge.b === routeLeaf?.index,
  );
  if (routeLeaf === undefined || routeEdge === undefined) {
    throw new RangeError("Generated topology did not provide a routable backbone endpoint.");
  }
  const routeEdgeIndex = sortedEdges.indexOf(routeEdge);
  const routeDepartureGateId = generatedGateId(
    context,
    routeEdgeIndex,
    routeEdge.a === routeLeaf.index ? "a" : "b",
  );
  const routeDestinationGateId = generatedGateId(
    context,
    routeEdgeIndex,
    routeEdge.a === routeLeaf.index ? "b" : "a",
  );

  for (const [edgeIndex, edge] of sortedEdges.entries()) {
    const gateAId = generatedGateId(context, edgeIndex, "a");
    const gateBId = generatedGateId(context, edgeIndex, "b");
    const connectionId = generatedConnectionId(context, edgeIndex);
    const connectionDesignation = `LNK-${context.seedToken}-${String(edgeIndex).padStart(4, "0")}`;
    const connectionName = `Generated ${edge.kind} Link ${connectionDesignation}`;
    const endpoints: readonly ["a" | "b", number, StableId][] = [
      ["a", edge.a, gateAId],
      ["b", edge.b, gateBId],
    ];
    for (const [endpoint, pointIndex, gateId] of endpoints) {
      const point = points[pointIndex];
      if (point === undefined) {
        throw new RangeError("Generated topology referenced an unknown System point.");
      }
      const designation = `GTE-${context.seedToken}-${String(edgeIndex).padStart(4, "0")}${endpoint.toUpperCase()}`;
      const name = `Generated Gate of Heaven ${designation}`;
      const gateProperties = [
        "designation",
        "name",
        "systemId",
        "orbitalAnchorId",
        "positionAtEpoch",
        "velocityAtEpoch",
        "orbitalElements",
      ] as const;
      gates.push({
        id: gateId,
        designation,
        name,
        systemId: point.id,
        orbitalAnchorId: generatedAnchorId(context, pointIndex),
        positionAtEpoch: positionWithOffset(
          point.position,
          gateOffset(context, edgeIndex, endpoint),
        ),
        velocityAtEpoch: ZERO_VELOCITY,
        orbitalElements: undefined,
        ...generatedEntityMetadata(
          gateId,
          designation,
          name,
          context.generatedProvenance,
          gateProperties,
        ),
      });
      generatedGateIds.push(gateId);
      generatedGateDesignations.push(designation);
      const systemGates = gateIdsBySystemMutable.get(point.id);
      if (systemGates === undefined) {
        gateIdsBySystemMutable.set(point.id, [gateId]);
      } else {
        systemGates.push(gateId);
      }
    }
    connections.push({
      id: connectionId,
      designation: connectionDesignation,
      name: connectionName,
      gateAId,
      gateBId,
      ...generatedEntityMetadata(
        connectionId,
        connectionDesignation,
        connectionName,
        context.generatedProvenance,
        ["designation", "name", "gateAId", "gateBId"],
      ),
    });
    generatedConnectionIds.push(connectionId);
    generatedConnectionDesignations.push(connectionDesignation);
    connectionKinds[connectionId] = edge.kind;
    if (edge.kind === "backbone") {
      backboneConnectionIds.push(connectionId);
    } else {
      shortcutConnectionIds.push(connectionId);
    }
  }

  return Object.freeze({
    systems: freezeRecords(systems),
    orbitalAnchors: freezeRecords(orbitalAnchors),
    gates: freezeRecords(gates),
    connections: freezeRecords(connections),
    generatedSystemIds: Object.freeze(generatedSystemIds),
    generatedOrbitalAnchorIds: Object.freeze(generatedOrbitalAnchorIds),
    generatedGateIds: Object.freeze(generatedGateIds),
    generatedConnectionIds: Object.freeze(generatedConnectionIds),
    generatedSystemDesignations: Object.freeze(
      points.map((point) => systemDesignation(context, point.index)),
    ),
    generatedOrbitalAnchorDesignations: Object.freeze(
      points.map((point) => anchorDesignationFor(context, point.index)),
    ),
    generatedGateDesignations: Object.freeze(generatedGateDesignations),
    generatedConnectionDesignations: Object.freeze(generatedConnectionDesignations),
    gateIdsBySystem: new Map(
      [...gateIdsBySystemMutable.entries()].map(([id, gateIds]) => [
        id,
        Object.freeze([...gateIds]),
      ]),
    ),
    routeDepartureGateId,
    routeDestinationGateId,
    connectionKinds: Object.freeze(connectionKinds),
    backboneConnectionIds: Object.freeze(backboneConnectionIds),
    shortcutConnectionIds: Object.freeze(shortcutConnectionIds),
    attachmentConnectionIds: Object.freeze([]),
  });
}

function anchorDesignationFor(context: GeneratorContext, index: number): string {
  return `${systemDesignation(context, index)}-A`;
}

function attachUnpairedCanonicalGates(
  context: GeneratorContext,
  records: GeneratedRecords,
  baseGates: readonly ScenarioEntity[],
  baseConnections: readonly ScenarioEntity[],
): GeneratedRecords {
  const assigned = new Set<string>();
  for (const connection of baseConnections) {
    if (stableIdentifier(connection.gateAId)) {
      assigned.add(connection.gateAId);
    }
    if (stableIdentifier(connection.gateBId)) {
      assigned.add(connection.gateBId);
    }
  }
  const unpaired = baseGates.filter((gate) => stableIdentifier(gate.id) && !assigned.has(gate.id));
  if (unpaired.length === 0) {
    return records;
  }
  const generatedGates = [...records.gates];
  const generatedConnections = [...records.connections];
  const generatedGateIds = [...records.generatedGateIds];
  const generatedConnectionIds = [...records.generatedConnectionIds];
  const generatedGateDesignations = [...records.generatedGateDesignations];
  const generatedConnectionDesignations = [...records.generatedConnectionDesignations];
  const connectionKinds = { ...records.connectionKinds };
  const gateIdsBySystem = new Map(
    [...records.gateIdsBySystem.entries()].map(([systemId, gateIds]) => [systemId, [...gateIds]]),
  );
  const attachmentConnectionIds = [...records.attachmentConnectionIds];
  const generatedSystemIds = records.generatedSystemIds;
  for (const [index, baseGate] of unpaired.entries()) {
    const sourceGateId = baseGate.id as StableId;
    const systemId = generatedSystemIds[index % generatedSystemIds.length];
    if (systemId === undefined) {
      continue;
    }
    const attachmentGateId = generatedAttachmentGateId(context, index, sourceGateId);
    const attachmentConnectionId = generatedAttachmentConnectionId(context, index, sourceGateId);
    const designation = `GTE-${context.seedToken}-ATT${String(index).padStart(3, "0")}`;
    const connectionDesignation = `LNK-${context.seedToken}-ATT${String(index).padStart(3, "0")}`;
    const point = records.systems.find((system) => system.id === systemId);
    const position = positionValueOr(point, "positionAtEpoch", ORIGIN) as PositionVector;
    generatedGates.push({
      id: attachmentGateId,
      designation,
      name: `Generated Attachment Gate ${designation}`,
      systemId,
      orbitalAnchorId: generatedAnchorId(context, index % generatedSystemIds.length),
      positionAtEpoch: positionWithOffset(position, gateOffset(context, index, "a")),
      velocityAtEpoch: ZERO_VELOCITY,
      orbitalElements: undefined,
      ...generatedEntityMetadata(
        attachmentGateId,
        designation,
        `Generated Attachment Gate ${designation}`,
        context.generatedProvenance,
        [
          "designation",
          "name",
          "systemId",
          "orbitalAnchorId",
          "positionAtEpoch",
          "velocityAtEpoch",
          "orbitalElements",
        ],
      ),
    });
    generatedConnections.push({
      id: attachmentConnectionId,
      designation: connectionDesignation,
      name: `Generated Attachment Link ${connectionDesignation}`,
      gateAId: sourceGateId,
      gateBId: attachmentGateId,
      ...generatedEntityMetadata(
        attachmentConnectionId,
        connectionDesignation,
        `Generated Attachment Link ${connectionDesignation}`,
        context.generatedProvenance,
        ["designation", "name", "gateAId", "gateBId"],
      ),
    });
    generatedGateIds.push(attachmentGateId);
    generatedConnectionIds.push(attachmentConnectionId);
    generatedGateDesignations.push(designation);
    generatedConnectionDesignations.push(connectionDesignation);
    connectionKinds[attachmentConnectionId] = "attachment";
    attachmentConnectionIds.push(attachmentConnectionId);
    const systemGates = gateIdsBySystem.get(systemId);
    if (systemGates === undefined) {
      gateIdsBySystem.set(systemId, [attachmentGateId]);
    } else {
      systemGates.push(attachmentGateId);
    }
  }
  return Object.freeze({
    ...records,
    gates: freezeRecords(generatedGates),
    connections: freezeRecords(generatedConnections),
    generatedGateIds: Object.freeze(generatedGateIds),
    generatedConnectionIds: Object.freeze(generatedConnectionIds),
    generatedGateDesignations: Object.freeze(generatedGateDesignations),
    generatedConnectionDesignations: Object.freeze(generatedConnectionDesignations),
    gateIdsBySystem: new Map(
      [...gateIdsBySystem.entries()].map(([systemId, gateIds]) => [
        systemId,
        Object.freeze([...gateIds]),
      ]),
    ),
    connectionKinds: Object.freeze(connectionKinds),
    attachmentConnectionIds: Object.freeze(attachmentConnectionIds),
  });
}

function assertGeneratedIdCollisions(
  base: NormalizedBase,
  records: GeneratedRecords,
  createsDefaultShipProfile: boolean,
): void {
  const baseIds = new Set<string>();
  for (const entities of [
    base.systems,
    base.orbitalAnchors,
    base.gates,
    base.connections,
    base.shipProfiles,
  ]) {
    for (const entity of entities) {
      if (stableIdentifier(entity.id)) {
        baseIds.add(entity.id);
      }
    }
  }

  const generatedGroups: readonly (readonly [string, readonly StableId[]])[] = [
    ["System", records.generatedSystemIds],
    ["Orbital Anchor", records.generatedOrbitalAnchorIds],
    ["Gate", records.generatedGateIds],
    ["Gate Connection", records.generatedConnectionIds],
  ];
  const generatedIds = new Set<string>();
  if (createsDefaultShipProfile && baseIds.has("ship:generated-survey")) {
    throw new RangeError(
      'Generated Ship Profile ID "ship:generated-survey" collides with a canonical/base entity ID before compilation.',
    );
  }
  for (const [kind, ids] of generatedGroups) {
    for (const id of ids) {
      if (baseIds.has(id)) {
        throw new RangeError(
          `Generated ${kind} ID "${id}" collides with a canonical/base entity ID before compilation.`,
        );
      }
      if (generatedIds.has(id)) {
        throw new RangeError(`Generated entity ID "${id}" is not unique.`);
      }
      generatedIds.add(id);
    }
  }
}

function createDefaultShipProfile(context: GeneratorContext): ScenarioEntity {
  const id = "ship:generated-survey" as StableId;
  const designation = `SHIP-GEN-${context.seedToken}`;
  const name = "Provisional 1g Generated Survey Ship";
  const properties = [
    "designation",
    "name",
    "acceleration",
    "brakingAcceleration",
    "maximumSublightSpeed",
    "hasZpzGenerator",
  ] as const;
  return {
    id,
    designation,
    name,
    acceleration: metersPerSecondSquared(9.80665),
    brakingAcceleration: metersPerSecondSquared(9.80665),
    maximumSublightSpeed: metersPerSecond(
      LIGHT_SPEED_FRACTION_FOR_DEFAULT_SHIP * SPEED_OF_LIGHT.value,
    ),
    hasZpzGenerator: true,
    ...provisionalEntityMetadata(context.provisionalProfileProvenance, properties),
  };
}

function createPoints(context: GeneratorContext): readonly GeneratedPoint[] {
  const points: GeneratedPoint[] = [];
  for (let index = 0; index < context.materializedSystemCount; index += 1) {
    points.push({
      index,
      id: generatedSystemId(context, index),
      position: generatedPosition(context, `generated-system:${index}`),
    });
  }
  return Object.freeze(points);
}

function truncatedPlummerCdf(dimensionlessRadius: number): number {
  return dimensionlessRadius ** 3 / (1 + dimensionlessRadius ** 2) ** 1.5;
}

function expectedTruncatedPlummerMeanRadius(context: GeneratorContext): Meters {
  const outerRadius = context.regionRadius.value / context.scaleRadius.value;
  const denominator = truncatedPlummerCdf(outerRadius);
  const outerSquared = 1 + outerRadius ** 2;
  const firstMoment = 2 / 3 - 1 / Math.sqrt(outerSquared) + 1 / (3 * outerSquared ** 1.5);
  return meters((context.scaleRadius.value * 3 * firstMoment) / denominator);
}

function buildStatistics(
  context: GeneratorContext,
  points: readonly GeneratedPoint[],
): ClusterGenerationStatistics {
  const distances = points
    .map((point) =>
      meters(Math.hypot(point.position.x.value, point.position.y.value, point.position.z.value)),
    )
    .sort((left, right) => left.value - right.value);
  const total = distances.reduce((sum, distance) => sum + distance.value, 0);
  const halfRadius = context.regionRadius.value / 2;
  const withinHalf = distances.filter((distance) => distance.value <= halfRadius).length;
  const outerDimensionlessRadius = context.regionRadius.value / context.scaleRadius.value;
  const expectedFractionWithinHalfRadius =
    truncatedPlummerCdf(halfRadius / context.scaleRadius.value) /
    truncatedPlummerCdf(outerDimensionlessRadius);
  const radialConcentrationTolerance = Math.min(
    0.5,
    4 *
      Math.sqrt(
        (expectedFractionWithinHalfRadius * (1 - expectedFractionWithinHalfRadius)) /
          Math.max(1, distances.length),
      ) +
      1 / Math.max(1, distances.length),
  );
  const medianIndex = Math.floor(distances.length / 2);
  const median =
    distances.length % 2 === 0
      ? ((distances[medianIndex - 1]?.value ?? 0) + (distances[medianIndex]?.value ?? 0)) / 2
      : (distances[medianIndex]?.value ?? 0);
  return Object.freeze({
    radialProfile: "truncated-plummer" as const,
    profile: "truncated-plummer" as const,
    sampleCount: points.length,
    regionRadius: context.regionRadius,
    scaleRadius: context.scaleRadius,
    meanRadius: meters(total / Math.max(1, distances.length)),
    medianRadius: meters(median),
    expectedMeanRadius: expectedTruncatedPlummerMeanRadius(context),
    fractionWithinHalfRadius: withinHalf / Math.max(1, distances.length),
    expectedFractionWithinHalfRadius,
    uniformSphereExpectedFractionWithinHalfRadius: 0.125,
    radialConcentrationTolerance,
    radialDistances: Object.freeze(distances),
    statisticalGuarantee:
      "The finite sample is generated from a truncated Plummer radial profile. The expected concentration is the exact truncated-profile CDF ratio; the reported tolerance is a conservative four-standard-error binomial bound plus one sample step, not an infinite-population theorem.",
  });
}

function generatedTopologyIsConnected(
  systemIds: readonly StableId[],
  edges: readonly GeneratedEdge[],
): boolean {
  if (systemIds.length === 0) {
    return false;
  }
  const visited = new Set<number>([0]);
  const pending = [0];
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) {
      continue;
    }
    for (const edge of edges) {
      const next = edge.a === current ? edge.b : edge.b === current ? edge.a : undefined;
      if (next !== undefined && !visited.has(next)) {
        visited.add(next);
        pending.push(next);
      }
    }
  }
  return visited.size === systemIds.length;
}

function buildTopology(
  context: GeneratorContext,
  records: GeneratedRecords,
  points: readonly GeneratedPoint[],
  edges: readonly GeneratedEdge[],
  baseGates: readonly ScenarioEntity[],
): ClusterTopologyStatistics {
  const attachmentConnectionIds = records.attachmentConnectionIds;
  const connectionCount = records.generatedConnectionIds.length;
  const localDistanceThreshold = meters(context.regionRadius.value * LOCAL_LINK_DISTANCE_FACTOR);
  const gateById = new Map<StableId, ScenarioEntity>();
  for (const gate of [...baseGates, ...records.gates]) {
    if (stableIdentifier(gate.id)) {
      gateById.set(gate.id, gate);
    }
  }
  let localCount = 0;
  for (const connection of records.connections) {
    const gateA = stableIdentifier(connection.gateAId)
      ? gateById.get(connection.gateAId)
      : undefined;
    const gateB = stableIdentifier(connection.gateBId)
      ? gateById.get(connection.gateBId)
      : undefined;
    const positionA = positionValue(propertyValue(gateA ?? {}, "positionAtEpoch"));
    const positionB = positionValue(propertyValue(gateB ?? {}, "positionAtEpoch"));
    if (
      positionA !== undefined &&
      positionB !== undefined &&
      positionDistance(positionA, positionB) <= localDistanceThreshold.value
    ) {
      localCount += 1;
    }
  }
  const connectionKinds = Object.freeze({ ...records.connectionKinds }) as Readonly<
    Record<StableId, GeneratedConnectionKind>
  >;
  return Object.freeze({
    connectionCount,
    backboneConnectionCount: records.backboneConnectionIds.length,
    shortcutConnectionCount: records.shortcutConnectionIds.length,
    attachmentConnectionCount: attachmentConnectionIds.length,
    localDistanceThreshold,
    localLinkFraction: localCount / Math.max(1, connectionCount),
    shortcutLinkFraction: records.shortcutConnectionIds.length / Math.max(1, connectionCount),
    isConnected: generatedTopologyIsConnected(
      points.map((point) => point.id),
      edges,
    ),
    backboneConnectionIds: records.backboneConnectionIds,
    shortcutConnectionIds: records.shortcutConnectionIds,
    attachmentConnectionIds,
    connectionKinds,
  });
}

function scenarioProperties(
  base: NormalizedBase,
  context: GeneratorContext,
  statistics: ClusterGenerationStatistics,
): RecordValue {
  const existing = cloneRecord(base.properties);
  const provisional = provisionalProvenance(
    "Logical Cluster population is a scenario parameter until a canonical population source is cited.",
  );
  const generated = context.generatedProvenance;
  return {
    ...existing,
    logicalPopulation: { value: context.logicalPopulation, provenance: provisional },
    population: { value: context.logicalPopulation, provenance: provisional },
    generationSeed: { value: context.seed, provenance: generated },
    generatorVersion: { value: context.generatorVersion, provenance: generated },
    materializedSystemCount: { value: context.materializedSystemCount, provenance: generated },
    radialProfile: { value: statistics.radialProfile, provenance: generated },
    regionRadius: { value: context.regionRadius, provenance: generated },
  };
}

function scenarioInputForRegion(
  request: ClusterGenerationRequest,
  context: GeneratorContext,
  base: NormalizedBase,
  records: GeneratedRecords,
  statistics: ClusterGenerationStatistics,
): ScenarioInput {
  const baseScenarioId = stableIdentifier(base.id)
    ? base.id
    : `scenario:generated-cluster:${context.seedToken}`;
  const id = request.scenarioId ?? baseScenarioId;
  if (!stableIdentifier(id)) {
    throw new RangeError("Generated Cluster scenarioId must be a stable identifier.");
  }
  const designation = request.designation ?? base.designation ?? `SCN-GEN-${context.seedToken}`;
  const name = request.name ?? base.name ?? "Generated Centauri Cluster Region";
  const epoch =
    request.epoch ?? base.epoch ?? Object.freeze({ label: "T+0", coordinateTime: seconds(0) });
  const baseProvenance = base.provenance;
  const scenarioProvenance = baseProvenance ?? context.generatedProvenance;
  const canonicalIdentity =
    base.canonicalIdentity ??
    Object.freeze({ id, designation, name, provenance: context.generatedProvenance });
  const properties = scenarioProperties(base, context, statistics);
  const generatedEntities = [
    ...records.systems,
    ...records.orbitalAnchors,
    ...records.gates,
    ...records.connections,
  ];
  const scenario: ScenarioInput = {
    id,
    designation,
    name,
    epoch,
    systems: freezeRecords([
      ...base.systems,
      ...generatedEntities.filter((entity) =>
        records.generatedSystemIds.includes(entity.id as StableId),
      ),
    ]) as readonly SystemInput[],
    orbitalAnchors: freezeRecords([
      ...base.orbitalAnchors,
      ...records.orbitalAnchors,
    ]) as readonly OrbitalAnchorInput[],
    gates: freezeRecords([...base.gates, ...records.gates]) as readonly GateInput[],
    gateConnections: freezeRecords([
      ...base.connections,
      ...records.connections,
    ]) as readonly GateConnectionInput[],
    shipProfiles: freezeRecords(
      base.shipProfiles.length > 0
        ? [...base.shipProfiles]
        : request.shipProfiles === undefined
          ? [createDefaultShipProfile(context)]
          : [...request.shipProfiles],
    ) as readonly ShipProfileInput[],
    canonicalClaims: base.canonicalClaims as ScenarioInput["canonicalClaims"],
    overrides: base.overrides as ScenarioInput["overrides"],
    canonicalIdentity,
    provenance: scenarioProvenance as ScenarioInput["provenance"],
    properties: properties as ScenarioInput["properties"],
    propertyProvenance: properties as ScenarioInput["propertyProvenance"],
  };
  return Object.freeze(scenario);
}

function routeRequestForRegion(
  request: ClusterGenerationRequest,
  context: GeneratorContext,
  scenario: CompiledScenario,
  records: GeneratedRecords,
): RoutePlanningRequest {
  const raw = isRecord(request.routeRequest) ? request.routeRequest : {};
  const departureGateId =
    (typeof raw.departureGateId === "string" ? raw.departureGateId : undefined) ??
    records.routeDepartureGateId;
  const destinationGateId =
    (typeof raw.destinationGateId === "string" ? raw.destinationGateId : undefined) ??
    records.routeDestinationGateId;
  if (!stableIdentifier(departureGateId) || !stableIdentifier(destinationGateId)) {
    throw new RangeError("Generated Cluster topology did not provide route endpoints.");
  }
  const shipProfileId =
    typeof raw.shipProfileId === "string" ? raw.shipProfileId : scenario.shipProfiles[0]?.id;
  if (!stableIdentifier(shipProfileId)) {
    throw new RangeError("Generated Cluster region requires a Ship Profile for its route.");
  }
  const departureCoordinateTime =
    isRecord(raw.departureCoordinateTime) &&
    raw.departureCoordinateTime.unit === "s" &&
    typeof raw.departureCoordinateTime.value === "number"
      ? seconds(raw.departureCoordinateTime.value)
      : scenario.epoch.coordinateTime;
  const latestArrivalCoordinateTime =
    isRecord(raw.latestArrivalCoordinateTime) &&
    raw.latestArrivalCoordinateTime.unit === "s" &&
    typeof raw.latestArrivalCoordinateTime.value === "number"
      ? seconds(raw.latestArrivalCoordinateTime.value)
      : seconds(departureCoordinateTime.value + DEFAULT_CLUSTER_ROUTE_HORIZON.value);
  const maximumStrategicWait =
    isRecord(raw.maximumStrategicWait) &&
    raw.maximumStrategicWait.unit === "s" &&
    typeof raw.maximumStrategicWait.value === "number"
      ? seconds(raw.maximumStrategicWait.value)
      : seconds(0);
  return Object.freeze({
    departureGateId: departureGateId as StableId,
    destinationGateId: destinationGateId as StableId,
    shipProfileId: shipProfileId as StableId,
    departureCoordinateTime,
    dwells: Array.isArray(raw.dwells)
      ? (raw.dwells as RoutePlanningRequest["dwells"])
      : Object.freeze([]),
    latestArrivalCoordinateTime,
    maximumStrategicWait,
    provenanceFilter: raw.provenanceFilter as RoutePlanningRequest["provenanceFilter"],
    maxAlternatives: typeof raw.maxAlternatives === "number" ? raw.maxAlternatives : 0,
    searchBudget: raw.searchBudget as RoutePlanningRequest["searchBudget"],
  });
}

/**
 * Generates, compiles, and immediately routes a finite deterministic Cluster region.
 *
 * Generated content is marked with `generated` Provenance whose source includes the generator
 * version and seed. The CPU reference implementation materializes only the requested finite
 * sample, uses a truncated Plummer radial profile, creates a nearest-neighbour connectivity
 * backbone, and adds a small deterministic set of long-distance shortcuts. The resulting Scenario
 * is compiled through the normal model seam and the default endpoints are planned through the
 * normal explicit earliest-arrival route planner; no routing implementation is duplicated here.
 *
 * @param request - Logical population, seed, generator version, and optional canonical base data.
 * @returns A frozen generated region containing its compiled Scenario, audit statistics, and route.
 * @throws RangeError when the finite generation request is invalid or its default route cannot be
 * planned.
 */
export function generateClusterRegion(request: ClusterGenerationRequest): GeneratedClusterRegion {
  const context = buildContext(request);
  const baseValue = request.canonicalScenario ?? request.baseScenario;
  const base = normalizeBaseScenario(baseValue, context);
  const points = createPoints(context);
  const backbone = buildBackbone(points);
  const shortcuts = buildShortcuts(context, points, backbone);
  const edges = Object.freeze([...backbone, ...shortcuts]);
  let records = createGeneratedRecords(context, points, edges);
  records = attachUnpairedCanonicalGates(context, records, base.gates, base.connections);
  assertGeneratedIdCollisions(
    base,
    records,
    base.shipProfiles.length === 0 && request.shipProfiles === undefined,
  );
  const statistics = buildStatistics(context, points);
  const topology = buildTopology(context, records, points, edges, base.gates);
  const scenarioInput = scenarioInputForRegion(request, context, base, records, statistics);
  const compiledResult = compileScenario(scenarioInput);
  if (!compiledResult.ok) {
    throw new RangeError(
      `Generated Cluster Scenario failed validation: ${compiledResult.issues.map((issue) => issue.message).join(" ")}`,
    );
  }
  const scenario = compiledResult.scenario;
  const routeRequest = routeRequestForRegion(request, context, scenario, records);
  const route = planJourney(scenario, routeRequest);
  if (!route.ok && !isRecord(request.routeRequest)) {
    throw new RangeError(
      `Generated Cluster default route failed: ${route.issues.map((issue) => issue.message).join(" ")}`,
    );
  }
  const generatedSystems = scenario.systems.filter((entity) =>
    records.generatedSystemIds.includes(entity.id),
  );
  const generatedOrbitalAnchors = scenario.orbitalAnchors.filter((entity) =>
    records.generatedOrbitalAnchorIds.includes(entity.id),
  );
  const generatedGates = scenario.gates.filter((entity) =>
    records.generatedGateIds.includes(entity.id),
  );
  const generatedConnections = scenario.gateConnections.filter((entity) =>
    records.generatedConnectionIds.includes(entity.id),
  );
  const region = Object.freeze({
    kind: "generated-cluster-region" as const,
    ok: true as const,
    seed: context.seed,
    seedLabel: context.seedLabel,
    seedIdentity: context.seedIdentity,
    seedHash: context.seedHash,
    generatorVersion: context.generatorVersion,
    logicalPopulation: context.logicalPopulation,
    population: context.logicalPopulation,
    materializedSystemCount: context.materializedSystemCount,
    regionRadius: context.regionRadius,
    scenarioInput,
    input: scenarioInput,
    scenario,
    compiledScenario: scenario,
    generatedSystems: Object.freeze(generatedSystems),
    generatedOrbitalAnchors: Object.freeze(generatedOrbitalAnchors),
    generatedGates: Object.freeze(generatedGates),
    generatedConnections: Object.freeze(generatedConnections),
    generatedSystemIds: records.generatedSystemIds,
    generatedOrbitalAnchorIds: records.generatedOrbitalAnchorIds,
    generatedGateIds: records.generatedGateIds,
    generatedConnectionIds: records.generatedConnectionIds,
    generatedSystemDesignations: records.generatedSystemDesignations,
    generatedOrbitalAnchorDesignations: records.generatedOrbitalAnchorDesignations,
    generatedGateDesignations: records.generatedGateDesignations,
    generatedConnectionDesignations: records.generatedConnectionDesignations,
    statistics,
    topology,
    routeRequest,
    route,
    plan: route.ok ? route.plan : undefined,
    routePlan: route.ok ? route.plan : undefined,
    journeyTimeline: route.ok ? route.plan.timeline : undefined,
    timeline: route.ok ? route.plan.timeline : undefined,
  });
  return region;
}

/**
 * Alias for callers that use Scenario terminology for the generated region operation.
 *
 * @param request - Logical population, seed, generator version, and optional canonical base data.
 * @returns The compiled and immediately routed generated Cluster region.
 */
export const generateClusterScenario = generateClusterRegion;

/**
 * Alias naming the generated region's deterministic, routable contract explicitly.
 *
 * @param request - Logical population, seed, generator version, and optional canonical base data.
 * @returns The compiled and immediately routed generated Cluster region.
 */
export const generateRoutableClusterRegion = generateClusterRegion;
