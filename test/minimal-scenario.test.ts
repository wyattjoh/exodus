import { describe, expect, test } from "bun:test";

import {
  compileScenario,
  createJourneyModel,
  formatScenarioInspection,
  inspectScenario,
  minimalScenario,
  seconds,
  type ScenarioInput,
} from "../src/index";

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Expected an item at index ${index}.`);
  }

  return value;
}

function requireScenario(input: unknown) {
  const result = compileScenario(input);
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }

  return result.scenario;
}

describe("Journey Model Scenario seam", () => {
  test("compiles and inspects a complete minimal Scenario", () => {
    const scenario = requireScenario(minimalScenario);
    const inspection = inspectScenario(scenario);

    expect(inspection.counts).toEqual({
      systems: 2,
      orbitalAnchors: 2,
      gates: 2,
      gateConnections: 1,
      shipProfiles: 1,
    });
    expect(inspection.gates.map((gate) => gate.pairedGateId)).toEqual([
      "gate:terra",
      "gate:selene",
    ]);
    expect(inspection.shipProfiles[0]?.hasZpzGenerator).toBe(true);
    expect(scenario.index.gates.get("gate:terra")?.name).toBe("Terra Gate of Heaven");
    expect(Object.isFrozen(scenario.index.gates)).toBe(true);
    expect("set" in scenario.index.gates).toBe(false);
  });

  test("returns structured issues for malformed structure and references", () => {
    const result = compileScenario({});

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.scenario).toBeUndefined();
    expect(result.issues.some((issue) => issue.code === "invalid-structure")).toBe(true);
  });

  test("reports duplicate identifiers and broken references", () => {
    const duplicateSystemScenario: ScenarioInput = {
      ...minimalScenario,
      systems: [
        at(minimalScenario.systems, 0),
        {
          ...at(minimalScenario.systems, 1),
          id: at(minimalScenario.systems, 0).id,
        },
      ],
    };
    const brokenReferenceScenario: ScenarioInput = {
      ...minimalScenario,
      gates: [
        at(minimalScenario.gates, 0),
        {
          ...at(minimalScenario.gates, 1),
          orbitalAnchorId: "anchor:missing",
        },
      ],
    };
    const scenarioEntityCollision: ScenarioInput = {
      ...minimalScenario,
      id: at(minimalScenario.systems, 0).id,
    };

    const duplicateResult = compileScenario(duplicateSystemScenario);
    const brokenReferenceResult = compileScenario(brokenReferenceScenario);
    const collisionResult = compileScenario(scenarioEntityCollision);

    expect(duplicateResult.ok).toBe(false);
    expect(brokenReferenceResult.ok).toBe(false);
    expect(collisionResult.ok).toBe(false);
    if (!duplicateResult.ok) {
      expect(duplicateResult.issues.some((issue) => issue.code === "duplicate-id")).toBe(true);
    }
    if (!brokenReferenceResult.ok) {
      expect(brokenReferenceResult.issues.some((issue) => issue.code === "broken-reference")).toBe(
        true,
      );
    }
    if (!collisionResult.ok) {
      expect(collisionResult.issues.some((issue) => issue.code === "duplicate-id")).toBe(true);
    }
  });

  test("reports an invalid Gate pairing instead of accepting a self-pair", () => {
    const scenario: ScenarioInput = {
      ...minimalScenario,
      gateConnections: [
        {
          ...at(minimalScenario.gateConnections, 0),
          gateBId: at(minimalScenario.gateConnections, 0).gateAId,
        },
      ],
    };

    const result = compileScenario(scenario);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === "invalid-gate-pairing")).toBe(true);
    }
  });

  test("reports an invalid Gate pairing for two Gates in one System", () => {
    const destinationGate = at(minimalScenario.gates, 1);
    const scenario: ScenarioInput = {
      ...minimalScenario,
      gates: [
        at(minimalScenario.gates, 0),
        {
          ...destinationGate,
          systemId: at(minimalScenario.gates, 0).systemId,
          orbitalAnchorId: at(minimalScenario.orbitalAnchors, 0).id,
        },
      ],
    };

    const result = compileScenario(scenario);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === "invalid-gate-pairing")).toBe(true);
    }
  });

  test("rejects a physical quantity with the wrong SI unit", () => {
    const system = at(minimalScenario.systems, 0);
    const scenario = {
      ...minimalScenario,
      systems: [
        {
          ...system,
          positionAtEpoch: {
            ...system.positionAtEpoch,
            x: seconds(1),
          },
        },
        at(minimalScenario.systems, 1),
      ],
    } as unknown as ScenarioInput;

    const result = compileScenario(scenario);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === "invalid-quantity")).toBe(true);
    }
  });

  test("produces deterministic inspection text regardless of input ordering", () => {
    const reordered: ScenarioInput = {
      ...minimalScenario,
      systems: [...minimalScenario.systems].reverse(),
      orbitalAnchors: [...minimalScenario.orbitalAnchors].reverse(),
      gates: [...minimalScenario.gates].reverse(),
      gateConnections: [...minimalScenario.gateConnections].reverse(),
      shipProfiles: [...minimalScenario.shipProfiles].reverse(),
    };
    const first = formatScenarioInspection(inspectScenario(requireScenario(minimalScenario)));
    const second = formatScenarioInspection(inspectScenario(requireScenario(reordered)));

    expect(second).toBe(first);
  });

  test("exposes the same seam through a framework-independent model factory", () => {
    const model = createJourneyModel();
    const result = model.compileScenario(minimalScenario);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(model.inspectScenario(result.scenario).scenarioId).toBe("scenario:minimal");
    }
  });
});
