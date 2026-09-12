import { describe, expect, test } from "bun:test";

import {
  DEFAULT_WEBGPU_BENCHMARK_THRESHOLDS,
  WEBGPU_CLUSTER_CONFORMANCE_VERSION,
  WEBGPU_SCALE_WORKGROUP_SIZE,
  compareWebGpuBenchmarkBaseline,
  createMeasuredWebGpuBenchmarkResult,
  createUnavailableWebGpuBenchmarkResult,
  createWebGpuResourceBudget,
  createWebGpuScaleContract,
  describeWebGpuResourceMemory,
  cullWebGpuReferencePoints,
  defaultWebGpuBenchmarkBaseline,
  extractWebGpuFrustumPlanes,
  generateWebGpuReferencePoint,
  hashWebGpuLogicalPoint,
  prepareWebGpuScale,
  resolveWebGpuStableId,
  selectWebGpuLod,
  summarizeWebGpuFrameTimes,
  webGpuPositionMatchesReference,
  MAX_WEBGPU_VISIBLE_POINTS,
  WEBGPU_POINT_STRIDE_BYTES,
} from "../src/webgpu-scale";
import { generateClusterRegion } from "../src/index";

const identityView = Object.freeze({
  viewProjectionMatrix: Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  viewportWidth: 1920,
  viewportHeight: 1080,
  cameraDistance: 3.2,
  far: 100,
});

const metadata = Object.freeze({
  browser: "test-browser",
  browserVersion: "0",
  operatingSystem: "test-os",
  adapterName: undefined,
  adapterVendor: undefined,
  adapterArchitecture: undefined,
  measuredAt: "2026-09-12T00:00:00.000Z",
});
const machine = Object.freeze({
  model: "test-model",
  chip: "test-chip",
  memory: "1 GiB",
  operatingSystem: "test-os",
  hostGraphicsApi: Object.freeze({ name: undefined, version: undefined }),
});

describe("bounded WebGPU scale contract", () => {
  test("preserves seed type, exact text, identity, and version without CPU generator drift", () => {
    const numeric = createWebGpuScaleContract({
      logicalPopulation: 32,
      seed: 1,
      generatorVersion: "globular-v1",
      regionRadiusMeters: 5e17,
    });
    const textual = createWebGpuScaleContract({
      logicalPopulation: 32,
      seed: " 1 ",
      generatorVersion: "globular-v1",
      regionRadiusMeters: 5e17,
    });

    expect(numeric.contractVersion).toBe(WEBGPU_CLUSTER_CONFORMANCE_VERSION);
    expect(numeric.seedType).toBe("number");
    expect(numeric.seedText).toBe("1");
    expect(textual.seedType).toBe("string");
    expect(textual.seedText).toBe(" 1 ");
    expect(textual.seedIdentity).toBe("string:3: 1 ");
    expect(numeric.seedIdentity).not.toBe(textual.seedIdentity);
    expect(hashWebGpuLogicalPoint(numeric, 0)).not.toBe(hashWebGpuLogicalPoint(textual, 0));
  });

  test("matches the independent f32 fixture values and exact generated public identity", () => {
    const contract = createWebGpuScaleContract({
      logicalPopulation: 64,
      seed: "fixture-seed",
      generatorVersion: "globular-v1",
      regionRadiusMeters: 5e17,
    });
    const point = generateWebGpuReferencePoint(contract, 7);
    const generated = generateClusterRegion({
      logicalPopulation: 64,
      materializedSystemCount: 8,
      seed: "fixture-seed",
      generatorVersion: "globular-v1",
    });

    const generatedSystem = generated.generatedSystems[7];
    if (generatedSystem === undefined) {
      throw new Error("Expected generated fixture System 7.");
    }
    expect(point.publicStableId).toBe(generatedSystem.id);
    expect(point.stableKey).toEqual({
      seedHash: 2041145057,
      seedTextHash: 3001471093,
      logicalIndex: 7,
    });
    expect(point.normalizedPosition).toEqual([
      -0.674728274345398, 0.3379472494125366, 0.5492298603057861,
    ]);
  });

  test("rejects logical populations and radii that cannot be represented by GPU values", () => {
    expect(() =>
      createWebGpuScaleContract({
        logicalPopulation: 0x1_0000_0000,
        seed: "too-large",
        generatorVersion: "globular-v1",
        regionRadiusMeters: 5e17,
      }),
    ).toThrow("WGSL u32");
    expect(() =>
      createWebGpuScaleContract({
        logicalPopulation: 64,
        seed: "too-large-for-f32-radius",
        generatorVersion: "globular-v1",
        regionRadiusMeters: Number.MAX_VALUE,
      }),
    ).toThrow("finite f32");
  });

  test("selects a bounded integer LOD and never schedules more than one million outputs", () => {
    const contract = createWebGpuScaleContract({
      logicalPopulation: 10_000_000,
      seed: "million",
      generatorVersion: "globular-v1",
      regionRadiusMeters: 5e17,
    });
    const lod = selectWebGpuLod(contract, identityView);
    expect(lod.candidateCount).toBeLessThanOrEqual(MAX_WEBGPU_VISIBLE_POINTS);
    expect(lod.visibleCapacity).toBe(MAX_WEBGPU_VISIBLE_POINTS);
    expect(lod.dispatchWorkgroups).toBe(
      Math.ceil(lod.candidateCount / WEBGPU_SCALE_WORKGROUP_SIZE),
    );
    expect(lod.range).toEqual({
      logicalStart: 0,
      logicalCount: 10_000_000,
      logicalStride: 10,
    });
    expect(prepareWebGpuScale(contract, identityView).budget.pointBufferBytes).toBe(
      MAX_WEBGPU_VISIBLE_POINTS * WEBGPU_POINT_STRIDE_BYTES,
    );
  });

  test("derives detail from the supplied projection matrix rather than viewport alone", () => {
    const contract = createWebGpuScaleContract({
      logicalPopulation: 10_000,
      seed: "projection-lod",
      generatorVersion: "globular-v1",
      regionRadiusMeters: 5e17,
    });
    const wideProjection = Object.freeze({
      ...identityView,
      viewProjectionMatrix: Object.freeze([
        0.01, 0, 0, 0, 0, 0.01, 0, 0, 0, 0, 0.01, 0, 0, 0, 0, 1,
      ]),
    });
    const closeProjection = Object.freeze({
      ...identityView,
      viewProjectionMatrix: Object.freeze([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]),
    });
    const wide = selectWebGpuLod(contract, wideProjection);
    const close = selectWebGpuLod(contract, closeProjection);
    expect(wide.range.logicalStride).toBeGreaterThan(close.range.logicalStride);
    expect(wide.candidateCount).toBeLessThan(close.candidateCount);
  });

  test("culls into a bounded typed index buffer without point-object materialization", () => {
    const contract = createWebGpuScaleContract({
      logicalPopulation: 4,
      seed: "cull",
      generatorVersion: "globular-v1",
      regionRadiusMeters: 5e17,
    });
    const lod = selectWebGpuLod(contract, identityView, 4);
    const culling = cullWebGpuReferencePoints(contract, lod, [
      [1, 0, 0, 1],
      [-1, 0, 0, 1],
      [0, 1, 0, 1],
      [0, -1, 0, 1],
      [0, 0, 1, 1],
      [0, 0, -1, 1],
    ]);
    expect(culling.logicalIndices).toBeInstanceOf(Uint32Array);
    expect(culling.logicalIndices.length).toBe(culling.visibleCount);
    expect(culling.visibleCount).toBeGreaterThan(0);
    expect(culling.visibleCount).toBeLessThanOrEqual(4);
  });

  test("accounts for aligned bounded resources", () => {
    const budget = createWebGpuResourceBudget({
      candidateCount: 1_000_000,
      visibleCapacity: 1_000_000,
      seedCodeUnitCount: 64,
      maxBufferSize: 64 * 1024 * 1024,
    });
    expect(budget.pointBufferBytes).toBe(32_000_000);
    expect(budget.totalBufferBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(budget.dispatchWorkgroups).toBe(15_625);
    expect(describeWebGpuResourceMemory(budget)).toMatchObject({
      unit: "bytes",
      pointBufferFormula: "visibleCapacity × pointStrideBytes",
      totalBufferFormula:
        "pointBufferBytes + indirectBufferBytes + uniformBufferBytes + seedBufferBytes",
      pointBufferBytes: 32_000_000,
      seedBufferBytes: 256,
      totalBufferBytes: 32_000_528,
      hardAllocationCapBytes: 32_016_656,
      deviceMaxBufferSizeBytes: 64 * 1024 * 1024,
    });
  });

  test("summarizes frame windows and compares deterministic baseline data", () => {
    const frameTimes = summarizeWebGpuFrameTimes([10, 12, 14, 16, 18]);
    expect(frameTimes).toMatchObject({
      p50Milliseconds: 14,
      p95Milliseconds: 16,
      p99Milliseconds: 16,
      averageFps: 71.42857142857143,
      fpsAtP95: 62.5,
    });
    const result = createMeasuredWebGpuBenchmarkResult({
      timingSource: "request-animation-frame",
      warmupFrameCount: 5,
      sampleFrameCount: 5,
      visibleCount: 1_000_000,
      generationLatencyMilliseconds: 10,
      frameTimesMilliseconds: [17, 17, 17, 18, 18],
      resourceBudget: createWebGpuResourceBudget({
        candidateCount: 1_000_000,
        visibleCapacity: 1_000_000,
        seedCodeUnitCount: 64,
        maxBufferSize: 64 * 1024 * 1024,
      }),
      metadata,
    });
    expect(result.pass).toBe(false);
    expect(result.diagnostics[0]).toContain("sustained average FPS");
    expect(() =>
      createMeasuredWebGpuBenchmarkResult({
        timingSource: "request-animation-frame",
        warmupFrameCount: 1,
        sampleFrameCount: 2,
        visibleCount: 1_000_000,
        generationLatencyMilliseconds: 1,
        frameTimesMilliseconds: [10],
        resourceBudget: result.resourceBudget,
        metadata,
      }),
    ).toThrow("match sampleFrameCount");
    expect(compareWebGpuBenchmarkBaseline(result, defaultWebGpuBenchmarkBaseline()).status).toBe(
      "fail",
    );
    expect(DEFAULT_WEBGPU_BENCHMARK_THRESHOLDS.targetVisiblePoints).toBe(1_000_000);
    expect(DEFAULT_WEBGPU_BENCHMARK_THRESHOLDS.minimumSustainedFps).toBe(59.5);
  });

  test("accepts rAF cadence near 60 FPS while retaining p95 display jitter", () => {
    const budget = createWebGpuResourceBudget({
      candidateCount: 1_000_000,
      visibleCapacity: 1_000_000,
      seedCodeUnitCount: 64,
      maxBufferSize: 64 * 1024 * 1024,
    });
    const result = createMeasuredWebGpuBenchmarkResult({
      timingSource: "request-animation-frame",
      warmupFrameCount: 30,
      sampleFrameCount: 20,
      visibleCount: 1_000_000,
      generationLatencyMilliseconds: 10,
      frameTimesMilliseconds: [...Array.from({ length: 18 }, () => 16.67), 18, 18],
      resourceBudget: budget,
      metadata,
    });
    expect(result.pass).toBe(true);
    expect(result.frameTimes?.p95Milliseconds).toBe(18);
    expect(result.frameTimes?.averageFps).toBeGreaterThanOrEqual(59.5);
    expect(result.diagnostics).toHaveLength(0);
  });

  test("keeps unavailable hardware explicit while validating the baseline schema", () => {
    const result = createUnavailableWebGpuBenchmarkResult(
      "No local browser CDP endpoint was provided.",
      metadata,
      createWebGpuResourceBudget({
        candidateCount: 1_000_000,
        visibleCapacity: 1_000_000,
        seedCodeUnitCount: 64,
        maxBufferSize: 64 * 1024 * 1024,
      }),
    );
    const comparison = compareWebGpuBenchmarkBaseline(result, defaultWebGpuBenchmarkBaseline());
    expect(result.status).toBe("unavailable");
    expect(result.visibleCount).toBeUndefined();
    expect(comparison.status).toBe("unavailable");
    expect(comparison.diagnostics[0]).toContain("No local browser");
  });

  test("compares measured baseline improvements, regressions, incompatibility, and unavailable runs", () => {
    const budget = createWebGpuResourceBudget({
      candidateCount: 1_000_000,
      visibleCapacity: 1_000_000,
      seedCodeUnitCount: 64,
      maxBufferSize: 64 * 1024 * 1024,
    });
    const makeResult = (overrides: { readonly latency?: number; readonly browser?: string } = {}) =>
      createMeasuredWebGpuBenchmarkResult({
        timingSource: "request-animation-frame",
        warmupFrameCount: 30,
        sampleFrameCount: 2,
        visibleCount: 1_000_000,
        generationLatencyMilliseconds: overrides.latency ?? 10,
        frameTimesMilliseconds: [10, 10],
        resourceBudget: budget,
        metadata: Object.freeze({ ...metadata, browser: overrides.browser ?? metadata.browser }),
      });
    const measuredBaseline = Object.freeze({
      ...defaultWebGpuBenchmarkBaseline(),
      measuredBaseline: Object.freeze({
        benchmarkVersion: "webgpu-million-points-v1" as const,
        contractVersion: WEBGPU_CLUSTER_CONFORMANCE_VERSION,
        scene: "million-visible-star-points" as const,
        metadata,
        machine,
        timingSource: "request-animation-frame" as const,
        warmupFrameCount: 30,
        sampleFrameCount: 2,
        visibleCount: 1_000_000,
        generationLatencyMilliseconds: 10,
        frameTimes: summarizeWebGpuFrameTimes([10, 10]),
        pass: true,
        resourceBudget: budget,
        resourceSemantics: {
          unit: "bytes" as const,
          scope:
            "GPU buffer allocations only; excludes browser process and driver allocations" as const,
          pointBufferFormula: "visibleCapacity × pointStrideBytes" as const,
          totalBufferFormula:
            "pointBufferBytes + indirectBufferBytes + uniformBufferBytes + seedBufferBytes" as const,
          pointBufferBytes: budget.pointBufferBytes,
          indirectBufferBytes: budget.indirectBufferBytes,
          uniformBufferBytes: budget.uniformBufferBytes,
          seedBufferBytes: budget.seedBufferBytes,
          totalBufferBytes: budget.totalBufferBytes,
          hardAllocationCapBytes: 32_016_656,
          deviceMaxBufferSizeBytes: budget.maxBufferSize,
        },
        resourceBytes: budget.totalBufferBytes,
      }),
    });
    expect(
      compareWebGpuBenchmarkBaseline(makeResult({ latency: 5 }), measuredBaseline, machine).status,
    ).toBe("pass");
    const regression = compareWebGpuBenchmarkBaseline(
      makeResult({ latency: 25 }),
      measuredBaseline,
      machine,
    );
    expect(regression.status).toBe("fail");
    expect(
      regression.regressions.some((value) => value.includes("generation latency regressed")),
    ).toBe(true);
    const incompatible = compareWebGpuBenchmarkBaseline(
      makeResult({ browser: "different-browser" }),
      measuredBaseline,
      machine,
    );
    expect(incompatible.status).toBe("fail");
    expect(incompatible.diagnostics).toContain("measured baseline browser is incompatible");
    const unavailable = createUnavailableWebGpuBenchmarkResult(
      "browser-webgpu-unavailable: no adapter",
      metadata,
      budget,
    );
    expect(compareWebGpuBenchmarkBaseline(unavailable, measuredBaseline, machine).status).toBe(
      "unavailable",
    );
  });

  test("accepts GPU f32 positions within the documented tolerance", () => {
    const contract = createWebGpuScaleContract({
      logicalPopulation: 8,
      seed: "tolerance",
      generatorVersion: "globular-v1",
      regionRadiusMeters: 5e17,
    });
    const expected = generateWebGpuReferencePoint(contract, 2);
    expect(
      webGpuPositionMatchesReference(expected, [
        expected.normalizedPosition[0] + 1e-6,
        expected.normalizedPosition[1] - 1e-6,
        expected.normalizedPosition[2],
      ]),
    ).toBe(true);
    expect(extractWebGpuFrustumPlanes(identityView.viewProjectionMatrix)).toHaveLength(6);
    expect(resolveWebGpuStableId(contract, expected.stableKey)).toBe(expected.publicStableId);
  });
});
