import { describe, expect, test } from "bun:test";

import {
  createInProcessWorkerFactory,
  createJourneyModel,
  createWorkerPlanningAdapter,
  generateClusterRegion,
} from "../src/index";
import {
  applyNominalUncertainty,
  buildRoutePlanningRequest,
  createPlanningRevisionController,
  formatGateLabel,
  formatSystemLabel,
  getScenarioUncertaintyControls,
  provenanceKinds,
  resolveSystemGateEndpoints,
} from "../app/planning";
import { bundledCatalogScenarioInput } from "../app/catalog";

function requireScenario() {
  const result = createJourneyModel().compileScenario(bundledCatalogScenarioInput);
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }
  return result.scenario;
}

describe("calculator planning seam", () => {
  test("labels generated Gate options from the active materialized Scenario", () => {
    const generated = generateClusterRegion({
      logicalPopulation: 32,
      materializedSystemCount: 8,
      seed: "gate-label-test",
      generatorVersion: "globular-v1",
    });
    const gate = generated.scenario.gates[0];
    if (gate === undefined) {
      throw new Error("Expected the generated Scenario to contain a Gate.");
    }

    expect(formatGateLabel(generated.scenario, gate.id)).toBe(`${gate.name} · ${gate.designation}`);
    expect(formatGateLabel(generated.scenario, gate.id)).not.toBe(gate.id);
  });

  test("resolves System choices to the closest connected exact Gates", () => {
    const scenario = requireScenario();

    expect(formatSystemLabel(scenario, "system:aurora")).toBe("Aurora · CEN-1002");
    expect(resolveSystemGateEndpoints(scenario, "system:terra", "system:aurora")).toEqual({
      departureGateId: "gate:terra",
      destinationGateId: "gate:aurora-entry",
    });
    expect(resolveSystemGateEndpoints(scenario, "system:aurora", "system:helios")).toEqual({
      departureGateId: "gate:aurora-exit",
      destinationGateId: "gate:helios",
    });
    expect(resolveSystemGateEndpoints(scenario, "system:terra", "system:missing")).toBeUndefined();
  });

  test("maps UI selections into a bounded domain request without calculating route physics", () => {
    const request = buildRoutePlanningRequest({
      departureGateId: "gate:terra",
      destinationGateId: "gate:helios",
      shipProfileId: "ship:survey",
      departureCoordinateTime: 0,
      latestArrivalCoordinateTime: 10 * 86_400,
      maximumStrategicWait: 86_400,
      provenanceKinds: ["provisional"],
      maxAlternatives: 5,
    });

    expect(request as unknown).toEqual({
      departureGateId: "gate:terra",
      destinationGateId: "gate:helios",
      shipProfileId: "ship:survey",
      departureCoordinateTime: { value: 0, unit: "s" },
      dwells: [],
      latestArrivalCoordinateTime: { value: 10 * 86_400, unit: "s" },
      maximumStrategicWait: { value: 86_400, unit: "s" },
      provenanceFilter: {
        allowedKinds: ["provisional"],
        excludedKinds: undefined,
        allowedAuthorities: undefined,
        minimumAuthority: undefined,
      },
      maxAlternatives: 5,
      searchBudget: undefined,
    });
  });

  test("plans the calculator request through the worker adapter and returns cumulative clocks", async () => {
    const model = createJourneyModel();
    const scenario = requireScenario();
    const adapter = createWorkerPlanningAdapter({
      workerFactory: createInProcessWorkerFactory(),
    });
    const request = buildRoutePlanningRequest({
      departureGateId: "gate:terra",
      destinationGateId: "gate:helios",
      shipProfileId: "ship:survey",
      departureCoordinateTime: 0,
      latestArrivalCoordinateTime: 20 * 365.25 * 86_400,
      maximumStrategicWait: 86_400,
      provenanceKinds,
      maxAlternatives: 5,
    });

    const response = await adapter.plan(model.createScenarioExport(scenario), request).promise;
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.ok).toBe(true);
      if (response.result.ok) {
        expect(
          response.result.plan.timeline.phases.some((phase) => phase.kind === "in-system-transfer"),
        ).toBe(true);
        expect(response.result.plan.timeline.clocks.clusterCoordinateTime.value).toBe(
          response.result.plan.clusterCoordinateTime.value,
        );
        expect(response.result.plan.timeline.clocks.shipProperTime.value).toBe(
          response.result.plan.shipProperTime.value,
        );
        expect(response.result.plan.timeline.clocks.agingDifference.value).toBe(
          response.result.plan.agingDifference.value,
        );
      }
    }
    await adapter.dispose();
  });

  test("rejects a deferred worker response after the Scenario revision changes", async () => {
    const controller = createPlanningRevisionController();
    const requestRevision = controller.current();
    let resolveResponse!: (value: string) => void;
    const response = new Promise<string>((resolve) => {
      resolveResponse = resolve;
    });
    const accepted: string[] = [];
    const consumeResponse = response.then((value) => {
      if (controller.isCurrent(requestRevision)) {
        accepted.push(value);
      }
    });

    controller.invalidate();
    resolveResponse("stale worker result");
    await consumeResponse;

    expect(controller.isCurrent(requestRevision)).toBe(false);
    expect(accepted).toEqual([]);
  });

  test("exposes ranged catalog values as nominal controls while retaining provenance", () => {
    const controls = getScenarioUncertaintyControls(requireScenario());

    expect(controls).toHaveLength(2);
    expect(controls[0]).toMatchObject({
      path: "ship:survey.acceleration",
      lower: 8,
      nominal: 10,
      upper: 12,
      unit: "m/s^2",
      provenanceKind: "provisional",
    });
    expect(provenanceKinds).toContain("generated");

    const model = createJourneyModel();
    const control = controls[0];
    if (control === undefined) {
      throw new Error("Expected the bundled ranged Ship Profile control.");
    }
    const updated = applyNominalUncertainty(model, requireScenario(), control, 11);
    expect(updated.shipProfiles[0]?.acceleration as unknown).toEqual({ value: 11, unit: "m/s^2" });
    expect(updated.shipProfiles[0]?.properties.acceleration?.bounds).toMatchObject({
      lower: { value: 8, unit: "m/s^2" },
      nominal: { value: 11, unit: "m/s^2" },
      upper: { value: 12, unit: "m/s^2" },
    });
    expect(updated.overrideLayers).toHaveLength(1);

    const secondControl = controls[1];
    if (secondControl === undefined) {
      throw new Error("Expected a second ranged Ship Profile control.");
    }
    const updatedTwice = applyNominalUncertainty(model, updated, secondControl, 9);
    expect(updatedTwice.shipProfiles[0]?.acceleration as unknown).toEqual({
      value: 11,
      unit: "m/s^2",
    });
    expect(updatedTwice.shipProfiles[0]?.brakingAcceleration as unknown).toEqual({
      value: 9,
      unit: "m/s^2",
    });
    expect(updatedTwice.overrideLayers).toHaveLength(2);
  });
});
