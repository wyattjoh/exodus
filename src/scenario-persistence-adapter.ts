import type {
  ScenarioExportDocument,
  ScenarioExportOptions,
  ScenarioExportSource,
} from "./scenario-persistence";
import type { ScenarioImportResult, ScenarioMigrationResult } from "./scenario-persistence";

/**
 * Persistence operations injected into the framework-independent Journey Model.
 *
 * Keeping this contract in a dependency-neutral module lets `model.ts` expose the seam without
 * importing the persistence implementation that itself compiles Scenarios.
 */
export type ScenarioPersistenceAdapter = {
  readonly createScenarioExport: (
    source: ScenarioExportSource,
    options?: ScenarioExportOptions,
  ) => ScenarioExportDocument;
  readonly serializeScenario: (
    source: ScenarioExportSource,
    options?: ScenarioExportOptions,
  ) => string;
  readonly exportScenario: (
    source: ScenarioExportSource,
    options?: ScenarioExportOptions,
  ) => string;
  readonly importScenario: (input: unknown) => ScenarioImportResult;
  readonly migrateScenario: (input: unknown) => ScenarioMigrationResult;
};

/**
 * Creates the fail-closed adapter used by direct core-model imports when the public entrypoint has
 * not installed the persistence implementation.
 *
 * @returns A persistence adapter whose operations explain that the public adapter is unavailable.
 */
export function createUnavailableScenarioPersistence(): ScenarioPersistenceAdapter {
  const unavailable = (): never => {
    throw new Error(
      "Scenario persistence is unavailable from the core model module; import the package entrypoint.",
    );
  };
  return Object.freeze({
    createScenarioExport: unavailable,
    serializeScenario: unavailable,
    exportScenario: unavailable,
    importScenario: unavailable,
    migrateScenario: unavailable,
  });
}
