import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  compareWebGpuBenchmarkBaseline,
  createUnavailableWebGpuBenchmarkResult,
  defaultWebGpuBenchmarkBaseline,
  defaultWebGpuBenchmarkPreparation,
  describeWebGpuResourceMemory,
  evaluateWebGpuBenchmark,
  MAX_WEBGPU_SCALE_BUFFER_BYTES,
  MAX_WEBGPU_VISIBLE_POINTS,
  WEBGPU_CLUSTER_CONFORMANCE_VERSION,
  WEBGPU_POINT_STRIDE_BYTES,
  WEBGPU_SCALE_BENCHMARK_VERSION,
  WEBGPU_SCALE_WORKGROUP_SIZE,
  verifyWebGpuConformanceFixtures,
  WEBGPU_BENCHMARK_SAMPLE_FRAME_COUNT,
  WEBGPU_BENCHMARK_WARMUP_FRAME_COUNT,
  type WebGpuBenchmarkBaseline,
  type WebGpuBenchmarkComparison,
  type WebGpuBenchmarkMachine,
  type WebGpuBenchmarkMetadata,
  type WebGpuBenchmarkResult,
  type WebGpuMeasuredBenchmarkBaseline,
  type WebGpuResourceBudget,
} from "../src/index";
import {
  detectWebGpuHostMachine,
  discoverWebGpuBrowser,
  executableVersion,
  cleanupWebGpuProcess,
  runBoundedWebGpuCommand,
  terminateWebGpuProcess,
  waitForProcessExit,
  webGpuProcessTerminationFailure,
  type WebGpuProcess,
  type WebGpuProcessCleanupOptions,
} from "./webgpu-scale-environment";

/**
 * The terminal state reported by the production benchmark page.
 */
export type WebGpuBenchmarkTerminalState = "pass" | "fail" | "unavailable";

/**
 * The local-driver outcome classification used to distinguish environment failures.
 */
export type WebGpuBenchmarkDriverStatus =
  | "measured"
  | "browser-webgpu-unavailable"
  | "browser-missing"
  | "automation-unavailable";

/**
 * The JSON envelope rendered by `webgpu-scale-benchmark.html`.
 */
export type WebGpuBenchmarkPageOutput = {
  readonly result: WebGpuBenchmarkResult;
  readonly baseline: unknown;
  readonly conformance: unknown;
};

type JsonRecord = Record<string, unknown>;

const CANONICAL_BENCHMARK_BASELINE = defaultWebGpuBenchmarkBaseline();
const CANONICAL_THRESHOLDS = CANONICAL_BENCHMARK_BASELINE.thresholds;
const CANONICAL_RESOURCE_BUDGET = defaultWebGpuBenchmarkPreparation().budget;

const RESOURCE_BUDGET_FIELDS = [
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

type CdpTarget = {
  readonly type?: unknown;
  readonly url?: unknown;
  readonly webSocketDebuggerUrl?: unknown;
};

type CdpReply = {
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly message?: unknown };
};

type CdpPending = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_CDP_OPERATION_TIMEOUT_MS = 10_000;
const REQUIRE_WEBGPU = process.argv.includes("--require-webgpu");

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonRecord;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function exactObjectKeys(value: JsonRecord, keys: readonly string[], label: string): void {
  const observed = Object.keys(value);
  if (observed.length !== keys.length || keys.some((key) => !observed.includes(key))) {
    throw new Error(`${label} must contain exactly the canonical fields.`);
  }
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    throw new Error(`${label} must be a non-empty-string array.`);
  }
  return value as readonly string[];
}

function validateMetadata(value: unknown, label: string): void {
  const metadata = record(value, label);
  const allowed = [
    "browser",
    "browserVersion",
    "operatingSystem",
    "adapterName",
    "adapterVendor",
    "adapterArchitecture",
    "measuredAt",
  ];
  const observed = Object.keys(metadata);
  if (observed.some((key) => !allowed.includes(key))) {
    throw new Error(`${label} contains an unknown field.`);
  }
  nonEmptyString(metadata.browser, `${label}.browser`);
  nonEmptyString(metadata.browserVersion, `${label}.browserVersion`);
  nonEmptyString(metadata.operatingSystem, `${label}.operatingSystem`);
  const measuredAt = nonEmptyString(metadata.measuredAt, `${label}.measuredAt`);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(measuredAt) ||
    !Number.isFinite(Date.parse(measuredAt))
  ) {
    throw new Error(`${label}.measuredAt must be an ISO date.`);
  }
  for (const key of ["adapterName", "adapterVendor", "adapterArchitecture"]) {
    if (metadata[key] !== undefined) {
      nonEmptyString(metadata[key], `${label}.${key}`);
    }
  }
}

function validateCanonicalThresholds(value: unknown, label = "result.thresholds"): void {
  const thresholds = record(value, label);
  const keys = Object.keys(CANONICAL_THRESHOLDS);
  exactObjectKeys(thresholds, keys, label);
  for (const key of keys) {
    if (thresholds[key] !== CANONICAL_THRESHOLDS[key as keyof typeof CANONICAL_THRESHOLDS]) {
      throw new Error(`${label} must equal the canonical benchmark thresholds.`);
    }
  }
}

function validateResourceBudget(value: unknown, label = "result.resourceBudget"): void {
  const resourceBudget = record(value, label);
  exactObjectKeys(resourceBudget, RESOURCE_BUDGET_FIELDS, label);
  const budgetValues = {} as Record<(typeof RESOURCE_BUDGET_FIELDS)[number], number>;
  for (const key of RESOURCE_BUDGET_FIELDS) {
    budgetValues[key] = positiveInteger(resourceBudget[key], `${label}.${key}`);
  }
  for (const key of RESOURCE_BUDGET_FIELDS) {
    if (budgetValues[key] !== CANONICAL_RESOURCE_BUDGET[key as keyof WebGpuResourceBudget]) {
      throw new Error(`${label} does not match the canonical GPU resource shape.`);
    }
  }
  if (budgetValues.totalBufferBytes > budgetValues.maxBufferSize) {
    throw new Error(`${label} exceeds maxBufferSize.`);
  }
  if (budgetValues.totalBufferBytes > MAX_WEBGPU_SCALE_BUFFER_BYTES) {
    throw new Error(`${label} exceeds the hard GPU allocation cap.`);
  }
  if (
    budgetValues.pointBufferBytes !==
    budgetValues.visibleCapacity * budgetValues.pointStrideBytes
  ) {
    throw new Error(`${label}.pointBufferBytes has invalid calculated semantics.`);
  }
  if (
    budgetValues.totalBufferBytes !==
    budgetValues.pointBufferBytes +
      budgetValues.indirectBufferBytes +
      budgetValues.uniformBufferBytes +
      budgetValues.seedBufferBytes
  ) {
    throw new Error(`${label}.totalBufferBytes has invalid calculated semantics.`);
  }
  const calculated = describeWebGpuResourceMemory(
    resourceBudget as unknown as WebGpuResourceBudget,
  );
  if (
    calculated.totalBufferBytes !== budgetValues.totalBufferBytes ||
    calculated.pointBufferBytes !== budgetValues.pointBufferBytes
  ) {
    throw new Error(`${label} has invalid calculated semantics.`);
  }
}

function validateFrameTimes(value: unknown, label = "result.frameTimes"): void {
  const frameTimes = record(value, label);
  exactObjectKeys(
    frameTimes,
    [
      "p50Milliseconds",
      "p95Milliseconds",
      "p99Milliseconds",
      "maximumMilliseconds",
      "averageMilliseconds",
      "averageFps",
      "fpsAtP95",
    ],
    label,
  );
  const values = {} as Record<
    | "p50Milliseconds"
    | "p95Milliseconds"
    | "p99Milliseconds"
    | "maximumMilliseconds"
    | "averageMilliseconds"
    | "averageFps"
    | "fpsAtP95",
    number
  >;
  for (const key of [
    "p50Milliseconds",
    "p95Milliseconds",
    "p99Milliseconds",
    "maximumMilliseconds",
    "averageMilliseconds",
    "averageFps",
    "fpsAtP95",
  ] as const) {
    const number = frameTimes[key];
    if (typeof number !== "number" || !Number.isFinite(number) || number <= 0) {
      throw new Error(`${label}.${key} must be finite and positive.`);
    }
    values[key] = number;
  }
  if (
    values.p50Milliseconds > values.p95Milliseconds ||
    values.p95Milliseconds > values.p99Milliseconds ||
    values.p99Milliseconds > values.maximumMilliseconds
  ) {
    throw new Error(`${label} percentiles are not monotonic.`);
  }
  const averageFps = 1_000 / values.averageMilliseconds;
  const fpsAtP95 = 1_000 / values.p95Milliseconds;
  const tolerance = (expected: number): number => Math.max(1e-9, Math.abs(expected) * 1e-9);
  if (
    Math.abs(values.averageFps - averageFps) > tolerance(averageFps) ||
    Math.abs(values.fpsAtP95 - fpsAtP95) > tolerance(fpsAtP95)
  ) {
    throw new Error(`${label} FPS fields do not match the reported frame times.`);
  }
}

function validateMachine(value: unknown, label: string): void {
  const machine = record(value, label);
  exactObjectKeys(
    machine,
    ["model", "chip", "memory", "operatingSystem", "hostGraphicsApi"],
    label,
  );
  for (const key of ["model", "chip", "memory", "operatingSystem"]) {
    nonEmptyString(machine[key], `${label}.${key}`);
  }
  const graphics = record(machine.hostGraphicsApi, `${label}.hostGraphicsApi`);
  const graphicsKeys = ["name", "version"];
  if (Object.keys(graphics).some((key) => !graphicsKeys.includes(key))) {
    throw new Error(`${label}.hostGraphicsApi contains an unknown field.`);
  }
  for (const key of graphicsKeys) {
    if (graphics[key] !== undefined) {
      nonEmptyString(graphics[key], `${label}.hostGraphicsApi.${key}`);
    }
  }
}

function validateResourceSemantics(
  value: unknown,
  resourceBudget: JsonRecord,
  label: string,
): void {
  const semantics = record(value, label);
  const fields = [
    "unit",
    "scope",
    "pointBufferFormula",
    "totalBufferFormula",
    "pointBufferBytes",
    "indirectBufferBytes",
    "uniformBufferBytes",
    "seedBufferBytes",
    "totalBufferBytes",
    "hardAllocationCapBytes",
    "deviceMaxBufferSizeBytes",
  ] as const;
  exactObjectKeys(semantics, fields, label);
  const calculated = describeWebGpuResourceMemory(
    resourceBudget as unknown as WebGpuResourceBudget,
  );
  for (const field of fields) {
    if (semantics[field] !== calculated[field]) {
      throw new Error(`${label} does not match calculated GPU resource semantics.`);
    }
  }
}

function validateMeasuredBaseline(value: unknown, label = "measured baseline"): void {
  const baseline = record(value, label);
  exactObjectKeys(
    baseline,
    [
      "benchmarkVersion",
      "contractVersion",
      "scene",
      "metadata",
      "machine",
      "timingSource",
      "warmupFrameCount",
      "sampleFrameCount",
      "visibleCount",
      "generationLatencyMilliseconds",
      "frameTimes",
      "pass",
      "resourceBudget",
      "resourceSemantics",
      "resourceBytes",
    ],
    label,
  );
  if (baseline.benchmarkVersion !== WEBGPU_SCALE_BENCHMARK_VERSION) {
    throw new Error(`${label}.benchmarkVersion does not match the benchmark contract.`);
  }
  if (baseline.contractVersion !== WEBGPU_CLUSTER_CONFORMANCE_VERSION) {
    throw new Error(`${label}.contractVersion does not match the benchmark contract.`);
  }
  if (baseline.scene !== "million-visible-star-points") {
    throw new Error(`${label}.scene does not match the benchmark target.`);
  }
  validateMetadata(baseline.metadata, `${label}.metadata`);
  validateMachine(baseline.machine, `${label}.machine`);
  if (
    baseline.timingSource !== "gpu-timestamp" &&
    baseline.timingSource !== "request-animation-frame"
  ) {
    throw new Error(`${label}.timingSource is invalid.`);
  }
  if (baseline.warmupFrameCount !== WEBGPU_BENCHMARK_WARMUP_FRAME_COUNT) {
    throw new Error(
      `${label}.warmupFrameCount must be exactly ${String(WEBGPU_BENCHMARK_WARMUP_FRAME_COUNT)}.`,
    );
  }
  if (baseline.sampleFrameCount !== WEBGPU_BENCHMARK_SAMPLE_FRAME_COUNT) {
    throw new Error(
      `${label}.sampleFrameCount must be exactly ${String(WEBGPU_BENCHMARK_SAMPLE_FRAME_COUNT)}.`,
    );
  }
  if (
    positiveInteger(baseline.visibleCount, `${label}.visibleCount`) !== MAX_WEBGPU_VISIBLE_POINTS
  ) {
    throw new Error(`${label}.visibleCount must equal the benchmark target.`);
  }
  if (
    typeof baseline.generationLatencyMilliseconds !== "number" ||
    !Number.isFinite(baseline.generationLatencyMilliseconds) ||
    baseline.generationLatencyMilliseconds < 0
  ) {
    throw new Error(`${label}.generationLatencyMilliseconds must be finite and non-negative.`);
  }
  validateFrameTimes(baseline.frameTimes, `${label}.frameTimes`);
  if (baseline.pass !== true) {
    throw new Error(`${label}.pass must be true for a compatible measured baseline.`);
  }
  validateResourceBudget(baseline.resourceBudget, `${label}.resourceBudget`);
  const resourceBudget = record(baseline.resourceBudget, `${label}.resourceBudget`);
  validateResourceSemantics(
    baseline.resourceSemantics,
    resourceBudget,
    `${label}.resourceSemantics`,
  );
  if (
    positiveInteger(baseline.resourceBytes, `${label}.resourceBytes`) !==
    resourceBudget.totalBufferBytes
  ) {
    throw new Error(`${label}.resourceBytes must equal resourceBudget.totalBufferBytes.`);
  }
  const measuredBaseline = baseline as unknown as WebGpuMeasuredBenchmarkBaseline;
  const evaluated = evaluateWebGpuBenchmark({
    benchmarkVersion: measuredBaseline.benchmarkVersion,
    contractVersion: measuredBaseline.contractVersion,
    scene: measuredBaseline.scene,
    status: "measured",
    unavailableReason: undefined,
    timingSource: measuredBaseline.timingSource,
    warmupFrameCount: measuredBaseline.warmupFrameCount,
    sampleFrameCount: measuredBaseline.sampleFrameCount,
    visibleCount: measuredBaseline.visibleCount,
    generationLatencyMilliseconds: measuredBaseline.generationLatencyMilliseconds,
    frameTimes: measuredBaseline.frameTimes,
    resourceBudget: measuredBaseline.resourceBudget,
    metadata: measuredBaseline.metadata,
    thresholds: CANONICAL_THRESHOLDS,
  });
  if (!evaluated.pass || baseline.pass !== evaluated.pass) {
    throw new Error(`${label}.pass and metrics must satisfy canonical benchmark acceptance.`);
  }
}

function validateTrustedBaseline(
  value: unknown,
  label = "loaded benchmark baseline",
): WebGpuBenchmarkBaseline {
  const baseline = record(value, label);
  const required = ["benchmarkVersion", "contractVersion", "thresholds", "expectedScene", "note"];
  const allowed = [...required, "measuredBaseline"];
  const observed = Object.keys(baseline);
  if (
    observed.some((key) => !allowed.includes(key)) ||
    required.some((key) => !observed.includes(key))
  ) {
    throw new Error(`${label} must contain the complete canonical fields.`);
  }
  if (baseline.benchmarkVersion !== WEBGPU_SCALE_BENCHMARK_VERSION) {
    throw new Error(`${label}.benchmarkVersion does not match the benchmark contract.`);
  }
  if (baseline.contractVersion !== WEBGPU_CLUSTER_CONFORMANCE_VERSION) {
    throw new Error(`${label}.contractVersion does not match the benchmark contract.`);
  }
  if (baseline.expectedScene !== "million-visible-star-points") {
    throw new Error(`${label}.expectedScene does not match the benchmark target.`);
  }
  validateCanonicalThresholds(baseline.thresholds, `${label}.thresholds`);
  nonEmptyString(baseline.note, `${label}.note`);
  if (Object.prototype.hasOwnProperty.call(baseline, "measuredBaseline")) {
    if (baseline.measuredBaseline === undefined) {
      throw new Error(`${label}.measuredBaseline must be complete when present.`);
    }
    validateMeasuredBaseline(baseline.measuredBaseline, `${label}.measuredBaseline`);
  }
  return baseline as unknown as WebGpuBenchmarkBaseline;
}

function resultDiagnostics(result: JsonRecord): readonly string[] {
  return stringArray(result.diagnostics, "result.diagnostics");
}

function measuredResultShape(result: JsonRecord): void {
  exactObjectKeys(
    result,
    [
      "benchmarkVersion",
      "contractVersion",
      "scene",
      "status",
      "timingSource",
      "warmupFrameCount",
      "sampleFrameCount",
      "visibleCount",
      "generationLatencyMilliseconds",
      "frameTimes",
      "resourceBudget",
      "metadata",
      "thresholds",
      "pass",
      "diagnostics",
    ],
    "measured result",
  );
  if (result.warmupFrameCount !== WEBGPU_BENCHMARK_WARMUP_FRAME_COUNT) {
    throw new Error(
      `result.warmupFrameCount must be exactly ${String(WEBGPU_BENCHMARK_WARMUP_FRAME_COUNT)}.`,
    );
  }
  if (result.sampleFrameCount !== WEBGPU_BENCHMARK_SAMPLE_FRAME_COUNT) {
    throw new Error(
      `result.sampleFrameCount must be exactly ${String(WEBGPU_BENCHMARK_SAMPLE_FRAME_COUNT)}.`,
    );
  }
  const visibleCount = positiveInteger(result.visibleCount, "result.visibleCount");
  if (visibleCount !== MAX_WEBGPU_VISIBLE_POINTS) {
    throw new Error(
      `result.visibleCount must equal the ${String(MAX_WEBGPU_VISIBLE_POINTS)}-point benchmark target.`,
    );
  }
  if (
    typeof result.generationLatencyMilliseconds !== "number" ||
    !Number.isFinite(result.generationLatencyMilliseconds) ||
    result.generationLatencyMilliseconds < 0
  ) {
    throw new Error("result.generationLatencyMilliseconds must be finite and non-negative.");
  }
  validateMetadata(result.metadata, "result.metadata");
  validateResourceBudget(result.resourceBudget);
  validateCanonicalThresholds(result.thresholds);
  validateFrameTimes(result.frameTimes);
  if (
    result.timingSource !== "gpu-timestamp" &&
    result.timingSource !== "request-animation-frame"
  ) {
    throw new Error("result.timingSource must be gpu-timestamp or request-animation-frame.");
  }
  if (result.pass !== true && result.pass !== false) {
    throw new Error("result.pass must be boolean.");
  }
  const diagnostics = resultDiagnostics(result);
  const evaluated = evaluateWebGpuBenchmark(
    result as unknown as Omit<WebGpuBenchmarkResult, "pass" | "diagnostics">,
  );
  if (
    result.pass !== evaluated.pass ||
    JSON.stringify(diagnostics) !== JSON.stringify(evaluated.diagnostics)
  ) {
    throw new Error("result.pass and diagnostics do not match canonical metric evaluation.");
  }
}

function unavailableResultShape(result: JsonRecord): void {
  exactObjectKeys(
    result,
    [
      "benchmarkVersion",
      "contractVersion",
      "scene",
      "status",
      "unavailableReason",
      "warmupFrameCount",
      "sampleFrameCount",
      "resourceBudget",
      "metadata",
      "thresholds",
      "pass",
      "diagnostics",
    ],
    "unavailable result",
  );
  nonEmptyString(result.unavailableReason, "result.unavailableReason");
  if (result.warmupFrameCount !== 0 || result.sampleFrameCount !== 0) {
    throw new Error("an unavailable benchmark must not report measured frames.");
  }
  validateMetadata(result.metadata, "result.metadata");
  validateResourceBudget(result.resourceBudget);
  validateCanonicalThresholds(result.thresholds);
  if (result.pass !== false) {
    throw new Error("an unavailable benchmark must have result.pass=false.");
  }
  const diagnostics = resultDiagnostics(result);
  const evaluated = evaluateWebGpuBenchmark(
    result as unknown as Omit<WebGpuBenchmarkResult, "pass" | "diagnostics">,
  );
  if (JSON.stringify(diagnostics) !== JSON.stringify(evaluated.diagnostics)) {
    throw new Error("unavailable result diagnostics do not match its reason.");
  }
}

type ValidatedBenchmarkBaseline = {
  readonly page: JsonRecord;
  readonly authoritative: WebGpuBenchmarkComparison;
};

function validateBaseline(
  value: unknown,
  result: JsonRecord,
  trustedBaseline: WebGpuBenchmarkBaseline,
  machine: WebGpuBenchmarkMachine | undefined,
  browserVersion: string | undefined,
): ValidatedBenchmarkBaseline {
  const resultStatus = result.status as "measured" | "unavailable";
  const baseline = record(value, "benchmark page baseline");
  exactObjectKeys(baseline, ["status", "regressions", "diagnostics"], "benchmark page baseline");
  if (
    baseline.status !== "pass" &&
    baseline.status !== "fail" &&
    baseline.status !== "unavailable"
  ) {
    throw new Error("benchmark page baseline.status is invalid.");
  }
  const regressions = stringArray(baseline.regressions, "benchmark page baseline.regressions");
  const diagnostics = stringArray(baseline.diagnostics, "benchmark page baseline.diagnostics");
  if (baseline.status === "pass" && (regressions.length > 0 || diagnostics.length > 0)) {
    throw new Error("a passing baseline must not contain regressions or diagnostics.");
  }
  if (baseline.status === "fail" && regressions.length + diagnostics.length === 0) {
    throw new Error("a failing baseline must explain its incompatibility or regression.");
  }
  if (resultStatus === "unavailable" && baseline.status !== "unavailable") {
    throw new Error("an unavailable benchmark must have an unavailable baseline.");
  }
  if (resultStatus === "measured" && baseline.status === "unavailable") {
    throw new Error("a measured benchmark must not have an unavailable baseline.");
  }
  if (baseline.status === "unavailable") {
    if (regressions.length > 0) {
      throw new Error("an unavailable baseline must not report regressions.");
    }
    const reason = nonEmptyString(result.unavailableReason, "result.unavailableReason");
    if (diagnostics.length !== 1 || diagnostics[0] !== `unavailable: ${reason}`) {
      throw new Error("an unavailable baseline must contain the canonical unavailable diagnostic.");
    }
  }
  const comparisonResult =
    machine === undefined && browserVersion === undefined
      ? (result as unknown as WebGpuBenchmarkResult)
      : ({
          ...result,
          metadata: {
            ...(result.metadata as JsonRecord),
            ...(machine === undefined ? {} : { operatingSystem: machine.operatingSystem }),
            ...(browserVersion === undefined ? {} : { browserVersion }),
          },
        } as unknown as WebGpuBenchmarkResult);
  const expectedPage = compareWebGpuBenchmarkBaseline(
    comparisonResult,
    CANONICAL_BENCHMARK_BASELINE,
  );
  if (
    baseline.status !== expectedPage.status ||
    JSON.stringify(regressions) !== JSON.stringify(expectedPage.regressions) ||
    JSON.stringify(diagnostics) !== JSON.stringify(expectedPage.diagnostics)
  ) {
    throw new Error(
      "benchmark page baseline does not match the canonical threshold comparison; trusted baseline comparison is driver-owned.",
    );
  }
  const authoritative = compareWebGpuBenchmarkBaseline(comparisonResult, trustedBaseline, machine);
  return Object.freeze({ page: baseline, authoritative });
}

function validateConformance(value: unknown): JsonRecord {
  const conformance = record(value, "benchmark page conformance");
  exactObjectKeys(
    conformance,
    ["fixtureDiagnostics", "gpuFixtureDiagnostics"],
    "benchmark page conformance",
  );
  stringArray(conformance.fixtureDiagnostics, "benchmark page conformance.fixtureDiagnostics");
  stringArray(
    conformance.gpuFixtureDiagnostics,
    "benchmark page conformance.gpuFixtureDiagnostics",
  );
  return conformance;
}

/**
 * Parses and validates one terminal benchmark-page payload.
 *
 * @param text - JSON text returned by the browser DOM.
 * @param state - Terminal CSS state attached by the benchmark page.
 * @param trustedBaseline - Loaded canonical baseline used only for the driver-owned comparison.
 * @param machine - Optional host identity used to normalize page metadata for comparison.
 * @param browserVersion - Optional executable version used to normalize page metadata.
 * @returns The schema-checked envelope with the driver-owned baseline comparison.
 * @throws Error when the page is non-terminal or its schema is inconsistent.
 */
export function parseWebGpuBenchmarkOutput(
  text: string,
  state: WebGpuBenchmarkTerminalState,
  trustedBaseline: WebGpuBenchmarkBaseline = CANONICAL_BENCHMARK_BASELINE,
  machine: WebGpuBenchmarkMachine | undefined = undefined,
  browserVersion: string | undefined = undefined,
): WebGpuBenchmarkPageOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The benchmark page did not render valid terminal JSON.");
  }
  const page = record(parsed, "benchmark page output");
  const pageKeys = Object.keys(page);
  if (
    pageKeys.some((key) => !["result", "baseline", "conformance"].includes(key)) ||
    pageKeys.length !== 3 ||
    !["result", "baseline", "conformance"].every((key) => pageKeys.includes(key))
  ) {
    throw new Error("benchmark page output must contain the canonical terminal fields.");
  }
  validateTrustedBaseline(trustedBaseline);
  const result = record(page.result, "benchmark page result");
  if (result.status !== "measured" && result.status !== "unavailable") {
    throw new Error("benchmark page result.status must be measured or unavailable.");
  }
  if (state === "unavailable" && result.status !== "unavailable") {
    throw new Error("an unavailable terminal page must contain an unavailable result.");
  }
  if (state !== "unavailable" && result.status !== "measured") {
    throw new Error("a measured terminal page must contain a measured result.");
  }
  if (result.benchmarkVersion !== WEBGPU_SCALE_BENCHMARK_VERSION) {
    throw new Error("result.benchmarkVersion does not match the benchmark contract.");
  }
  if (result.contractVersion !== WEBGPU_CLUSTER_CONFORMANCE_VERSION) {
    throw new Error("result.contractVersion does not match the benchmark contract.");
  }
  if (result.scene !== "million-visible-star-points") {
    throw new Error("result.scene does not match the benchmark target.");
  }
  if (result.status === "unavailable") {
    unavailableResultShape(result);
  } else {
    measuredResultShape(result);
  }
  const validatedBaseline = validateBaseline(
    page.baseline,
    result,
    trustedBaseline,
    machine,
    browserVersion,
  );
  const pageBaseline = validatedBaseline.page;
  const baseline = validatedBaseline.authoritative;
  const conformance = validateConformance(page.conformance);
  const conformanceDiagnostics = [
    ...(conformance.fixtureDiagnostics as readonly string[]),
    ...(conformance.gpuFixtureDiagnostics as readonly string[]),
  ];
  const expectedState =
    result.status === "unavailable"
      ? "unavailable"
      : result.pass && pageBaseline.status === "pass" && conformanceDiagnostics.length === 0
        ? "pass"
        : "fail";
  if (state !== expectedState) {
    throw new Error(
      "terminal page state does not match the validated result, baseline, and conformance.",
    );
  }
  if (result.status === "measured" && !result.pass && baseline.status === "pass") {
    throw new Error("a measured metric failure must not have a passing baseline result.");
  }
  return Object.freeze({
    result: result as unknown as WebGpuBenchmarkResult,
    baseline,
    conformance,
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function operationTimeoutMilliseconds(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return 1;
  }
  return Math.max(1, Math.min(DEFAULT_CDP_OPERATION_TIMEOUT_MS, Math.ceil(timeoutMs)));
}

/**
 * Resolves or rejects an asynchronous automation operation within a finite deadline.
 *
 * @param operation - Promise-like operation whose late settlement is safely ignored.
 * @param timeoutMs - Requested maximum wait, capped by the CDP operation limit.
 * @param label - Human-readable operation name used in timeout diagnostics.
 * @returns The operation value when it settles before the deadline.
 * @throws Error when the operation exceeds its deadline.
 */
export function withWebGpuTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const limit = operationTimeoutMilliseconds(timeoutMs);
  const pendingOperation = Promise.resolve(operation);
  return new Promise<T>((resolveOperation, rejectOperation) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      rejectOperation(
        new Error(`automation-unavailable: ${label} timed out after ${String(limit)}ms.`),
      );
    }, limit);
    pendingOperation.then(
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolveOperation(value);
      },
      (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        rejectOperation(error);
      },
    );
  });
}

async function boundedJsonFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<unknown> {
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  try {
    const response = await withWebGpuTimeout(
      fetch(url, { ...init, signal: controller.signal }),
      timeoutMs,
      label,
    );
    return await withWebGpuTimeout(
      response.json(),
      Math.max(1, deadline - Date.now()),
      `${label} response`,
    );
  } catch (error) {
    try {
      controller.abort();
    } catch {
      // A completed or mocked fetch may not expose abortable state.
    }
    throw error;
  }
}

function timeoutMilliseconds(args: readonly string[]): number {
  const index = args.indexOf("--timeout-ms");
  if (index < 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  const value = Number(args[index + 1]);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("--timeout-ms must be a positive safe integer.");
  }
  return value;
}

function optionPath(args: readonly string[], option: string): string | undefined {
  const index = args.indexOf(option);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a file path.`);
  }
  return resolve(process.cwd(), value);
}

function outputPath(args: readonly string[]): string | undefined {
  return optionPath(args, "--write-result");
}

function baselineOutputPath(args: readonly string[]): string | undefined {
  return optionPath(args, "--write-baseline");
}

async function findBrowser(): Promise<string | undefined> {
  return (await discoverWebGpuBrowser("Chrome")).path;
}

async function runBuild(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  const output = await runBoundedWebGpuCommand(["bun", "run", "build"], {
    timeoutMs,
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "production" },
  });
  if (output.exitCode !== 0) {
    const detail = (output.stderr || output.stdout).trim().slice(-4_000);
    throw new Error(
      `automation-unavailable: production build failed (${String(output.exitCode)}). ${detail}`,
    );
  }
}

function contentType(pathname: string): string {
  const extension = extname(pathname).toLowerCase();
  const types: Readonly<Record<string, string>> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json",
  };
  return types[extension] ?? "application/octet-stream";
}

function safeDistPath(pathname: string): string {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded.replace(/^\/+/, "");
  if (relative.split("/").includes("..")) {
    throw new Error("path traversal is not allowed by the local benchmark server.");
  }
  return resolve(process.cwd(), "dist", relative === "" ? "index.html" : relative);
}

function startServer(): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      let pathname: string;
      try {
        pathname = safeDistPath(url.pathname);
      } catch {
        return new Response("Bad request", { status: 400 });
      }
      const file = Bun.file(pathname);
      if (!(await file.exists())) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(file, { headers: { "content-type": contentType(pathname) } });
    },
  });
}

class CdpConnection {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, CdpPending>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    this.socket.addEventListener("message", (event) => {
      let reply: CdpReply;
      try {
        reply = JSON.parse(String(event.data)) as CdpReply;
      } catch {
        return;
      }
      if (typeof reply.id !== "number") {
        return;
      }
      const waiter = this.pending.get(reply.id);
      if (waiter === undefined) {
        return;
      }
      this.pending.delete(reply.id);
      clearTimeout(waiter.timer);
      if (reply.error !== undefined) {
        waiter.reject(new Error(String(reply.error.message ?? "Chrome DevTools request failed.")));
        return;
      }
      waiter.resolve(reply.result);
    });
    this.socket.addEventListener("close", () => {
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("Chrome DevTools connection closed."));
      }
      this.pending.clear();
    });
  }

  /**
   * Opens a Chrome DevTools Protocol WebSocket with a bounded connection wait.
   *
   * @param url - The page target WebSocket URL.
   * @param timeoutMs - Maximum connection wait before the socket is closed.
   * @returns A connected CDP session.
   */
  static async connect(
    url: string,
    timeoutMs = DEFAULT_CDP_OPERATION_TIMEOUT_MS,
  ): Promise<CdpConnection> {
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      throw new Error(
        `automation-unavailable: Chrome DevTools WebSocket could not be created (${error instanceof Error ? error.message : "unknown error"}).`,
      );
    }
    let openHandler: (() => void) | undefined;
    let errorHandler: (() => void) | undefined;
    const opened = new Promise<void>((resolveOpen, rejectOpen) => {
      openHandler = () => resolveOpen();
      errorHandler = () => rejectOpen(new Error("Chrome DevTools WebSocket failed."));
      socket.addEventListener("open", openHandler);
      socket.addEventListener("error", errorHandler);
    });
    try {
      await withWebGpuTimeout(opened, timeoutMs, "Chrome DevTools WebSocket connection");
    } catch (error) {
      try {
        socket.close();
      } catch {
        // The caller still owns bounded browser-process cleanup.
      }
      throw error;
    } finally {
      try {
        if (openHandler !== undefined) {
          socket.removeEventListener("open", openHandler);
        }
        if (errorHandler !== undefined) {
          socket.removeEventListener("error", errorHandler);
        }
      } catch {
        // A mocked or already-closed socket may not support listener removal.
      }
    }
    return new CdpConnection(socket);
  }

  /**
   * Sends one CDP method and awaits its response within a bounded operation deadline.
   *
   * @param method - CDP method name.
   * @param params - CDP method parameters.
   * @param timeoutMs - Maximum response wait.
   * @returns The CDP result payload.
   */
  send(
    method: string,
    params: JsonRecord = {},
    timeoutMs = DEFAULT_CDP_OPERATION_TIMEOUT_MS,
  ): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    const limit = operationTimeoutMilliseconds(timeoutMs);
    return new Promise((resolveReply, rejectReply) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectReply(
          new Error(
            `automation-unavailable: Chrome DevTools ${method} timed out after ${String(limit)}ms.`,
          ),
        );
      }, limit);
      this.pending.set(id, { resolve: resolveReply, reject: rejectReply, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        rejectReply(error);
      }
    });
  }

  /**
   * Closes the CDP WebSocket without affecting the browser profile.
   */
  close(): void {
    try {
      this.socket.close();
    } finally {
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("Chrome DevTools connection closed."));
      }
      this.pending.clear();
    }
  }
}

/**
 * Connects to a Chrome DevTools Protocol target through the bounded socket seam.
 *
 * @param url - The page target WebSocket URL.
 * @param timeoutMs - Maximum connection wait.
 * @returns A CDP connection with bounded requests and close behavior.
 */
export async function connectWebGpuCdp(
  url: string,
  timeoutMs = DEFAULT_CDP_OPERATION_TIMEOUT_MS,
): Promise<WebGpuBrowserCdp> {
  return CdpConnection.connect(url, timeoutMs);
}

async function devToolsPort(profile: string, timeoutMs: number): Promise<number> {
  const activePort = join(profile, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await Bun.file(activePort).exists()) {
      const lines = (await readFile(activePort, "utf8")).trim().split("\n");
      const port = Number(lines[0]);
      if (Number.isSafeInteger(port) && port > 0 && port <= 65_535) {
        return port;
      }
    }
    await delay(100);
  }
  throw new Error("automation-unavailable: Chrome did not publish a DevToolsActivePort file.");
}

async function pageTarget(port: number, timeoutMs: number): Promise<CdpTarget> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    try {
      const targets = await boundedJsonFetch(
        `http://127.0.0.1:${String(port)}/json/list`,
        {},
        Math.min(remaining, DEFAULT_CDP_OPERATION_TIMEOUT_MS),
        "Chrome DevTools target discovery",
      );
      if (Array.isArray(targets)) {
        const target = targets.find(
          (value): value is CdpTarget =>
            typeof value === "object" &&
            value !== null &&
            (value as JsonRecord).type === "page" &&
            typeof (value as JsonRecord).webSocketDebuggerUrl === "string",
        );
        if (target !== undefined) {
          return target;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("automation-unavailable:")) {
        throw error;
      }
      // Chrome is still starting; keep the bounded retry inside the deadline.
    }
    await delay(Math.min(100, Math.max(1, deadline - Date.now())));
  }
  throw new Error("automation-unavailable: Chrome did not expose a page target.");
}

async function terminalSnapshot(
  cdp: WebGpuBrowserCdp,
  timeoutMs: number,
): Promise<{ readonly state: WebGpuBenchmarkTerminalState; readonly text: string } | undefined> {
  const result = record(
    await withWebGpuTimeout(
      cdp.send(
        "Runtime.evaluate",
        {
          expression:
            "(() => { const element = document.getElementById('webgpu-scale-result'); return element === null ? null : { state: element.className, text: element.textContent || '' }; })()",
          returnByValue: true,
          awaitPromise: true,
        },
        timeoutMs,
      ),
      timeoutMs,
      "Chrome DevTools Runtime.evaluate",
    ),
    "Runtime.evaluate result",
  );
  const remote = result.result;
  if (typeof remote !== "object" || remote === null) {
    return undefined;
  }
  const value = (remote as JsonRecord).value;
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const snapshot = value as JsonRecord;
  const state = snapshot.state;
  if (state !== "pass" && state !== "fail" && state !== "unavailable") {
    return undefined;
  }
  return Object.freeze({ state, text: String(snapshot.text ?? "") });
}

/**
 * Waits for a benchmark page to publish and validate its terminal JSON envelope.
 *
 * @param cdp - CDP connection used to inspect the page.
 * @param timeoutMs - Overall page wait deadline.
 * @param baseline - Trusted baseline used for the driver-owned comparison; the page comparison remains threshold-only.
 * @param machine - Optional host identity used to normalize page metadata for comparison.
 * @param browserVersion - Optional executable version used to normalize page metadata.
 * @returns The validated terminal page output.
 * @throws Error when CDP or page validation cannot complete within bounded deadlines.
 */
export async function waitForWebGpuBenchmarkTerminal(
  cdp: WebGpuBrowserCdp,
  timeoutMs: number,
  baseline: WebGpuBenchmarkBaseline = CANONICAL_BENCHMARK_BASELINE,
  machine: WebGpuBenchmarkMachine | undefined = undefined,
  browserVersion: string | undefined = undefined,
): Promise<WebGpuBenchmarkPageOutput> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    let snapshot: Awaited<ReturnType<typeof terminalSnapshot>>;
    try {
      snapshot = await terminalSnapshot(cdp, Math.min(remaining, DEFAULT_CDP_OPERATION_TIMEOUT_MS));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("automation-unavailable:")) {
        throw error;
      }
      // The page can briefly recreate its execution context while loading.
      await delay(Math.min(100, Math.max(1, deadline - Date.now())));
      continue;
    }
    if (snapshot !== undefined) {
      try {
        return parseWebGpuBenchmarkOutput(
          snapshot.text,
          snapshot.state,
          baseline,
          machine,
          browserVersion,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (
          snapshot.state === "unavailable" ||
          (!message.includes("valid terminal JSON") &&
            !message.includes("canonical terminal fields"))
        ) {
          throw error;
        }
        // The page can briefly apply a terminal class before textContent is fully replaced.
      }
    }
    await delay(Math.min(100, Math.max(1, deadline - Date.now())));
  }
  throw new Error(
    "automation-unavailable: benchmark page did not reach a valid terminal JSON state.",
  );
}

export type WebGpuBrowserProcess = WebGpuProcess;

export type WebGpuBrowserCleanupOptions = {
  readonly browser?: WebGpuBrowserProcess;
  readonly cdp?: WebGpuBrowserCdp;
  readonly label?: string;
  readonly timeoutMs?: number;
  readonly independentCleanup?: readonly (() => unknown)[];
  readonly confirmedExitCleanup?: readonly (() => unknown)[];
};

export { terminateWebGpuProcess, waitForProcessExit, webGpuProcessTerminationFailure };

export type WebGpuBrowserCdp = {
  readonly send: (method: string, params?: JsonRecord, timeoutMs?: number) => Promise<unknown>;
  readonly close: () => unknown;
};

/**
 * Cleans up browser, protocol, server, and temporary resources with process-exit gating.
 *
 * CDP close and server teardown are independent and are attempted even when process termination
 * fails. Temporary-resource callbacks run only after a confirmed process exit.
 *
 * @param options - Process, CDP, bounded cleanup callbacks, and diagnostic settings.
 * @returns Nothing after all permitted cleanup steps have been attempted.
 * @throws Error when process exit or cleanup cannot be confirmed.
 */
export async function cleanupWebGpuBrowserResources(
  options: WebGpuBrowserCleanupOptions,
): Promise<void> {
  const cdp = options.cdp;
  const cleanup: WebGpuProcessCleanupOptions = {
    label: options.label ?? "browser process",
    independentCleanup: [
      ...(cdp === undefined ? [] : [() => cdp.close()]),
      ...(options.independentCleanup ?? []),
    ],
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.confirmedExitCleanup === undefined
      ? {}
      : { confirmedExitCleanup: options.confirmedExitCleanup }),
  };
  if (cdp !== undefined) {
    const timeoutMs = Math.max(1, options.timeoutMs ?? 2_000);
    try {
      await Promise.race([
        cdp.send("Browser.close").then(
          () => undefined,
          () => undefined,
        ),
        delay(timeoutMs),
      ]);
    } catch {
      // The process cleanup below is authoritative when CDP is already gone.
    }
  }
  await cleanupWebGpuProcess(options.browser, cleanup);
}

/**
 * Closes a browser through CDP, then guarantees bounded process and socket cleanup.
 *
 * @param browser - Minimal injectable browser process lifecycle seam.
 * @param cdp - Optional CDP connection lifecycle seam.
 * @param timeoutMs - Bound for every CDP/process wait.
 * @returns Nothing after process and socket cleanup; rejects when process exit is unconfirmed.
 */
export async function closeBrowser(
  browser: WebGpuBrowserProcess,
  cdp: WebGpuBrowserCdp | undefined,
  timeoutMs = 2_000,
): Promise<void> {
  await cleanupWebGpuBrowserResources({
    browser,
    ...(cdp === undefined ? {} : { cdp }),
    timeoutMs,
  });
}

function baseMetadata(): WebGpuBenchmarkMetadata {
  return Object.freeze({
    browser: "Chrome",
    browserVersion: "unknown",
    operatingSystem: process.platform,
    adapterName: undefined,
    adapterVendor: undefined,
    adapterArchitecture: undefined,
    measuredAt: new Date().toISOString(),
  });
}

async function writeOutput(pathname: string | undefined, output: unknown): Promise<void> {
  if (pathname === undefined || output === undefined) {
    return;
  }
  await mkdir(dirname(pathname), { recursive: true });
  await Bun.write(pathname, `${JSON.stringify(output, null, 2)}\n`);
}

function measuredBaselineFor(
  result: WebGpuBenchmarkResult,
  machine: WebGpuBenchmarkMachine,
): WebGpuMeasuredBenchmarkBaseline | undefined {
  if (
    result.status !== "measured" ||
    result.timingSource === undefined ||
    result.visibleCount === undefined ||
    result.generationLatencyMilliseconds === undefined ||
    result.frameTimes === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    benchmarkVersion: result.benchmarkVersion,
    contractVersion: result.contractVersion,
    scene: result.scene,
    metadata: result.metadata,
    machine,
    timingSource: result.timingSource,
    warmupFrameCount: result.warmupFrameCount,
    sampleFrameCount: result.sampleFrameCount,
    visibleCount: result.visibleCount,
    generationLatencyMilliseconds: result.generationLatencyMilliseconds,
    frameTimes: result.frameTimes,
    pass: result.pass,
    resourceBudget: result.resourceBudget,
    resourceSemantics: describeWebGpuResourceMemory(result.resourceBudget),
    resourceBytes: result.resourceBudget.totalBufferBytes,
  });
}

/**
 * Loads and validates the canonical threshold baseline and optional measured baseline evidence.
 *
 * @returns A complete trusted baseline for terminal-envelope and regression validation.
 * @throws Error when a checked-in baseline is incomplete, substituted, or incompatible.
 */
export async function loadWebGpuBenchmarkBaseline(): Promise<WebGpuBenchmarkBaseline> {
  const thresholdValue = await Bun.file(
    new URL("../docs/benchmarks/webgpu-scale-baseline.json", import.meta.url),
  ).json();
  const thresholdBaseline = validateTrustedBaseline(thresholdValue);
  const measuredPath = new URL(
    "../docs/benchmarks/webgpu-scale-m4-max-baseline.json",
    import.meta.url,
  );
  const measuredFile = Bun.file(measuredPath);
  if (!(await measuredFile.exists())) {
    return Object.freeze({ ...thresholdBaseline });
  }
  const measuredValue = await measuredFile.json();
  validateMeasuredBaseline(measuredValue, "checked-in measured baseline");
  return Object.freeze({
    ...thresholdBaseline,
    measuredBaseline: measuredValue as WebGpuMeasuredBenchmarkBaseline,
  });
}

function pageHasFailure(page: WebGpuBenchmarkPageOutput): boolean {
  if (page.result.status === "unavailable" || !page.result.pass) {
    return true;
  }
  const baseline =
    typeof page.baseline === "object" && page.baseline !== null && !Array.isArray(page.baseline)
      ? (page.baseline as JsonRecord)
      : undefined;
  if (baseline?.status === "fail") {
    return true;
  }
  const conformance =
    typeof page.conformance === "object" &&
    page.conformance !== null &&
    !Array.isArray(page.conformance)
      ? (page.conformance as JsonRecord)
      : undefined;
  return ["fixtureDiagnostics", "gpuFixtureDiagnostics"].some((key) => {
    const diagnostics = conformance?.[key];
    return Array.isArray(diagnostics) && diagnostics.length > 0;
  });
}

function driverStatusForUnavailable(reason: string): WebGpuBenchmarkDriverStatus {
  if (reason.startsWith("browser-missing:")) {
    return "browser-missing";
  }
  if (reason.startsWith("automation-unavailable:")) {
    return "automation-unavailable";
  }
  return "browser-webgpu-unavailable";
}

function unavailableOutput(
  reason: string,
  baseline: WebGpuBenchmarkBaseline,
  metadata: WebGpuBenchmarkMetadata = baseMetadata(),
): JsonRecord {
  const preparation = defaultWebGpuBenchmarkPreparation();
  const result = createUnavailableWebGpuBenchmarkResult(
    reason,
    metadata,
    preparation.budget,
    baseline.thresholds,
  );
  return {
    benchmark: "webgpu-scale",
    driver: { status: driverStatusForUnavailable(reason), reason },
    result,
    baseline: compareWebGpuBenchmarkBaseline(result, baseline),
    conformance: {
      fixtureDiagnostics: verifyWebGpuConformanceFixtures(),
      gpuFixtureDiagnostics: [],
    },
  };
}

async function runBrowserBenchmark(
  browserPath: string,
  timeoutMs: number,
  build: boolean,
  baseline: WebGpuBenchmarkBaseline,
  machine: WebGpuBenchmarkMachine,
  browserVersion: string | undefined,
): Promise<WebGpuBenchmarkPageOutput> {
  if (build) {
    await runBuild(timeoutMs);
  }
  const server = startServer();
  let profile: string | undefined;
  let browser: Bun.Subprocess | undefined;
  let cdp: CdpConnection | undefined;
  try {
    profile = await mkdtemp(join(tmpdir(), "webgpu-scale-chrome-"));
    const url = `${server.url}webgpu-scale-benchmark.html?driver=${String(Date.now())}`;
    browser = Bun.spawn(
      [
        browserPath,
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-sync",
        "--window-size=1920,1080",
        url,
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    const port = await devToolsPort(profile, timeoutMs);
    const target = await pageTarget(port, timeoutMs);
    const websocketUrl = nonEmptyString(target.webSocketDebuggerUrl, "page target WebSocket URL");
    cdp = await CdpConnection.connect(websocketUrl, timeoutMs);
    await withWebGpuTimeout(
      cdp.send("Runtime.enable", {}, timeoutMs),
      timeoutMs,
      "Chrome DevTools Runtime.enable",
    );
    return await waitForWebGpuBenchmarkTerminal(cdp, timeoutMs, baseline, machine, browserVersion);
  } finally {
    const activeProfile = profile;
    await cleanupWebGpuBrowserResources({
      ...(browser === undefined ? {} : { browser }),
      ...(cdp === undefined ? {} : { cdp }),
      label: "Chrome browser",
      timeoutMs: 2_000,
      independentCleanup: [() => server.stop(true)],
      confirmedExitCleanup:
        activeProfile === undefined
          ? []
          : [() => rm(activeProfile, { recursive: true, force: true })],
    });
  }
}

async function main(args: readonly string[]): Promise<number> {
  const baseline = await loadWebGpuBenchmarkBaseline();
  const destination = outputPath(args);
  const measuredBaselineDestination = baselineOutputPath(args);
  const browserPath = await findBrowser();
  if (browserPath === undefined) {
    const output = unavailableOutput(
      "browser-missing: no installed Chrome executable was found; set WEBGPU_BROWSER to a local browser path.",
      baseline,
    );
    console.log(JSON.stringify(output, null, 2));
    await writeOutput(destination, output);
    return REQUIRE_WEBGPU ? 2 : 0;
  }

  const machine = await detectWebGpuHostMachine();
  const exactBrowserVersion = await executableVersion(browserPath);
  try {
    const page = await runBrowserBenchmark(
      browserPath,
      timeoutMilliseconds(args),
      !args.includes("--no-build"),
      baseline,
      machine,
      exactBrowserVersion,
    );
    const result = Object.freeze({
      ...page.result,
      metadata: Object.freeze({
        ...page.result.metadata,
        browserVersion: exactBrowserVersion ?? page.result.metadata.browserVersion,
        operatingSystem: machine.operatingSystem,
      }),
    });
    const normalizedPage = Object.freeze({
      ...page,
      result,
      baseline: compareWebGpuBenchmarkBaseline(result, baseline, machine),
    });
    const output = {
      benchmark: "webgpu-scale",
      driver: {
        status:
          result.status === "measured"
            ? "measured"
            : driverStatusForUnavailable(result.unavailableReason ?? ""),
        browserPath: basename(browserPath),
        browser: result.metadata.browser,
        browserVersion: result.metadata.browserVersion,
      },
      ...normalizedPage,
    };
    console.log(JSON.stringify(output, null, 2));
    await writeOutput(destination, output);
    await writeOutput(measuredBaselineDestination, measuredBaselineFor(result, machine));
    return REQUIRE_WEBGPU && pageHasFailure(normalizedPage) ? 2 : 0;
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "automation-unavailable: browser driver failed.";
    const normalizedReason = reason.startsWith("automation-unavailable:")
      ? reason
      : `automation-unavailable: ${reason}`;
    const output = unavailableOutput(normalizedReason, baseline);
    console.log(JSON.stringify(output, null, 2));
    await writeOutput(destination, output);
    return REQUIRE_WEBGPU ? 2 : 1;
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
