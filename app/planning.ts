import {
  createScenarioOverrideLayer,
  rangeClaim,
  seconds,
  type CanonicalClaim,
  type CompiledScenario,
  type JourneyModel,
  type ProvenanceKind,
  type RoutePlanningRequest,
  type ScenarioOverrideLayerInput,
  type StableId,
} from "../src/index";

/**
 * Provenance categories exposed by the calculator filter.
 */
export const provenanceKinds: readonly ProvenanceKind[] = Object.freeze([
  "novel",
  "supplementary-official",
  "provisional",
  "generated",
  "override",
]);

/**
 * Formats a Gate option from the Scenario that currently owns the active Gate.
 */
export function formatGateLabel(scenario: CompiledScenario, gateId: StableId): string {
  const gate = scenario.index.gates.get(gateId);
  return gate === undefined ? gateId : `${gate.name} · ${gate.designation}`;
}

/**
 * Formats a System option from the Scenario that owns it.
 *
 * @param scenario - Scenario containing the System.
 * @param systemId - Stable identifier of the System to label.
 * @returns A human-readable name and designation, or the identifier when unavailable.
 */
export function formatSystemLabel(scenario: CompiledScenario, systemId: StableId): string {
  const system = scenario.index.systems.get(systemId);
  return system === undefined ? systemId : `${system.name} · ${system.designation}`;
}

/**
 * Exact Gate endpoints selected for a System-to-System planning request.
 */
export type SystemGateEndpoints = {
  readonly departureGateId: StableId;
  readonly destinationGateId: StableId;
};

function gateDistance(
  adjacency: ReadonlyMap<StableId, ReadonlySet<StableId>>,
  departureGateId: StableId,
  destinationGateId: StableId,
): number | undefined {
  const queue: { readonly gateId: StableId; readonly distance: number }[] = [
    { gateId: departureGateId, distance: 0 },
  ];
  const visited = new Set<StableId>([departureGateId]);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current === undefined) {
      continue;
    }
    if (current.gateId === destinationGateId) {
      return current.distance;
    }
    for (const neighbor of adjacency.get(current.gateId) ?? []) {
      if (visited.has(neighbor)) {
        continue;
      }
      visited.add(neighbor);
      queue.push({ gateId: neighbor, distance: current.distance + 1 });
    }
  }
  return undefined;
}

/**
 * Resolves simple System endpoints to the closest connected pair of exact Gates.
 *
 * Gates within one System are connected by an In-system Transfer edge, while paired Gates use
 * their Gate Connection. Stable identifier ordering makes equal-hop choices deterministic.
 *
 * @param scenario - Active compiled Scenario containing the Gate network.
 * @param departureSystemId - System where the Journey should begin.
 * @param destinationSystemId - System where the Journey should end.
 * @returns The closest connected Gate pair, or undefined when no route can join the Systems.
 */
export function resolveSystemGateEndpoints(
  scenario: CompiledScenario,
  departureSystemId: StableId,
  destinationSystemId: StableId,
): SystemGateEndpoints | undefined {
  const sortedGates = [...scenario.gates].sort((left, right) => left.id.localeCompare(right.id));
  const departureGates = sortedGates.filter((gate) => gate.systemId === departureSystemId);
  const destinationGates = sortedGates.filter((gate) => gate.systemId === destinationSystemId);
  if (departureGates.length === 0 || destinationGates.length === 0) {
    return undefined;
  }

  const adjacency = new Map<StableId, Set<StableId>>(
    sortedGates.map((gate) => [gate.id, new Set<StableId>()]),
  );
  const connect = (left: StableId, right: StableId): void => {
    adjacency.get(left)?.add(right);
    adjacency.get(right)?.add(left);
  };
  const gatesBySystem = new Map<StableId, StableId[]>();
  for (const gate of sortedGates) {
    const systemGates = gatesBySystem.get(gate.systemId) ?? [];
    systemGates.push(gate.id);
    gatesBySystem.set(gate.systemId, systemGates);
  }
  for (const systemGates of gatesBySystem.values()) {
    for (let leftIndex = 0; leftIndex < systemGates.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < systemGates.length; rightIndex += 1) {
        const left = systemGates[leftIndex];
        const right = systemGates[rightIndex];
        if (left !== undefined && right !== undefined) {
          connect(left, right);
        }
      }
    }
  }
  for (const connection of scenario.gateConnections) {
    connect(connection.gateAId, connection.gateBId);
  }

  let best: { readonly endpoints: SystemGateEndpoints; readonly distance: number } | undefined;
  for (const departureGate of departureGates) {
    for (const destinationGate of destinationGates) {
      const distance = gateDistance(adjacency, departureGate.id, destinationGate.id);
      if (distance === undefined || (best !== undefined && best.distance <= distance)) {
        continue;
      }
      best = {
        endpoints: Object.freeze({
          departureGateId: departureGate.id,
          destinationGateId: destinationGate.id,
        }),
        distance,
      };
    }
  }
  return best?.endpoints;
}

/**
 * Form values needed to construct a finite route-planning request.
 */
export type RoutePlanningForm = {
  readonly departureGateId: StableId;
  readonly destinationGateId: StableId;
  readonly shipProfileId: StableId;
  readonly departureCoordinateTime: number;
  readonly latestArrivalCoordinateTime: number;
  readonly maximumStrategicWait: number;
  readonly provenanceKinds: readonly ProvenanceKind[];
  readonly maxAlternatives: number;
};

/**
 * Correlates asynchronous planning progress and results with the current Scenario revision.
 */
export type PlanningRevisionController = {
  /**
   * Returns the revision token to bind to a new planning request.
   *
   * @returns Current revision token.
   */
  readonly current: () => number;
  /**
   * Invalidates all requests bound to the previous Scenario revision.
   *
   * @returns The newly active revision token.
   */
  readonly invalidate: () => number;
  /**
   * Tests whether a response still belongs to the active Scenario revision.
   *
   * @param revision - Token captured when the request started.
   * @returns Whether the response may update the UI.
   */
  readonly isCurrent: (revision: number) => boolean;
};

/**
 * Creates a monotone revision gate for deferred worker planning responses.
 *
 * @returns A controller that invalidates stale progress and results after Scenario replacement.
 */
export function createPlanningRevisionController(): PlanningRevisionController {
  let revision = 0;
  return Object.freeze({
    current: () => revision,
    invalidate: () => {
      revision += 1;
      return revision;
    },
    isCurrent: (candidate: number) => candidate === revision,
  });
}

/**
 * A ranged seconds property that the calculator can expose as a nominal control.
 */
export type ScenarioUncertaintyControl = {
  readonly path: string;
  readonly label: string;
  readonly entityType:
    | "scenario"
    | "system"
    | "orbital-anchor"
    | "gate"
    | "gate-connection"
    | "ship-profile";
  readonly entityId: StableId;
  readonly property: string;
  readonly lower: number;
  readonly nominal: number;
  readonly upper: number;
  readonly unit: string;
  readonly provenanceKind: ProvenanceKind;
  readonly claim: CanonicalClaim<unknown> | undefined;
};

/**
 * Converts calculator controls into the bounded request understood by the Journey Model.
 *
 * This adapter only maps user input to SI quantities and filters. Route physics, strategic-wait
 * search, and result bounds remain inside the framework-independent Journey Model.
 *
 * @param form - Validated calculator selections and horizon values.
 * @returns A finite route-planning request.
 */
export function buildRoutePlanningRequest(form: RoutePlanningForm): RoutePlanningRequest {
  const maximumStrategicWait = Math.max(0, form.maximumStrategicWait);
  const departureCoordinateTime = Math.max(0, form.departureCoordinateTime);
  const allowedKinds = Object.freeze([...form.provenanceKinds]);
  const provenanceFilter =
    allowedKinds.length === provenanceKinds.length
      ? undefined
      : Object.freeze({
          allowedKinds,
          excludedKinds: undefined,
          allowedAuthorities: undefined,
          minimumAuthority: undefined,
        });

  return Object.freeze({
    departureGateId: form.departureGateId,
    destinationGateId: form.destinationGateId,
    shipProfileId: form.shipProfileId,
    departureCoordinateTime: seconds(departureCoordinateTime),
    dwells: Object.freeze([]),
    latestArrivalCoordinateTime: seconds(
      Math.max(departureCoordinateTime, form.latestArrivalCoordinateTime),
    ),
    maximumStrategicWait: seconds(maximumStrategicWait),
    provenanceFilter,
    maxAlternatives: Math.max(0, Math.min(20, Math.trunc(form.maxAlternatives))),
    searchBudget: undefined,
  });
}

function quantityValue(
  value: unknown,
): { readonly value: number; readonly unit: string } | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as { readonly unit?: unknown; readonly value?: unknown };
  return typeof record.unit === "string" &&
    typeof record.value === "number" &&
    Number.isFinite(record.value)
    ? { value: record.value, unit: record.unit }
    : undefined;
}

function controlFromMetadata(
  path: string,
  entityType: ScenarioUncertaintyControl["entityType"],
  entityId: StableId,
  property: string,
  metadata: {
    readonly value: unknown;
    readonly bounds:
      | { readonly lower: unknown; readonly nominal: unknown; readonly upper: unknown }
      | undefined;
    readonly claim: CanonicalClaim<unknown> | undefined;
    readonly provenance: { readonly kind: ProvenanceKind };
  },
): ScenarioUncertaintyControl | undefined {
  if (metadata.bounds === undefined) {
    return undefined;
  }
  const lower = quantityValue(metadata.bounds.lower);
  const nominal = quantityValue(metadata.bounds.nominal ?? metadata.value);
  const upper = quantityValue(metadata.bounds.upper);
  if (
    lower === undefined ||
    nominal === undefined ||
    upper === undefined ||
    lower.unit !== nominal.unit ||
    nominal.unit !== upper.unit ||
    lower.value === upper.value
  ) {
    return undefined;
  }
  const claim =
    metadata.claim?.kind === "range" &&
    quantityValue(metadata.claim.lower)?.unit === nominal.unit &&
    quantityValue(metadata.claim.nominal)?.unit === nominal.unit &&
    quantityValue(metadata.claim.upper)?.unit === nominal.unit
      ? metadata.claim
      : undefined;
  return Object.freeze({
    path,
    label: property,
    entityType,
    entityId,
    property,
    lower: lower.value,
    nominal: nominal.value,
    upper: upper.value,
    unit: nominal.unit,
    provenanceKind: metadata.provenance.kind,
    claim,
  });
}

/**
 * Lists seconds-valued uncertain properties for the calculator's nominal controls.
 *
 * @param scenario - The compiled Scenario whose property metadata is inspected.
 * @returns Stable, sorted controls with source bounds and provenance.
 */
export function getScenarioUncertaintyControls(
  scenario: CompiledScenario,
): readonly ScenarioUncertaintyControl[] {
  const controls: ScenarioUncertaintyControl[] = [];
  const visit = (
    pathPrefix: string,
    entityType: ScenarioUncertaintyControl["entityType"],
    entityId: StableId,
    properties: Readonly<Record<string, CompiledScenario["properties"][string]>>,
  ): void => {
    for (const [property, metadata] of Object.entries(properties)) {
      const control = controlFromMetadata(
        `${pathPrefix}.${property}`,
        entityType,
        entityId,
        property,
        metadata,
      );
      if (control !== undefined) {
        controls.push(control);
      }
    }
  };

  visit("scenario", "scenario", scenario.id, scenario.properties);
  for (const entity of scenario.systems) {
    visit(entity.id, "system", entity.id, entity.properties);
  }
  for (const entity of scenario.orbitalAnchors) {
    visit(entity.id, "orbital-anchor", entity.id, entity.properties);
  }
  for (const entity of scenario.gates) {
    visit(entity.id, "gate", entity.id, entity.properties);
  }
  for (const entity of scenario.gateConnections) {
    visit(entity.id, "gate-connection", entity.id, entity.properties);
  }
  for (const entity of scenario.shipProfiles) {
    visit(entity.id, "ship-profile", entity.id, entity.properties);
  }
  return Object.freeze(controls.sort((left, right) => left.path.localeCompare(right.path)));
}

/**
 * Applies one nominal uncertainty selection as a reversible Scenario override.
 *
 * @param model - Journey Model used for immutable override operations.
 * @param scenario - Current Scenario, possibly containing the calculator's prior layer.
 * @param control - The ranged property being edited.
 * @param nominal - New seconds nominal inside the source range.
 * @returns A new Scenario with the selected nominal and original bounds retained.
 * @throws RangeError when the nominal is outside the source range.
 */
export function applyNominalUncertainty(
  model: JourneyModel,
  scenario: CompiledScenario,
  control: ScenarioUncertaintyControl,
  nominal: number,
): CompiledScenario {
  if (!Number.isFinite(nominal) || nominal < control.lower || nominal > control.upper) {
    throw new RangeError(`${control.path} nominal must stay within its source range.`);
  }
  const selectedValue = Object.freeze({ value: nominal, unit: control.unit });
  const layerId = `override:calculator-nominal:${control.entityType}:${control.entityId}:${control.property}`;
  const withoutCalculatorLayer = scenario.overrideLayers.some((layer) => layer.id === layerId)
    ? model.revertScenarioOverride(scenario, layerId)
    : scenario;
  const claim =
    control.claim?.kind === "range"
      ? rangeClaim({
          lower: control.claim.lower,
          upper: control.claim.upper,
          nominal: selectedValue,
          provenance: control.claim.provenance,
          precision: control.claim.precision,
        })
      : undefined;
  const change: ScenarioOverrideLayerInput["changes"][number] = {
    entityType: control.entityType,
    entityId: control.entityId,
    property: control.property,
    value: selectedValue,
    claim,
    reason: "Calculator nominal selection",
  };
  const layer = createScenarioOverrideLayer({
    id: layerId,
    label: "Calculator nominal selection",
    changes: [change],
  });
  return model.applyScenarioOverrides(withoutCalculatorLayer, [layer]);
}
