import { describe, expect, test } from "bun:test";

import {
  applyScenarioOverrides,
  compareCanonicalClaim,
  compareScenarioOverrides,
  compileScenario,
  conservativeBounds,
  createCanonDiscrepancy,
  createProvenance,
  derivedResult,
  displayPrecisionForClaim,
  exactClaim,
  generatedProvenance,
  meters,
  minimalScenario,
  novelProvenance,
  qualitativeClaim,
  rangeClaim,
  revertScenarioOverride,
  selectNominal,
  simulateJourney,
  seconds,
  supplementaryOfficialProvenance,
  type ScenarioInput,
  type ScenarioOverrideLayerInput,
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

describe("provenance and uncertainty Journey Model seam", () => {
  test("keeps source authority, claim form, and selected nominal distinct", () => {
    const citation = {
      source: "Exodus: The Archimedes Engine",
      locator: "chapter 4",
    } as const;
    const novel = novelProvenance(citation);
    const claim = rangeClaim({
      lower: 40,
      upper: 50,
      nominal: 45,
      provenance: novel,
    });
    const selected = selectNominal(claim, 47);
    const qualitative = qualitativeClaim("described as a short journey", novel);

    expect(novel.kind).toBe("novel");
    expect(novel.citations[0]?.source).toBe(citation.source);
    expect(claim.kind).toBe("range");
    expect(claim.lower).toBe(40);
    expect(claim.upper).toBe(50);
    expect(claim.nominal).toBe(45);
    expect(selected.kind).toBe("selected-nominal");
    expect(selected.value).toBe(47);
    expect(selected.claim).toEqual(claim);
    expect(qualitative.kind).toBe("qualitative");
    expect(qualitative.statement).toContain("short");
  });

  test("preserves canonical identity while compiling generated property provenance", () => {
    const canonicalCitation = {
      source: "Exodus: The Archimedes Engine",
      locator: "appendix A",
    } as const;
    const generated = generatedProvenance("centauri-generator@1");
    const system = at(minimalScenario.systems, 0);
    const scenario: ScenarioInput = {
      ...minimalScenario,
      systems: [
        {
          ...system,
          canonicalIdentity: {
            id: system.id,
            provenance: novelProvenance(canonicalCitation),
          },
          properties: {
            positionAtEpoch: {
              provenance: generated,
              claim: exactClaim(system.positionAtEpoch, generated),
            },
          },
        },
        at(minimalScenario.systems, 1),
      ],
    };

    const compiled = requireScenario(scenario);
    const compiledSystem = compiled.systems.find((candidate) => candidate.id === system.id);
    if (compiledSystem === undefined) {
      throw new Error("Expected the canonical Terra System.");
    }

    expect(compiledSystem.canonicalIdentity.id).toBe(system.id);
    expect(compiledSystem.canonicalIdentity.provenance.kind).toBe("novel");
    expect(compiledSystem.properties.positionAtEpoch?.provenance.kind).toBe("generated");
    expect(compiledSystem.properties.positionAtEpoch?.canonicalClaim?.kind).toBe("exact");
    expect(compiledSystem.properties.positionAtEpoch?.selectedNominal).toEqual(
      system.positionAtEpoch,
    );
    expect(compiledSystem.positionAtEpoch).toEqual(system.positionAtEpoch);
  });

  test("reports conservative bounds and display precision on Journey phases and totals", () => {
    const source = at(minimalScenario.systems, 1);
    const generated = generatedProvenance("test-generator@1");
    const scenario = requireScenario({
      ...minimalScenario,
      systems: [
        at(minimalScenario.systems, 0),
        {
          ...source,
          properties: {
            positionAtEpoch: {
              provenance: generated,
              claim: rangeClaim({
                lower: source.positionAtEpoch,
                upper: source.positionAtEpoch,
                nominal: source.positionAtEpoch,
                provenance: generated,
                precision: { significantDigits: 3 },
              }),
            },
          },
        },
      ],
    });
    const result = simulateJourney(scenario, {
      departureGateId: "gate:terra",
      destinationGateId: "gate:selene",
      shipProfileId: "ship:survey",
      departureCoordinateTime: seconds(0),
      cruiseSpeed: undefined,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.timeline.totalBounds.nominal).toEqual(result.timeline.total);
    expect(result.timeline.totalBounds.lower.clusterCoordinateTime.value).toBeLessThanOrEqual(
      result.timeline.total.clusterCoordinateTime.value,
    );
    expect(result.timeline.totalBounds.upper.clusterCoordinateTime.value).toBeGreaterThanOrEqual(
      result.timeline.total.clusterCoordinateTime.value,
    );
    expect(result.timeline.phases.every((phase) => phase.bounds !== undefined)).toBe(true);
    expect(result.timeline.displayPrecision.significantDigits).toBeLessThanOrEqual(3);
  });

  test("applies, compares, and reverts layered overrides immutably", () => {
    const scenario = requireScenario(minimalScenario);
    const layer: ScenarioOverrideLayerInput = {
      id: "override:survey-name",
      label: "Survey naming experiment",
      changes: [
        {
          entityType: "ship-profile",
          entityId: "ship:survey",
          property: "name",
          value: "Survey Ship (override)",
        },
      ],
    };
    const applied = applyScenarioOverrides(scenario, [layer]);
    const metadataOnly = applyScenarioOverrides(scenario, [
      {
        id: "override:metadata-name",
        label: "Metadata-only naming experiment",
        changes: [
          {
            entityType: "ship-profile",
            entityId: "ship:survey",
            property: "properties.name",
            value: "Metadata-only name",
          },
        ],
      },
    ]);
    const profile = at(applied.shipProfiles, 0);
    const metadataOnlyProfile = at(metadataOnly.shipProfiles, 0);
    const originalProfile = at(scenario.shipProfiles, 0);
    const comparison = compareScenarioOverrides(scenario, applied);
    const reverted = revertScenarioOverride(applied, layer.id);

    expect(originalProfile.name).toBe("Survey Ship");
    expect(profile.name).toBe("Survey Ship (override)");
    expect(profile.properties.name?.provenance.kind).toBe("override");
    expect(metadataOnlyProfile.name).toBe(originalProfile.name);
    expect(metadataOnlyProfile.properties.name?.value).toBe("Metadata-only name");
    expect(comparison.some((change) => change.layerId === layer.id && change.changed)).toBe(true);
    expect(at(reverted.shipProfiles, 0).name).toBe(originalProfile.name);
    expect(at(reverted.shipProfiles, 0).provenance.kind).toBe(originalProfile.provenance.kind);
    expect(at(scenario.shipProfiles, 0).name).toBe("Survey Ship");
  });

  test("returns structured issues for invalid override references", () => {
    const result = compileScenario({
      ...minimalScenario,
      overrides: [
        {
          id: "override:missing-profile",
          label: "Missing profile",
          changes: [
            {
              entityType: "ship-profile",
              entityId: "ship:missing",
              property: "name",
              value: "No such ship",
            },
          ],
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === "invalid-override")).toBe(true);
  });

  test("preserves Canon Discrepancies without mutating either claim or result", () => {
    const provenance = novelProvenance({ source: "Exodus", locator: "chapter 9" });
    const claim = exactClaim(seconds(45 * 60 * 60), provenance);
    const result = derivedResult(seconds(62.12 * 86_400));
    const discrepancy = compareCanonicalClaim("journey-duration", claim, result);
    const explicit = createCanonDiscrepancy("journey-duration", claim, result);

    expect(discrepancy?.canonicalClaim).toEqual(claim);
    expect(discrepancy?.derivedResult).toEqual(result);
    expect(explicit.canonicalClaim).toEqual(claim);
    expect(explicit.derivedResult).toEqual(result);
    expect(discrepancy?.property).toBe("journey-duration");
  });

  test("derives display precision from uncertainty rather than binary float digits", () => {
    const claim = rangeClaim({
      lower: 3.7,
      upper: 3.9,
      nominal: 3.8,
      provenance: generatedProvenance("test-generator@1"),
    });
    const precision = displayPrecisionForClaim(claim);

    expect(precision.source).toBe("uncertainty");
    expect(precision.decimalPlaces).toBe(1);
    expect(precision.significantDigits).toBe(2);
  });

  test("validates override values before rebuilding compiled indexes", () => {
    const scenario = requireScenario(minimalScenario);
    const invalidLayers: readonly ScenarioOverrideLayerInput[] = [
      {
        id: "override:invalid-position",
        label: "Invalid position",
        changes: [
          {
            entityType: "gate",
            entityId: "gate:terra",
            property: "positionAtEpoch",
            value: "not a vector",
          },
        ],
      },
      {
        id: "override:missing-system",
        label: "Missing system",
        changes: [
          {
            entityType: "gate",
            entityId: "gate:terra",
            property: "systemId",
            value: "system:missing",
          },
        ],
      },
      {
        id: "override:identity-change",
        label: "Identity change",
        changes: [
          {
            entityType: "gate",
            entityId: "gate:terra",
            property: "id",
            value: "gate:new",
          },
        ],
      },
      {
        id: "override:cross-system-anchor",
        label: "Cross-system anchor",
        changes: [
          {
            entityType: "gate",
            entityId: "gate:terra",
            property: "systemId",
            value: "system:selene",
          },
        ],
      },
    ];

    for (const layer of invalidLayers) {
      expect(() => applyScenarioOverrides(scenario, [layer])).toThrow(RangeError);
      const result = compileScenario({ ...minimalScenario, overrides: [layer] });
      expect(result.ok).toBe(false);
      if (result.ok) {
        continue;
      }
      expect(result.issues.some((issue) => issue.code === "invalid-override")).toBe(true);
    }
  });

  test("snapshots structured claims, bounds, selected nominals, and discrepancies", () => {
    const provenance = generatedProvenance("snapshot-test@1");
    const lower = {
      x: { value: 0, unit: "m" },
      y: { value: 0, unit: "m" },
      z: { value: 0, unit: "m" },
    };
    const upper = {
      x: { value: 10, unit: "m" },
      y: { value: 20, unit: "m" },
      z: { value: 30, unit: "m" },
    };
    const nominal = {
      x: { value: 5, unit: "m" },
      y: { value: 10, unit: "m" },
      z: { value: 15, unit: "m" },
    };
    const claim = rangeClaim({ lower, upper, nominal, provenance });
    const bounds = conservativeBounds(nominal, lower, upper);
    const selectedSource = {
      x: { value: 4, unit: "m" },
      y: { value: 8, unit: "m" },
      z: { value: 12, unit: "m" },
    };
    const selected = selectNominal(claim, selectedSource);

    lower.x.value = -100;
    upper.y.value = 200;
    nominal.z.value = 300;
    selectedSource.x.value = 400;

    expect(claim.lower.x.value).toBe(0);
    expect(claim.upper.y.value).toBe(20);
    expect(claim.nominal.z.value).toBe(15);
    expect(bounds.nominal.x.value).toBe(5);
    expect(selected.value.x.value).toBe(4);
    expect(Object.isFrozen(claim.lower)).toBe(true);
    expect(Object.isFrozen(claim.lower.x)).toBe(true);

    const canonicalSource = { value: 10, unit: "s" };
    const derivedSource = { value: 20, unit: "s" };
    const canonicalClaim = exactClaim(
      canonicalSource,
      novelProvenance({ source: "Exodus", locator: "chapter 1" }),
    );
    const derived = derivedResult(derivedSource);
    const discrepancy = createCanonDiscrepancy("duration", canonicalClaim, derived);
    canonicalSource.value = 100;
    derivedSource.value = 200;

    expect(canonicalClaim.value.value).toBe(10);
    expect(derived.nominal.value).toBe(20);
    expect(discrepancy.canonicalClaim.kind).toBe("exact");
    if (discrepancy.canonicalClaim.kind !== "exact") {
      return;
    }
    expect(discrepancy.canonicalClaim.value.value).toBe(10);
    expect(discrepancy.derivedResult.nominal.value).toBe(20);
    expect(Object.isFrozen(discrepancy.canonicalClaim.value)).toBe(true);
    expect(Object.isFrozen(discrepancy.derivedResult.nominal)).toBe(true);
  });

  test("snapshots effective structured override values", () => {
    const scenario = requireScenario(minimalScenario);
    const position = {
      x: { value: 123, unit: "m" },
      y: { value: 456, unit: "m" },
      z: { value: 789, unit: "m" },
    };
    const applied = applyScenarioOverrides(scenario, [
      {
        id: "override:mutable-position",
        label: "Mutable position input",
        changes: [
          {
            entityType: "gate",
            entityId: "gate:terra",
            property: "positionAtEpoch",
            value: position,
          },
        ],
      },
    ]);
    position.x.value = 999;

    const gate = applied.gates.find((candidate) => candidate.id === "gate:terra");
    if (gate === undefined) {
      throw new Error("Expected the overridden Terra Gate.");
    }
    expect(Number(gate.positionAtEpoch.x.value)).toBe(123);
    expect(gate.properties.positionAtEpoch?.value).toEqual(gate.positionAtEpoch);
    expect(applied.overrideLayers[0]?.changes[0]?.value).toEqual(gate.positionAtEpoch);
  });

  test("does not compare Canonical Claim ranges across SI units", () => {
    type TaggedValue = { readonly value: number; readonly unit: string };
    const provenance = generatedProvenance("unit-test@1");
    const metersClaim = rangeClaim<TaggedValue>({
      lower: { value: 0, unit: "m" },
      upper: { value: 10, unit: "m" },
      nominal: { value: 5, unit: "m" },
      provenance,
    });
    const secondsResult = derivedResult<TaggedValue>({ value: 5, unit: "s" });
    const discrepancy = compareCanonicalClaim("distance", metersClaim, secondsResult);

    expect(discrepancy).toBeDefined();
    if (discrepancy === undefined || discrepancy.canonicalClaim.kind !== "range") {
      return;
    }
    expect(discrepancy.canonicalClaim.lower.unit).toBe("m");
    expect(discrepancy.derivedResult.nominal.unit).toBe("s");
    expect(() =>
      rangeClaim<TaggedValue>({
        lower: { value: 0, unit: "m" },
        upper: { value: 10, unit: "s" },
        nominal: { value: 5, unit: "m" },
        provenance,
      }),
    ).toThrow(RangeError);
  });

  test("only explicit Seconds ranges contribute to temporal uncertainty", () => {
    const provenance = generatedProvenance("uncertainty-test@1");
    const metersNamedDuration = rangeClaim({
      lower: meters(0),
      upper: meters(100),
      nominal: meters(50),
      provenance,
    });
    const explicitSeconds = rangeClaim({
      lower: seconds(10),
      upper: seconds(30),
      nominal: seconds(20),
      provenance,
    });
    const distanceScenario = requireScenario({
      ...minimalScenario,
      canonicalClaims: [
        {
          id: "claim:distance-duration",
          subject: "scenario:minimal",
          property: "duration",
          claim: metersNamedDuration,
        },
      ],
    });
    const timeScenario = requireScenario({
      ...minimalScenario,
      canonicalClaims: [
        {
          id: "claim:explicit-time",
          subject: "scenario:minimal",
          property: "not-a-duration-name",
          claim: explicitSeconds,
        },
      ],
    });

    expect(distanceScenario.uncertainty.hasUncertainty).toBe(true);
    expect(distanceScenario.uncertainty.relativeFactor).toBe(0);
    expect(distanceScenario.uncertainty.absoluteSeconds).toBe(0);
    expect(timeScenario.uncertainty.absoluteSeconds).toBe(10);
    expect(timeScenario.uncertainty.relativeFactor).toBeGreaterThan(0);
  });

  test("requires sourced citation authority to match provenance kind", () => {
    expect(() =>
      novelProvenance({
        source: "official catalogue",
        locator: "entry 1",
        authority: "supplementary-official",
      }),
    ).toThrow(RangeError);
    expect(() =>
      supplementaryOfficialProvenance({
        source: "Exodus canon",
        locator: "chapter 1",
        authority: "novel",
      }),
    ).toThrow(RangeError);
    expect(() =>
      createProvenance({
        kind: "novel",
        authority: "supplementary-official",
        citations: [{ source: "Exodus", locator: "chapter 1" }],
      }),
    ).toThrow(RangeError);
  });
});
