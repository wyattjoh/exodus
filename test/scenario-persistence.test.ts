import { describe, expect, test } from "bun:test";

import {
  CURRENT_SCENARIO_SCHEMA_VERSION,
  compileScenario,
  createJourneyModel,
  createScenarioExport,
  exactClaim,
  exportScenario,
  generateClusterRegion,
  importScenario,
  meters,
  minimalScenario,
  migrateScenario,
  novelProvenance,
  provisionalProvenance,
  rangeClaim,
  revertScenarioOverride,
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

function scenarioWithPersistenceData(): ScenarioInput {
  return {
    ...minimalScenario,
    generatorVersion: "globular-v1",
    seed: " 1 ",
    logicalPopulation: 10,
    references: [
      {
        id: "reference:journey",
        source: "Exodus",
        locator: "chapter 1",
        title: "A sourced journey",
        authority: "novel",
      },
    ],
    canonicalClaims: [
      {
        id: "claim:population",
        subject: "scenario:minimal",
        property: "logicalPopulation",
        claim: rangeClaim({
          lower: 8,
          upper: 12,
          nominal: 10,
          provenance: novelProvenance({ source: "Exodus", locator: "chapter 1" }),
        }),
      },
    ],
    overrides: [
      {
        id: "override:label",
        label: "Readable label",
        changes: [
          {
            entityType: "scenario",
            entityId: "scenario:minimal",
            property: "name",
            value: "Imported Centauri Cluster",
            reason: "User-facing saved name",
          },
        ],
      },
    ],
    journeyInputs: [
      {
        kind: "journey",
        departureGateId: "gate:terra",
        destinationGateId: "gate:selene",
        shipProfileId: "ship:survey",
        departureCoordinateTime: seconds(0),
        legs: [{ kind: "interstellar-cruise", destinationGateId: "gate:selene" }],
      },
    ],
  };
}

describe("Scenario persistence seam", () => {
  test("exports an immutable canonical document and round-trips all Scenario inputs", () => {
    const source = scenarioWithPersistenceData();
    const exported = exportScenario(source);
    const document = JSON.parse(exported) as Record<string, unknown>;

    expect(document.schemaVersion).toBe(CURRENT_SCENARIO_SCHEMA_VERSION);
    expect(document.generatorVersion).toBe("globular-v1");
    expect(document.seed).toEqual({
      identity: "string:3: 1 ",
      kind: "string",
      text: " 1 ",
      type: "string",
      value: " 1 ",
    });
    expect(document.logicalPopulation).toBe(10);
    expect(document.references).toHaveLength(1);
    expect(document.canonicalClaims).toHaveLength(1);
    expect(document.overrides).toHaveLength(1);
    expect(document.shipProfiles).toHaveLength(1);
    expect(document.journeyInputs).toHaveLength(1);

    const imported = importScenario(exported);
    expect(imported.ok).toBe(true);
    if (!imported.ok) {
      return;
    }

    expect(imported.scenario.name).toBe("Imported Centauri Cluster");
    expect(imported.scenario.logicalPopulation).toBe(10);
    expect(imported.scenario.seed?.identity).toBe("string:3: 1 ");
    expect(imported.scenario.references[0]?.citation.source).toBe("Exodus");
    expect(imported.scenario.canonicalClaims[0]?.claim.kind).toBe("range");
    expect(imported.scenario.canonicalClaims[0]?.claim).toMatchObject({
      lower: 8,
      nominal: 10,
      upper: 12,
    });
    expect(imported.scenario.overrideLayers).toHaveLength(1);
    expect(imported.scenario.journeyInputs).toHaveLength(1);
    expect(exportScenario(imported.scenario)).toBe(exported);
    expect(Object.isFrozen(imported.scenario)).toBe(true);
    expect(Object.isFrozen(imported.scenario.references)).toBe(true);
  });

  test("gives a hand-authored Scenario explicit deterministic persistence metadata", () => {
    const document = JSON.parse(exportScenario(minimalScenario)) as Record<string, unknown>;

    expect(document.generatorVersion).toBe("manual-v1");
    expect(document.seed).toMatchObject({
      type: "string",
      text: "manual",
      identity: "string:6:manual",
    });
    expect(document.logicalPopulation).toBe(2);
  });

  test("rejects non-finite Canonical Claim values before returning a document", () => {
    const claims = [
      exactClaim(Number.NaN, novelProvenance({ source: "Exodus", locator: "chapter 1" })),
      rangeClaim({
        lower: Number.NaN,
        upper: Number.NaN,
        nominal: Number.NaN,
        provenance: novelProvenance({ source: "Exodus", locator: "chapter 1" }),
      }),
    ];

    for (const [index, claim] of claims.entries()) {
      const compiled = compileScenario({
        ...minimalScenario,
        canonicalClaims: [
          {
            id: `claim:non-finite-${index}`,
            subject: minimalScenario.id,
            property: "test",
            claim,
          },
        ],
      });
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) {
        continue;
      }
      expect(() => createScenarioExport(compiled.scenario)).toThrow(/finite|JSON-safe/);
      expect(() => exportScenario(compiled.scenario)).toThrow(/finite|JSON-safe/);
    }
  });

  test("rejects hostile nested Canonical Claim values before returning a document", () => {
    const nestedUndefined: Record<string, unknown> = {
      nested: { value: undefined },
    };
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse: unknown[] = [];
    sparse.length = 2;
    const unsupportedObject = new Date(0);
    const unsupportedPrimitiveValues: readonly unknown[] = [
      Symbol("unsupported"),
      1n,
      () => "unsupported",
    ];

    for (const [index, value] of [
      nestedUndefined,
      cyclic,
      sparse,
      ...unsupportedPrimitiveValues,
      unsupportedObject,
    ].entries()) {
      const compiled = compileScenario({
        ...minimalScenario,
        canonicalClaims: [
          {
            id: `claim:hostile-${index}`,
            subject: minimalScenario.id,
            property: "test",
            claim: exactClaim(value, novelProvenance({ source: "Exodus", locator: "chapter 1" })),
          },
        ],
      });
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) {
        continue;
      }

      let document: ReturnType<typeof createScenarioExport> | undefined;
      expect(() => {
        document = createScenarioExport(compiled.scenario);
      }).toThrow(/undefined|cyclic|JSON-compatible|plain|sparse|symbol/);
      expect(document).toBeUndefined();
      expect(() => exportScenario(compiled.scenario)).toThrow(
        /undefined|cyclic|JSON-compatible|plain|sparse|symbol/,
      );
    }
  });

  test("rejects non-canonical own properties on hostile claim arrays", () => {
    const compiled = compileScenario(minimalScenario);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }

    const hostileArrayProperties: readonly [string, (array: unknown[]) => void][] = [
      [
        "01",
        (array) => {
          Object.defineProperty(array, "01", {
            configurable: true,
            enumerable: true,
            value: undefined,
          });
        },
      ],
      [
        "metadata",
        (array) => {
          Object.defineProperty(array, "metadata", {
            configurable: true,
            enumerable: true,
            value: { value: 1 },
          });
        },
      ],
    ];

    for (const [index, [property, configure]] of hostileArrayProperties.entries()) {
      const value = [1] as unknown[];
      configure(value);
      expect(Object.hasOwn(value, property)).toBe(true);
      const claim = {
        kind: "exact" as const,
        value,
        nominal: value,
        selectedNominal: value,
        provenance: novelProvenance({ source: "Exodus", locator: "chapter 1" }),
        precision: {
          significantDigits: 6,
          decimalPlaces: undefined,
          uncertainty: undefined,
          source: "default" as const,
        },
      };
      const source = Object.create(compiled.scenario) as Parameters<typeof createScenarioExport>[0];
      Object.defineProperty(source, "canonicalClaims", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: [
          {
            id: `claim:array-property-${index}`,
            subject: minimalScenario.id,
            property: "hostile-array",
            claim,
          },
        ],
      });

      let document: ReturnType<typeof createScenarioExport> | undefined;
      expect(() => {
        document = createScenarioExport(source);
      }).toThrow(/canonical array index|array/);
      expect(document).toBeUndefined();
      expect(() => exportScenario(source)).toThrow(/canonical array index|array/);
    }
  });

  test("validates every typed collection array through one dense boundary", () => {
    const compiled = compileScenario(scenarioWithPersistenceData());
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }

    const collections = [
      "canonicalClaims",
      "journeyInputs",
      "systems",
      "references",
      "overrideLayers",
    ] as const;
    const hostileArrayProperties: readonly {
      readonly label: string;
      readonly install: (array: unknown[], onRead: () => void) => PropertyKey;
    }[] = [
      ...["01", "00", "1.0", "+1", "-0", "1e0", "4294967295", "metadata"].map((key) => ({
        label: key,
        install: (array: unknown[]) => {
          Object.defineProperty(array, key, {
            configurable: true,
            enumerable: true,
            value: undefined,
          });
          return key;
        },
      })),
      {
        label: "symbol",
        install: (array: unknown[]) => {
          const key = Symbol("hostile");
          Object.defineProperty(array, key, {
            configurable: true,
            enumerable: true,
            value: undefined,
          });
          return key;
        },
      },
      {
        label: "non-enumerable",
        install: (array: unknown[]) => {
          const key = "nonEnumerable";
          Object.defineProperty(array, key, {
            configurable: true,
            enumerable: false,
            value: 1,
          });
          return key;
        },
      },
      {
        label: "accessor",
        install: (array: unknown[], onRead) => {
          const key = "0";
          Object.defineProperty(array, key, {
            configurable: true,
            enumerable: true,
            get: onRead,
          });
          return key;
        },
      },
    ];

    for (const collection of collections) {
      const baseEntries = compiled.scenario[collection] as readonly unknown[];
      for (const hostileArrayProperty of hostileArrayProperties) {
        const value = [...baseEntries];
        let accessorInvoked = false;
        const property = hostileArrayProperty.install(value, () => {
          accessorInvoked = true;
        });
        expect(Object.hasOwn(value, property)).toBe(true);
        const source = Object.create(compiled.scenario) as Parameters<
          typeof createScenarioExport
        >[0];
        Object.defineProperty(source, "overrideBase", {
          configurable: true,
          enumerable: true,
          writable: true,
          value: undefined,
        });
        Object.defineProperty(source, collection, {
          configurable: true,
          enumerable: true,
          writable: true,
          value,
        });

        let document: ReturnType<typeof createScenarioExport> | undefined;
        expect(() => {
          document = createScenarioExport(source);
        }).toThrow(/array|property|accessor|canonical|symbol/);
        expect(document).toBeUndefined();
        expect(() => exportScenario(source)).toThrow(/array|property|accessor|canonical|symbol/);
        expect(accessorInvoked).toBe(false);

        const rawCollection = collection === "overrideLayers" ? "overrides" : collection;
        const rawSource = {
          ...scenarioWithPersistenceData(),
          [rawCollection]: value,
        } as ScenarioInput;
        expect(() => createScenarioExport(rawSource)).toThrow(
          /array|property|accessor|canonical|symbol/,
        );
        expect(() => exportScenario(rawSource)).toThrow(/array|property|accessor|canonical|symbol/);
        expect(accessorInvoked).toBe(false);
      }
    }
  });

  test("fails closed on hostile nested raw ScenarioInput graphs", () => {
    const overrideSource = scenarioWithPersistenceData();
    const override = at(overrideSource.overrides ?? [], 0);
    const overrideChanges = [...override.changes];
    Object.defineProperty(overrideChanges, "metadata", {
      configurable: true,
      enumerable: true,
      value: undefined,
    });
    const hostileOverrideSource = {
      ...overrideSource,
      overrides: [{ ...override, changes: overrideChanges }],
    } as ScenarioInput;

    const journeySource = scenarioWithPersistenceData();
    const journey = at(journeySource.journeyInputs ?? [], 0);
    const journeyLegs = [...((journey.legs as readonly unknown[]) ?? [])];
    Object.defineProperty(journeyLegs, "metadata", {
      configurable: true,
      enumerable: true,
      value: undefined,
    });
    const hostileJourneySource = {
      ...journeySource,
      journeyInputs: [{ ...journey, legs: journeyLegs }],
    } as ScenarioInput;

    let accessorReads = 0;
    const accessorJourneySource = scenarioWithPersistenceData();
    const accessorJourney = at(accessorJourneySource.journeyInputs ?? [], 0);
    const accessorLegs = [...((accessorJourney.legs as readonly unknown[]) ?? [])];
    Object.defineProperty(accessorLegs, "0", {
      configurable: true,
      enumerable: true,
      get: () => {
        accessorReads += 1;
        throw new Error("hostile array accessor invoked");
      },
    });
    const hostileAccessorSource = {
      ...accessorJourneySource,
      journeyInputs: [{ ...accessorJourney, legs: accessorLegs }],
    } as ScenarioInput;

    const provenanceSource = scenarioWithPersistenceData();
    const system = at(provenanceSource.systems, 0);
    const provenance = novelProvenance({ source: "Exodus", locator: "chapter 1" });
    const citation = at(provenance.citations, 0);
    const hostileCitation = { ...citation, metadata: { value: undefined } };
    const hostileSystem = {
      ...system,
      properties: {
        positionAtEpoch: {
          provenance: { ...provenance, citations: [hostileCitation] },
        },
      },
    };
    const hostileProvenanceSource = {
      ...provenanceSource,
      systems: [hostileSystem, ...provenanceSource.systems.slice(1)],
    } as ScenarioInput;

    for (const source of [
      hostileOverrideSource,
      hostileJourneySource,
      hostileAccessorSource,
      hostileProvenanceSource,
    ]) {
      let document: ReturnType<typeof createScenarioExport> | undefined;
      expect(() => {
        document = createScenarioExport(source);
      }).toThrow(/array|accessor|undefined|JSON/);
      expect(document).toBeUndefined();
      expect(() => exportScenario(source)).toThrow(/array|accessor|undefined|JSON/);
    }
    expect(accessorReads).toBe(0);
  });

  test("rejects structurally spoofed compiled Scenarios without reading accessors", () => {
    const compiledResult = compileScenario(minimalScenario);
    expect(compiledResult.ok).toBe(true);
    if (!compiledResult.ok) {
      return;
    }
    const trustedIndex = compiledResult.scenario.index;
    let systemsReads = 0;
    const systemsSpoof = {
      ...minimalScenario,
      index: trustedIndex,
      overrideLayers: [],
    } as ScenarioInput & Record<string, unknown>;
    Object.defineProperty(systemsSpoof, "systems", {
      configurable: true,
      enumerable: true,
      get: () => {
        systemsReads += 1;
        throw new Error("systems accessor invoked");
      },
    });
    Object.defineProperty(systemsSpoof, "hostileField", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("hostile field accessor invoked");
      },
    });

    let hostileFieldReads = 0;
    const hostileFieldSpoof = {
      ...minimalScenario,
      index: trustedIndex,
      overrideLayers: [],
    } as ScenarioInput & Record<string, unknown>;
    Object.defineProperty(hostileFieldSpoof, "hostileField", {
      configurable: true,
      enumerable: true,
      get: () => {
        hostileFieldReads += 1;
        throw new Error("hostile field accessor invoked");
      },
    });

    for (const source of [systemsSpoof, hostileFieldSpoof]) {
      let document: ReturnType<typeof createScenarioExport> | undefined;
      expect(() => {
        document = createScenarioExport(source);
      }).toThrow(/accessor|compiled|JSON|derived|clone/);
      expect(document).toBeUndefined();
      expect(() => exportScenario(source)).toThrow(/accessor|compiled|JSON|derived|clone/);
    }
    expect(systemsReads).toBe(0);
    expect(hostileFieldReads).toBe(0);
  });

  test("rejects cross-scenario derived indexes instead of authorizing transplanted clones", () => {
    const firstResult = compileScenario(minimalScenario);
    const secondResult = compileScenario({ ...minimalScenario, name: "Second Scenario" });
    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    if (!firstResult.ok || !secondResult.ok) {
      return;
    }

    const transplantedIndex = {
      ...firstResult.scenario,
      index: secondResult.scenario.index,
    } as unknown as ScenarioInput;
    expect(() => createScenarioExport(transplantedIndex)).toThrow(/owner|derived|clone/);
    expect(() => exportScenario(transplantedIndex)).toThrow(/owner|derived|clone/);

    const firstWithOverride = compileScenario(scenarioWithPersistenceData());
    const secondWithOverride = compileScenario({
      ...scenarioWithPersistenceData(),
      overrides: [
        {
          id: "override:label",
          label: "Second label",
          changes: [
            {
              entityType: "scenario",
              entityId: "scenario:minimal",
              property: "name",
              value: "Second Imported Cluster",
            },
          ],
        },
      ],
    });
    expect(firstWithOverride.ok).toBe(true);
    expect(secondWithOverride.ok).toBe(true);
    if (!firstWithOverride.ok || !secondWithOverride.ok) {
      return;
    }
    const transplantedBase = {
      ...firstWithOverride.scenario,
      index: secondWithOverride.scenario.index,
      overrideBase: secondWithOverride.scenario.overrideBase,
    } as unknown as ScenarioInput;
    expect(() => exportScenario(transplantedBase)).toThrow(/owner|derived|clone/);
  });

  test("requires matching generation metadata aliases for self-importable exports", () => {
    const matchingProperties = {
      generatorVersion: {
        value: "globular-v1",
        provenance: provisionalProvenance(),
      },
      generationSeed: {
        value: "matching-seed",
        provenance: provisionalProvenance(),
      },
      logicalPopulation: {
        value: 3,
        provenance: provisionalProvenance(),
      },
    };
    const matchingSource = {
      ...minimalScenario,
      generatorVersion: "globular-v1",
      seed: "matching-seed",
      logicalPopulation: 3,
      properties: matchingProperties,
    } as ScenarioInput;
    const matchingExport = exportScenario(matchingSource);
    const matchingImport = importScenario(matchingExport);
    expect(matchingImport.ok).toBe(true);

    const conflictingSource = {
      ...matchingSource,
      properties: {
        ...matchingProperties,
        generatorVersion: {
          value: "manual-v1",
          provenance: provisionalProvenance(),
        },
      },
    } as ScenarioInput;
    expect(() => createScenarioExport(conflictingSource)).toThrow(/metadata|disagrees|agree/);
    expect(() => exportScenario(conflictingSource)).toThrow(/metadata|disagrees|agree/);
  });

  test("rejects altered raw direct fields instead of normalizing them away", () => {
    const property = (value: unknown) => ({
      value,
      provenance: provisionalProvenance(),
    });
    const system = at(minimalScenario.systems, 0);
    const anchor = at(minimalScenario.orbitalAnchors, 0);
    const gate = at(minimalScenario.gates, 0);
    const connection = at(minimalScenario.gateConnections, 0);
    const shipProfile = at(minimalScenario.shipProfiles, 0);
    const sources: ScenarioInput[] = [
      {
        ...minimalScenario,
        designation: "SCN-ALTERED",
        properties: { designation: property(minimalScenario.designation) },
      },
      {
        ...minimalScenario,
        name: "Altered Scenario",
        properties: { name: property(minimalScenario.name) },
      },
      {
        ...minimalScenario,
        epoch: { ...minimalScenario.epoch, label: "T+1" },
        properties: { epoch: property(minimalScenario.epoch) },
      },
      {
        ...minimalScenario,
        systems: [
          {
            ...system,
            name: "Altered System",
            properties: { name: property(system.name) },
          },
          ...minimalScenario.systems.slice(1),
        ],
      },
      {
        ...minimalScenario,
        systems: [
          {
            ...system,
            positionAtEpoch: {
              ...system.positionAtEpoch,
              x: meters(1),
            },
            properties: { positionAtEpoch: property(system.positionAtEpoch) },
          },
          ...minimalScenario.systems.slice(1),
        ],
      },
      {
        ...minimalScenario,
        orbitalAnchors: [
          {
            ...anchor,
            kind: "planet",
            properties: { kind: property(anchor.kind) },
          },
          ...minimalScenario.orbitalAnchors.slice(1),
        ],
      },
      {
        ...minimalScenario,
        orbitalAnchors: [
          {
            ...anchor,
            systemId: "system:selene",
            properties: { systemId: property(anchor.systemId) },
          },
          ...minimalScenario.orbitalAnchors.slice(1),
        ],
      },
      {
        ...minimalScenario,
        gates: [
          {
            ...gate,
            orbitalAnchorId: "anchor:selene-star",
            properties: { orbitalAnchorId: property(gate.orbitalAnchorId) },
          },
          ...minimalScenario.gates.slice(1),
        ],
      },
      {
        ...minimalScenario,
        gateConnections: [
          {
            ...connection,
            gateAId: "gate:selene",
            properties: { gateAId: property(connection.gateAId) },
          },
          ...minimalScenario.gateConnections.slice(1),
        ],
      },
      {
        ...minimalScenario,
        shipProfiles: [
          {
            ...shipProfile,
            hasZpzGenerator: false,
            properties: { hasZpzGenerator: property(shipProfile.hasZpzGenerator) },
          },
          ...minimalScenario.shipProfiles.slice(1),
        ],
      },
    ];
    for (const source of sources) {
      expect(() => createScenarioExport(source)).toThrow(/disagrees|metadata|agree/);
      expect(() => exportScenario(source)).toThrow(/disagrees|metadata|agree/);
    }
  });

  test("rejects raw direct-field and persisted alias conflicts transactionally", () => {
    const valid = JSON.parse(exportScenario(scenarioWithPersistenceData())) as Record<
      string,
      unknown
    >;
    const validProperties = valid.properties as Record<string, unknown>;
    const validPropertyProvenance = valid.propertyProvenance as Record<string, unknown>;
    const conflictingMetadata = {
      ...valid,
      propertyProvenance: {
        ...validPropertyProvenance,
        name: {
          ...(validPropertyProvenance.name as Record<string, unknown>),
          value: "Conflicting metadata name",
        },
      },
    };
    const conflictingMetadataImport = importScenario(conflictingMetadata);
    expect(conflictingMetadataImport.ok).toBe(false);
    if (!conflictingMetadataImport.ok) {
      expect(conflictingMetadataImport.scenario).toBeUndefined();
      expect(
        conflictingMetadataImport.issues.some((issue) => issue.path.includes("property")),
      ).toBe(true);
    }

    const matchingAliases = importScenario({
      ...valid,
      savedJourneyInputs: valid.journeyInputs,
      propertyProvenance: validProperties,
    });
    expect(matchingAliases.ok).toBe(true);

    const conflictingJourneyAliases = importScenario({
      ...valid,
      savedJourneyInputs: [{ kind: "conflicting-journey" }],
    });
    expect(conflictingJourneyAliases.ok).toBe(false);
    if (!conflictingJourneyAliases.ok) {
      expect(conflictingJourneyAliases.scenario).toBeUndefined();
      expect(conflictingJourneyAliases.issues.some((issue) => issue.path === "journeyInputs")).toBe(
        true,
      );
    }

    const rawDirectConflict = {
      ...minimalScenario,
      properties: {
        name: {
          value: "Raw metadata name",
          provenance: provisionalProvenance(),
        },
      },
    } as ScenarioInput;
    expect(() => createScenarioExport(rawDirectConflict)).toThrow(/disagrees|metadata/);
    expect(() => exportScenario(rawDirectConflict)).toThrow(/disagrees|metadata/);
  });

  test("rejects generated-region Proxy TOCTOU spoofing without invoking accessors", () => {
    const generated = generateClusterRegion({
      logicalPopulation: 8,
      seed: "proxy-toctou",
      generatorVersion: "globular-v1",
      materializedSystemCount: 4,
    });
    let spoofOverrideBaseReads = 0;
    const spoof = { ...generated.scenario } as ScenarioInput & Record<string, unknown>;
    Object.defineProperty(spoof, "overrideBase", {
      configurable: true,
      enumerable: true,
      get: () => {
        spoofOverrideBaseReads += 1;
        throw new Error("spoofed overrideBase accessor invoked");
      },
    });
    const generatedRegionProxy = new Proxy(
      {},
      {
        ownKeys: () => ["scenario"],
        getOwnPropertyDescriptor: (_target, key) =>
          key === "scenario"
            ? {
                configurable: true,
                enumerable: true,
                writable: true,
                value: generated.scenario,
              }
            : undefined,
        get: (_target, key) => (key === "scenario" ? spoof : undefined),
      },
    );

    let document: ReturnType<typeof createScenarioExport> | undefined;
    expect(() => {
      document = createScenarioExport(generatedRegionProxy as unknown as ScenarioInput);
    }).toThrow(/JSON|function|plain|undefined/);
    expect(document).toBeUndefined();
    expect(() => exportScenario(generatedRegionProxy as unknown as ScenarioInput)).toThrow(
      /JSON|function|plain|undefined/,
    );
    expect(spoofOverrideBaseReads).toBe(0);
  });

  test("keeps genuine compiled, generated, and imported Scenarios exportable", () => {
    const compiledResult = compileScenario(minimalScenario);
    expect(compiledResult.ok).toBe(true);
    if (!compiledResult.ok) {
      return;
    }

    const compiledExport = exportScenario(compiledResult.scenario);
    const spreadExport = exportScenario({ ...compiledResult.scenario });
    expect(spreadExport).toBe(compiledExport);
    const invalidSpread = { ...compiledResult.scenario, id: undefined } as unknown as ScenarioInput;
    expect(() => exportScenario(invalidSpread)).toThrow(/undefined|derived|clone/);

    const compiledImport = importScenario(compiledExport);
    expect(compiledImport.ok).toBe(true);
    if (compiledImport.ok) {
      expect(exportScenario(compiledImport.scenario)).toBe(compiledExport);
    }

    const generated = generateClusterRegion({
      logicalPopulation: 8,
      seed: "trusted-generated",
      generatorVersion: "globular-v1",
      materializedSystemCount: 4,
    });
    const generatedExport = exportScenario(generated.scenario);
    expect(exportScenario(generated)).toBe(generatedExport);
    const generatedImport = importScenario(generatedExport);
    expect(generatedImport.ok).toBe(true);
    if (generatedImport.ok) {
      expect(exportScenario(generatedImport.scenario)).toBe(generatedExport);
    }
  });

  test("preserves generated identity and prior generator metadata", () => {
    const generated = generateClusterRegion({
      logicalPopulation: 8,
      seed: " prior generator ",
      generatorVersion: "globular-v1",
      materializedSystemCount: 4,
    });
    const exported = exportScenario(generated.scenario);
    const imported = importScenario(exported);

    expect(imported.ok).toBe(true);
    if (!imported.ok) {
      return;
    }

    expect(imported.scenario.generatorVersion).toBe("globular-v1");
    expect(imported.scenario.seed).toMatchObject({
      type: "string",
      text: " prior generator ",
      identity: "string:17: prior generator ",
    });
    expect(imported.scenario.logicalPopulation).toBe(8);
    expect(imported.scenario.systems.map((system) => system.id)).toEqual(
      generated.scenario.systems.map((system) => system.id),
    );
    expect(imported.scenario.gates.map((gate) => gate.designation)).toEqual(
      generated.scenario.gates.map((gate) => gate.designation),
    );
    const importedSeed = imported.scenario.seed;
    const importedPopulation = imported.scenario.logicalPopulation;
    const importedGeneratorVersion = imported.scenario.generatorVersion;
    if (
      importedSeed === undefined ||
      importedPopulation === undefined ||
      importedGeneratorVersion === undefined
    ) {
      throw new Error("Expected imported generation metadata.");
    }
    const replayed = generateClusterRegion({
      logicalPopulation: importedPopulation,
      seed: importedSeed.value,
      generatorVersion: importedGeneratorVersion,
      materializedSystemCount: 4,
    });
    expect(replayed.scenario.systems.map((system) => system.id)).toEqual(
      generated.scenario.systems.map((system) => system.id),
    );
    expect(exportScenario(imported.scenario)).toBe(exported);
  });

  test("rejects unsupported generator versions at import and generation seams", () => {
    const valid = JSON.parse(exportScenario(scenarioWithPersistenceData())) as Record<
      string,
      unknown
    >;
    const imported = importScenario({ ...valid, generatorVersion: "globular-v99" });

    expect(imported.ok).toBe(false);
    if (!imported.ok) {
      expect(imported.scenario).toBeUndefined();
      expect(imported.issues.some((issue) => issue.code === "unsupported-generator-version")).toBe(
        true,
      );
    }
    expect(() =>
      generateClusterRegion({
        logicalPopulation: 8,
        seed: 1,
        generatorVersion: "globular-v99",
        materializedSystemCount: 4,
      }),
    ).toThrow(/Unsupported Cluster generatorVersion/);
  });

  test("rejects invalid imports transactionally with actionable issues", () => {
    const valid = JSON.parse(exportScenario(scenarioWithPersistenceData())) as Record<
      string,
      unknown
    >;
    const firstGate = at(valid.gates as Record<string, unknown>[], 0);
    const firstGateProperties = firstGate.properties as Record<string, unknown>;
    const invalid = {
      ...valid,
      gates: [
        {
          ...firstGate,
          orbitalAnchorId: "anchor:missing",
          properties: {
            ...firstGateProperties,
            orbitalAnchorId: {
              ...(firstGateProperties.orbitalAnchorId as Record<string, unknown>),
              value: "anchor:missing",
            },
          },
        },
        ...(valid.gates as Record<string, unknown>[]).slice(1),
      ],
    };

    const result = importScenario(invalid);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.scenario).toBeUndefined();
      expect(result.issues.some((issue) => issue.path.includes("orbitalAnchorId"))).toBe(true);
      expect(result.issues.every((issue) => issue.message.length > 0)).toBe(true);
    }
  });

  test("rejects prototype pollution and non-finite values at the unknown JSON seam", () => {
    const valid = JSON.parse(exportScenario(scenarioWithPersistenceData())) as Record<
      string,
      unknown
    >;

    const pollutedDocument = { ...valid };
    Object.defineProperty(pollutedDocument, "__proto__", {
      configurable: true,
      enumerable: true,
      value: { polluted: true },
    });
    const polluted = importScenario(JSON.stringify(pollutedDocument));
    const nonFinite = importScenario({ ...valid, logicalPopulation: Number.NaN });

    expect(polluted.ok).toBe(false);
    expect(nonFinite.ok).toBe(false);
    if (!polluted.ok) {
      expect(polluted.issues.some((issue) => issue.code === "prototype-pollution")).toBe(true);
    }
    if (!nonFinite.ok) {
      expect(nonFinite.issues.some((issue) => issue.code === "non-finite-number")).toBe(true);
    }
  });

  test("migrates the fixed v1 fixture deterministically", async () => {
    const fixture = await Bun.file("test/fixtures/scenario-v1.json").json();
    const migration = migrateScenario(fixture);

    expect(migration.ok).toBe(true);
    if (!migration.ok) {
      return;
    }

    expect(migration.migrated).toBe(true);
    expect(migration.fromSchemaVersion).toBe(1);
    expect(migration.toSchemaVersion).toBe(CURRENT_SCENARIO_SCHEMA_VERSION);
    expect(migration.document.overrides).toHaveLength(1);
    expect(migration.document.journeyInputs).toHaveLength(1);
    const migratedImport = importScenario(migration.serialized);
    expect(migratedImport.ok).toBe(true);
    if (!migratedImport.ok) {
      return;
    }
    expect(migration.serialized).toBe(exportScenario(migratedImport.scenario));

    const imported = importScenario(migration.serialized);
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.scenario.name).toBe("Migrated Centauri Cluster");
      expect(imported.scenario.canonicalClaims[0]?.claim.kind).toBe("range");
      expect(imported.scenario.overrideLayers[0]?.id).toBe("override:v1");
      expect(exportScenario(imported.scenario)).toBe(migration.serialized);
    }
  });

  test("preserves override bases across migrated and hand-authored spread clones", async () => {
    const fixture = await Bun.file("test/fixtures/scenario-v1.json").json();
    const migration = migrateScenario(fixture);
    expect(migration.ok).toBe(true);
    if (!migration.ok) {
      return;
    }

    const trustedMigrationExport = exportScenario(migration.scenario);
    const spreadMigrationExport = exportScenario({ ...migration.scenario });
    expect(spreadMigrationExport).toBe(trustedMigrationExport);

    const trustedMigrationImport = importScenario(trustedMigrationExport);
    const spreadMigrationImport = importScenario(spreadMigrationExport);
    expect(trustedMigrationImport.ok).toBe(true);
    expect(spreadMigrationImport.ok).toBe(true);
    if (!trustedMigrationImport.ok || !spreadMigrationImport.ok) {
      return;
    }
    const trustedMigrationReverted = revertScenarioOverride(
      trustedMigrationImport.scenario,
      "override:v1",
    );
    const spreadMigrationReverted = revertScenarioOverride(
      spreadMigrationImport.scenario,
      "override:v1",
    );
    expect(trustedMigrationReverted.name).toBe("Original Centauri Cluster");
    expect(spreadMigrationReverted.name).toBe("Original Centauri Cluster");
    expect(exportScenario(spreadMigrationReverted)).toBe(exportScenario(trustedMigrationReverted));

    const handAuthoredResult = compileScenario(scenarioWithPersistenceData());
    expect(handAuthoredResult.ok).toBe(true);
    if (!handAuthoredResult.ok) {
      return;
    }
    const trustedHandAuthoredExport = exportScenario(handAuthoredResult.scenario);
    const spreadHandAuthoredExport = exportScenario({ ...handAuthoredResult.scenario });
    expect(spreadHandAuthoredExport).toBe(trustedHandAuthoredExport);

    const trustedHandAuthoredImport = importScenario(trustedHandAuthoredExport);
    const spreadHandAuthoredImport = importScenario(spreadHandAuthoredExport);
    expect(trustedHandAuthoredImport.ok).toBe(true);
    expect(spreadHandAuthoredImport.ok).toBe(true);
    if (!trustedHandAuthoredImport.ok || !spreadHandAuthoredImport.ok) {
      return;
    }
    const trustedHandAuthoredReverted = revertScenarioOverride(
      trustedHandAuthoredImport.scenario,
      "override:label",
    );
    const spreadHandAuthoredReverted = revertScenarioOverride(
      spreadHandAuthoredImport.scenario,
      "override:label",
    );
    expect(trustedHandAuthoredReverted.name).toBe("Minimal Centauri Cluster");
    expect(spreadHandAuthoredReverted.name).toBe("Minimal Centauri Cluster");
    expect(exportScenario(spreadHandAuthoredReverted)).toBe(
      exportScenario(trustedHandAuthoredReverted),
    );
  });

  test("rejects forged spread override metadata and derived accessors", () => {
    const compiledResult = compileScenario(scenarioWithPersistenceData());
    expect(compiledResult.ok).toBe(true);
    if (!compiledResult.ok || compiledResult.scenario.overrideBase === undefined) {
      return;
    }
    const trusted = compiledResult.scenario;
    const forgedBase = { ...trusted.overrideBase };
    const forgedOverrideBase = { ...trusted, overrideBase: forgedBase } as unknown as ScenarioInput;
    const forgedIndex = {
      ...trusted,
      index: { ...trusted.index },
    } as unknown as ScenarioInput;

    let overrideBaseReads = 0;
    const accessorOverrideBase = { ...trusted } as ScenarioInput & Record<string, unknown>;
    Object.defineProperty(accessorOverrideBase, "overrideBase", {
      configurable: true,
      enumerable: true,
      get: () => {
        overrideBaseReads += 1;
        throw new Error("forged overrideBase accessor invoked");
      },
    });

    for (const source of [forgedOverrideBase, forgedIndex, accessorOverrideBase]) {
      let document: ReturnType<typeof createScenarioExport> | undefined;
      expect(() => {
        document = createScenarioExport(source);
      }).toThrow(/overrideBase|JSON|function|undefined|derived|clone/);
      expect(document).toBeUndefined();
      expect(() => exportScenario(source)).toThrow(
        /overrideBase|JSON|function|undefined|derived|clone/,
      );
    }
    expect(overrideBaseReads).toBe(0);
  });

  test("exposes persistence through the framework-independent model factory", () => {
    const model = createJourneyModel();
    const bytes = model.exportScenario(minimalScenario);
    const imported = model.importScenario(bytes);

    expect(imported.ok).toBe(true);
    expect(bytes).toBe(exportScenario(minimalScenario));
  });

  test("rejects unsupported schema versions without exposing a replacement Scenario", () => {
    const valid = JSON.parse(exportScenario(scenarioWithPersistenceData())) as Record<
      string,
      unknown
    >;
    const result = importScenario({ ...valid, schemaVersion: 99 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.scenario).toBeUndefined();
      expect(result.issues.some((issue) => issue.code === "unsupported-schema-version")).toBe(true);
    }
  });
});
