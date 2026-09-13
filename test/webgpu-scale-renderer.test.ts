import { describe, expect, test } from "bun:test";

import {
  DEFAULT_WEBGPU_SCALE_REQUIREMENTS,
  MAX_WEBGPU_SCALE_OVERLAY_CONNECTIONS,
  MAX_WEBGPU_SCALE_OVERLAY_POINTS,
  MAX_WEBGPU_SCALE_OVERLAY_BUFFER_BYTES,
  WEBGPU_OVERLAY_CONNECTION_STRIDE_BYTES,
  WEBGPU_SCALE_SHADER,
  createWebGpuScaleRenderer,
  selectWebGpuTimingSource,
  validateWebGpuScaleOverlay,
  type WebGpuAdapter,
  type WebGpuApi,
  type WebGpuCanvas,
  type WebGpuBuffer,
  type WebGpuCanvasContext,
  type WebGpuDevice,
  type WebGpuDeviceLoss,
  type WebGpuScaleRenderScene,
} from "../app/webgpu-renderer";
import {
  createWebGpuScaleContract,
  prepareWebGpuScale,
  selectWebGpuBenchmarkTimingSource,
  type WebGpuClusterView,
} from "../src/webgpu-scale";
import { createCameraState } from "../app/cluster-explorer";

function featureSet(features: readonly string[]) {
  const values = new Set(features);
  return { has: (feature: string) => values.has(feature) };
}

function view(): WebGpuClusterView {
  return Object.freeze({
    viewProjectionMatrix: Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    viewportWidth: 1920,
    viewportHeight: 1080,
    cameraDistance: 3.2,
    far: 100,
  });
}

function context(): WebGpuCanvasContext {
  return {
    configure: () => undefined,
    getCurrentTexture: () => ({ createView: () => ({}) }),
  };
}

function canvas(value: WebGpuCanvasContext = context()): WebGpuCanvas {
  return {
    width: 1920,
    height: 1080,
    clientWidth: 1920,
    clientHeight: 1080,
    getContext: () => value,
  };
}

function scaleLimits(): Readonly<Record<string, number>> {
  return DEFAULT_WEBGPU_SCALE_REQUIREMENTS.requiredLimits;
}

function createGpuDevice(
  options: {
    readonly features?: readonly string[];
    readonly onDispatch?: (count: number) => void;
    readonly onDrawIndirect?: () => void;
    readonly onTimestamp?: (index: number) => void;
    readonly onDestroy?: () => void;
    readonly onBuffer?: (descriptor: unknown) => void;
    readonly onBufferDestroy?: (descriptor: unknown) => void;
    readonly onRenderPipeline?: (descriptor: unknown) => void;
  } = {},
): WebGpuDevice {
  const neverLost: Promise<WebGpuDeviceLoss> = new Promise(() => undefined);
  return {
    lost: neverLost,
    features: featureSet(options.features ?? []),
    limits: scaleLimits(),
    queue: {
      writeBuffer: () => undefined,
      submit: () => undefined,
    },
    createShaderModule: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createBindGroup: () => ({}),
    createRenderPipeline: (descriptor: unknown) => {
      options.onRenderPipeline?.(descriptor);
      return {};
    },
    createComputePipeline: () => ({}),
    createBuffer: (descriptor: unknown) => {
      options.onBuffer?.(descriptor);
      return { destroy: () => options.onBufferDestroy?.(descriptor) };
    },
    createCommandEncoder: () => ({
      beginComputePass: () => ({
        setPipeline: () => undefined,
        setBindGroup: () => undefined,
        dispatchWorkgroups: (count: number) => options.onDispatch?.(count),
        writeTimestamp: (_querySet: unknown, index: number) => options.onTimestamp?.(index),
        end: () => undefined,
      }),
      beginRenderPass: () => ({
        setPipeline: () => undefined,
        setBindGroup: () => undefined,
        setVertexBuffer: () => undefined,
        draw: () => undefined,
        drawIndirect: () => options.onDrawIndirect?.(),
        writeTimestamp: (_querySet: unknown, index: number) => options.onTimestamp?.(index),
        end: () => undefined,
      }),
      resolveQuerySet: () => undefined,
      copyBufferToBuffer: () => undefined,
      finish: () => ({}),
    }),
    createQuerySet: options.features?.includes("timestamp-query")
      ? () => ({ destroy: () => undefined })
      : undefined,
    destroy: options.onDestroy,
  } as WebGpuDevice;
}

function createReadbackDevice(
  visibleCount: number,
  options: {
    readonly timestamp?: boolean;
    readonly timestampMapFailure?: boolean;
    readonly timestampResolveFailure?: boolean;
    readonly timestampCopyFailure?: boolean;
    readonly timestampPeriod?: number;
  } = {},
): WebGpuDevice & { readonly copySizes: number[]; readonly readbackSizes: number[] } {
  const buffers: {
    readonly size: number;
    readonly bytes: Uint8Array;
    readonly readback: boolean;
  }[] = [];
  const copySizes: number[] = [];
  const readbackSizes: number[] = [];
  const timestampValues = [1_000_000n, 3_000_000n] as const;
  let mapCalls = 0;
  const neverLost: Promise<WebGpuDeviceLoss> = new Promise(() => undefined);
  const device = {
    lost: neverLost,
    features: featureSet(options.timestamp === true ? ["timestamp-query"] : []),
    limits: { ...scaleLimits(), timestampPeriod: options.timestampPeriod ?? 1 },
    queue: {
      writeBuffer: (buffer: WebGpuBuffer, offset: number, data: ArrayBuffer) => {
        const record = buffers.find((candidate) => candidate.bytes.buffer === bufferBytes(buffer));
        if (record !== undefined) {
          record.bytes.set(new Uint8Array(data), offset);
        }
      },
      submit: () => undefined,
    },
    createShaderModule: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createBindGroup: () => ({}),
    createRenderPipeline: () => ({}),
    createComputePipeline: () => ({}),
    createBuffer: (descriptor: { readonly size: number; readonly usage: number }) => {
      const bytes = new Uint8Array(descriptor.size);
      const record = { size: descriptor.size, bytes, readback: (descriptor.usage & 0x01) !== 0 };
      buffers.push(record);
      if (record.readback) {
        readbackSizes.push(record.size);
      }
      const buffer = {
        destroy: () => undefined,
        mapAsync: async () => {
          mapCalls += 1;
          if (options.timestampMapFailure === true && mapCalls === 2) {
            throw new Error("timestamp map failed");
          }
        },
        getMappedRange: () => record.bytes.buffer as ArrayBuffer,
        unmap: () => undefined,
      };
      return buffer;
    },
    createCommandEncoder: () => ({
      beginComputePass: () => ({
        setPipeline: () => undefined,
        setBindGroup: () => undefined,
        dispatchWorkgroups: () => undefined,
        writeTimestamp: () => undefined,
        end: () => undefined,
      }),
      beginRenderPass: () => ({
        setPipeline: () => undefined,
        setBindGroup: () => undefined,
        setVertexBuffer: () => undefined,
        draw: () => undefined,
        drawIndirect: () => undefined,
        writeTimestamp: () => undefined,
        end: () => undefined,
      }),
      resolveQuerySet: (
        _querySet: unknown,
        _firstQuery: number,
        _queryCount: number,
        destination: WebGpuBuffer,
      ) => {
        if (options.timestampResolveFailure === true) {
          throw new Error("timestamp resolve failed");
        }
        const target = buffers.find(
          (candidate) => candidate.bytes.buffer === bufferBytes(destination),
        );
        if (target !== undefined) {
          const values = new DataView(target.bytes.buffer);
          values.setBigUint64(0, timestampValues[0], true);
          values.setBigUint64(8, timestampValues[1], true);
        }
      },
      copyBufferToBuffer: (
        source: WebGpuBuffer,
        _sourceOffset: number,
        destination: WebGpuBuffer,
        destinationOffset: number,
        size: number,
      ) => {
        if (
          options.timestampCopyFailure === true &&
          size === 2 * BigUint64Array.BYTES_PER_ELEMENT
        ) {
          throw new Error("timestamp copy failed");
        }
        copySizes.push(size);
        const target = buffers.find(
          (candidate) => candidate.bytes.buffer === bufferBytes(destination),
        );
        if (target === undefined) {
          return;
        }
        if (size === 4) {
          new DataView(target.bytes.buffer).setUint32(destinationOffset, visibleCount, true);
          return;
        }
        const sourceRecord = buffers.find(
          (candidate) => candidate.bytes.buffer === bufferBytes(source),
        );
        if (sourceRecord !== undefined) {
          target.bytes.set(sourceRecord.bytes.subarray(0, size), destinationOffset);
        }
      },
      finish: () => ({}),
    }),
    createQuerySet: options.timestamp === true ? () => ({ destroy: () => undefined }) : undefined,
    destroy: undefined,
    copySizes,
    readbackSizes,
  } as WebGpuDevice & { readonly copySizes: number[]; readonly readbackSizes: number[] };
  return device;
}

function bufferBytes(buffer: WebGpuBuffer): ArrayBuffer {
  const mapped = buffer.getMappedRange?.();
  if (mapped !== undefined) {
    return mapped;
  }
  return new ArrayBuffer(0);
}

function adapter(
  device: WebGpuDevice,
  features: readonly string[] = [],
  limits = scaleLimits(),
): WebGpuAdapter {
  return {
    features: featureSet(features),
    limits,
    requestDevice: async () => device,
  };
}

function gpu(value: WebGpuAdapter): WebGpuApi {
  return {
    requestAdapter: async () => value,
    getPreferredCanvasFormat: () => "bgra8unorm",
  };
}

const overlay = Object.freeze({ points: [], connections: [] });

function scaleScene() {
  const contract = createWebGpuScaleContract({
    logicalPopulation: 1_000_000,
    seed: "renderer-fixture",
    generatorVersion: "globular-v1",
    regionRadiusMeters: 5e17,
  });
  return Object.freeze({
    preparation: prepareWebGpuScale(contract, view()),
    overlay,
    focusFog: undefined,
  });
}

describe("bounded WebGPU compute renderer seam", () => {
  test("keeps the WGSL point hash and index contract aligned with the CPU fixture", () => {
    expect(WEBGPU_SCALE_SHADER).toContain("@compute @workgroup_size(64)");
    expect(WEBGPU_SCALE_SHADER).toContain("logicalIndex ^ 0x9e3779b9u");
    expect(WEBGPU_SCALE_SHADER).toContain("logicalIndex ^ 0x85ebca6bu");
    expect(WEBGPU_SCALE_SHADER).toContain("logicalIndex ^ 0xc2b2ae35u");
    expect(WEBGPU_SCALE_SHADER).toContain("params.seedTextHash");
    expect(WEBGPU_SCALE_SHADER).toContain("@group(1) @binding(1) var<storage, read> renderPoints");
    expect(WEBGPU_SCALE_SHADER).toContain("atomicCompareExchangeWeak(&drawArgs[0]");
    expect(WEBGPU_SCALE_SHADER).toContain("current >= params.visibleCapacity");
    expect(WEBGPU_SCALE_SHADER).toContain("renderParams.focusStrength");
  });

  test("enables alpha blending for fogged generated points and CPU overlays", async () => {
    const pipelines: unknown[] = [];
    const result = await createWebGpuScaleRenderer({
      gpu: gpu(
        adapter(
          createGpuDevice({
            onRenderPipeline: (descriptor) => pipelines.push(descriptor),
          }),
        ),
      ),
      canvas: canvas(),
      requirements: undefined,
      isSecureContext: true,
    });

    expect(result.ok).toBe(true);
    const blended = pipelines.filter((descriptor) => {
      const pipeline = descriptor as {
        readonly fragment?: {
          readonly targets?: readonly { readonly blend?: unknown }[];
        };
      };
      return pipeline.fragment?.targets?.[0]?.blend !== undefined;
    });
    expect(blended).toHaveLength(3);
    if (result.ok) {
      result.renderer.destroy();
    }
  });

  test("reports secure-context, format, and shader diagnostics before showing the 3D view", async () => {
    const insecure = await createWebGpuScaleRenderer({
      gpu: undefined,
      canvas: canvas(),
      requirements: undefined,
      isSecureContext: false,
    });
    expect(insecure.ok).toBe(false);
    if (!insecure.ok) {
      expect(insecure.failure.code).toBe("insecure-context");
      expect(insecure.failure.diagnostics).toContainEqual(
        expect.objectContaining({ name: "isSecureContext", observed: false }),
      );
    }

    const badFormat = await createWebGpuScaleRenderer({
      gpu: {
        ...gpu(adapter(createGpuDevice())),
        getPreferredCanvasFormat: () => "rgba16float",
      },
      canvas: canvas(),
      requirements: undefined,
      isSecureContext: true,
    });
    expect(badFormat.ok).toBe(false);
    if (!badFormat.ok) {
      expect(badFormat.failure.code).toBe("invalid-canvas-format");
      expect(badFormat.failure.diagnostics).toContainEqual(
        expect.objectContaining({ name: "preferredCanvasFormat", observed: "rgba16float" }),
      );
    }

    const badShader = await createWebGpuScaleRenderer({
      gpu: gpu(adapter(createGpuDevice())),
      canvas: canvas(),
      requirements: {
        requiredFeatures: [],
        requiredLimits: {},
        shaderAssumptions: [{ name: "fixture-assumption", required: true, observed: false }],
      },
      isSecureContext: true,
    });
    expect(badShader.ok).toBe(false);
    if (!badShader.ok) {
      expect(badShader.failure.code).toBe("shader-assumption-failed");
      expect(badShader.failure.diagnostics).toContainEqual(
        expect.objectContaining({ name: "fixture-assumption", observed: false }),
      );
    }
  });

  test("fails before device initialization when a required scale limit is unavailable", async () => {
    let requested = false;
    const device = createGpuDevice();
    const limited = Object.fromEntries(
      Object.entries(scaleLimits()).map(([name, value]) => [
        name,
        name === "maxBufferSize" ? 1 : value,
      ]),
    );
    const result = await createWebGpuScaleRenderer({
      gpu: gpu({
        ...adapter(device, [], limited),
        requestDevice: async () => {
          requested = true;
          return device;
        },
      }),
      canvas: canvas(),
      requirements: undefined,
      isSecureContext: true,
    });

    expect(result.ok).toBe(false);
    expect(requested).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("missing-limit");
      expect(result.failure.detail).toContain("maxBufferSize");
      expect(result.failure.diagnostics).toContainEqual(
        expect.objectContaining({ name: "maxBufferSize", required: 32_016_656, observed: 1 }),
      );
    }
  });

  test("rejects spoofed and hostile preparations before allocation or proxy traps", async () => {
    let dispatchCount = 0;
    const buffers: unknown[] = [];
    const errors: unknown[] = [];
    const device = createGpuDevice({
      onDispatch: (count) => {
        dispatchCount += count;
      },
      onBuffer: (descriptor) => buffers.push(descriptor),
    });
    const result = await createWebGpuScaleRenderer(
      {
        gpu: gpu(adapter(device)),
        canvas: canvas(),
        requirements: undefined,
        isSecureContext: true,
      },
      {
        scheduler: undefined,
        onRenderError: (error) => errors.push(error),
        onDeviceLost: undefined,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const valid = scaleScene();
    const mismatch = Object.freeze({
      ...valid,
      preparation: Object.freeze({
        ...valid.preparation,
        budget: Object.freeze({
          ...valid.preparation.budget,
          pointBufferBytes: valid.preparation.budget.pointBufferBytes - 4,
        }),
      }),
    });
    result.renderer.renderScaleNow(mismatch, createCameraState(undefined));
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("private identity brand");
    expect(buffers).toHaveLength(0);
    expect(dispatchCount).toBe(0);

    let trapCount = 0;
    const hostilePreparation = new Proxy(valid.preparation, {
      get: () => {
        trapCount += 1;
        throw new Error("hostile getter invoked");
      },
      ownKeys: () => {
        trapCount += 1;
        throw new Error("hostile ownKeys invoked");
      },
      getOwnPropertyDescriptor: () => {
        trapCount += 1;
        throw new Error("hostile descriptor invoked");
      },
    });
    const hostile = Object.freeze({
      ...valid,
      preparation: hostilePreparation,
    }) as unknown as WebGpuScaleRenderScene;
    result.renderer.renderScaleNow(hostile, createCameraState(undefined));
    expect(errors).toHaveLength(2);
    expect(String(errors[1])).toContain("private identity brand");
    expect(trapCount).toBe(0);
    expect(buffers).toHaveLength(0);
    expect(dispatchCount).toBe(0);
    result.renderer.destroy();
  });

  test("rejects oversized, sparse, accessor, and hostile overlays before allocation or dispatch", async () => {
    let dispatchCount = 0;
    const buffers: unknown[] = [];
    const errors: unknown[] = [];
    const device = createGpuDevice({
      onDispatch: (count) => {
        dispatchCount += count;
      },
      onBuffer: (descriptor) => buffers.push(descriptor),
    });
    const result = await createWebGpuScaleRenderer(
      {
        gpu: gpu(adapter(device)),
        canvas: canvas(),
        requirements: undefined,
        isSecureContext: true,
      },
      {
        scheduler: undefined,
        onRenderError: (error) => errors.push(error),
        onDeviceLost: undefined,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const valid = scaleScene();
    const oversized = Object.freeze({
      ...valid,
      overlay: { points: new Array(MAX_WEBGPU_SCALE_OVERLAY_POINTS + 1), connections: [] },
    }) as unknown as WebGpuScaleRenderScene;
    const sparse = Object.freeze({
      ...valid,
      overlay: {
        points: Object.assign(new Array(1), { 1: { position: [0, 0, 0], color: [1, 1, 1, 1] } }),
        connections: [],
      },
    }) as unknown as WebGpuScaleRenderScene;
    const byteOversized = Object.freeze({
      ...valid,
      overlay: {
        points: new Array(MAX_WEBGPU_SCALE_OVERLAY_POINTS),
        connections: new Array(MAX_WEBGPU_SCALE_OVERLAY_CONNECTIONS),
      },
    }) as unknown as WebGpuScaleRenderScene;
    const boundaryConnectionCount = Math.floor(
      MAX_WEBGPU_SCALE_OVERLAY_BUFFER_BYTES / (2 * WEBGPU_OVERLAY_CONNECTION_STRIDE_BYTES),
    );
    const oneOverBufferBudget = Object.freeze({
      ...valid,
      overlay: {
        points: [],
        connections: new Array(boundaryConnectionCount + 1),
      },
    }) as unknown as WebGpuScaleRenderScene;
    const accessorPoint = Object.defineProperties(
      {},
      {
        position: { enumerable: true, get: () => [0, 0, 0] },
        color: { enumerable: true, value: [1, 1, 1, 1] },
      },
    );
    const accessor = Object.freeze({
      ...valid,
      overlay: { points: [accessorPoint], connections: [] },
    }) as unknown as WebGpuScaleRenderScene;
    let ownKeysCalls = 0;
    const hostileOverlay = new Proxy(valid.overlay, {
      ownKeys: () => {
        ownKeysCalls += 1;
        throw new Error("hostile overlay ownKeys invoked");
      },
    });
    const hostile = Object.freeze({
      ...valid,
      overlay: hostileOverlay,
    }) as unknown as WebGpuScaleRenderScene;

    for (const scene of [
      oversized,
      sparse,
      byteOversized,
      oneOverBufferBudget,
      accessor,
      hostile,
    ]) {
      result.renderer.renderScaleNow(scene, createCameraState(undefined));
    }
    expect(errors).toHaveLength(6);
    expect(buffers).toHaveLength(0);
    expect(dispatchCount).toBe(0);
    expect(ownKeysCalls).toBeGreaterThan(0);
    result.renderer.destroy();
  });

  test("accounts conversion staging in the overlay peak budget at its boundary", () => {
    const boundaryCount = Math.floor(
      MAX_WEBGPU_SCALE_OVERLAY_BUFFER_BYTES / (2 * WEBGPU_OVERLAY_CONNECTION_STRIDE_BYTES),
    );
    const makeConnections = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        from: [index, 0, 0],
        to: [index + 1, 1, 1],
        color: [0, 1, 1, 1],
      }));
    const boundary = validateWebGpuScaleOverlay({
      points: [],
      connections: makeConnections(boundaryCount),
    });
    expect(boundary.budget.peakBufferBytes).toBeLessThanOrEqual(
      MAX_WEBGPU_SCALE_OVERLAY_BUFFER_BYTES,
    );
    expect(boundary.budget.conversionBytes).toBe(
      boundaryCount * WEBGPU_OVERLAY_CONNECTION_STRIDE_BYTES,
    );
    expect(() =>
      validateWebGpuScaleOverlay({
        points: [],
        connections: makeConnections(boundaryCount + 1),
      }),
    ).toThrow("independent GPU buffer budget");
  });

  test("reuses an oversized overlay buffer when the next snapshot fits", async () => {
    const overlayAllocations: number[] = [];
    const overlayDestroys: number[] = [];
    const isOverlayBuffer = (
      descriptor: unknown,
    ): descriptor is { readonly size: number; readonly usage: number } => {
      if (typeof descriptor !== "object" || descriptor === null) {
        return false;
      }
      const value = descriptor as { readonly size?: unknown; readonly usage?: unknown };
      return typeof value.size === "number" && value.usage === 0x28;
    };
    const device = createGpuDevice({
      onBuffer: (descriptor) => {
        if (isOverlayBuffer(descriptor)) {
          overlayAllocations.push(descriptor.size);
        }
      },
      onBufferDestroy: (descriptor) => {
        if (isOverlayBuffer(descriptor)) {
          overlayDestroys.push(descriptor.size);
        }
      },
    });
    const result = await createWebGpuScaleRenderer({
      gpu: gpu(adapter(device)),
      canvas: canvas(),
      requirements: undefined,
      isSecureContext: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const scene = scaleScene();
    const points = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        position: [index, 0, 0],
        color: [1, 1, 1, 1],
      }));
    result.renderer.renderScaleNow(
      Object.freeze({
        ...scene,
        overlay: { points: points(20), connections: [] },
      }) as unknown as WebGpuScaleRenderScene,
      createCameraState(undefined),
    );
    result.renderer.renderScaleNow(
      Object.freeze({
        ...scene,
        overlay: { points: points(1), connections: [] },
      }) as unknown as WebGpuScaleRenderScene,
      createCameraState(undefined),
    );
    expect(overlayAllocations).toEqual([20 * 7 * Float32Array.BYTES_PER_ELEMENT]);
    expect(overlayDestroys).toEqual([]);
    result.renderer.destroy();
    expect(overlayDestroys).toEqual(overlayAllocations);
  });

  test("accepts bounded overlay growth and rejects transient over-cap replacement before allocation", async () => {
    const events: string[] = [];
    const isOverlayBuffer = (
      descriptor: unknown,
    ): descriptor is { readonly size: number; readonly usage: number } => {
      if (typeof descriptor !== "object" || descriptor === null) {
        return false;
      }
      const value = descriptor as { readonly size?: unknown; readonly usage?: unknown };
      return typeof value.size === "number" && value.usage === 0x28;
    };
    const device = createGpuDevice({
      onBuffer: (descriptor) => {
        if (isOverlayBuffer(descriptor)) {
          events.push(`allocate:${String(descriptor.size)}`);
        }
      },
      onBufferDestroy: (descriptor) => {
        if (isOverlayBuffer(descriptor)) {
          events.push(`destroy:${String(descriptor.size)}`);
        }
      },
    });
    const errors: unknown[] = [];
    const result = await createWebGpuScaleRenderer(
      {
        gpu: gpu(adapter(device)),
        canvas: canvas(),
        requirements: undefined,
        isSecureContext: true,
      },
      {
        scheduler: undefined,
        onRenderError: (error) => errors.push(error),
        onDeviceLost: undefined,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const scene = scaleScene();
    const line = (index: number) => ({
      from: [index, 0, 0],
      to: [index + 1, 1, 1],
      color: [0, 1, 1, 1],
    });
    result.renderer.renderScaleNow(
      Object.freeze({
        ...scene,
        overlay: { points: [], connections: [line(0)] },
      }) as unknown as WebGpuScaleRenderScene,
      createCameraState(undefined),
    );
    const initial = [...events];
    expect(initial).toEqual(["allocate:256"]);
    const boundaryCount = Math.floor(
      (MAX_WEBGPU_SCALE_OVERLAY_BUFFER_BYTES - 256) / (2 * WEBGPU_OVERLAY_CONNECTION_STRIDE_BYTES),
    );
    result.renderer.renderScaleNow(
      Object.freeze({
        ...scene,
        overlay: {
          points: [],
          connections: Array.from({ length: boundaryCount }, (_, index) => line(index)),
        },
      }) as unknown as WebGpuScaleRenderScene,
      createCameraState(undefined),
    );
    const afterBoundary = [...events];
    expect(afterBoundary).toEqual([
      ...initial,
      `allocate:${boundaryCount * WEBGPU_OVERLAY_CONNECTION_STRIDE_BYTES}`,
      "destroy:256",
    ]);
    const beforeRejected = [...events];
    result.renderer.renderScaleNow(
      Object.freeze({
        ...scene,
        overlay: {
          points: [],
          connections: Array.from({ length: boundaryCount + 1 }, (_, index) => line(index)),
        },
      }) as unknown as WebGpuScaleRenderScene,
      createCameraState(undefined),
    );
    expect(events).toEqual(beforeRejected);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("replacement exceeds");
    result.renderer.destroy();
  });

  test("snapshots valid overlays and reports their independent bounded budget", async () => {
    const buffers: { readonly size: number; readonly usage: number }[] = [];
    const device = createGpuDevice({
      onBuffer: (descriptor) => {
        if (typeof descriptor === "object" && descriptor !== null) {
          const value = descriptor as { readonly size?: unknown; readonly usage?: unknown };
          if (typeof value.size === "number" && typeof value.usage === "number") {
            buffers.push({ size: value.size, usage: value.usage });
          }
        }
      },
    });
    const result = await createWebGpuScaleRenderer({
      gpu: gpu(adapter(device)),
      canvas: canvas(),
      requirements: undefined,
      isSecureContext: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const scene = scaleScene();
    const overlayScene = Object.freeze({
      ...scene,
      overlay: Object.freeze({
        points: Object.freeze([
          Object.freeze({
            position: Object.freeze([0, 0, 0]),
            color: Object.freeze([1, 0.5, 0, 1]),
          }),
        ]),
        connections: Object.freeze([
          Object.freeze({
            from: Object.freeze([0, 0, 0]),
            to: Object.freeze([1, 1, 1]),
            color: Object.freeze([0, 1, 1, 0.5]),
          }),
        ]),
      }),
    });
    result.renderer.renderScaleNow(
      overlayScene as unknown as WebGpuScaleRenderScene,
      createCameraState(undefined),
    );
    expect(result.renderer.lastFrame()).toMatchObject({
      overlayBudget: {
        pointCount: 1,
        connectionCount: 1,
        pointBufferBytes: 256,
        connectionBufferBytes: 256,
        totalBufferBytes: 512,
        pointConversionBytes: 28,
        connectionConversionBytes: 56,
        conversionBytes: 84,
        peakBufferBytes: 596,
      },
    });
    expect(buffers).toContainEqual({ size: 256, usage: 0x28 });
    expect(buffers).toContainEqual({ size: 256, usage: 0x28 });
    result.renderer.destroy();
  });

  test("dispatches bounded compute work and uses a GPU indirect draw instead of million JS vertices", async () => {
    let dispatchCount = 0;
    let indirectDraws = 0;
    const buffers: unknown[] = [];
    const device = createGpuDevice({
      onDispatch: (count) => {
        dispatchCount = count;
      },
      onDrawIndirect: () => {
        indirectDraws += 1;
      },
      onBuffer: (descriptor) => buffers.push(descriptor),
    });
    const result = await createWebGpuScaleRenderer({
      gpu: gpu(adapter(device)),
      canvas: canvas(),
      requirements: undefined,
      isSecureContext: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const scene = scaleScene();
    result.renderer.renderScaleNow(scene, createCameraState(undefined));
    expect(dispatchCount).toBe(15_625);
    expect(indirectDraws).toBe(1);
    result.renderer.renderScaleNow(scene, createCameraState(undefined));
    expect(dispatchCount).toBe(15_625);
    expect(indirectDraws).toBe(2);
    expect(buffers).toContainEqual({ size: 32_000_000, usage: 0x84 });
    expect(result.renderer.lastFrame()).toMatchObject({
      candidateCount: 1_000_000,
      visibleCapacity: 1_000_000,
      dispatchWorkgroups: 15_625,
      timingSource: "request-animation-frame",
    });
    await expect(result.renderer.readScaleOutput()).rejects.toThrow("cannot be mapped");
    result.renderer.destroy();
  });

  test("separates total visible count from bounded returned records", async () => {
    const device = createReadbackDevice(4);
    const result = await createWebGpuScaleRenderer({
      gpu: gpu(adapter(device)),
      canvas: canvas(),
      requirements: undefined,
      isSecureContext: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const contract = createWebGpuScaleContract({
      logicalPopulation: 8,
      seed: "readback-fixture",
      generatorVersion: "globular-v1",
      regionRadiusMeters: 5e17,
    });
    const scene = Object.freeze({
      preparation: prepareWebGpuScale(contract, view(), 4),
      overlay,
      focusFog: undefined,
    });
    result.renderer.renderScaleNow(scene, createCameraState(undefined));

    const countOnly = await result.renderer.readScaleOutput();
    expect(countOnly.visibleCount).toBe(4);
    expect(countOnly.returnedRecordCount).toBe(0);
    expect(countOnly.positions).toHaveLength(0);
    expect(countOnly.stableKeys).toHaveLength(0);
    expect(device.copySizes.at(-1)).toBe(4);

    const capped = await result.renderer.readScaleOutput({ maxPoints: 2 });
    expect(capped.visibleCount).toBe(4);
    expect(capped.returnedRecordCount).toBe(2);
    expect(capped.positions).toHaveLength(8);
    expect(capped.stableKeys).toHaveLength(8);
    expect(device.copySizes.slice(-2)).toEqual([64, 4]);
    expect(device.readbackSizes.at(-1)).toBe(68);

    const zero = await result.renderer.readScaleOutput({ maxPoints: 0 });
    expect(zero.visibleCount).toBe(4);
    expect(zero.returnedRecordCount).toBe(0);
    expect(zero.positions).toHaveLength(0);
    expect(zero.stableKeys).toHaveLength(0);

    const full = await result.renderer.readScaleOutput({ maxPoints: 4 });
    expect(full.visibleCount).toBe(4);
    expect(full.returnedRecordCount).toBe(4);
    expect(full.positions).toHaveLength(16);
    expect(full.stableKeys).toHaveLength(16);
    expect(device.copySizes.slice(-2)).toEqual([128, 4]);
    expect(device.readbackSizes.at(-1)).toBe(132);
    result.renderer.destroy();
  });

  test("uses optional timestamp queries only after resolving a real sample", async () => {
    const timestamped = createReadbackDevice(4, { timestamp: true, timestampPeriod: 2 });
    expect(
      selectWebGpuTimingSource(
        timestamped as unknown as WebGpuDevice & {
          createQuerySet: () => { destroy: () => void };
        },
      ),
    ).toBe("gpu-timestamp");
    expect(selectWebGpuTimingSource(createGpuDevice())).toBe("request-animation-frame");
    expect(
      selectWebGpuTimingSource({
        ...createGpuDevice(),
        features: featureSet(["timestamp-query"]),
        createQuerySet: () => ({ destroy: () => undefined }),
      }),
    ).toBe("request-animation-frame");
    expect(
      selectWebGpuTimingSource({
        ...createReadbackDevice(4, { timestamp: true }),
        limits: { ...scaleLimits(), timestampPeriod: 0 },
      }),
    ).toBe("request-animation-frame");
    const result = await createWebGpuScaleRenderer({
      gpu: gpu(adapter(timestamped, ["timestamp-query"])),
      canvas: canvas(),
      requirements: undefined,
      isSecureContext: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const scene = Object.freeze({
      preparation: prepareWebGpuScale(
        createWebGpuScaleContract({
          logicalPopulation: 8,
          seed: "timestamp-fixture",
          generatorVersion: "globular-v1",
          regionRadiusMeters: 5e17,
        }),
        view(),
        4,
      ),
      overlay,
      focusFog: undefined,
    });
    result.renderer.renderScaleNow(scene, createCameraState(undefined));
    expect(result.renderer.lastFrame()).toMatchObject({
      timingSource: "request-animation-frame",
      gpuTimeMilliseconds: undefined,
    });
    const timestampedOutput = await result.renderer.readScaleOutput();
    expect(timestampedOutput).toMatchObject({
      timingSource: "gpu-timestamp",
      gpuTimeMilliseconds: 4,
    });
    expect(
      selectWebGpuBenchmarkTimingSource(
        timestampedOutput.timingSource,
        timestampedOutput.gpuTimeMilliseconds,
      ),
    ).toBe("gpu-timestamp");
    expect(result.renderer.lastFrame()).toMatchObject({
      timingSource: "gpu-timestamp",
      gpuTimeMilliseconds: 4,
    });
    result.renderer.destroy();

    const timestampFailureDevices = [
      createReadbackDevice(4, { timestamp: true, timestampResolveFailure: true }),
      createReadbackDevice(4, { timestamp: true, timestampCopyFailure: true }),
      createReadbackDevice(4, { timestamp: true, timestampMapFailure: true }),
    ];
    for (const timestampFailureDevice of timestampFailureDevices) {
      const renderErrors: unknown[] = [];
      const failureResult = await createWebGpuScaleRenderer(
        {
          gpu: gpu(adapter(timestampFailureDevice, ["timestamp-query"])),
          canvas: canvas(),
          requirements: undefined,
          isSecureContext: true,
        },
        {
          scheduler: undefined,
          onRenderError: (error) => renderErrors.push(error),
          onDeviceLost: undefined,
        },
      );
      expect(failureResult.ok).toBe(true);
      if (failureResult.ok) {
        failureResult.renderer.renderScaleNow(scene, createCameraState(undefined));
        const fallbackOutput = await failureResult.renderer.readScaleOutput();
        expect(fallbackOutput).toMatchObject({
          timingSource: "request-animation-frame",
          gpuTimeMilliseconds: undefined,
        });
        expect(
          selectWebGpuBenchmarkTimingSource(
            fallbackOutput.timingSource,
            fallbackOutput.gpuTimeMilliseconds,
          ),
        ).toBe("request-animation-frame");
        expect(renderErrors).toHaveLength(0);
        expect(failureResult.renderer.lastFrame()).toMatchObject({
          timingSource: "request-animation-frame",
          gpuTimeMilliseconds: undefined,
        });
        failureResult.renderer.destroy();
      }
    }
  });

  test("releases bounded buffers and device on asynchronous loss", async () => {
    let resolveLoss: (loss: WebGpuDeviceLoss) => void = () => undefined;
    const loss = new Promise<WebGpuDeviceLoss>((resolve) => {
      resolveLoss = resolve;
    });
    let destroyed = 0;
    let buffersDestroyed = 0;
    const device = createGpuDevice({
      features: ["timestamp-query"],
      onDestroy: () => {
        destroyed += 1;
      },
    });
    const tracked = {
      ...device,
      lost: loss,
      createBuffer: (descriptor: unknown) => {
        void descriptor;
        return {
          destroy: () => {
            buffersDestroyed += 1;
          },
        };
      },
    } as WebGpuDevice;
    const failures: unknown[] = [];
    const result = await createWebGpuScaleRenderer(
      {
        gpu: gpu(adapter(tracked, ["timestamp-query"])),
        canvas: canvas(),
        requirements: undefined,
        isSecureContext: true,
      },
      {
        scheduler: undefined,
        onRenderError: undefined,
        onDeviceLost: (failure) => failures.push(failure),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    result.renderer.renderScaleNow(scaleScene(), createCameraState(undefined));
    resolveLoss({ reason: "removed", message: "test loss" });
    await Promise.resolve();
    await Promise.resolve();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      code: "device-lost",
      diagnostics: [expect.objectContaining({ name: "GPUDevice.lost", observed: "removed" })],
    });
    expect(buffersDestroyed).toBeGreaterThanOrEqual(3);
    expect(destroyed).toBe(1);
    result.renderer.renderScaleNow(scaleScene(), createCameraState(undefined));
  });
});
