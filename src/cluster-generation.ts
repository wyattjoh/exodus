import {
  executionControlFor,
  attachExecutionControl,
  type WorkerPlanningExecutionControl,
} from "./execution-control";
import {
  SPEED_OF_LIGHT,
  meters,
  metersPerSecond,
  metersPerSecondSquared,
  seconds,
  vector3,
  type Meters,
  type PositionVector,
  type Seconds,
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
  conservativeBounds,
  generatedProvenance,
  provisionalProvenance,
  type ConservativeBounds,
  type Provenance,
  type PropertyMetadataInput,
} from "./provenance";
import {
  isSupportedClusterGeneratorVersion,
  DEFAULT_CLUSTER_GENERATOR_VERSION,
  SUPPORTED_CLUSTER_GENERATOR_VERSIONS,
} from "./generator-versions";
import {
  planJourney,
  type RoutePlan,
  type RoutePlanningIssue,
  type RoutePlanningRequest,
  type RoutePlanningSearchBudget,
  type RoutePlanningResult,
  type RouteSensitivity,
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
 * One deterministic node in the logical Cluster hierarchy.
 *
 * A node describes a contiguous logical System range. Its child descriptors are cheap metadata;
 * Systems, Gates, and Gate Connections are not created until a caller asks for materialization.
 */
export type ClusterRegionNode = {
  readonly kind: "cluster-region-node";
  readonly id: StableId;
  readonly depth: number;
  readonly path: readonly number[];
  readonly logicalSystemStart: number;
  readonly logicalSystemCount: number;
  readonly center: PositionVector;
  readonly radius: Meters;
  readonly children: readonly ClusterRegionNode[];
};

/**
 * A deterministic, lazily materializable description of a logical Cluster population.
 */
export type HierarchicalClusterRegion = {
  readonly kind: "hierarchical-cluster-region";
  readonly seed: ClusterGenerationSeed;
  readonly seedLabel: string;
  readonly seedIdentity: string;
  readonly seedHash: number;
  readonly generatorVersion: string;
  readonly logicalPopulation: number;
  readonly materializedSystemCount: 0;
  readonly regionRadius: Meters;
  readonly root: ClusterRegionNode;
  readonly leafSystemCapacity: number;
  readonly maxDepth: number;
  readonly defaultDepartureGateId: StableId;
  readonly defaultDestinationGateId: StableId;
  readonly defaultShipProfileId: StableId;
  readonly sourceRequest: ClusterGenerationRequest;
  /** Returns true only for generated Gate identities emitted by a materialization of this hierarchy. */
  readonly hasMaterializedGate: (gateId: StableId) => boolean;
  /** Materializes one bounded node or logical index selection without mutating this descriptor. */
  readonly materialize: (request?: ClusterRegionMaterializationRequest) => GeneratedClusterRegion;
  /** Alias for `materialize`, retained for callers that prefer an explicit operation name. */
  readonly materializeRegion: (
    request?: ClusterRegionMaterializationRequest,
  ) => GeneratedClusterRegion;
};

/**
 * A finite on-demand materialization request for a hierarchical Cluster region.
 */
export type ClusterRegionMaterializationRequest = {
  readonly regionId?: StableId | undefined;
  readonly materializedSystemCount?: number | undefined;
  readonly logicalSystemIndices?: readonly number[] | undefined;
  readonly routeRequest?: Readonly<Record<string, unknown>> | undefined;
};

/**
 * A finite refinement budget for a logical Cluster route query.
 */
export type ClusterRouteRefinementBudget = {
  readonly refinementDepth: number;
  readonly maxMaterializedSystems: number;
  readonly maxCandidateRoutes: number;
};

/**
 * A typed request for bounded hierarchical Cluster route planning.
 *
 * The route fields mirror `RoutePlanningRequest`; the optional refinement fields bound logical
 * candidate generation. Runtime callers may still pass unknown data to receive structured issues.
 */
export type ClusterRoutePlanningRequest = Omit<
  RoutePlanningRequest,
  "maxAlternatives" | "searchBudget"
> & {
  readonly maxAlternatives?: number | undefined;
  readonly searchBudget?: RoutePlanningSearchBudget | undefined;
  readonly refinementDepth?: number | undefined;
  readonly maxMaterializedSystems?: number | undefined;
  readonly maxCandidateRoutes?: number | undefined;
};

/**
 * The quality report for a bounded hierarchical route search.
 */
export type ClusterRouteRefinementReport = {
  readonly kind: "hierarchical-bounded";
  readonly requestedDepth: number;
  readonly completedDepth: number;
  /** Tightness of the reported admissible lower/feasible upper arrival interval (0..1). */
  readonly score: number;
  readonly boundGap: Seconds;
  readonly candidateGraphEdgeCount: number;
  readonly addedRefinementEdgeCount: number;
  /** True when a supplemental refinement candidate or its inner search hit a finite bound. */
  readonly searchExhausted: boolean;
  readonly globallyOptimal: false;
  readonly optimality: "best-known-upper-bound";
  readonly proof: "bounded-candidate-search";
};

/**
 * Accounting and reproducibility data for one bounded logical Cluster route query.
 */
export type ClusterRoutePlanningSearchStats = {
  readonly refinementDepth: number;
  readonly completedRefinementDepth: number;
  readonly candidateGraphEdgeCount: number;
  readonly addedRefinementEdgeCount: number;
  readonly candidateRoutesEvaluated: number;
  readonly materializedRegionCount: number;
  readonly materializedSystemCount: number;
  readonly budget: ClusterRouteRefinementBudget;
  readonly candidateRouteKeys: readonly string[];
};

/**
 * Independently checkable arrival bounds for a bounded logical Cluster route.
 *
 * The lower bound is optimistic and admissible; the upper bound is the nominal arrival of a
 * simulated feasible Route Plan. `conservativeUpperBound` additionally retains input uncertainty.
 */
export type ClusterRouteBounds = {
  readonly earliestArrivalLowerBound: Seconds;
  readonly bestKnownUpperBound: Seconds;
  readonly lowerBound: Seconds;
  readonly upperBound: Seconds;
  readonly conservativeUpperBound: Seconds;
  readonly gap: Seconds;
  readonly lowerBoundMethod: "zero-duration" | "straight-line-light-speed";
  readonly upperBoundMethod: "simulated-route";
};

/**
 * A successful bounded logical Cluster route result.
 */
export type ClusterRoutePlanningSuccess = {
  readonly kind: "cluster-route-planning";
  readonly ok: true;
  readonly outcome: "success";
  readonly plan: RoutePlan;
  readonly bestPlan: RoutePlan;
  readonly alternatives: readonly RoutePlan[];
  readonly sensitivity: readonly RouteSensitivity[];
  readonly sensitivityAlternatives: readonly RouteSensitivity[];
  readonly bounds: ConservativeBounds<Seconds>;
  readonly earliestArrivalLowerBound: Seconds;
  readonly bestKnownUpperBound: Seconds;
  readonly lowerBound: Seconds;
  readonly upperBound: Seconds;
  readonly conservativeUpperBound: Seconds;
  readonly refinementQuality: "hierarchical-bounded";
  /** Tightness of the reported admissible lower/feasible upper arrival interval (0..1). */
  readonly refinementScore: number;
  readonly refinement: ClusterRouteRefinementReport;
  readonly globallyOptimal: false;
  readonly optimality: "best-known-upper-bound";
  readonly search: ClusterRoutePlanningSearchStats;
  readonly issues: readonly [];
};

/**
 * An unsuccessful bounded logical Cluster route result.
 */
export type ClusterRoutePlanningFailure = {
  readonly kind: "cluster-route-planning";
  readonly ok: false;
  readonly outcome: "invalid" | "disconnected" | "incomplete";
  readonly plan: undefined;
  readonly bestPlan: undefined;
  readonly alternatives: readonly [];
  readonly sensitivity: readonly [];
  readonly sensitivityAlternatives: readonly [];
  readonly bounds: undefined;
  readonly earliestArrivalLowerBound: undefined;
  readonly bestKnownUpperBound: undefined;
  readonly lowerBound: undefined;
  readonly upperBound: undefined;
  readonly conservativeUpperBound: undefined;
  readonly refinementQuality: undefined;
  readonly refinementScore: undefined;
  readonly refinement: undefined;
  readonly globallyOptimal: false;
  readonly optimality: undefined;
  readonly search: ClusterRoutePlanningSearchStats | undefined;
  readonly issues: readonly RoutePlanningIssue[];
};

/**
 * The discriminated result returned by the bounded logical Cluster route seam.
 */
export type ClusterRoutePlanningResult = ClusterRoutePlanningSuccess | ClusterRoutePlanningFailure;

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
  readonly regionId: StableId;
  readonly regionDepth: number;
  readonly logicalSystemStart: number;
  readonly logicalSystemCount: number;
  readonly logicalSystemIndices: readonly number[];
  readonly hierarchy: HierarchicalClusterRegion;
  readonly materialize: (request?: ClusterRegionMaterializationRequest) => GeneratedClusterRegion;
  readonly materializeRegion: (
    request?: ClusterRegionMaterializationRequest,
  ) => GeneratedClusterRegion;
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
 * Returns whether a value is a generated region created by this module.
 *
 * The module-private marker prevents persistence from treating a forgeable generated-region shape
 * or Proxy as trusted. Untrusted wrappers are revalidated through the raw input snapshot instead.
 *
 * @param value - The candidate generated-region value.
 * @returns True only for an immutable region registered by this generator.
 */
export function isTrustedGeneratedClusterRegion(value: unknown): value is GeneratedClusterRegion {
  return typeof value === "object" && value !== null && trustedGeneratedRegions.has(value);
}

/**
 * The default generator version used when a caller does not provide one.
 */
export {
  DEFAULT_CLUSTER_GENERATOR_VERSION,
  SUPPORTED_CLUSTER_GENERATOR_VERSIONS,
} from "./generator-versions";

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

/** The maximum logical refinement depth accepted by the CPU route reference. */
export const MAX_CLUSTER_ROUTE_REFINEMENT_DEPTH = 8;

/** The default number of Systems a bounded logical route may materialize per candidate. */
export const DEFAULT_CLUSTER_ROUTE_MATERIALIZED_SYSTEMS = 256;

/** The largest finite candidate set accepted by one logical route query. */
export const MAX_CLUSTER_ROUTE_CANDIDATES = 64;

/** The maximum logical Systems described by one leaf hierarchy node. */
export const CLUSTER_REGION_LEAF_SYSTEM_CAPACITY = 4_096;

/** The fixed branching factor used by deterministic hierarchy construction. */
export const CLUSTER_REGION_BRANCHING_FACTOR = 8;

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
const trustedGeneratedRegions = new WeakSet<object>();

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
  /** A stable endpoint-derived token used by on-demand materialization. */
  readonly identity?: string | undefined;
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
  readonly references: readonly unknown[] | undefined;
  readonly journeyInputs: readonly unknown[] | undefined;
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
  const version = value?.trim() ?? DEFAULT_CLUSTER_GENERATOR_VERSION;
  if (!nonEmptyString(version)) {
    throw new RangeError("Cluster generatorVersion must be a non-empty string.");
  }
  if (!isSupportedClusterGeneratorVersion(version)) {
    throw new RangeError(
      `Unsupported Cluster generatorVersion ${JSON.stringify(version)}; retained versions are ${SUPPORTED_CLUSTER_GENERATOR_VERSIONS.join(", ")}.`,
    );
  }
  return version;
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

function generatedSystemIdFromTokens(
  versionToken: string,
  seedToken: string,
  index: number,
): StableId {
  return `system:generated:${versionToken}:${seedToken}:${String(index).padStart(4, "0")}` as StableId;
}

function generatedSystemId(context: GeneratorContext, index: number): StableId {
  return generatedSystemIdFromTokens(context.versionToken, context.seedToken, index);
}

/**
 * Derives the exact public StableId used by the retained CPU generator for one logical System.
 *
 * @param seed - Numeric or exact textual generator seed.
 * @param generatorVersion - Retained CPU generator version.
 * @param logicalIndex - Zero-based logical System index.
 * @returns The unchanged deterministic generated System StableId.
 * @throws RangeError when the seed, version, or logical index is invalid.
 */
export function generatedClusterSystemId(
  seed: ClusterGenerationSeed,
  generatorVersion: string,
  logicalIndex: number,
): StableId {
  const seedValue = readSeed(seed);
  const version = readGeneratorVersion(generatorVersion);
  if (!Number.isSafeInteger(logicalIndex) || logicalIndex < 0) {
    throw new RangeError("logicalIndex must be a non-negative safe integer.");
  }
  return generatedSystemIdFromTokens(
    compactToken(version),
    compactToken(seedValue.identity),
    logicalIndex,
  );
}

function generatedAnchorId(context: GeneratorContext, index: number): StableId {
  return `anchor:generated:${context.versionToken}:${context.seedToken}:${String(index).padStart(4, "0")}` as StableId;
}

function edgeIdentityToken(edgeIndex: number | string): string {
  return typeof edgeIndex === "number" ? String(edgeIndex).padStart(4, "0") : edgeIndex;
}

function generatedGateId(
  context: GeneratorContext,
  edgeIndex: number | string,
  endpoint: "a" | "b",
): StableId {
  return `gate:generated:${context.versionToken}:${context.seedToken}:${edgeIdentityToken(edgeIndex)}:${endpoint}` as StableId;
}

function generatedConnectionId(context: GeneratorContext, edgeIndex: number | string): StableId {
  return `connection:generated:${context.versionToken}:${context.seedToken}:${edgeIdentityToken(edgeIndex)}` as StableId;
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
    generatorVersion: value.generatorVersion,
    seed: value.seed,
    logicalPopulation: value.logicalPopulation,
    generation: value.generation,
    references: Array.isArray(value.references) ? [...value.references] : undefined,
    canonicalClaims: Array.isArray(value.canonicalClaims) ? [...value.canonicalClaims] : undefined,
    overrides:
      Array.isArray(value.overrides) && !hasOwn(value, "index") ? [...value.overrides] : undefined,
    journeyInputs: Array.isArray(value.journeyInputs)
      ? [...value.journeyInputs]
      : Array.isArray(value.savedJourneyInputs)
        ? [...value.savedJourneyInputs]
        : undefined,
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
    references: Array.isArray(source.references)
      ? Object.freeze([...source.references])
      : undefined,
    journeyInputs: Array.isArray(source.journeyInputs)
      ? Object.freeze([...source.journeyInputs])
      : undefined,
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
function buildBackbone(
  points: readonly GeneratedPoint[],
  control: WorkerPlanningExecutionControl | undefined = undefined,
): readonly GeneratedEdge[] {
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
    if (candidate % 64 === 0) {
      control?.checkpoint();
    }
    const point = points[candidate];
    if (point === undefined) {
      continue;
    }
    nearestConnected[candidate] = 0;
    nearestDistance[candidate] = positionDistance(origin.position, point.position);
  }

  const edges: GeneratedEdge[] = [];
  for (let step = 1; step < points.length; step += 1) {
    control?.checkpoint();
    let bestCandidate = -1;
    let bestSource = Number.POSITIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let candidate = 1; candidate < points.length; candidate += 1) {
      if (candidate % 64 === 0) {
        control?.checkpoint();
      }
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
      if (candidate % 64 === 0) {
        control?.checkpoint();
      }
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
  control: WorkerPlanningExecutionControl | undefined = undefined,
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
    control?.checkpoint();
    const source = points[a];
    if (source === undefined) {
      continue;
    }
    for (let b = a + 1; b < points.length; b += 1) {
      if (b % 64 === 0) {
        control?.checkpoint();
      }
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
  edgeIndex: number | string,
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

function edgeToken(edge: GeneratedEdge, edgeIndex: number): number | string {
  return edge.identity ?? edgeIndex;
}

function createGeneratedRecords(
  context: GeneratorContext,
  points: readonly GeneratedPoint[],
  edges: readonly GeneratedEdge[],
): GeneratedRecords {
  const pointByIndex = new Map(points.map((point) => [point.index, point]));
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
    edgeToken(routeEdge, routeEdgeIndex),
    routeEdge.a === routeLeaf.index ? "a" : "b",
  );
  const routeDestinationGateId = generatedGateId(
    context,
    edgeToken(routeEdge, routeEdgeIndex),
    routeEdge.a === routeLeaf.index ? "b" : "a",
  );

  for (const [edgeIndex, edge] of sortedEdges.entries()) {
    const edgeTokenValue = edgeToken(edge, edgeIndex);
    const gateAId = generatedGateId(context, edgeTokenValue, "a");
    const gateBId = generatedGateId(context, edgeTokenValue, "b");
    const connectionId = generatedConnectionId(context, edgeTokenValue);
    const connectionDesignation = `LNK-${context.seedToken}-${String(edgeIndex).padStart(4, "0")}`;
    const connectionName = `Generated ${edge.kind} Link ${connectionDesignation}`;
    const endpoints: readonly ["a" | "b", number, StableId][] = [
      ["a", edge.a, gateAId],
      ["b", edge.b, gateBId],
    ];
    for (const [endpoint, pointIndex, gateId] of endpoints) {
      const point = pointByIndex.get(pointIndex);
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
          gateOffset(context, edgeTokenValue, endpoint),
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
  points: readonly GeneratedPoint[],
  edges: readonly GeneratedEdge[],
): boolean {
  const first = points[0];
  if (first === undefined) {
    return false;
  }
  const expected = new Set(points.map((point) => point.index));
  const visited = new Set<number>([first.index]);
  const pending = [first.index];
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) {
      continue;
    }
    for (const edge of edges) {
      const next = edge.a === current ? edge.b : edge.b === current ? edge.a : undefined;
      if (next !== undefined && expected.has(next) && !visited.has(next)) {
        visited.add(next);
        pending.push(next);
      }
    }
  }
  return visited.size === expected.size;
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
    isConnected: generatedTopologyIsConnected(points, edges),
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
  records: GeneratedRecords | undefined,
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
  const generatedEntities =
    records === undefined
      ? []
      : [...records.systems, ...records.orbitalAnchors, ...records.gates, ...records.connections];
  const scenario: ScenarioInput = {
    id,
    designation,
    name,
    epoch,
    systems: freezeRecords([
      ...base.systems,
      ...generatedEntities.filter(
        (entity) => records?.generatedSystemIds.includes(entity.id as StableId) === true,
      ),
    ]) as readonly SystemInput[],
    orbitalAnchors: freezeRecords([
      ...base.orbitalAnchors,
      ...(records?.orbitalAnchors ?? []),
    ]) as readonly OrbitalAnchorInput[],
    gates: freezeRecords([...base.gates, ...(records?.gates ?? [])]) as readonly GateInput[],
    gateConnections: freezeRecords([
      ...base.connections,
      ...(records?.connections ?? []),
    ]) as readonly GateConnectionInput[],
    generatorVersion: context.generatorVersion,
    seed: context.seed,
    logicalPopulation: context.logicalPopulation,
    generation: {
      generatorVersion: context.generatorVersion,
      seed: context.seed,
      logicalPopulation: context.logicalPopulation,
    },
    references: base.references as ScenarioInput["references"],
    journeyInputs: base.journeyInputs as ScenarioInput["journeyInputs"],
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

function canonicalGateIdsForHierarchy(
  hierarchy: HierarchicalClusterRegion,
  context: GeneratorContext,
): ReadonlySet<StableId> {
  const source = hierarchy.sourceRequest.canonicalScenario ?? hierarchy.sourceRequest.baseScenario;
  if (source === undefined) {
    return new Set<StableId>();
  }
  const base = normalizeBaseScenario(source, context);
  return new Set(
    base.gates.flatMap((gate) => (stableIdentifier(gate.id) ? [gate.id as StableId] : [])),
  );
}

function scenarioForCanonicalCandidate(
  hierarchy: HierarchicalClusterRegion,
  routeRequest: Readonly<Record<string, unknown>>,
  context: GeneratorContext,
): CompiledScenario | undefined {
  const canonicalContext = Object.freeze({ ...context, materializedSystemCount: 0 });
  const source = hierarchy.sourceRequest.canonicalScenario ?? hierarchy.sourceRequest.baseScenario;
  if (source === undefined) {
    return undefined;
  }
  const base = normalizeBaseScenario(source, canonicalContext);
  const request: ClusterGenerationRequest = {
    ...hierarchy.sourceRequest,
    logicalPopulation: hierarchy.logicalPopulation,
    materializedSystemCount: 0,
    seed: hierarchy.seed,
    generatorVersion: hierarchy.generatorVersion,
    regionRadius: hierarchy.regionRadius,
    routeRequest,
  };
  const statistics = buildStatistics(canonicalContext, Object.freeze([]));
  const scenarioInput = scenarioInputForRegion(
    request,
    canonicalContext,
    base,
    undefined,
    statistics,
  );
  const compiled = compileScenario(scenarioInput);
  return compiled.ok ? compiled.scenario : undefined;
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

type LogicalGateReference = {
  readonly a: number;
  readonly b: number;
  readonly endpoint: "a" | "b";
  readonly edgeIdentity: string;
  readonly systemIndex: number;
  readonly otherSystemIndex: number;
};

type ParsedHierarchicalRouteRequest = {
  readonly routeRequest: Readonly<Record<string, unknown>>;
  readonly departureGateId: StableId;
  readonly destinationGateId: StableId;
  readonly refinementBudget: ClusterRouteRefinementBudget;
  readonly issues: readonly RoutePlanningIssue[];
};

function regionNodeId(context: GeneratorContext, path: readonly number[]): StableId {
  const pathToken = path.length === 0 ? "root" : path.join(".");
  return `region:generated:${context.versionToken}:${context.seedToken}:${pathToken}` as StableId;
}

function createRegionNode(
  context: GeneratorContext,
  logicalSystemStart: number,
  logicalSystemCount: number,
  depth: number,
  path: readonly number[],
): ClusterRegionNode {
  const childCount =
    logicalSystemCount > CLUSTER_REGION_LEAF_SYSTEM_CAPACITY
      ? Math.min(
          CLUSTER_REGION_BRANCHING_FACTOR,
          Math.ceil(logicalSystemCount / CLUSTER_REGION_LEAF_SYSTEM_CAPACITY),
        )
      : 0;
  const children: ClusterRegionNode[] = [];
  if (childCount > 0) {
    const baseChildCount = Math.floor(logicalSystemCount / childCount);
    const remainder = logicalSystemCount % childCount;
    let nextStart = logicalSystemStart;
    for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
      const childLogicalCount = baseChildCount + (childIndex < remainder ? 1 : 0);
      const childPath = [...path, childIndex];
      children.push(createRegionNode(context, nextStart, childLogicalCount, depth + 1, childPath));
      nextStart += childLogicalCount;
    }
  }
  const center = generatedPosition(
    context,
    `region-center:${logicalSystemStart}:${logicalSystemCount}:${path.join(".")}`,
  );
  return Object.freeze({
    kind: "cluster-region-node" as const,
    id: regionNodeId(context, path),
    depth,
    path: Object.freeze([...path]),
    logicalSystemStart,
    logicalSystemCount,
    center,
    // A full-radius enclosing bound is conservative even before child contents are materialized.
    radius: context.regionRadius,
    children: Object.freeze(children),
  });
}

function hierarchyDepth(node: ClusterRegionNode): number {
  return node.children.length === 0
    ? node.depth
    : Math.max(...node.children.map((child) => hierarchyDepth(child)));
}

function logicalParentIndex(index: number): number | undefined {
  return index <= 0 ? undefined : Math.floor((index - 1) / 2);
}

function logicalEdgeIdentity(a: number, b: number): string {
  return `h-${Math.min(a, b)}-${Math.max(a, b)}`;
}

function logicalGateId(
  context: GeneratorContext,
  a: number,
  b: number,
  endpoint: "a" | "b",
): StableId {
  return generatedGateId(context, logicalEdgeIdentity(a, b), endpoint);
}

function logicalGateReference(
  context: GeneratorContext,
  gateId: StableId,
  hasMaterializedGate: ((gateId: StableId) => boolean) | undefined,
): LogicalGateReference | undefined {
  const prefix = `gate:generated:${context.versionToken}:${context.seedToken}:`;
  if (!gateId.startsWith(prefix)) {
    return undefined;
  }
  const suffix = gateId.slice(prefix.length);
  const separator = suffix.lastIndexOf(":");
  if (separator < 0) {
    return undefined;
  }
  const edgeIdentity = suffix.slice(0, separator);
  const endpoint = suffix.slice(separator + 1);
  if (endpoint !== "a" && endpoint !== "b") {
    return undefined;
  }
  const edgeMatch = /^(h|region)-(\d+)-(\d+)$/.exec(edgeIdentity);
  if (edgeMatch === null) {
    return undefined;
  }
  const edgeKind = edgeMatch[1];
  const a = Number(edgeMatch[2]);
  const b = Number(edgeMatch[3]);
  if (
    (edgeKind !== "h" && edgeKind !== "region") ||
    !Number.isSafeInteger(a) ||
    !Number.isSafeInteger(b) ||
    a < 0 ||
    b <= a ||
    a === b ||
    b >= context.logicalPopulation ||
    (edgeKind === "h" && logicalParentIndex(b) !== a) ||
    (edgeKind === "region" && (hasMaterializedGate === undefined || !hasMaterializedGate(gateId)))
  ) {
    return undefined;
  }
  return {
    a,
    b,
    endpoint,
    edgeIdentity,
    systemIndex: endpoint === "a" ? a : b,
    otherSystemIndex: endpoint === "a" ? b : a,
  };
}

function logicalEdge(a: number, b: number, context: GeneratorContext): GeneratedEdge {
  const left = Math.min(a, b);
  const right = Math.max(a, b);
  const leftPosition = generatedPosition(context, `generated-system:${left}`);
  const rightPosition = generatedPosition(context, `generated-system:${right}`);
  return {
    a: left,
    b: right,
    distance: positionDistance(leftPosition, rightPosition),
    kind: "backbone",
    identity: logicalEdgeIdentity(left, right),
  };
}

function logicalTreePath(
  start: number,
  destination: number,
  context: GeneratorContext,
): readonly GeneratedEdge[] {
  const startAncestors = new Map<number, number | undefined>();
  let current: number | undefined = start;
  while (current !== undefined) {
    startAncestors.set(current, logicalParentIndex(current));
    current = logicalParentIndex(current);
  }
  const destinationEdges: GeneratedEdge[] = [];
  current = destination;
  while (current !== undefined && !startAncestors.has(current)) {
    const parent = logicalParentIndex(current);
    if (parent === undefined) {
      break;
    }
    destinationEdges.push(logicalEdge(current, parent, context));
    current = parent;
  }
  if (current === undefined) {
    return Object.freeze(destinationEdges);
  }
  const common = current;
  const startEdges: GeneratedEdge[] = [];
  current = start;
  while (current !== common) {
    const parent = logicalParentIndex(current);
    if (parent === undefined) {
      break;
    }
    startEdges.push(logicalEdge(current, parent, context));
    current = parent;
  }
  return Object.freeze([...startEdges, ...destinationEdges.reverse()]);
}

function logicalShortcutAllowed(context: GeneratorContext, a: number, b: number): boolean {
  const hash = hashParts(
    context.seedIdentity,
    context.generatorVersion,
    "hierarchical-shortcut",
    a,
    b,
  );
  return hash % 32 === 0;
}

function logicalShortcutEdge(
  context: GeneratorContext,
  start: number,
  destination: number,
  level: number,
): GeneratedEdge | undefined {
  const a = Math.min(start, destination);
  const b = Math.max(start, destination);
  if (a === b || !logicalShortcutAllowed(context, a, b)) {
    return undefined;
  }
  const block = 2 ** Math.min(level + 1, 20);
  if (Math.floor(a / block) === Math.floor(b / block)) {
    return undefined;
  }
  const edge = logicalEdge(a, b, context);
  return { ...edge, kind: "shortcut", identity: `shortcut-${a}-${b}` };
}

function materializedLogicalIndices(
  node: ClusterRegionNode,
  requestedCount: number | undefined,
  requestedIndices: readonly number[] | undefined,
): readonly number[] {
  if (requestedIndices !== undefined) {
    if (
      requestedIndices.length < 2 ||
      requestedIndices.length > MAX_CLUSTER_MATERIALIZED_SYSTEM_COUNT
    ) {
      throw new RangeError(
        `logicalSystemIndices must contain between 2 and ${MAX_CLUSTER_MATERIALIZED_SYSTEM_COUNT} Systems.`,
      );
    }
    const unique = new Set<number>();
    for (const index of requestedIndices) {
      if (
        !Number.isSafeInteger(index) ||
        index < node.logicalSystemStart ||
        index >= node.logicalSystemStart + node.logicalSystemCount
      ) {
        throw new RangeError(
          `logicalSystemIndices must refer to Systems inside region ${node.id}.`,
        );
      }
      if (unique.has(index)) {
        throw new RangeError("logicalSystemIndices must not contain duplicates.");
      }
      unique.add(index);
    }
    return Object.freeze([...unique].sort((left, right) => left - right));
  }
  const count =
    requestedCount ?? Math.min(node.logicalSystemCount, DEFAULT_CLUSTER_MATERIALIZED_SYSTEM_COUNT);
  if (
    !Number.isSafeInteger(count) ||
    count < 2 ||
    count > MAX_CLUSTER_MATERIALIZED_SYSTEM_COUNT ||
    count > node.logicalSystemCount
  ) {
    throw new RangeError(
      `materializedSystemCount must be an integer from 2 through ${Math.min(MAX_CLUSTER_MATERIALIZED_SYSTEM_COUNT, node.logicalSystemCount)} for region ${node.id}.`,
    );
  }
  if (count === node.logicalSystemCount) {
    return Object.freeze(
      Array.from({ length: count }, (_, offset) => node.logicalSystemStart + offset),
    );
  }
  return Object.freeze(
    Array.from(
      { length: count },
      (_, offset) =>
        node.logicalSystemStart + Math.floor((offset * node.logicalSystemCount) / count),
    ),
  );
}

function regionNodeForId(root: ClusterRegionNode, id: StableId): ClusterRegionNode | undefined {
  if (root.id === id) {
    return root;
  }
  for (const child of root.children) {
    const match = regionNodeForId(child, id);
    if (match !== undefined) {
      return match;
    }
  }
  return undefined;
}

function buildOnDemandRegionEdges(
  context: GeneratorContext,
  points: readonly GeneratedPoint[],
): readonly GeneratedEdge[] {
  const sorted = [...points].sort((left, right) => left.index - right.index);
  const selected = new Set(sorted.map((point) => point.index));
  const edges = new Map<string, GeneratedEdge>();
  const add = (a: number, b: number, kind: GeneratedEdge["kind"], identity: string): void => {
    if (a === b || !selected.has(a) || !selected.has(b)) {
      return;
    }
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
    if (!edges.has(key)) {
      const base = logicalEdge(a, b, context);
      edges.set(key, { ...base, kind, identity });
    }
  };
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous !== undefined && current !== undefined) {
      add(previous.index, current.index, "backbone", `region-${previous.index}-${current.index}`);
    }
  }
  for (const point of sorted) {
    const parent = logicalParentIndex(point.index);
    if (parent !== undefined) {
      add(point.index, parent, "backbone", logicalEdgeIdentity(point.index, parent));
    }
  }
  return Object.freeze(
    [...edges.values()].sort((left, right) => {
      const tokenLeft = left.identity ?? "";
      const tokenRight = right.identity ?? "";
      return tokenLeft.localeCompare(tokenRight);
    }),
  );
}

function createHierarchicalRegion(
  request: ClusterGenerationRequest,
  context: GeneratorContext,
  control: WorkerPlanningExecutionControl | undefined = undefined,
): HierarchicalClusterRegion {
  const root = createRegionNode(context, 0, context.logicalPopulation, 0, []);
  const lastIndex = context.logicalPopulation - 1;
  const lastParent = logicalParentIndex(lastIndex) ?? 0;
  const defaultDepartureGateId = logicalGateId(context, 0, 1, "a");
  const defaultDestinationGateId = logicalGateId(context, lastParent, lastIndex, "b");
  const base = normalizeBaseScenario(request.canonicalScenario ?? request.baseScenario, context);
  const defaultShipProfileId = (base.shipProfiles[0]?.id ??
    request.shipProfiles?.[0]?.id ??
    "ship:generated-survey") as StableId;
  const sourceRequest = Object.freeze({
    ...request,
    shipProfiles:
      request.shipProfiles === undefined ? undefined : Object.freeze([...request.shipProfiles]),
  });
  const materializedGateIds = new Set<StableId>();
  const hasMaterializedGate = (gateId: StableId): boolean => materializedGateIds.has(gateId);
  function materialize(
    materializationRequest?: ClusterRegionMaterializationRequest,
  ): GeneratedClusterRegion {
    const generated = materializeHierarchicalRegion(
      context,
      sourceRequest,
      hierarchy,
      materializationRequest,
      control,
    );
    for (const gateId of generated.generatedGateIds) {
      materializedGateIds.add(gateId);
    }
    return generated;
  }
  const hierarchy: HierarchicalClusterRegion = Object.freeze({
    kind: "hierarchical-cluster-region" as const,
    seed: context.seed,
    seedLabel: context.seedLabel,
    seedIdentity: context.seedIdentity,
    seedHash: context.seedHash,
    generatorVersion: context.generatorVersion,
    logicalPopulation: context.logicalPopulation,
    materializedSystemCount: 0 as const,
    regionRadius: context.regionRadius,
    root,
    leafSystemCapacity: CLUSTER_REGION_LEAF_SYSTEM_CAPACITY,
    maxDepth: hierarchyDepth(root),
    defaultDepartureGateId,
    defaultDestinationGateId,
    defaultShipProfileId,
    sourceRequest,
    hasMaterializedGate,
    materialize,
    materializeRegion: materialize,
  });
  return hierarchy;
}

function materializeHierarchicalRegion(
  context: GeneratorContext,
  sourceRequest: ClusterGenerationRequest,
  hierarchy: HierarchicalClusterRegion,
  materializationRequest: ClusterRegionMaterializationRequest | undefined,
  control: WorkerPlanningExecutionControl | undefined = undefined,
): GeneratedClusterRegion {
  const requestedRegionId = materializationRequest?.regionId ?? hierarchy.root.id;
  const node = regionNodeForId(hierarchy.root, requestedRegionId);
  if (node === undefined) {
    throw new RangeError(`Unknown Cluster region node ${requestedRegionId}.`);
  }
  control?.checkpoint();
  const indices = materializedLogicalIndices(
    node,
    materializationRequest?.materializedSystemCount,
    materializationRequest?.logicalSystemIndices,
  );
  const materializedContext = Object.freeze({
    ...context,
    materializedSystemCount: indices.length,
  });
  const points = Object.freeze(
    indices.map((index) => ({
      index,
      id: generatedSystemId(materializedContext, index),
      position: generatedPosition(materializedContext, `generated-system:${index}`),
    })),
  );
  control?.checkpoint();
  const edges = buildOnDemandRegionEdges(materializedContext, points);
  const request: ClusterGenerationRequest = Object.freeze({
    ...sourceRequest,
    materializedSystemCount: indices.length,
    routeRequest: materializationRequest?.routeRequest ?? sourceRequest.routeRequest,
  });
  const base = normalizeBaseScenario(
    request.canonicalScenario ?? request.baseScenario,
    materializedContext,
  );
  return buildGeneratedRegionResult(
    materializedContext,
    request,
    base,
    hierarchy,
    node,
    indices,
    points,
    edges,
    control,
  );
}

function buildGeneratedRegionResult(
  context: GeneratorContext,
  request: ClusterGenerationRequest,
  base: NormalizedBase,
  hierarchy: HierarchicalClusterRegion,
  node: ClusterRegionNode,
  logicalSystemIndices: readonly number[],
  points: readonly GeneratedPoint[],
  edges: readonly GeneratedEdge[],
  control: WorkerPlanningExecutionControl | undefined = undefined,
): GeneratedClusterRegion {
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
  control?.checkpoint();
  const route = planJourney(
    scenario,
    control === undefined ? routeRequest : attachExecutionControl(routeRequest, control),
  );
  if (!route.ok && request.routeRequest === undefined) {
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
    regionId: node.id,
    regionDepth: node.depth,
    logicalSystemStart: node.logicalSystemStart,
    logicalSystemCount: node.logicalSystemCount,
    logicalSystemIndices: Object.freeze([...logicalSystemIndices]),
    hierarchy,
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
    materialize: hierarchy.materialize,
    materializeRegion: hierarchy.materialize,
  });
  trustedGeneratedRegions.add(region);
  return region;
}

/**
 * Creates a deterministic hierarchical Cluster descriptor without materializing its logical
 * Systems, Gates, or Gate Connections.
 *
 * @param request - Logical population, seed, generator version, and optional canonical base data.
 * @returns A frozen hierarchy whose finite nodes can be materialized on demand.
 */
export function generateHierarchicalCluster(
  request: ClusterGenerationRequest,
): HierarchicalClusterRegion {
  const context = buildContext(request);
  return createHierarchicalRegion(request, context, executionControlFor(request));
}

/**
 * Alias for {@link generateHierarchicalCluster} using region terminology.
 *
 * @param request - Logical population, seed, generator version, and optional canonical base data.
 * @returns A deterministic lazily materializable Cluster hierarchy.
 */
export const createHierarchicalCluster = generateHierarchicalCluster;

/**
 * Materializes one finite node or logical System selection from a hierarchical Cluster.
 *
 * @param region - A hierarchical descriptor or a previously materialized generated region.
 * @param request - Optional node, logical index, and finite materialization selection.
 * @returns A compiled finite region generated from the same stable seed and version.
 * @throws RangeError when the node or finite selection is invalid.
 */
export function materializeClusterRegion(
  region: HierarchicalClusterRegion | GeneratedClusterRegion,
  request?: ClusterRegionMaterializationRequest,
): GeneratedClusterRegion {
  return "hierarchy" in region
    ? region.hierarchy.materialize(request)
    : region.materialize(request);
}

function addClusterRouteIssue(
  issues: RoutePlanningIssue[],
  code: RoutePlanningIssue["code"],
  path: string,
  message: string,
  entityType: RoutePlanningIssue["entityType"] = undefined,
  entityId: StableId | undefined = undefined,
  relatedId: StableId | undefined = undefined,
): void {
  issues.push(
    Object.freeze({
      code,
      path,
      message,
      entityType,
      entityId,
      relatedId,
      causeCode: undefined,
    }),
  );
}

function readClusterRouteBudget(
  request: RecordValue,
  issues: RoutePlanningIssue[],
): ClusterRouteRefinementBudget | undefined {
  const rawBudget = isRecord(request.refinementBudget)
    ? request.refinementBudget
    : isRecord(request.refinement)
      ? request.refinement
      : request;
  const readInteger = (
    keys: readonly string[],
    defaultValue: number,
    minimum: number,
    maximum: number,
  ): number => {
    let value: unknown;
    for (const key of keys) {
      if (hasOwn(rawBudget, key)) {
        value = rawBudget[key];
        break;
      }
    }
    if (value === undefined && rawBudget !== request) {
      for (const key of keys) {
        if (hasOwn(request, key)) {
          value = request[key];
          break;
        }
      }
    }
    if (value === undefined) {
      return defaultValue;
    }
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < minimum ||
      value > maximum
    ) {
      addClusterRouteIssue(
        issues,
        "invalid-request",
        `request.${keys[0] ?? "refinement"}`,
        `request.${keys[0] ?? "refinement"} must be an integer from ${minimum} through ${maximum}.`,
      );
      return defaultValue;
    }
    return value;
  };
  const refinementDepth = readInteger(
    ["refinementDepth", "depth", "refinementLevel"],
    0,
    0,
    MAX_CLUSTER_ROUTE_REFINEMENT_DEPTH,
  );
  const maxMaterializedSystems = readInteger(
    ["maxMaterializedSystems", "materializedSystemBudget"],
    DEFAULT_CLUSTER_ROUTE_MATERIALIZED_SYSTEMS,
    2,
    MAX_CLUSTER_MATERIALIZED_SYSTEM_COUNT,
  );
  const maxCandidateRoutes = readInteger(
    ["maxCandidateRoutes", "candidateBudget"],
    Math.min(MAX_CLUSTER_ROUTE_CANDIDATES, refinementDepth + 1),
    1,
    MAX_CLUSTER_ROUTE_CANDIDATES,
  );
  if (issues.length > 0) {
    return undefined;
  }
  return Object.freeze({ refinementDepth, maxMaterializedSystems, maxCandidateRoutes });
}

function parseClusterRouteRequest(
  request: unknown,
  hierarchy: HierarchicalClusterRegion,
): ParsedHierarchicalRouteRequest | undefined {
  const issues: RoutePlanningIssue[] = [];
  if (!isRecord(request)) {
    addClusterRouteIssue(
      issues,
      "invalid-request",
      "request",
      "Cluster route request must be an object.",
    );
    return Object.freeze({
      routeRequest: {},
      departureGateId: hierarchy.defaultDepartureGateId,
      destinationGateId: hierarchy.defaultDestinationGateId,
      refinementBudget: Object.freeze({
        refinementDepth: 0,
        maxMaterializedSystems: DEFAULT_CLUSTER_ROUTE_MATERIALIZED_SYSTEMS,
        maxCandidateRoutes: 1,
      }),
      issues: Object.freeze(issues),
    });
  }
  const routeRequest = isRecord(request.routeRequest)
    ? request.routeRequest
    : isRecord(request.request) && !hasOwn(request, "departureGateId")
      ? request.request
      : request;
  const departureGateId = routeRequest.departureGateId;
  const destinationGateId = routeRequest.destinationGateId;
  if (typeof departureGateId !== "string" || typeof destinationGateId !== "string") {
    addClusterRouteIssue(
      issues,
      "invalid-request",
      "request.departureGateId",
      "Cluster route requests must select exact departureGateId and destinationGateId values.",
    );
  }
  const refinementBudget = readClusterRouteBudget(request, issues);
  const budget =
    refinementBudget ??
    Object.freeze({
      refinementDepth: 0,
      maxMaterializedSystems: DEFAULT_CLUSTER_ROUTE_MATERIALIZED_SYSTEMS,
      maxCandidateRoutes: 1,
    });
  const context = buildContext({
    logicalPopulation: hierarchy.logicalPopulation,
    materializedSystemCount: Math.min(hierarchy.logicalPopulation, budget.maxMaterializedSystems),
    seed: hierarchy.seed,
    generatorVersion: hierarchy.generatorVersion,
    regionRadius: hierarchy.regionRadius,
  });
  const canonicalGateIds = canonicalGateIdsForHierarchy(hierarchy, context);
  const departure =
    typeof departureGateId === "string"
      ? logicalGateReference(context, departureGateId as StableId, hierarchy.hasMaterializedGate)
      : undefined;
  const destination =
    typeof destinationGateId === "string"
      ? logicalGateReference(context, destinationGateId as StableId, hierarchy.hasMaterializedGate)
      : undefined;
  if (
    departure === undefined &&
    (typeof departureGateId !== "string" || !canonicalGateIds.has(departureGateId as StableId))
  ) {
    addClusterRouteIssue(
      issues,
      "unknown-gate",
      "request.departureGateId",
      "The selected departure Gate is not a deterministic hierarchical or canonical endpoint for this Scenario.",
      "gate",
      departureGateId as StableId | undefined,
    );
  }
  if (
    destination === undefined &&
    (typeof destinationGateId !== "string" || !canonicalGateIds.has(destinationGateId as StableId))
  ) {
    addClusterRouteIssue(
      issues,
      "unknown-gate",
      "request.destinationGateId",
      "The selected destination Gate is not a deterministic hierarchical or canonical endpoint for this Scenario.",
      "gate",
      destinationGateId as StableId | undefined,
    );
  }
  return Object.freeze({
    routeRequest,
    departureGateId: (departureGateId as StableId | undefined) ?? hierarchy.defaultDepartureGateId,
    destinationGateId:
      (destinationGateId as StableId | undefined) ?? hierarchy.defaultDestinationGateId,
    refinementBudget: budget,
    issues: Object.freeze(issues),
  });
}

function addLogicalCandidateEdge(
  edges: Map<string, GeneratedEdge>,
  edge: GeneratedEdge | undefined,
): void {
  if (edge === undefined) {
    return;
  }
  const key = `${edge.a}:${edge.b}:${edge.identity ?? ""}`;
  const existing = edges.get(key);
  if (existing === undefined || (existing.kind === "backbone" && edge.kind === "shortcut")) {
    edges.set(key, edge);
  }
}

type LogicalCandidate = {
  readonly edges: readonly GeneratedEdge[];
  readonly completedDepth: number;
  readonly candidateGraphEdgeCount: number;
  readonly addedRefinementEdgeCount: number;
};

type LogicalCandidateGraph = {
  readonly candidates: readonly LogicalCandidate[];
};

function logicalCandidateEdges(
  context: GeneratorContext,
  departure: LogicalGateReference,
  destination: LogicalGateReference,
  refinementDepth: number,
): LogicalCandidateGraph {
  const endpointEdges = new Map<string, GeneratedEdge>();
  addLogicalCandidateEdge(endpointEdges, {
    ...logicalEdge(departure.a, departure.b, context),
    identity: departure.edgeIdentity,
  });
  addLogicalCandidateEdge(endpointEdges, {
    ...logicalEdge(destination.a, destination.b, context),
    identity: destination.edgeIdentity,
  });
  const baseline = new Map<string, GeneratedEdge>();
  for (const edge of logicalTreePath(departure.systemIndex, destination.systemIndex, context)) {
    addLogicalCandidateEdge(baseline, edge);
  }
  for (const edge of endpointEdges.values()) {
    addLogicalCandidateEdge(baseline, edge);
  }
  const baselineCandidate: LogicalCandidate = Object.freeze({
    edges: Object.freeze([...baseline.values()]),
    completedDepth: 0,
    candidateGraphEdgeCount: baseline.size,
    addedRefinementEdgeCount: 0,
  });
  if (refinementDepth === 0) {
    return { candidates: Object.freeze([baselineCandidate]) };
  }

  const refined = new Map(baseline);
  let addedRefinementEdgeCount = 0;
  // The baseline candidate is deliberately retained as the first candidate. Deeper candidates
  // add edges cumulatively, so a supplemental search can never discard a feasible baseline plan.
  for (let level = 1; level <= refinementDepth; level += 1) {
    const edgeCountBeforeLevel = refined.size;
    const start = level % 2 === 0 ? departure.systemIndex : departure.otherSystemIndex;
    const destinationIndex =
      level % 2 === 0 ? destination.otherSystemIndex : destination.systemIndex;
    addLogicalCandidateEdge(refined, logicalShortcutEdge(context, start, destinationIndex, level));
    const startParent = logicalParentIndex(start);
    const destinationParent = logicalParentIndex(destinationIndex);
    if (startParent !== undefined && destinationParent !== undefined) {
      addLogicalCandidateEdge(
        refined,
        logicalShortcutEdge(context, startParent, destinationParent, level),
      );
    }
    addedRefinementEdgeCount += refined.size - edgeCountBeforeLevel;
  }
  if (refined.size === baseline.size) {
    return {
      candidates: Object.freeze([
        Object.freeze({ ...baselineCandidate, completedDepth: refinementDepth }),
      ]),
    };
  }
  const refinedCandidate: LogicalCandidate = Object.freeze({
    edges: Object.freeze([...refined.values()]),
    completedDepth: refinementDepth,
    candidateGraphEdgeCount: refined.size,
    addedRefinementEdgeCount,
  });
  return { candidates: Object.freeze([baselineCandidate, refinedCandidate]) };
}

function routeCandidateLimit(request: Readonly<Record<string, unknown>>): number | undefined {
  const suppliedBudget = request.searchBudget;
  const candidateValue =
    typeof suppliedBudget === "number"
      ? suppliedBudget
      : isRecord(suppliedBudget)
        ? (suppliedBudget.maxCandidateRoutes ?? suppliedBudget.maxCandidates)
        : undefined;
  return typeof candidateValue === "number" &&
    Number.isSafeInteger(candidateValue) &&
    candidateValue > 0
    ? candidateValue
    : undefined;
}

function routeRequestWithBoundedCandidateBudget(
  request: Readonly<Record<string, unknown>>,
  budget: ClusterRouteRefinementBudget,
  candidateLimit: number,
): Readonly<Record<string, unknown>> {
  const suppliedBudget = request.searchBudget;
  if (isRecord(suppliedBudget)) {
    const suppliedCandidateLimit =
      suppliedBudget.maxCandidateRoutes ?? suppliedBudget.maxCandidates;
    const maxCandidateRoutes =
      suppliedCandidateLimit === undefined
        ? candidateLimit
        : typeof suppliedCandidateLimit === "number" && Number.isSafeInteger(suppliedCandidateLimit)
          ? Math.min(candidateLimit, suppliedCandidateLimit)
          : suppliedCandidateLimit;
    return Object.freeze({
      ...request,
      searchBudget: Object.freeze({
        ...suppliedBudget,
        maxCandidateRoutes,
      }),
    });
  }
  if (typeof suppliedBudget === "number") {
    const boundedCandidateLimit =
      Number.isSafeInteger(suppliedBudget) && suppliedBudget > 0
        ? Math.min(candidateLimit, suppliedBudget)
        : suppliedBudget;
    return Object.freeze({
      ...request,
      searchBudget: boundedCandidateLimit,
    });
  }
  return Object.freeze({
    ...request,
    searchBudget: Object.freeze({
      maxCandidateRoutes: candidateLimit,
      maxSearchStates: Math.min(10_000, Math.max(256, budget.maxMaterializedSystems * 8)),
    }),
  });
}

function scenarioForLogicalCandidate(
  hierarchy: HierarchicalClusterRegion,
  routeRequest: Readonly<Record<string, unknown>>,
  context: GeneratorContext,
  departure: LogicalGateReference,
  destination: LogicalGateReference,
  edges: readonly GeneratedEdge[],
): CompiledScenario | undefined {
  const indices = new Set<number>([departure.a, departure.b, destination.a, destination.b]);
  for (const edge of edges) {
    indices.add(edge.a);
    indices.add(edge.b);
  }
  const logicalSystemIndices = [...indices].sort((left, right) => left - right);
  if (logicalSystemIndices.length > MAX_CLUSTER_MATERIALIZED_SYSTEM_COUNT) {
    return undefined;
  }
  const points = Object.freeze(
    logicalSystemIndices.map((index) => ({
      index,
      id: generatedSystemId(context, index),
      position: generatedPosition(context, `generated-system:${index}`),
    })),
  );
  const records = createGeneratedRecords(context, points, edges);
  const sourceRequest = hierarchy.sourceRequest;
  const base = normalizeBaseScenario(
    sourceRequest.canonicalScenario ?? sourceRequest.baseScenario,
    context,
  );
  const recordsWithCanonical = attachUnpairedCanonicalGates(
    context,
    records,
    base.gates,
    base.connections,
  );
  assertGeneratedIdCollisions(
    base,
    recordsWithCanonical,
    base.shipProfiles.length === 0 && sourceRequest.shipProfiles === undefined,
  );
  const request: ClusterGenerationRequest = {
    ...sourceRequest,
    logicalPopulation: hierarchy.logicalPopulation,
    materializedSystemCount: points.length,
    seed: hierarchy.seed,
    generatorVersion: hierarchy.generatorVersion,
    regionRadius: hierarchy.regionRadius,
    routeRequest,
  };
  const statistics = buildStatistics(context, points);
  const scenarioInput = scenarioInputForRegion(
    request,
    context,
    base,
    recordsWithCanonical,
    statistics,
  );
  const compiled = compileScenario(scenarioInput);
  return compiled.ok ? compiled.scenario : undefined;
}

function logicalArrivalBounds(
  context: GeneratorContext,
  request: Readonly<Record<string, unknown>>,
  plan: RoutePlan,
  departure: LogicalGateReference,
  destination: LogicalGateReference,
): ClusterRouteBounds {
  const departureCoordinateTime =
    isRecord(request.departureCoordinateTime) &&
    request.departureCoordinateTime.unit === "s" &&
    typeof request.departureCoordinateTime.value === "number" &&
    Number.isFinite(request.departureCoordinateTime.value)
      ? request.departureCoordinateTime.value
      : 0;
  const hasUncertainty = plan.uncertainty.hasUncertainty;
  const departurePosition = positionWithOffset(
    generatedPosition(context, `generated-system:${departure.systemIndex}`),
    gateOffset(context, logicalEdgeIdentity(departure.a, departure.b), departure.endpoint),
  );
  const destinationPosition = positionWithOffset(
    generatedPosition(context, `generated-system:${destination.systemIndex}`),
    gateOffset(context, logicalEdgeIdentity(destination.a, destination.b), destination.endpoint),
  );
  const lower = seconds(
    departureCoordinateTime +
      Math.min(
        plan.arrivalCoordinateTime.value - departureCoordinateTime,
        positionDistance(departurePosition, destinationPosition) / SPEED_OF_LIGHT.value,
      ),
  );
  const earliestArrivalLowerBound = hasUncertainty ? seconds(departureCoordinateTime) : lower;
  const bestKnownUpperBound = plan.arrivalCoordinateTime;
  return Object.freeze({
    earliestArrivalLowerBound,
    bestKnownUpperBound,
    lowerBound: earliestArrivalLowerBound,
    upperBound: bestKnownUpperBound,
    conservativeUpperBound: plan.arrivalBounds.upper,
    gap: seconds(Math.max(0, bestKnownUpperBound.value - earliestArrivalLowerBound.value)),
    lowerBoundMethod: hasUncertainty ? "zero-duration" : "straight-line-light-speed",
    upperBoundMethod: "simulated-route",
  });
}

function boundedClusterFailure(
  outcome: ClusterRoutePlanningFailure["outcome"],
  issues: readonly RoutePlanningIssue[],
  search: ClusterRoutePlanningSearchStats | undefined,
): ClusterRoutePlanningFailure {
  return Object.freeze({
    kind: "cluster-route-planning" as const,
    ok: false as const,
    outcome,
    plan: undefined,
    bestPlan: undefined,
    alternatives: Object.freeze([] as const),
    sensitivity: Object.freeze([] as const),
    sensitivityAlternatives: Object.freeze([] as const),
    bounds: undefined,
    earliestArrivalLowerBound: undefined,
    bestKnownUpperBound: undefined,
    lowerBound: undefined,
    upperBound: undefined,
    conservativeUpperBound: undefined,
    refinementQuality: undefined,
    refinementScore: undefined,
    refinement: undefined,
    globallyOptimal: false as const,
    optimality: undefined,
    search,
    issues: Object.freeze([...issues]),
  });
}

type ClusterRouteEvaluation = {
  readonly bestPlan: RoutePlan;
  readonly bestBounds: ClusterRouteBounds;
  readonly alternatives: readonly RoutePlan[];
  readonly sensitivity: readonly RouteSensitivity[];
  readonly sensitivityAlternatives: readonly RouteSensitivity[];
  readonly search: ClusterRoutePlanningSearchStats;
};

function canonicalArrivalBounds(plan: RoutePlan): ClusterRouteBounds {
  const earliestArrivalLowerBound = plan.earliestArrivalLowerBound;
  const bestKnownUpperBound = plan.bestKnownUpperBound;
  return Object.freeze({
    earliestArrivalLowerBound,
    bestKnownUpperBound,
    lowerBound: earliestArrivalLowerBound,
    upperBound: bestKnownUpperBound,
    conservativeUpperBound: plan.arrivalBounds.upper,
    gap: seconds(Math.max(0, bestKnownUpperBound.value - earliestArrivalLowerBound.value)),
    lowerBoundMethod: "zero-duration" as const,
    upperBoundMethod: "simulated-route" as const,
  });
}

function boundedClusterSuccess(
  evaluation: ClusterRouteEvaluation,
  requestedDepth: number,
  completedDepth: number,
  searchExhausted: boolean,
): ClusterRoutePlanningSuccess {
  const alternatives = [...evaluation.alternatives];
  alternatives.sort((left, right) => {
    const arrival = left.arrivalCoordinateTime.value - right.arrivalCoordinateTime.value;
    return arrival !== 0
      ? arrival
      : `${left.gateIds.join(">")}|${left.connectionIds.join(">")}`.localeCompare(
          `${right.gateIds.join(">")}|${right.connectionIds.join(">")}`,
        );
  });
  const lowerBound = evaluation.bestBounds.earliestArrivalLowerBound;
  const upperBound = evaluation.bestBounds.bestKnownUpperBound;
  const boundGap = seconds(Math.max(0, upperBound.value - lowerBound.value));
  const boundScale = Math.max(1, Math.abs(upperBound.value), Math.abs(lowerBound.value));
  const refinementScore = Math.max(0, Math.min(1, 1 - boundGap.value / boundScale));
  const boundedPlan = Object.freeze({
    ...evaluation.bestPlan,
    refinementQuality: "hierarchical-bounded" as const,
    refinementScore,
    globallyOptimal: false as const,
    optimality: "best-known-upper-bound" as const,
    earliestArrivalLowerBound: lowerBound,
    bestKnownUpperBound: upperBound,
    lowerBound,
    upperBound,
  });
  const bounds = conservativeBounds(
    upperBound,
    lowerBound,
    seconds(Math.max(upperBound.value, evaluation.bestBounds.conservativeUpperBound.value)),
    evaluation.bestPlan.timeline.displayPrecision,
  );
  const refinement = Object.freeze({
    kind: "hierarchical-bounded" as const,
    requestedDepth,
    completedDepth,
    score: refinementScore,
    boundGap,
    candidateGraphEdgeCount: evaluation.search.candidateGraphEdgeCount,
    addedRefinementEdgeCount: evaluation.search.addedRefinementEdgeCount,
    searchExhausted,
    globallyOptimal: false as const,
    optimality: "best-known-upper-bound" as const,
    proof: "bounded-candidate-search" as const,
  });
  return Object.freeze({
    kind: "cluster-route-planning" as const,
    ok: true as const,
    outcome: "success" as const,
    plan: boundedPlan,
    bestPlan: boundedPlan,
    alternatives: Object.freeze(alternatives.slice(0, 10)),
    sensitivity: evaluation.sensitivity,
    sensitivityAlternatives: evaluation.sensitivityAlternatives,
    bounds,
    earliestArrivalLowerBound: lowerBound,
    bestKnownUpperBound: upperBound,
    lowerBound,
    upperBound,
    conservativeUpperBound: evaluation.bestBounds.conservativeUpperBound,
    refinementQuality: "hierarchical-bounded" as const,
    refinementScore,
    refinement,
    globallyOptimal: false as const,
    optimality: "best-known-upper-bound" as const,
    search: evaluation.search,
    issues: [] as const,
  });
}

/**
 * Plans a bounded route through a logical hierarchical Cluster population.
 *
 * Only exact endpoint Gates and the finite candidate paths selected by `refinementDepth` are
 * materialized. Candidate simulation is delegated to `planJourney`, preserving uncertainty,
 * Provenance filters, strategic-wait limits, and explicit Gate endpoint semantics. The result is
 * a feasible upper bound and never a claim of global optimality.
 *
 * @param hierarchy - A deterministic logical Cluster descriptor.
 * @param request - Exact Gate endpoints, route controls, and finite refinement controls.
 * @returns A bounded Route Plan with independently checkable arrival bounds or a structured failure.
 */
export function planClusterRoute(
  hierarchy: HierarchicalClusterRegion,
  request: ClusterRoutePlanningRequest,
): ClusterRoutePlanningResult;
export function planClusterRoute(
  hierarchy: HierarchicalClusterRegion,
  request: unknown,
): ClusterRoutePlanningResult;
export function planClusterRoute(
  hierarchy: HierarchicalClusterRegion,
  request: unknown,
): ClusterRoutePlanningResult {
  const control = executionControlFor(request);
  const parsed = parseClusterRouteRequest(request, hierarchy);
  if (parsed === undefined || parsed.issues.length > 0) {
    return boundedClusterFailure(
      "invalid",
      parsed?.issues ?? [
        {
          code: "invalid-request",
          path: "request",
          message: "The logical Cluster route request is invalid.",
          entityType: undefined,
          entityId: undefined,
          relatedId: undefined,
          causeCode: undefined,
        },
      ],
      undefined,
    );
  }
  const context = buildContext({
    logicalPopulation: hierarchy.logicalPopulation,
    materializedSystemCount: parsed.refinementBudget.maxMaterializedSystems,
    seed: hierarchy.seed,
    generatorVersion: hierarchy.generatorVersion,
    regionRadius: hierarchy.regionRadius,
  });
  const canonicalGateIds = canonicalGateIdsForHierarchy(hierarchy, context);
  const departureIsCanonical = canonicalGateIds.has(parsed.departureGateId);
  const destinationIsCanonical = canonicalGateIds.has(parsed.destinationGateId);
  const departure = departureIsCanonical
    ? undefined
    : logicalGateReference(context, parsed.departureGateId, hierarchy.hasMaterializedGate);
  const destination = destinationIsCanonical
    ? undefined
    : logicalGateReference(context, parsed.destinationGateId, hierarchy.hasMaterializedGate);
  if (departureIsCanonical !== destinationIsCanonical) {
    return boundedClusterFailure(
      "invalid",
      [
        {
          code: "invalid-request",
          path: "request",
          message:
            "Mixed canonical and generated hierarchical Gate endpoints are not supported by one bounded candidate graph.",
          entityType: "gate",
          entityId: parsed.departureGateId,
          relatedId: parsed.destinationGateId,
          causeCode: undefined,
        },
      ],
      undefined,
    );
  }
  if (departureIsCanonical && destinationIsCanonical) {
    const candidateRouteLimit = Math.min(
      parsed.refinementBudget.maxCandidateRoutes,
      routeCandidateLimit(parsed.routeRequest) ?? parsed.refinementBudget.maxCandidateRoutes,
    );
    const candidateRouteRequest = routeRequestWithBoundedCandidateBudget(
      parsed.routeRequest,
      parsed.refinementBudget,
      candidateRouteLimit,
    );
    const canonicalScenario = scenarioForCanonicalCandidate(
      hierarchy,
      candidateRouteRequest,
      context,
    );
    const searchBase = {
      refinementDepth: parsed.refinementBudget.refinementDepth,
      completedRefinementDepth: 0,
      candidateGraphEdgeCount: canonicalScenario?.gateConnections.length ?? 0,
      addedRefinementEdgeCount: 0,
      candidateRoutesEvaluated: 0,
      materializedRegionCount: 0,
      materializedSystemCount: canonicalScenario?.systems.length ?? 0,
      budget: parsed.refinementBudget,
      candidateRouteKeys: Object.freeze([
        `canonical:${parsed.departureGateId}>${parsed.destinationGateId}`,
      ]),
    } satisfies ClusterRoutePlanningSearchStats;
    if (canonicalScenario === undefined) {
      return boundedClusterFailure(
        "invalid",
        [
          {
            code: "no-valid-route",
            path: "scenario",
            message:
              "The canonical/base Scenario could not be compiled for bounded route planning.",
            entityType: undefined,
            entityId: undefined,
            relatedId: undefined,
            causeCode: undefined,
          },
        ],
        Object.freeze(searchBase),
      );
    }
    const explicit = planJourney(
      canonicalScenario,
      control === undefined
        ? candidateRouteRequest
        : attachExecutionControl(candidateRouteRequest, control),
    );
    const search = Object.freeze({
      ...searchBase,
      candidateRoutesEvaluated: explicit.search?.candidateRoutesEvaluated ?? 0,
    });
    if (!explicit.ok) {
      return boundedClusterFailure(explicit.outcome, explicit.issues, search);
    }
    return boundedClusterSuccess(
      {
        bestPlan: explicit.plan,
        bestBounds: canonicalArrivalBounds(explicit.plan),
        alternatives: explicit.alternatives,
        sensitivity: explicit.sensitivity,
        sensitivityAlternatives: explicit.sensitivityAlternatives,
        search,
      },
      parsed.refinementBudget.refinementDepth,
      0,
      false,
    );
  }
  if (departure === undefined || destination === undefined) {
    return boundedClusterFailure(
      "invalid",
      [
        {
          code: "unknown-gate",
          path: "request.departureGateId",
          message: "The selected hierarchical Gate endpoint is not known for this Scenario.",
          entityType: "gate",
          entityId: parsed.departureGateId,
          relatedId: parsed.destinationGateId,
          causeCode: undefined,
        },
      ],
      undefined,
    );
  }
  const candidateGraph = logicalCandidateEdges(
    context,
    departure,
    destination,
    parsed.refinementBudget.refinementDepth,
  );
  const candidateCandidates = candidateGraph.candidates.slice(
    0,
    parsed.refinementBudget.maxCandidateRoutes,
  );
  const suppliedCandidateLimit = routeCandidateLimit(parsed.routeRequest);
  const totalCandidateRouteBudget = Math.min(
    parsed.refinementBudget.maxCandidateRoutes,
    suppliedCandidateLimit ?? parsed.refinementBudget.maxCandidateRoutes,
  );
  const candidateRouteKeys: string[] = [];
  let candidateRoutesEvaluated = 0;
  let materializedRegionCount = 0;
  let materializedSystemCount = 0;
  let evaluatedGraphEdgeCount = 0;
  let evaluatedAddedRefinementEdgeCount = 0;
  let completedRefinementDepth = 0;
  let remainingCandidateRouteBudget = totalCandidateRouteBudget;
  let supplementalSearchExhausted = candidateCandidates.length < candidateGraph.candidates.length;
  let bestPlan: RoutePlan | undefined;
  let bestBounds: ClusterRouteBounds | undefined;
  let bestSensitivity: readonly RouteSensitivity[] = Object.freeze([]);
  let bestSensitivityAlternatives: readonly RouteSensitivity[] = Object.freeze([]);
  const alternatives: RoutePlan[] = [];
  const routeIssues: RoutePlanningIssue[] = [];
  let sawDisconnected = false;
  let sawIncomplete = false;
  for (let candidateIndex = 0; candidateIndex < candidateCandidates.length; candidateIndex += 1) {
    control?.checkpoint();
    const candidate = candidateCandidates[candidateIndex];
    if (candidate === undefined) {
      continue;
    }
    if (remainingCandidateRouteBudget <= 0) {
      supplementalSearchExhausted = candidateIndex > 0;
      break;
    }
    const systems = new Set<number>([departure.a, departure.b, destination.a, destination.b]);
    for (const edge of candidate.edges) {
      systems.add(edge.a);
      systems.add(edge.b);
    }
    if (systems.size > parsed.refinementBudget.maxMaterializedSystems) {
      supplementalSearchExhausted ||= candidateIndex > 0;
      continue;
    }
    materializedRegionCount += 1;
    materializedSystemCount += systems.size;
    evaluatedGraphEdgeCount = Math.max(evaluatedGraphEdgeCount, candidate.candidateGraphEdgeCount);
    evaluatedAddedRefinementEdgeCount = Math.max(
      evaluatedAddedRefinementEdgeCount,
      candidate.addedRefinementEdgeCount,
    );
    candidateRouteKeys.push(
      candidate.edges
        .map((edge) => edge.identity ?? `${edge.a}-${edge.b}`)
        .sort()
        .join(","),
    );
    const candidateRouteRequest = routeRequestWithBoundedCandidateBudget(
      parsed.routeRequest,
      parsed.refinementBudget,
      remainingCandidateRouteBudget,
    );
    const candidateScenario = scenarioForLogicalCandidate(
      hierarchy,
      candidateRouteRequest,
      Object.freeze({ ...context, materializedSystemCount: systems.size }),
      departure,
      destination,
      candidate.edges,
    );
    if (candidateScenario === undefined) {
      supplementalSearchExhausted ||= candidateIndex > 0;
      continue;
    }
    const explicit = planJourney(
      candidateScenario,
      control === undefined
        ? candidateRouteRequest
        : attachExecutionControl(candidateRouteRequest, control),
    );
    const evaluatedByPlanner = explicit.search?.candidateRoutesEvaluated ?? 0;
    candidateRoutesEvaluated += evaluatedByPlanner;
    remainingCandidateRouteBudget = Math.max(0, remainingCandidateRouteBudget - evaluatedByPlanner);
    if (!explicit.ok) {
      sawDisconnected ||= explicit.outcome === "disconnected";
      sawIncomplete ||= explicit.outcome === "incomplete";
      supplementalSearchExhausted ||= explicit.outcome === "incomplete";
      routeIssues.push(...explicit.issues);
      continue;
    }
    completedRefinementDepth = Math.max(completedRefinementDepth, candidate.completedDepth);
    const candidatePlan = explicit.plan;
    const candidateBounds = logicalArrivalBounds(
      context,
      candidateRouteRequest,
      candidatePlan,
      departure,
      destination,
    );
    if (
      bestPlan === undefined ||
      candidatePlan.arrivalCoordinateTime.value < bestPlan.arrivalCoordinateTime.value
    ) {
      if (bestPlan !== undefined) {
        alternatives.push(bestPlan);
      }
      bestPlan = candidatePlan;
      bestBounds = candidateBounds;
      bestSensitivity = explicit.sensitivity;
      bestSensitivityAlternatives = explicit.sensitivityAlternatives;
    } else {
      alternatives.push(candidatePlan);
    }
    if (remainingCandidateRouteBudget <= 0 && candidateIndex < candidateCandidates.length - 1) {
      supplementalSearchExhausted = true;
    }
  }
  const search = Object.freeze({
    refinementDepth: parsed.refinementBudget.refinementDepth,
    completedRefinementDepth,
    candidateGraphEdgeCount: evaluatedGraphEdgeCount,
    addedRefinementEdgeCount: evaluatedAddedRefinementEdgeCount,
    candidateRoutesEvaluated,
    materializedRegionCount,
    materializedSystemCount,
    budget: parsed.refinementBudget,
    candidateRouteKeys: Object.freeze(candidateRouteKeys),
  });
  if (bestPlan === undefined || bestBounds === undefined) {
    const outcome: ClusterRoutePlanningFailure["outcome"] =
      candidateRouteKeys.length < candidateCandidates.length || sawIncomplete
        ? "incomplete"
        : sawDisconnected
          ? "disconnected"
          : "invalid";
    return boundedClusterFailure(
      outcome,
      routeIssues.length > 0
        ? routeIssues
        : [
            {
              code: "no-valid-route",
              path: "routes",
              message: "No bounded hierarchical candidate produced a valid Route Plan.",
              entityType: undefined,
              entityId: undefined,
              relatedId: undefined,
              causeCode: undefined,
            },
          ],
      search,
    );
  }
  return boundedClusterSuccess(
    {
      bestPlan,
      bestBounds,
      alternatives,
      sensitivity: bestSensitivity,
      sensitivityAlternatives: bestSensitivityAlternatives,
      search,
    },
    parsed.refinementBudget.refinementDepth,
    completedRefinementDepth,
    supplementalSearchExhausted,
  );
}

/**
 * Alias for {@link planClusterRoute} using hierarchical-route terminology.
 *
 * @param hierarchy - A deterministic logical Cluster descriptor.
 * @param request - Exact Gate endpoints and finite route controls.
 * @returns The bounded logical route result.
 */
export const planHierarchicalRoute = planClusterRoute;

/**
 * Alias for {@link planClusterRoute} for generated-region callers.
 *
 * @param hierarchy - A deterministic logical Cluster descriptor.
 * @param request - Exact Gate endpoints and finite route controls.
 * @returns The bounded logical route result.
 */
export const planGeneratedClusterRoute = planClusterRoute;

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
  const control = executionControlFor(request);
  const context = buildContext(request);
  control?.checkpoint();
  const hierarchy = createHierarchicalRegion(request, context, control);
  const baseValue = request.canonicalScenario ?? request.baseScenario;
  const base = normalizeBaseScenario(baseValue, context);
  const points = createPoints(context);
  control?.checkpoint();
  const backbone = buildBackbone(points, control);
  control?.checkpoint();
  const shortcuts = buildShortcuts(context, points, backbone, control);
  const edges = Object.freeze([...backbone, ...shortcuts]);
  return buildGeneratedRegionResult(
    context,
    request,
    base,
    hierarchy,
    hierarchy.root,
    Object.freeze(points.map((point) => point.index)),
    points,
    edges,
    control,
  );
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
