import { seconds, type Seconds } from "./quantities";
import type {
  CompiledGate,
  CompiledGateConnection,
  CompiledScenario,
  DomainEntityType,
  StableId,
} from "./model";
import { simulateMultiLegJourney } from "./simulation";
import type {
  JourneyLeg,
  JourneyRequest,
  MultiLegJourneySimulationResult,
  MultiLegJourneyTimeline,
  SimulationIssue,
} from "./simulation";

const stableIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_REPORTED_SIMULATION_ISSUES = 32;

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
 * Alias for the Dwell selection terminology used by the Journey Model specification.
 */
export type JourneyRouteDwell = RouteDwellSelection;

/**
 * A request to search a finite, explicitly compiled Gate network.
 *
 * The planner evaluates nominal physics only when ranking routes. Uncertainty bounds remain on
 * every returned Journey Timeline and are not used as a secondary route objective. `searchBudget`
 * bounds exact candidate expansion; exhaustion returns `incomplete` rather than a partial winner.
 */
export type RoutePlanningRequest = {
  readonly departureGateId: StableId;
  readonly destinationGateId: StableId;
  readonly shipProfileId: StableId;
  readonly departureCoordinateTime: Seconds | undefined;
  readonly dwells: readonly RouteDwellSelection[] | undefined;
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
  readonly legs: readonly JourneyLeg[];
  readonly timeline: MultiLegJourneyTimeline;
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
  | "unknown-gate"
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
 * A successful explicit-network route-planning result. `alternatives` is capped by the request
 * while `search` proves that the finite exact search completed.
 */
export type RoutePlanningSuccess = {
  readonly ok: true;
  readonly outcome: "success";
  readonly plan: RoutePlan;
  readonly bestPlan: RoutePlan;
  readonly alternatives: readonly RoutePlan[];
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

type RouteSearchState = {
  candidateRoutesEvaluated: number;
  searchStatesExpanded: number;
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
): Seconds | undefined {
  if (!isRecord(value) || value.unit !== "s" || typeof value.value !== "number") {
    addIssue(
      issues,
      "invalid-request",
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
      "invalid-request",
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
  if (
    departureGateId === undefined ||
    destinationGateId === undefined ||
    shipProfileId === undefined ||
    departureCoordinateTime === undefined ||
    dwells === undefined ||
    searchBudget === undefined ||
    issues.length > 0
  ) {
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
    maxAlternatives,
    searchBudget,
  });
}

function validateNetwork(
  scenario: CompiledScenario,
  issues: RoutePlanningIssue[],
): RouteNetwork | undefined {
  const gateById = new Map<StableId, CompiledGate>();
  const gatesBySystem = new Map<StableId, StableId[]>();
  for (const gate of scenario.gates) {
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
    const gateA = gateById.get(connection.gateAId);
    const gateB = gateById.get(connection.gateBId);
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
    if (connectionByGate.has(gateA.id)) {
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
    if (connectionByGate.has(gateB.id)) {
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
    connectionByGate.set(gateA.id, connection);
    connectionByGate.set(gateB.id, connection);
    pairedGateById.set(gateA.id, gateB.id);
    pairedGateById.set(gateB.id, gateA.id);
  }
  for (const gate of scenario.gates) {
    if (!connectionByGate.has(gate.id)) {
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
  return Object.freeze({
    gateById,
    connectionByGate,
    pairedGateById,
    gatesBySystem,
  });
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

type RouteCandidateVisitor = (path: RoutePath, candidateIndex: number) => void;

function searchCandidateRoutes(
  network: RouteNetwork,
  request: ParsedRoutePlanningRequest,
  visitCandidate: RouteCandidateVisitor,
): RouteSearchState {
  const state: RouteSearchState = {
    candidateRoutesEvaluated: 0,
    searchStatesExpanded: 0,
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
      visitCandidate(completedPath, candidateIndex);
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

function createRoutePlan(
  request: ParsedRoutePlanningRequest,
  path: RoutePath,
  timeline: MultiLegJourneyTimeline,
): RoutePlan {
  const gateIds = Object.freeze([...path.gateIds]);
  const connectionIds = Object.freeze([...path.connectionIds]);
  const legs = Object.freeze([...path.legs]);
  const clusterCoordinateTime = timeline.clocks.clusterCoordinateTime;
  const shipProperTime = timeline.clocks.shipProperTime;
  const agingDifference = timeline.clocks.agingDifference;
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
    legs,
    timeline,
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
): RoutePlanningSearchStats {
  return Object.freeze({
    candidateRoutesEvaluated: state.candidateRoutesEvaluated,
    searchStatesExpanded: state.searchStatesExpanded,
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

/**
 * Plans the provably earliest nominal Journey through a finite explicit Gate network.
 *
 * Every simple physically expressible route is expanded, including Gate-comoving Dwells selected
 * by the caller and the In-system Transfers needed to change Gates before a cruise. Each candidate
 * is passed to the existing multi-leg simulation seam; the winner is the valid candidate with the
 * earliest final Cluster Coordinate Time, not the fewest Gate legs or the least Ship Proper Time.
 *
 * @param scenario - The immutable compiled Scenario containing the explicit Gate network.
 * @param request - Endpoint, Ship Profile, departure epoch, selected Dwells, and finite search budget.
 * @returns The earliest Route Plan with capped valid alternatives, or a structured disconnected,
 * invalid, or incomplete outcome when validation fails or the finite exact-search budget is exhausted.
 */
export function planJourney(
  scenario: CompiledScenario,
  request: RoutePlanningRequest,
): RoutePlanningResult;

/**
 * Plans an explicit-network Journey from an unknown request through the public model seam.
 *
 * @param scenario - The immutable compiled Scenario containing the explicit Gate network.
 * @param request - An unknown request value validated at the route-planning boundary, including a finite search budget.
 * @returns The earliest Route Plan with capped valid alternatives, or a structured disconnected,
 * invalid, or incomplete outcome when validation fails or the finite exact-search budget is exhausted.
 */
export function planJourney(scenario: CompiledScenario, request: unknown): RoutePlanningResult;

export function planJourney(scenario: CompiledScenario, request: unknown): RoutePlanningResult {
  const issues: RoutePlanningIssue[] = [];
  const parsed = readRequest(request, scenario.epoch.coordinateTime, issues);
  if (parsed === undefined) {
    return failure("invalid", issues);
  }

  const networkIssues: RoutePlanningIssue[] = [];
  const network = validateNetwork(scenario, networkIssues);
  if (network === undefined) {
    return failure("invalid", networkIssues);
  }

  const departureGate = network.gateById.get(parsed.departureGateId);
  const destinationGate = network.gateById.get(parsed.destinationGateId);
  const shipProfile = scenario.index.shipProfiles.get(parsed.shipProfileId);
  if (departureGate === undefined) {
    addIssue(
      issues,
      "unknown-gate",
      "request.departureGateId",
      `Departure Gate ${parsed.departureGateId} does not exist in the compiled Scenario.`,
      "gate",
      parsed.departureGateId,
      undefined,
    );
  }
  if (destinationGate === undefined) {
    addIssue(
      issues,
      "unknown-gate",
      "request.destinationGateId",
      `Destination Gate ${parsed.destinationGateId} does not exist in the compiled Scenario.`,
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
      addIssue(
        issues,
        "invalid-dwell",
        "request.dwells",
        `Selected Dwell references missing Gate ${gateId}.`,
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
  const simulationIssues: RoutePlanningIssue[] = [];
  const searchState = searchCandidateRoutes(network, parsed, (path, candidateIndex) => {
    const simulation = simulateCandidate(scenario, parsed, path);
    if (!simulation.ok) {
      for (const issue of simulation.issues) {
        if (simulationIssues.length >= MAX_REPORTED_SIMULATION_ISSUES) {
          break;
        }
        appendSimulationIssue(simulationIssues, issue, candidateIndex);
      }
      return;
    }
    retainPlan(
      retainedPlans,
      createRoutePlan(parsed, path, simulation.timeline),
      maximumStoredPlans,
    );
  });
  const stats = searchStats(searchState, parsed.searchBudget);

  if (searchState.exhausted) {
    addIssue(
      issues,
      "search-budget-exhausted",
      "search",
      `The finite explicit route search budget was exhausted after ${searchState.candidateRoutesEvaluated} candidate route(s) and ${searchState.searchStatesExpanded} search state(s); no globally earliest Route Plan is returned.`,
      undefined,
      undefined,
      undefined,
    );
    return failure("incomplete", issues, stats);
  }

  if (retainedPlans.length === 0) {
    addIssue(
      issues,
      "no-valid-route",
      "routes",
      "The explicit network is topologically connected, but no expanded route produced a valid Journey Timeline.",
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
