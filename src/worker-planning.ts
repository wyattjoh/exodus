import { attachExecutionControl, type WorkerPlanningExecutionControl } from "./execution-control";
import { compileScenario, type CompiledScenario, type ScenarioInput, type StableId } from "./model";
import {
  createScenarioExport,
  importScenario,
  type ScenarioExportDocument,
} from "./scenario-persistence";
import {
  generateClusterRegion,
  generateHierarchicalCluster,
  planClusterRoute,
  type ClusterGenerationRequest,
  type GeneratedClusterRegion,
  type HierarchicalClusterRegion,
} from "./cluster-generation";
import { planJourney, type RoutePlanningRequest, type RoutePlanningResult } from "./route-planning";
import type { ClusterRoutePlanningResult } from "./cluster-generation";

/**
 * The version of the cloneable worker planning protocol.
 */
export const WORKER_PLANNING_PROTOCOL_VERSION = 1 as const;

/**
 * The largest number of progress messages emitted for one operation.
 */
export const MAX_WORKER_PLANNING_PROGRESS_EVENTS = 64;

/**
 * The default progress-message ceiling for one operation.
 */
export const DEFAULT_WORKER_PLANNING_PROGRESS_EVENTS = 32;

/**
 * The default minimum interval between non-terminal progress messages.
 */
export const DEFAULT_WORKER_PLANNING_PROGRESS_INTERVAL_MS = 16;

/**
 * Operations supported by the worker planning adapter.
 */
export type WorkerPlanningOperation = "generate" | "plan" | "refine";

/**
 * Stages reported by a worker planning operation.
 */
export type WorkerPlanningStage =
  | "queued"
  | "starting"
  | "generating"
  | "planning"
  | "refining"
  | "completed"
  | "cancelled"
  | "failed";

/**
 * Refinement quality reported by route-planning operations when it is known.
 */
export type WorkerPlanningRefinementQuality =
  | "exact"
  | "bounded-strategic-dwell"
  | "hierarchical-bounded"
  | undefined;

/**
 * Structured progress emitted by the worker planning protocol.
 *
 * `completedWork` never decreases, `totalWork` is fixed for one request, and `requestId` keeps
 * progress associated with the request that produced it. A refinement quality is supplied for
 * route and refinement operations once the operation has established it.
 */
export type WorkerPlanningProgress = {
  readonly protocolVersion: typeof WORKER_PLANNING_PROTOCOL_VERSION;
  readonly type: "progress";
  readonly requestId: string;
  readonly operation: WorkerPlanningOperation;
  readonly stage: WorkerPlanningStage;
  readonly completedWork: number;
  readonly totalWork: number;
  readonly refinementQuality: WorkerPlanningRefinementQuality;
};

/**
 * Structured worker-adapter failure categories.
 */
export type WorkerPlanningErrorCode =
  | "startup-failed"
  | "malformed-message"
  | "protocol-version-mismatch"
  | "worker-crashed"
  | "operation-failed"
  | "cancelled"
  | "duplicate-request"
  | "stale-request"
  | "disposed"
  | "progress-handler-failed";

/**
 * A recoverable worker-adapter error with a stable category and optional cause text.
 */
export type WorkerPlanningError = {
  readonly code: WorkerPlanningErrorCode;
  readonly message: string;
  readonly requestId: string | undefined;
  readonly operation: WorkerPlanningOperation | undefined;
  readonly cause: string | undefined;
  readonly recoverable: true;
};

/**
 * Terminal outcomes returned by one worker planning request.
 */
export type WorkerPlanningOutcome =
  | "success"
  | "cancelled"
  | "startup-failed"
  | "malformed-message"
  | "worker-crashed"
  | "failed"
  | "disposed";

/**
 * A successful terminal response from the worker planning protocol.
 */
export type WorkerPlanningSuccess<Result> = {
  readonly protocolVersion: typeof WORKER_PLANNING_PROTOCOL_VERSION;
  readonly type: "result";
  readonly requestId: string;
  readonly operation: WorkerPlanningOperation;
  readonly ok: true;
  readonly outcome: "success";
  readonly result: Result;
  readonly error: undefined;
};

/**
 * An unsuccessful terminal response from the worker planning protocol.
 */
export type WorkerPlanningFailure = {
  readonly protocolVersion: typeof WORKER_PLANNING_PROTOCOL_VERSION;
  readonly type: "result";
  readonly requestId: string;
  readonly operation: WorkerPlanningOperation;
  readonly ok: false;
  readonly outcome: Exclude<WorkerPlanningOutcome, "success">;
  readonly result: undefined;
  readonly error: WorkerPlanningError;
};

/**
 * A terminal response whose result is either a domain result or a structured recoverable failure.
 */
export type WorkerPlanningTerminalResponse<Result> =
  | WorkerPlanningSuccess<Result>
  | WorkerPlanningFailure;

/**
 * A protocol-level error that could not be correlated with a valid operation result.
 */
export type WorkerPlanningProtocolErrorMessage = {
  readonly protocolVersion: typeof WORKER_PLANNING_PROTOCOL_VERSION;
  readonly type: "error";
  readonly requestId: string | undefined;
  readonly operation: WorkerPlanningOperation | undefined;
  readonly error: WorkerPlanningError;
};

/**
 * Any message sent from a worker endpoint to an adapter.
 */
export type WorkerPlanningResponse<Result = WorkerPlanningOperationResult> =
  | WorkerPlanningProgress
  | WorkerPlanningTerminalResponse<Result>
  | WorkerPlanningProtocolErrorMessage;

/**
 * A transport-safe Scenario source accepted by worker requests.
 */
export type WorkerScenarioSource =
  | ScenarioInput
  | CompiledScenario
  | ScenarioExportDocument
  | string;

/**
 * A serializable worker payload for deterministic Scenario generation.
 */
export type WorkerGenerationPayload = {
  readonly request: ClusterGenerationRequest;
};

/**
 * A serializable worker payload for explicit Gate-network route planning.
 */
export type WorkerRoutePlanningPayload = {
  readonly scenario: WorkerScenarioSource;
  readonly request: Readonly<Record<string, unknown>>;
};

/**
 * A hierarchy source accepted by the worker refinement operation.
 */
export type WorkerHierarchySource =
  | ClusterGenerationRequest
  | HierarchicalClusterRegion
  | GeneratedClusterRegion
  | WorkerHierarchicalClusterRegion
  | WorkerGeneratedClusterRegion;

/**
 * A serializable worker payload for bounded hierarchical route refinement.
 */
export type WorkerRefinementPayload = {
  readonly hierarchy: WorkerHierarchySource;
  readonly request: Readonly<Record<string, unknown>>;
};

/**
 * Payloads accepted by the versioned worker request message.
 */
export type WorkerPlanningPayload =
  | WorkerGenerationPayload
  | WorkerRoutePlanningPayload
  | WorkerRefinementPayload;

/**
 * A request message sent from an adapter to a worker endpoint.
 */
export type WorkerPlanningRequestMessage = {
  readonly protocolVersion: typeof WORKER_PLANNING_PROTOCOL_VERSION;
  readonly type: "request";
  readonly requestId: string;
  readonly operation: WorkerPlanningOperation;
  readonly payload: WorkerPlanningPayload;
  /** A shared flag lets a native Worker observe cancellation during synchronous domain loops. */
  readonly cancellationToken?: SharedArrayBuffer | undefined;
};

/**
 * A cancellation message sent from an adapter to a worker endpoint.
 */
export type WorkerPlanningCancelMessage = {
  readonly protocolVersion: typeof WORKER_PLANNING_PROTOCOL_VERSION;
  readonly type: "cancel";
  readonly requestId: string;
};

/**
 * Any message sent from an adapter to a worker endpoint.
 */
export type WorkerPlanningMessage = WorkerPlanningRequestMessage | WorkerPlanningCancelMessage;

/**
 * The generated region representation sent over the worker protocol.
 *
 * Compiled lookup indexes and materialization functions are intentionally omitted. The Scenario is
 * retained as a canonical persistence document so a caller can hand it to another adapter request
 * without depending on browser or Worker globals.
 */
export type WorkerGeneratedClusterRegion = {
  readonly kind: "generated-cluster-region";
  readonly ok: true;
  readonly seed: ClusterGenerationRequest["seed"];
  readonly seedLabel: string;
  readonly seedIdentity: string;
  readonly seedHash: number;
  readonly generatorVersion: string;
  readonly logicalPopulation: number;
  readonly population: number;
  readonly materializedSystemCount: number;
  readonly regionRadius: GeneratedClusterRegion["regionRadius"];
  readonly regionId: StableId;
  readonly regionDepth: number;
  readonly logicalSystemStart: number;
  readonly logicalSystemCount: number;
  readonly logicalSystemIndices: readonly number[];
  readonly hierarchy: WorkerHierarchicalClusterRegion;
  readonly scenarioInput: ScenarioInput;
  readonly input: ScenarioInput;
  readonly scenario: ScenarioExportDocument;
  readonly compiledScenario: ScenarioExportDocument;
  readonly generatedSystems: GeneratedClusterRegion["generatedSystems"];
  readonly generatedOrbitalAnchors: GeneratedClusterRegion["generatedOrbitalAnchors"];
  readonly generatedGates: GeneratedClusterRegion["generatedGates"];
  readonly generatedConnections: GeneratedClusterRegion["generatedConnections"];
  readonly generatedSystemIds: readonly StableId[];
  readonly generatedOrbitalAnchorIds: readonly StableId[];
  readonly generatedGateIds: readonly StableId[];
  readonly generatedConnectionIds: readonly StableId[];
  readonly generatedSystemDesignations: readonly string[];
  readonly generatedOrbitalAnchorDesignations: readonly string[];
  readonly generatedGateDesignations: readonly string[];
  readonly generatedConnectionDesignations: readonly string[];
  readonly statistics: GeneratedClusterRegion["statistics"];
  readonly topology: GeneratedClusterRegion["topology"];
  readonly routeRequest: GeneratedClusterRegion["routeRequest"];
  readonly route: GeneratedClusterRegion["route"];
  readonly plan: GeneratedClusterRegion["plan"];
  readonly routePlan: GeneratedClusterRegion["routePlan"];
  readonly journeyTimeline: GeneratedClusterRegion["journeyTimeline"];
  readonly timeline: GeneratedClusterRegion["timeline"];
};

/**
 * A hierarchy descriptor sent over the worker protocol without executable materialization methods.
 */
export type WorkerHierarchicalClusterRegion = {
  readonly kind: "hierarchical-cluster-region";
  readonly seed: ClusterGenerationRequest["seed"];
  readonly seedLabel: string;
  readonly seedIdentity: string;
  readonly seedHash: number;
  readonly generatorVersion: string;
  readonly logicalPopulation: number;
  readonly materializedSystemCount: 0;
  readonly regionRadius: GeneratedClusterRegion["regionRadius"];
  readonly root: HierarchicalClusterRegion["root"];
  readonly leafSystemCapacity: number;
  readonly maxDepth: number;
  readonly defaultDepartureGateId: StableId;
  readonly defaultDestinationGateId: StableId;
  readonly defaultShipProfileId: StableId;
  readonly sourceRequest: ClusterGenerationRequest;
};

/**
 * The union of domain results returned by the three worker operations.
 */
export type WorkerPlanningOperationResult =
  | WorkerGeneratedClusterRegion
  | RoutePlanningResult
  | ClusterRoutePlanningResult;

/**
 * A minimal Worker-like port used by the adapter and endpoint.
 *
 * The shape deliberately describes capabilities instead of importing DOM, browser, Node, or Bun
 * Worker types. A native Worker, MessagePort, test double, or in-process port can implement it.
 */
export type WorkerPlanningPort = {
  readonly postMessage: (message: unknown) => void;
  readonly terminate?: () => void | Promise<void>;
  readonly addEventListener?: (
    type: "message" | "error" | "messageerror",
    listener: (event: unknown) => void,
  ) => void;
  readonly removeEventListener?: (
    type: "message" | "error" | "messageerror",
    listener: (event: unknown) => void,
  ) => void;
  onmessage?: ((event: unknown) => void) | null;
  onerror?: ((event: unknown) => void) | null;
  onmessageerror?: ((event: unknown) => void) | null;
};

/**
 * A lazily invoked Worker-like port factory.
 */
export type WorkerPlanningPortFactory = () => WorkerPlanningPort | Promise<WorkerPlanningPort>;

/**
 * A task handle that exposes request correlation, cancellation, and its terminal response.
 */
export type WorkerPlanningTask<Result> = {
  readonly requestId: string;
  readonly promise: Promise<WorkerPlanningTerminalResponse<Result>>;
  readonly cancel: () => boolean;
};

/**
 * Per-request adapter options.
 */
export type WorkerPlanningRequestOptions = {
  readonly onProgress?: ((progress: WorkerPlanningProgress) => void) | undefined;
};

/**
 * The asynchronous worker planning adapter interface.
 */
export type WorkerPlanningAdapter = {
  readonly submit: (
    operation: WorkerPlanningOperation,
    payload: WorkerPlanningPayload,
    options?: WorkerPlanningRequestOptions | undefined,
  ) => WorkerPlanningTask<WorkerPlanningOperationResult>;
  readonly generate: (
    request: ClusterGenerationRequest,
    options?: WorkerPlanningRequestOptions | undefined,
  ) => WorkerPlanningTask<WorkerGeneratedClusterRegion>;
  readonly plan: (
    scenario: WorkerScenarioSource,
    request: Readonly<Record<string, unknown>>,
    options?: WorkerPlanningRequestOptions | undefined,
  ) => WorkerPlanningTask<RoutePlanningResult>;
  readonly refine: (
    hierarchy: WorkerHierarchySource,
    request: Readonly<Record<string, unknown>>,
    options?: WorkerPlanningRequestOptions | undefined,
  ) => WorkerPlanningTask<ClusterRoutePlanningResult>;
  readonly cancel: (requestId: string) => boolean;
  readonly activeRequestIds: () => readonly string[];
  readonly getDiagnostics: () => readonly WorkerPlanningDiagnostic[];
  readonly dispose: () => Promise<void>;
};

/**
 * Adapter configuration independent of any transport/runtime implementation.
 */
export type WorkerPlanningAdapterOptions = {
  readonly workerFactory?: WorkerPlanningPortFactory | undefined;
  readonly onProgress?: ((progress: WorkerPlanningProgress) => void) | undefined;
  readonly maxProgressEvents?: number | undefined;
  readonly progressIntervalMs?: number | undefined;
  readonly requestIdPrefix?: string | undefined;
};

/**
 * An endpoint configuration for progress limits and cooperative scheduling.
 */
export type WorkerPlanningEndpointOptions = {
  readonly maxProgressEvents?: number | undefined;
  readonly progressIntervalMs?: number | undefined;
  readonly schedule?: ((callback: () => void) => void) | undefined;
  readonly now?: (() => number) | undefined;
};

/**
 * A handle for a bound worker endpoint.
 */
export type WorkerPlanningEndpoint = {
  readonly handleMessage: (message: unknown) => void;
  readonly dispose: () => void;
};

/**
 * Diagnostics emitted when a transport delivers malformed, stale, duplicate, or out-of-order data.
 */
export type WorkerPlanningDiagnosticCode =
  | "malformed-message"
  | "protocol-version-mismatch"
  | "stale-response"
  | "duplicate-response"
  | "duplicate-progress"
  | "out-of-order-progress"
  | "worker-message-error"
  | "progress-handler-failed";

/**
 * One bounded adapter diagnostic. Diagnostics never replace a newer request's result.
 */
export type WorkerPlanningDiagnostic = {
  readonly code: WorkerPlanningDiagnosticCode;
  readonly message: string;
  readonly requestId: string | undefined;
  readonly operation: WorkerPlanningOperation | undefined;
};

type RecordValue = Record<string, unknown>;
type WorkerResult = WorkerPlanningOperationResult;
type PendingRequest = {
  readonly requestId: string;
  readonly operation: WorkerPlanningOperation;
  readonly resolve: (response: WorkerPlanningTerminalResponse<WorkerResult>) => void;
  readonly onProgress: ((progress: WorkerPlanningProgress) => void) | undefined;
  readonly message: WorkerPlanningRequestMessage;
  sent: boolean;
  cancelRequested: boolean;
  progressCount: number;
  lastProgressAt: number;
  readonly cancellationToken: Int32Array | undefined;
  lastProgress: WorkerPlanningProgress | undefined;
};
type EndpointRequest = {
  readonly requestId: string;
  readonly operation: WorkerPlanningOperation;
  readonly payload: WorkerPlanningPayload;
  readonly cancellationToken: Int32Array | undefined;
  cancelled: boolean;
};

const stageOrder: Readonly<Record<WorkerPlanningStage, number>> = Object.freeze({
  queued: 0,
  starting: 1,
  generating: 2,
  planning: 3,
  refining: 3,
  completed: 4,
  cancelled: 4,
  failed: 4,
});
const operationSet = new Set<WorkerPlanningOperation>(["generate", "plan", "refine"]);
const stableRequestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const diagnosticsLimit = 256;
const completedRequestsLimit = 256;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: RecordValue, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isOperation(value: unknown): value is WorkerPlanningOperation {
  return typeof value === "string" && operationSet.has(value as WorkerPlanningOperation);
}

function isRefinementQuality(
  value: unknown,
): value is Exclude<WorkerPlanningRefinementQuality, undefined> {
  return (
    value === "exact" || value === "bounded-strategic-dwell" || value === "hierarchical-bounded"
  );
}

function isErrorCode(value: unknown): value is WorkerPlanningErrorCode {
  return (
    value === "startup-failed" ||
    value === "malformed-message" ||
    value === "protocol-version-mismatch" ||
    value === "worker-crashed" ||
    value === "operation-failed" ||
    value === "cancelled" ||
    value === "duplicate-request" ||
    value === "stale-request" ||
    value === "disposed" ||
    value === "progress-handler-failed"
  );
}

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && stableRequestIdPattern.test(value);
}

function sharedCancellationView(value: unknown): Int32Array | undefined {
  if (
    typeof SharedArrayBuffer === "undefined" ||
    !(value instanceof SharedArrayBuffer) ||
    value.byteLength < Int32Array.BYTES_PER_ELEMENT
  ) {
    return undefined;
  }
  return new Int32Array(value, 0, 1);
}

function createSharedCancellationToken(): SharedArrayBuffer | undefined {
  if (typeof SharedArrayBuffer === "undefined") {
    return undefined;
  }
  const globalObject = globalThis as typeof globalThis & { readonly crossOriginIsolated?: boolean };
  if (globalObject.crossOriginIsolated === false) {
    return undefined;
  }
  return new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
}

function markCancellation(token: Int32Array | undefined): void {
  if (token !== undefined) {
    Atomics.store(token, 0, 1);
  }
}

function cancellationWasRequested(
  request: Pick<EndpointRequest, "cancelled" | "cancellationToken">,
): boolean {
  return (
    request.cancelled ||
    (request.cancellationToken !== undefined && Atomics.load(request.cancellationToken, 0) === 1)
  );
}

function payloadShapeIsValid(
  operation: WorkerPlanningOperation,
  payload: unknown,
): payload is WorkerPlanningPayload {
  if (!isRecord(payload) || !isRecord(payload.request)) {
    return false;
  }
  if (operation === "generate") {
    return true;
  }
  if (operation === "plan") {
    return (
      (typeof payload.scenario === "string" || isRecord(payload.scenario)) &&
      isRecord(payload.request)
    );
  }
  return isRecord(payload.hierarchy) && isRecord(payload.request);
}

function clampProgressLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_WORKER_PLANNING_PROGRESS_EVENTS;
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("maxProgressEvents must be a positive safe integer.");
  }
  return Math.min(MAX_WORKER_PLANNING_PROGRESS_EVENTS, value);
}

function clampProgressInterval(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_WORKER_PLANNING_PROGRESS_INTERVAL_MS;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("progressIntervalMs must be a finite non-negative number.");
  }
  return value;
}

function protocolError(
  code: WorkerPlanningErrorCode,
  message: string,
  requestId: string | undefined,
  operation: WorkerPlanningOperation | undefined,
  cause: string | undefined = undefined,
): WorkerPlanningError {
  return Object.freeze({
    code,
    message,
    requestId,
    operation,
    cause,
    recoverable: true as const,
  });
}

function successResponse<Result>(
  requestId: string,
  operation: WorkerPlanningOperation,
  result: Result,
): WorkerPlanningSuccess<Result> {
  return Object.freeze({
    protocolVersion: WORKER_PLANNING_PROTOCOL_VERSION,
    type: "result" as const,
    requestId,
    operation,
    ok: true as const,
    outcome: "success" as const,
    result,
    error: undefined,
  });
}

function failureResponse(
  requestId: string,
  operation: WorkerPlanningOperation,
  outcome: Exclude<WorkerPlanningOutcome, "success">,
  error: WorkerPlanningError,
): WorkerPlanningFailure {
  return Object.freeze({
    protocolVersion: WORKER_PLANNING_PROTOCOL_VERSION,
    type: "result" as const,
    requestId,
    operation,
    ok: false as const,
    outcome,
    result: undefined,
    error,
  });
}

function protocolErrorMessage(
  requestId: string | undefined,
  operation: WorkerPlanningOperation | undefined,
  error: WorkerPlanningError,
): WorkerPlanningProtocolErrorMessage {
  return Object.freeze({
    protocolVersion: WORKER_PLANNING_PROTOCOL_VERSION,
    type: "error" as const,
    requestId,
    operation,
    error,
  });
}

function eventData(value: unknown): unknown {
  return isRecord(value) && "data" in value ? value.data : value;
}

function errorText(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (isRecord(value) && typeof value.message === "string") {
    return value.message;
  }
  return typeof value === "string" ? value : "Unknown worker error.";
}

function errorCause(value: unknown): string | undefined {
  const text = errorText(value);
  return text === "Unknown worker error." ? undefined : text;
}

function isCancellationError(value: unknown): boolean {
  return isRecord(value) && value.name === "WorkerPlanningCancelled";
}

class WorkerPlanningCancelled extends Error {
  public override readonly name = "WorkerPlanningCancelled";

  public constructor() {
    super("Worker planning was cancelled at a cooperative checkpoint.");
  }
}

function normalizeScenarioSource(source: WorkerScenarioSource): ScenarioExportDocument {
  if (
    typeof source === "string" ||
    (isRecord(source) && (source as RecordValue).kind === "centauri-scenario")
  ) {
    const imported = importScenario(source);
    if (!imported.ok) {
      throw new RangeError(
        `Scenario JSON could not be imported: ${imported.issues.map((issue) => issue.message).join(" ")}`,
      );
    }
    return imported.document;
  }
  return createScenarioExport(source as ScenarioInput | CompiledScenario);
}

function normalizeGenerationRequest(request: ClusterGenerationRequest): ClusterGenerationRequest {
  const sourceKey = request.canonicalScenario !== undefined ? "canonicalScenario" : "baseScenario";
  const source = request[sourceKey];
  if (source === undefined) {
    return request;
  }
  const document = normalizeScenarioSource(source as WorkerScenarioSource);
  return Object.freeze({
    ...request,
    canonicalScenario: sourceKey === "canonicalScenario" ? (document as ScenarioInput) : undefined,
    baseScenario: sourceKey === "baseScenario" ? (document as ScenarioInput) : undefined,
  });
}

function hierarchySourceRequest(source: WorkerHierarchySource): ClusterGenerationRequest {
  const record: RecordValue | undefined = isRecord(source) ? source : undefined;
  if (record?.kind === "generated-cluster-region") {
    const hierarchy = record.hierarchy;
    if (isRecord(hierarchy) && isRecord(hierarchy.sourceRequest)) {
      return normalizeGenerationRequest(hierarchy.sourceRequest as ClusterGenerationRequest);
    }
  }
  if (record?.kind === "hierarchical-cluster-region" && isRecord(record.sourceRequest)) {
    return normalizeGenerationRequest(record.sourceRequest as ClusterGenerationRequest);
  }
  return normalizeGenerationRequest(source as ClusterGenerationRequest);
}

function generatedRegionWireValue(region: GeneratedClusterRegion): WorkerGeneratedClusterRegion {
  const scenario = createScenarioExport(region.scenario);
  const hierarchy = region.hierarchy;
  return Object.freeze({
    kind: "generated-cluster-region" as const,
    ok: true as const,
    seed: region.seed,
    seedLabel: region.seedLabel,
    seedIdentity: region.seedIdentity,
    seedHash: region.seedHash,
    generatorVersion: region.generatorVersion,
    logicalPopulation: region.logicalPopulation,
    population: region.population,
    materializedSystemCount: region.materializedSystemCount,
    regionRadius: region.regionRadius,
    regionId: region.regionId,
    regionDepth: region.regionDepth,
    logicalSystemStart: region.logicalSystemStart,
    logicalSystemCount: region.logicalSystemCount,
    logicalSystemIndices: Object.freeze([...region.logicalSystemIndices]),
    hierarchy: Object.freeze({
      kind: "hierarchical-cluster-region" as const,
      seed: hierarchy.seed,
      seedLabel: hierarchy.seedLabel,
      seedIdentity: hierarchy.seedIdentity,
      seedHash: hierarchy.seedHash,
      generatorVersion: hierarchy.generatorVersion,
      logicalPopulation: hierarchy.logicalPopulation,
      materializedSystemCount: 0 as const,
      regionRadius: hierarchy.regionRadius,
      root: hierarchy.root,
      leafSystemCapacity: hierarchy.leafSystemCapacity,
      maxDepth: hierarchy.maxDepth,
      defaultDepartureGateId: hierarchy.defaultDepartureGateId,
      defaultDestinationGateId: hierarchy.defaultDestinationGateId,
      defaultShipProfileId: hierarchy.defaultShipProfileId,
      sourceRequest: normalizeGenerationRequest(hierarchy.sourceRequest),
    }),
    scenarioInput: region.scenarioInput,
    input: region.input,
    scenario,
    compiledScenario: scenario,
    generatedSystems: region.generatedSystems,
    generatedOrbitalAnchors: region.generatedOrbitalAnchors,
    generatedGates: region.generatedGates,
    generatedConnections: region.generatedConnections,
    generatedSystemIds: region.generatedSystemIds,
    generatedOrbitalAnchorIds: region.generatedOrbitalAnchorIds,
    generatedGateIds: region.generatedGateIds,
    generatedConnectionIds: region.generatedConnectionIds,
    generatedSystemDesignations: region.generatedSystemDesignations,
    generatedOrbitalAnchorDesignations: region.generatedOrbitalAnchorDesignations,
    generatedGateDesignations: region.generatedGateDesignations,
    generatedConnectionDesignations: region.generatedConnectionDesignations,
    statistics: region.statistics,
    topology: region.topology,
    routeRequest: region.routeRequest,
    route: region.route,
    plan: region.plan,
    routePlan: region.routePlan,
    journeyTimeline: region.journeyTimeline,
    timeline: region.timeline,
  });
}

function decodeScenario(source: WorkerScenarioSource): CompiledScenario {
  if (typeof source === "string") {
    const imported = importScenario(source);
    if (!imported.ok) {
      throw new RangeError(
        `Scenario JSON could not be imported: ${imported.issues.map((issue) => issue.message).join(" ")}`,
      );
    }
    return imported.scenario;
  }
  if (isRecord(source) && (source as RecordValue).kind === "centauri-scenario") {
    const imported = importScenario(source);
    if (!imported.ok) {
      throw new RangeError(
        `Scenario document could not be imported: ${imported.issues.map((issue) => issue.message).join(" ")}`,
      );
    }
    return imported.scenario;
  }
  const compiled = compileScenario(source);
  if (!compiled.ok) {
    throw new RangeError(
      `Scenario could not be compiled: ${compiled.issues.map((issue) => issue.message).join(" ")}`,
    );
  }
  return compiled.scenario;
}

function operationTotalWork(operation: WorkerPlanningOperation): number {
  return operation === "generate" ? 3 : operation === "refine" ? 3 : 2;
}

function isStableIdValue(value: unknown): value is StableId {
  return typeof value === "string" && stableRequestIdPattern.test(value);
}

function isFiniteQuantity(value: unknown, unit = "s"): boolean {
  return (
    isRecord(value) &&
    value.unit === unit &&
    typeof value.value === "number" &&
    Number.isFinite(value.value)
  );
}

function isStableIdArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => isStableIdValue(item));
}

function isRecordArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => isRecord(item));
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isQualityValue(value: unknown): value is WorkerPlanningRefinementQuality {
  return value === undefined || isRefinementQuality(value);
}

function isRoutePlanValue(value: unknown): boolean {
  if (!isRecord(value) || value.kind !== "route-plan") {
    return false;
  }
  for (const key of ["departureGateId", "destinationGateId", "shipProfileId"] as const) {
    if (!isStableIdValue(value[key])) {
      return false;
    }
  }
  for (const key of [
    "gateIds",
    "connectionIds",
    "selectedGateIds",
    "selectedConnectionIds",
  ] as const) {
    if (!isStableIdArray(value[key])) {
      return false;
    }
  }
  for (const key of ["selectedDwells", "strategicDwells", "legs"] as const) {
    if (!isRecordArray(value[key])) {
      return false;
    }
  }
  for (const key of [
    "strategicWaitDuration",
    "earliestArrivalLowerBound",
    "bestKnownUpperBound",
    "lowerBound",
    "upperBound",
    "arrivalCoordinateTime",
    "clusterCoordinateTime",
    "shipProperTime",
    "agingDifference",
    "totalClusterCoordinateTime",
    "totalShipProperTime",
    "totalAgingDifference",
  ] as const) {
    if (!isFiniteQuantity(value[key])) {
      return false;
    }
  }
  return (
    isQualityValue(value.refinementQuality) &&
    typeof value.refinementScore === "number" &&
    Number.isFinite(value.refinementScore) &&
    typeof value.globallyOptimal === "boolean" &&
    typeof value.optimality === "string" &&
    isRecord(value.timeline) &&
    isRecord(value.uncertainty) &&
    isRecord(value.arrivalCoordinateTimeBounds) &&
    isRecord(value.arrivalBounds) &&
    isRecord(value.bounds) &&
    isRecord(value.clockBounds) &&
    isRecord(value.summary)
  );
}

function isRoutePlanningResult(value: unknown): value is RoutePlanningResult {
  if (!isRecord(value) || (value.ok !== true && value.ok !== false)) {
    return false;
  }
  if (value.ok === true) {
    return (
      value.outcome === "success" &&
      isRoutePlanValue(value.plan) &&
      isRoutePlanValue(value.bestPlan) &&
      Array.isArray(value.alternatives) &&
      Array.isArray(value.sensitivity) &&
      Array.isArray(value.sensitivityAlternatives) &&
      isQualityValue(value.refinementQuality) &&
      isRecord(value.search) &&
      isFiniteQuantity(value.earliestArrivalLowerBound) &&
      isFiniteQuantity(value.bestKnownUpperBound) &&
      isRecord(value.bounds) &&
      typeof value.globallyOptimal === "boolean" &&
      typeof value.optimality === "string" &&
      Array.isArray(value.issues)
    );
  }
  return (
    (value.outcome === "invalid" ||
      value.outcome === "disconnected" ||
      value.outcome === "incomplete") &&
    value.plan === undefined &&
    value.bestPlan === undefined &&
    Array.isArray(value.alternatives) &&
    Array.isArray(value.sensitivity) &&
    Array.isArray(value.sensitivityAlternatives) &&
    value.refinementQuality === undefined &&
    Array.isArray(value.issues)
  );
}

function isClusterRoutePlanningResult(value: unknown): value is ClusterRoutePlanningResult {
  if (
    !isRecord(value) ||
    value.kind !== "cluster-route-planning" ||
    (value.ok !== true && value.ok !== false)
  ) {
    return false;
  }
  if (value.ok === true) {
    return (
      value.outcome === "success" &&
      isRoutePlanValue(value.plan) &&
      isRoutePlanValue(value.bestPlan) &&
      Array.isArray(value.alternatives) &&
      Array.isArray(value.sensitivity) &&
      Array.isArray(value.sensitivityAlternatives) &&
      isRecord(value.bounds) &&
      isFiniteQuantity(value.earliestArrivalLowerBound) &&
      isFiniteQuantity(value.bestKnownUpperBound) &&
      isFiniteQuantity(value.lowerBound) &&
      isFiniteQuantity(value.upperBound) &&
      isFiniteQuantity(value.conservativeUpperBound) &&
      isQualityValue(value.refinementQuality) &&
      typeof value.refinementScore === "number" &&
      isRecord(value.refinement) &&
      typeof value.globallyOptimal === "boolean" &&
      typeof value.optimality === "string" &&
      isRecord(value.search) &&
      Array.isArray(value.issues)
    );
  }
  return (
    (value.outcome === "invalid" ||
      value.outcome === "disconnected" ||
      value.outcome === "incomplete") &&
    value.plan === undefined &&
    value.bestPlan === undefined &&
    Array.isArray(value.alternatives) &&
    Array.isArray(value.sensitivity) &&
    Array.isArray(value.sensitivityAlternatives) &&
    value.bounds === undefined &&
    value.refinementQuality === undefined &&
    value.refinement === undefined &&
    Array.isArray(value.issues)
  );
}

function isGeneratedClusterRegion(value: unknown): value is WorkerGeneratedClusterRegion {
  if (
    !isRecord(value) ||
    value.kind !== "generated-cluster-region" ||
    value.ok !== true ||
    !isRecord(value.scenario) ||
    value.scenario.kind !== "centauri-scenario" ||
    !isRecord(value.hierarchy) ||
    value.hierarchy.kind !== "hierarchical-cluster-region" ||
    !isRecord(value.hierarchy.root) ||
    !isRecord(value.hierarchy.sourceRequest) ||
    !isRoutePlanningResult(value.route) ||
    !isRecord(value.routeRequest) ||
    (value.plan !== undefined && !isRoutePlanValue(value.plan))
  ) {
    return false;
  }
  const imported = importScenario(value.scenario);
  if (!imported.ok) {
    return false;
  }
  for (const key of [
    "generatedSystems",
    "generatedOrbitalAnchors",
    "generatedGates",
    "generatedConnections",
  ] as const) {
    if (!isRecordArray(value[key])) {
      return false;
    }
  }
  for (const key of [
    "generatedSystemIds",
    "generatedOrbitalAnchorIds",
    "generatedGateIds",
    "generatedConnectionIds",
  ] as const) {
    if (!isStableIdArray(value[key])) {
      return false;
    }
  }
  for (const key of [
    "generatedSystemDesignations",
    "generatedOrbitalAnchorDesignations",
    "generatedGateDesignations",
    "generatedConnectionDesignations",
  ] as const) {
    if (!isStringArray(value[key])) {
      return false;
    }
  }
  return isRecord(value.statistics) && isRecord(value.topology);
}

function operationResultIsValid(operation: WorkerPlanningOperation, result: unknown): boolean {
  if (operation === "generate") {
    return isGeneratedClusterRegion(result);
  }
  return operation === "plan"
    ? isRoutePlanningResult(result)
    : isClusterRoutePlanningResult(result);
}

function operationQuality(
  operation: WorkerPlanningOperation,
  result: WorkerResult | undefined,
): WorkerPlanningRefinementQuality {
  if (operation === "generate" || result === undefined) {
    return undefined;
  }
  if (operation === "refine") {
    return "hierarchical-bounded";
  }
  const resultRecord: RecordValue | undefined = isRecord(result) ? result : undefined;
  if (resultRecord?.ok === true && typeof resultRecord.refinementQuality === "string") {
    return resultRecord.refinementQuality as WorkerPlanningRefinementQuality;
  }
  return undefined;
}

function createEndpointReporter(
  port: { readonly postMessage: (message: unknown) => void },
  request: EndpointRequest,
  options: {
    readonly maxProgressEvents: number;
    readonly progressIntervalMs: number;
    readonly now: () => number;
  },
): {
  readonly report: (
    stage: WorkerPlanningStage,
    completedWork: number,
    refinementQuality: WorkerPlanningRefinementQuality,
    force?: boolean,
  ) => void;
  readonly completedWork: () => number;
} {
  let eventCount = 0;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let lastProgress: WorkerPlanningProgress | undefined;
  const totalWork = operationTotalWork(request.operation);
  return {
    report(stage, completedWork, refinementQuality, force = false) {
      const boundedWork = Math.max(0, Math.min(totalWork, Math.trunc(completedWork)));
      const previous = lastProgress;
      if (
        previous !== undefined &&
        (boundedWork < previous.completedWork || stageOrder[stage] < stageOrder[previous.stage])
      ) {
        return;
      }
      const now = options.now();
      if (
        !force &&
        (eventCount >= options.maxProgressEvents || now - lastSentAt < options.progressIntervalMs)
      ) {
        return;
      }
      if (eventCount >= options.maxProgressEvents) {
        return;
      }
      if (
        previous !== undefined &&
        boundedWork === previous.completedWork &&
        stage === previous.stage
      ) {
        return;
      }
      const progress = Object.freeze({
        protocolVersion: WORKER_PLANNING_PROTOCOL_VERSION,
        type: "progress" as const,
        requestId: request.requestId,
        operation: request.operation,
        stage,
        completedWork: boundedWork,
        totalWork,
        refinementQuality,
      });
      lastProgress = progress;
      eventCount += 1;
      lastSentAt = now;
      port.postMessage(progress);
    },
    completedWork() {
      return lastProgress?.completedWork ?? 0;
    },
  };
}

function schedulePromise(schedule: (callback: () => void) => void): Promise<void> {
  return new Promise((resolve) => schedule(resolve));
}

async function endpointOperation(
  port: { readonly postMessage: (message: unknown) => void },
  request: EndpointRequest,
  schedule: (callback: () => void) => void,
  reporter: ReturnType<typeof createEndpointReporter>,
): Promise<void> {
  let checkpointCount = 0;
  let currentStage: WorkerPlanningStage = "starting";
  let currentCompletedWork = 0;
  let currentQuality: WorkerPlanningRefinementQuality = undefined;
  const checkpoint = (): void => {
    if (cancellationWasRequested(request)) {
      throw new WorkerPlanningCancelled();
    }
    checkpointCount += 1;
    if (checkpointCount % 8 === 0) {
      reporter.report(
        currentStage,
        Math.min(operationTotalWork(request.operation) - 1, currentCompletedWork + 1),
        currentQuality,
      );
    }
  };
  const control: WorkerPlanningExecutionControl = { checkpoint };
  const checkpointAndYield = async (
    stage: WorkerPlanningStage,
    completedWork: number,
    quality: WorkerPlanningRefinementQuality,
  ): Promise<void> => {
    currentStage = stage;
    currentCompletedWork = completedWork;
    currentQuality = quality;
    checkpoint();
    reporter.report(stage, completedWork, quality, true);
    await schedulePromise(schedule);
    checkpoint();
  };

  try {
    await checkpointAndYield("starting", 0, undefined);
    if (request.operation === "generate") {
      await checkpointAndYield("generating", 1, undefined);
      const generated = generateClusterRegion(
        attachExecutionControl((request.payload as WorkerGenerationPayload).request, control),
      );
      const quality = generated.route.ok ? generated.route.refinementQuality : undefined;
      currentStage = "planning";
      currentCompletedWork = 2;
      currentQuality = quality;
      checkpoint();
      reporter.report("planning", 2, quality, true);
      await schedulePromise(schedule);
      checkpoint();
      const result = generatedRegionWireValue(generated);
      reporter.report("completed", 3, quality, true);
      port.postMessage(successResponse(request.requestId, request.operation, result));
    } else if (request.operation === "plan") {
      const payload = request.payload as WorkerRoutePlanningPayload;
      const scenario = decodeScenario(payload.scenario);
      await checkpointAndYield("planning", 1, undefined);
      const result = planJourney(scenario, attachExecutionControl(payload.request, control));
      checkpoint();
      const quality = operationQuality("plan", result);
      reporter.report("completed", 2, quality, true);
      port.postMessage(successResponse(request.requestId, request.operation, result));
    } else {
      const payload = request.payload as WorkerRefinementPayload;
      const hierarchy = generateHierarchicalCluster(
        attachExecutionControl(hierarchySourceRequest(payload.hierarchy), control),
      );
      await checkpointAndYield("refining", 1, "hierarchical-bounded");
      const result = planClusterRoute(hierarchy, attachExecutionControl(payload.request, control));
      checkpoint();
      reporter.report("completed", 3, operationQuality("refine", result), true);
      port.postMessage(successResponse(request.requestId, request.operation, result));
    }
  } catch (error) {
    if (isCancellationError(error) || cancellationWasRequested(request)) {
      reporter.report("cancelled", reporter.completedWork(), undefined, true);
      port.postMessage(
        failureResponse(
          request.requestId,
          request.operation,
          "cancelled",
          protocolError(
            "cancelled",
            "Worker planning was cancelled before the next bounded checkpoint.",
            request.requestId,
            request.operation,
          ),
        ),
      );
      return;
    }
    reporter.report("failed", reporter.completedWork(), undefined, true);
    port.postMessage(
      failureResponse(
        request.requestId,
        request.operation,
        "failed",
        protocolError(
          "operation-failed",
          "Worker planning operation failed.",
          request.requestId,
          request.operation,
          errorCause(error),
        ),
      ),
    );
  }
}

/**
 * Creates a framework-independent endpoint for a native Worker or test Worker-like port.
 *
 * The caller owns the runtime event hookup and should pass each incoming message's `data` value
 * to `handleMessage`. The endpoint schedules operation phases and checks cancellation between
 * phases and route/refinement candidate checkpoints. It never imports browser or Worker globals.
 *
 * @param port - A port whose `postMessage` sends protocol responses.
 * @param options - Progress limits and an injectable scheduler/clock.
 * @returns A bound endpoint that accepts request and cancellation messages and can be disposed.
 */
export function createWorkerPlanningEndpoint(
  port: { readonly postMessage: (message: unknown) => void },
  options: WorkerPlanningEndpointOptions = {},
): WorkerPlanningEndpoint {
  const maxProgressEvents = clampProgressLimit(options.maxProgressEvents);
  const progressIntervalMs = clampProgressInterval(options.progressIntervalMs);
  const schedule =
    options.schedule ??
    ((callback: () => void): void => {
      setTimeout(callback, 0);
    });
  const now = options.now ?? (() => Date.now());
  const active = new Map<string, EndpointRequest>();
  const completed = new Set<string>();
  let disposed = false;
  const send = (message: unknown): void => {
    if (!disposed) {
      port.postMessage(message);
    }
  };
  const sendError = (
    requestId: string | undefined,
    operation: WorkerPlanningOperation | undefined,
    code: WorkerPlanningErrorCode,
    message: string,
    cause: string | undefined = undefined,
  ): void => {
    send(
      protocolErrorMessage(
        requestId,
        operation,
        protocolError(code, message, requestId, operation, cause),
      ),
    );
  };
  const endpoint: WorkerPlanningEndpoint = {
    handleMessage(message) {
      if (disposed) {
        return;
      }
      const value = eventData(message);
      if (!isRecord(value)) {
        sendError(undefined, undefined, "malformed-message", "Worker request must be an object.");
        return;
      }
      const version = value.protocolVersion;
      if (version !== WORKER_PLANNING_PROTOCOL_VERSION) {
        const requestId = isRequestId(value.requestId) ? value.requestId : undefined;
        const operation = isOperation(value.operation) ? value.operation : undefined;
        sendError(
          requestId,
          operation,
          "protocol-version-mismatch",
          `Worker protocol version ${String(version)} is not supported; expected ${WORKER_PLANNING_PROTOCOL_VERSION}.`,
        );
        return;
      }
      if (value.type === "cancel") {
        if (!isRequestId(value.requestId)) {
          sendError(
            undefined,
            undefined,
            "malformed-message",
            "Cancellation requestId is invalid.",
          );
          return;
        }
        const request = active.get(value.requestId);
        if (request === undefined) {
          sendError(
            value.requestId,
            undefined,
            "stale-request",
            `Cancellation for request ${value.requestId} arrived after the request was settled.`,
          );
          return;
        }
        request.cancelled = true;
        markCancellation(request.cancellationToken);
        return;
      }
      if (value.type !== "request") {
        sendError(undefined, undefined, "malformed-message", "Worker message type is unsupported.");
        return;
      }
      const requestId = value.requestId;
      const operation = value.operation;
      if (!isRequestId(requestId) || !isOperation(operation) || !isRecord(value.payload)) {
        sendError(
          isRequestId(requestId) ? requestId : undefined,
          isOperation(operation) ? operation : undefined,
          "malformed-message",
          "Worker request requires a valid requestId, operation, and payload object.",
        );
        return;
      }
      if (!payloadShapeIsValid(operation, value.payload)) {
        send(
          failureResponse(
            requestId,
            operation,
            "malformed-message",
            protocolError(
              "malformed-message",
              "Worker request payload does not match its operation.",
              requestId,
              operation,
            ),
          ),
        );
        return;
      }
      const cancellationToken =
        hasOwn(value, "cancellationToken") && value.cancellationToken !== undefined
          ? sharedCancellationView(value.cancellationToken)
          : undefined;
      if (value.cancellationToken !== undefined && cancellationToken === undefined) {
        send(
          failureResponse(
            requestId,
            operation,
            "malformed-message",
            protocolError(
              "malformed-message",
              "Worker request cancellationToken was not a valid SharedArrayBuffer.",
              requestId,
              operation,
            ),
          ),
        );
        return;
      }
      if (active.has(requestId) || completed.has(requestId)) {
        sendError(
          undefined,
          operation,
          "duplicate-request",
          `Worker request ${requestId} was already received; duplicate requests are ignored.`,
        );
        return;
      }
      const request: EndpointRequest = {
        requestId,
        operation,
        payload: value.payload as WorkerPlanningPayload,
        cancellationToken,
        cancelled: false,
      };
      active.set(requestId, request);
      const reporter = createEndpointReporter({ postMessage: send }, request, {
        maxProgressEvents,
        progressIntervalMs,
        now,
      });
      schedule(() => {
        void endpointOperation({ postMessage: send }, request, schedule, reporter).finally(() => {
          active.delete(requestId);
          completed.add(requestId);
          if (completed.size > completedRequestsLimit) {
            const oldest = completed.values().next().value;
            if (typeof oldest === "string") {
              completed.delete(oldest);
            }
          }
        });
      });
    },
    dispose() {
      disposed = true;
      for (const request of active.values()) {
        request.cancelled = true;
      }
      active.clear();
      completed.clear();
    },
  };
  return endpoint;
}

/**
 * Creates a deterministic asynchronous Worker-like factory backed by an endpoint in this process.
 *
 * This is intended for Bun demonstrations and transport integration tests. Production browser or
 * Node callers should inject a native Worker factory; both use the same protocol and endpoint.
 *
 * @param options - Optional phase delay, endpoint progress, and scheduling controls.
 * @returns A fresh Worker-like port factory; every call creates isolated endpoint state.
 */
export function createInProcessWorkerFactory(
  options: WorkerPlanningEndpointOptions & { readonly phaseDelayMs?: number | undefined } = {},
): WorkerPlanningPortFactory {
  const phaseDelayMs = options.phaseDelayMs ?? 0;
  if (!Number.isFinite(phaseDelayMs) || phaseDelayMs < 0) {
    throw new RangeError("phaseDelayMs must be a finite non-negative number.");
  }
  return (): WorkerPlanningPort => {
    const messageListeners = new Set<(event: unknown) => void>();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let terminated = false;
    const schedule = (callback: () => void): void => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!terminated) {
          callback();
        }
      }, phaseDelayMs);
      timers.add(timer);
    };
    const endpointRef: { current: WorkerPlanningEndpoint | undefined } = { current: undefined };
    const port: WorkerPlanningPort = {
      postMessage(message) {
        if (terminated) {
          throw new Error("In-process Worker port has been terminated.");
        }
        if (isRecord(message) && message.type === "cancel") {
          queueMicrotask(() => endpointRef.current?.handleMessage(message));
          return;
        }
        schedule(() => endpointRef.current?.handleMessage(message));
      },
      terminate() {
        terminated = true;
        for (const timer of timers) {
          clearTimeout(timer);
        }
        timers.clear();
        endpoint.dispose();
      },
      addEventListener(type, listener) {
        if (type === "message") {
          messageListeners.add(listener);
        }
      },
      removeEventListener(type, listener) {
        if (type === "message") {
          messageListeners.delete(listener);
        }
      },
    };
    const endpoint = createWorkerPlanningEndpoint(
      {
        postMessage(message) {
          if (terminated) {
            return;
          }
          queueMicrotask(() => {
            if (terminated) {
              return;
            }
            const event = Object.freeze({ data: message });
            for (const listener of messageListeners) {
              listener(event);
            }
          });
        },
      },
      { ...options, schedule },
    );
    endpointRef.current = endpoint;
    return port;
  };
}

/**
 * Creates a versioned worker request after validating its correlation fields.
 *
 * @param requestId - A unique stable request identifier.
 * @param operation - The operation to execute.
 * @param payload - The operation payload.
 * @param cancellationToken - Optional shared cancellation flag for synchronous native-worker loops.
 * @returns An immutable protocol request message.
 * @throws RangeError when the request ID or operation is invalid.
 */
export function createWorkerPlanningRequest(
  requestId: string,
  operation: WorkerPlanningOperation,
  payload: WorkerPlanningPayload,
  cancellationToken?: SharedArrayBuffer,
): WorkerPlanningRequestMessage {
  if (!isRequestId(requestId)) {
    throw new RangeError(`Worker requestId ${JSON.stringify(requestId)} is invalid.`);
  }
  if (!isOperation(operation)) {
    throw new RangeError(`Worker operation ${JSON.stringify(operation)} is invalid.`);
  }
  if (cancellationToken !== undefined && sharedCancellationView(cancellationToken) === undefined) {
    throw new RangeError(
      "Worker cancellationToken must be a SharedArrayBuffer with at least 4 bytes.",
    );
  }
  return Object.freeze({
    protocolVersion: WORKER_PLANNING_PROTOCOL_VERSION,
    type: "request" as const,
    requestId,
    operation,
    payload,
    cancellationToken,
  });
}

function defaultWorkerFactory(): WorkerPlanningPortFactory {
  return createInProcessWorkerFactory();
}

type NormalizedAdapterOptions = {
  readonly workerFactory: WorkerPlanningPortFactory;
  readonly onProgress: ((progress: WorkerPlanningProgress) => void) | undefined;
  readonly maxProgressEvents: number;
  readonly progressIntervalMs: number;
  readonly requestIdPrefix: string;
};

function normalizeAdapterOptions(
  optionsOrFactory: WorkerPlanningAdapterOptions | WorkerPlanningPortFactory | undefined,
): NormalizedAdapterOptions {
  const options: WorkerPlanningAdapterOptions =
    typeof optionsOrFactory === "function"
      ? { workerFactory: optionsOrFactory }
      : (optionsOrFactory ?? {});
  return {
    workerFactory: options.workerFactory ?? defaultWorkerFactory(),
    onProgress: options.onProgress,
    maxProgressEvents: clampProgressLimit(options.maxProgressEvents),
    progressIntervalMs: clampProgressInterval(options.progressIntervalMs),
    requestIdPrefix: options.requestIdPrefix ?? "worker-request",
  };
}

function makeImmediateFailure<Result>(
  requestId: string,
  operation: WorkerPlanningOperation,
  outcome: Exclude<WorkerPlanningOutcome, "success">,
  error: WorkerPlanningError,
): WorkerPlanningTask<Result> {
  const response = failureResponse(requestId, operation, outcome, error);
  return Object.freeze({
    requestId,
    promise: Promise.resolve(response),
    cancel: () => false,
  });
}

/**
 * Creates the asynchronous client adapter for worker planning operations.
 *
 * The adapter lazily starts one injected Worker-like port, correlates every response by request ID,
 * and keeps repeated/concurrent requests independent. Startup and transport failures resolve as
 * structured terminal responses instead of rejecting the caller's Promise. Native transports use a
 * shared cancellation flag so synchronous domain checkpoints can stop promptly; a transport without
 * shared memory is terminated on cancellation and unaffected in-flight requests are replayed on a
 * replacement port. The no-argument form uses the deterministic in-process factory for demos;
 * production runtimes should inject a native Worker factory.
 *
 * @param optionsOrFactory - Adapter configuration or a Worker-like port factory.
 * @returns An adapter exposing generation, route planning, refinement, cancellation, and diagnostics.
 */
export function createWorkerPlanningAdapter(
  optionsOrFactory?: WorkerPlanningAdapterOptions | WorkerPlanningPortFactory,
): WorkerPlanningAdapter {
  const options = normalizeAdapterOptions(optionsOrFactory);
  const pending = new Map<string, PendingRequest>();
  const completed = new Set<string>();
  const diagnostics: WorkerPlanningDiagnostic[] = [];
  let sequence = 0;
  let worker: WorkerPlanningPort | undefined;
  let startupPromise: Promise<WorkerPlanningPort> | undefined;
  let disposed = false;
  let detach: (() => void) | undefined;

  const addDiagnostic = (
    code: WorkerPlanningDiagnosticCode,
    message: string,
    requestId: string | undefined,
    operation: WorkerPlanningOperation | undefined,
  ): void => {
    diagnostics.push(Object.freeze({ code, message, requestId, operation }));
    if (diagnostics.length > diagnosticsLimit) {
      diagnostics.shift();
    }
  };
  const rememberCompleted = (requestId: string): void => {
    completed.add(requestId);
    if (completed.size > completedRequestsLimit) {
      const oldest = completed.values().next().value;
      if (typeof oldest === "string") {
        completed.delete(oldest);
      }
    }
  };
  const settle = (
    request: PendingRequest,
    response: WorkerPlanningTerminalResponse<WorkerResult>,
  ): void => {
    if (!pending.delete(request.requestId)) {
      return;
    }
    rememberCompleted(request.requestId);
    request.resolve(response);
  };
  const settleFailure = (
    request: PendingRequest,
    outcome: Exclude<WorkerPlanningOutcome, "success">,
    code: WorkerPlanningErrorCode,
    message: string,
    cause: string | undefined = undefined,
  ): void => {
    settle(
      request,
      failureResponse(
        request.requestId,
        request.operation,
        outcome,
        protocolError(code, message, request.requestId, request.operation, cause),
      ),
    );
  };
  const crash = (value: unknown): void => {
    const crashedWorker = worker;
    worker = undefined;
    startupPromise = undefined;
    detach?.();
    detach = undefined;
    for (const request of [...pending.values()]) {
      settleFailure(
        request,
        "worker-crashed",
        "worker-crashed",
        "Worker transport crashed while the request was in flight.",
        errorCause(value),
      );
    }
    if (crashedWorker?.terminate !== undefined) {
      try {
        void Promise.resolve(crashedWorker.terminate()).catch(() => {
          // The crash outcome is already recoverable; termination is best effort.
        });
      } catch {
        // The crash outcome is already recoverable; termination is best effort.
      }
    }
  };
  const onIncoming = (event: unknown): void => {
    const value = eventData(event);
    if (!isRecord(value)) {
      addDiagnostic(
        "malformed-message",
        "Worker response must be an object.",
        undefined,
        undefined,
      );
      return;
    }
    const requestId = value.requestId;
    const operation = isOperation(value.operation) ? value.operation : undefined;
    if (value.protocolVersion !== WORKER_PLANNING_PROTOCOL_VERSION) {
      const id = isRequestId(requestId) ? requestId : undefined;
      addDiagnostic(
        "protocol-version-mismatch",
        `Worker response protocol version ${String(value.protocolVersion)} is unsupported.`,
        id,
        operation,
      );
      const pendingRequest = id === undefined ? undefined : pending.get(id);
      if (pendingRequest !== undefined) {
        settleFailure(
          pendingRequest,
          "malformed-message",
          "protocol-version-mismatch",
          "Worker response used an unsupported protocol version.",
        );
      }
      return;
    }
    if (value.type === "error") {
      const id = isRequestId(requestId) ? requestId : undefined;
      const pendingRequest = id === undefined ? undefined : pending.get(id);
      const error = isRecord(value.error) ? value.error : undefined;
      if (pendingRequest === undefined) {
        addDiagnostic(
          id === undefined ? "malformed-message" : "stale-response",
          "An uncorrelated worker protocol error was received.",
          id,
          operation,
        );
        return;
      }
      if (
        error === undefined ||
        !isErrorCode(error.code) ||
        typeof error.message !== "string" ||
        error.recoverable !== true
      ) {
        settleFailure(
          pendingRequest,
          "malformed-message",
          "malformed-message",
          "Worker protocol error was malformed.",
        );
        return;
      }
      settleFailure(
        pendingRequest,
        error.code === "cancelled" ? "cancelled" : "malformed-message",
        error.code,
        error.message,
        typeof error.cause === "string" ? error.cause : undefined,
      );
      return;
    }
    if (value.type === "progress") {
      if (!isRequestId(requestId) || !isOperation(value.operation)) {
        const pendingRequest = isRequestId(requestId) ? pending.get(requestId) : undefined;
        if (pendingRequest !== undefined) {
          settleFailure(
            pendingRequest,
            "malformed-message",
            "malformed-message",
            "Worker progress correlation fields are invalid.",
          );
        }
        addDiagnostic(
          "malformed-message",
          "Worker progress correlation fields are invalid.",
          isRequestId(requestId) ? requestId : undefined,
          operation,
        );
        return;
      }
      const request = pending.get(requestId);
      if (request === undefined) {
        addDiagnostic(
          completed.has(requestId) ? "stale-response" : "malformed-message",
          `Progress for request ${requestId} arrived after it was settled.`,
          requestId,
          value.operation,
        );
        return;
      }
      if (request.operation !== value.operation) {
        settleFailure(
          request,
          "malformed-message",
          "malformed-message",
          "Worker progress operation did not match its request.",
        );
        return;
      }
      const completedWorkValue = value.completedWork;
      const totalWorkValue = value.totalWork;
      const stageValue = value.stage;
      if (
        typeof completedWorkValue !== "number" ||
        typeof totalWorkValue !== "number" ||
        !Number.isSafeInteger(completedWorkValue) ||
        !Number.isSafeInteger(totalWorkValue) ||
        totalWorkValue !== operationTotalWork(request.operation) ||
        totalWorkValue < 1 ||
        completedWorkValue < 0 ||
        completedWorkValue > totalWorkValue ||
        typeof stageValue !== "string" ||
        !Object.prototype.hasOwnProperty.call(stageOrder, stageValue)
      ) {
        settleFailure(
          request,
          "malformed-message",
          "malformed-message",
          "Worker progress work accounting was malformed.",
        );
        return;
      }
      const completedWork = completedWorkValue;
      const totalWork = totalWorkValue;
      const stage = stageValue as WorkerPlanningStage;
      const refinementQualityValue = value.refinementQuality;
      if (refinementQualityValue !== undefined && !isRefinementQuality(refinementQualityValue)) {
        settleFailure(
          request,
          "malformed-message",
          "malformed-message",
          "Worker progress refinement quality was malformed.",
        );
        return;
      }
      const refinementQuality = refinementQualityValue as WorkerPlanningRefinementQuality;
      const progress = Object.freeze({
        protocolVersion: WORKER_PLANNING_PROTOCOL_VERSION,
        type: "progress" as const,
        requestId,
        operation: value.operation,
        stage,
        completedWork,
        totalWork,
        refinementQuality,
      });
      const previous = request.lastProgress;
      if (
        previous !== undefined &&
        completedWork === previous.completedWork &&
        stage === previous.stage
      ) {
        addDiagnostic(
          "duplicate-progress",
          `Duplicate progress for request ${requestId}.`,
          requestId,
          operation,
        );
        return;
      }
      if (
        previous !== undefined &&
        (totalWork !== previous.totalWork ||
          completedWork < previous.completedWork ||
          stageOrder[progress.stage] < stageOrder[previous.stage])
      ) {
        addDiagnostic(
          "out-of-order-progress",
          `Out-of-order progress for request ${requestId} was ignored.`,
          requestId,
          operation,
        );
        return;
      }
      request.lastProgress = progress;
      const terminalProgress =
        progress.stage === "completed" ||
        progress.stage === "cancelled" ||
        progress.stage === "failed";
      const stageChanged = previous === undefined || progress.stage !== previous.stage;
      if (
        request.progressCount >= options.maxProgressEvents ||
        (!terminalProgress &&
          !stageChanged &&
          Date.now() - request.lastProgressAt < options.progressIntervalMs)
      ) {
        return;
      }
      request.progressCount += 1;
      request.lastProgressAt = Date.now();
      const callbacks = [request.onProgress, options.onProgress];
      for (const callback of callbacks) {
        if (callback === undefined) {
          continue;
        }
        try {
          callback(progress);
        } catch (error) {
          addDiagnostic(
            "progress-handler-failed",
            "A progress callback threw while handling worker progress.",
            requestId,
            operation,
          );
          void error;
        }
      }
      return;
    }
    if (value.type !== "result" || !isRequestId(requestId) || !isOperation(value.operation)) {
      const pendingRequest = isRequestId(requestId) ? pending.get(requestId) : undefined;
      if (pendingRequest !== undefined) {
        settleFailure(
          pendingRequest,
          "malformed-message",
          "malformed-message",
          "Worker terminal response correlation fields are invalid.",
        );
      }
      addDiagnostic(
        "malformed-message",
        "Worker terminal response was malformed.",
        isRequestId(requestId) ? requestId : undefined,
        operation,
      );
      return;
    }
    const request = pending.get(requestId);
    if (request === undefined) {
      addDiagnostic(
        completed.has(requestId) ? "duplicate-response" : "stale-response",
        `Worker response for request ${requestId} arrived after it was settled.`,
        requestId,
        value.operation,
      );
      return;
    }
    if (request.operation !== value.operation || typeof value.ok !== "boolean") {
      settleFailure(
        request,
        "malformed-message",
        "malformed-message",
        "Worker terminal response did not match its request.",
      );
      return;
    }
    if (value.ok === true) {
      if (
        !hasOwn(value, "result") ||
        value.outcome !== "success" ||
        !hasOwn(value, "error") ||
        value.error !== undefined ||
        !operationResultIsValid(request.operation, value.result)
      ) {
        settleFailure(
          request,
          "malformed-message",
          "malformed-message",
          "Worker success response did not contain the required result shape.",
        );
        return;
      }
      settle(request, successResponse(requestId, request.operation, value.result as WorkerResult));
      return;
    }
    const error = value.error;
    if (
      !isRecord(error) ||
      !isErrorCode(error.code) ||
      typeof error.message !== "string" ||
      error.recoverable !== true ||
      (value.outcome !== "cancelled" &&
        value.outcome !== "startup-failed" &&
        value.outcome !== "malformed-message" &&
        value.outcome !== "worker-crashed" &&
        value.outcome !== "disposed" &&
        value.outcome !== "failed")
    ) {
      settleFailure(
        request,
        "malformed-message",
        "malformed-message",
        "Worker failure response omitted a structured error.",
      );
      return;
    }
    const outcome = value.outcome;
    settle(
      request,
      failureResponse(
        requestId,
        request.operation,
        outcome,
        protocolError(
          error.code as WorkerPlanningErrorCode,
          error.message,
          requestId,
          request.operation,
          typeof error.cause === "string" ? error.cause : undefined,
        ),
      ),
    );
  };
  const attach = (nextWorker: WorkerPlanningPort): WorkerPlanningPort => {
    if (typeof nextWorker.postMessage !== "function") {
      throw new TypeError("Worker factory must return a Worker-like port with postMessage.");
    }
    const onMessage = (event: unknown): void => {
      if (worker !== nextWorker) {
        addDiagnostic(
          "stale-response",
          "A response from an older Worker port was ignored.",
          undefined,
          undefined,
        );
        return;
      }
      onIncoming(event);
    };
    const onError = (event: unknown): void => {
      if (worker !== nextWorker) {
        return;
      }
      addDiagnostic(
        "worker-message-error",
        "Worker transport emitted an error.",
        undefined,
        undefined,
      );
      crash(event);
    };
    const onMessageError = (event: unknown): void => {
      if (worker !== nextWorker) {
        return;
      }
      addDiagnostic(
        "worker-message-error",
        "Worker transport rejected a message.",
        undefined,
        undefined,
      );
      crash(event);
    };
    if (nextWorker.addEventListener !== undefined) {
      nextWorker.addEventListener("message", onMessage);
      nextWorker.addEventListener("error", onError);
      nextWorker.addEventListener("messageerror", onMessageError);
      detach = () => {
        nextWorker.removeEventListener?.("message", onMessage);
        nextWorker.removeEventListener?.("error", onError);
        nextWorker.removeEventListener?.("messageerror", onMessageError);
      };
    } else {
      nextWorker.onmessage = onMessage;
      nextWorker.onerror = onError;
      nextWorker.onmessageerror = onMessageError;
      detach = () => {
        nextWorker.onmessage = null;
        nextWorker.onerror = null;
        nextWorker.onmessageerror = null;
      };
    }
    return nextWorker;
  };
  const ensureWorker = (): Promise<WorkerPlanningPort> => {
    if (disposed) {
      return Promise.reject(new Error("Worker planning adapter has been disposed."));
    }
    if (worker !== undefined) {
      return Promise.resolve(worker);
    }
    if (startupPromise !== undefined) {
      return startupPromise;
    }
    startupPromise = Promise.resolve()
      .then(() => options.workerFactory())
      .then(async (nextWorker) => {
        if (disposed) {
          try {
            await nextWorker.terminate?.();
          } catch {
            // Disposal remains complete even when a late Worker refuses termination.
          }
          throw new Error("Worker planning adapter was disposed during startup.");
        }
        try {
          worker = attach(nextWorker);
          return worker;
        } catch (error) {
          try {
            await nextWorker.terminate?.();
          } catch {
            // Startup remains a recoverable failure when an invalid Worker refuses termination.
          }
          throw error;
        }
      })
      .catch((error) => {
        startupPromise = undefined;
        for (const request of [...pending.values()]) {
          if (!request.sent) {
            settleFailure(
              request,
              "startup-failed",
              "startup-failed",
              "Worker could not start; the request can be retried.",
              errorCause(error),
            );
          }
        }
        throw error;
      });
    return startupPromise;
  };
  const sendRequest = (nextWorker: WorkerPlanningPort, request: PendingRequest): void => {
    if (
      worker !== nextWorker ||
      !pending.has(request.requestId) ||
      request.cancelRequested ||
      request.sent ||
      disposed
    ) {
      return;
    }
    request.sent = true;
    try {
      nextWorker.postMessage(request.message);
    } catch (error) {
      crash(error);
    }
  };
  const restartWorkerForCancellation = (oldWorker: WorkerPlanningPort): void => {
    if (worker !== oldWorker) {
      return;
    }
    worker = undefined;
    startupPromise = undefined;
    detach?.();
    detach = undefined;
    for (const request of pending.values()) {
      request.sent = false;
    }
    if (oldWorker.terminate !== undefined) {
      try {
        void Promise.resolve(oldWorker.terminate()).catch(() => {
          // The canceled request is already settled; termination is best effort.
        });
      } catch {
        // The canceled request is already settled; termination is best effort.
      }
    }
    void ensureWorker()
      .then((nextWorker) => {
        for (const request of [...pending.values()]) {
          sendRequest(nextWorker, request);
        }
      })
      .catch(() => {
        // ensureWorker settles requests waiting for replacement startup.
      });
  };
  const nextRequestId = (): string => {
    sequence += 1;
    const candidate = `${options.requestIdPrefix}-${String(sequence).padStart(6, "0")}`;
    if (!isRequestId(candidate)) {
      throw new RangeError("requestIdPrefix must produce a stable request identifier.");
    }
    return candidate;
  };
  const cancelRequest = (requestId: string): boolean => {
    const request = pending.get(requestId);
    if (request === undefined) {
      return false;
    }
    request.cancelRequested = true;
    markCancellation(request.cancellationToken);
    const currentWorker = worker;
    const wasSent = request.sent;
    settleFailure(
      request,
      "cancelled",
      "cancelled",
      "Worker planning cancellation was requested before the next result was accepted.",
    );
    if (wasSent && currentWorker !== undefined) {
      if (request.cancellationToken === undefined) {
        restartWorkerForCancellation(currentWorker);
        return true;
      }
      try {
        currentWorker.postMessage(
          Object.freeze({
            protocolVersion: WORKER_PLANNING_PROTOCOL_VERSION,
            type: "cancel" as const,
            requestId,
          }),
        );
      } catch (error) {
        crash(error);
      }
    }
    return true;
  };
  const submit = (
    operation: WorkerPlanningOperation,
    payload: WorkerPlanningPayload,
    requestOptions: WorkerPlanningRequestOptions | undefined,
  ): WorkerPlanningTask<WorkerResult> => {
    const requestId = nextRequestId();
    if (disposed) {
      return makeImmediateFailure(
        requestId,
        operation,
        "disposed",
        protocolError(
          "disposed",
          "Worker planning adapter has been disposed.",
          requestId,
          operation,
        ),
      );
    }
    let resolve!: (response: WorkerPlanningTerminalResponse<WorkerResult>) => void;
    const promise = new Promise<WorkerPlanningTerminalResponse<WorkerResult>>((resolver) => {
      resolve = resolver;
    });
    const cancellationTokenBuffer = createSharedCancellationToken();
    const cancellationToken = sharedCancellationView(cancellationTokenBuffer);
    const message = createWorkerPlanningRequest(
      requestId,
      operation,
      payload,
      cancellationTokenBuffer,
    );
    const request: PendingRequest = {
      requestId,
      operation,
      resolve,
      onProgress: requestOptions?.onProgress,
      message,
      sent: false,
      cancelRequested: false,
      progressCount: 0,
      lastProgressAt: Number.NEGATIVE_INFINITY,
      lastProgress: undefined,
      cancellationToken,
    };
    pending.set(requestId, request);
    queueMicrotask(() => {
      if (!pending.has(requestId) || request.cancelRequested || disposed) {
        return;
      }
      void ensureWorker()
        .then((nextWorker) => sendRequest(nextWorker, request))
        .catch(() => {
          // ensureWorker settles every request waiting for the failed startup.
        });
    });
    return Object.freeze({
      requestId,
      promise,
      cancel: () => cancelRequest(requestId),
    });
  };
  const submitSafe = <Result extends WorkerResult>(
    operation: WorkerPlanningOperation,
    payload: WorkerPlanningPayload,
    requestOptions: WorkerPlanningRequestOptions | undefined,
  ): WorkerPlanningTask<Result> =>
    submit(operation, payload, requestOptions) as WorkerPlanningTask<Result>;

  const adapter: WorkerPlanningAdapter = {
    submit(operation, payload, requestOptions) {
      return submit(operation, payload, requestOptions);
    },
    generate(request, requestOptions) {
      try {
        return submitSafe<WorkerGeneratedClusterRegion>(
          "generate",
          { request: normalizeGenerationRequest(request) },
          requestOptions,
        );
      } catch (error) {
        const requestId = nextRequestId();
        return makeImmediateFailure(
          requestId,
          "generate",
          "failed",
          protocolError(
            "operation-failed",
            "Generation request could not be prepared for transport.",
            requestId,
            "generate",
            errorCause(error),
          ),
        );
      }
    },
    plan(scenario, request, requestOptions) {
      try {
        return submitSafe<RoutePlanningResult>(
          "plan",
          { scenario: normalizeScenarioSource(scenario), request },
          requestOptions,
        );
      } catch (error) {
        const requestId = nextRequestId();
        return makeImmediateFailure(
          requestId,
          "plan",
          "failed",
          protocolError(
            "operation-failed",
            "Route request could not be prepared for transport.",
            requestId,
            "plan",
            errorCause(error),
          ),
        );
      }
    },
    refine(hierarchy, request, requestOptions) {
      try {
        return submitSafe<ClusterRoutePlanningResult>(
          "refine",
          { hierarchy: hierarchySourceRequest(hierarchy), request },
          requestOptions,
        );
      } catch (error) {
        const requestId = nextRequestId();
        return makeImmediateFailure(
          requestId,
          "refine",
          "failed",
          protocolError(
            "operation-failed",
            "Refinement request could not be prepared for transport.",
            requestId,
            "refine",
            errorCause(error),
          ),
        );
      }
    },
    cancel(requestId) {
      return cancelRequest(requestId);
    },
    activeRequestIds() {
      return Object.freeze([...pending.keys()]);
    },
    getDiagnostics() {
      return Object.freeze([...diagnostics]);
    },
    async dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      const pendingStartup = startupPromise;
      for (const request of [...pending.values()]) {
        settleFailure(
          request,
          "disposed",
          "disposed",
          "Worker planning adapter was disposed while the request was in flight.",
        );
      }
      if (pendingStartup !== undefined) {
        try {
          await pendingStartup;
        } catch {
          // Startup failures are already represented by request outcomes or disposal.
        }
      }
      detach?.();
      detach = undefined;
      const currentWorker = worker;
      worker = undefined;
      startupPromise = undefined;
      if (currentWorker?.terminate !== undefined) {
        try {
          await currentWorker.terminate();
        } catch {
          // Disposal remains complete even when a runtime refuses termination.
        }
      }
    },
  };
  return Object.freeze(adapter);
}
