import { describe, expect, test } from "bun:test";

import {
  createJourneyModel,
  createScenarioOverrideLayer,
  multiLegJourneyScenario,
  rangeClaim,
  provisionalProvenance,
  seconds,
} from "../src/index";
import {
  createMemoryScenarioBackend,
  createScenarioRepository,
  type ScenarioRepository,
  type ScenarioStorageBackend,
} from "../app/scenario-repository";
import { bundledCatalogScenarioInput, createLocalScenarioInput } from "../app/catalog";

function createRepository(): ScenarioRepository {
  return createScenarioRepository({
    model: createJourneyModel(),
    backend: createMemoryScenarioBackend(),
    clock: () => 1_700_000_000_000,
  });
}

describe("local Scenario repository seam", () => {
  test("creates, opens, exports, imports, and migrates without mutating the catalog", async () => {
    const repository = createRepository();
    const created = await repository.create(bundledCatalogScenarioInput, "My local Scenario");

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(created.record.label).toBe("My local Scenario");
    expect(created.scenario.id).toBe(bundledCatalogScenarioInput.id);

    const exported = await repository.export(created.scenario.id);
    expect(exported.ok).toBe(true);
    if (!exported.ok) {
      return;
    }

    const imported = await repository.import(exported.serialized, "Imported Scenario");
    expect(imported.ok).toBe(true);
    if (!imported.ok) {
      return;
    }
    expect(imported.migrated).toBe(false);
    expect(imported.scenario.id).toBe(created.scenario.id);

    const opened = await repository.open(created.scenario.id);
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.record.label).toBe("Imported Scenario");
      expect(opened.record.revision).toBe(2);
    }

    const invalid = await repository.import('{"schemaVersion":999}', "Invalid");
    expect(invalid.ok).toBe(false);
    const records = await repository.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.label).toBe("Imported Scenario");
    expect(Object.isFrozen(bundledCatalogScenarioInput)).toBe(true);
  });

  test("migrates a legacy Scenario and persists the current schema", async () => {
    const repository = createRepository();
    const legacy = await Bun.file(new URL("./fixtures/scenario-v1.json", import.meta.url)).text();

    const migrated = await repository.migrate(legacy, "Migrated legacy Scenario");

    expect(migrated.ok).toBe(true);
    if (migrated.ok) {
      expect(migrated.migrated).toBe(true);
      expect(migrated.migratedFrom).toBe(1);
      expect(migrated.document.schemaVersion).toBe(2);
      expect((await repository.list())[0]?.label).toBe("Migrated legacy Scenario");
    }
  });

  test("persists layered overrides and reverts one layer transactionally", async () => {
    const repository = createRepository();
    const model = createJourneyModel();
    const compiled = model.compileScenario(multiLegJourneyScenario);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }

    const layer = createScenarioOverrideLayer({
      id: "override:test-nominal",
      label: "Test nominal",
      changes: [
        {
          entityType: "ship-profile",
          entityId: "ship:survey",
          property: "acceleration",
          value: { value: 10, unit: "m/s^2" },
          claim: rangeClaim({
            lower: { value: 8, unit: "m/s^2" },
            upper: { value: 12, unit: "m/s^2" },
            nominal: { value: 10, unit: "m/s^2" },
            provenance: provisionalProvenance("test range"),
          }),
        },
      ],
    });
    const overridden = model.applyScenarioOverrides(compiled.scenario, [layer]);
    const saved = await repository.save(overridden, "Overridden");
    expect(saved.ok).toBe(true);
    if (!saved.ok) {
      return;
    }
    expect(saved.scenario.overrideLayers).toHaveLength(1);

    const reverted = await repository.revert(saved.scenario.id, layer.id);
    expect(reverted.ok).toBe(true);
    if (reverted.ok) {
      expect(reverted.scenario.overrideLayers).toHaveLength(0);
      expect(reverted.scenario.shipProfiles[0]?.properties.acceleration?.value).toEqual({
        value: 10,
        unit: "m/s^2",
      });
    }
  });

  test("does not write a failed import", async () => {
    const repository = createRepository();
    const before = await repository.list();
    const result = await repository.import("not-json", "Broken");

    expect(result.ok).toBe(false);
    expect(await repository.list()).toEqual(before);
  });

  test("serializes concurrent saves with unique monotone revisions", async () => {
    const backend = createMemoryScenarioBackend();
    const repository = createScenarioRepository({
      model: createJourneyModel(),
      backend,
      clock: (() => {
        let now = 1_700_000_000_000;
        return () => ++now;
      })(),
    });
    const created = await repository.create(bundledCatalogScenarioInput, "Initial");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const [left, right] = await Promise.all([
      repository.save(created.scenario, "Concurrent left"),
      repository.save(created.scenario, "Concurrent right"),
    ]);
    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    if (!left.ok || !right.ok) {
      return;
    }
    expect(new Set([left.record.revision, right.record.revision])).toEqual(new Set([2, 3]));

    const records = await repository.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.revision).toBe(3);
    expect(["Concurrent left", "Concurrent right"]).toContain(records[0]?.label ?? "");
  });

  test("keeps concurrent records isolated and leaves failed mutations unchanged", async () => {
    const base = createMemoryScenarioBackend();
    let failMutations = false;
    const backend: ScenarioStorageBackend = Object.freeze({
      list: base.list,
      get: base.get,
      mutate: async (id, mutation) => {
        if (failMutations) {
          throw new Error("Injected storage failure.");
        }
        return base.mutate(id, mutation);
      },
    });
    const repository = createScenarioRepository({
      model: createJourneyModel(),
      backend,
      clock: () => 1_700_000_000_000,
    });
    const [first, second] = await Promise.all([
      repository.create(createLocalScenarioInput("scenario:one"), "One"),
      repository.create(createLocalScenarioInput("scenario:two"), "Two"),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(await repository.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "scenario:one", revision: 1 }),
        expect.objectContaining({ id: "scenario:two", revision: 1 }),
      ]),
    );

    if (!first.ok) {
      return;
    }
    const before = await backend.get(first.scenario.id);
    failMutations = true;
    const failed = await repository.save(first.scenario, "Should not commit");
    expect(failed.ok).toBe(false);
    expect(await backend.get(first.scenario.id)).toEqual(before);
  });

  test("does not publish a reverted Scenario when persistence fails", async () => {
    const base = createMemoryScenarioBackend();
    let failMutations = false;
    const backend: ScenarioStorageBackend = Object.freeze({
      list: base.list,
      get: base.get,
      mutate: async (id, mutation) => {
        if (failMutations) {
          throw new Error("Injected revert failure.");
        }
        return base.mutate(id, mutation);
      },
    });
    const repository = createScenarioRepository({
      model: createJourneyModel(),
      backend,
      clock: () => 1_700_000_000_000,
    });
    const model = createJourneyModel();
    const compiled = model.compileScenario(multiLegJourneyScenario);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    const layer = createScenarioOverrideLayer({
      id: "override:failure-injection",
      label: "Failure injection",
      changes: [
        {
          entityType: "ship-profile",
          entityId: "ship:survey",
          property: "acceleration",
          value: { value: 10, unit: "m/s^2" },
        },
      ],
    });
    const saved = await repository.save(
      model.applyScenarioOverrides(compiled.scenario, [layer]),
      "Revert",
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) {
      return;
    }
    const before = await backend.get(saved.scenario.id);
    failMutations = true;

    const failed = await repository.revert(saved.scenario.id, layer.id);
    expect(failed.ok).toBe(false);
    expect(await backend.get(saved.scenario.id)).toEqual(before);
  });
});
