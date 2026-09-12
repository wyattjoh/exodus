import { seconds, type Seconds } from "./quantities";
import type {
  CompiledGate,
  CompiledGateConnection,
  CompiledScenario,
  DomainEntityType,
  StableId,
} from "./model";
import {
  conservativeBounds,
  conservativeUncertaintyWidth,
  createDisplayPrecision,
} from "./provenance";
import type {
  ConservativeBounds,
  DisplayPrecision,
  Provenance,
  ProvenanceKind,
} from "./provenance";
import { simulateMultiLegJourney } from "./simulation";
import type {
  JourneyClockReading,
  JourneyDwellTimeline,
  JourneyLeg,
  JourneyRequest,
  MultiLegJourneySimulationResult,
  MultiLegJourneyTimeline,
  SimulationIssue,
} from "./simulation";

const stableIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_REPORTED_SIMULATION_ISSUES = 32;
const MAX_STRATEGIC_DWELL_CANDIDATES = 4_096;
const STRATEGIC_DWELL_GRID_SIZE = 32;
const STRATEGIC_DWELL_REFINEMENT_LEVELS = 4;
const STRATEGIC_DWELL_REFINEMENT_SUBDIVISIONS = 8;
const PROVENANCE_AUTHORITY_RANK: Readonly<Record<Provenance["authority"], number>> = Object.freeze({
  novel: 4,
  "supplementary-official": 3,
  "scenario-override": 2,
  assumption: 1,
  generator: 0,
});

/**
 * The maximum number of route candidates and search states accepted by one explicit planner call.
 *
 * Keeping request budgets below this ceiling prevents an explicitly finite request from becoming
 * an effectively unbounded operation.
 */
export const MAX_ROUTE_PLANNING_BUDGET = 1_000_000;

/**
 * A finite exact-search budget for explicit-network route planning.
 */
export type RoutePlanningSearchBudget = {
  readonly maxCandidateRoutes: number;
  readonly maxSearchStates: number;
};

/**
 * Quality of the nominal result reported by the bounded route planner.
 */
export type RoutePlanningRefinementQuality = "exact" | "bounded-strategic-dwell";

/**
 * Default finite budget used when a route request does not provide one.
 */
export const DEFAULT_ROUTE_PLANNING_SEARCH_BUDGET: RoutePlanningSearchBudget = Object.freeze({
  maxCandidateRoutes: 10_000,
  maxSearchStates: 100_000,
});

/**
 * Default number of non-winning Route Plans retained in a successful result.
 */
export const DEFAULT_ROUTE_PLANNING_MAX_ALTERNATIVES = 10;

/**
 * Search accounting returned for a completed or budget-exhausted planning operation.
 */
export type RoutePlanningSearchStats = {
  readonly candidateRoutesEvaluated: number;
  readonly searchStatesExpanded: number;
  readonly strategicDwellCandidatesEvaluated: number;
  readonly routesPrunedByHorizon: number;
  /** True only when no continuous strategic-wait domain was requested and no hard ceiling was hit. */
  readonly strategicDwellSearchComplete: boolean;
  readonly refinementQuality: RoutePlanningRefinementQuality;
  readonly budget: RoutePlanningSearchBudget;
};

type RecordValue = Record<string, unknown>;

/**
 * One user-selected Dwell to insert whenever a route visits a Gate.
 */
export type RouteDwellSelection = {
  readonly gateId: StableId;
  readonly duration: Seconds;
};

/**
 * The finite horizons accepted by an explicit-network route query.
 *
 * At least one horizon is required. `latestArrivalCoordinateTime` is an absolute Scenario epoch;
 * `maximumStrategicWait` is a duration relative to the route departure and bounds inserted waits.
 */
export type RoutePlanningHorizon = {
  readonly latestArrivalCoordinateTime: Seconds | undefined;
  readonly maximumStrategicWait: Seconds | undefined;
};

/**
 * Provenance fields used to include or exclude route data without changing its nominal cost.
 */
export type RouteProvenanceFilter = {
  readonly allowedKinds: readonly ProvenanceKind[] | undefined;
  readonly excludedKinds: readonly ProvenanceKind[] | undefined;
  readonly allowedAuthorities: readonly Provenance["authority"][] | undefined;
  readonly minimumAuthority: Provenance["authority"] | undefined;
};

/**
 * A strategic Dwell that was inserted because it improved a route's final nominal arrival.
 */
export type StrategicDwellInsertion = {
  readonly kind: "strategic-dwell";
  readonly gateId: StableId;
  readonly locationGateId: StableId;
  readonly duration: Seconds;
  readonly startCoordinateTime: Seconds;
  readonly endCoordinateTime: Seconds;
  readonly arrivalCoordinateTime: Seconds;
  readonly clusterCoordinateTime: Seconds;
  readonly shipProperTime: Seconds;
  readonly agingDifference: Seconds;
  readonly clockEffects: JourneyClockReading;
  readonly clocks: JourneyClockReading;
  readonly arrivalTimeBenefit: Seconds;
  readonly benefit: Seconds;
  readonly baselineArrivalCoordinateTime: Seconds;
  readonly optimizedArrivalCoordinateTime: Seconds;
};

/**
 * Alias for a strategic Dwell record at the route-planning seam.
 */
export type StrategicDwell = StrategicDwellInsertion;

/**
 * Route-specific uncertainty used to widen every affected simulated phase.
 */
export type RouteUncertaintySummary = {
  readonly hasUncertainty: boolean;
  readonly relativeFactor: number;
  readonly absoluteSeconds: number;
  readonly propertyPaths: readonly string[];
  readonly displayPrecision: DisplayPrecision;
};

/**
 * One non-winning route whose conservative arrival range could overlap or beat the nominal winner.
 */
export type RouteSensitivity = {
  readonly gateIds: readonly StableId[];
  readonly connectionIds: readonly StableId[];
  readonly strategicDwells: readonly StrategicDwellInsertion[];
  readonly nominalArrivalCoordinateTime: Seconds;
  readonly nominalArrival: Seconds;
  readonly arrivalCoordinateTimeBounds: ConservativeBounds<Seconds>;
  readonly possibleArrivalRange: ConservativeBounds<Seconds>;
  readonly arrivalBounds: ConservativeBounds<Seconds>;
  readonly nominalArrivalDifference: Seconds;
  readonly overlapsNominalWinner: boolean;
  readonly couldBeatNominalWinner: boolean;
  readonly reason: "arrival-ranges-overlap" | "could-beat-nominal-winner";
};

/**
 * Alias for the Dwell selection terminology used by the Journey Model specification.
 */
export type JourneyRouteDwell = RouteDwellSelection;

/**
 * A request to search a finite, explicitly compiled Gate network.
 *
 * Every request must provide a finite latest-arrival or strategic-wait horizon. The planner
 * evaluates nominal physics only when ranking routes. Uncertainty bounds remain on every returned
 * Journey Timeline and are not used as a secondary route objective. `searchBudget` bounds exact
 * candidate expansion; exhaustion returns `incomplete` rather than a partial winner.
 */
export type RoutePlanningRequest = {
  readonly departureGateId: StableId;
  readonly destinationGateId: StableId;
  readonly shipProfileId: StableId;
  readonly departureCoordinateTime: Seconds | undefined;
  readonly dwells: readonly RouteDwellSelection[] | undefined;
  readonly latestArrivalCoordinateTime?: Seconds | undefined;
  readonly maximumStrategicWait?: Seconds | undefined;
  readonly provenanceFilter?: RouteProvenanceFilter | undefined;
  readonly maxAlternatives: number | undefined;
  readonly searchBudget: RoutePlanningSearchBudget | undefined;
};

/**
 * Alias for a route request at the public Journey Model seam.
 */
export type JourneyPlanningRequest = RoutePlanningRequest;

/**
 * The nominal summary used to compare one valid Route Plan with another.
 */
export type RoutePlanSummary = {
  readonly clusterCoordinateTime: Seconds;
  readonly shipProperTime: Seconds;
  readonly agingDifference: Seconds;
  readonly gateLegCount: number;
};

/**
 * A complete valid Route Plan and its simulated continuous Journey Timeline.
 */
export type RoutePlan = {
  readonly kind: "route-plan";
  readonly departureGateId: StableId;
  readonly destinationGateId: StableId;
  readonly shipProfileId: StableId;
  readonly gateIds: readonly StableId[];
  readonly connectionIds: readonly StableId[];
  readonly selectedGateIds: readonly StableId[];
  readonly selectedConnectionIds: readonly StableId[];
  readonly selectedDwells: readonly RouteDwellSelection[];
  readonly strategicDwells: readonly StrategicDwellInsertion[];
  readonly strategicWaitDuration: Seconds;
  readonly refinementQuality: RoutePlanningRefinementQuality;
  readonly legs: readonly JourneyLeg[];
  readonly timeline: MultiLegJourneyTimeline;
  readonly uncertainty: RouteUncertaintySummary;
  readonly arrivalCoordinateTimeBounds: ConservativeBounds<Seconds>;
  readonly arrivalBounds: ConservativeBounds<Seconds>;
  readonly bounds: MultiLegJourneyTimeline["bounds"];
  readonly clockBounds: MultiLegJourneyTimeline["clockBounds"];
  readonly arrivalCoordinateTime: Seconds;
  readonly clusterCoordinateTime: Seconds;
  readonly shipProperTime: Seconds;
  readonly agingDifference: Seconds;
  readonly totalClusterCoordinateTime: Seconds;
  readonly totalShipProperTime: Seconds;
  readonly totalAgingDifference: Seconds;
  readonly gateLegCount: number;
  readonly summary: RoutePlanSummary;
};

/**
 * Alias for callers that use Journey-first naming for the selected Route Plan.
 */
export type JourneyRoutePlan = RoutePlan;

/**
 * Structured route-planning issue categories.
 */
export type RoutePlanningIssueCode =
  | "invalid-request"
  | "missing-horizon"
  | "invalid-horizon"
  | "horizon-exceeded"
  | "unknown-gate"
  | "provenance-filtered"
  | "unknown-ship-profile"
  | "missing-zpz-generator"
  | "invalid-dwell"
  | "invalid-gate-network"
  | "disconnected"
  | "no-valid-route"
  | "search-budget-exhausted"
  | SimulationIssue["code"];

/**
 * A structured explanation of an invalid request, disconnected network, or failed candidate route.
 */
export type RoutePlanningIssue = {
  readonly code: RoutePlanningIssueCode;
  readonly path: string;
  readonly message: string;
  readonly entityType: DomainEntityType | undefined;
  readonly entityId: StableId | undefined;
  readonly relatedId: StableId | undefined;
  readonly causeCode: SimulationIssue["code"] | undefined;
};

/**
 * The outcome category of an explicit-network route-planning operation.
 */
export type RoutePlanningOutcome = "success" | "disconnected" | "invalid" | "incomplete";

/**
 * A successful explicit-network route-planning result. `alternatives` is capped by the request;
 * `refinementQuality` distinguishes exact route enumeration from bounded strategic-wait search.
 */
export type RoutePlanningSuccess = {
  readonly ok: true;
  readonly outcome: "success";
  readonly plan: RoutePlan;
  readonly bestPlan: RoutePlan;
  readonly alternatives: readonly RoutePlan[];
  readonly sensitivity: readonly RouteSensitivity[];
  readonly sensitivityAlternatives: readonly RouteSensitivity[];
  readonly refinementQuality: RoutePlanningRefinementQuality;
  readonly search: RoutePlanningSearchStats;
  readonly issues: readonly [];
};

/**
 * An unsuccessful explicit-network route-planning result. An `incomplete` result never includes a
 * partial Route Plan because the search did not prove nominal earliest arrival.
 */
export type RoutePlanningFailure = {
  readonly ok: false;
  readonly outcome: "disconnected" | "invalid" | "incomplete";
  readonly plan: undefined;
  readonly bestPlan: undefined;
  readonly alternatives: readonly [];
  readonly sensitivity: readonly [];
  readonly sensitivityAlternatives: readonly [];
  readonly refinementQuality: undefined;
  readonly search: RoutePlanningSearchStats | undefined;
  readonly issues: readonly RoutePlanningIssue[];
};

/**
 * The discriminated result returned by explicit-network route planning.
 */
export type RoutePlanningResult = RoutePlanningSuccess | RoutePlanningFailure;

/**
 * Alias for Journey-first naming of the route-planning result.
 */
export type JourneyPlanningResult = RoutePlanningResult;

/**
 * Alias for the explicit-network Route Plan returned by the Journey Model.
 */
export type ExplicitRoutePlan = RoutePlan;

type ParsedRoutePlanningRequest = {
  readonly departureGateId: StableId;
  readonly destinationGateId: StableId;
  readonly shipProfileId: StableId;
  readonly departureCoordinateTime: Seconds;
  readonly dwells: ReadonlyMap<StableId, readonly Seconds[]>;
  readonly latestArrivalCoordinateTime: Seconds | undefined;
  readonly maximumStrategicWait: Seconds | undefined;
  readonly effectiveMaximumStrategicWait: Seconds;
  readonly provenanceFilter: RouteProvenanceFilter;
  readonly maxAlternatives: number | undefined;
  readonly searchBudget: RoutePlanningSearchBudget;
};

type RouteNetwork = {
  readonly gateById: ReadonlyMap<StableId, CompiledGate>;
  readonly connectionByGate: ReadonlyMap<StableId, CompiledGateConnection>;
  readonly pairedGateById: ReadonlyMap<StableId, StableId>;
  readonly gatesBySystem: ReadonlyMap<StableId, readonly StableId[]>;
};

type RoutePath = {
  readonly gateIds: readonly StableId[];
  readonly connectionIds: readonly StableId[];
  readonly legs: readonly JourneyLeg[];
};

type StrategicDwellState = {
  readonly gateId: StableId;
  readonly duration: Seconds;
  readonly arrivalBefore: Seconds;
  readonly arrivalAfter: Seconds;
};

type RouteCandidateSummary = {
  readonly gateIds: readonly StableId[];
  readonly connectionIds: readonly StableId[];
  readonly strategicDwells: readonly StrategicDwellInsertion[];
  readonly arrivalCoordinateTime: Seconds;
  readonly arrivalCoordinateTimeBounds: ConservativeBounds<Seconds>;
  readonly shipProperTime: Seconds;
  readonly gateLegCount: number;
};

type OptimizedRouteCandidate = {
  readonly path: RoutePath;
  readonly timeline: MultiLegJourneyTimeline;
  readonly strategicDwells: readonly StrategicDwellState[];
  readonly uncertainty: RouteUncertaintySummary;
};

type RouteSearchState = {
  candidateRoutesEvaluated: number;
  searchStatesExpanded: number;
  strategicDwellCandidatesEvaluated: number;
  routesPrunedByHorizon: number;
  strategicDwellSearchComplete: boolean;
  exhausted: boolean;
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: RecordValue, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function addIssue(
  issues: RoutePlanningIssue[],
  code: RoutePlanningIssueCode,
  path: string,
  message: string,
  entityType: DomainEntityType | undefined,
  entityId: StableId | undefined,
  relatedId: StableId | undefined,
  causeCode: SimulationIssue["code"] | undefined = undefined,
): void {
  issues.push(
    Object.freeze({
      code,
      path,
      message,
      entityType,
      entityId,
      relatedId,
      causeCode,
    }),
  );
}

function failure(
  outcome: "disconnected" | "invalid" | "incomplete",
  issues: readonly RoutePlanningIssue[],
  search: RoutePlanningSearchStats | undefined = undefined,
): RoutePlanningFailure {
  const sortedIssues = [...issues].sort((left, right) => {
    const pathComparison = left.path.localeCompare(right.path);
    return pathComparison === 0 ? left.code.localeCompare(right.code) : pathComparison;
  });
  return Object.freeze({
    ok: false as const,
    outcome,
    plan: undefined,
    bestPlan: undefined,
    alternatives: Object.freeze([] as const),
    sensitivity: Object.freeze([] as const),
    sensitivityAlternatives: Object.freeze([] as const),
    refinementQuality: undefined,
    search,
    issues: Object.freeze(sortedIssues),
  });
}

function readRequestId(
  record: RecordValue,
  key: string,
  issues: RoutePlanningIssue[],
): StableId | undefined {
  const value = record[key];
  if (typeof value === "string" && stableIdentifierPattern.test(value)) {
    return value as StableId;
  }
  addIssue(
    issues,
    "invalid-request",
    `request.${key}`,
    `request.${key} must be a stable identifier string.`,
    undefined,
    undefined,
    undefined,
  );
  return undefined;
}

function readSeconds(
  value: unknown,
  path: string,
  issues: RoutePlanningIssue[],
  issueCode: RoutePlanningIssueCode = "invalid-request",
): Seconds | undefined {
  if (!isRecord(value) || value.unit !== "s" || typeof value.value !== "number") {
    addIssue(
      issues,
      issueCode,
      path,
      `${path} must be a finite SI duration with unit s.`,
      undefined,
      undefined,
      undefined,
    );
    return undefined;
  }
  if (!Number.isFinite(value.value)) {
    addIssue(
      issues,
      issueCode,
      path,
      `${path} must contain a finite numeric value.`,
      undefined,
      undefined,
      undefined,
    );
    return undefined;
  }
  return seconds(value.value);
}

function readHorizonSeconds(
  value: unknown,
  path: string,
  issues: RoutePlanningIssue[],
): Seconds | undefined {
  return readSeconds(value, path, issues, "invalid-horizon");
}

function readProvenanceKindList(
  value: unknown,
  path: string,
  issues: RoutePlanningIssue[],
): readonly ProvenanceKind[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const values = Array.isArray(value) ? value : [value];
  const kinds: ProvenanceKind[] = [];
  for (const [index, candidate] of values.entries()) {
    if (
      candidate !== "novel" &&
      candidate !== "supplementary-official" &&
      candidate !== "provisional" &&
      candidate !== "generated" &&
      candidate !== "override"
    ) {
      addIssue(
        issues,
        "invalid-request",
        `${path}[${index}]`,
        `${path}[${index}] must be a supported Provenance kind.`,
        undefined,
        undefined,
        undefined,
      );
      continue;
    }
    kinds.push(candidate);
  }
  return Object.freeze(kinds);
}

function readProvenanceAuthorityList(
  value: unknown,
  path: string,
  issues: RoutePlanningIssue[],
): readonly Provenance["authority"][] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const values = Array.isArray(value) ? value : [value];
  const authorities: Provenance["authority"][] = [];
  for (const [index, candidate] of values.entries()) {
    if (
      candidate !== "novel" &&
      candidate !== "supplementary-official" &&
      candidate !== "assumption" &&
      candidate !== "generator" &&
      candidate !== "scenario-override"
    ) {
      addIssue(
        issues,
        "invalid-request",
        `${path}[${index}]`,
        `${path}[${index}] must be a supported Provenance authority.`,
        undefined,
        undefined,
        undefined,
      );
      continue;
    }
    authorities.push(candidate);
  }
  return Object.freeze(authorities);
}

function firstDefinedProperty(record: RecordValue, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (hasOwn(record, key) && record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
}

function readProvenanceFilter(
  request: RecordValue,
  issues: RoutePlanningIssue[],
): RouteProvenanceFilter | undefined {
  const rawFilter = firstDefinedProperty(request, ["provenanceFilter", "routeProvenanceFilter"]);
  if (rawFilter === undefined) {
    return Object.freeze({
      allowedKinds: undefined,
      excludedKinds: undefined,
      allowedAuthorities: undefined,
      minimumAuthority: undefined,
    });
  }
  if (!isRecord(rawFilter)) {
    addIssue(
      issues,
      "invalid-request",
      "request.provenanceFilter",
      "request.provenanceFilter must be an object.",
      undefined,
      undefined,
      undefined,
    );
    return undefined;
  }
  const allowedKinds = readProvenanceKindList(
    firstDefinedProperty(rawFilter, ["allowedKinds", "allowedProvenanceKinds", "includeKinds"]),
    "request.provenanceFilter.allowedKinds",
    issues,
  );
  const excludedKinds = readProvenanceKindList(
    firstDefinedProperty(rawFilter, ["excludedKinds", "excludedProvenanceKinds", "excludeKinds"]),
    "request.provenanceFilter.excludedKinds",
    issues,
  );
  const allowedAuthorities = readProvenanceAuthorityList(
    firstDefinedProperty(rawFilter, ["allowedAuthorities", "includeAuthorities"]),
    "request.provenanceFilter.allowedAuthorities",
    issues,
  );
  const minimumAuthorityValue = firstDefinedProperty(rawFilter, [
    "minimumAuthority",
    "minimumProvenanceAuthority",
  ]);
  let minimumAuthority: Provenance["authority"] | undefined;
  if (minimumAuthorityValue !== undefined) {
    const parsed = readProvenanceAuthorityList(
      minimumAuthorityValue,
      "request.provenanceFilter.minimumAuthority",
      issues,
    );
    if (parsed?.length === 1) {
      minimumAuthority = parsed[0];
    } else if (parsed !== undefined && parsed.length !== 1) {
      addIssue(
        issues,
        "invalid-request",
        "request.provenanceFilter.minimumAuthority",
        "request.provenanceFilter.minimumAuthority must be one authority string.",
        undefined,
        undefined,
        undefined,
      );
    }
  }
  return Object.freeze({ allowedKinds, excludedKinds, allowedAuthorities, minimumAuthority });
}

function readRouteHorizon(
  request: RecordValue,
  departureCoordinateTime: Seconds,
  issues: RoutePlanningIssue[],
): RoutePlanningHorizon | undefined {
  const horizon = isRecord(request.horizon) ? request.horizon : undefined;
  const latestValue =
    firstDefinedProperty(request, [
      "latestArrivalCoordinateTime",
      "latestArrivalTime",
      "latestArrival",
    ]) ??
    (horizon === undefined
      ? undefined
      : firstDefinedProperty(horizon, [
          "latestArrivalCoordinateTime",
          "latestArrivalTime",
          "latestArrival",
        ]));
  const maximumWaitValue =
    firstDefinedProperty(request, [
      "maximumStrategicWait",
      "maxStrategicWait",
      "strategicWaitHorizon",
      "maximumWait",
    ]) ??
    (horizon === undefined
      ? undefined
      : firstDefinedProperty(horizon, [
          "maximumStrategicWait",
          "maxStrategicWait",
          "strategicWaitHorizon",
          "maximumWait",
        ]));
  const latestArrivalCoordinateTime =
    latestValue === undefined
      ? undefined
      : readHorizonSeconds(latestValue, "request.latestArrivalCoordinateTime", issues);
  const maximumStrategicWait =
    maximumWaitValue === undefined
      ? undefined
      : readHorizonSeconds(maximumWaitValue, "request.maximumStrategicWait", issues);

  if (latestArrivalCoordinateTime === undefined && maximumStrategicWait === undefined) {
    addIssue(
      issues,
      "missing-horizon",
      "request.horizon",
      "Every route request must provide a finite latestArrivalCoordinateTime or maximumStrategicWait horizon.",
      undefined,
      undefined,
      undefined,
    );
  }
  if (
    latestArrivalCoordinateTime !== undefined &&
    latestArrivalCoordinateTime.value < departureCoordinateTime.value
  ) {
    addIssue(
      issues,
      "invalid-horizon",
      "request.latestArrivalCoordinateTime",
      "request.latestArrivalCoordinateTime must be at or after departureCoordinateTime.",
      undefined,
      undefined,
      undefined,
    );
  }
  if (maximumStrategicWait !== undefined && maximumStrategicWait.value < 0) {
    addIssue(
      issues,
      "invalid-horizon",
      "request.maximumStrategicWait",
      "request.maximumStrategicWait must be non-negative.",
      undefined,
      undefined,
      undefined,
    );
  }
  return Object.freeze({ latestArrivalCoordinateTime, maximumStrategicWait });
}

function readDwellList(
  request: RecordValue,
  issues: RoutePlanningIssue[],
): readonly RouteDwellSelection[] | undefined {
  const key = hasOwn(request, "dwells")
    ? "dwells"
    : hasOwn(request, "selectedDwells")
      ? "selectedDwells"
      : hasOwn(request, "dwellSelections")
        ? "dwellSelections"
        : undefined;
  if (key === undefined || request[key] === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(request[key])) {
    addIssue(
      issues,
      "invalid-request",
      `request.${key}`,
      `request.${key} must be an array of selected Dwells.`,
      undefined,
      undefined,
      undefined,
    );
    return undefined;
  }

  const dwells: RouteDwellSelection[] = [];
  for (const [index, value] of request[key].entries()) {
    const path = `request.${key}[${index}]`;
    if (!isRecord(value)) {
      addIssue(
        issues,
        "invalid-dwell",
        path,
        `${path} must be an object.`,
        undefined,
        undefined,
        undefined,
      );
      continue;
    }
    const gateId =
      typeof value.gateId === "string" && stableIdentifierPattern.test(value.gateId)
        ? (value.gateId as StableId)
        : undefined;
    if (gateId === undefined) {
      addIssue(
        issues,
        "invalid-dwell",
        `${path}.gateId`,
        `${path}.gateId must be a stable identifier string.`,
        undefined,
        undefined,
        undefined,
      );
    }
    const duration = readSeconds(value.duration, `${path}.duration`, issues);
    if (duration !== undefined && duration.value < 0) {
      addIssue(
        issues,
        "invalid-dwell",
        `${path}.duration`,
        `${path}.duration must be non-negative.`,
        undefined,
        undefined,
        undefined,
      );
    }
    if (gateId !== undefined && duration !== undefined && duration.value >= 0) {
      dwells.push(Object.freeze({ gateId, duration }));
    }
  }
  return Object.freeze(dwells);
}

function readMaxAlternatives(
  request: RecordValue,
  issues: RoutePlanningIssue[],
): number | undefined {
  if (!hasOwn(request, "maxAlternatives") || request.maxAlternatives === undefined) {
    return undefined;
  }
  const value = request.maxAlternatives;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_ROUTE_PLANNING_BUDGET
  ) {
    addIssue(
      issues,
      "invalid-request",
      "request.maxAlternatives",
      `request.maxAlternatives must be an integer from 0 through ${MAX_ROUTE_PLANNING_BUDGET}.`,
      undefined,
      undefined,
      undefined,
    );
    return undefined;
  }
  return value;
}

function readBudgetInteger(
  value: unknown,
  path: string,
  issues: RoutePlanningIssue[],
): number | undefined {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_ROUTE_PLANNING_BUDGET
  ) {
    addIssue(
      issues,
      "invalid-request",
      path,
      `${path} must be an integer from 1 through ${MAX_ROUTE_PLANNING_BUDGET}.`,
      undefined,
      undefined,
      undefined,
    );
    return undefined;
  }
  return value;
}

function readSearchBudget(
  request: RecordValue,
  issues: RoutePlanningIssue[],
): RoutePlanningSearchBudget | undefined {
  const defaultBudget = DEFAULT_ROUTE_PLANNING_SEARCH_BUDGET;
  let candidateValue: unknown = undefined;
  let stateValue: unknown = undefined;
  if (hasOwn(request, "searchBudget") && request.searchBudget !== undefined) {
    if (typeof request.searchBudget === "number") {
      candidateValue = request.searchBudget;
    } else if (isRecord(request.searchBudget)) {
      candidateValue =
        request.searchBudget.maxCandidateRoutes ?? request.searchBudget.maxCandidates;
      stateValue = request.searchBudget.maxSearchStates ?? request.searchBudget.maxSearchNodes;
    } else {
      addIssue(
        issues,
        "invalid-request",
        "request.searchBudget",
        "request.searchBudget must be a finite budget object or candidate count.",
        undefined,
        undefined,
        undefined,
      );
      return undefined;
    }
  }
  if (candidateValue === undefined) {
    for (const key of ["maxCandidateRoutes", "maxCandidates", "candidateBudget"]) {
      if (hasOwn(request, key)) {
        candidateValue = request[key];
        break;
      }
    }
  }
  if (stateValue === undefined) {
    for (const key of ["maxSearchStates", "maxSearchNodes"]) {
      if (hasOwn(request, key)) {
        stateValue = request[key];
        break;
      }
    }
  }
  const maxCandidateRoutes =
    candidateValue === undefined
      ? defaultBudget.maxCandidateRoutes
      : readBudgetInteger(candidateValue, "request.searchBudget.maxCandidateRoutes", issues);
  const maxSearchStates =
    stateValue === undefined
      ? defaultBudget.maxSearchStates
      : readBudgetInteger(stateValue, "request.searchBudget.maxSearchStates", issues);
  if (maxCandidateRoutes === undefined || maxSearchStates === undefined) {
    return undefined;
  }
  return Object.freeze({ maxCandidateRoutes, maxSearchStates });
}

function readRequest(
  request: unknown,
  defaultDepartureCoordinateTime: Seconds,
  issues: RoutePlanningIssue[],
): ParsedRoutePlanningRequest | undefined {
  if (!isRecord(request)) {
    addIssue(
      issues,
      "invalid-request",
      "request",
      "Route-planning request must be an object.",
      undefined,
      undefined,
      undefined,
    );
    return undefined;
  }
  const departureGateId = readRequestId(request, "departureGateId", issues);
  const destinationGateId = readRequestId(request, "destinationGateId", issues);
  const shipProfileId = readRequestId(request, "shipProfileId", issues);
  const departureCoordinateTime =
    !hasOwn(request, "departureCoordinateTime") || request.departureCoordinateTime === undefined
      ? defaultDepartureCoordinateTime
      : readSeconds(request.departureCoordinateTime, "request.departureCoordinateTime", issues);
  const dwells = readDwellList(request, issues);
  const maxAlternatives = readMaxAlternatives(request, issues);
  const searchBudget = readSearchBudget(request, issues);
  const routeHorizon = readRouteHorizon(
    request,
    departureCoordinateTime ?? defaultDepartureCoordinateTime,
    issues,
  );
  const provenanceFilter = readProvenanceFilter(request, issues);
  if (
    departureGateId === undefined ||
    destinationGateId === undefined ||
    shipProfileId === undefined ||
    departureCoordinateTime === undefined ||
    dwells === undefined ||
    searchBudget === undefined ||
    routeHorizon === undefined ||
    provenanceFilter === undefined ||
    issues.length > 0
  ) {
    return undefined;
  }

  const maximumWaitFromLatestArrival =
    routeHorizon.latestArrivalCoordinateTime === undefined
      ? Number.POSITIVE_INFINITY
      : routeHorizon.latestArrivalCoordinateTime.value - departureCoordinateTime.value;
  const requestedMaximumWait = routeHorizon.maximumStrategicWait?.value ?? Number.POSITIVE_INFINITY;
  const effectiveMaximumStrategicWait = seconds(
    Math.max(0, Math.min(requestedMaximumWait, maximumWaitFromLatestArrival)),
  );
  if (!Number.isFinite(effectiveMaximumStrategicWait.value)) {
    addIssue(
      issues,
      "invalid-horizon",
      "request.horizon",
      "The route horizon must produce a finite strategic-wait bound.",
      undefined,
      undefined,
      undefined,
    );
    return undefined;
  }

  const dwellByGate = new Map<StableId, Seconds[]>();
  for (const dwell of dwells) {
    const existing = dwellByGate.get(dwell.gateId);
    if (existing === undefined) {
      dwellByGate.set(dwell.gateId, [dwell.duration]);
    } else {
      existing.push(dwell.duration);
    }
  }
  return Object.freeze({
    departureGateId,
    destinationGateId,
    shipProfileId,
    departureCoordinateTime,
    dwells: new Map(
      [...dwellByGate.entries()].map(([gateId, durations]) => [gateId, Object.freeze(durations)]),
    ),
    latestArrivalCoordinateTime: routeHorizon.latestArrivalCoordinateTime,
    maximumStrategicWait: routeHorizon.maximumStrategicWait,
    effectiveMaximumStrategicWait,
    provenanceFilter,
    maxAlternatives,
    searchBudget,
  });
}

type ProvenanceEntity = {
  readonly provenance: Provenance;
  readonly properties: Readonly<Record<string, { readonly provenance: Provenance } | undefined>>;
};

function provenanceIsAllowed(provenance: Provenance, filter: RouteProvenanceFilter): boolean {
  if (filter.allowedKinds !== undefined && !filter.allowedKinds.includes(provenance.kind)) {
    return false;
  }
  if (filter.excludedKinds?.includes(provenance.kind) === true) {
    return false;
  }
  if (
    filter.allowedAuthorities !== undefined &&
    !filter.allowedAuthorities.includes(provenance.authority)
  ) {
    return false;
  }
  if (
    filter.minimumAuthority !== undefined &&
    PROVENANCE_AUTHORITY_RANK[provenance.authority] <
      PROVENANCE_AUTHORITY_RANK[filter.minimumAuthority]
  ) {
    return false;
  }
  return true;
}

function routeEntityIsAllowed(
  entity: ProvenanceEntity,
  relevantProperties: readonly string[],
  filter: RouteProvenanceFilter,
): boolean {
  if (!provenanceIsAllowed(entity.provenance, filter)) {
    return false;
  }
  return relevantProperties.every((property) => {
    const metadata = entity.properties[property];
    return metadata === undefined || provenanceIsAllowed(metadata.provenance, filter);
  });
}

function routeGateIsAllowed(
  scenario: CompiledScenario,
  gate: CompiledGate,
  filter: RouteProvenanceFilter,
): boolean {
  const anchor = scenario.index.orbitalAnchors.get(gate.orbitalAnchorId);
  const system = scenario.index.systems.get(gate.systemId);
  return (
    routeEntityIsAllowed(
      gate,
      ["systemId", "orbitalAnchorId", "positionAtEpoch", "velocityAtEpoch", "orbitalElements"],
      filter,
    ) &&
    anchor !== undefined &&
    routeEntityIsAllowed(
      anchor,
      ["systemId", "parentId", "positionAtEpoch", "velocityAtEpoch", "orbitalElements"],
      filter,
    ) &&
    system !== undefined &&
    routeEntityIsAllowed(system, ["positionAtEpoch", "velocityAtEpoch"], filter)
  );
}

function routeShipProfileIsAllowed(
  scenario: CompiledScenario,
  shipProfileId: StableId,
  filter: RouteProvenanceFilter,
): boolean {
  const shipProfile = scenario.index.shipProfiles.get(shipProfileId);
  return (
    shipProfile !== undefined &&
    routeEntityIsAllowed(
      shipProfile,
      ["acceleration", "brakingAcceleration", "maximumSublightSpeed", "hasZpzGenerator"],
      filter,
    )
  );
}

function validateNetwork(
  scenario: CompiledScenario,
  filter: RouteProvenanceFilter,
  issues: RoutePlanningIssue[],
): RouteNetwork | undefined {
  const allGateById = new Map<StableId, CompiledGate>();
  for (const gate of scenario.gates) {
    allGateById.set(gate.id, gate);
  }

  const allConnectionByGate = new Map<StableId, CompiledGateConnection>();
  for (const connection of scenario.gateConnections) {
    const gateA = allGateById.get(connection.gateAId);
    const gateB = allGateById.get(connection.gateBId);
    if (gateA === undefined || gateB === undefined) {
      addIssue(
        issues,
        "invalid-gate-network",
        `gateConnections.${connection.id}`,
        `Gate Connection ${connection.id} references Gates that are not in the compiled Scenario.`,
        "gate-connection",
        connection.id,
        gateA === undefined ? connection.gateAId : connection.gateBId,
      );
      continue;
    }
    if (gateA.id === gateB.id || gateA.systemId === gateB.systemId) {
      addIssue(
        issues,
        "invalid-gate-network",
        `gateConnections.${connection.id}`,
        `Gate Connection ${connection.id} must join two distinct Gates in different Systems.`,
        "gate-connection",
        connection.id,
        gateB.id,
      );
      continue;
    }
    if (allConnectionByGate.has(gateA.id)) {
      addIssue(
        issues,
        "invalid-gate-network",
        `gateConnections.${connection.id}.gateAId`,
        `Gate ${gateA.id} belongs to more than one Gate Connection.`,
        "gate-connection",
        connection.id,
        gateA.id,
      );
    }
    if (allConnectionByGate.has(gateB.id)) {
      addIssue(
        issues,
        "invalid-gate-network",
        `gateConnections.${connection.id}.gateBId`,
        `Gate ${gateB.id} belongs to more than one Gate Connection.`,
        "gate-connection",
        connection.id,
        gateB.id,
      );
    }
    allConnectionByGate.set(gateA.id, connection);
    allConnectionByGate.set(gateB.id, connection);
  }
  for (const gate of scenario.gates) {
    if (!allConnectionByGate.has(gate.id)) {
      addIssue(
        issues,
        "invalid-gate-network",
        `gates.${gate.id}`,
        `Gate ${gate.id} must belong to exactly one Gate Connection.`,
        "gate",
        gate.id,
        undefined,
      );
    }
  }
  if (issues.length > 0) {
    return undefined;
  }

  const gateById = new Map<StableId, CompiledGate>();
  const gatesBySystem = new Map<StableId, StableId[]>();
  for (const gate of scenario.gates) {
    if (!routeGateIsAllowed(scenario, gate, filter)) {
      continue;
    }
    gateById.set(gate.id, gate);
    const systemGates = gatesBySystem.get(gate.systemId);
    if (systemGates === undefined) {
      gatesBySystem.set(gate.systemId, [gate.id]);
    } else {
      systemGates.push(gate.id);
    }
  }
  for (const gateIds of gatesBySystem.values()) {
    gateIds.sort((left, right) => left.localeCompare(right));
  }

  const connectionByGate = new Map<StableId, CompiledGateConnection>();
  const pairedGateById = new Map<StableId, StableId>();
  for (const connection of scenario.gateConnections) {
    if (
      !provenanceIsAllowed(connection.provenance, filter) ||
      !gateById.has(connection.gateAId) ||
      !gateById.has(connection.gateBId)
    ) {
      continue;
    }
    connectionByGate.set(connection.gateAId, connection);
    connectionByGate.set(connection.gateBId, connection);
    pairedGateById.set(connection.gateAId, connection.gateBId);
    pairedGateById.set(connection.gateBId, connection.gateAId);
  }
  return Object.freeze({ gateById, connectionByGate, pairedGateById, gatesBySystem });
}

function topologyIsConnected(
  network: RouteNetwork,
  departureGateId: StableId,
  destinationGateId: StableId,
): boolean {
  const visited = new Set<StableId>([departureGateId]);
  const pending: StableId[] = [departureGateId];
  while (pending.length > 0) {
    const currentGateId = pending.shift();
    if (currentGateId === undefined) {
      continue;
    }
    if (currentGateId === destinationGateId) {
      return true;
    }
    const pairedGateId = network.pairedGateById.get(currentGateId);
    if (pairedGateId !== undefined && !visited.has(pairedGateId)) {
      visited.add(pairedGateId);
      pending.push(pairedGateId);
    }
    const currentGate = network.gateById.get(currentGateId);
    if (currentGate === undefined) {
      continue;
    }
    for (const sameSystemGateId of network.gatesBySystem.get(currentGate.systemId) ?? []) {
      if (!visited.has(sameSystemGateId)) {
        visited.add(sameSystemGateId);
        pending.push(sameSystemGateId);
      }
    }
  }
  return false;
}

function appendDwell(
  path: RoutePath,
  gateId: StableId,
  dwells: ReadonlyMap<StableId, readonly Seconds[]>,
): RoutePath {
  const durations = dwells.get(gateId);
  if (durations === undefined) {
    return path;
  }
  return Object.freeze({
    gateIds: path.gateIds,
    connectionIds: path.connectionIds,
    legs: Object.freeze([
      ...path.legs,
      ...durations.map((duration) => Object.freeze({ kind: "dwell" as const, duration })),
    ]),
  });
}

function appendTransfer(path: RoutePath, destinationGateId: StableId): RoutePath {
  return Object.freeze({
    gateIds: Object.freeze([...path.gateIds, destinationGateId]),
    connectionIds: path.connectionIds,
    legs: Object.freeze([
      ...path.legs,
      Object.freeze({ kind: "in-system-transfer" as const, destinationGateId }),
    ]),
  });
}

function appendCruise(
  path: RoutePath,
  destinationGateId: StableId,
  connectionId: StableId,
): RoutePath {
  return Object.freeze({
    gateIds: Object.freeze([...path.gateIds, destinationGateId]),
    connectionIds: Object.freeze([...path.connectionIds, connectionId]),
    legs: Object.freeze([
      ...path.legs,
      Object.freeze({ kind: "interstellar-cruise" as const, destinationGateId }),
    ]),
  });
}

function routeUncertainty(
  scenario: CompiledScenario,
  path: RoutePath,
  shipProfileId: StableId,
): RouteUncertaintySummary {
  let relativeFactor = 0;
  let absoluteSeconds = 0;
  let hasUncertainty = false;
  const propertyPaths = new Set<string>();
  let displayPrecision = createDisplayPrecision({}, "default");
  const visitedEntities = new Set<StableId>();
  const visitEntity = (
    label: string,
    entity:
      | CompiledScenario["systems"][number]
      | CompiledScenario["orbitalAnchors"][number]
      | CompiledScenario["gates"][number]
      | CompiledScenario["gateConnections"][number]
      | CompiledScenario["shipProfiles"][number],
    relevantProperties: readonly string[],
  ): void => {
    if (visitedEntities.has(entity.id)) {
      return;
    }
    visitedEntities.add(entity.id);
    for (const property of relevantProperties) {
      const metadata = entity.properties[property];
      if (metadata === undefined) {
        continue;
      }
      if (metadata.displayPrecision.significantDigits < displayPrecision.significantDigits) {
        displayPrecision = metadata.displayPrecision;
      }
      if (metadata.bounds === undefined) {
        continue;
      }
      const width = conservativeUncertaintyWidth(metadata.bounds);
      if (!width.hasUncertainty) {
        continue;
      }
      hasUncertainty = true;
      relativeFactor += width.relativeFactor;
      absoluteSeconds += width.absoluteSeconds;
      propertyPaths.add(`${label}.${property}`);
    }
  };

  const gateIds = new Set(path.gateIds);
  for (const gateId of gateIds) {
    const gate = scenario.index.gates.get(gateId);
    if (gate === undefined) {
      continue;
    }
    visitEntity(gate.id, gate, ["positionAtEpoch", "velocityAtEpoch", "orbitalElements"]);
    const anchor = scenario.index.orbitalAnchors.get(gate.orbitalAnchorId);
    if (anchor !== undefined) {
      visitEntity(anchor.id, anchor, ["positionAtEpoch", "velocityAtEpoch", "orbitalElements"]);
    }
    const system = scenario.index.systems.get(gate.systemId);
    if (system !== undefined) {
      visitEntity(system.id, system, ["positionAtEpoch", "velocityAtEpoch"]);
    }
  }
  for (const connectionId of path.connectionIds) {
    const connection = scenario.index.gateConnections.get(connectionId);
    if (connection !== undefined) {
      visitEntity(connection.id, connection, []);
    }
  }
  const shipProfile = scenario.index.shipProfiles.get(shipProfileId);
  if (shipProfile !== undefined) {
    visitEntity(shipProfile.id, shipProfile, [
      "acceleration",
      "brakingAcceleration",
      "maximumSublightSpeed",
      "hasZpzGenerator",
    ]);
  }

  return Object.freeze({
    hasUncertainty,
    relativeFactor: Number.isFinite(relativeFactor) ? Math.max(0, relativeFactor) : 0,
    absoluteSeconds: Number.isFinite(absoluteSeconds) ? Math.max(0, absoluteSeconds) : 0,
    propertyPaths: Object.freeze([...propertyPaths].sort()),
    displayPrecision,
  });
}

function simulationScenarioForRoute(
  scenario: CompiledScenario,
  path: RoutePath,
  shipProfileId: StableId,
): { readonly scenario: CompiledScenario; readonly uncertainty: RouteUncertaintySummary } {
  const uncertainty = routeUncertainty(scenario, path, shipProfileId);
  return {
    scenario: Object.freeze({
      ...scenario,
      uncertainty: Object.freeze(uncertainty),
    }),
    uncertainty,
  };
}

function arrivalCoordinateTimeBounds(
  request: ParsedRoutePlanningRequest,
  timeline: MultiLegJourneyTimeline,
): ConservativeBounds<Seconds> {
  const lower = seconds(
    request.departureCoordinateTime.value + timeline.totalBounds.lower.clusterCoordinateTime.value,
  );
  const upper = seconds(
    request.departureCoordinateTime.value + timeline.totalBounds.upper.clusterCoordinateTime.value,
  );
  return conservativeBounds(
    timeline.arrivalCoordinateTime,
    lower,
    upper,
    timeline.displayPrecision,
  );
}

function routeIsWithinHorizon(
  request: ParsedRoutePlanningRequest,
  timeline: MultiLegJourneyTimeline,
): boolean {
  if (request.latestArrivalCoordinateTime === undefined) {
    return true;
  }
  const bounds = arrivalCoordinateTimeBounds(request, timeline);
  return (
    Number.isFinite(bounds.upper.value) &&
    bounds.upper.value <= request.latestArrivalCoordinateTime.value
  );
}

function insertDwellAtGate(path: RoutePath, gateId: StableId, duration: Seconds): RoutePath {
  const legs: JourneyLeg[] = [];
  let currentGateId = path.gateIds[0];
  let inserted = false;
  for (const leg of path.legs) {
    if (!inserted && currentGateId === gateId) {
      legs.push(Object.freeze({ kind: "dwell" as const, duration }));
      inserted = true;
    }
    legs.push(leg);
    if (leg.kind === "interstellar-cruise" || leg.kind === "in-system-transfer") {
      currentGateId = leg.destinationGateId;
    }
  }
  if (!inserted && currentGateId === gateId && gateId !== path.gateIds.at(-1)) {
    legs.push(Object.freeze({ kind: "dwell" as const, duration }));
    inserted = true;
  }
  return inserted
    ? Object.freeze({
        gateIds: path.gateIds,
        connectionIds: path.connectionIds,
        legs: Object.freeze(legs),
      })
    : path;
}

function strategicDwellDurations(maximumWait: number): readonly Seconds[] {
  if (!(maximumWait > 0) || !Number.isFinite(maximumWait)) {
    return Object.freeze([]);
  }
  const values = new Set<number>([0, maximumWait]);
  for (let index = 1; index < STRATEGIC_DWELL_GRID_SIZE; index += 1) {
    values.add((maximumWait * index) / STRATEGIC_DWELL_GRID_SIZE);
  }
  return Object.freeze(
    [...values]
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= maximumWait)
      .sort((left, right) => left - right)
      .map((value) => seconds(value)),
  );
}

function strategicDwellRefinementDurations(
  maximumWait: number,
  center: number,
  span: number,
): readonly Seconds[] {
  if (!(maximumWait > 0) || !(span > 0) || !Number.isFinite(maximumWait + center + span)) {
    return Object.freeze([]);
  }
  const lower = Math.max(0, center - span);
  const upper = Math.min(maximumWait, center + span);
  if (!(upper > lower)) {
    return Object.freeze([]);
  }
  const values = new Set<number>([lower, upper]);
  for (let index = 1; index < STRATEGIC_DWELL_REFINEMENT_SUBDIVISIONS; index += 1) {
    values.add(lower + ((upper - lower) * index) / STRATEGIC_DWELL_REFINEMENT_SUBDIVISIONS);
  }
  return Object.freeze(
    [...values]
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= maximumWait)
      .sort((left, right) => left - right)
      .map((value) => seconds(value)),
  );
}

type RouteCandidateVisitor = (
  path: RoutePath,
  candidateIndex: number,
  state: RouteSearchState,
) => void;

function searchCandidateRoutes(
  scenario: CompiledScenario,
  network: RouteNetwork,
  request: ParsedRoutePlanningRequest,
  visitCandidate: RouteCandidateVisitor,
): RouteSearchState {
  const state: RouteSearchState = {
    candidateRoutesEvaluated: 0,
    searchStatesExpanded: 0,
    strategicDwellCandidatesEvaluated: 0,
    routesPrunedByHorizon: 0,
    strategicDwellSearchComplete:
      request.effectiveMaximumStrategicWait.value <= 0 ||
      request.departureGateId === request.destinationGateId,
    exhausted: false,
  };
  const initialPath: RoutePath = Object.freeze({
    gateIds: Object.freeze([request.departureGateId]),
    connectionIds: Object.freeze([]),
    legs: Object.freeze([]),
  });
  const visit = (
    currentGateId: StableId,
    path: RoutePath,
    visitedGateIds: ReadonlySet<StableId>,
  ): void => {
    if (state.exhausted) {
      return;
    }
    if (state.searchStatesExpanded >= request.searchBudget.maxSearchStates) {
      state.exhausted = true;
      return;
    }
    state.searchStatesExpanded += 1;

    const pathWithDwell = appendDwell(path, currentGateId, request.dwells);
    // A prefix that is late without a strategic wait may become an earlier valid arrival after a
    // moving-Gate geometry changes. Prefix pruning is therefore sound only when no continuous
    // strategic wait remains to be optimized; completed candidates are still checked below.
    if (
      request.effectiveMaximumStrategicWait.value <= 0 &&
      !routePrefixIsWithinHorizon(scenario, request, currentGateId, pathWithDwell)
    ) {
      state.routesPrunedByHorizon += 1;
      return;
    }
    if (currentGateId === request.destinationGateId) {
      if (state.candidateRoutesEvaluated >= request.searchBudget.maxCandidateRoutes) {
        state.exhausted = true;
        return;
      }
      const candidateIndex = state.candidateRoutesEvaluated;
      state.candidateRoutesEvaluated += 1;
      const completedPath =
        pathWithDwell.legs.length === 0
          ? Object.freeze({
              gateIds: pathWithDwell.gateIds,
              connectionIds: pathWithDwell.connectionIds,
              legs: Object.freeze([
                Object.freeze({ kind: "dwell" as const, duration: seconds(0) }),
              ]),
            })
          : pathWithDwell;
      visitCandidate(completedPath, candidateIndex, state);
      return;
    }

    const currentGate = network.gateById.get(currentGateId);
    if (currentGate === undefined) {
      return;
    }
    const sameSystemGateIds = network.gatesBySystem.get(currentGate.systemId) ?? [];
    if (
      network.gateById.has(request.destinationGateId) &&
      network.gateById.get(request.destinationGateId)?.systemId === currentGate.systemId &&
      !visitedGateIds.has(request.destinationGateId)
    ) {
      const directTransferPath = appendTransfer(pathWithDwell, request.destinationGateId);
      const directTransferVisited = new Set(visitedGateIds);
      directTransferVisited.add(request.destinationGateId);
      visit(request.destinationGateId, directTransferPath, directTransferVisited);
    }

    for (const departureGateId of sameSystemGateIds) {
      if (state.exhausted) {
        break;
      }
      if (
        departureGateId === request.destinationGateId ||
        (departureGateId !== currentGateId && visitedGateIds.has(departureGateId))
      ) {
        continue;
      }
      const pairedGateId = network.pairedGateById.get(departureGateId);
      const connection = network.connectionByGate.get(departureGateId);
      if (
        pairedGateId === undefined ||
        connection === undefined ||
        visitedGateIds.has(pairedGateId)
      ) {
        continue;
      }
      let cruisePath = pathWithDwell;
      if (departureGateId !== currentGateId) {
        cruisePath = appendTransfer(cruisePath, departureGateId);
        cruisePath = appendDwell(cruisePath, departureGateId, request.dwells);
      }
      cruisePath = appendCruise(cruisePath, pairedGateId, connection.id);
      const nextVisitedGateIds = new Set(visitedGateIds);
      nextVisitedGateIds.add(departureGateId);
      nextVisitedGateIds.add(pairedGateId);
      visit(pairedGateId, cruisePath, nextVisitedGateIds);
    }
  };
  const initialVisitedGateIds = new Set<StableId>([request.departureGateId]);
  visit(request.departureGateId, initialPath, initialVisitedGateIds);
  return state;
}

function appendSimulationIssue(
  issues: RoutePlanningIssue[],
  source: SimulationIssue,
  candidateIndex: number,
): void {
  addIssue(
    issues,
    source.code,
    `candidates[${candidateIndex}].${source.path}`,
    source.message,
    source.entityType,
    source.entityId,
    source.relatedId,
    source.code,
  );
}

function selectedDwellsForRequest(
  request: ParsedRoutePlanningRequest,
): readonly RouteDwellSelection[] {
  return Object.freeze(
    [...request.dwells.entries()].flatMap(([gateId, durations]) =>
      durations.map((duration) => Object.freeze({ gateId, duration })),
    ),
  );
}

function createRoutePlan(
  request: ParsedRoutePlanningRequest,
  path: RoutePath,
  timeline: MultiLegJourneyTimeline,
  strategicDwellStates: readonly StrategicDwellState[],
  uncertainty: RouteUncertaintySummary,
): RoutePlan {
  const gateIds = Object.freeze([...path.gateIds]);
  const connectionIds = Object.freeze([...path.connectionIds]);
  const selectedDwells = selectedDwellsForRequest(request);
  const strategicDwells = createStrategicDwellInsertions(timeline, strategicDwellStates);
  const strategicWaitDuration = seconds(
    strategicDwellStates.reduce((total, dwell) => total + dwell.duration.value, 0),
  );
  const legs = Object.freeze([...path.legs]);
  const clusterCoordinateTime = timeline.clocks.clusterCoordinateTime;
  const shipProperTime = timeline.clocks.shipProperTime;
  const agingDifference = timeline.clocks.agingDifference;
  const arrivalBounds = arrivalCoordinateTimeBounds(request, timeline);
  const refinementQuality: RoutePlanningRefinementQuality =
    request.effectiveMaximumStrategicWait.value > 0 &&
    path.gateIds.length > 1 &&
    path.gateIds[0] !== path.gateIds.at(-1)
      ? "bounded-strategic-dwell"
      : "exact";
  const summary = Object.freeze({
    clusterCoordinateTime,
    shipProperTime,
    agingDifference,
    gateLegCount: connectionIds.length,
  });
  return Object.freeze({
    kind: "route-plan" as const,
    departureGateId: request.departureGateId,
    destinationGateId: request.destinationGateId,
    shipProfileId: request.shipProfileId,
    gateIds,
    connectionIds,
    selectedGateIds: gateIds,
    selectedConnectionIds: connectionIds,
    selectedDwells,
    strategicDwells,
    strategicWaitDuration,
    refinementQuality,
    legs,
    timeline,
    uncertainty,
    arrivalCoordinateTimeBounds: arrivalBounds,
    arrivalBounds,
    bounds: timeline.bounds,
    clockBounds: timeline.clockBounds,
    arrivalCoordinateTime: timeline.arrivalCoordinateTime,
    clusterCoordinateTime,
    shipProperTime,
    agingDifference,
    totalClusterCoordinateTime: clusterCoordinateTime,
    totalShipProperTime: shipProperTime,
    totalAgingDifference: agingDifference,
    gateLegCount: connectionIds.length,
    summary,
  });
}

function comparePlans(left: RoutePlan, right: RoutePlan): number {
  const arrivalComparison = left.arrivalCoordinateTime.value - right.arrivalCoordinateTime.value;
  if (arrivalComparison !== 0) {
    return arrivalComparison;
  }
  if (left.gateLegCount !== right.gateLegCount) {
    return left.gateLegCount - right.gateLegCount;
  }
  const shipTimeComparison = left.shipProperTime.value - right.shipProperTime.value;
  if (shipTimeComparison !== 0) {
    return shipTimeComparison;
  }
  return `${left.gateIds.join(">")}|${left.connectionIds.join(">")}`.localeCompare(
    `${right.gateIds.join(">")}|${right.connectionIds.join(">")}`,
  );
}

function searchStats(
  state: RouteSearchState,
  budget: RoutePlanningSearchBudget,
  refinementQuality: RoutePlanningRefinementQuality,
): RoutePlanningSearchStats {
  return Object.freeze({
    candidateRoutesEvaluated: state.candidateRoutesEvaluated,
    searchStatesExpanded: state.searchStatesExpanded,
    strategicDwellCandidatesEvaluated: state.strategicDwellCandidatesEvaluated,
    routesPrunedByHorizon: state.routesPrunedByHorizon,
    strategicDwellSearchComplete: state.strategicDwellSearchComplete,
    refinementQuality,
    budget,
  });
}

function retainPlan(plans: RoutePlan[], plan: RoutePlan, maximumPlans: number): void {
  plans.push(plan);
  plans.sort(comparePlans);
  if (plans.length > maximumPlans) {
    plans.pop();
  }
}

function candidateSummary(plan: RoutePlan): RouteCandidateSummary {
  return Object.freeze({
    gateIds: plan.gateIds,
    connectionIds: plan.connectionIds,
    strategicDwells: plan.strategicDwells,
    arrivalCoordinateTime: plan.arrivalCoordinateTime,
    arrivalCoordinateTimeBounds: plan.arrivalCoordinateTimeBounds,
    shipProperTime: plan.shipProperTime,
    gateLegCount: plan.gateLegCount,
  });
}

function sameRoute(left: RouteCandidateSummary, right: RoutePlan): boolean {
  if (
    left.gateIds.length !== right.gateIds.length ||
    left.connectionIds.length !== right.connectionIds.length ||
    left.strategicDwells.length !== right.strategicDwells.length
  ) {
    return false;
  }
  return (
    left.gateIds.every((gateId, index) => gateId === right.gateIds[index]) &&
    left.connectionIds.every(
      (connectionId, index) => connectionId === right.connectionIds[index],
    ) &&
    left.strategicDwells.every(
      (dwell, index) =>
        dwell.gateId === right.strategicDwells[index]?.gateId &&
        dwell.duration.value === right.strategicDwells[index]?.duration.value,
    )
  );
}

function sensitivityFor(
  winner: RoutePlan,
  candidates: readonly RouteCandidateSummary[],
): readonly RouteSensitivity[] {
  const sensitivity: RouteSensitivity[] = [];
  for (const candidate of candidates) {
    if (sameRoute(candidate, winner)) {
      continue;
    }
    const overlapsNominalWinner =
      candidate.arrivalCoordinateTimeBounds.lower.value <= winner.arrivalBounds.upper.value &&
      candidate.arrivalCoordinateTimeBounds.upper.value >= winner.arrivalBounds.lower.value;
    const couldBeatNominalWinner =
      candidate.arrivalCoordinateTimeBounds.lower.value < winner.arrivalCoordinateTime.value;
    if (!overlapsNominalWinner && !couldBeatNominalWinner) {
      continue;
    }
    const reason = couldBeatNominalWinner ? "could-beat-nominal-winner" : "arrival-ranges-overlap";
    sensitivity.push(
      Object.freeze({
        gateIds: candidate.gateIds,
        connectionIds: candidate.connectionIds,
        strategicDwells: candidate.strategicDwells,
        nominalArrivalCoordinateTime: candidate.arrivalCoordinateTime,
        nominalArrival: candidate.arrivalCoordinateTime,
        arrivalCoordinateTimeBounds: candidate.arrivalCoordinateTimeBounds,
        possibleArrivalRange: candidate.arrivalCoordinateTimeBounds,
        arrivalBounds: candidate.arrivalCoordinateTimeBounds,
        nominalArrivalDifference: seconds(
          candidate.arrivalCoordinateTime.value - winner.arrivalCoordinateTime.value,
        ),
        overlapsNominalWinner,
        couldBeatNominalWinner,
        reason,
      }),
    );
  }
  sensitivity.sort((left, right) => {
    const comparison =
      left.nominalArrivalCoordinateTime.value - right.nominalArrivalCoordinateTime.value;
    if (comparison !== 0) {
      return comparison;
    }
    return `${left.gateIds.join(">")}|${left.connectionIds.join(">")}`.localeCompare(
      `${right.gateIds.join(">")}|${right.connectionIds.join(">")}`,
    );
  });
  return Object.freeze(sensitivity);
}

function simulateCandidate(
  scenario: CompiledScenario,
  request: ParsedRoutePlanningRequest,
  path: RoutePath,
): MultiLegJourneySimulationResult {
  const journeyRequest: JourneyRequest = {
    kind: "journey",
    departureGateId: request.departureGateId,
    destinationGateId: request.destinationGateId,
    shipProfileId: request.shipProfileId,
    departureCoordinateTime: request.departureCoordinateTime,
    legs: path.legs,
  };
  return simulateMultiLegJourney(scenario, journeyRequest);
}

function routePrefixIsWithinHorizon(
  scenario: CompiledScenario,
  request: ParsedRoutePlanningRequest,
  currentGateId: StableId,
  path: RoutePath,
): boolean {
  if (request.latestArrivalCoordinateTime === undefined) {
    return true;
  }
  const routeScenario = simulationScenarioForRoute(scenario, path, request.shipProfileId).scenario;
  const prefixPath =
    path.legs.length === 0
      ? Object.freeze({
          gateIds: path.gateIds,
          connectionIds: path.connectionIds,
          legs: Object.freeze([Object.freeze({ kind: "dwell" as const, duration: seconds(0) })]),
        })
      : path;
  const result = simulateMultiLegJourney(routeScenario, {
    kind: "journey",
    departureGateId: request.departureGateId,
    destinationGateId: currentGateId,
    shipProfileId: request.shipProfileId,
    departureCoordinateTime: request.departureCoordinateTime,
    legs: prefixPath.legs,
  });
  return !result.ok || routeIsWithinHorizon(request, result.timeline);
}

function dwellTimelines(timeline: MultiLegJourneyTimeline): readonly JourneyDwellTimeline[] {
  return Object.freeze(
    timeline.legs.flatMap((leg) => {
      if (leg.kind !== "dwell") {
        return [];
      }
      const detail = leg.timeline as JourneyDwellTimeline;
      return detail.kind === "dwell" ? [detail] : [];
    }),
  );
}

function createStrategicDwellInsertions(
  timeline: MultiLegJourneyTimeline,
  dwellStates: readonly StrategicDwellState[],
): readonly StrategicDwellInsertion[] {
  const dwellDetails = dwellTimelines(timeline);
  const used = new Set<number>();
  const insertions: StrategicDwellInsertion[] = [];
  for (const dwellState of dwellStates) {
    const detailIndex = dwellDetails.findIndex(
      (detail, index) =>
        !used.has(index) &&
        detail.gateId === dwellState.gateId &&
        detail.duration.value === dwellState.duration.value,
    );
    if (detailIndex < 0) {
      continue;
    }
    used.add(detailIndex);
    const detail = dwellDetails[detailIndex];
    if (detail === undefined) {
      continue;
    }
    const clockEffects = Object.freeze({
      clusterCoordinateTime: detail.duration,
      shipProperTime: detail.properDuration,
      agingDifference: detail.agingDifference,
    });
    const benefit = seconds(
      Math.max(0, dwellState.arrivalBefore.value - dwellState.arrivalAfter.value),
    );
    insertions.push(
      Object.freeze({
        kind: "strategic-dwell" as const,
        gateId: detail.gateId,
        locationGateId: detail.gateId,
        duration: detail.duration,
        startCoordinateTime: detail.departureCoordinateTime,
        endCoordinateTime: detail.arrivalCoordinateTime,
        arrivalCoordinateTime: detail.arrivalCoordinateTime,
        clusterCoordinateTime: detail.duration,
        shipProperTime: detail.properDuration,
        agingDifference: detail.agingDifference,
        clockEffects,
        clocks: clockEffects,
        arrivalTimeBenefit: benefit,
        benefit,
        baselineArrivalCoordinateTime: dwellState.arrivalBefore,
        optimizedArrivalCoordinateTime: dwellState.arrivalAfter,
      }),
    );
  }
  return Object.freeze(insertions);
}

type StrategicDwellCandidate = {
  readonly path: RoutePath;
  readonly timeline: MultiLegJourneyTimeline;
  readonly duration: Seconds;
};

function bestStrategicDwellCandidate(
  request: ParsedRoutePlanningRequest,
  routeSimulation: CompiledScenario,
  currentPath: RoutePath,
  gateId: StableId,
  currentArrival: Seconds,
  durations: readonly Seconds[],
  state: RouteSearchState,
): StrategicDwellCandidate | undefined {
  let best: StrategicDwellCandidate | undefined;
  for (const duration of durations) {
    if (duration.value === 0) {
      continue;
    }
    if (state.strategicDwellCandidatesEvaluated >= MAX_STRATEGIC_DWELL_CANDIDATES) {
      state.strategicDwellSearchComplete = false;
      state.exhausted = true;
      return undefined;
    }
    state.strategicDwellCandidatesEvaluated += 1;
    const candidatePath = insertDwellAtGate(currentPath, gateId, duration);
    if (candidatePath === currentPath) {
      continue;
    }
    const candidateResult = simulateCandidate(routeSimulation, request, candidatePath);
    if (!candidateResult.ok || !routeIsWithinHorizon(request, candidateResult.timeline)) {
      continue;
    }
    const candidateArrival = candidateResult.timeline.arrivalCoordinateTime.value;
    if (
      !Number.isFinite(candidateArrival) ||
      candidateArrival >= currentArrival.value ||
      (best !== undefined && candidateArrival >= best.timeline.arrivalCoordinateTime.value)
    ) {
      continue;
    }
    best = Object.freeze({
      path: candidatePath,
      timeline: candidateResult.timeline,
      duration,
    });
  }
  return best;
}

function optimizeStrategicDwells(
  scenario: CompiledScenario,
  request: ParsedRoutePlanningRequest,
  path: RoutePath,
  state: RouteSearchState,
  simulationIssues: RoutePlanningIssue[],
  candidateIndex: number,
): OptimizedRouteCandidate | undefined {
  const routeSimulation = simulationScenarioForRoute(scenario, path, request.shipProfileId);
  const baselineResult = simulateCandidate(routeSimulation.scenario, request, path);
  if (!baselineResult.ok) {
    for (const issue of baselineResult.issues) {
      if (simulationIssues.length >= MAX_REPORTED_SIMULATION_ISSUES) {
        break;
      }
      appendSimulationIssue(simulationIssues, issue, candidateIndex);
    }
    return undefined;
  }

  let currentPath = path;
  let currentTimeline = baselineResult.timeline;
  let currentArrival = currentTimeline.arrivalCoordinateTime;
  let remainingWait = Number(request.effectiveMaximumStrategicWait.value);
  const strategicDwellStates: StrategicDwellState[] = [];
  const candidateGateIds = path.gateIds.slice(0, -1);

  for (const gateId of candidateGateIds) {
    if (!(remainingWait > 0)) {
      break;
    }
    const arrivalBefore = currentArrival;
    let best = bestStrategicDwellCandidate(
      request,
      routeSimulation.scenario,
      currentPath,
      gateId,
      currentArrival,
      strategicDwellDurations(remainingWait),
      state,
    );
    if (state.exhausted) {
      return undefined;
    }
    let refinementSpan = remainingWait / STRATEGIC_DWELL_GRID_SIZE;
    for (
      let level = 0;
      best !== undefined && level < STRATEGIC_DWELL_REFINEMENT_LEVELS;
      level += 1
    ) {
      const refined = bestStrategicDwellCandidate(
        request,
        routeSimulation.scenario,
        currentPath,
        gateId,
        currentArrival,
        strategicDwellRefinementDurations(remainingWait, best.duration.value, refinementSpan),
        state,
      );
      if (state.exhausted) {
        return undefined;
      }
      if (
        refined !== undefined &&
        refined.timeline.arrivalCoordinateTime.value < best.timeline.arrivalCoordinateTime.value
      ) {
        best = refined;
      }
      refinementSpan /= STRATEGIC_DWELL_REFINEMENT_SUBDIVISIONS;
    }
    if (best === undefined) {
      continue;
    }
    currentPath = best.path;
    currentTimeline = best.timeline;
    currentArrival = best.timeline.arrivalCoordinateTime;
    remainingWait -= best.duration.value;
    strategicDwellStates.push(
      Object.freeze({
        gateId,
        duration: best.duration,
        arrivalBefore,
        arrivalAfter: currentArrival,
      }),
    );
  }

  if (!routeIsWithinHorizon(request, currentTimeline)) {
    return undefined;
  }
  return Object.freeze({
    path: currentPath,
    timeline: currentTimeline,
    strategicDwells: Object.freeze(strategicDwellStates),
    uncertainty: routeSimulation.uncertainty,
  });
}

/**
 * Plans the earliest nominal Journey through a finite explicit Gate network while applying a
 * bounded strategic-Dwell search. When strategic waiting is enabled, `refinementQuality` marks
 * the result as a bounded best candidate rather than implying a continuous global optimum.
 *
 * Every simple physically expressible route is expanded, including Gate-comoving Dwells selected
 * by the caller and the In-system Transfers needed to change Gates before a cruise. Each candidate
 * is passed to the existing multi-leg simulation seam; the winner is the valid candidate with the
 * earliest final Cluster Coordinate Time among the evaluated bounded candidates, not the fewest
 * Gate legs or the least Ship Proper Time.
 *
 * @param scenario - The immutable compiled Scenario containing the explicit Gate network.
 * @param request - Endpoint, Ship Profile, departure epoch, selected Dwells, and finite search budget.
 * @returns The earliest exact or bounded-refined Route Plan with capped valid alternatives, or a
 * structured disconnected, invalid, or incomplete outcome when validation fails or a finite search
 * budget is exhausted.
 */
export function planJourney(
  scenario: CompiledScenario,
  request: RoutePlanningRequest,
): RoutePlanningResult;

/**
 * Plans an explicit-network Journey from an unknown request through the public model seam.
 *
 * @param scenario - The immutable compiled Scenario containing the explicit Gate network.
 * @param request - An unknown request value validated at the route-planning boundary, including a finite horizon and search budget.
 * @returns The earliest exact or bounded-refined Route Plan with capped valid alternatives, or a
 * structured disconnected, invalid, or incomplete outcome when validation fails or a finite search
 * budget is exhausted.
 */
export function planJourney(scenario: CompiledScenario, request: unknown): RoutePlanningResult;

export function planJourney(scenario: CompiledScenario, request: unknown): RoutePlanningResult {
  const issues: RoutePlanningIssue[] = [];
  const parsed = readRequest(request, scenario.epoch.coordinateTime, issues);
  if (parsed === undefined) {
    return failure("invalid", issues);
  }

  const networkIssues: RoutePlanningIssue[] = [];
  const network = validateNetwork(scenario, parsed.provenanceFilter, networkIssues);
  if (network === undefined) {
    return failure("invalid", networkIssues);
  }

  const departureGate = network.gateById.get(parsed.departureGateId);
  const destinationGate = network.gateById.get(parsed.destinationGateId);
  const unfilteredDepartureGate = scenario.index.gates.get(parsed.departureGateId);
  const unfilteredDestinationGate = scenario.index.gates.get(parsed.destinationGateId);
  const shipProfile = scenario.index.shipProfiles.get(parsed.shipProfileId);
  if (departureGate === undefined) {
    addIssue(
      issues,
      unfilteredDepartureGate === undefined ? "unknown-gate" : "provenance-filtered",
      "request.departureGateId",
      unfilteredDepartureGate === undefined
        ? `Departure Gate ${parsed.departureGateId} does not exist in the compiled Scenario.`
        : `Departure Gate ${parsed.departureGateId} is excluded by the route Provenance filter.`,
      "gate",
      parsed.departureGateId,
      undefined,
    );
  }
  if (destinationGate === undefined) {
    addIssue(
      issues,
      unfilteredDestinationGate === undefined ? "unknown-gate" : "provenance-filtered",
      "request.destinationGateId",
      unfilteredDestinationGate === undefined
        ? `Destination Gate ${parsed.destinationGateId} does not exist in the compiled Scenario.`
        : `Destination Gate ${parsed.destinationGateId} is excluded by the route Provenance filter.`,
      "gate",
      parsed.destinationGateId,
      undefined,
    );
  }
  if (shipProfile === undefined) {
    addIssue(
      issues,
      "unknown-ship-profile",
      "request.shipProfileId",
      `Ship Profile ${parsed.shipProfileId} does not exist in the compiled Scenario.`,
      "ship-profile",
      parsed.shipProfileId,
      undefined,
    );
  } else if (!routeShipProfileIsAllowed(scenario, shipProfile.id, parsed.provenanceFilter)) {
    addIssue(
      issues,
      "provenance-filtered",
      "request.shipProfileId",
      `Ship Profile ${shipProfile.id} is excluded by the route Provenance filter.`,
      "ship-profile",
      shipProfile.id,
      undefined,
    );
  } else if (!shipProfile.hasZpzGenerator) {
    addIssue(
      issues,
      "missing-zpz-generator",
      "shipProfile.hasZpzGenerator",
      `Ship Profile ${shipProfile.id} cannot travel through a Gate of Heaven without a ZPZ Generator.`,
      "ship-profile",
      shipProfile.id,
      undefined,
    );
  }
  for (const [gateId] of parsed.dwells) {
    if (!network.gateById.has(gateId)) {
      const unfilteredGate = scenario.index.gates.get(gateId);
      addIssue(
        issues,
        unfilteredGate === undefined ? "invalid-dwell" : "provenance-filtered",
        "request.dwells",
        unfilteredGate === undefined
          ? `Selected Dwell references missing Gate ${gateId}.`
          : `Selected Dwell references Gate ${gateId}, which is excluded by the route Provenance filter.`,
        "gate",
        gateId,
        undefined,
      );
    }
  }
  if (issues.length > 0 || departureGate === undefined || destinationGate === undefined) {
    return failure("invalid", issues);
  }

  if (!topologyIsConnected(network, departureGate.id, destinationGate.id)) {
    addIssue(
      issues,
      "disconnected",
      "request.destinationGateId",
      `No explicit Gate-network route connects ${departureGate.id} to ${destinationGate.id}.`,
      "gate",
      destinationGate.id,
      departureGate.id,
    );
    return failure("disconnected", issues);
  }

  const maximumStoredPlans = Math.min(
    (parsed.maxAlternatives ?? DEFAULT_ROUTE_PLANNING_MAX_ALTERNATIVES) + 1,
    parsed.searchBudget.maxCandidateRoutes,
  );
  const retainedPlans: RoutePlan[] = [];
  const candidateSummaries: RouteCandidateSummary[] = [];
  const simulationIssues: RoutePlanningIssue[] = [];
  const searchState = searchCandidateRoutes(
    scenario,
    network,
    parsed,
    (path, candidateIndex, searchState) => {
      const optimized = optimizeStrategicDwells(
        scenario,
        parsed,
        path,
        searchState,
        simulationIssues,
        candidateIndex,
      );
      if (optimized === undefined) {
        return;
      }
      const plan = createRoutePlan(
        parsed,
        optimized.path,
        optimized.timeline,
        optimized.strategicDwells,
        optimized.uncertainty,
      );
      if (!routeIsWithinHorizon(parsed, optimized.timeline)) {
        searchState.routesPrunedByHorizon += 1;
        return;
      }
      candidateSummaries.push(candidateSummary(plan));
      retainPlan(retainedPlans, plan, maximumStoredPlans);
    },
  );
  const refinementQuality: RoutePlanningRefinementQuality =
    parsed.effectiveMaximumStrategicWait.value > 0 &&
    parsed.departureGateId !== parsed.destinationGateId
      ? "bounded-strategic-dwell"
      : "exact";
  const stats = searchStats(searchState, parsed.searchBudget, refinementQuality);

  if (searchState.exhausted) {
    addIssue(
      issues,
      "search-budget-exhausted",
      "search",
      `The finite route search was exhausted after ${searchState.candidateRoutesEvaluated} candidate route(s), ${searchState.searchStatesExpanded} search state(s), and ${searchState.strategicDwellCandidatesEvaluated} strategic-Dwell candidate(s); no unqualified earliest Route Plan is returned.`,
      undefined,
      undefined,
      undefined,
    );
    return failure("incomplete", issues, stats);
  }

  if (retainedPlans.length === 0) {
    if (parsed.latestArrivalCoordinateTime !== undefined && searchState.routesPrunedByHorizon > 0) {
      addIssue(
        issues,
        "horizon-exceeded",
        "request.latestArrivalCoordinateTime",
        `No expanded route remains within the latest-arrival horizon of ${parsed.latestArrivalCoordinateTime.value} seconds.`,
        undefined,
        undefined,
        undefined,
      );
    }
    addIssue(
      issues,
      "no-valid-route",
      "routes",
      "The explicit network is topologically connected, but no expanded route produced a valid Journey Timeline within the configured bounds.",
      undefined,
      undefined,
      undefined,
    );
    issues.push(...simulationIssues);
    return failure("invalid", issues, stats);
  }

  const bestPlan = retainedPlans[0];
  if (bestPlan === undefined) {
    return failure(
      "invalid",
      [
        {
          code: "no-valid-route",
          path: "routes",
          message: "The route planner produced no best plan.",
          entityType: undefined,
          entityId: undefined,
          relatedId: undefined,
          causeCode: undefined,
        },
      ],
      stats,
    );
  }
  const alternatives = Object.freeze(retainedPlans.slice(1));
  return Object.freeze({
    ok: true as const,
    outcome: "success" as const,
    plan: bestPlan,
    bestPlan,
    alternatives,
    sensitivity: sensitivityFor(bestPlan, candidateSummaries),
    sensitivityAlternatives: sensitivityFor(bestPlan, candidateSummaries),
    refinementQuality,
    search: stats,
    issues: [] as const,
  });
}

/**
 * Alias for {@link planJourney} using the Route terminology of the public API.
 *
 * @param scenario - The immutable compiled Scenario containing the explicit Gate network.
 * @param request - Endpoint, Ship Profile, departure epoch, selected Dwells, and finite search budget.
 * @returns The earliest Route Plan with capped valid alternatives, or a structured disconnected,
 * invalid, or incomplete outcome when validation fails or the finite exact-search budget is exhausted.
 */
export const planRoute = planJourney;
