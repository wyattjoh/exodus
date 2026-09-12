import {
  compareWebGpuBenchmarkBaseline,
  createUnavailableWebGpuBenchmarkResult,
  defaultWebGpuBenchmarkBaseline,
  defaultWebGpuBenchmarkPreparation,
  verifyWebGpuConformanceFixtures,
  type WebGpuBenchmarkBaseline,
  type WebGpuBenchmarkMetadata,
} from "../src/index";

const REQUIRE_WEBGPU = process.argv.includes("--require-webgpu");
const baseline = (await Bun.file(
  new URL("../docs/benchmarks/webgpu-scale-baseline.json", import.meta.url),
).json()) as WebGpuBenchmarkBaseline;
const expectedBaseline = defaultWebGpuBenchmarkBaseline();
const fixtureDiagnostics = verifyWebGpuConformanceFixtures();
if (
  baseline.benchmarkVersion !== expectedBaseline.benchmarkVersion ||
  baseline.contractVersion !== expectedBaseline.contractVersion ||
  baseline.expectedScene !== expectedBaseline.expectedScene
) {
  throw new Error("The checked-in WebGPU scale baseline does not match the benchmark contract.");
}

const preparationStartedAt = performance.now();
const preparation = defaultWebGpuBenchmarkPreparation();
const preparationMilliseconds = performance.now() - preparationStartedAt;
const metadata: WebGpuBenchmarkMetadata = Object.freeze({
  browser: "Bun CLI",
  browserVersion: Bun.version,
  operatingSystem: process.platform,
  adapterName: undefined,
  adapterVendor: undefined,
  adapterArchitecture: undefined,
  measuredAt: new Date().toISOString(),
});
const result = createUnavailableWebGpuBenchmarkResult(
  "The Bun reference command intentionally has no browser canvas or GPU timing source; use bun run benchmark:webgpu-scale for the local browser harness.",
  metadata,
  preparation.budget,
  baseline.thresholds,
);
const comparison = compareWebGpuBenchmarkBaseline(result, baseline);

console.log(
  JSON.stringify(
    {
      benchmark: "webgpu-scale-reference",
      result,
      baseline: comparison,
      reference: {
        fixtureDiagnostics,
        preparationMilliseconds,
        candidateCount: preparation.lod.candidateCount,
        dispatchWorkgroups: preparation.lod.dispatchWorkgroups,
        resourceBudget: preparation.budget,
      },
    },
    null,
    2,
  ),
);

if (REQUIRE_WEBGPU) {
  process.exitCode = 2;
}
