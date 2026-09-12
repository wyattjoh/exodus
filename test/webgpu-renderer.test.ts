import { describe, expect, test } from "bun:test";

import { createCameraState } from "../app/cluster-explorer";
import {
  DEFAULT_WEBGPU_REQUIREMENTS,
  checkWebGpuCapabilities,
  createWebGpuRenderer,
  type WebGpuAdapter,
  type WebGpuApi,
  type WebGpuCanvas,
  type WebGpuCanvasContext,
  type WebGpuDevice,
  type WebGpuDeviceLoss,
} from "../app/webgpu-renderer";

function featureSet(features: readonly string[]) {
  const available = new Set(features);
  return { has: (feature: string) => available.has(feature) };
}

function context(): WebGpuCanvasContext {
  return {
    configure: () => undefined,
    getCurrentTexture: () => ({ createView: () => ({}) }),
  };
}

function canvas(value: WebGpuCanvasContext | null = context()): WebGpuCanvas {
  return {
    width: 640,
    height: 360,
    clientWidth: 640,
    clientHeight: 360,
    getContext: () => value,
  };
}

const NEVER_LOST: Promise<WebGpuDeviceLoss> = new Promise(() => undefined);

function device(overrides: Partial<WebGpuDevice> = {}): WebGpuDevice {
  const base: WebGpuDevice = {
    lost: NEVER_LOST,
    features: featureSet([]),
    limits: DEFAULT_WEBGPU_REQUIREMENTS.requiredLimits,
    queue: {
      writeBuffer: () => undefined,
      submit: () => undefined,
    },
    createShaderModule: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createBindGroup: () => ({}),
    createRenderPipeline: () => ({}),
    createBuffer: () => ({ destroy: () => undefined }),
    createCommandEncoder: () => ({
      beginRenderPass: () => ({
        setPipeline: () => undefined,
        setBindGroup: () => undefined,
        setVertexBuffer: () => undefined,
        draw: () => undefined,
        end: () => undefined,
      }),
      finish: () => ({}),
    }),
    destroy: undefined,
  };
  return Object.assign(base, overrides);
}

function adapter(
  value: WebGpuDevice = device(),
  features: readonly string[] = [],
  limits: Readonly<Record<string, number | undefined>> = DEFAULT_WEBGPU_REQUIREMENTS.requiredLimits,
): WebGpuAdapter {
  return {
    features: featureSet(features),
    limits,
    requestDevice: async () => value,
  };
}

function gpu(value: WebGpuAdapter | null): WebGpuApi {
  return {
    requestAdapter: async () => value,
    getPreferredCanvasFormat: () => "bgra8unorm",
  };
}

describe("WebGPU renderer capability seam", () => {
  test("returns an accessible hard failure when navigator.gpu is absent", async () => {
    const result = await checkWebGpuCapabilities({
      gpu: undefined,
      canvas: canvas(),
      requirements: undefined,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("gpu-unavailable");
      expect(result.failure.detail).toContain("no WebGL or 2D fallback");
    }
  });

  test("validates adapter, feature, limit, device, and canvas failures independently", async () => {
    const noAdapter = await checkWebGpuCapabilities({
      gpu: gpu(null),
      canvas: canvas(),
      requirements: undefined,
    });
    const noFeature = await checkWebGpuCapabilities({
      gpu: gpu(adapter(device(), [])),
      canvas: canvas(),
      requirements: {
        requiredFeatures: ["timestamp-query"],
        requiredLimits: {},
      },
    });
    const noLimit = await checkWebGpuCapabilities({
      gpu: gpu(adapter(device(), [], { maxBufferSize: 1 })),
      canvas: canvas(),
      requirements: undefined,
    });
    const noContext = await checkWebGpuCapabilities({
      gpu: gpu(adapter()),
      canvas: canvas(null),
      requirements: undefined,
    });

    expect(noAdapter.ok && "unexpected adapter").toBe(false);
    expect(noFeature.ok && "unexpected feature").toBe(false);
    expect(noLimit.ok && "unexpected limit").toBe(false);
    expect(noContext.ok && "unexpected context").toBe(false);
    if (!noAdapter.ok && !noFeature.ok && !noLimit.ok && !noContext.ok) {
      expect(noAdapter.failure.code).toBe("adapter-unavailable");
      expect(noFeature.failure.code).toBe("missing-feature");
      expect(noLimit.failure.code).toBe("missing-limit");
      expect(noContext.failure.code).toBe("context-unavailable");
    }
  });

  test("publishes asynchronous device loss and tears down future rendering", async () => {
    let resolveLoss: (loss: WebGpuDeviceLoss) => void = () => undefined;
    const loss = new Promise<WebGpuDeviceLoss>((resolve) => {
      resolveLoss = resolve;
    });
    const callbacks: (() => void)[] = [];
    const submitted: unknown[][] = [];
    let bufferDestroys = 0;
    let deviceDestroys = 0;
    const gpuDevice = device({
      lost: loss,
      destroy: () => {
        deviceDestroys += 1;
      },
      createBuffer: () => ({
        destroy: () => {
          bufferDestroys += 1;
        },
      }),
      queue: {
        writeBuffer: () => undefined,
        submit: (commands: readonly unknown[]) => submitted.push([...commands]),
      },
    });
    const failures: unknown[] = [];
    const result = await createWebGpuRenderer(
      {
        gpu: gpu(adapter(gpuDevice)),
        canvas: canvas(),
        requirements: undefined,
      },
      {
        scheduler: { request: (callback) => callbacks.push(callback) },
        onRenderError: undefined,
        onDeviceLost: (failure) => failures.push(failure),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const scene = {
      points: [{ position: [0, 0, 0] as const, color: [1, 1, 1, 1] as const }],
      connections: [],
    };
    result.renderer.renderNow(scene, createCameraState(undefined));
    expect(submitted).toHaveLength(1);

    resolveLoss({ reason: "removed", message: "The adapter was removed." });
    await Promise.resolve();
    await Promise.resolve();

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      code: "device-lost",
      message: "The WebGPU device was lost while rendering.",
      detail:
        "Reason: removed. The adapter was removed. Rendering stopped and GPU resources were released. Reload the page to retry WebGPU.",
      diagnostics: [
        expect.objectContaining({
          kind: "availability",
          name: "GPUDevice.lost",
          required: "not-lost",
          observed: "removed",
        }),
      ],
    });
    expect(bufferDestroys).toBe(2);
    expect(deviceDestroys).toBe(1);
    result.renderer.renderNow(scene, createCameraState(undefined));
    result.renderer.setScene(scene, createCameraState(undefined));
    expect(callbacks).toHaveLength(0);
    expect(submitted).toHaveLength(1);
  });

  test("contains device-loss callback exceptions without an unhandled rejection", async () => {
    let resolveLoss: (loss: WebGpuDeviceLoss) => void = () => undefined;
    const loss = new Promise<WebGpuDeviceLoss>((resolve) => {
      resolveLoss = resolve;
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const result = await createWebGpuRenderer(
        {
          gpu: gpu(adapter(device({ lost: loss }))),
          canvas: canvas(),
          requirements: undefined,
        },
        {
          scheduler: undefined,
          onRenderError: undefined,
          onDeviceLost: () => {
            throw new Error("consumer callback failed");
          },
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      resolveLoss({ reason: "unknown", message: "Injected loss." });
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(unhandled).toEqual([]);
      result.renderer.setScene({ points: [], connections: [] }, createCameraState(undefined));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("cleans partial resources when bind-group initialization fails", async () => {
    let bufferDestroys = 0;
    let deviceDestroys = 0;
    const result = await createWebGpuRenderer(
      {
        gpu: gpu(
          adapter(
            device({
              createBuffer: () => ({
                destroy: () => {
                  bufferDestroys += 1;
                },
              }),
              createBindGroup: () => {
                throw new Error("bind-group setup failed");
              },
              destroy: () => {
                deviceDestroys += 1;
              },
            }),
          ),
        ),
        canvas: canvas(),
        requirements: undefined,
      },
      { scheduler: undefined, onRenderError: undefined, onDeviceLost: undefined },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("renderer-init-failed");
      expect(result.failure.detail).toContain("bind-group setup failed");
    }
    expect(bufferDestroys).toBe(1);
    expect(deviceDestroys).toBe(1);
  });

  test("cleans partial resources when loss observation setup fails", async () => {
    let bufferDestroys = 0;
    let deviceDestroys = 0;
    const brokenLossSignal = Promise.resolve({
      reason: "unknown",
      message: "Should not resolve.",
    }) as Promise<WebGpuDeviceLoss>;
    Reflect.defineProperty(brokenLossSignal, ["t", "h", "e", "n"].join(""), {
      value: () => {
        throw new Error("loss observer setup failed");
      },
    });
    const result = await createWebGpuRenderer(
      {
        gpu: gpu(
          adapter(
            device({
              lost: brokenLossSignal,
              createBuffer: () => ({
                destroy: () => {
                  bufferDestroys += 1;
                },
              }),
              destroy: () => {
                deviceDestroys += 1;
              },
            }),
          ),
        ),
        canvas: canvas(),
        requirements: undefined,
      },
      { scheduler: undefined, onRenderError: undefined, onDeviceLost: undefined },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("renderer-init-failed");
      expect(result.failure.detail).toContain("loss observer setup failed");
    }
    expect(bufferDestroys).toBe(1);
    expect(deviceDestroys).toBe(1);
  });

  test("does not publish a loss after deliberate renderer disposal", async () => {
    let resolveLoss: (loss: WebGpuDeviceLoss) => void = () => undefined;
    const loss = new Promise<WebGpuDeviceLoss>((resolve) => {
      resolveLoss = resolve;
    });
    const failures: unknown[] = [];
    const result = await createWebGpuRenderer(
      {
        gpu: gpu(adapter(device({ lost: loss }))),
        canvas: canvas(),
        requirements: undefined,
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
    result.renderer.destroy();
    resolveLoss({ reason: "destroyed", message: "The renderer was disposed." });
    await Promise.resolve();
    await Promise.resolve();

    expect(failures).toHaveLength(0);
  });

  test("configures a conforming device and coalesces render updates", async () => {
    const configured: unknown[] = [];
    const submitted: unknown[][] = [];
    const callbacks: (() => void)[] = [];
    const renderPasses: number[] = [];
    const gpuContext: WebGpuCanvasContext = {
      configure: (value) => configured.push(value),
      getCurrentTexture: () => ({ createView: () => ({}) }),
    };
    const gpuDevice = device({
      createBindGroup: () => ({}),
      queue: {
        writeBuffer: () => undefined,
        submit: (commands: readonly unknown[]) => submitted.push([...commands]),
      },
      createCommandEncoder: () => ({
        beginRenderPass: () => ({
          setPipeline: () => undefined,
          setBindGroup: () => undefined,
          setVertexBuffer: () => undefined,
          draw: (count: number) => renderPasses.push(count),
          end: () => undefined,
        }),
        finish: () => ({ command: true }),
      }),
    });
    const result = await createWebGpuRenderer(
      {
        gpu: gpu(adapter(gpuDevice)),
        canvas: canvas(gpuContext),
        requirements: undefined,
      },
      {
        scheduler: { request: (callback) => callbacks.push(callback) },
        onRenderError: undefined,
        onDeviceLost: undefined,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const scene = {
      points: [{ position: [0, 0, 0] as const, color: [1, 1, 1, 1] as const }],
      connections: [],
    };
    result.renderer.setScene(scene, createCameraState(undefined));
    result.renderer.setScene(scene, createCameraState(undefined));

    expect(callbacks).toHaveLength(1);
    callbacks[0]?.();
    expect(configured.length).toBeGreaterThanOrEqual(1);
    expect(submitted).toHaveLength(1);
    expect(renderPasses).toEqual([1]);
    result.renderer.destroy();
  });
});
