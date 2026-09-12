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
