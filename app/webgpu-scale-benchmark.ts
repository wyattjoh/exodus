import {
  createWebGpuScaleRenderer,
  type WebGpuAdapter,
  type WebGpuApi,
  type WebGpuCanvas,
  type WebGpuScaleReadback,
  type WebGpuScaleRenderer,
} from "./webgpu-renderer";
import { createCameraState } from "./cluster-explorer";
import {
  compareWebGpuBenchmarkBaseline,
  createMeasuredWebGpuBenchmarkResult,
  createUnavailableWebGpuBenchmarkResult,
  createWebGpuScaleContract,
  defaultWebGpuBenchmarkBaseline,
  defaultWebGpuBenchmarkPreparation,
  generateWebGpuReferencePoint,
  prepareWebGpuScale,
  resolveWebGpuStableId,
  selectWebGpuBenchmarkTimingSource,
  verifyWebGpuConformanceFixtures,
  webGpuPositionMatchesReference,
  WEBGPU_BENCHMARK_SAMPLE_FRAME_COUNT,
  WEBGPU_BENCHMARK_WARMUP_FRAME_COUNT,
  WEBGPU_CONFORMANCE_FIXTURES,
  type WebGpuBenchmarkMetadata,
  type WebGpuScalePreparation,
} from "../src/webgpu-scale";

const EMPTY_OVERLAY = Object.freeze({ points: [], connections: [] });
const resultElement = document.getElementById("webgpu-scale-result");
const canvas = document.getElementById("webgpu-scale-canvas");

function show(value: unknown, state: "pass" | "fail" | "unavailable"): void {
  if (resultElement === null) {
    return;
  }
  resultElement.className = state;
  resultElement.textContent = JSON.stringify(value, null, 2);
}

function browserIdentity(): readonly [string, string] {
  const userAgent = navigator.userAgent;
  const candidates: readonly (readonly [string, RegExp])[] = [
    ["Edge", /Edg\/([\d.]+)/],
    ["Chrome", /Chrome\/([\d.]+)/],
    ["Firefox", /Firefox\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari\//],
  ];
  for (const [name, expression] of candidates) {
    const version = userAgent.match(expression)?.[1];
    if (version !== undefined) {
      return [name, version];
    }
  }
  return ["Unknown browser", "unknown"];
}

function baseMetadata(): WebGpuBenchmarkMetadata {
  const [browser, browserVersion] = browserIdentity();
  return Object.freeze({
    browser,
    browserVersion,
    operatingSystem: navigator.platform || "unknown",
    adapterName: undefined,
    adapterVendor: undefined,
    adapterArchitecture: undefined,
    measuredAt: new Date().toISOString(),
  });
}

async function metadataForAdapter(adapter: WebGpuAdapter): Promise<WebGpuBenchmarkMetadata> {
  const base = baseMetadata();
  const requestAdapterInfo = (
    adapter as WebGpuAdapter & {
      readonly requestAdapterInfo?: () => Promise<{
        readonly device?: string;
        readonly vendor?: string;
        readonly architecture?: string;
        readonly description?: string;
      }>;
    }
  ).requestAdapterInfo;
  if (requestAdapterInfo !== undefined) {
    try {
      const info = await requestAdapterInfo.call(adapter);
      return Object.freeze({
        ...base,
        adapterName: info.device || info.description || undefined,
        adapterVendor: info.vendor,
        adapterArchitecture: info.architecture,
      });
    } catch {
      // Fall through to the current `GPUAdapter.info` shape below.
    }
  }
  const info = (
    adapter as WebGpuAdapter & {
      readonly info?: {
        readonly device?: string;
        readonly vendor?: string;
        readonly architecture?: string;
        readonly description?: string;
      };
    }
  ).info;
  if (info === undefined) {
    return base;
  }
  return Object.freeze({
    ...base,
    adapterName: info.device || info.description || undefined,
    adapterVendor: info.vendor,
    adapterArchitecture: info.architecture,
  });
}

function browserGpu(): WebGpuApi | undefined {
  const value = (navigator as Navigator & { readonly gpu?: unknown }).gpu;
  return value === undefined ? undefined : (value as WebGpuApi);
}

function nextAnimationFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function scaleScene(preparation: WebGpuScalePreparation) {
  return Object.freeze({ preparation, overlay: EMPTY_OVERLAY, focusFog: undefined });
}

function outputPoint(
  output: WebGpuScaleReadback,
  logicalIndex: number,
):
  | { readonly position: readonly [number, number, number]; readonly key: readonly number[] }
  | undefined {
  for (let index = 0; index < output.returnedRecordCount; index += 1) {
    const offset = index * 4;
    if (output.stableKeys[offset + 2] !== logicalIndex) {
      continue;
    }
    return {
      position: [
        output.positions[offset] ?? Number.NaN,
        output.positions[offset + 1] ?? Number.NaN,
        output.positions[offset + 2] ?? Number.NaN,
      ],
      key: [
        output.stableKeys[offset] ?? 0,
        output.stableKeys[offset + 1] ?? 0,
        output.stableKeys[offset + 2] ?? 0,
        output.stableKeys[offset + 3] ?? 0,
      ],
    };
  }
  return undefined;
}

async function runGpuFixtures(
  renderer: WebGpuScaleRenderer,
  view: WebGpuScalePreparation["view"],
): Promise<readonly string[]> {
  const diagnostics: string[] = [];
  for (const fixture of WEBGPU_CONFORMANCE_FIXTURES) {
    const contract = createWebGpuScaleContract({
      logicalPopulation: fixture.logicalPopulation,
      seed: fixture.seed,
      generatorVersion: fixture.generatorVersion,
      regionRadiusMeters: fixture.regionRadiusMeters,
    });
    const preparation = prepareWebGpuScale(contract, view);
    renderer.renderScaleNow(scaleScene(preparation), createCameraState(undefined));
    const output = await renderer.readScaleOutput({ maxPoints: preparation.lod.candidateCount });
    for (const expected of fixture.expected) {
      const observed = outputPoint(output, expected.logicalIndex);
      const expectedReference = generateWebGpuReferencePoint(contract, expected.logicalIndex);
      const observedPublicStableId =
        observed !== undefined &&
        observed.key[0] === expected.seedHash &&
        observed.key[1] === expected.seedTextHash
          ? resolveWebGpuStableId(contract, {
              seedHash: observed.key[0],
              seedTextHash: observed.key[1],
              logicalIndex: observed.key[2] ?? expected.logicalIndex,
            })
          : undefined;
      if (
        observed === undefined ||
        observed.key[0] !== expected.seedHash ||
        observed.key[1] !== expected.seedTextHash ||
        observedPublicStableId !== expected.publicStableId ||
        !webGpuPositionMatchesReference(expectedReference, observed.position)
      ) {
        diagnostics.push(`${fixture.id}:${String(expected.logicalIndex)} GPU output mismatch.`);
      }
    }
  }
  return Object.freeze(diagnostics);
}

async function run(): Promise<void> {
  const baseline = defaultWebGpuBenchmarkBaseline();
  const preparation = defaultWebGpuBenchmarkPreparation();
  const gpu = browserGpu();
  const metadata = baseMetadata();
  if (canvas === null) {
    throw new Error("The WebGPU benchmark canvas is missing.");
  }
  const renderErrors: string[] = [];
  const rendererResult = await createWebGpuScaleRenderer(
    {
      gpu,
      canvas: canvas as unknown as WebGpuCanvas,
      requirements: undefined,
      isSecureContext: globalThis.isSecureContext,
    },
    {
      scheduler: undefined,
      onRenderError: (error) => {
        renderErrors.push(error instanceof Error ? error.message : "A GPU frame failed.");
      },
      onDeviceLost: (failure) => {
        renderErrors.push(`${failure.code}: ${failure.detail}`);
      },
    },
  );
  if (!rendererResult.ok) {
    const result = createUnavailableWebGpuBenchmarkResult(
      `${rendererResult.failure.code}: ${rendererResult.failure.detail}`,
      metadata,
      preparation.budget,
      baseline.thresholds,
    );
    show(
      {
        result,
        baseline: compareWebGpuBenchmarkBaseline(result, baseline),
        conformance: {
          fixtureDiagnostics: verifyWebGpuConformanceFixtures(),
          gpuFixtureDiagnostics: [],
        },
      },
      "unavailable",
    );
    return;
  }

  const renderer = rendererResult.renderer;
  try {
    const adapterMetadata = await metadataForAdapter(rendererResult.resources.adapter);
    renderer.resize(1920, 1080, 1);
    const fixtureDiagnostics = verifyWebGpuConformanceFixtures();
    const gpuFixtureDiagnostics = await runGpuFixtures(renderer, preparation.view);
    if (renderErrors.length > 0) {
      throw new Error(renderErrors.join(" "));
    }
    const scene = scaleScene(preparation);
    const generationStartedAt = performance.now();
    renderer.renderScaleNow(scene, createCameraState(undefined));
    const firstOutput = await renderer.readScaleOutput();
    if (firstOutput.visibleCount <= 0) {
      throw new Error("The browser benchmark generated no visible GPU points.");
    }
    const generationLatencyMilliseconds = performance.now() - generationStartedAt;
    if (renderErrors.length > 0) {
      throw new Error(renderErrors.join(" "));
    }
    const frameTimesMilliseconds: number[] = [];
    const gpuFrameTimesMilliseconds: number[] = [];
    let gpuTimingUsable =
      selectWebGpuBenchmarkTimingSource(
        firstOutput.timingSource,
        firstOutput.gpuTimeMilliseconds,
      ) === "gpu-timestamp";
    let previousFrameAt = performance.now();
    let finalOutput = firstOutput;
    for (
      let frame = 0;
      frame < WEBGPU_BENCHMARK_WARMUP_FRAME_COUNT + WEBGPU_BENCHMARK_SAMPLE_FRAME_COUNT;
      frame += 1
    ) {
      const frameAt = await nextAnimationFrame();
      renderer.renderScaleNow(scene, createCameraState(undefined));
      if (gpuTimingUsable) {
        finalOutput = await renderer.readScaleOutput();
        if (
          selectWebGpuBenchmarkTimingSource(
            finalOutput.timingSource,
            finalOutput.gpuTimeMilliseconds,
          ) !== "gpu-timestamp"
        ) {
          gpuTimingUsable = false;
        }
      }
      if (frame >= WEBGPU_BENCHMARK_WARMUP_FRAME_COUNT) {
        frameTimesMilliseconds.push(frameAt - previousFrameAt);
        if (gpuTimingUsable && finalOutput.gpuTimeMilliseconds !== undefined) {
          gpuFrameTimesMilliseconds.push(finalOutput.gpuTimeMilliseconds);
        }
      }
      previousFrameAt = frameAt;
    }
    if (!gpuTimingUsable) {
      finalOutput = await renderer.readScaleOutput();
    }
    if (renderErrors.length > 0) {
      throw new Error(renderErrors.join(" "));
    }
    const timingSource =
      gpuTimingUsable && gpuFrameTimesMilliseconds.length === WEBGPU_BENCHMARK_SAMPLE_FRAME_COUNT
        ? "gpu-timestamp"
        : "request-animation-frame";
    const result = createMeasuredWebGpuBenchmarkResult({
      timingSource,
      warmupFrameCount: WEBGPU_BENCHMARK_WARMUP_FRAME_COUNT,
      sampleFrameCount: WEBGPU_BENCHMARK_SAMPLE_FRAME_COUNT,
      visibleCount: finalOutput.visibleCount,
      generationLatencyMilliseconds,
      frameTimesMilliseconds:
        timingSource === "gpu-timestamp" ? gpuFrameTimesMilliseconds : frameTimesMilliseconds,
      resourceBudget: preparation.budget,
      metadata: adapterMetadata,
      thresholds: baseline.thresholds,
    });
    const comparison = compareWebGpuBenchmarkBaseline(result, baseline);
    show(
      {
        result,
        baseline: comparison,
        conformance: { fixtureDiagnostics, gpuFixtureDiagnostics },
      },
      result.pass &&
        comparison.status === "pass" &&
        fixtureDiagnostics.length === 0 &&
        gpuFixtureDiagnostics.length === 0
        ? "pass"
        : "fail",
    );
  } finally {
    renderer.destroy();
  }
}

void run().catch((error: unknown) => {
  const baseline = defaultWebGpuBenchmarkBaseline();
  const preparation = defaultWebGpuBenchmarkPreparation();
  const reason = error instanceof Error ? error.message : "The browser harness failed.";
  const result = createUnavailableWebGpuBenchmarkResult(
    reason,
    baseMetadata(),
    preparation.budget,
    baseline.thresholds,
  );
  show(
    {
      result,
      baseline: compareWebGpuBenchmarkBaseline(result, baseline),
      conformance: {
        fixtureDiagnostics: verifyWebGpuConformanceFixtures(),
        gpuFixtureDiagnostics: [],
      },
    },
    "unavailable",
  );
});
