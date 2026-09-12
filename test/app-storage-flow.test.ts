import { describe, expect, test } from "bun:test";

import { createJourneyModel } from "../src/index";
import { bundledCatalogScenarioInput } from "../app/catalog";
import {
  formatCommittedMutationMessage,
  publishCommittedScenario,
  refreshScenarioRecords,
} from "../app/storage-flow";
import { createPlanningRevisionController } from "../app/planning";
import type { ScenarioStorageRecord } from "../app/scenario-repository";

function requireScenario() {
  const result = createJourneyModel().compileScenario(bundledCatalogScenarioInput);
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }
  return result.scenario;
}

const mutationKinds = ["save", "create", "import", "override", "revert"] as const;

function record(id: string): ScenarioStorageRecord {
  return Object.freeze({
    id,
    label: id,
    serialized: "{}",
    updatedAt: 1_700_000_000_000,
    revision: 1,
  });
}

describe("browser Scenario storage flow", () => {
  test("publishes records after a successful commit when refresh succeeds", async () => {
    const scenario = requireScenario();
    const events: string[] = [];
    let visible: typeof scenario | undefined;
    let records: readonly ScenarioStorageRecord[] | undefined;
    const refreshFailure = await publishCommittedScenario(
      scenario,
      async () => {
        events.push("refresh");
        return [record(scenario.id)];
      },
      (committed) => {
        events.push("scenario");
        visible = committed;
      },
      (refreshed) => {
        events.push("records");
        records = refreshed;
      },
    );

    expect(refreshFailure).toBeUndefined();
    expect(visible).toBe(scenario);
    expect(records).toEqual([record(scenario.id)]);
    expect(events).toEqual(["scenario", "refresh", "records"]);
  });

  test("keeps every committed mutation visible when list refresh fails", async () => {
    const scenario = requireScenario();
    for (const mutationKind of mutationKinds) {
      const controller = createPlanningRevisionController();
      const requestRevision = controller.current();
      const events: string[] = [];
      let visible: typeof scenario | undefined;
      let recordsPublished = false;
      const refreshFailure = await publishCommittedScenario(
        scenario,
        async () => {
          events.push("refresh");
          throw new Error(`${mutationKind} list failure`);
        },
        (committed) => {
          events.push("scenario");
          visible = committed;
          controller.invalidate();
        },
        () => {
          recordsPublished = true;
        },
      );

      expect(visible).toBe(scenario);
      expect(recordsPublished).toBe(false);
      expect(events).toEqual(["scenario", "refresh"]);
      expect(controller.isCurrent(requestRevision)).toBe(false);
      expect(refreshFailure).toBe(`${mutationKind} list failure`);
      expect(formatCommittedMutationMessage(`${mutationKind} committed`, refreshFailure)).toBe(
        `${mutationKind} committed The Scenario was committed, but the local Scenario list could not be refreshed: ${mutationKind} list failure`,
      );
    }
  });

  test("turns initial or manual list failures into recoverable results", async () => {
    const refreshed = await refreshScenarioRecords(async () => {
      throw new Error("IndexedDB temporarily unavailable.");
    });

    expect(refreshed).toEqual({
      ok: false,
      records: undefined,
      error: "IndexedDB temporarily unavailable.",
    });
  });
});
