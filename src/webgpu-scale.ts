import { generatedClusterSystemId, type ClusterGenerationSeed } from "./cluster-generation";
import {
  createScenarioSeed,
  type ScenarioSeed,
  type ScenarioSeedInput,
  type StableId,
} from "./model";

/**
 * Version of the CPU/GPU Cluster point conformance contract.
 *
 * This is deliberately separate from `globular-v1`: it versions the bounded GPU point encoding,
 * not the existing CPU Scenario generator identity. A new GPU contract must never rewrite a
 * persisted CPU generator version.
 */
export const WEBGPU_CLUSTER_CONFORMANCE_VERSION = "gpu-cluster-lod-v1" as const;

/**
 * Version of the repeatable one-million-point benchmark schema and scene.
 */
export const WEBGPU_SCALE_BENCHMARK_VERSION = "webgpu-million-points-v1" as const;

/**
 * WGSL workgroup size used by the bounded point-generation and culling compute pass.
 */
export const WEBGPU_SCALE_WORKGROUP_SIZE = 64;

/**
 * Maximum number of generated points that one GPU frame may compact and draw.
 */
export const MAX_WEBGPU_VISIBLE_POINTS = 1_000_000;

/**
 * Fixed warm-up window used by the real browser benchmark.
 */
export const WEBGPU_BENCHMARK_WARMUP_FRAME_COUNT = 30;

/**
 * Fixed measured window used by the real browser benchmark.
 */
export const WEBGPU_BENCHMARK_SAMPLE_FRAME_COUNT = 60;

/**
 * Maximum UTF-16 code units retained for exact GPU seed-identity conformance.
 */
export const MAX_WEBGPU_SEED_CODE_UNITS = 4_096;

/**
 * Aligned byte stride of one generated point in the GPU storage buffer.
 */
export const WEBGPU_POINT_STRIDE_BYTES = 32;

/**
 * Byte size of the indirect point-list draw command.
 */
export const WEBGPU_INDIRECT_DRAW_BYTES = 16;

/**
 * Uniform allocation size. The shader contract reserves a full WebGPU dynamic-alignment block.
 */
export const WEBGPU_SCALE_UNIFORM_BYTES = 256;

/**
 * Hard cap for all persistent GPU buffers in the bounded scale renderer.
 */
export const MAX_WEBGPU_SCALE_BUFFER_BYTES =
  MAX_WEBGPU_VISIBLE_POINTS * WEBGPU_POINT_STRIDE_BYTES +
  WEBGPU_INDIRECT_DRAW_BYTES +
  WEBGPU_SCALE_UNIFORM_BYTES +
  MAX_WEBGPU_SEED_CODE_UNITS * Uint32Array.BYTES_PER_ELEMENT;

/**
 * Maximum normalized position disagreement permitted between WGSL and the f32 CPU reference.
 */
export const WEBGPU_POSITION_ABSOLUTE_TOLERANCE = 2e-5;

/**
 * A logical Cluster source accepted by the GPU LOD contract.
 */
export type WebGpuScaleSource = {
  readonly logicalPopulation: number;
  readonly seed: ScenarioSeedInput;
  readonly generatorVersion: string;
  readonly regionRadiusMeters: number;
};

/**
 * The normalized seed and encoding data uploaded to a GPU point-generation pass.
 */
export type WebGpuScaleContract = {
  readonly contractVersion: typeof WEBGPU_CLUSTER_CONFORMANCE_VERSION;
  readonly generatorVersion: string;
  readonly seed: ScenarioSeed;
  readonly seedType: "number" | "string";
  readonly seedText: string;
  readonly seedIdentity: string;
  readonly seedCodeUnits: readonly number[];
  readonly seedHash: number;
  readonly seedTextHash: number;
  readonly pointHash: number;
  readonly pointTextHash: number;
  readonly logicalPopulation: number;
  readonly regionRadiusMeters: number;
};

/**
 * A collision-safe numeric key emitted by the GPU for host-side public-ID resolution.
 *
 * Hashes are routing guards only. The active contract's exact seed identity and logical index are
 * always used to derive the public StableId, so two colliding numeric hashes cannot share a global
 * JavaScript identity map.
 */
export type WebGpuPackedStableKey = {
  readonly seedHash: number;
  readonly seedTextHash: number;
  readonly logicalIndex: number;
};

/**
 * One deterministic CPU reference point for the WGSL-compatible dense Cluster cloud.
 */
export type WebGpuReferencePoint = {
  readonly logicalIndex: number;
  readonly stableKey: WebGpuPackedStableKey;
  readonly normalizedPosition: readonly [number, number, number];
  readonly positionMeters: readonly [number, number, number];
  readonly publicStableId: StableId;
};

/**
 * One checked-in point fixture shared by CPU conformance tests and the WGSL shader contract.
 */
export type WebGpuConformanceFixture = {
  readonly id: string;
  readonly logicalPopulation: number;
  readonly seed: ScenarioSeedInput;
  readonly generatorVersion: string;
  readonly regionRadiusMeters: number;
  readonly expected: readonly {
    readonly logicalIndex: number;
    readonly seedHash: number;
    readonly seedTextHash: number;
    readonly normalizedPosition: readonly [number, number, number];
    readonly publicStableId: StableId;
  }[];
};

/**
 * One normalized plane in a six-plane view frustum.
 */
export type WebGpuFrustumPlane = readonly [number, number, number, number];

/**
 * A bounded Cluster camera view used by pure LOD and culling seams.
 */
export type WebGpuClusterView = {
  readonly viewProjectionMatrix: readonly number[];
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly cameraDistance: number;
  readonly far: number;
  /** Physical radius represented by one normalized view-space unit; omitted means contract radius. */
  readonly worldRadiusMeters?: number | undefined;
};

/**
 * One logical index range selected for a GPU dispatch. It contains no per-point JavaScript objects.
 */
export type WebGpuLodRange = {
  readonly logicalStart: number;
  readonly logicalCount: number;
  readonly logicalStride: number;
};

/**
 * Result of selecting the detail level and bounded candidate count for one Cluster view.
 */
export type WebGpuLodSelection = {
  readonly level: number;
  readonly apparentRadiusPixels: number;
  readonly range: WebGpuLodRange;
  readonly candidateCount: number;
  readonly visibleCapacity: number;
  readonly dispatchWorkgroups: number;
};

/**
 * Request values used to calculate fixed GPU resource allocations.
 */
export type WebGpuResourceBudgetRequest = {
  readonly candidateCount: number;
  readonly visibleCapacity: number;
  readonly seedCodeUnitCount: number;
  readonly maxBufferSize: number;
};

/**
 * Fixed memory and dispatch accounting for one GPU frame.
 */
export type WebGpuResourceBudget = {
  readonly pointBufferBytes: number;
  readonly indirectBufferBytes: number;
  readonly uniformBufferBytes: number;
  readonly seedBufferBytes: number;
  readonly totalBufferBytes: number;
  readonly pointStrideBytes: typeof WEBGPU_POINT_STRIDE_BYTES;
  readonly visibleCapacity: number;
  readonly candidateCount: number;
  readonly dispatchWorkgroups: number;
  readonly workgroupSize: typeof WEBGPU_SCALE_WORKGROUP_SIZE;
  readonly maxBufferSize: number;
};

/**
 * The complete bounded preparation passed from a Cluster view to the WebGPU renderer.
 */
export type WebGpuScalePreparation = {
  readonly contract: WebGpuScaleContract;
  readonly view: WebGpuClusterView;
  readonly frustumPlanes: readonly WebGpuFrustumPlane[];
  readonly lod: WebGpuLodSelection;
  readonly budget: WebGpuResourceBudget;
};

const trustedWebGpuScalePreparations = new WeakSet<object>();

/**
 * Checks the private preparation brand without reading any property from the supplied value.
 *
 * A renderer boundary must call this before inspecting a preparation. `WeakSet.has` does not
 * invoke Proxy traps, so spoofed or adversarial objects are rejected without crossing their graph.
 */
export function isTrustedWebGpuScalePreparation(value: unknown): value is WebGpuScalePreparation {
  return typeof value === "object" && value !== null && trustedWebGpuScalePreparations.has(value);
}

/**
 * A deterministic CPU culling result used for conformance and injected integration tests.
 */
export type WebGpuCullingResult = {
  readonly candidateCount: number;
  readonly visibleCount: number;
  readonly logicalIndices: Uint32Array;
};

/**
 * Machine-readable frame timing source.
 */
export type WebGpuBenchmarkTimingSource = "gpu-timestamp" | "request-animation-frame";

/**
 * Selects GPU timing only after a readback has published a finite resolved timestamp sample.
 *
 * @param timingSource - Timing source reported after the readback operation.
 * @param gpuTimeMilliseconds - Resolved GPU duration, when the sample mapped successfully.
 * @returns GPU timing for a real finite sample, otherwise the rAF fallback.
 */
export function selectWebGpuBenchmarkTimingSource(
  timingSource: WebGpuBenchmarkTimingSource | undefined,
  gpuTimeMilliseconds: number | undefined,
): WebGpuBenchmarkTimingSource {
  return timingSource === "gpu-timestamp" &&
    gpuTimeMilliseconds !== undefined &&
    Number.isFinite(gpuTimeMilliseconds)
    ? "gpu-timestamp"
    : "request-animation-frame";
}

/**
 * Percentile frame-time measurements in milliseconds.
 *
 * `fpsAtP95` and p95 are jitter diagnostics for requestAnimationFrame; `averageFps` is the
 * sustained cadence used by the approximately-60-FPS acceptance gate.
 */
export type WebGpuFrameTimePercentiles = {
  readonly p50Milliseconds: number;
  readonly p95Milliseconds: number;
  readonly p99Milliseconds: number;
  readonly maximumMilliseconds: number;
  readonly averageMilliseconds: number;
  readonly averageFps: number;
  readonly fpsAtP95: number;
};

/**
 * Thresholds used to classify a measured one-million-point benchmark.
 */
export type WebGpuBenchmarkThresholds = {
  readonly minimumVisiblePoints: number;
  readonly targetVisiblePoints: number;
  /** Nominal display target retained in evidence and documentation. */
  readonly minimumFps: number;
  /** Sustained cadence tolerance for rAF's fractional-vsync clock. */
  readonly minimumSustainedFps: number;
  /** Ideal-vsync reference; p95 is reported as jitter and not used as throughput acceptance. */
  readonly maximumP95FrameTimeMilliseconds: number;
  readonly maximumGenerationLatencyMilliseconds: number;
  readonly maximumResourceBytes: number;
};

/**
 * Adapter/browser metadata retained with a local benchmark result.
 */
export type WebGpuBenchmarkMetadata = {
  readonly browser: string;
  readonly browserVersion: string;
  readonly operatingSystem: string;
  readonly adapterName: string | undefined;
  readonly adapterVendor: string | undefined;
  readonly adapterArchitecture: string | undefined;
  readonly measuredAt: string;
};

/**
 * The machine-readable result produced by the opt-in WebGPU benchmark.
 */
export type WebGpuBenchmarkResult = {
  readonly benchmarkVersion: typeof WEBGPU_SCALE_BENCHMARK_VERSION;
  readonly contractVersion: typeof WEBGPU_CLUSTER_CONFORMANCE_VERSION;
  readonly scene: "million-visible-star-points";
  readonly status: "measured" | "unavailable";
  readonly unavailableReason: string | undefined;
  readonly timingSource: WebGpuBenchmarkTimingSource | undefined;
  readonly warmupFrameCount: number;
  readonly sampleFrameCount: number;
  readonly visibleCount: number | undefined;
  readonly generationLatencyMilliseconds: number | undefined;
  readonly frameTimes: WebGpuFrameTimePercentiles | undefined;
  readonly resourceBudget: WebGpuResourceBudget;
  readonly metadata: WebGpuBenchmarkMetadata;
  readonly thresholds: WebGpuBenchmarkThresholds;
  readonly pass: boolean;
  readonly diagnostics: readonly string[];
};

/**
 * A fixed baseline comparison that deliberately treats unavailable hardware as non-regressing.
 */
export type WebGpuBenchmarkComparison = {
  readonly status: "pass" | "fail" | "unavailable";
  readonly regressions: readonly string[];
  readonly diagnostics: readonly string[];
};

/**
 * Host identity retained with target-machine evidence.
 */
export type WebGpuBenchmarkMachine = {
  readonly model: string;
  readonly chip: string;
  readonly memory: string;
  readonly operatingSystem: string;
  /** Host graphics API identity, separate from the WebGPU adapter architecture string. */
  readonly hostGraphicsApi: {
    readonly name: string | undefined;
    readonly version: string | undefined;
  };
};

/**
 * Explicit GPU allocation accounting retained with target-machine evidence.
 */
export type WebGpuResourceMemorySemantics = {
  readonly unit: "bytes";
  readonly scope: "GPU buffer allocations only; excludes browser process and driver allocations";
  readonly pointBufferFormula: "visibleCapacity × pointStrideBytes";
  readonly totalBufferFormula: "pointBufferBytes + indirectBufferBytes + uniformBufferBytes + seedBufferBytes";
  readonly pointBufferBytes: number;
  readonly indirectBufferBytes: number;
  readonly uniformBufferBytes: number;
  readonly seedBufferBytes: number;
  readonly totalBufferBytes: number;
  readonly hardAllocationCapBytes: number;
  readonly deviceMaxBufferSizeBytes: number;
};

/**
 * Measured metrics and machine identity used for same-target regression comparison.
 */
export type WebGpuMeasuredBenchmarkBaseline = {
  readonly benchmarkVersion: typeof WEBGPU_SCALE_BENCHMARK_VERSION;
  readonly contractVersion: typeof WEBGPU_CLUSTER_CONFORMANCE_VERSION;
  readonly scene: "million-visible-star-points";
  readonly metadata: WebGpuBenchmarkMetadata;
  readonly machine: WebGpuBenchmarkMachine;
  readonly timingSource: WebGpuBenchmarkTimingSource;
  readonly warmupFrameCount: number;
  readonly sampleFrameCount: number;
  readonly visibleCount: number;
  readonly generationLatencyMilliseconds: number;
  readonly frameTimes: WebGpuFrameTimePercentiles;
  readonly pass: boolean;
  readonly resourceBudget: WebGpuResourceBudget;
  readonly resourceSemantics: WebGpuResourceMemorySemantics;
  /** Compatibility scalar retained for older consumers of the evidence file. */
  readonly resourceBytes: number;
};

/**
 * A checked-in threshold baseline optionally paired with measured target-machine evidence.
 */
export type WebGpuBenchmarkBaseline = {
  readonly benchmarkVersion: typeof WEBGPU_SCALE_BENCHMARK_VERSION;
  readonly contractVersion: typeof WEBGPU_CLUSTER_CONFORMANCE_VERSION;
  readonly thresholds: WebGpuBenchmarkThresholds;
  readonly expectedScene: "million-visible-star-points";
  readonly note: string;
  readonly measuredBaseline?: WebGpuMeasuredBenchmarkBaseline;
};

const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_PRIME = 16_777_619;
const SECOND_HASH_OFFSET = 2_654_435_761;
const SECOND_HASH_PRIME = 22_468_252;
const UINT32_SCALE = 4_294_967_296;
const DEFAULT_MAX_BUFFER_SIZE = 64 * 1024 * 1024;
const MAX_COMPUTE_WORKGROUPS_PER_DIMENSION = 65_535;
/** Bounded measurement noise allowance for compatible rAF/GPU frame samples. */
const WEBGPU_FRAME_REGRESSION_TOLERANCE_MILLISECONDS = 1;
/** Bounded browser/GPU queue setup noise allowance for generation timing samples. */
const WEBGPU_GENERATION_REGRESSION_TOLERANCE_MILLISECONDS = 10;
/** Bounded display-cadence noise allowance for compatible measured samples. */
const WEBGPU_FPS_REGRESSION_TOLERANCE = 0.5;
const WEBGPU_ID_VERSION_TOKEN = "globular-v1";

/**
 * Default one-million-point acceptance thresholds for the documented target scene.
 */
export const DEFAULT_WEBGPU_BENCHMARK_THRESHOLDS: WebGpuBenchmarkThresholds = Object.freeze({
  minimumVisiblePoints: 900_000,
  targetVisiblePoints: MAX_WEBGPU_VISIBLE_POINTS,
  minimumFps: 60,
  minimumSustainedFps: 59.5,
  maximumP95FrameTimeMilliseconds: 16.67,
  maximumGenerationLatencyMilliseconds: 1_000,
  maximumResourceBytes: DEFAULT_MAX_BUFFER_SIZE,
});

/**
 * Fixed numeric and exact-text seed fixtures shared by the CPU reference and WGSL integration
 * tests. Expected coordinates are f32 values; GPU implementations are checked against the
 * documented `WEBGPU_POSITION_ABSOLUTE_TOLERANCE` rather than pretending transcendental hardware
 * is bit-identical where the API only promises numeric conformance.
 */
export const WEBGPU_CONFORMANCE_FIXTURES: readonly WebGpuConformanceFixture[] = Object.freeze([
  Object.freeze({
    id: "numeric-seed-7",
    logicalPopulation: 64,
    seed: 7,
    generatorVersion: "globular-v1",
    regionRadiusMeters: 5e17,
    expected: Object.freeze([
      Object.freeze({
        logicalIndex: 0,
        seedHash: 2188822852,
        seedTextHash: 4287192863,
        normalizedPosition: Object.freeze([
          -0.314354807138443, 0.13017144799232483, -0.21077118813991547,
        ]) as readonly [number, number, number],
        publicStableId:
          "system:generated:globular-b852086d5a19b5fc80a697de4b5f3e71:number7-44d1721b55163624c5ce79aa9438fa21:0000" as StableId,
      }),
      Object.freeze({
        logicalIndex: 7,
        seedHash: 2188822852,
        seedTextHash: 4287192863,
        normalizedPosition: Object.freeze([
          -0.6992223858833313, -0.5506342649459839, -0.6941561102867126,
        ]) as readonly [number, number, number],
        publicStableId:
          "system:generated:globular-b852086d5a19b5fc80a697de4b5f3e71:number7-44d1721b55163624c5ce79aa9438fa21:0007" as StableId,
      }),
    ]),
  }),
  Object.freeze({
    id: "exact-text-seed-7",
    logicalPopulation: 64,
    seed: " 7 ",
    generatorVersion: "globular-v1",
    regionRadiusMeters: 5e17,
    expected: Object.freeze([
      Object.freeze({
        logicalIndex: 0,
        seedHash: 1988867607,
        seedTextHash: 4133670137,
        normalizedPosition: Object.freeze([
          0.21812281012535095, -0.28389012813568115, 0.3077501952648163,
        ]) as readonly [number, number, number],
        publicStableId:
          "system:generated:globular-b852086d5a19b5fc80a697de4b5f3e71:string37-9bf9c5da1432f1f031ab169cb742f0d6:0000" as StableId,
      }),
      Object.freeze({
        logicalIndex: 7,
        seedHash: 1988867607,
        seedTextHash: 4133670137,
        normalizedPosition: Object.freeze([
          -0.156999409198761, 0.3379472494125366, -0.4034336507320404,
        ]) as readonly [number, number, number],
        publicStableId:
          "system:generated:globular-b852086d5a19b5fc80a697de4b5f3e71:string37-9bf9c5da1432f1f031ab169cb742f0d6:0007" as StableId,
      }),
    ]),
  }),
]);

function freezeVector(x: number, y: number, z: number): readonly [number, number, number] {
  return Object.freeze([x, y, z]) as readonly [number, number, number];
}

function freezePlane(x: number, y: number, z: number, constant: number): WebGpuFrustumPlane {
  return Object.freeze([x, y, z, constant]) as WebGpuFrustumPlane;
}

function finiteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite.`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function boundedInteger(value: number, label: string, maximum: number): number {
  positiveInteger(value, label);
  if (value > maximum) {
    throw new RangeError(`${label} must be no greater than ${String(maximum)}.`);
  }
  return value;
}

function encodeUtf16CodeUnits(value: string): readonly number[] {
  const codeUnits = Array.from({ length: value.length }, (_, index) => value.charCodeAt(index));
  return Object.freeze(codeUnits);
}

function hashCodeUnits(codeUnits: readonly number[], initial: number, separator: number): number {
  let hash = initial >>> 0;
  for (const codeUnit of codeUnits) {
    hash = Math.imul(hash ^ (codeUnit & 0xffff), FNV_PRIME) >>> 0;
  }
  hash = Math.imul(hash ^ separator, FNV_PRIME) >>> 0;
  return hash;
}

function hashString(value: string, initial = FNV_OFFSET_BASIS): number {
  return hashCodeUnits(encodeUtf16CodeUnits(value), initial, 0x9e37);
}

function hashPointBase(
  seedCodeUnits: readonly number[],
  generatorVersion: string,
  seedType: "number" | "string",
  lane: number,
): number {
  const initial = lane === 0 ? FNV_OFFSET_BASIS : SECOND_HASH_OFFSET;
  const prime = lane === 0 ? FNV_PRIME : SECOND_HASH_PRIME;
  let hash = initial >>> 0;
  for (const codeUnit of seedCodeUnits) {
    hash = Math.imul(hash ^ (codeUnit & 0xffff), prime) >>> 0;
  }
  for (const codeUnit of encodeUtf16CodeUnits(generatorVersion)) {
    hash = Math.imul(hash ^ (codeUnit & 0xffff), prime) >>> 0;
  }
  hash = Math.imul(hash ^ (seedType === "number" ? 0x4e : 0x53), prime) >>> 0;
  return hash >>> 0;
}

function gpuStableIdForIndex(contract: WebGpuScaleContract, logicalIndex: number): StableId {
  return generatedClusterSystemId(
    contract.seed.value as ClusterGenerationSeed,
    contract.generatorVersion,
    logicalIndex,
  );
}

function validateLogicalIndex(contract: WebGpuScaleContract, logicalIndex: number): number {
  boundedInteger(logicalIndex + 1, "logicalIndex + 1", contract.logicalPopulation);
  return logicalIndex;
}

/**
 * Creates the explicit versioned CPU/GPU contract without changing the CPU generator metadata.
 *
 * @param source - Logical population, exact seed, generator version, and physical radius.
 * @returns Immutable contract data suitable for CPU fixtures or GPU uniform preparation.
 */
export function createWebGpuScaleContract(source: WebGpuScaleSource): WebGpuScaleContract {
  const logicalPopulation = positiveInteger(source.logicalPopulation, "logicalPopulation");
  if (logicalPopulation > 0xffff_ffff) {
    throw new RangeError("logicalPopulation must fit the WGSL u32 logical-index contract.");
  }
  const generatorVersion = source.generatorVersion.trim();
  if (generatorVersion.length === 0) {
    throw new RangeError("generatorVersion must be a non-empty string.");
  }
  const regionRadiusMeters = finiteNumber(source.regionRadiusMeters, "regionRadiusMeters");
  if (regionRadiusMeters <= 0) {
    throw new RangeError("regionRadiusMeters must be greater than zero.");
  }
  const regionRadiusF32 = Math.fround(regionRadiusMeters);
  if (!Number.isFinite(regionRadiusF32) || regionRadiusF32 <= 0) {
    throw new RangeError(
      "regionRadiusMeters must be representable as a positive finite f32 value.",
    );
  }
  const seed = createScenarioSeed(source.seed);
  const seedIdentityCodeUnits = encodeUtf16CodeUnits(seed.identity);
  if (seedIdentityCodeUnits.length > MAX_WEBGPU_SEED_CODE_UNITS) {
    throw new RangeError(
      `The exact seed identity must contain no more than ${String(MAX_WEBGPU_SEED_CODE_UNITS)} UTF-16 code units.`,
    );
  }
  const pointHash = hashPointBase(seedIdentityCodeUnits, generatorVersion, seed.kind, 0);
  const pointTextHash = hashPointBase(seedIdentityCodeUnits, generatorVersion, seed.kind, 1);
  return Object.freeze({
    contractVersion: WEBGPU_CLUSTER_CONFORMANCE_VERSION,
    generatorVersion,
    seed,
    seedType: seed.kind,
    seedText: seed.text,
    seedIdentity: seed.identity,
    seedCodeUnits: seedIdentityCodeUnits,
    seedHash: hashString(seed.identity),
    seedTextHash: hashString(seed.text, SECOND_HASH_OFFSET),
    pointHash,
    pointTextHash,
    logicalPopulation,
    regionRadiusMeters,
  });
}

/**
 * Computes the WGSL-compatible FNV-1a hash for one logical point and lane.
 *
 * @param contract - Versioned GPU contract containing the exact seed identity.
 * @param logicalIndex - Zero-based logical System index.
 * @param lane - Independent hash lane, currently zero or one.
 * @returns An unsigned 32-bit hash suitable for WGSL `u32` arithmetic.
 */
function hashLogicalPointUnvalidated(
  contract: WebGpuScaleContract,
  logicalIndex: number,
  lane: number,
): number {
  const prime = lane === 0 ? FNV_PRIME : SECOND_HASH_PRIME;
  let hash = lane === 0 ? contract.pointHash : contract.pointTextHash;
  hash = Math.imul(hash ^ (logicalIndex >>> 0), prime) >>> 0;
  hash = Math.imul(hash ^ Math.floor(logicalIndex / UINT32_SCALE), prime) >>> 0;
  return hash >>> 0;
}

/**
 * Computes the WGSL-compatible FNV-1a hash for one logical point and lane.
 *
 * @param contract - Versioned GPU contract containing the exact seed identity.
 * @param logicalIndex - Zero-based logical point index.
 * @param lane - Independent hash lane, currently zero or one.
 * @returns An unsigned 32-bit hash suitable for WGSL `u32` arithmetic.
 */
export function hashWebGpuLogicalPoint(
  contract: WebGpuScaleContract,
  logicalIndex: number,
  lane = 0,
): number {
  validateLogicalIndex(contract, logicalIndex);
  if (!Number.isSafeInteger(lane) || lane < 0 || lane > 1) {
    throw new RangeError("GPU hash lane must be zero or one.");
  }
  return hashLogicalPointUnvalidated(contract, logicalIndex, lane);
}

function f32(value: number): number {
  return Math.fround(value);
}

function unitFromHash(value: number): number {
  return f32(f32(value) / f32(UINT32_SCALE));
}

/**
 * Resolves a packed GPU key to the exact public StableId for the active contract.
 *
 * @param contract - The exact seed/version contract that owns the GPU output.
 * @param key - Hash guards and logical index emitted by the compute pass.
 * @returns The deterministic public System StableId used by the CPU generator contract.
 */
export function resolveWebGpuStableId(
  contract: WebGpuScaleContract,
  key: WebGpuPackedStableKey,
): StableId {
  validateLogicalIndex(contract, key.logicalIndex);
  if (key.seedHash !== contract.seedHash || key.seedTextHash !== contract.seedTextHash) {
    throw new RangeError(
      "GPU stable key belongs to a different seed identity; refusing a collision-unsafe public ID mapping.",
    );
  }
  return gpuStableIdForIndex(contract, key.logicalIndex);
}

/**
 * Generates one WGSL-compatible f32 CPU reference point without allocating a per-point object
 * collection. The returned record is intended for fixtures, diagnostics, and injected tests.
 *
 * @param contract - Versioned GPU contract.
 * @param logicalIndex - Zero-based logical point index.
 * @returns One deterministic point and collision-safe public identity.
 */
export function generateWebGpuReferencePoint(
  contract: WebGpuScaleContract,
  logicalIndex: number,
): WebGpuReferencePoint {
  validateLogicalIndex(contract, logicalIndex);
  const xHash = hashLogicalPointUnvalidated(contract, logicalIndex, 0);
  const yHash = hashLogicalPointUnvalidated(contract, (logicalIndex ^ 0x9e3779b9) >>> 0, 1);
  const zHash = hashLogicalPointUnvalidated(contract, (logicalIndex ^ 0x85ebca6b) >>> 0, 0);
  const radiusHash = hashLogicalPointUnvalidated(contract, (logicalIndex ^ 0xc2b2ae35) >>> 0, 1);
  const x = f32(f32(unitFromHash(xHash) * 2) - 1);
  const y = f32(f32(unitFromHash(yHash) * 2) - 1);
  const z = f32(f32(unitFromHash(zHash) * 2) - 1);
  const radius = f32(Math.sqrt(unitFromHash(radiusHash)));
  const normalized = freezeVector(
    f32(f32(x * radius) * 0.98),
    f32(f32(y * radius) * 0.98),
    f32(f32(z * radius) * 0.98),
  );
  const positionMeters = freezeVector(
    f32(normalized[0] * f32(contract.regionRadiusMeters)),
    f32(normalized[1] * f32(contract.regionRadiusMeters)),
    f32(normalized[2] * f32(contract.regionRadiusMeters)),
  );
  const stableKey = Object.freeze({
    seedHash: contract.seedHash,
    seedTextHash: contract.seedTextHash,
    logicalIndex,
  });
  return Object.freeze({
    logicalIndex,
    stableKey,
    normalizedPosition: normalized,
    positionMeters,
    publicStableId: resolveWebGpuStableId(contract, stableKey),
  });
}

/**
 * Extracts normalized left/right/top/bottom/near/far planes from a column-major matrix.
 *
 * @param matrix - Sixteen finite column-major view-projection values.
 * @returns Six normalized frustum planes.
 */
export function extractWebGpuFrustumPlanes(
  matrix: readonly number[],
): readonly WebGpuFrustumPlane[] {
  if (matrix.length !== 16 || matrix.some((value) => !Number.isFinite(value))) {
    throw new RangeError("viewProjectionMatrix must contain sixteen finite values.");
  }
  const row = (rowIndex: number, columnIndex: number): number =>
    matrix[rowIndex + columnIndex * 4] ?? 0;
  const raw: readonly (readonly [number, number, number, number])[] = [
    [row(3, 0) + row(0, 0), row(3, 1) + row(0, 1), row(3, 2) + row(0, 2), row(3, 3) + row(0, 3)],
    [row(3, 0) - row(0, 0), row(3, 1) - row(0, 1), row(3, 2) - row(0, 2), row(3, 3) - row(0, 3)],
    [row(3, 0) + row(1, 0), row(3, 1) + row(1, 1), row(3, 2) + row(1, 2), row(3, 3) + row(1, 3)],
    [row(3, 0) - row(1, 0), row(3, 1) - row(1, 1), row(3, 2) - row(1, 2), row(3, 3) - row(1, 3)],
    // WebGPU uses a zero-to-one clip-space depth range, so the near plane is row two rather
    // than the OpenGL row-three-plus-row-two combination.
    [row(2, 0), row(2, 1), row(2, 2), row(2, 3)],
    [row(3, 0) - row(2, 0), row(3, 1) - row(2, 1), row(3, 2) - row(2, 2), row(3, 3) - row(2, 3)],
  ];
  const planes = raw.map(([x, y, z, constant]) => {
    const length = Math.hypot(x, y, z);
    if (length === 0 || !Number.isFinite(length)) {
      throw new RangeError("viewProjectionMatrix produced a zero-length frustum plane.");
    }
    return freezePlane(x / length, y / length, z / length, constant / length);
  });
  return Object.freeze(planes);
}

/**
 * Tests one normalized point against a six-plane frustum, optionally with a bounding radius.
 *
 * @param point - Normalized point coordinates.
 * @param planes - Frustum planes from `extractWebGpuFrustumPlanes`.
 * @param radius - Conservative normalized point radius.
 * @returns True when the point or sphere intersects every frustum half-space.
 */
export function isWebGpuPointVisible(
  point: readonly [number, number, number],
  planes: readonly WebGpuFrustumPlane[],
  radius = 0,
): boolean {
  if (planes.length !== 6 || !Number.isFinite(radius) || radius < 0) {
    return false;
  }
  return planes.every(
    ([x, y, z, constant]) => x * point[0] + y * point[1] + z * point[2] + constant >= -radius,
  );
}

function projectedClusterRadiusPixels(
  contract: WebGpuScaleContract,
  view: WebGpuClusterView,
): number {
  if (
    view.viewProjectionMatrix.length !== 16 ||
    view.viewProjectionMatrix.some((value) => !Number.isFinite(value))
  ) {
    throw new RangeError("viewProjectionMatrix must contain sixteen finite values.");
  }
  // The matrix carries the caller's actual FOV/aspect/translation. Convert the physical contract
  // radius into the matrix's coordinate units before estimating its screen-space extent; omitted
  // worldRadiusMeters is the common normalized contract-space case.
  const worldRadiusMeters = view.worldRadiusMeters ?? contract.regionRadiusMeters;
  if (!Number.isFinite(worldRadiusMeters) || worldRadiusMeters <= 0) {
    throw new RangeError("worldRadiusMeters must be a positive finite value.");
  }
  const radius = 0.98 * (contract.regionRadiusMeters / worldRadiusMeters);
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new RangeError("The contract radius must be representable in view-space units.");
  }
  const rowLength = (rowIndex: number): number =>
    Math.hypot(
      view.viewProjectionMatrix[rowIndex] ?? 0,
      view.viewProjectionMatrix[rowIndex + 4] ?? 0,
      view.viewProjectionMatrix[rowIndex + 8] ?? 0,
    );
  const centerW = Math.abs(view.viewProjectionMatrix[15] ?? 0);
  const wExtent = rowLength(3) * radius;
  const minimumW = centerW - wExtent;
  if (minimumW <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const horizontal = (rowLength(0) * radius * view.viewportWidth * 0.5) / minimumW;
  const vertical = (rowLength(1) * radius * view.viewportHeight * 0.5) / minimumW;
  return Math.max(horizontal, vertical);
}

/**
 * Selects one bounded LOD stride from the current view and logical population.
 *
 * @param contract - Logical population and physical radius.
 * @param view - Current camera matrix, viewport, and distance.
 * @param maximumVisiblePoints - Hard output capacity, defaulting to one million.
 * @returns A single integer range and bounded dispatch shape; no logical entities are materialized.
 */
export function selectWebGpuLod(
  contract: WebGpuScaleContract,
  view: WebGpuClusterView,
  maximumVisiblePoints = MAX_WEBGPU_VISIBLE_POINTS,
): WebGpuLodSelection {
  const visibleCapacity = boundedInteger(
    maximumVisiblePoints,
    "maximumVisiblePoints",
    MAX_WEBGPU_VISIBLE_POINTS,
  );
  finiteNumber(view.viewportWidth, "viewportWidth");
  finiteNumber(view.viewportHeight, "viewportHeight");
  const cameraDistance = finiteNumber(view.cameraDistance, "cameraDistance");
  finiteNumber(view.far, "far");
  if (view.viewportWidth <= 0 || view.viewportHeight <= 0 || cameraDistance <= 0 || view.far <= 0) {
    throw new RangeError("GPU view dimensions, cameraDistance, and far must be greater than zero.");
  }
  // `far` is also encoded in the projection matrix and becomes part of the six-plane culling
  // contract during preparation; validate the explicit view value here before selecting detail.
  const apparentRadiusPixels = projectedClusterRadiusPixels(contract, view);
  const detailStride =
    apparentRadiusPixels >= 96
      ? 1
      : apparentRadiusPixels >= 48
        ? 2
        : apparentRadiusPixels >= 16
          ? 8
          : apparentRadiusPixels >= 4
            ? 32
            : 128;
  const capacityStride = Math.max(1, Math.ceil(contract.logicalPopulation / visibleCapacity));
  const logicalStride = Math.max(detailStride, capacityStride);
  const candidateCount = Math.ceil(contract.logicalPopulation / logicalStride);
  const dispatchWorkgroups = Math.ceil(candidateCount / WEBGPU_SCALE_WORKGROUP_SIZE);
  if (dispatchWorkgroups > MAX_COMPUTE_WORKGROUPS_PER_DIMENSION) {
    throw new RangeError(
      `GPU dispatch requires ${String(dispatchWorkgroups)} workgroups, exceeding the bounded WebGPU dimension.`,
    );
  }
  return Object.freeze({
    level: Math.max(0, Math.ceil(Math.log2(logicalStride))),
    apparentRadiusPixels,
    range: Object.freeze({
      logicalStart: 0,
      logicalCount: contract.logicalPopulation,
      logicalStride,
    }),
    candidateCount,
    visibleCapacity,
    dispatchWorkgroups,
  });
}

/**
 * Calculates aligned GPU buffers for one LOD selection and fails closed on budget overflow.
 *
 * @param request - Candidate count, output capacity, seed metadata size, and adapter buffer limit.
 * @returns Immutable resource and dispatch accounting.
 */
export function createWebGpuResourceBudget(
  request: WebGpuResourceBudgetRequest,
): WebGpuResourceBudget {
  const candidateCount = boundedInteger(
    request.candidateCount,
    "candidateCount",
    MAX_WEBGPU_VISIBLE_POINTS,
  );
  const visibleCapacity = boundedInteger(
    request.visibleCapacity,
    "visibleCapacity",
    MAX_WEBGPU_VISIBLE_POINTS,
  );
  const seedCodeUnitCount = boundedInteger(
    request.seedCodeUnitCount,
    "seedCodeUnitCount",
    MAX_WEBGPU_SEED_CODE_UNITS,
  );
  const maxBufferSize = positiveInteger(request.maxBufferSize, "maxBufferSize");
  const pointBufferBytes = visibleCapacity * WEBGPU_POINT_STRIDE_BYTES;
  const indirectBufferBytes = WEBGPU_INDIRECT_DRAW_BYTES;
  const uniformBufferBytes = WEBGPU_SCALE_UNIFORM_BYTES;
  const seedBufferBytes = seedCodeUnitCount * Uint32Array.BYTES_PER_ELEMENT;
  const totalBufferBytes =
    pointBufferBytes + indirectBufferBytes + uniformBufferBytes + seedBufferBytes;
  if (pointBufferBytes > maxBufferSize || totalBufferBytes > maxBufferSize) {
    throw new RangeError(
      `GPU point resources require ${String(totalBufferBytes)} bytes, exceeding maxBufferSize ${String(maxBufferSize)}.`,
    );
  }
  const dispatchWorkgroups = Math.ceil(candidateCount / WEBGPU_SCALE_WORKGROUP_SIZE);
  if (dispatchWorkgroups > MAX_COMPUTE_WORKGROUPS_PER_DIMENSION) {
    throw new RangeError("GPU resource budget exceeds maxComputeWorkgroupsPerDimension.");
  }
  return Object.freeze({
    pointBufferBytes,
    indirectBufferBytes,
    uniformBufferBytes,
    seedBufferBytes,
    totalBufferBytes,
    pointStrideBytes: WEBGPU_POINT_STRIDE_BYTES,
    visibleCapacity,
    candidateCount,
    dispatchWorkgroups,
    workgroupSize: WEBGPU_SCALE_WORKGROUP_SIZE,
    maxBufferSize,
  });
}

/**
 * Describes the fixed GPU buffer allocation semantics without including browser-process memory.
 *
 * @param budget - Validated bounded resource accounting.
 * @returns Machine-readable formulas and calculated byte values.
 */
export function describeWebGpuResourceMemory(
  budget: WebGpuResourceBudget,
): WebGpuResourceMemorySemantics {
  const expectedPointBytes = budget.visibleCapacity * budget.pointStrideBytes;
  const expectedTotalBytes =
    budget.pointBufferBytes +
    budget.indirectBufferBytes +
    budget.uniformBufferBytes +
    budget.seedBufferBytes;
  if (
    budget.pointBufferBytes !== expectedPointBytes ||
    budget.totalBufferBytes !== expectedTotalBytes ||
    budget.totalBufferBytes > MAX_WEBGPU_SCALE_BUFFER_BYTES
  ) {
    throw new RangeError("GPU resource budget does not match its allocation semantics.");
  }
  return Object.freeze({
    unit: "bytes",
    scope: "GPU buffer allocations only; excludes browser process and driver allocations",
    pointBufferFormula: "visibleCapacity × pointStrideBytes",
    totalBufferFormula:
      "pointBufferBytes + indirectBufferBytes + uniformBufferBytes + seedBufferBytes",
    pointBufferBytes: budget.pointBufferBytes,
    indirectBufferBytes: budget.indirectBufferBytes,
    uniformBufferBytes: budget.uniformBufferBytes,
    seedBufferBytes: budget.seedBufferBytes,
    totalBufferBytes: budget.totalBufferBytes,
    hardAllocationCapBytes: MAX_WEBGPU_SCALE_BUFFER_BYTES,
    deviceMaxBufferSizeBytes: budget.maxBufferSize,
  });
}

/**
 * Builds all pure per-view decisions consumed by the injected WebGPU renderer.
 *
 * @param contract - Versioned logical Cluster contract.
 * @param view - Current Cluster camera view.
 * @param maximumVisiblePoints - Hard output capacity.
 * @param maxBufferSize - Adapter `maxBufferSize` used for the resource check.
 * @returns Bounded LOD, culling, and allocation preparation.
 */
export function prepareWebGpuScale(
  contract: WebGpuScaleContract,
  view: WebGpuClusterView,
  maximumVisiblePoints = MAX_WEBGPU_VISIBLE_POINTS,
  maxBufferSize = DEFAULT_MAX_BUFFER_SIZE,
): WebGpuScalePreparation {
  const lod = selectWebGpuLod(contract, view, maximumVisiblePoints);
  const budget = createWebGpuResourceBudget({
    candidateCount: lod.candidateCount,
    visibleCapacity: lod.visibleCapacity,
    seedCodeUnitCount: contract.seedCodeUnits.length,
    maxBufferSize,
  });
  const preparation = Object.freeze({
    contract,
    view,
    frustumPlanes: extractWebGpuFrustumPlanes(view.viewProjectionMatrix),
    lod,
    budget,
  });
  trustedWebGpuScalePreparations.add(preparation);
  return preparation;
}

/**
 * Culls deterministic CPU reference points into a bounded typed-index buffer.
 *
 * This seam exists for injected conformance tests and diagnostics. Production Cluster rendering
 * uses the equivalent WGSL compute pass and does not call it to materialize a million objects.
 *
 * @param contract - Versioned logical Cluster contract.
 * @param lod - Bounded LOD selection.
 * @param frustumPlanes - Current six-plane view frustum.
 * @returns A typed-array list of visible logical indices and its count.
 */
export function cullWebGpuReferencePoints(
  contract: WebGpuScaleContract,
  lod: WebGpuLodSelection,
  frustumPlanes: readonly WebGpuFrustumPlane[],
): WebGpuCullingResult {
  const logicalIndices = new Uint32Array(lod.visibleCapacity);
  let visibleCount = 0;
  for (let candidate = 0; candidate < lod.candidateCount; candidate += 1) {
    const logicalIndex = lod.range.logicalStart + candidate * lod.range.logicalStride;
    if (logicalIndex >= contract.logicalPopulation) {
      continue;
    }
    const point = generateWebGpuReferencePoint(contract, logicalIndex);
    if (
      isWebGpuPointVisible(point.normalizedPosition, frustumPlanes) &&
      visibleCount < logicalIndices.length
    ) {
      logicalIndices[visibleCount] = logicalIndex;
      visibleCount += 1;
    }
  }
  return Object.freeze({
    candidateCount: lod.candidateCount,
    visibleCount,
    logicalIndices: logicalIndices.subarray(0, visibleCount),
  });
}

/**
 * Alias for callers that describe the operation as GPU candidate culling.
 *
 * @param contract - Versioned logical Cluster contract.
 * @param lod - Bounded LOD selection.
 * @param frustumPlanes - Current six-plane view frustum.
 * @returns Typed visible logical indices.
 */
export const cullGpuCandidates = cullWebGpuReferencePoints;

/**
 * Creates a deterministic frame-time percentile summary from a bounded sample window.
 *
 * @param frameTimesMilliseconds - Positive finite frame durations.
 * @returns Stable p50/p95/p99, average cadence, maximum, and p95 jitter values.
 */
export function summarizeWebGpuFrameTimes(
  frameTimesMilliseconds: readonly number[],
): WebGpuFrameTimePercentiles {
  if (frameTimesMilliseconds.length === 0) {
    throw new RangeError("frameTimesMilliseconds must contain at least one sample.");
  }
  const values = frameTimesMilliseconds.map((value) => finiteNumber(value, "frame time"));
  if (values.some((value) => value <= 0)) {
    throw new RangeError("frame times must be greater than zero.");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction: number): number => {
    const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction));
    return sorted[index] ?? 0;
  };
  const averageMilliseconds = values.reduce((sum, value) => sum + value, 0) / values.length;
  const p95Milliseconds = percentile(0.95);
  return Object.freeze({
    p50Milliseconds: percentile(0.5),
    p95Milliseconds,
    p99Milliseconds: percentile(0.99),
    maximumMilliseconds: sorted[sorted.length - 1] ?? 0,
    averageMilliseconds,
    averageFps: 1_000 / averageMilliseconds,
    fpsAtP95: 1_000 / p95Milliseconds,
  });
}

function benchmarkMetadata(metadata: WebGpuBenchmarkMetadata): WebGpuBenchmarkMetadata {
  if (metadata.measuredAt.trim().length === 0) {
    throw new RangeError("benchmark measuredAt must be a non-empty timestamp.");
  }
  return Object.freeze({
    browser: metadata.browser,
    browserVersion: metadata.browserVersion,
    operatingSystem: metadata.operatingSystem,
    adapterName: metadata.adapterName,
    adapterVendor: metadata.adapterVendor,
    adapterArchitecture: metadata.adapterArchitecture,
    measuredAt: metadata.measuredAt,
  });
}

function validateThresholds(thresholds: WebGpuBenchmarkThresholds): WebGpuBenchmarkThresholds {
  if (
    !Number.isSafeInteger(thresholds.minimumVisiblePoints) ||
    !Number.isSafeInteger(thresholds.targetVisiblePoints) ||
    thresholds.minimumVisiblePoints <= 0 ||
    thresholds.minimumVisiblePoints > MAX_WEBGPU_VISIBLE_POINTS ||
    thresholds.targetVisiblePoints > MAX_WEBGPU_VISIBLE_POINTS ||
    thresholds.targetVisiblePoints < thresholds.minimumVisiblePoints ||
    !Number.isFinite(thresholds.minimumFps) ||
    thresholds.minimumFps <= 0 ||
    !Number.isFinite(thresholds.minimumSustainedFps) ||
    thresholds.minimumSustainedFps <= 0 ||
    thresholds.minimumSustainedFps > thresholds.minimumFps ||
    !Number.isFinite(thresholds.maximumP95FrameTimeMilliseconds) ||
    thresholds.maximumP95FrameTimeMilliseconds <= 0 ||
    !Number.isFinite(thresholds.maximumGenerationLatencyMilliseconds) ||
    thresholds.maximumGenerationLatencyMilliseconds <= 0 ||
    !Number.isFinite(thresholds.maximumResourceBytes) ||
    thresholds.maximumResourceBytes <= 0
  ) {
    throw new RangeError("WebGPU benchmark thresholds are invalid.");
  }
  return Object.freeze({ ...thresholds });
}

/**
 * Creates a truthful unavailable result when no local browser/GPU measurement can be run.
 *
 * @param reason - Explicit environmental reason, never a guessed hardware result.
 * @param metadata - Browser, OS, adapter, and timestamp metadata.
 * @param budget - Bounded scene resource budget.
 * @param thresholds - Acceptance thresholds.
 * @returns A schema-complete unavailable benchmark result.
 */
export function createUnavailableWebGpuBenchmarkResult(
  reason: string,
  metadata: WebGpuBenchmarkMetadata,
  budget: WebGpuResourceBudget,
  thresholds: WebGpuBenchmarkThresholds = DEFAULT_WEBGPU_BENCHMARK_THRESHOLDS,
): WebGpuBenchmarkResult {
  if (reason.trim().length === 0) {
    throw new RangeError("An unavailable WebGPU benchmark must include a reason.");
  }
  return Object.freeze({
    benchmarkVersion: WEBGPU_SCALE_BENCHMARK_VERSION,
    contractVersion: WEBGPU_CLUSTER_CONFORMANCE_VERSION,
    scene: "million-visible-star-points" as const,
    status: "unavailable" as const,
    unavailableReason: reason,
    timingSource: undefined,
    warmupFrameCount: 0,
    sampleFrameCount: 0,
    visibleCount: undefined,
    generationLatencyMilliseconds: undefined,
    frameTimes: undefined,
    resourceBudget: budget,
    metadata: benchmarkMetadata(metadata),
    thresholds: validateThresholds(thresholds),
    pass: false,
    diagnostics: Object.freeze([`unavailable: ${reason}`]),
  });
}

/**
 * Classifies measured metrics against explicit thresholds without timing assertions in CI.
 *
 * RequestAnimationFrame intervals include display-vsync scheduling jitter. The sustained average
 * cadence is therefore the approximately-60-FPS acceptance metric; p95 remains a separately
 * reported jitter reference and is compared with a bounded frame-time tolerance between compatible
 * measured baselines.
 *
 * @param result - A measured or unavailable benchmark result.
 * @returns A machine-readable result retaining every failed threshold.
 */
export function evaluateWebGpuBenchmark(
  result: Omit<WebGpuBenchmarkResult, "pass" | "diagnostics">,
): WebGpuBenchmarkResult {
  const diagnostics: string[] = [];
  const thresholds = validateThresholds(result.thresholds);
  if (result.status === "unavailable") {
    const reason = result.unavailableReason ?? "no reason supplied";
    diagnostics.push(`unavailable: ${reason}`);
    return Object.freeze({
      ...result,
      thresholds,
      pass: false,
      diagnostics: Object.freeze(diagnostics),
    });
  }
  if (result.timingSource === undefined || result.frameTimes === undefined) {
    diagnostics.push("measured result must include a timing source and frame percentiles");
  }
  if (
    result.visibleCount === undefined ||
    !Number.isSafeInteger(result.visibleCount) ||
    result.visibleCount < thresholds.minimumVisiblePoints
  ) {
    diagnostics.push(
      `visibleCount ${String(result.visibleCount ?? "missing")} is below required ${String(thresholds.minimumVisiblePoints)}`,
    );
  }
  if (
    result.generationLatencyMilliseconds === undefined ||
    !Number.isFinite(result.generationLatencyMilliseconds) ||
    result.generationLatencyMilliseconds < 0 ||
    result.generationLatencyMilliseconds > thresholds.maximumGenerationLatencyMilliseconds
  ) {
    diagnostics.push(
      `generation latency ${String(result.generationLatencyMilliseconds ?? "missing")}ms exceeds ${String(thresholds.maximumGenerationLatencyMilliseconds)}ms`,
    );
  }
  if (
    result.frameTimes !== undefined &&
    (!Number.isFinite(result.frameTimes.averageFps) ||
      result.frameTimes.averageFps < thresholds.minimumSustainedFps)
  ) {
    diagnostics.push(
      `sustained average FPS ${String(result.frameTimes.averageFps)} is below approximately-${String(thresholds.minimumFps)} FPS (${String(thresholds.minimumSustainedFps)} minimum)`,
    );
  }
  if (result.resourceBudget.totalBufferBytes > thresholds.maximumResourceBytes) {
    diagnostics.push(
      `resource estimate ${String(result.resourceBudget.totalBufferBytes)} bytes exceeds ${String(thresholds.maximumResourceBytes)}`,
    );
  }
  return Object.freeze({
    ...result,
    thresholds,
    pass: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics),
  });
}

/**
 * Compares a benchmark result with a checked-in baseline and reports deterministic regressions.
 *
 * An unavailable local environment is explicit and never converted into a pass or a fabricated
 * performance number; baseline schema/threshold validation still runs.
 *
 * @param result - Current measured or unavailable run.
 * @param baseline - Checked-in scene and threshold contract.
 * @param machine - Host identity for compatible target-machine evidence comparison.
 * @returns Pass/fail/unavailable status and diagnostic messages.
 */
export function compareWebGpuBenchmarkBaseline(
  result: WebGpuBenchmarkResult,
  baseline: WebGpuBenchmarkBaseline,
  machine?: WebGpuBenchmarkMachine,
): WebGpuBenchmarkComparison {
  const diagnostics: string[] = [];
  const regressions: string[] = [];
  validateThresholds(baseline.thresholds);
  if (baseline.benchmarkVersion !== WEBGPU_SCALE_BENCHMARK_VERSION) {
    diagnostics.push("benchmark version does not match the baseline schema");
  }
  if (baseline.contractVersion !== WEBGPU_CLUSTER_CONFORMANCE_VERSION) {
    diagnostics.push("GPU contract version does not match the baseline");
  }
  if (baseline.expectedScene !== result.scene) {
    diagnostics.push("benchmark scene does not match the baseline scene");
  }
  if (result.status === "unavailable") {
    return Object.freeze({
      status: diagnostics.length === 0 ? "unavailable" : "fail",
      regressions: Object.freeze(regressions),
      diagnostics: Object.freeze([
        ...diagnostics,
        ...(result.unavailableReason === undefined
          ? []
          : [`unavailable: ${result.unavailableReason}`]),
      ]),
    });
  }
  if (!result.pass) {
    regressions.push(...result.diagnostics);
  }
  if (
    result.visibleCount !== undefined &&
    result.visibleCount < baseline.thresholds.minimumVisiblePoints
  ) {
    regressions.push("visible count regressed below baseline threshold");
  }
  const measuredBaseline = baseline.measuredBaseline;
  if (measuredBaseline !== undefined) {
    if (measuredBaseline.benchmarkVersion !== result.benchmarkVersion) {
      diagnostics.push("measured baseline benchmark version is incompatible");
    }
    if (measuredBaseline.contractVersion !== result.contractVersion) {
      diagnostics.push("measured baseline GPU contract version is incompatible");
    }
    if (measuredBaseline.scene !== result.scene) {
      diagnostics.push("measured baseline scene is incompatible");
    }
    const metadataFields: readonly [keyof WebGpuBenchmarkMetadata, string][] = [
      ["browser", "browser"],
      ["browserVersion", "browser version"],
      ["operatingSystem", "operating system"],
      ["adapterName", "adapter name"],
      ["adapterVendor", "adapter vendor"],
      ["adapterArchitecture", "adapter architecture"],
    ];
    for (const [field, label] of metadataFields) {
      if (result.metadata[field] !== measuredBaseline.metadata[field]) {
        diagnostics.push(`measured baseline ${label} is incompatible`);
      }
    }
    if (machine === undefined) {
      diagnostics.push(
        "measured baseline host identity is unavailable for compatibility comparison",
      );
    } else {
      const machineFields: readonly [keyof WebGpuBenchmarkMachine, string][] = [
        ["model", "model"],
        ["chip", "chip"],
        ["memory", "memory"],
        ["operatingSystem", "operating system"],
      ];
      for (const [field, label] of machineFields) {
        if (machine[field] !== measuredBaseline.machine[field]) {
          diagnostics.push(`measured baseline host ${label} is incompatible`);
        }
      }
      if (
        machine.hostGraphicsApi.name !== measuredBaseline.machine.hostGraphicsApi.name ||
        machine.hostGraphicsApi.version !== measuredBaseline.machine.hostGraphicsApi.version
      ) {
        diagnostics.push("measured baseline host graphics API is incompatible");
      }
    }
    if (result.timingSource !== measuredBaseline.timingSource) {
      diagnostics.push("measured baseline timing source is incompatible");
    }
    if (diagnostics.length === 0) {
      if (
        result.visibleCount !== undefined &&
        result.visibleCount < measuredBaseline.visibleCount
      ) {
        regressions.push(
          `visible count regressed from ${String(measuredBaseline.visibleCount)} to ${String(result.visibleCount)}`,
        );
      }
      if (
        result.generationLatencyMilliseconds !== undefined &&
        result.generationLatencyMilliseconds >
          measuredBaseline.generationLatencyMilliseconds +
            WEBGPU_GENERATION_REGRESSION_TOLERANCE_MILLISECONDS
      ) {
        regressions.push(
          `generation latency regressed from ${String(measuredBaseline.generationLatencyMilliseconds)}ms to ${String(result.generationLatencyMilliseconds)}ms beyond the ${String(WEBGPU_GENERATION_REGRESSION_TOLERANCE_MILLISECONDS)}ms measurement tolerance`,
        );
      }
      if (result.frameTimes !== undefined) {
        const frameFields: readonly [keyof WebGpuFrameTimePercentiles, string][] = [
          ["p50Milliseconds", "p50 frame time"],
          ["p95Milliseconds", "p95 frame time"],
          ["p99Milliseconds", "p99 frame time"],
          ["maximumMilliseconds", "maximum frame time"],
          ["averageMilliseconds", "average frame time"],
        ];
        for (const [field, label] of frameFields) {
          if (
            result.frameTimes[field] >
            measuredBaseline.frameTimes[field] + WEBGPU_FRAME_REGRESSION_TOLERANCE_MILLISECONDS
          ) {
            regressions.push(
              `${label} regressed from ${String(measuredBaseline.frameTimes[field])}ms to ${String(result.frameTimes[field])}ms beyond the ${String(WEBGPU_FRAME_REGRESSION_TOLERANCE_MILLISECONDS)}ms measurement tolerance`,
            );
          }
        }
        if (
          result.frameTimes.averageFps + WEBGPU_FPS_REGRESSION_TOLERANCE <
          measuredBaseline.frameTimes.averageFps
        ) {
          regressions.push(
            `average FPS regressed from ${String(measuredBaseline.frameTimes.averageFps)} to ${String(result.frameTimes.averageFps)} beyond the ${String(WEBGPU_FPS_REGRESSION_TOLERANCE)} FPS measurement tolerance`,
          );
        }
      }
      if (result.resourceBudget.totalBufferBytes > measuredBaseline.resourceBytes) {
        regressions.push(
          `resource estimate regressed from ${String(measuredBaseline.resourceBytes)} to ${String(result.resourceBudget.totalBufferBytes)} bytes`,
        );
      }
    }
  }
  return Object.freeze({
    status: diagnostics.length > 0 || regressions.length > 0 ? "fail" : "pass",
    regressions: Object.freeze(regressions),
    diagnostics: Object.freeze(diagnostics),
  });
}

/**
 * Returns fixed baseline data used by the opt-in benchmark command and schema tests.
 *
 * @returns A repeatable threshold document; it contains no machine-specific result.
 */
export function defaultWebGpuBenchmarkBaseline(): WebGpuBenchmarkBaseline {
  return Object.freeze({
    benchmarkVersion: WEBGPU_SCALE_BENCHMARK_VERSION,
    contractVersion: WEBGPU_CLUSTER_CONFORMANCE_VERSION,
    thresholds: DEFAULT_WEBGPU_BENCHMARK_THRESHOLDS,
    expectedScene: "million-visible-star-points" as const,
    note: "Thresholds are deterministic acceptance gates. RequestAnimationFrame is presentation cadence, not an isolated GPU execution timer; its p95 is a display-jitter reference. Approximately-60-FPS acceptance uses sustained average cadence >= 59.5 FPS, while compatible measured baselines use bounded 1ms frame, 0.5 FPS cadence, and 10ms generation measurement tolerances. Measured hardware evidence is recorded separately and unavailable runs remain unavailable.",
  });
}

/**
 * Creates the default one-million-point contract and bounded preparation for benchmark fixtures.
 *
 * @returns A deterministic scene contract and its maximum-capacity resource budget.
 */
export function defaultWebGpuBenchmarkPreparation(): WebGpuScalePreparation {
  const contract = createWebGpuScaleContract({
    logicalPopulation: MAX_WEBGPU_VISIBLE_POINTS,
    seed: "webgpu-million-points-scene",
    generatorVersion: WEBGPU_ID_VERSION_TOKEN,
    regionRadiusMeters: 5e17,
  });
  const view: WebGpuClusterView = Object.freeze({
    // A deterministic orthographic benchmark volume that contains the complete normalized sphere.
    // Its zero-to-one depth interval intentionally exercises culling without dropping the rear
    // half of the synthetic Cluster as an identity matrix would under WebGPU clip rules.
    viewProjectionMatrix: Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.01, 0, 0, 0, 0.99, 1]),
    viewportWidth: 1920,
    viewportHeight: 1080,
    cameraDistance: 3.2,
    far: 100,
    worldRadiusMeters: 5e17,
  });
  return prepareWebGpuScale(contract, view);
}

/**
 * Returns a benchmark result with measured frame timing and generated resource accounting.
 *
 * @param input - Measured values collected by a local browser harness.
 * @returns Threshold-evaluated benchmark result.
 */
export function createMeasuredWebGpuBenchmarkResult(input: {
  readonly timingSource: WebGpuBenchmarkTimingSource;
  readonly warmupFrameCount: number;
  readonly sampleFrameCount: number;
  readonly visibleCount: number;
  readonly generationLatencyMilliseconds: number;
  readonly frameTimesMilliseconds: readonly number[];
  readonly resourceBudget: WebGpuResourceBudget;
  readonly metadata: WebGpuBenchmarkMetadata;
  readonly thresholds?: WebGpuBenchmarkThresholds | undefined;
}): WebGpuBenchmarkResult {
  positiveInteger(input.warmupFrameCount + 1, "warmupFrameCount + 1");
  positiveInteger(input.sampleFrameCount, "sampleFrameCount");
  if (input.frameTimesMilliseconds.length !== input.sampleFrameCount) {
    throw new RangeError("frameTimesMilliseconds must match sampleFrameCount.");
  }
  if (
    !Number.isSafeInteger(input.visibleCount) ||
    input.visibleCount < 0 ||
    input.visibleCount > MAX_WEBGPU_VISIBLE_POINTS
  ) {
    throw new RangeError("visibleCount must be a non-negative safe integer.");
  }
  finiteNumber(input.generationLatencyMilliseconds, "generationLatencyMilliseconds");
  if (input.generationLatencyMilliseconds < 0) {
    throw new RangeError("generationLatencyMilliseconds must not be negative.");
  }
  const thresholds = validateThresholds(input.thresholds ?? DEFAULT_WEBGPU_BENCHMARK_THRESHOLDS);
  const frameTimes = summarizeWebGpuFrameTimes(input.frameTimesMilliseconds);
  return evaluateWebGpuBenchmark({
    benchmarkVersion: WEBGPU_SCALE_BENCHMARK_VERSION,
    contractVersion: WEBGPU_CLUSTER_CONFORMANCE_VERSION,
    scene: "million-visible-star-points",
    status: "measured",
    unavailableReason: undefined,
    timingSource: input.timingSource,
    warmupFrameCount: input.warmupFrameCount,
    sampleFrameCount: input.sampleFrameCount,
    visibleCount: input.visibleCount,
    generationLatencyMilliseconds: input.generationLatencyMilliseconds,
    frameTimes,
    resourceBudget: input.resourceBudget,
    metadata: benchmarkMetadata(input.metadata),
    thresholds,
  });
}

/**
 * Validates a conformance point against the documented numeric tolerance.
 *
 * @param expected - CPU reference point.
 * @param observedPosition - GPU position in normalized coordinates.
 * @returns True when every coordinate is within the contract tolerance.
 */
export function webGpuPositionMatchesReference(
  expected: WebGpuReferencePoint,
  observedPosition: readonly [number, number, number],
): boolean {
  return expected.normalizedPosition.every((value, index) => {
    const observed = observedPosition[index];
    return (
      observed !== undefined && Math.abs(observed - value) <= WEBGPU_POSITION_ABSOLUTE_TOLERANCE
    );
  });
}

/**
 * Verifies every checked-in conformance fixture against the independent CPU reference.
 *
 * @returns An immutable list of fixture diagnostics; an empty list means all fixtures agree.
 */
export function verifyWebGpuConformanceFixtures(): readonly string[] {
  const diagnostics: string[] = [];
  for (const fixture of WEBGPU_CONFORMANCE_FIXTURES) {
    const contract = createWebGpuScaleContract({
      logicalPopulation: fixture.logicalPopulation,
      seed: fixture.seed,
      generatorVersion: fixture.generatorVersion,
      regionRadiusMeters: fixture.regionRadiusMeters,
    });
    for (const expected of fixture.expected) {
      const observed = generateWebGpuReferencePoint(contract, expected.logicalIndex);
      if (
        observed.stableKey.seedHash !== expected.seedHash ||
        observed.stableKey.seedTextHash !== expected.seedTextHash ||
        observed.publicStableId !== expected.publicStableId ||
        !webGpuPositionMatchesReference(observed, expected.normalizedPosition)
      ) {
        diagnostics.push(
          `${fixture.id}:${String(expected.logicalIndex)} does not match the CPU fixture.`,
        );
      }
    }
  }
  return Object.freeze(diagnostics);
}
