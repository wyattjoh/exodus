import {
  createExplorerViewProjectionMatrix,
  type CameraState,
  type ExplorerVector3,
  type ExplorerViewport,
} from "./cluster-explorer";

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
  readonly end: () => void;
};

/**
 * The command encoder interface used by the renderer implementation.
 */
type WebGpuCommandEncoder = {
  readonly beginRenderPass: (descriptor: unknown) => WebGpuRenderPass;
  readonly finish: () => unknown;
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
  | "adapter-unavailable"
  | "missing-feature"
  | "missing-limit"
  | "device-request-failed"
  | "device-missing-feature"
  | "device-missing-limit"
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
};

/**
 * The browser and canvas dependencies injected into WebGPU startup.
 */
export type WebGpuStartupBoundary = {
  readonly gpu: WebGpuApi | undefined;
  readonly canvas: WebGpuCanvas;
  readonly requirements:
    | {
        readonly requiredFeatures: readonly string[];
        readonly requiredLimits: Readonly<Record<string, number>>;
      }
    | undefined;
};

/**
 * Resources validated before a render pipeline is created.
 */
export type WebGpuStartupResources = {
  readonly adapter: WebGpuAdapter;
  readonly device: WebGpuDevice;
  readonly context: WebGpuCanvasContext;
  readonly format: string;
  readonly requirements: {
    readonly requiredFeatures: readonly string[];
    readonly requiredLimits: Readonly<Record<string, number>>;
  };
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

const BUFFER_USAGE_COPY_DST = 0x08;
const BUFFER_USAGE_VERTEX = 0x20;
const BUFFER_USAGE_UNIFORM = 0x40;
// Keep small dynamically growing vertex buffers aligned for browser WebGPU implementations.
const MIN_VERTEX_BUFFER_BYTES = 256;
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

function failure(code: WebGpuFailureCode, message: string, detail: string): WebGpuFailure {
  return Object.freeze({ code, message, detail });
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

function requirementsFor(
  requirements: WebGpuStartupBoundary["requirements"],
): WebGpuStartupResources["requirements"] {
  return Object.freeze({
    requiredFeatures: Object.freeze([
      ...(requirements?.requiredFeatures ?? DEFAULT_WEBGPU_REQUIREMENTS.requiredFeatures),
    ]),
    requiredLimits: Object.freeze({
      ...DEFAULT_WEBGPU_REQUIREMENTS.requiredLimits,
      ...(requirements?.requiredLimits ?? {}),
    }),
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
  if (boundary.gpu === undefined) {
    return {
      ok: false,
      failure: failure(
        "gpu-unavailable",
        "WebGPU is unavailable in this browser.",
        "The Cluster explorer requires navigator.gpu and intentionally has no WebGL or 2D fallback.",
      ),
    };
  }

  let adapter: WebGpuAdapter | null;
  try {
    adapter = await boundary.gpu.requestAdapter({ powerPreference: "high-performance" });
  } catch (error) {
    return {
      ok: false,
      failure: failure(
        "adapter-unavailable",
        "WebGPU could not provide a rendering adapter.",
        error instanceof Error ? error.message : "The adapter request failed before startup.",
      ),
    };
  }
  if (adapter === null) {
    return {
      ok: false,
      failure: failure(
        "adapter-unavailable",
        "WebGPU is present, but no compatible adapter is available.",
        "Check that hardware acceleration is enabled and that this desktop browser exposes WebGPU.",
      ),
    };
  }

  const adapterFeatures = missingFeatures(adapter.features, requirements.requiredFeatures);
  if (adapterFeatures.length > 0) {
    return {
      ok: false,
      failure: failure(
        "missing-feature",
        "The WebGPU adapter is missing a required feature.",
        `Missing feature${adapterFeatures.length === 1 ? "" : "s"}: ${adapterFeatures.join(", ")}.`,
      ),
    };
  }
  const adapterLimits = missingLimits(adapter.limits, requirements.requiredLimits);
  if (adapterLimits.length > 0) {
    return {
      ok: false,
      failure: failure(
        "missing-limit",
        "The WebGPU adapter does not meet the Cluster renderer limits.",
        `Insufficient limit${adapterLimits.length === 1 ? "" : "s"}: ${adapterLimits.join(", ")}.`,
      ),
    };
  }

  let device: WebGpuDevice;
  try {
    device = await adapter.requestDevice({
      requiredFeatures: requirements.requiredFeatures,
      requiredLimits: requirements.requiredLimits,
    });
  } catch (error) {
    return {
      ok: false,
      failure: failure(
        "device-request-failed",
        "WebGPU could not create the rendering device.",
        error instanceof Error ? error.message : "The device request failed before startup.",
      ),
    };
  }
  const deviceFeatures = missingFeatures(device.features, requirements.requiredFeatures);
  if (deviceFeatures.length > 0) {
    destroyDevice(device);
    return {
      ok: false,
      failure: failure(
        "device-missing-feature",
        "The WebGPU device did not retain a required feature.",
        `Missing device feature${deviceFeatures.length === 1 ? "" : "s"}: ${deviceFeatures.join(", ")}.`,
      ),
    };
  }
  const deviceLimits = missingLimits(device.limits, requirements.requiredLimits);
  if (deviceLimits.length > 0) {
    destroyDevice(device);
    return {
      ok: false,
      failure: failure(
        "device-missing-limit",
        "The WebGPU device did not retain a required limit.",
        `Insufficient device limit${deviceLimits.length === 1 ? "" : "s"}: ${deviceLimits.join(", ")}.`,
      ),
    };
  }

  let context: WebGpuCanvasContext | null;
  try {
    context = boundary.canvas.getContext("webgpu");
  } catch (error) {
    destroyDevice(device);
    return {
      ok: false,
      failure: failure(
        "context-unavailable",
        "The Cluster canvas could not create a WebGPU context.",
        error instanceof Error ? error.message : "The canvas context request failed.",
      ),
    };
  }
  if (context === null) {
    destroyDevice(device);
    return {
      ok: false,
      failure: failure(
        "context-unavailable",
        "The Cluster canvas does not expose a WebGPU context.",
        'The browser returned null for canvas.getContext("webgpu").',
      ),
    };
  }

  let format: string;
  try {
    format = boundary.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });
  } catch (error) {
    destroyDevice(device);
    return {
      ok: false,
      failure: failure(
        "context-configure-failed",
        "The WebGPU canvas could not be configured.",
        error instanceof Error ? error.message : "The preferred canvas format was rejected.",
      ),
    };
  }
  return Object.freeze({
    ok: true as const,
    resources: Object.freeze({ adapter, device, context, format, requirements }),
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
    dispose();
    onDeviceLost?.(failure("device-lost", "The WebGPU device was lost while rendering.", detail));
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
    return {
      ok: false,
      failure: failure(
        "renderer-init-failed",
        "WebGPU capability validation failed unexpectedly.",
        error instanceof Error ? error.message : "The injected browser capability seam threw.",
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
    return {
      ok: false,
      failure: failure(
        "renderer-init-failed",
        "WebGPU started but the Cluster renderer could not be initialized.",
        error instanceof Error ? error.message : "The render pipeline setup failed.",
      ),
    };
  }
}
