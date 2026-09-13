import {
  createExplorerViewProjectionMatrix,
  type CameraState,
  type ExplorerVector3,
  type ExplorerViewport,
} from "./cluster-explorer";
import type { ScenarioSeedInput } from "../src/model";
import {
  MAX_WEBGPU_SCALE_BUFFER_BYTES,
  MAX_WEBGPU_SEED_CODE_UNITS,
  MAX_WEBGPU_VISIBLE_POINTS,
  WEBGPU_INDIRECT_DRAW_BYTES,
  WEBGPU_POINT_STRIDE_BYTES,
  WEBGPU_SCALE_UNIFORM_BYTES,
  WEBGPU_SCALE_WORKGROUP_SIZE,
  createWebGpuResourceBudget,
  createWebGpuScaleContract,
  extractWebGpuFrustumPlanes,
  isTrustedWebGpuScalePreparation,
  selectWebGpuLod,
  type WebGpuBenchmarkTimingSource,
  type WebGpuResourceBudget,
  type WebGpuScalePreparation,
} from "../src/webgpu-scale";

/**
 * The small feature-set interface used by the renderer capability seam.
 */
export type WebGpuFeatureSet = {
  readonly has: (feature: string) => boolean;
};

/**
 * The numeric limit view required by the renderer capability seam.
 */
export type WebGpuLimits = Readonly<Record<string, number | undefined>>;

/**
 * The kind of compatibility fact reported by WebGPU startup validation.
 */
export type WebGpuCapabilityDiagnosticKind =
  | "secure-context"
  | "availability"
  | "feature"
  | "limit"
  | "format"
  | "shader-assumption"
  | "resource";

/**
 * One machine-readable capability fact with required and observed values.
 */
export type WebGpuCapabilityDiagnostic = {
  readonly kind: WebGpuCapabilityDiagnosticKind;
  readonly name: string;
  readonly required: string | number | boolean;
  readonly observed: string | number | boolean | undefined;
  readonly message: string;
};

/**
 * A resource-size assertion checked before device initialization can be used for rendering.
 */
export type WebGpuResourceRequirement = {
  readonly name: string;
  readonly requiredBytes: number;
  readonly limitName: string;
};

/**
 * A static WGSL/API assumption that must hold before a scale pipeline is created.
 */
export type WebGpuShaderAssumption = {
  readonly name: string;
  readonly required: string | number | boolean;
  readonly observed: string | number | boolean | undefined;
};

/**
 * Full capability requirements for a WebGPU startup boundary.
 */
export type WebGpuStartupRequirements = {
  readonly requiredFeatures: readonly string[];
  readonly optionalFeatures?: readonly string[] | undefined;
  readonly requiredLimits: Readonly<Record<string, number>>;
  readonly requiredCanvasFormats?: readonly string[] | undefined;
  readonly shaderAssumptions?: readonly WebGpuShaderAssumption[] | undefined;
  readonly resourceRequirements?: readonly WebGpuResourceRequirement[] | undefined;
};

/**
 * The device descriptor accepted by the injected WebGPU adapter.
 */
export type WebGpuDeviceDescriptor = {
  readonly requiredFeatures: readonly string[];
  readonly requiredLimits: Readonly<Record<string, number>>;
};

/**
 * A minimal GPU buffer handle used by the renderer.
 */
export type WebGpuBuffer = {
  readonly destroy: (() => void) | undefined;
  readonly mapAsync?: ((mode: number, offset?: number, size?: number) => Promise<void>) | undefined;
  readonly getMappedRange?: ((offset?: number, size?: number) => ArrayBuffer) | undefined;
  readonly unmap?: (() => void) | undefined;
};

/**
 * The queue operations used to upload camera and vertex data.
 */
export type WebGpuQueue = {
  readonly writeBuffer: (
    buffer: WebGpuBuffer,
    offset: number,
    data: ArrayBuffer,
    dataOffset?: number,
    size?: number,
  ) => void;
  readonly submit: (commands: readonly unknown[]) => void;
};

/**
 * The browser-provided reason and explanation for a lost WebGPU device.
 */
export type WebGpuDeviceLoss = {
  readonly reason: string | undefined;
  readonly message: string | undefined;
};

/**
 * The subset of a WebGPU device used by the Cluster renderer.
 */
export type WebGpuDevice = {
  readonly features: WebGpuFeatureSet;
  readonly limits: WebGpuLimits;
  readonly lost: Promise<WebGpuDeviceLoss>;
  readonly queue: WebGpuQueue;
  readonly createShaderModule: (descriptor: unknown) => unknown;
  readonly createBindGroupLayout: (descriptor: unknown) => unknown;
  readonly createPipelineLayout: (descriptor: unknown) => unknown;
  readonly createBindGroup: (descriptor: unknown) => unknown;
  readonly createRenderPipeline: (descriptor: unknown) => WebGpuRenderPipeline;
  readonly createBuffer: (descriptor: unknown) => WebGpuBuffer;
  readonly createCommandEncoder: () => WebGpuCommandEncoder;
  readonly destroy: (() => void) | undefined;
};

/**
 * The adapter interface used by the injected WebGPU capability seam.
 */
export type WebGpuAdapter = {
  readonly features: WebGpuFeatureSet;
  readonly limits: WebGpuLimits;
  readonly requestDevice: (descriptor: WebGpuDeviceDescriptor) => Promise<WebGpuDevice>;
};

/**
 * The browser GPU interface used by the renderer startup adapter.
 */
export type WebGpuApi = {
  readonly requestAdapter: (options: unknown) => Promise<WebGpuAdapter | null>;
  readonly getPreferredCanvasFormat: () => string;
};

/**
 * The configured WebGPU canvas context used by the renderer.
 */
export type WebGpuCanvasContext = {
  readonly configure: (configuration: {
    readonly device: WebGpuDevice;
    readonly format: string;
    readonly alphaMode: "opaque" | "premultiplied";
  }) => void;
  readonly getCurrentTexture: () => WebGpuTexture;
};

/**
 * The canvas methods and dimensions required by the renderer.
 */
export type WebGpuCanvas = {
  width: number;
  height: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly getContext: (contextId: "webgpu") => WebGpuCanvasContext | null;
};

/**
 * A texture view returned by the current canvas texture.
 */
export type WebGpuTexture = {
  readonly createView: () => unknown;
};

/**
 * A minimal GPU pipeline handle used by the renderer.
 */
type WebGpuRenderPipeline = unknown;

/**
 * The render-pass interface used by the renderer implementation.
 */
type WebGpuRenderPass = {
  readonly setPipeline: (pipeline: WebGpuRenderPipeline) => void;
  readonly setBindGroup: (index: number, bindGroup: unknown) => void;
  readonly setVertexBuffer: (slot: number, buffer: WebGpuBuffer) => void;
  readonly draw: (vertexCount: number) => void;
  readonly drawIndirect?: ((buffer: WebGpuBuffer, offset: number) => void) | undefined;
  readonly end: () => void;
  readonly writeTimestamp?: ((querySet: WebGpuQuerySet, queryIndex: number) => void) | undefined;
};

/**
 * The command encoder interface used by the renderer implementation.
 */
type WebGpuCommandEncoder = {
  readonly beginRenderPass: (descriptor: unknown) => WebGpuRenderPass;
  readonly beginComputePass?: ((descriptor?: unknown) => WebGpuComputePass) | undefined;
  readonly copyBufferToBuffer?:
    | ((
        source: WebGpuBuffer,
        sourceOffset: number,
        destination: WebGpuBuffer,
        destinationOffset: number,
        size: number,
      ) => void)
    | undefined;
  readonly resolveQuerySet?: (
    querySet: WebGpuQuerySet,
    firstQuery: number,
    queryCount: number,
    destination: WebGpuBuffer,
    destinationOffset: number,
  ) => void;
  readonly finish: () => unknown;
};

/**
 * The compute-pass subset consumed by bounded GPU LOD generation.
 */
export type WebGpuComputePass = {
  readonly setPipeline: (pipeline: unknown) => void;
  readonly setBindGroup: (index: number, bindGroup: unknown) => void;
  readonly dispatchWorkgroups: (x: number, y?: number, z?: number) => void;
  readonly end: () => void;
  readonly writeTimestamp?: ((querySet: WebGpuQuerySet, queryIndex: number) => void) | undefined;
};

/**
 * An optional timestamp query set exposed by a conforming WebGPU device.
 */
export type WebGpuQuerySet = {
  readonly destroy?: (() => void) | undefined;
};

/**
 * The optional timestamp/readback API used only when `timestamp-query` is available.
 */
export type WebGpuTimestampDevice = {
  readonly createQuerySet?: ((descriptor: unknown) => WebGpuQuerySet) | undefined;
};

/**
 * A scale-capable device subset. The core renderer remains compatible with injected basic devices.
 */
export type WebGpuScaleDevice = WebGpuDevice & {
  readonly createComputePipeline: (descriptor: unknown) => unknown;
};

/**
 * A dense logical Cluster request submitted to the GPU compute pipeline.
 */
export type WebGpuScaleRenderScene = {
  readonly preparation: WebGpuScalePreparation;
  readonly overlay: WebGpuRenderScene;
};

/**
 * Encoded float stride for one CPU overlay point.
 */
export const WEBGPU_OVERLAY_POINT_STRIDE_BYTES = 7 * Float32Array.BYTES_PER_ELEMENT;

/**
 * Encoded float stride for one CPU overlay connection segment.
 */
export const WEBGPU_OVERLAY_CONNECTION_STRIDE_BYTES = 14 * Float32Array.BYTES_PER_ELEMENT;

/**
 * Hard cap for CPU overlay points submitted to one scale frame.
 */
export const MAX_WEBGPU_SCALE_OVERLAY_POINTS = 4_096;

/**
 * Hard cap for CPU overlay connection segments submitted to one scale frame.
 */
export const MAX_WEBGPU_SCALE_OVERLAY_CONNECTIONS = 4_096;

/**
 * Independent peak overlay allocation cap; scale compute buffers use MAX_WEBGPU_SCALE_BUFFER_BYTES.
 */
export const MAX_WEBGPU_SCALE_OVERLAY_BUFFER_BYTES = 256 * 1024;

/**
 * Explicit CPU-overlay resource accounting kept separate from the million-point GPU population.
 *
 * `totalBufferBytes` is the GPU vertex-buffer allocation. `conversionBytes` is the simultaneous
 * typed-array conversion/staging allocation. `peakBufferBytes` is the steady-state combined peak;
 * replacement uploads separately enforce the old/new-buffer transition peak before allocation.
 */
export type WebGpuScaleOverlayBudget = {
  readonly pointCount: number;
  readonly connectionCount: number;
  readonly pointBufferBytes: number;
  readonly connectionBufferBytes: number;
  readonly totalBufferBytes: number;
  readonly pointConversionBytes: number;
  readonly connectionConversionBytes: number;
  readonly conversionBytes: number;
  readonly peakBufferBytes: number;
  readonly maxBufferBytes: number;
};

/**
 * A bounded, data-only snapshot ready for scale overlay conversion and upload.
 */
export type WebGpuScaleOverlaySnapshot = {
  readonly scene: WebGpuRenderScene;
  readonly budget: WebGpuScaleOverlayBudget;
};

/**
 * Last-frame accounting exposed for benchmark and diagnostic surfaces.
 */
export type WebGpuScaleFrameReport = {
  readonly candidateCount: number;
  readonly visibleCapacity: number;
  readonly dispatchWorkgroups: number;
  readonly resourceBudget: WebGpuResourceBudget;
  readonly overlayBudget: WebGpuScaleOverlayBudget;
  readonly timingSource: WebGpuBenchmarkTimingSource;
  /** Resolved GPU timestamp duration in milliseconds, when a timestamp sample was consumed. */
  readonly gpuTimeMilliseconds: number | undefined;
};

/**
 * Bounded GPU readback data used by browser conformance harnesses.
 *
 * Positions use the generated four-f32 record layout (`x`, `y`, `z`, `w`) and stable keys use the
 * generated four-u32 layout (`seedHash`, `seedTextHash`, `logicalIndex`, reserved). No JavaScript
 * object is created per point, even when the bounded maximum is one million. Timing fields are
 * published only after this readback has attempted to consume the submitted timestamp sample.
 */
export type WebGpuScaleReadback = {
  /** Total visible points produced by the GPU, independent of the returned record cap. */
  readonly visibleCount: number;
  /** Number of point records copied into the returned typed arrays. */
  readonly returnedRecordCount: number;
  readonly positions: Float32Array;
  readonly stableKeys: Uint32Array;
  /** Timing source observed after this readback; GPU timing requires a resolved sample. */
  readonly timingSource: WebGpuBenchmarkTimingSource;
  /** Resolved GPU duration for this readback's sample, when available. */
  readonly gpuTimeMilliseconds: number | undefined;
};

/**
 * An injectable animation scheduler used to coalesce rendering work in tests and browsers.
 */
export type WebGpuRenderScheduler = {
  readonly request: (callback: () => void) => unknown;
};

/**
 * Minimum WebGPU capabilities required by the first Cluster renderer.
 *
 * These are deliberately small standards-guaranteed limits. Optional features such as timestamp
 * queries are never required, so a conforming desktop implementation can still start the view.
 */
export const DEFAULT_WEBGPU_REQUIREMENTS: {
  readonly requiredFeatures: readonly string[];
  readonly requiredLimits: Readonly<Record<string, number>>;
} = Object.freeze({
  requiredFeatures: Object.freeze([]),
  requiredLimits: Object.freeze({
    maxBufferSize: 65_536,
    maxVertexBuffers: 1,
    maxUniformBuffersPerShaderStage: 1,
  }),
});

/**
 * Stable failure codes for capability and renderer startup.
 */
export type WebGpuFailureCode =
  | "gpu-unavailable"
  | "insecure-context"
  | "adapter-unavailable"
  | "missing-feature"
  | "missing-limit"
  | "device-request-failed"
  | "device-missing-feature"
  | "device-missing-limit"
  | "invalid-canvas-format"
  | "shader-assumption-failed"
  | "resource-budget-exceeded"
  | "context-unavailable"
  | "context-configure-failed"
  | "device-lost"
  | "renderer-init-failed";

/**
 * A user-facing explanation of why the WebGPU Cluster view cannot start.
 */
export type WebGpuFailure = {
  readonly code: WebGpuFailureCode;
  readonly message: string;
  readonly detail: string;
  readonly diagnostics: readonly WebGpuCapabilityDiagnostic[];
};

/**
 * The browser and canvas dependencies injected into WebGPU startup.
 */
export type WebGpuStartupBoundary = {
  readonly gpu: WebGpuApi | undefined;
  readonly canvas: WebGpuCanvas;
  readonly requirements: WebGpuStartupRequirements | undefined;
  /** False is a hard failure; undefined preserves the injectable non-browser test seam. */
  readonly isSecureContext?: boolean | undefined;
};

/**
 * Resources validated before a render pipeline is created.
 */
export type WebGpuStartupResources = {
  readonly adapter: WebGpuAdapter;
  readonly device: WebGpuDevice;
  readonly context: WebGpuCanvasContext;
  readonly format: string;
  readonly requirements: WebGpuStartupRequirements;
  readonly diagnostics: readonly WebGpuCapabilityDiagnostic[];
};

/**
 * The result of injected WebGPU capability validation.
 */
export type WebGpuCapabilityResult =
  | { readonly ok: true; readonly resources: WebGpuStartupResources }
  | { readonly ok: false; readonly failure: WebGpuFailure };

/**
 * One colored point submitted to the WebGPU Cluster pipeline.
 */
export type WebGpuRenderPoint = {
  readonly position: ExplorerVector3;
  readonly color: readonly [number, number, number, number];
};

/**
 * One colored line segment submitted to the WebGPU Cluster pipeline.
 */
export type WebGpuRenderLine = {
  readonly from: ExplorerVector3;
  readonly to: ExplorerVector3;
  readonly color: readonly [number, number, number, number];
};

/**
 * The render-ready point and connection data for one Cluster frame.
 */
export type WebGpuRenderScene = {
  readonly points: readonly WebGpuRenderPoint[];
  readonly connections: readonly WebGpuRenderLine[];
};

/**
 * The renderer interface at the browser/WebGPU seam.
 */
export type WebGpuRenderer = {
  /**
   * Queues a scene and camera update; multiple updates before the next frame coalesce.
   */
  readonly setScene: (scene: WebGpuRenderScene, camera: CameraState) => void;
  /**
   * Reconfigures the canvas for a CSS size and device-pixel ratio.
   */
  readonly resize: (width: number, height: number, devicePixelRatio: number) => void;
  /**
   * Renders immediately, primarily for deterministic adapter tests.
   */
  readonly renderNow: (scene: WebGpuRenderScene, camera: CameraState) => void;
  /**
   * Releases GPU buffers and prevents queued frames from drawing.
   */
  readonly destroy: () => void;
};

/**
 * The result of WebGPU renderer creation.
 */
export type WebGpuRendererResult =
  | {
      readonly ok: true;
      readonly renderer: WebGpuRenderer;
      readonly resources: WebGpuStartupResources;
    }
  | { readonly ok: false; readonly failure: WebGpuFailure };

/**
 * Renderer with a bounded compute-generated Cluster cloud in addition to CPU overlays.
 */
export type WebGpuScaleRenderer = WebGpuRenderer & {
  /** Queues a logical Cluster preparation; only the selected LOD is dispatched. */
  readonly setScaleScene: (scene: WebGpuScaleRenderScene, camera: CameraState) => void;
  /** Renders a scale scene immediately for deterministic integration tests. */
  readonly renderScaleNow: (scene: WebGpuScaleRenderScene, camera: CameraState) => void;
  /** Returns the last bounded dispatch and timestamp-source report. */
  readonly lastFrame: () => WebGpuScaleFrameReport | undefined;
  /**
   * Reads a bounded visible-count/key/position sample for browser conformance evidence. Omitting
   * `maxPoints` performs count-only readback; records are returned only when capped.
   */
  readonly readScaleOutput: (options?: {
    readonly maxPoints?: number;
  }) => Promise<WebGpuScaleReadback>;
};

/**
 * Result of creating a bounded compute-and-render WebGPU Cluster renderer.
 */
export type WebGpuScaleRendererResult =
  | {
      readonly ok: true;
      readonly renderer: WebGpuScaleRenderer;
      readonly resources: WebGpuStartupResources;
    }
  | { readonly ok: false; readonly failure: WebGpuFailure };

const BUFFER_USAGE_COPY_SRC = 0x04;
const BUFFER_USAGE_COPY_DST = 0x08;
const BUFFER_USAGE_QUERY_RESOLVE = 0x200;
const BUFFER_MAP_READ = 0x01;
const BUFFER_USAGE_STORAGE = 0x80;
const BUFFER_USAGE_INDIRECT = 0x100;
const BUFFER_USAGE_VERTEX = 0x20;
const BUFFER_USAGE_UNIFORM = 0x40;
// Keep small dynamically growing vertex buffers aligned for browser WebGPU implementations.
const MIN_VERTEX_BUFFER_BYTES = 256;
const MAX_WEBGPU_U32 = 0xffff_ffff;
const MAX_COMPUTE_WORKGROUPS_PER_DIMENSION = 65_535;
/**
 * Procedural full-screen WebGPU background for the Cluster map.
 *
 * The shader is static, so it respects reduced-motion preferences while rendering stellar gas,
 * rust nebulae, and a sparse amber star field entirely on the GPU.
 */
export const WEBGPU_STELLAR_BACKGROUND_SHADER = /* wgsl */ `
struct BackgroundVertex {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn backgroundVertex(@builtin(vertex_index) index: u32) -> BackgroundVertex {
  var positions = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var output: BackgroundVertex;
  output.position = vec4<f32>(positions[index], 0.999, 1.0);
  output.uv = positions[index] * 0.5 + vec2<f32>(0.5);
  return output;
}

fn hash(point: vec2<f32>) -> f32 {
  return fract(sin(dot(point, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

@fragment
fn backgroundFragment(input: BackgroundVertex) -> @location(0) vec4<f32> {
  let uv = input.uv;
  let gasA = exp(-7.0 * length(uv - vec2<f32>(0.22, 0.63)));
  let gasB = exp(-10.0 * length(uv - vec2<f32>(0.76, 0.28)));
  let cell = floor(uv * 220.0);
  let star = select(0.0, 1.0, hash(cell) > 0.9965) * (0.55 + 0.45 * hash(cell + 4.0));
  let ink = vec3<f32>(0.008, 0.006, 0.009);
  let rust = vec3<f32>(0.32, 0.075, 0.025) * gasA + vec3<f32>(0.16, 0.045, 0.02) * gasB;
  let amber = vec3<f32>(1.0, 0.61, 0.23) * star;
  return vec4<f32>(ink + rust + amber, 1.0);
}
`;

const SHADER = /* wgsl */ `
struct Camera {
  viewProjection: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) color: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = camera.viewProjection * vec4<f32>(input.position, 1.0);
  output.color = input.color;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return input.color;
}
`;

/**
 * WGSL compute and vertex shader for bounded logical-index generation, frustum culling, and
 * indirect drawing. It consumes only compact contract uniforms; the logical population never
 * crosses into JavaScript point objects.
 */
export const WEBGPU_SCALE_SHADER = /* wgsl */ `
struct ScaleParams {
  viewProjection: mat4x4<f32>,
  frustumPlanes: array<vec4<f32>, 6>,
  regionRadius: f32,
  pointHash: u32,
  pointTextHash: u32,
  seedHash: u32,
  seedTextHash: u32,
  candidateCount: u32,
  logicalStride: u32,
  visibleCapacity: u32,
};

struct GeneratedPoint {
  position: vec4<f32>,
  stableKey: vec4<u32>,
};

@group(0) @binding(0) var<uniform> params: ScaleParams;
@group(0) @binding(1) var<storage, read_write> generated: array<GeneratedPoint>;
@group(0) @binding(2) var<storage, read_write> drawArgs: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> seedCodeUnits: array<u32>;

fn pointHash(index: u32, lane: u32) -> u32 {
  var value = select(params.pointHash, params.pointTextHash, lane == 1u);
  let prime = select(16777619u, 22468252u, lane == 1u);
  // The CPU reference hashes the low and high u32 halves separately. The scale contract bounds
  // the logical population below 2^32, so the high half is zero for every active dispatch.
  value = (value ^ index) * prime;
  value = value * prime;
  return value;
}

fn unit(value: u32) -> f32 {
  return f32(value) / 4294967296.0;
}

fn visible(position: vec3<f32>) -> bool {
  for (var plane = 0u; plane < 6u; plane = plane + 1u) {
    if (dot(params.frustumPlanes[plane].xyz, position) + params.frustumPlanes[plane].w < 0.0) {
      return false;
    }
  }
  return true;
}

var<workgroup> workgroupVisibleCount: atomic<u32>;
var<workgroup> workgroupOutputBase: u32;
var<workgroup> workgroupOutputCount: u32;

fn reserveOutputRange(requested: u32) -> vec2<u32> {
  if (requested == 0u) {
    return vec2<u32>(0u, 0u);
  }
  var current = atomicLoad(&drawArgs[0]);
  loop {
    if (current >= params.visibleCapacity) {
      return vec2<u32>(params.visibleCapacity, 0u);
    }
    let available = params.visibleCapacity - current;
    let reserved = min(requested, available);
    let result = atomicCompareExchangeWeak(&drawArgs[0], current, current + reserved);
    if (result.exchanged) {
      return vec2<u32>(current, reserved);
    }
    current = result.old_value;
  }
}

@compute @workgroup_size(64)
fn generatePoints(
  @builtin(global_invocation_id) invocation: vec3<u32>,
  @builtin(local_invocation_index) localIndex: u32,
) {
  // Every invocation, including dispatch padding, reaches each workgroup barrier.
  let candidate = invocation.x;
  let candidateActive = candidate < params.candidateCount;
  let logicalIndex = candidate * params.logicalStride;
  let x = unit(pointHash(logicalIndex, 0u)) * 2.0 - 1.0;
  let y = unit(pointHash(logicalIndex ^ 0x9e3779b9u, 1u)) * 2.0 - 1.0;
  let z = unit(pointHash(logicalIndex ^ 0x85ebca6bu, 0u)) * 2.0 - 1.0;
  let radius = sqrt(unit(pointHash(logicalIndex ^ 0xc2b2ae35u, 1u)));
  let position = vec3<f32>(x * radius * 0.98, y * radius * 0.98, z * radius * 0.98);
  let isVisible = candidateActive && visible(position);
  if (localIndex == 0u) {
    atomicStore(&workgroupVisibleCount, 0u);
  }
  workgroupBarrier();
  var localOutputIndex = 0u;
  if (isVisible) {
    localOutputIndex = atomicAdd(&workgroupVisibleCount, 1u);
  }
  workgroupBarrier();
  if (localIndex == 0u) {
    let reservation = reserveOutputRange(atomicLoad(&workgroupVisibleCount));
    workgroupOutputBase = reservation.x;
    workgroupOutputCount = reservation.y;
  }
  workgroupBarrier();
  if (isVisible && localOutputIndex < workgroupOutputCount) {
    // A workgroup reserves one bounded global range, avoiding a contended global CAS per point.
    // The local atomic order is not part of the public identity contract; stable keys carry the
    // exact logical index so readback and CPU identity resolution remain deterministic.
    let outputIndex = workgroupOutputBase + localOutputIndex;
    generated[outputIndex] = GeneratedPoint(
      vec4<f32>(position, 1.0),
      vec4<u32>(params.seedHash, params.seedTextHash, logicalIndex, 0u),
    );
  }
}

struct PointVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

// Render resources use a separate group because the compute entry point owns the writable
// storage bindings above. The render pipeline supplies an empty group zero so Chrome does not
// place the compute storage and indirect usages in one render-pass synchronization scope.
@group(1) @binding(0) var<uniform> renderParams: ScaleParams;
@group(1) @binding(1) var<storage, read> renderPoints: array<GeneratedPoint>;

@vertex
fn pointVertex(@builtin(vertex_index) index: u32) -> PointVertexOutput {
  var output: PointVertexOutput;
  let point = renderPoints[index];
  output.position = renderParams.viewProjection * point.position;
  output.color = vec4<f32>(0.55, 0.88, 0.77, 0.72);
  return output;
}

@fragment
fn pointFragment(input: PointVertexOutput) -> @location(0) vec4<f32> {
  return input.color;
}
`;

/**
 * Default hard capabilities for the one-million-point compute/render path.
 */
export const DEFAULT_WEBGPU_SCALE_REQUIREMENTS: WebGpuStartupRequirements = Object.freeze({
  requiredFeatures: Object.freeze([]),
  optionalFeatures: Object.freeze(["timestamp-query"]),
  requiredLimits: Object.freeze({
    maxBufferSize: MAX_WEBGPU_SCALE_BUFFER_BYTES,
    maxStorageBufferBindingSize: 32_000_000,
    maxStorageBuffersPerShaderStage: 3,
    maxUniformBufferBindingSize: WEBGPU_SCALE_UNIFORM_BYTES,
    maxUniformBuffersPerShaderStage: 1,
    maxComputeInvocationsPerWorkgroup: WEBGPU_SCALE_WORKGROUP_SIZE,
    maxComputeWorkgroupSizeX: WEBGPU_SCALE_WORKGROUP_SIZE,
    maxComputeWorkgroupsPerDimension: 15_625,
    maxBindGroups: 2,
    maxVertexBuffers: 1,
  }),
  requiredCanvasFormats: Object.freeze(["bgra8unorm", "rgba8unorm"]),
  shaderAssumptions: Object.freeze([
    Object.freeze({
      name: "wgsl-workgroup-size",
      required: WEBGPU_SCALE_WORKGROUP_SIZE,
      observed: WEBGPU_SCALE_WORKGROUP_SIZE,
    }),
    Object.freeze({
      name: "point-storage-stride-bytes",
      required: WEBGPU_POINT_STRIDE_BYTES,
      observed: WEBGPU_POINT_STRIDE_BYTES,
    }),
    Object.freeze({
      name: "uniform-buffer-alignment-bytes",
      required: 256,
      observed: WEBGPU_SCALE_UNIFORM_BYTES,
    }),
    Object.freeze({
      name: "indirect-draw-command-bytes",
      required: WEBGPU_INDIRECT_DRAW_BYTES,
      observed: WEBGPU_INDIRECT_DRAW_BYTES,
    }),
  ]),
  resourceRequirements: Object.freeze([
    Object.freeze({
      name: "million-point-storage",
      requiredBytes: 32_000_000,
      limitName: "maxStorageBufferBindingSize",
    }),
    Object.freeze({
      name: "million-point-buffer",
      requiredBytes: MAX_WEBGPU_SCALE_BUFFER_BYTES,
      limitName: "maxBufferSize",
    }),
  ]),
});

function defaultScheduler(): WebGpuRenderScheduler {
  const runtime = globalThis as typeof globalThis & {
    readonly requestAnimationFrame: ((callback: () => void) => number) | undefined;
  };
  if (runtime.requestAnimationFrame !== undefined) {
    return Object.freeze({
      request: (callback: () => void) => runtime.requestAnimationFrame(callback),
    });
  }
  return Object.freeze({ request: (callback: () => void) => setTimeout(callback, 0) });
}

function failure(
  code: WebGpuFailureCode,
  message: string,
  detail: string,
  diagnostics: readonly WebGpuCapabilityDiagnostic[] = [],
): WebGpuFailure {
  return Object.freeze({ code, message, detail, diagnostics: Object.freeze([...diagnostics]) });
}

function deviceLossDiagnostics(loss: WebGpuDeviceLoss): readonly WebGpuCapabilityDiagnostic[] {
  return Object.freeze([
    Object.freeze({
      kind: "availability" as const,
      name: "GPUDevice.lost",
      required: "not-lost",
      observed: loss.reason ?? "unknown",
      message: `WebGPU device loss: reason=${loss.reason ?? "unknown"}, message=${loss.message ?? "unspecified"}.`,
    }),
  ]);
}

function featureDiagnostics(
  features: WebGpuFeatureSet,
  requiredFeatures: readonly string[],
): readonly WebGpuCapabilityDiagnostic[] {
  return Object.freeze(
    requiredFeatures
      .filter((name) => !features.has(name))
      .map((name) =>
        Object.freeze({
          kind: "feature" as const,
          name,
          required: true,
          observed: false,
          message: `Feature ${name}: required=true, observed=false.`,
        }),
      ),
  );
}

function limitDiagnostics(
  limits: WebGpuLimits,
  requiredLimits: Readonly<Record<string, number>>,
): readonly WebGpuCapabilityDiagnostic[] {
  const diagnostics: WebGpuCapabilityDiagnostic[] = [];
  for (const [name, required] of Object.entries(requiredLimits)) {
    const observed = limits[name];
    if (observed !== undefined && Number.isFinite(observed) && observed >= required) {
      continue;
    }
    diagnostics.push(
      Object.freeze({
        kind: "limit",
        name,
        required,
        observed,
        message: `Limit ${name}: required>=${String(required)}, observed=${String(observed ?? "missing")}.`,
      }),
    );
  }
  return Object.freeze(diagnostics);
}

function destroyDevice(device: WebGpuDevice): void {
  try {
    device.destroy?.();
  } catch {
    // Capability failures must not mask best-effort device teardown.
  }
}

function missingFeatures(
  features: WebGpuFeatureSet,
  requiredFeatures: readonly string[],
): readonly string[] {
  return Object.freeze(requiredFeatures.filter((feature) => !features.has(feature)));
}

function missingLimits(
  limits: WebGpuLimits,
  requiredLimits: Readonly<Record<string, number>>,
): readonly string[] {
  return Object.freeze(
    Object.entries(requiredLimits)
      .filter(([name, required]) => {
        const available = limits[name];
        return available === undefined || !Number.isFinite(available) || available < required;
      })
      .map(([name]) => name),
  );
}

function secureContextValue(boundary: WebGpuStartupBoundary): boolean | undefined {
  if (boundary.isSecureContext !== undefined) {
    return boundary.isSecureContext;
  }
  const runtime = globalThis as typeof globalThis & { readonly isSecureContext?: boolean };
  return runtime.isSecureContext;
}

function resourceDiagnostics(
  limits: WebGpuLimits,
  requirements: readonly WebGpuResourceRequirement[] | undefined,
): readonly WebGpuCapabilityDiagnostic[] {
  const diagnostics: WebGpuCapabilityDiagnostic[] = [];
  for (const requirement of requirements ?? []) {
    const observed = limits[requirement.limitName];
    if (
      observed !== undefined &&
      Number.isFinite(observed) &&
      observed >= requirement.requiredBytes
    ) {
      continue;
    }
    diagnostics.push(
      Object.freeze({
        kind: "resource",
        name: requirement.name,
        required: requirement.requiredBytes,
        observed,
        message: `Resource ${requirement.name}: required=${String(requirement.requiredBytes)} bytes under ${requirement.limitName}, observed=${String(observed ?? "missing")}.`,
      }),
    );
  }
  return Object.freeze(diagnostics);
}

function shaderAssumptionDiagnostics(
  assumptions: readonly WebGpuShaderAssumption[] | undefined,
): readonly WebGpuCapabilityDiagnostic[] {
  const diagnostics: WebGpuCapabilityDiagnostic[] = [];
  for (const assumption of assumptions ?? []) {
    if (assumption.observed === assumption.required) {
      continue;
    }
    diagnostics.push(
      Object.freeze({
        kind: "shader-assumption",
        name: assumption.name,
        required: assumption.required,
        observed: assumption.observed,
        message: `Shader/API assumption ${assumption.name}: required=${String(assumption.required)}, observed=${String(assumption.observed ?? "missing")}.`,
      }),
    );
  }
  return Object.freeze(diagnostics);
}

function requirementsFor(
  requirements: WebGpuStartupBoundary["requirements"],
): WebGpuStartupResources["requirements"] {
  return Object.freeze({
    requiredFeatures: Object.freeze([
      ...(requirements?.requiredFeatures ?? DEFAULT_WEBGPU_REQUIREMENTS.requiredFeatures),
    ]),
    optionalFeatures:
      requirements?.optionalFeatures === undefined
        ? undefined
        : Object.freeze([...requirements.optionalFeatures]),
    requiredLimits: Object.freeze({
      ...DEFAULT_WEBGPU_REQUIREMENTS.requiredLimits,
      ...(requirements?.requiredLimits ?? {}),
    }),
    requiredCanvasFormats:
      requirements?.requiredCanvasFormats === undefined
        ? undefined
        : Object.freeze([...requirements.requiredCanvasFormats]),
    shaderAssumptions:
      requirements?.shaderAssumptions === undefined
        ? undefined
        : Object.freeze(
            requirements.shaderAssumptions.map((assumption) => Object.freeze({ ...assumption })),
          ),
    resourceRequirements:
      requirements?.resourceRequirements === undefined
        ? undefined
        : Object.freeze(
            requirements.resourceRequirements.map((requirement) =>
              Object.freeze({ ...requirement }),
            ),
          ),
  });
}

/**
 * Validates navigator.gpu, adapter capabilities, device capabilities, and the canvas context.
 *
 * @param boundary - Injected browser GPU, canvas, and optional capability requirements.
 * @returns Validated adapter/device/context resources or a structured hard-failure explanation.
 */
export async function checkWebGpuCapabilities(
  boundary: WebGpuStartupBoundary,
): Promise<WebGpuCapabilityResult> {
  const requirements = requirementsFor(boundary.requirements);
  const secureContext = secureContextValue(boundary);
  if (secureContext === false) {
    const diagnostics = Object.freeze([
      Object.freeze({
        kind: "secure-context" as const,
        name: "isSecureContext",
        required: true,
        observed: false,
        message: "Secure context: required=true, observed=false.",
      }),
    ]);
    return {
      ok: false,
      failure: failure(
        "insecure-context",
        "The Cluster explorer requires a secure context for WebGPU.",
        "Use HTTPS or a browser-trusted localhost origin. WebGL fallback is intentionally disabled.",
        diagnostics,
      ),
    };
  }
  if (boundary.gpu === undefined) {
    const diagnostics = Object.freeze([
      Object.freeze({
        kind: "availability" as const,
        name: "navigator.gpu",
        required: "present",
        observed: "missing",
        message: "WebGPU API: required=present, observed=missing.",
      }),
    ]);
    return {
      ok: false,
      failure: failure(
        "gpu-unavailable",
        "WebGPU is unavailable in this browser.",
        "The Cluster explorer requires navigator.gpu and intentionally has no WebGL or 2D fallback.",
        diagnostics,
      ),
    };
  }

  let adapter: WebGpuAdapter | null;
  try {
    adapter = await boundary.gpu.requestAdapter({ powerPreference: "high-performance" });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "The adapter request failed before startup.";
    const diagnostics = Object.freeze([
      Object.freeze({
        kind: "availability" as const,
        name: "navigator.gpu.requestAdapter",
        required: "resolves",
        observed: "rejected",
        message: `WebGPU adapter request: required=resolves, observed=rejected (${detail}).`,
      }),
    ]);
    return {
      ok: false,
      failure: failure(
        "adapter-unavailable",
        "WebGPU could not provide a rendering adapter.",
        detail,
        diagnostics,
      ),
    };
  }
  if (adapter === null) {
    const diagnostics = Object.freeze([
      Object.freeze({
        kind: "availability" as const,
        name: "GPUAdapter",
        required: "present",
        observed: "null",
        message: "WebGPU adapter: required=present, observed=null.",
      }),
    ]);
    return {
      ok: false,
      failure: failure(
        "adapter-unavailable",
        "WebGPU is present, but no compatible adapter is available.",
        "Check that hardware acceleration is enabled and that this desktop browser exposes WebGPU.",
        diagnostics,
      ),
    };
  }

  const adapterFeatures = missingFeatures(adapter.features, requirements.requiredFeatures);
  if (adapterFeatures.length > 0) {
    const diagnostics = featureDiagnostics(adapter.features, requirements.requiredFeatures);
    return {
      ok: false,
      failure: failure(
        "missing-feature",
        "The WebGPU adapter is missing a required feature.",
        `Missing feature${adapterFeatures.length === 1 ? "" : "s"}: ${adapterFeatures.join(", ")}.`,
        diagnostics,
      ),
    };
  }
  const adapterLimits = missingLimits(adapter.limits, requirements.requiredLimits);
  const adapterResourceLimits = resourceDiagnostics(
    adapter.limits,
    requirements.resourceRequirements,
  );
  if (adapterLimits.length > 0 || adapterResourceLimits.length > 0) {
    const diagnostics = Object.freeze([
      ...limitDiagnostics(adapter.limits, requirements.requiredLimits),
      ...adapterResourceLimits,
    ]);
    return {
      ok: false,
      failure: failure(
        "missing-limit",
        "The WebGPU adapter does not meet the Cluster renderer limits.",
        `Insufficient limit${adapterLimits.length + adapterResourceLimits.length === 1 ? "" : "s"}: ${[
          ...adapterLimits,
          ...adapterResourceLimits.map((value) => value.name),
        ].join(", ")}.`,
        diagnostics,
      ),
    };
  }
  const shaderDiagnostics = shaderAssumptionDiagnostics(requirements.shaderAssumptions);
  if (shaderDiagnostics.length > 0) {
    return {
      ok: false,
      failure: failure(
        "shader-assumption-failed",
        "The WebGPU shader contract is not supported by this startup boundary.",
        shaderDiagnostics.map((diagnostic) => diagnostic.message).join(" "),
        shaderDiagnostics,
      ),
    };
  }

  let preferredFormat: string;
  try {
    preferredFormat = boundary.gpu.getPreferredCanvasFormat();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "getPreferredCanvasFormat failed.";
    const diagnostics = Object.freeze([
      Object.freeze({
        kind: "format" as const,
        name: "preferredCanvasFormat",
        required: "resolves",
        observed: "error",
        message: `Canvas format: required=resolves, observed=error (${detail}).`,
      }),
    ]);
    return {
      ok: false,
      failure: failure(
        "invalid-canvas-format",
        "WebGPU did not provide a canvas format.",
        detail,
        diagnostics,
      ),
    };
  }
  if (
    requirements.requiredCanvasFormats !== undefined &&
    !requirements.requiredCanvasFormats.includes(preferredFormat)
  ) {
    const diagnostics = Object.freeze([
      Object.freeze({
        kind: "format" as const,
        name: "preferredCanvasFormat",
        required: requirements.requiredCanvasFormats.join(" or "),
        observed: preferredFormat,
        message: `Canvas format: required=${requirements.requiredCanvasFormats.join(" or ")}, observed=${preferredFormat}.`,
      }),
    ]);
    return {
      ok: false,
      failure: failure(
        "invalid-canvas-format",
        "The WebGPU canvas format is not supported by the Cluster shader.",
        diagnostics[0]?.message ?? "The preferred canvas format was rejected.",
        diagnostics,
      ),
    };
  }

  let device: WebGpuDevice;
  const optionalFeatures = (requirements.optionalFeatures ?? []).filter((feature) =>
    adapter.features.has(feature),
  );
  try {
    device = await adapter.requestDevice({
      requiredFeatures: Object.freeze([
        ...new Set([...requirements.requiredFeatures, ...optionalFeatures]),
      ]),
      requiredLimits: requirements.requiredLimits,
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "The device request failed before startup.";
    const diagnostics = Object.freeze([
      Object.freeze({
        kind: "availability" as const,
        name: "GPUDevice",
        required: "present",
        observed: "request-rejected",
        message: `WebGPU device: required=present, observed=request-rejected (${detail}).`,
      }),
    ]);
    return {
      ok: false,
      failure: failure(
        "device-request-failed",
        "WebGPU could not create the rendering device.",
        detail,
        diagnostics,
      ),
    };
  }
  const deviceFeatures = missingFeatures(device.features, requirements.requiredFeatures);
  if (deviceFeatures.length > 0) {
    destroyDevice(device);
    const diagnostics = featureDiagnostics(device.features, requirements.requiredFeatures);
    return {
      ok: false,
      failure: failure(
        "device-missing-feature",
        "The WebGPU device did not retain a required feature.",
        `Missing device feature${deviceFeatures.length === 1 ? "" : "s"}: ${deviceFeatures.join(", ")}.`,
        diagnostics,
      ),
    };
  }
  const deviceLimits = missingLimits(device.limits, requirements.requiredLimits);
  const deviceResourceLimits = resourceDiagnostics(
    device.limits,
    requirements.resourceRequirements,
  );
  if (deviceLimits.length > 0 || deviceResourceLimits.length > 0) {
    destroyDevice(device);
    const diagnostics = Object.freeze([
      ...limitDiagnostics(device.limits, requirements.requiredLimits),
      ...deviceResourceLimits,
    ]);
    return {
      ok: false,
      failure: failure(
        "device-missing-limit",
        "The WebGPU device did not retain a required limit.",
        `Insufficient device limit${deviceLimits.length + deviceResourceLimits.length === 1 ? "" : "s"}: ${[
          ...deviceLimits,
          ...deviceResourceLimits.map((value) => value.name),
        ].join(", ")}.`,
        diagnostics,
      ),
    };
  }

  let context: WebGpuCanvasContext | null;
  try {
    context = boundary.canvas.getContext("webgpu");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The canvas context request failed.";
    destroyDevice(device);
    const diagnostics = Object.freeze([
      Object.freeze({
        kind: "availability" as const,
        name: "canvas.getContext(webgpu)",
        required: "resolves",
        observed: "error",
        message: `WebGPU canvas context: required=resolves, observed=error (${detail}).`,
      }),
    ]);
    return {
      ok: false,
      failure: failure(
        "context-unavailable",
        "The Cluster canvas could not create a WebGPU context.",
        detail,
        diagnostics,
      ),
    };
  }
  if (context === null) {
    destroyDevice(device);
    const diagnostics = Object.freeze([
      Object.freeze({
        kind: "availability" as const,
        name: "canvas.getContext(webgpu)",
        required: "present",
        observed: "null",
        message: "WebGPU canvas context: required=present, observed=null.",
      }),
    ]);
    return {
      ok: false,
      failure: failure(
        "context-unavailable",
        "The Cluster canvas does not expose a WebGPU context.",
        'The browser returned null for canvas.getContext("webgpu").',
        diagnostics,
      ),
    };
  }

  const format = preferredFormat;
  try {
    context.configure({ device, format, alphaMode: "opaque" });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "The preferred canvas format was rejected.";
    destroyDevice(device);
    const diagnostics = Object.freeze([
      Object.freeze({
        kind: "format" as const,
        name: "canvas.configure",
        required: "accepts-preferred-format",
        observed: "rejected",
        message: `Canvas configuration: required=accepts-preferred-format, observed=rejected (${detail}).`,
      }),
    ]);
    return {
      ok: false,
      failure: failure(
        "context-configure-failed",
        "The WebGPU canvas could not be configured.",
        detail,
        diagnostics,
      ),
    };
  }
  return Object.freeze({
    ok: true as const,
    resources: Object.freeze({
      adapter,
      device,
      context,
      format,
      requirements,
      diagnostics: Object.freeze([]),
    }),
  });
}

function floatsForPoints(points: readonly WebGpuRenderPoint[]): Float32Array {
  const values = new Float32Array(points.length * 7);
  points.forEach((point, index) => {
    const offset = index * 7;
    values[offset] = point.position[0];
    values[offset + 1] = point.position[1];
    values[offset + 2] = point.position[2];
    values[offset + 3] = point.color[0];
    values[offset + 4] = point.color[1];
    values[offset + 5] = point.color[2];
    values[offset + 6] = point.color[3];
  });
  return values;
}

function floatsForLines(lines: readonly WebGpuRenderLine[]): Float32Array {
  const values = new Float32Array(lines.length * 14);
  lines.forEach((line, index) => {
    const offset = index * 14;
    for (const [position, positionOffset] of [
      [line.from, 0],
      [line.to, 7],
    ] as const) {
      values[offset + positionOffset] = position[0];
      values[offset + positionOffset + 1] = position[1];
      values[offset + positionOffset + 2] = position[2];
      values[offset + positionOffset + 3] = line.color[0];
      values[offset + positionOffset + 4] = line.color[1];
      values[offset + positionOffset + 5] = line.color[2];
      values[offset + positionOffset + 6] = line.color[3];
    }
  });
  return values;
}

function createRenderer(
  resources: WebGpuStartupResources,
  canvas: WebGpuCanvas,
  scheduler: WebGpuRenderScheduler,
  onRenderError: ((error: unknown) => void) | undefined,
  onDeviceLost: ((failure: WebGpuFailure) => void) | undefined,
): WebGpuRenderer {
  const { device, context, format } = resources;
  let uniformBuffer: WebGpuBuffer | undefined;
  let pointBuffer: WebGpuBuffer | undefined;
  let lineBuffer: WebGpuBuffer | undefined;
  let pointPipeline: WebGpuRenderPipeline = undefined;
  let linePipeline: WebGpuRenderPipeline = undefined;
  let bindGroup: unknown = undefined;
  let pointCapacity = 0;
  let lineCapacity = 0;
  let currentScene: WebGpuRenderScene | undefined;
  let currentCamera: CameraState | undefined;
  let pending: { readonly scene: WebGpuRenderScene; readonly camera: CameraState } | undefined;
  let scheduled = false;
  let destroyed = false;

  const safelyDestroy = (destroy: (() => void) | undefined): void => {
    try {
      destroy?.();
    } catch {
      // Continue teardown even if one browser resource rejects destruction.
    }
  };

  const dispose = (): void => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    pending = undefined;
    safelyDestroy(() => pointBuffer?.destroy?.());
    safelyDestroy(() => lineBuffer?.destroy?.());
    safelyDestroy(() => uniformBuffer?.destroy?.());
    pointBuffer = undefined;
    lineBuffer = undefined;
    uniformBuffer = undefined;
    safelyDestroy(() => device.destroy?.());
  };

  const publishDeviceLoss = (loss: WebGpuDeviceLoss): void => {
    if (destroyed) {
      return;
    }
    const detail = [
      loss.reason === undefined ? undefined : `Reason: ${loss.reason}.`,
      loss.message,
      "Rendering stopped and GPU resources were released. Reload the page to retry WebGPU.",
    ]
      .filter((value): value is string => value !== undefined && value.length > 0)
      .join(" ");
    const diagnostics = deviceLossDiagnostics(loss);
    dispose();
    onDeviceLost?.(
      failure("device-lost", "The WebGPU device was lost while rendering.", detail, diagnostics),
    );
  };

  const notifyDeviceLoss = (loss: WebGpuDeviceLoss): void => {
    try {
      publishDeviceLoss(loss);
    } catch {
      // A consumer callback must not create an unhandled device-loss rejection.
      dispose();
    }
  };

  const observeDeviceLoss = (): void => {
    void device.lost
      .then(
        (loss) => notifyDeviceLoss(loss),
        (error) =>
          notifyDeviceLoss({
            reason: "unknown",
            message: error instanceof Error ? error.message : "The device-loss signal rejected.",
          }),
      )
      .catch(() => undefined);
  };

  try {
    const shader = device.createShaderModule({ code: SHADER });
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: 1, buffer: { type: "uniform" } }],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
    const vertexBufferLayout = {
      arrayStride: 7 * Float32Array.BYTES_PER_ELEMENT,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 3 * Float32Array.BYTES_PER_ELEMENT, format: "float32x4" },
      ],
    };
    const createPipeline = (topology: "point-list" | "line-list"): WebGpuRenderPipeline =>
      device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module: shader, entryPoint: "vertexMain", buffers: [vertexBufferLayout] },
        fragment: {
          module: shader,
          entryPoint: "fragmentMain",
          targets: [
            {
              format,
              blend: {
                color: {
                  srcFactor: "src-alpha",
                  dstFactor: "one-minus-src-alpha",
                  operation: "add",
                },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
              },
            },
          ],
        },
        primitive: { topology },
      });
    pointPipeline = createPipeline("point-list");
    linePipeline = createPipeline("line-list");
    uniformBuffer = device.createBuffer({
      size: 16 * Float32Array.BYTES_PER_ELEMENT,
      usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST,
    });
    bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });
    if (bindGroup === undefined) {
      throw new Error("The WebGPU device cannot create a camera bind group.");
    }
    observeDeviceLoss();
  } catch (error) {
    dispose();
    throw error;
  }

  const upload = (
    previous: WebGpuBuffer | undefined,
    capacity: number,
    values: Float32Array,
  ): { readonly buffer: WebGpuBuffer | undefined; readonly capacity: number } => {
    if (values.length === 0) {
      previous?.destroy?.();
      return { buffer: undefined, capacity: 0 };
    }
    const byteLength = values.byteLength;
    const nextCapacity = Math.max(byteLength, capacity * 2, 256);
    const buffer =
      previous !== undefined && capacity >= byteLength
        ? previous
        : device.createBuffer({
            size: nextCapacity,
            usage: BUFFER_USAGE_VERTEX | BUFFER_USAGE_COPY_DST,
          });
    if (buffer !== previous) {
      previous?.destroy?.();
    }
    device.queue.writeBuffer(
      buffer,
      0,
      values.buffer as ArrayBuffer,
      values.byteOffset,
      values.byteLength,
    );
    return { buffer, capacity: nextCapacity };
  };

  const renderImmediate = (scene: WebGpuRenderScene, camera: CameraState): void => {
    if (destroyed) {
      return;
    }
    try {
      const cameraBuffer = uniformBuffer;
      if (cameraBuffer === undefined || bindGroup === undefined) {
        return;
      }
      const viewport: ExplorerViewport = {
        width: Math.max(1, canvas.width),
        height: Math.max(1, canvas.height),
      };
      const matrix = createExplorerViewProjectionMatrix(camera, viewport);
      device.queue.writeBuffer(
        cameraBuffer,
        0,
        matrix.buffer as ArrayBuffer,
        matrix.byteOffset,
        matrix.byteLength,
      );
      const pointValues = floatsForPoints(scene.points);
      const lineValues = floatsForLines(scene.connections);
      const pointUpload = upload(pointBuffer, pointCapacity, pointValues);
      const lineUpload = upload(lineBuffer, lineCapacity, lineValues);
      pointBuffer = pointUpload.buffer;
      pointCapacity = pointUpload.capacity;
      lineBuffer = lineUpload.buffer;
      lineCapacity = lineUpload.capacity;
      const view = context.getCurrentTexture().createView();
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view,
            clearValue: { r: 0.025, g: 0.055, b: 0.07, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setBindGroup(0, bindGroup);
      if (lineBuffer !== undefined && lineValues.length > 0) {
        pass.setPipeline(linePipeline);
        pass.setVertexBuffer(0, lineBuffer);
        pass.draw(lineValues.length / 7);
      }
      if (pointBuffer !== undefined && pointValues.length > 0) {
        pass.setPipeline(pointPipeline);
        pass.setVertexBuffer(0, pointBuffer);
        pass.draw(pointValues.length / 7);
      }
      pass.end();
      device.queue.submit([encoder.finish()]);
      currentScene = scene;
      currentCamera = camera;
    } catch (error) {
      onRenderError?.(error);
    }
  };

  const queueRender = (): void => {
    if (scheduled || destroyed) {
      return;
    }
    scheduled = true;
    scheduler.request(() => {
      scheduled = false;
      const next = pending;
      pending = undefined;
      if (next !== undefined) {
        renderImmediate(next.scene, next.camera);
      }
    });
  };

  return Object.freeze({
    setScene(scene: WebGpuRenderScene, camera: CameraState): void {
      if (destroyed) {
        return;
      }
      pending = Object.freeze({ scene, camera });
      queueRender();
    },
    resize(width: number, height: number, devicePixelRatio: number): void {
      if (destroyed) {
        return;
      }
      const ratio =
        Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      try {
        context.configure({ device, format, alphaMode: "opaque" });
      } catch (error) {
        onRenderError?.(error);
      }
      if (currentScene !== undefined) {
        pending = Object.freeze({
          scene: currentScene,
          camera: currentCamera ?? {
            target: Object.freeze([0, 0, 0]) as ExplorerVector3,
            yaw: Math.PI / 4,
            pitch: 0.36,
            distance: 3.2,
            far: undefined,
          },
        });
        queueRender();
      }
    },
    renderNow: renderImmediate,
    destroy: dispose,
  });
}

/**
 * Creates a real WebGPU point-and-line renderer after capability validation succeeds.
 *
 * @param boundary - Injected browser GPU, canvas, and capability requirements.
 * @param options - Optional scheduler and render-error callback.
 * @returns A renderer or an accessible hard-failure result.
 */
export async function createWebGpuRenderer(
  boundary: WebGpuStartupBoundary,
  options:
    | {
        readonly scheduler: WebGpuRenderScheduler | undefined;
        readonly onRenderError: ((error: unknown) => void) | undefined;
        readonly onDeviceLost: ((failure: WebGpuFailure) => void) | undefined;
      }
    | undefined = undefined,
): Promise<WebGpuRendererResult> {
  let capabilities: WebGpuCapabilityResult;
  try {
    capabilities = await checkWebGpuCapabilities(boundary);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "The injected browser capability seam threw.";
    const diagnostics = Object.freeze([
      Object.freeze({
        kind: "availability" as const,
        name: "capability-validation",
        required: "completes",
        observed: "threw",
        message: `Capability validation: required=completes, observed=threw (${detail}).`,
      }),
    ]);
    return {
      ok: false,
      failure: failure(
        "renderer-init-failed",
        "WebGPU capability validation failed unexpectedly.",
        detail,
        diagnostics,
      ),
    };
  }
  if (!capabilities.ok) {
    return capabilities;
  }
  try {
    const renderer = createRenderer(
      capabilities.resources,
      boundary.canvas,
      options?.scheduler ?? defaultScheduler(),
      options?.onRenderError,
      options?.onDeviceLost,
    );
    return Object.freeze({ ok: true as const, renderer, resources: capabilities.resources });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The render pipeline setup failed.";
    const diagnostics = Object.freeze([
      Object.freeze({
        kind: "shader-assumption" as const,
        name: "renderer-pipeline",
        required: "initializes",
        observed: "failed",
        message: `Renderer pipeline: required=initializes, observed=failed (${detail}).`,
      }),
    ]);
    return {
      ok: false,
      failure: failure(
        "renderer-init-failed",
        "WebGPU started but the Cluster renderer could not be initialized.",
        detail,
        diagnostics,
      ),
    };
  }
}

function scaleRequirementsFor(
  requirements: WebGpuStartupBoundary["requirements"],
): WebGpuStartupRequirements {
  const suppliedFeatures = requirements?.requiredFeatures ?? [];
  const suppliedOptionalFeatures = requirements?.optionalFeatures ?? [];
  const suppliedLimits = requirements?.requiredLimits ?? {};
  const requiredLimits: Record<string, number> = {
    ...DEFAULT_WEBGPU_SCALE_REQUIREMENTS.requiredLimits,
  };
  for (const [name, required] of Object.entries(suppliedLimits)) {
    requiredLimits[name] = Math.max(requiredLimits[name] ?? 0, required);
  }
  return Object.freeze({
    requiredFeatures: Object.freeze([
      ...new Set([...DEFAULT_WEBGPU_SCALE_REQUIREMENTS.requiredFeatures, ...suppliedFeatures]),
    ]),
    optionalFeatures: Object.freeze([
      ...new Set([
        ...(DEFAULT_WEBGPU_SCALE_REQUIREMENTS.optionalFeatures ?? []),
        ...suppliedOptionalFeatures,
      ]),
    ]),
    requiredLimits: Object.freeze(requiredLimits),
    requiredCanvasFormats: Object.freeze([
      ...new Set([
        ...(DEFAULT_WEBGPU_SCALE_REQUIREMENTS.requiredCanvasFormats ?? []),
        ...(requirements?.requiredCanvasFormats ?? []),
      ]),
    ]),
    shaderAssumptions:
      requirements?.shaderAssumptions === undefined
        ? DEFAULT_WEBGPU_SCALE_REQUIREMENTS.shaderAssumptions
        : Object.freeze([
            ...(DEFAULT_WEBGPU_SCALE_REQUIREMENTS.shaderAssumptions ?? []),
            ...requirements.shaderAssumptions,
          ]),
    resourceRequirements:
      requirements?.resourceRequirements === undefined
        ? DEFAULT_WEBGPU_SCALE_REQUIREMENTS.resourceRequirements
        : Object.freeze([
            ...(DEFAULT_WEBGPU_SCALE_REQUIREMENTS.resourceRequirements ?? []),
            ...requirements.resourceRequirements,
          ]),
  });
}

/**
 * Chooses GPU timestamps only when the optional feature and query-set creation are both exposed.
 *
 * @param device - Injected WebGPU device capability view.
 * @returns GPU timestamp mode or the requestAnimationFrame fallback mode.
 */
export function selectWebGpuTimingSource(
  device: WebGpuDevice & WebGpuTimestampDevice,
): WebGpuBenchmarkTimingSource {
  try {
    const timestampPeriod = device.limits.timestampPeriod;
    return device.features.has("timestamp-query") &&
      typeof device.createQuerySet === "function" &&
      timestampPeriod !== undefined &&
      Number.isFinite(timestampPeriod) &&
      timestampPeriod > 0
      ? "gpu-timestamp"
      : "request-animation-frame";
  } catch {
    return "request-animation-frame";
  }
}

function scaleMethodDiagnostic(
  name: string,
  observed: string | undefined,
): WebGpuCapabilityDiagnostic {
  return Object.freeze({
    kind: "shader-assumption",
    name,
    required: "function",
    observed,
    message: `WebGPU API assumption ${name}: required=function, observed=${observed ?? "missing"}.`,
  });
}

class WebGpuScaleInitializationError extends Error {
  readonly diagnostics: readonly WebGpuCapabilityDiagnostic[];

  constructor(message: string, diagnostics: readonly WebGpuCapabilityDiagnostic[]) {
    super(message);
    this.name = "WebGpuScaleInitializationError";
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

type WebGpuTimestampResources = {
  readonly querySet: WebGpuQuerySet;
  readonly resolveBuffer: WebGpuBuffer;
  readonly readbackBuffer: WebGpuBuffer;
  /** WebGPU timestamp query units are nanoseconds per timestamp tick. */
  readonly timestampPeriodNanoseconds: number;
};

type WebGpuPreparationObject = object;

function preparationObject(value: unknown, label: string): WebGpuPreparationObject {
  if (typeof value !== "object" || value === null) {
    throw new RangeError(`${label} must be an object.`);
  }
  return value;
}

function preparationOwnNames(value: unknown, label: string): readonly string[] {
  const object = preparationObject(value, label);
  try {
    if (Object.getOwnPropertySymbols(object).length > 0) {
      throw new RangeError(`${label} must not contain symbol properties.`);
    }
    return Object.getOwnPropertyNames(object);
  } catch (error) {
    if (error instanceof RangeError) {
      throw error;
    }
    throw new RangeError(`${label} must expose stable own properties.`);
  }
}

function preparationDataProperty(value: unknown, key: string, label: string): unknown {
  const object = preparationObject(value, label);
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(object, key);
  } catch {
    throw new RangeError(`${label}.${key} must expose a readable data property.`);
  }
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new RangeError(`${label}.${key} must be an own data property.`);
  }
  return descriptor.value;
}

function preparationOptionalDataProperty(
  value: unknown,
  key: string,
  label: string,
): unknown | undefined {
  if (!preparationOwnNames(value, label).includes(key)) {
    return undefined;
  }
  return preparationDataProperty(value, key, label);
}

function preparationShape(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const names = preparationOwnNames(value, label);
  const allowed = new Set([...required, ...optional]);
  for (const name of required) {
    if (!names.includes(name)) {
      throw new RangeError(`${label}.${name} is required.`);
    }
  }
  for (const name of names) {
    if (!allowed.has(name)) {
      throw new RangeError(`${label}.${name} is not part of the preparation contract.`);
    }
  }
}

function preparationDenseValues(value: unknown, length: number, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new RangeError(`${label} must be a dense JavaScript array.`);
  }
  const names = preparationOwnNames(value, label);
  const expectedNames = [...Array.from({ length }, (_, index) => String(index)), "length"];
  if (
    names.length !== expectedNames.length ||
    expectedNames.some((name) => !names.includes(name))
  ) {
    throw new RangeError(`${label} must contain exactly ${String(length)} dense entries.`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    lengthDescriptor.value !== length
  ) {
    throw new RangeError(`${label} has an invalid length.`);
  }
  return Object.freeze(
    Array.from({ length }, (_, index) => preparationDataProperty(value, String(index), label)),
  );
}

function preparationFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite.`);
  }
  return value;
}

function preparationPositiveNumber(value: unknown, label: string): number {
  const number = preparationFiniteNumber(value, label);
  if (number <= 0) {
    throw new RangeError(`${label} must be greater than zero.`);
  }
  return number;
}

function preparationSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer.`);
  }
  return value;
}

function preparationPositiveInteger(value: unknown, label: string): number {
  const number = preparationSafeInteger(value, label);
  if (number <= 0) {
    throw new RangeError(`${label} must be positive.`);
  }
  return number;
}

function preparationU32(value: unknown, label: string, allowZero = true): number {
  const number = preparationSafeInteger(value, label);
  if ((allowZero ? number < 0 : number <= 0) || number > MAX_WEBGPU_U32) {
    throw new RangeError(`${label} must fit the WGSL u32 range.`);
  }
  return number;
}

function preparationString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new RangeError(`${label} must be a string.`);
  }
  return value;
}

function preparationNumberArray(value: unknown, length: number, label: string): readonly number[] {
  return Object.freeze(
    preparationDenseValues(value, length, label).map((entry, index) =>
      preparationFiniteNumber(entry, `${label}[${String(index)}]`),
    ),
  );
}

function preparationEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new RangeError(`${label} mismatch.`);
  }
}

function preparationEqualArray(
  actual: readonly number[],
  expected: readonly number[],
  label: string,
): void {
  if (actual.length !== expected.length) {
    throw new RangeError(`${label} length mismatch.`);
  }
  for (let index = 0; index < actual.length; index += 1) {
    preparationEqual(actual[index], expected[index], `${label}[${String(index)}]`);
  }
}

function preparationDeviceLimit(limits: WebGpuLimits, name: string, required: number): number {
  const observed = limits[name];
  if (observed === undefined || !Number.isFinite(observed) || observed < required) {
    throw new RangeError(
      `device limit ${name} must be at least ${String(required)} (observed ${String(observed ?? "missing")}).`,
    );
  }
  return observed;
}

function preparationContract(value: unknown): WebGpuScalePreparation["contract"] {
  preparationShape(
    value,
    [
      "contractVersion",
      "generatorVersion",
      "seed",
      "seedType",
      "seedText",
      "seedIdentity",
      "seedCodeUnits",
      "seedHash",
      "seedTextHash",
      "pointHash",
      "pointTextHash",
      "logicalPopulation",
      "regionRadiusMeters",
    ],
    [],
    "preparation.contract",
  );
  const seedValue = preparationDataProperty(value, "seed", "preparation.contract");
  preparationShape(seedValue, ["kind", "type", "value", "text", "identity"], [], "contract.seed");
  const seedKind = preparationString(
    preparationDataProperty(seedValue, "kind", "contract.seed"),
    "contract.seed.kind",
  );
  const seedType = preparationString(
    preparationDataProperty(value, "seedType", "preparation.contract"),
    "contract.seedType",
  );
  if (seedKind !== "number" && seedKind !== "string") {
    throw new RangeError("contract.seed.kind must be number or string.");
  }
  preparationEqual(seedKind, seedType, "contract.seedType");
  preparationEqual(
    preparationDataProperty(seedValue, "type", "contract.seed"),
    seedKind,
    "contract.seed.type",
  );
  const rawSeedValue = preparationDataProperty(seedValue, "value", "contract.seed");
  if (
    (seedKind === "number" &&
      (typeof rawSeedValue !== "number" || !Number.isSafeInteger(rawSeedValue))) ||
    (seedKind === "string" && typeof rawSeedValue !== "string")
  ) {
    throw new RangeError("contract.seed.value has an invalid type.");
  }
  const seedText = preparationString(
    preparationDataProperty(value, "seedText", "preparation.contract"),
    "contract.seedText",
  );
  const seedIdentity = preparationString(
    preparationDataProperty(value, "seedIdentity", "preparation.contract"),
    "contract.seedIdentity",
  );
  preparationEqual(
    preparationDataProperty(seedValue, "text", "contract.seed"),
    seedText,
    "contract.seed.text",
  );
  preparationEqual(
    preparationDataProperty(seedValue, "identity", "contract.seed"),
    seedIdentity,
    "contract.seed.identity",
  );
  const seedCodeUnits = preparationNumberArray(
    preparationDataProperty(value, "seedCodeUnits", "preparation.contract"),
    seedIdentity.length,
    "contract.seedCodeUnits",
  );
  if (seedCodeUnits.length > MAX_WEBGPU_SEED_CODE_UNITS) {
    throw new RangeError("contract.seedCodeUnits exceeds the hard GPU seed cap.");
  }
  for (let index = 0; index < seedCodeUnits.length; index += 1) {
    const codeUnit = seedCodeUnits[index];
    if (
      codeUnit === undefined ||
      !Number.isSafeInteger(codeUnit) ||
      codeUnit < 0 ||
      codeUnit > 0xffff
    ) {
      throw new RangeError(`contract.seedCodeUnits[${String(index)}] is not a UTF-16 code unit.`);
    }
    preparationEqual(
      codeUnit,
      seedIdentity.charCodeAt(index),
      `contract.seedCodeUnits[${String(index)}]`,
    );
  }
  const logicalPopulation = preparationU32(
    preparationDataProperty(value, "logicalPopulation", "preparation.contract"),
    "contract.logicalPopulation",
    false,
  );
  const generatorVersion = preparationString(
    preparationDataProperty(value, "generatorVersion", "preparation.contract"),
    "contract.generatorVersion",
  );
  const regionRadiusMeters = preparationPositiveNumber(
    preparationDataProperty(value, "regionRadiusMeters", "preparation.contract"),
    "contract.regionRadiusMeters",
  );
  const canonical = createWebGpuScaleContract({
    logicalPopulation,
    seed: rawSeedValue as ScenarioSeedInput,
    generatorVersion,
    regionRadiusMeters,
  });
  preparationEqual(
    preparationDataProperty(value, "contractVersion", "preparation.contract"),
    canonical.contractVersion,
    "contract.contractVersion",
  );
  const equalFields = [
    "generatorVersion",
    "seedType",
    "seedText",
    "seedIdentity",
    "seedHash",
    "seedTextHash",
    "pointHash",
    "pointTextHash",
    "logicalPopulation",
    "regionRadiusMeters",
  ] as const;
  for (const field of equalFields) {
    preparationEqual(
      preparationDataProperty(value, field, "preparation.contract"),
      canonical[field],
      `contract.${field}`,
    );
  }
  const canonicalSeedFields = ["kind", "type", "value", "text", "identity"] as const;
  for (const field of canonicalSeedFields) {
    preparationEqual(
      preparationDataProperty(seedValue, field, "contract.seed"),
      canonical.seed[field],
      `contract.seed.${field}`,
    );
  }
  preparationEqualArray(seedCodeUnits, canonical.seedCodeUnits, "contract.seedCodeUnits");
  return canonical;
}

function preparationView(value: unknown): WebGpuScalePreparation["view"] {
  preparationShape(
    value,
    ["viewProjectionMatrix", "viewportWidth", "viewportHeight", "cameraDistance", "far"],
    ["worldRadiusMeters"],
    "preparation.view",
  );
  const viewProjectionMatrix = preparationNumberArray(
    preparationDataProperty(value, "viewProjectionMatrix", "preparation.view"),
    16,
    "view.viewProjectionMatrix",
  );
  for (let index = 0; index < viewProjectionMatrix.length; index += 1) {
    if (!Number.isFinite(Math.fround(viewProjectionMatrix[index] ?? Number.NaN))) {
      throw new RangeError(
        `view.viewProjectionMatrix[${String(index)}] is not representable as f32.`,
      );
    }
  }
  const worldRadiusValue = preparationOptionalDataProperty(
    value,
    "worldRadiusMeters",
    "preparation.view",
  );
  const worldRadiusMeters =
    worldRadiusValue === undefined
      ? undefined
      : preparationPositiveNumber(worldRadiusValue, "view.worldRadiusMeters");
  const snapshot = {
    viewProjectionMatrix: Object.freeze([...viewProjectionMatrix]),
    viewportWidth: preparationPositiveNumber(
      preparationDataProperty(value, "viewportWidth", "preparation.view"),
      "view.viewportWidth",
    ),
    viewportHeight: preparationPositiveNumber(
      preparationDataProperty(value, "viewportHeight", "preparation.view"),
      "view.viewportHeight",
    ),
    cameraDistance: preparationPositiveNumber(
      preparationDataProperty(value, "cameraDistance", "preparation.view"),
      "view.cameraDistance",
    ),
    far: preparationPositiveNumber(
      preparationDataProperty(value, "far", "preparation.view"),
      "view.far",
    ),
    ...(worldRadiusMeters === undefined ? {} : { worldRadiusMeters }),
  };
  return Object.freeze(snapshot);
}

function preparationFrustumPlanes(
  value: unknown,
): readonly (readonly [number, number, number, number])[] {
  const entries = preparationDenseValues(value, 6, "preparation.frustumPlanes");
  const planes = entries.map(
    (entry, index) =>
      Object.freeze(
        preparationNumberArray(entry, 4, `preparation.frustumPlanes[${String(index)}]`),
      ) as readonly [number, number, number, number],
  );
  return Object.freeze(planes);
}

function preparationLod(
  value: unknown,
  contract: WebGpuScalePreparation["contract"],
  view: WebGpuScalePreparation["view"],
): WebGpuScalePreparation["lod"] {
  preparationShape(
    value,
    [
      "level",
      "apparentRadiusPixels",
      "range",
      "candidateCount",
      "visibleCapacity",
      "dispatchWorkgroups",
    ],
    [],
    "preparation.lod",
  );
  const rangeValue = preparationDataProperty(value, "range", "preparation.lod");
  preparationShape(rangeValue, ["logicalStart", "logicalCount", "logicalStride"], [], "lod.range");
  const visibleCapacity = preparationPositiveInteger(
    preparationDataProperty(value, "visibleCapacity", "preparation.lod"),
    "lod.visibleCapacity",
  );
  if (visibleCapacity > MAX_WEBGPU_VISIBLE_POINTS) {
    throw new RangeError("lod.visibleCapacity exceeds the hard GPU output cap.");
  }
  const level = preparationSafeInteger(
    preparationDataProperty(value, "level", "preparation.lod"),
    "lod.level",
  );
  if (level < 0) {
    throw new RangeError("lod.level must be a non-negative integer.");
  }
  const snapshot = Object.freeze({
    level,
    apparentRadiusPixels: preparationPositiveNumber(
      preparationDataProperty(value, "apparentRadiusPixels", "preparation.lod"),
      "lod.apparentRadiusPixels",
    ),
    range: Object.freeze({
      logicalStart: preparationU32(
        preparationDataProperty(rangeValue, "logicalStart", "lod.range"),
        "lod.range.logicalStart",
      ),
      logicalCount: preparationU32(
        preparationDataProperty(rangeValue, "logicalCount", "lod.range"),
        "lod.range.logicalCount",
        false,
      ),
      logicalStride: preparationPositiveInteger(
        preparationDataProperty(rangeValue, "logicalStride", "lod.range"),
        "lod.range.logicalStride",
      ),
    }),
    candidateCount: preparationPositiveInteger(
      preparationDataProperty(value, "candidateCount", "preparation.lod"),
      "lod.candidateCount",
    ),
    visibleCapacity,
    dispatchWorkgroups: preparationPositiveInteger(
      preparationDataProperty(value, "dispatchWorkgroups", "preparation.lod"),
      "lod.dispatchWorkgroups",
    ),
  });
  if (snapshot.candidateCount > MAX_WEBGPU_VISIBLE_POINTS) {
    throw new RangeError("lod.candidateCount exceeds the hard GPU candidate cap.");
  }
  if (snapshot.dispatchWorkgroups > MAX_COMPUTE_WORKGROUPS_PER_DIMENSION) {
    throw new RangeError("lod.dispatchWorkgroups exceeds the hard GPU dispatch cap.");
  }
  const expected = selectWebGpuLod(contract, view, visibleCapacity);
  preparationEqual(snapshot.level, expected.level, "lod.level");
  preparationEqual(
    snapshot.apparentRadiusPixels,
    expected.apparentRadiusPixels,
    "lod.apparentRadiusPixels",
  );
  preparationEqual(snapshot.candidateCount, expected.candidateCount, "lod.candidateCount");
  preparationEqual(snapshot.visibleCapacity, expected.visibleCapacity, "lod.visibleCapacity");
  preparationEqual(
    snapshot.dispatchWorkgroups,
    expected.dispatchWorkgroups,
    "lod.dispatchWorkgroups",
  );
  preparationEqualArray(
    [snapshot.range.logicalStart, snapshot.range.logicalCount, snapshot.range.logicalStride],
    [expected.range.logicalStart, expected.range.logicalCount, expected.range.logicalStride],
    "lod.range",
  );
  return expected;
}

function preparationBudget(
  value: unknown,
  contract: WebGpuScalePreparation["contract"],
  lod: WebGpuScalePreparation["lod"],
  deviceLimits: WebGpuLimits,
): WebGpuResourceBudget {
  preparationShape(
    value,
    [
      "pointBufferBytes",
      "indirectBufferBytes",
      "uniformBufferBytes",
      "seedBufferBytes",
      "totalBufferBytes",
      "pointStrideBytes",
      "visibleCapacity",
      "candidateCount",
      "dispatchWorkgroups",
      "workgroupSize",
      "maxBufferSize",
    ],
    [],
    "preparation.budget",
  );
  const fields = [
    "pointBufferBytes",
    "indirectBufferBytes",
    "uniformBufferBytes",
    "seedBufferBytes",
    "totalBufferBytes",
    "pointStrideBytes",
    "visibleCapacity",
    "candidateCount",
    "dispatchWorkgroups",
    "workgroupSize",
    "maxBufferSize",
  ] as const;
  for (const field of fields) {
    preparationPositiveInteger(
      preparationDataProperty(value, field, "preparation.budget"),
      `budget.${field}`,
    );
  }
  const maxBufferSize = preparationPositiveInteger(
    preparationDataProperty(value, "maxBufferSize", "preparation.budget"),
    "budget.maxBufferSize",
  );
  const expected = createWebGpuResourceBudget({
    candidateCount: lod.candidateCount,
    visibleCapacity: lod.visibleCapacity,
    seedCodeUnitCount: contract.seedCodeUnits.length,
    maxBufferSize,
  });
  for (const field of fields) {
    preparationEqual(
      preparationDataProperty(value, field, "preparation.budget"),
      expected[field],
      `budget.${field}`,
    );
  }
  if (expected.totalBufferBytes > MAX_WEBGPU_SCALE_BUFFER_BYTES) {
    throw new RangeError("budget.totalBufferBytes exceeds the hard GPU allocation cap.");
  }
  const requiredLimits = DEFAULT_WEBGPU_SCALE_REQUIREMENTS.requiredLimits;
  const requiredLimit = (name: string): number => {
    const required = requiredLimits[name];
    if (required === undefined) {
      throw new RangeError(`The scale renderer has no required value for ${name}.`);
    }
    return required;
  };
  const observedMaxBufferSize = preparationDeviceLimit(
    deviceLimits,
    "maxBufferSize",
    requiredLimit("maxBufferSize"),
  );
  const observedStorageSize = preparationDeviceLimit(
    deviceLimits,
    "maxStorageBufferBindingSize",
    requiredLimit("maxStorageBufferBindingSize"),
  );
  const observedUniformSize = preparationDeviceLimit(
    deviceLimits,
    "maxUniformBufferBindingSize",
    requiredLimit("maxUniformBufferBindingSize"),
  );
  preparationDeviceLimit(
    deviceLimits,
    "maxStorageBuffersPerShaderStage",
    requiredLimit("maxStorageBuffersPerShaderStage"),
  );
  preparationDeviceLimit(
    deviceLimits,
    "maxUniformBuffersPerShaderStage",
    requiredLimit("maxUniformBuffersPerShaderStage"),
  );
  preparationDeviceLimit(
    deviceLimits,
    "maxComputeInvocationsPerWorkgroup",
    requiredLimit("maxComputeInvocationsPerWorkgroup"),
  );
  const observedWorkgroupSizeX = preparationDeviceLimit(
    deviceLimits,
    "maxComputeWorkgroupSizeX",
    requiredLimit("maxComputeWorkgroupSizeX"),
  );
  const observedDispatchDimension = preparationDeviceLimit(
    deviceLimits,
    "maxComputeWorkgroupsPerDimension",
    requiredLimit("maxComputeWorkgroupsPerDimension"),
  );
  preparationDeviceLimit(deviceLimits, "maxBindGroups", requiredLimit("maxBindGroups"));
  preparationDeviceLimit(deviceLimits, "maxVertexBuffers", requiredLimit("maxVertexBuffers"));
  if (expected.totalBufferBytes > observedMaxBufferSize) {
    throw new RangeError("budget exceeds the device maxBufferSize.");
  }
  if (
    expected.pointBufferBytes > observedStorageSize ||
    expected.seedBufferBytes > observedStorageSize
  ) {
    throw new RangeError("budget exceeds the device maxStorageBufferBindingSize.");
  }
  if (expected.uniformBufferBytes > observedUniformSize) {
    throw new RangeError("budget exceeds the device maxUniformBufferBindingSize.");
  }
  if (
    expected.workgroupSize > observedWorkgroupSizeX ||
    expected.dispatchWorkgroups > observedDispatchDimension
  ) {
    throw new RangeError("budget exceeds the device compute dispatch limits.");
  }
  return expected;
}

/**
 * Snapshots and validates public scale preparation data before any scale buffer is allocated or
 * compute dispatch is encoded. Structural objects with accessors, sparse arrays, mismatched
 * derived values, oversized resources, and device-limit violations fail closed.
 *
 * @param value - Untrusted structural preparation supplied by a caller or browser boundary.
 * @param deviceLimits - The validated limits of the active WebGPU device.
 * @returns A frozen preparation snapshot containing only validated data properties.
 * @throws RangeError when any nested preparation contract is malformed or inconsistent.
 */
export function validateWebGpuScalePreparation(
  value: unknown,
  deviceLimits: WebGpuLimits,
): WebGpuScalePreparation {
  if (!isTrustedWebGpuScalePreparation(value)) {
    throw new RangeError(
      "preparation must be created by prepareWebGpuScale and must retain its private identity brand.",
    );
  }
  preparationShape(
    value,
    ["contract", "view", "frustumPlanes", "lod", "budget"],
    [],
    "preparation",
  );
  const contract = preparationContract(preparationDataProperty(value, "contract", "preparation"));
  const view = preparationView(preparationDataProperty(value, "view", "preparation"));
  const matrix = view.viewProjectionMatrix;
  const frustumPlanes = preparationFrustumPlanes(
    preparationDataProperty(value, "frustumPlanes", "preparation"),
  );
  const expectedFrustumPlanes = extractWebGpuFrustumPlanes(matrix);
  for (let plane = 0; plane < expectedFrustumPlanes.length; plane += 1) {
    const observed = frustumPlanes[plane];
    const expected = expectedFrustumPlanes[plane];
    if (observed === undefined || expected === undefined) {
      throw new RangeError(`preparation.frustumPlanes[${String(plane)}] is missing.`);
    }
    preparationEqualArray(observed, expected, `preparation.frustumPlanes[${String(plane)}]`);
  }
  const lod = preparationLod(preparationDataProperty(value, "lod", "preparation"), contract, view);
  const budget = preparationBudget(
    preparationDataProperty(value, "budget", "preparation"),
    contract,
    lod,
    deviceLimits,
  );
  return Object.freeze({
    contract,
    view,
    frustumPlanes: expectedFrustumPlanes,
    lod,
    budget,
  });
}

function overlayDataProperty(value: unknown, key: string, label: string): unknown {
  if (typeof value !== "object" || value === null) {
    throw new RangeError(`${label} must be an object.`);
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    throw new RangeError(`${label}.${key} must expose a stable data property.`);
  }
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new RangeError(`${label}.${key} must be an own data property.`);
  }
  return descriptor.value;
}

function overlayArrayLength(value: unknown, maximumLength: number, label: string): number {
  if (!Array.isArray(value)) {
    throw new RangeError(`${label} must be a dense JavaScript array.`);
  }
  const lengthValue = overlayDataProperty(value, "length", label);
  if (
    typeof lengthValue !== "number" ||
    !Number.isSafeInteger(lengthValue) ||
    lengthValue < 0 ||
    lengthValue > maximumLength
  ) {
    throw new RangeError(`${label} exceeds its bounded overlay length.`);
  }
  return lengthValue;
}

function overlayDenseValues(
  value: unknown,
  maximumLength: number,
  label: string,
): readonly unknown[] {
  return preparationDenseValues(value, overlayArrayLength(value, maximumLength, label), label);
}

function overlayVector(value: unknown, length: 3 | 4, label: string): readonly number[] {
  const values = overlayDenseValues(value, length, label);
  if (values.length !== length) {
    throw new RangeError(`${label} must contain exactly ${String(length)} components.`);
  }
  const result: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const component = preparationFiniteNumber(values[index], `${label}[${String(index)}]`);
    if (length === 4 && (component < 0 || component > 1)) {
      throw new RangeError(`${label}[${String(index)}] must be between zero and one.`);
    }
    result.push(component);
  }
  return Object.freeze(result);
}

function overlayPoint(value: unknown, index: number): WebGpuRenderPoint {
  const label = `scale scene.overlay.points[${String(index)}]`;
  preparationShape(value, ["position", "color"], [], label);
  const position = overlayVector(
    overlayDataProperty(value, "position", label),
    3,
    `${label}.position`,
  ) as readonly [number, number, number];
  const color = overlayVector(
    overlayDataProperty(value, "color", label),
    4,
    `${label}.color`,
  ) as readonly [number, number, number, number];
  return Object.freeze({ position, color });
}

function overlayConnection(value: unknown, index: number): WebGpuRenderLine {
  const label = `scale scene.overlay.connections[${String(index)}]`;
  preparationShape(value, ["from", "to", "color"], [], label);
  const from = overlayVector(
    overlayDataProperty(value, "from", label),
    3,
    `${label}.from`,
  ) as readonly [number, number, number];
  const to = overlayVector(overlayDataProperty(value, "to", label), 3, `${label}.to`) as readonly [
    number,
    number,
    number,
  ];
  const color = overlayVector(
    overlayDataProperty(value, "color", label),
    4,
    `${label}.color`,
  ) as readonly [number, number, number, number];
  return Object.freeze({ from, to, color });
}

/**
 * Snapshots and validates the CPU overlay before any scale GPU buffer allocation or dispatch.
 *
 * @param value - Untrusted scale-scene overlay value.
 * @returns A bounded data-only scene and its independent buffer budget.
 * @throws RangeError when the overlay is sparse, accessor-backed, malformed, or oversized.
 */
export function validateWebGpuScaleOverlay(value: unknown): WebGpuScaleOverlaySnapshot {
  preparationShape(value, ["points", "connections"], [], "scale scene.overlay");
  const pointsValue = overlayDataProperty(value, "points", "scale scene.overlay");
  const connectionsValue = overlayDataProperty(value, "connections", "scale scene.overlay");
  const pointCount = overlayArrayLength(
    pointsValue,
    MAX_WEBGPU_SCALE_OVERLAY_POINTS,
    "scale scene.overlay.points",
  );
  const connectionCount = overlayArrayLength(
    connectionsValue,
    MAX_WEBGPU_SCALE_OVERLAY_CONNECTIONS,
    "scale scene.overlay.connections",
  );
  const pointPayloadBytes = pointCount * WEBGPU_OVERLAY_POINT_STRIDE_BYTES;
  const connectionPayloadBytes = connectionCount * WEBGPU_OVERLAY_CONNECTION_STRIDE_BYTES;
  const pointBufferBytes = overlayBufferCapacity(pointPayloadBytes);
  const connectionBufferBytes = overlayBufferCapacity(connectionPayloadBytes);
  const pointConversionBytes = pointPayloadBytes;
  const connectionConversionBytes = connectionPayloadBytes;
  const conversionBytes = pointConversionBytes + connectionConversionBytes;
  const totalBufferBytes = pointBufferBytes + connectionBufferBytes;
  const peakBufferBytes = totalBufferBytes + conversionBytes;
  if (peakBufferBytes > MAX_WEBGPU_SCALE_OVERLAY_BUFFER_BYTES) {
    throw new RangeError("scale scene.overlay exceeds its independent GPU buffer budget.");
  }
  const points = preparationDenseValues(pointsValue, pointCount, "scale scene.overlay.points");
  const connections = preparationDenseValues(
    connectionsValue,
    connectionCount,
    "scale scene.overlay.connections",
  );
  const scene = Object.freeze({
    points: Object.freeze(points.map((point, index) => overlayPoint(point, index))),
    connections: Object.freeze(
      connections.map((connection, index) => overlayConnection(connection, index)),
    ),
  });
  return Object.freeze({
    scene,
    budget: Object.freeze({
      pointCount,
      connectionCount,
      pointBufferBytes,
      connectionBufferBytes,
      totalBufferBytes,
      pointConversionBytes,
      connectionConversionBytes,
      conversionBytes,
      peakBufferBytes,
      maxBufferBytes: MAX_WEBGPU_SCALE_OVERLAY_BUFFER_BYTES,
    }),
  });
}

function overlayPointValues(points: readonly WebGpuRenderPoint[]): Float32Array {
  return floatsForPoints(points);
}

function overlayLineValues(lines: readonly WebGpuRenderLine[]): Float32Array {
  return floatsForLines(lines);
}

function overlayBufferCapacity(byteLength: number): number {
  return byteLength === 0 ? 0 : Math.max(MIN_VERTEX_BUFFER_BYTES, byteLength);
}

function overlayTransitionPeakBytes(
  snapshot: WebGpuScaleOverlaySnapshot,
  pointCapacityBytes: number,
  lineCapacityBytes: number,
): number {
  const nextPointCapacityBytes = snapshot.budget.pointBufferBytes;
  const nextLineCapacityBytes = snapshot.budget.connectionBufferBytes;
  const pointReuses = nextPointCapacityBytes > 0 && pointCapacityBytes >= nextPointCapacityBytes;
  const lineReuses = nextLineCapacityBytes > 0 && lineCapacityBytes >= nextLineCapacityBytes;
  const pointPeakBytes =
    pointCapacityBytes +
    (pointReuses ? 0 : nextPointCapacityBytes) +
    lineCapacityBytes +
    snapshot.budget.conversionBytes;
  const pointAfterBytes =
    nextPointCapacityBytes === 0 ? 0 : pointReuses ? pointCapacityBytes : nextPointCapacityBytes;
  const linePeakBytes =
    pointAfterBytes +
    lineCapacityBytes +
    (lineReuses ? 0 : nextLineCapacityBytes) +
    snapshot.budget.conversionBytes;
  return Math.max(pointPeakBytes, linePeakBytes);
}

function createScaleRenderer(
  resources: WebGpuStartupResources,
  canvas: WebGpuCanvas,
  scheduler: WebGpuRenderScheduler,
  onRenderError: ((error: unknown) => void) | undefined,
  onDeviceLost: ((failure: WebGpuFailure) => void) | undefined,
): WebGpuScaleRenderer {
  const device = resources.device as WebGpuScaleDevice & WebGpuTimestampDevice;
  if (typeof device.createComputePipeline !== "function") {
    const diagnostics = Object.freeze([
      scaleMethodDiagnostic("device.createComputePipeline", undefined),
    ]);
    destroyDevice(device);
    throw new WebGpuScaleInitializationError(
      diagnostics[0]?.message ?? "The compute pipeline API is unavailable.",
      diagnostics,
    );
  }

  const { context, format } = resources;
  let commandEncoder: WebGpuCommandEncoder;
  try {
    commandEncoder = device.createCommandEncoder();
    if (commandEncoder.beginComputePass === undefined) {
      const diagnostics = Object.freeze([
        scaleMethodDiagnostic("commandEncoder.beginComputePass", undefined),
      ]);
      throw new WebGpuScaleInitializationError(
        diagnostics[0]?.message ?? "The compute pass API is unavailable.",
        diagnostics,
      );
    }
    const probePass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "discard",
        },
      ],
    });
    if (probePass.drawIndirect === undefined) {
      probePass.end();
      const diagnostics = Object.freeze([
        scaleMethodDiagnostic("renderPass.drawIndirect", undefined),
      ]);
      throw new WebGpuScaleInitializationError(
        diagnostics[0]?.message ?? "The indirect draw API is unavailable.",
        diagnostics,
      );
    }
    probePass.end();
    commandEncoder.finish();
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "The scale command encoder probe failed.";
    const diagnostics =
      error instanceof WebGpuScaleInitializationError
        ? error.diagnostics
        : Object.freeze([scaleMethodDiagnostic("scale-command-encoder", detail)]);
    destroyDevice(device);
    throw new WebGpuScaleInitializationError(detail, diagnostics);
  }
  let paramsBuffer: WebGpuBuffer | undefined;
  let seedBuffer: WebGpuBuffer | undefined;
  let pointBuffer: WebGpuBuffer | undefined;
  let indirectBuffer: WebGpuBuffer | undefined;
  let overlayPointBuffer: WebGpuBuffer | undefined;
  let overlayLineBuffer: WebGpuBuffer | undefined;
  let pointCapacityBytes = 0;
  let seedCapacityBytes = 0;
  let overlayPointCapacityBytes = 0;
  let overlayLineCapacityBytes = 0;
  let computeBindGroup: unknown = undefined;
  let renderBindGroup: unknown = undefined;
  let overlayBindGroup: unknown = undefined;
  let computePipeline: unknown = undefined;
  let renderPipeline: unknown = undefined;
  let backgroundPipeline: unknown = undefined;
  let overlayPointPipeline: unknown = undefined;
  let overlayLinePipeline: unknown = undefined;
  let computeBindGroupLayout: unknown = undefined;
  let renderGroupZeroLayout: unknown = undefined;
  let renderBindGroupLayout: unknown = undefined;
  let overlayBindGroupLayout: unknown = undefined;
  let querySet: WebGpuQuerySet | undefined;
  let pendingTimestamp: WebGpuTimestampResources | undefined;
  let timestampUsable = selectWebGpuTimingSource(device) === "gpu-timestamp";
  let currentScene: WebGpuScaleRenderScene | undefined;
  let generatedPreparationKey: string | undefined;
  let currentCamera: CameraState | undefined;
  let pending: { readonly scene: WebGpuScaleRenderScene; readonly camera: CameraState } | undefined;
  let lastFrameReport: WebGpuScaleFrameReport | undefined;
  let scheduled = false;
  let destroyed = false;
  let timingSource: WebGpuBenchmarkTimingSource = "request-animation-frame";

  const safelyDestroy = (resource: WebGpuBuffer | WebGpuQuerySet | undefined): void => {
    try {
      resource?.destroy?.();
    } catch {
      // Continue best-effort cleanup after partial initialization or device loss.
    }
  };
  const downgradeTimestamp = (resources: WebGpuTimestampResources | undefined): void => {
    timestampUsable = false;
    timingSource = "request-animation-frame";
    if (pendingTimestamp === resources) {
      pendingTimestamp = undefined;
    }
    safelyDestroy(resources?.readbackBuffer);
    safelyDestroy(resources?.resolveBuffer);
    if (resources?.querySet === querySet) {
      safelyDestroy(querySet);
      querySet = undefined;
    }
    if (lastFrameReport !== undefined) {
      lastFrameReport = Object.freeze({
        ...lastFrameReport,
        timingSource,
        gpuTimeMilliseconds: undefined,
      });
    }
  };
  const dispose = (): void => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    pending = undefined;
    safelyDestroy(pendingTimestamp?.readbackBuffer);
    safelyDestroy(pendingTimestamp?.resolveBuffer);
    safelyDestroy(querySet);
    safelyDestroy(overlayLineBuffer);
    safelyDestroy(overlayPointBuffer);
    safelyDestroy(indirectBuffer);
    safelyDestroy(pointBuffer);
    safelyDestroy(seedBuffer);
    safelyDestroy(paramsBuffer);
    pendingTimestamp = undefined;
    generatedPreparationKey = undefined;
    querySet = undefined;
    overlayLineBuffer = undefined;
    overlayPointBuffer = undefined;
    indirectBuffer = undefined;
    pointBuffer = undefined;
    seedBuffer = undefined;
    paramsBuffer = undefined;
    destroyDevice(device);
  };
  const publishDeviceLoss = (loss: WebGpuDeviceLoss): void => {
    if (destroyed) {
      return;
    }
    const detail = [
      loss.reason === undefined ? undefined : `Reason: ${loss.reason}.`,
      loss.message,
      "Rendering stopped and bounded GPU resources were released. Reload the page to retry WebGPU.",
    ]
      .filter((value): value is string => value !== undefined && value.length > 0)
      .join(" ");
    const diagnostics = deviceLossDiagnostics(loss);
    dispose();
    onDeviceLost?.(
      failure("device-lost", "The WebGPU device was lost while rendering.", detail, diagnostics),
    );
  };
  const notifyDeviceLoss = (loss: WebGpuDeviceLoss): void => {
    try {
      publishDeviceLoss(loss);
    } catch {
      dispose();
    }
  };
  const observeDeviceLoss = (): void => {
    void device.lost
      .then(
        (loss) => notifyDeviceLoss(loss),
        (error) =>
          notifyDeviceLoss({
            reason: "unknown",
            message: error instanceof Error ? error.message : "The device-loss signal rejected.",
          }),
      )
      .catch(() => undefined);
  };

  try {
    const scaleShader = device.createShaderModule({ code: WEBGPU_SCALE_SHADER });
    computeBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: 4, buffer: { type: "uniform" } },
        { binding: 1, visibility: 4, buffer: { type: "storage" } },
        { binding: 2, visibility: 4, buffer: { type: "storage" } },
        { binding: 3, visibility: 4, buffer: { type: "read-only-storage" } },
      ],
    });
    // The render pipeline reserves group zero with an empty layout. Reusing the compute storage
    // layout here would create a writable-storage/indirect usage conflict in Chrome's validator.
    renderGroupZeroLayout = device.createBindGroupLayout({ entries: [] });
    renderBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: 1, buffer: { type: "uniform" } },
        { binding: 1, visibility: 1, buffer: { type: "read-only-storage" } },
      ],
    });
    overlayBindGroupLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: 1, buffer: { type: "uniform" } }],
    });
    computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [computeBindGroupLayout] }),
      compute: { module: scaleShader, entryPoint: "generatePoints" },
    });
    renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [renderGroupZeroLayout, renderBindGroupLayout],
      }),
      vertex: { module: scaleShader, entryPoint: "pointVertex", buffers: [] },
      fragment: {
        module: scaleShader,
        entryPoint: "pointFragment",
        targets: [{ format }],
      },
      primitive: { topology: "point-list" },
    });
    const backgroundShader = device.createShaderModule({ code: WEBGPU_STELLAR_BACKGROUND_SHADER });
    backgroundPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderGroupZeroLayout] }),
      vertex: { module: backgroundShader, entryPoint: "backgroundVertex", buffers: [] },
      fragment: {
        module: backgroundShader,
        entryPoint: "backgroundFragment",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list" },
    });
    const overlayShader = device.createShaderModule({ code: SHADER });
    const overlayPipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [overlayBindGroupLayout],
    });
    const overlayVertexBufferLayout = {
      arrayStride: 7 * Float32Array.BYTES_PER_ELEMENT,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 3 * Float32Array.BYTES_PER_ELEMENT, format: "float32x4" },
      ],
    };
    const createOverlayPipeline = (topology: "point-list" | "line-list"): unknown =>
      device.createRenderPipeline({
        layout: overlayPipelineLayout,
        vertex: {
          module: overlayShader,
          entryPoint: "vertexMain",
          buffers: [overlayVertexBufferLayout],
        },
        fragment: { module: overlayShader, entryPoint: "fragmentMain", targets: [{ format }] },
        primitive: { topology },
      });
    overlayPointPipeline = createOverlayPipeline("point-list");
    overlayLinePipeline = createOverlayPipeline("line-list");
    observeDeviceLoss();
  } catch (error) {
    dispose();
    throw error;
  }

  const writeParams = (preparation: WebGpuScalePreparation): void => {
    const buffer = paramsBuffer;
    if (buffer === undefined) {
      throw new Error("GPU scale uniform buffer was not initialized.");
    }
    const bytes = new ArrayBuffer(WEBGPU_SCALE_UNIFORM_BYTES);
    const floats = new Float32Array(bytes);
    const integers = new Uint32Array(bytes);
    for (let index = 0; index < 16; index += 1) {
      floats[index] = Math.fround(preparation.view.viewProjectionMatrix[index] ?? 0);
    }
    for (let index = 0; index < 6; index += 1) {
      const plane = preparation.frustumPlanes[index];
      if (plane === undefined) {
        throw new Error("GPU scale preparation did not contain six frustum planes.");
      }
      const offset = 16 + index * 4;
      floats[offset] = Math.fround(plane[0]);
      floats[offset + 1] = Math.fround(plane[1]);
      floats[offset + 2] = Math.fround(plane[2]);
      floats[offset + 3] = Math.fround(plane[3]);
    }
    floats[40] = Math.fround(preparation.contract.regionRadiusMeters);
    integers[41] = preparation.contract.pointHash;
    integers[42] = preparation.contract.pointTextHash;
    integers[43] = preparation.contract.seedHash;
    integers[44] = preparation.contract.seedTextHash;
    integers[45] = preparation.lod.candidateCount;
    integers[46] = preparation.lod.range.logicalStride;
    integers[47] = preparation.lod.visibleCapacity;
    device.queue.writeBuffer(buffer, 0, bytes);
  };

  const writeSeed = (preparation: WebGpuScalePreparation): void => {
    if (seedBuffer === undefined) {
      throw new Error("GPU scale seed buffer was not initialized.");
    }
    const seed = new Uint32Array(preparation.contract.seedCodeUnits);
    device.queue.writeBuffer(seedBuffer, 0, seed.buffer as ArrayBuffer);
  };

  const generationKey = (preparation: WebGpuScalePreparation): string => {
    const values: (number | string)[] = [
      preparation.contract.generatorVersion,
      preparation.contract.seedIdentity,
      preparation.contract.seedText,
      ...preparation.contract.seedCodeUnits,
      preparation.contract.pointHash,
      preparation.contract.pointTextHash,
      preparation.contract.logicalPopulation,
      preparation.contract.regionRadiusMeters,
      preparation.lod.candidateCount,
      preparation.lod.range.logicalStride,
      preparation.lod.visibleCapacity,
    ];
    for (const plane of preparation.frustumPlanes) {
      values.push(plane[0], plane[1], plane[2], plane[3]);
    }
    return JSON.stringify(values);
  };

  // Bind-group layouts are retained because WebGPU bind groups are immutable and the point/seed
  // storage buffers may grow when the active view or exact seed changes.
  const ensureBuffers = (preparation: WebGpuScalePreparation): void => {
    if (paramsBuffer === undefined) {
      paramsBuffer = device.createBuffer({
        size: WEBGPU_SCALE_UNIFORM_BYTES,
        usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST,
      });
    }
    if (indirectBuffer === undefined) {
      indirectBuffer = device.createBuffer({
        size: WEBGPU_INDIRECT_DRAW_BYTES,
        usage:
          BUFFER_USAGE_STORAGE |
          BUFFER_USAGE_INDIRECT |
          BUFFER_USAGE_COPY_SRC |
          BUFFER_USAGE_COPY_DST,
      });
    }
    const pointBytes = preparation.budget.pointBufferBytes;
    const seedBytes = preparation.budget.seedBufferBytes;
    const pointNeedsAllocation = pointBuffer === undefined || pointCapacityBytes < pointBytes;
    const seedNeedsAllocation = seedBuffer === undefined || seedCapacityBytes < seedBytes;
    if (!pointNeedsAllocation && !seedNeedsAllocation) {
      writeSeed(preparation);
      return;
    }
    if (pointNeedsAllocation) {
      safelyDestroy(pointBuffer);
      pointBuffer = device.createBuffer({
        size: pointBytes,
        usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_SRC,
      });
      pointCapacityBytes = pointBytes;
    }
    if (seedNeedsAllocation) {
      safelyDestroy(seedBuffer);
      seedBuffer = device.createBuffer({
        size: seedBytes,
        usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
      });
      seedCapacityBytes = seedBytes;
    }
    if (paramsBuffer === undefined || indirectBuffer === undefined || pointBuffer === undefined) {
      throw new Error("GPU scale control buffers were not initialized.");
    }
    if (seedBuffer === undefined) {
      throw new Error("GPU scale seed buffer was not initialized.");
    }
    writeSeed(preparation);
    computeBindGroup = device.createBindGroup({
      layout: computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: pointBuffer } },
        { binding: 2, resource: { buffer: indirectBuffer } },
        { binding: 3, resource: { buffer: seedBuffer } },
      ],
    });
    renderBindGroup = device.createBindGroup({
      layout: renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: pointBuffer } },
      ],
    });
    overlayBindGroup = device.createBindGroup({
      layout: overlayBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: paramsBuffer } }],
    });
  };

  const timestampResourcesFor = (
    encoder: WebGpuCommandEncoder,
  ): WebGpuTimestampResources | undefined => {
    if (timestampUsable !== true || pendingTimestamp !== undefined) {
      return undefined;
    }
    let createQuerySet: WebGpuTimestampDevice["createQuerySet"];
    let resolveQuerySet: WebGpuCommandEncoder["resolveQuerySet"];
    let copyBufferToBuffer: WebGpuCommandEncoder["copyBufferToBuffer"];
    let timestampPeriod: number | undefined;
    try {
      createQuerySet = device.createQuerySet;
      resolveQuerySet = encoder.resolveQuerySet;
      copyBufferToBuffer = encoder.copyBufferToBuffer;
      timestampPeriod = device.limits.timestampPeriod;
    } catch {
      downgradeTimestamp(undefined);
      return undefined;
    }
    if (
      typeof createQuerySet !== "function" ||
      resolveQuerySet === undefined ||
      copyBufferToBuffer === undefined ||
      timestampPeriod === undefined ||
      !Number.isFinite(timestampPeriod) ||
      timestampPeriod <= 0
    ) {
      downgradeTimestamp(undefined);
      return undefined;
    }
    let resolveBuffer: WebGpuBuffer | undefined;
    let readbackBuffer: WebGpuBuffer | undefined;
    try {
      if (querySet === undefined) {
        querySet = createQuerySet.call(device, { type: "timestamp", count: 2 });
      }
      resolveBuffer = device.createBuffer({
        size: 2 * BigUint64Array.BYTES_PER_ELEMENT,
        usage: BUFFER_USAGE_QUERY_RESOLVE | BUFFER_USAGE_COPY_SRC,
      });
      readbackBuffer = device.createBuffer({
        size: 2 * BigUint64Array.BYTES_PER_ELEMENT,
        usage: BUFFER_USAGE_COPY_DST | BUFFER_MAP_READ,
      });
      return Object.freeze({
        querySet,
        resolveBuffer,
        readbackBuffer,
        timestampPeriodNanoseconds: timestampPeriod,
      });
    } catch {
      safelyDestroy(readbackBuffer);
      safelyDestroy(resolveBuffer);
      safelyDestroy(querySet);
      querySet = undefined;
      timestampUsable = false;
      return undefined;
    }
  };

  const consumeTimestamp = async (): Promise<number | undefined> => {
    const timestamp = pendingTimestamp;
    if (timestamp === undefined) {
      return undefined;
    }
    pendingTimestamp = undefined;
    let mapped = false;
    try {
      if (
        timestamp.readbackBuffer.mapAsync === undefined ||
        timestamp.readbackBuffer.getMappedRange === undefined
      ) {
        throw new Error("The timestamp readback buffer cannot be mapped.");
      }
      await timestamp.readbackBuffer.mapAsync(
        BUFFER_MAP_READ,
        0,
        2 * BigUint64Array.BYTES_PER_ELEMENT,
      );
      mapped = true;
      const mappedRange = timestamp.readbackBuffer.getMappedRange(
        0,
        2 * BigUint64Array.BYTES_PER_ELEMENT,
      );
      const values = new DataView(mappedRange);
      const start = values.getBigUint64(0, true);
      const end = values.getBigUint64(BigUint64Array.BYTES_PER_ELEMENT, true);
      if (end < start) {
        throw new Error("The resolved GPU timestamp interval is negative.");
      }
      const elapsedMilliseconds =
        (Number(end - start) * timestamp.timestampPeriodNanoseconds) / 1_000_000;
      if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds < 0) {
        throw new Error("The resolved GPU timestamp interval is not finite.");
      }
      timingSource = "gpu-timestamp";
      if (lastFrameReport !== undefined) {
        lastFrameReport = Object.freeze({
          ...lastFrameReport,
          timingSource,
          gpuTimeMilliseconds: elapsedMilliseconds,
        });
      }
      return elapsedMilliseconds;
    } catch {
      downgradeTimestamp(timestamp);
      return undefined;
    } finally {
      if (mapped) {
        try {
          timestamp.readbackBuffer.unmap?.();
        } catch {
          downgradeTimestamp(timestamp);
        }
      }
      safelyDestroy(timestamp.readbackBuffer);
      safelyDestroy(timestamp.resolveBuffer);
    }
  };

  const uploadOverlay = (
    previous: WebGpuBuffer | undefined,
    capacity: number,
    values: Float32Array,
    maximumCapacity: number,
  ): { readonly buffer: WebGpuBuffer | undefined; readonly capacity: number } => {
    if (values.length === 0) {
      safelyDestroy(previous);
      return { buffer: undefined, capacity: 0 };
    }
    const byteLength = values.byteLength;
    const nextCapacity = Math.min(maximumCapacity, overlayBufferCapacity(byteLength));
    if (nextCapacity < byteLength) {
      throw new RangeError("The overlay upload exceeds its independent GPU buffer budget.");
    }
    if (previous !== undefined && capacity >= nextCapacity) {
      device.queue.writeBuffer(
        previous,
        0,
        values.buffer as ArrayBuffer,
        values.byteOffset,
        values.byteLength,
      );
      return { buffer: previous, capacity };
    }
    const buffer = device.createBuffer({
      size: nextCapacity,
      usage: BUFFER_USAGE_VERTEX | BUFFER_USAGE_COPY_DST,
    });
    try {
      device.queue.writeBuffer(
        buffer,
        0,
        values.buffer as ArrayBuffer,
        values.byteOffset,
        values.byteLength,
      );
    } catch (error) {
      safelyDestroy(buffer);
      throw error;
    }
    safelyDestroy(previous);
    return { buffer, capacity: nextCapacity };
  };

  const renderScaleImmediate = (scene: WebGpuScaleRenderScene, camera: CameraState): void => {
    if (destroyed) {
      return;
    }
    let timestampResources: WebGpuTimestampResources | undefined;
    let timestampSubmitted = false;
    try {
      const preparation = validateWebGpuScalePreparation(
        preparationDataProperty(scene, "preparation", "scale scene"),
        device.limits,
      );
      const overlay = validateWebGpuScaleOverlay(
        preparationDataProperty(scene, "overlay", "scale scene"),
      );
      const transitionPeakBytes = overlayTransitionPeakBytes(
        overlay,
        overlayPointCapacityBytes,
        overlayLineCapacityBytes,
      );
      if (transitionPeakBytes > MAX_WEBGPU_SCALE_OVERLAY_BUFFER_BYTES) {
        throw new RangeError(
          "scale scene.overlay replacement exceeds its independent GPU buffer budget.",
        );
      }
      ensureBuffers(preparation);
      writeParams(preparation);
      const indirect = indirectBuffer;
      const bindGroup = computeBindGroup;
      const renderGroup = renderBindGroup;
      const overlayGroup = overlayBindGroup;
      if (
        indirect === undefined ||
        bindGroup === undefined ||
        renderGroup === undefined ||
        overlayGroup === undefined
      ) {
        throw new Error("GPU scale bind groups were not initialized.");
      }
      const pointValues = overlayPointValues(overlay.scene.points);
      const lineValues = overlayLineValues(overlay.scene.connections);
      const pointUpload = uploadOverlay(
        overlayPointBuffer,
        overlayPointCapacityBytes,
        pointValues,
        MAX_WEBGPU_SCALE_OVERLAY_POINTS * WEBGPU_OVERLAY_POINT_STRIDE_BYTES,
      );
      const lineUpload = uploadOverlay(
        overlayLineBuffer,
        overlayLineCapacityBytes,
        lineValues,
        MAX_WEBGPU_SCALE_OVERLAY_CONNECTIONS * WEBGPU_OVERLAY_CONNECTION_STRIDE_BYTES,
      );
      overlayPointBuffer = pointUpload.buffer;
      overlayPointCapacityBytes = pointUpload.capacity;
      overlayLineBuffer = lineUpload.buffer;
      overlayLineCapacityBytes = lineUpload.capacity;
      const key = generationKey(preparation);
      const shouldGenerate = generatedPreparationKey !== key;
      const encoder = device.createCommandEncoder();
      timestampResources = timestampResourcesFor(encoder);
      let timestampStartedInCompute = false;
      if (shouldGenerate) {
        const drawArgs = new Uint32Array([0, 1, 0, 0]);
        device.queue.writeBuffer(indirect, 0, drawArgs.buffer as ArrayBuffer);
        const beginComputePass = encoder.beginComputePass;
        if (beginComputePass === undefined) {
          throw new Error("The active WebGPU command encoder cannot dispatch compute workgroups.");
        }
        const computePass = beginComputePass.call(encoder, {});
        if (timestampResources !== undefined && computePass.writeTimestamp === undefined) {
          downgradeTimestamp(timestampResources);
          timestampResources = undefined;
        }
        if (timestampResources !== undefined) {
          try {
            computePass.writeTimestamp?.(timestampResources.querySet, 0);
            timestampStartedInCompute = true;
          } catch {
            downgradeTimestamp(timestampResources);
            timestampResources = undefined;
          }
        }
        computePass.setPipeline(computePipeline);
        computePass.setBindGroup(0, bindGroup);
        computePass.dispatchWorkgroups(preparation.lod.dispatchWorkgroups, 1, 1);
        computePass.end();
      }
      const view = context.getCurrentTexture().createView();
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view,
            clearValue: { r: 0.008, g: 0.006, b: 0.009, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      const drawIndirect = renderPass.drawIndirect;
      if (drawIndirect === undefined) {
        renderPass.end();
        throw new Error("The active WebGPU render pass cannot draw indirect point output.");
      }
      if (timestampResources !== undefined && !timestampStartedInCompute) {
        if (renderPass.writeTimestamp === undefined) {
          downgradeTimestamp(timestampResources);
          timestampResources = undefined;
        } else {
          try {
            renderPass.writeTimestamp(timestampResources.querySet, 0);
          } catch {
            downgradeTimestamp(timestampResources);
            timestampResources = undefined;
          }
        }
      }
      renderPass.setPipeline(backgroundPipeline);
      renderPass.draw(3);
      renderPass.setPipeline(renderPipeline);
      renderPass.setBindGroup(1, renderGroup);
      drawIndirect.call(renderPass, indirect, 0);
      renderPass.setBindGroup(0, overlayGroup);
      if (overlayLineBuffer !== undefined && lineValues.length > 0) {
        renderPass.setPipeline(overlayLinePipeline);
        renderPass.setVertexBuffer(0, overlayLineBuffer);
        renderPass.draw(lineValues.length / 7);
      }
      if (overlayPointBuffer !== undefined && pointValues.length > 0) {
        renderPass.setPipeline(overlayPointPipeline);
        renderPass.setVertexBuffer(0, overlayPointBuffer);
        renderPass.draw(pointValues.length / 7);
      }
      if (timestampResources !== undefined) {
        if (renderPass.writeTimestamp === undefined) {
          downgradeTimestamp(timestampResources);
          timestampResources = undefined;
        } else {
          try {
            renderPass.writeTimestamp(timestampResources.querySet, 1);
          } catch {
            downgradeTimestamp(timestampResources);
            timestampResources = undefined;
          }
        }
      }
      renderPass.end();
      if (timestampResources !== undefined) {
        try {
          const resolveQuerySet = encoder.resolveQuerySet;
          const copyBufferToBuffer = encoder.copyBufferToBuffer;
          if (resolveQuerySet === undefined || copyBufferToBuffer === undefined) {
            throw new Error("The timestamp resolve/copy API is unavailable.");
          }
          resolveQuerySet.call(
            encoder,
            timestampResources.querySet,
            0,
            2,
            timestampResources.resolveBuffer,
            0,
          );
          copyBufferToBuffer.call(
            encoder,
            timestampResources.resolveBuffer,
            0,
            timestampResources.readbackBuffer,
            0,
            2 * BigUint64Array.BYTES_PER_ELEMENT,
          );
        } catch {
          // Timestamp commands are optional diagnostics; a browser that rejects either command
          // keeps the ordinary render submission and reports its timing through rAF instead.
          downgradeTimestamp(timestampResources);
          timestampResources = undefined;
        }
      }
      device.queue.submit([encoder.finish()]);
      timestampSubmitted = timestampResources !== undefined;
      if (timestampSubmitted) {
        pendingTimestamp = timestampResources;
      }
      generatedPreparationKey = key;
      currentScene = Object.freeze({ preparation, overlay: overlay.scene });
      currentCamera = camera;
      lastFrameReport = Object.freeze({
        candidateCount: preparation.lod.candidateCount,
        visibleCapacity: preparation.lod.visibleCapacity,
        dispatchWorkgroups: preparation.lod.dispatchWorkgroups,
        resourceBudget: preparation.budget,
        overlayBudget: overlay.budget,
        timingSource: "request-animation-frame",
        gpuTimeMilliseconds: undefined,
      });
    } catch (error) {
      if (timestampResources !== undefined && !timestampSubmitted) {
        safelyDestroy(timestampResources.readbackBuffer);
        safelyDestroy(timestampResources.resolveBuffer);
      }
      onRenderError?.(error);
    }
  };

  const readScaleOutput = async (
    options: {
      readonly maxPoints?: number;
    } = {},
  ): Promise<WebGpuScaleReadback> => {
    if (destroyed) {
      throw new Error("The WebGPU scale renderer has been destroyed.");
    }
    const scene = currentScene;
    const point = pointBuffer;
    const indirect = indirectBuffer;
    if (scene === undefined || point === undefined || indirect === undefined) {
      throw new Error("Render a scale scene before requesting GPU output readback.");
    }
    const maxPoints = options.maxPoints ?? 0;
    if (!Number.isSafeInteger(maxPoints) || maxPoints < 0) {
      throw new RangeError("GPU readback maxPoints must be a non-negative safe integer.");
    }
    if (maxPoints > scene.preparation.lod.visibleCapacity) {
      throw new RangeError("GPU readback maxPoints cannot exceed the active visible capacity.");
    }
    let readback: WebGpuBuffer | undefined;
    let mapped = false;
    let outputReadbackSucceeded = false;
    try {
      const encoder = device.createCommandEncoder();
      const copyBufferToBuffer = encoder.copyBufferToBuffer;
      if (copyBufferToBuffer === undefined) {
        throw new Error("The active WebGPU command encoder cannot copy output for readback.");
      }
      const pointBytes = maxPoints * WEBGPU_POINT_STRIDE_BYTES;
      const countOffset = pointBytes;
      const readbackBytes = pointBytes + 4;
      readback = device.createBuffer({
        size: readbackBytes,
        usage: BUFFER_USAGE_COPY_DST | BUFFER_MAP_READ,
      });
      const activeReadback = readback;
      if (pointBytes > 0) {
        copyBufferToBuffer.call(encoder, point, 0, activeReadback, 0, pointBytes);
      }
      copyBufferToBuffer.call(encoder, indirect, 0, activeReadback, countOffset, 4);
      device.queue.submit([encoder.finish()]);
      if (activeReadback.mapAsync === undefined || activeReadback.getMappedRange === undefined) {
        throw new Error("The active WebGPU buffer cannot be mapped for output readback.");
      }
      await activeReadback.mapAsync(BUFFER_MAP_READ, 0, readbackBytes);
      mapped = true;
      const mappedRange = activeReadback.getMappedRange(0, readbackBytes);
      const bytes = new Uint8Array(readbackBytes);
      bytes.set(new Uint8Array(mappedRange));
      const values = new DataView(bytes.buffer);
      const rawVisibleCount = values.getUint32(countOffset, true);
      if (rawVisibleCount > scene.preparation.lod.visibleCapacity) {
        throw new Error("GPU indirect output exceeded the bounded visible capacity.");
      }
      const visibleCount = rawVisibleCount;
      const returnedRecordCount = Math.min(visibleCount, maxPoints);
      const positions = new Float32Array(returnedRecordCount * 4);
      const stableKeys = new Uint32Array(returnedRecordCount * 4);
      for (let index = 0; index < returnedRecordCount; index += 1) {
        const sourceOffset = index * WEBGPU_POINT_STRIDE_BYTES;
        const positionOffset = index * 4;
        positions[positionOffset] = values.getFloat32(sourceOffset, true);
        positions[positionOffset + 1] = values.getFloat32(sourceOffset + 4, true);
        positions[positionOffset + 2] = values.getFloat32(sourceOffset + 8, true);
        positions[positionOffset + 3] = values.getFloat32(sourceOffset + 12, true);
        stableKeys[positionOffset] = values.getUint32(sourceOffset + 16, true);
        stableKeys[positionOffset + 1] = values.getUint32(sourceOffset + 20, true);
        stableKeys[positionOffset + 2] = values.getUint32(sourceOffset + 24, true);
        stableKeys[positionOffset + 3] = values.getUint32(sourceOffset + 28, true);
      }
      await consumeTimestamp();
      const report = lastFrameReport;
      outputReadbackSucceeded = true;
      return Object.freeze({
        visibleCount,
        returnedRecordCount,
        positions,
        stableKeys,
        timingSource: report?.timingSource ?? "request-animation-frame",
        gpuTimeMilliseconds: report?.gpuTimeMilliseconds,
      });
    } finally {
      if (!outputReadbackSucceeded && pendingTimestamp !== undefined) {
        downgradeTimestamp(pendingTimestamp);
      }
      if (mapped) {
        try {
          readback?.unmap?.();
        } catch {
          // Preserve the readback failure while still attempting buffer destruction.
        }
      }
      safelyDestroy(readback);
    }
  };

  const queueRender = (): void => {
    if (scheduled || destroyed) {
      return;
    }
    scheduled = true;
    scheduler.request(() => {
      scheduled = false;
      const next = pending;
      pending = undefined;
      if (next !== undefined) {
        renderScaleImmediate(next.scene, next.camera);
      }
    });
  };

  return Object.freeze({
    setScene(scene: WebGpuRenderScene, camera: CameraState): void {
      if (currentScene === undefined) {
        onRenderError?.(new Error("Use setScaleScene for the bounded Cluster renderer."));
        return;
      }
      const next = Object.freeze({ ...currentScene, overlay: scene });
      pending = Object.freeze({ scene: next, camera });
      queueRender();
    },
    setScaleScene(scene: WebGpuScaleRenderScene, camera: CameraState): void {
      if (destroyed) {
        return;
      }
      pending = Object.freeze({ scene, camera });
      queueRender();
    },
    resize(width: number, height: number, devicePixelRatio: number): void {
      if (destroyed) {
        return;
      }
      const ratio =
        Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      try {
        context.configure({ device, format, alphaMode: "opaque" });
      } catch (error) {
        onRenderError?.(error);
      }
      if (currentScene !== undefined && currentCamera !== undefined) {
        pending = Object.freeze({ scene: currentScene, camera: currentCamera });
        queueRender();
      }
    },
    renderNow(scene: WebGpuRenderScene, camera: CameraState): void {
      if (currentScene === undefined) {
        onRenderError?.(new Error("Use renderScaleNow for the bounded Cluster renderer."));
        return;
      }
      renderScaleImmediate(Object.freeze({ ...currentScene, overlay: scene }), camera);
    },
    renderScaleNow: renderScaleImmediate,
    lastFrame: () => lastFrameReport,
    readScaleOutput,
    destroy: dispose,
  });
}

/**
 * Creates the bounded compute-generated Cluster renderer after complete scale capability checks.
 *
 * @param boundary - Browser GPU, secure-context, canvas, and optional requirement overrides.
 * @param options - Scheduler and failure callbacks used by browser and injected tests.
 * @returns A renderer or an accessible hard failure; no WebGL fallback is attempted.
 */
export async function createWebGpuScaleRenderer(
  boundary: WebGpuStartupBoundary,
  options:
    | {
        readonly scheduler: WebGpuRenderScheduler | undefined;
        readonly onRenderError: ((error: unknown) => void) | undefined;
        readonly onDeviceLost: ((failure: WebGpuFailure) => void) | undefined;
      }
    | undefined = undefined,
): Promise<WebGpuScaleRendererResult> {
  const scaleBoundary: WebGpuStartupBoundary = {
    gpu: boundary.gpu,
    canvas: boundary.canvas,
    isSecureContext: boundary.isSecureContext,
    requirements: scaleRequirementsFor(boundary.requirements),
  };
  let capabilities: WebGpuCapabilityResult;
  try {
    capabilities = await checkWebGpuCapabilities(scaleBoundary);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "The injected scale capability seam threw.";
    const diagnostics = Object.freeze([
      Object.freeze({
        kind: "availability" as const,
        name: "scale-capability-validation",
        required: "completes",
        observed: "threw",
        message: `Scale capability validation: required=completes, observed=threw (${detail}).`,
      }),
    ]);
    return {
      ok: false,
      failure: failure(
        "renderer-init-failed",
        "WebGPU scale capability validation failed unexpectedly.",
        detail,
        diagnostics,
      ),
    };
  }
  if (!capabilities.ok) {
    return capabilities;
  }
  try {
    const renderer = createScaleRenderer(
      capabilities.resources,
      boundary.canvas,
      options?.scheduler ?? defaultScheduler(),
      options?.onRenderError,
      options?.onDeviceLost,
    );
    return Object.freeze({ ok: true as const, renderer, resources: capabilities.resources });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "The bounded GPU pipeline setup failed.";
    const diagnostics =
      error instanceof WebGpuScaleInitializationError
        ? error.diagnostics
        : Object.freeze([scaleMethodDiagnostic("bounded-scale-pipeline", detail)]);
    return {
      ok: false,
      failure: failure(
        "shader-assumption-failed",
        "The WebGPU adapter cannot initialize the bounded Cluster shader.",
        detail,
        diagnostics,
      ),
    };
  }
}
