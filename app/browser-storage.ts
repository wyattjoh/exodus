import type { JourneyModel } from "../src/index";
import {
  createIndexedDbScenarioBackend,
  createMemoryScenarioBackend,
  createScenarioRepository,
  type ScenarioRepository,
} from "./scenario-repository";

/**
 * Creates the browser repository, selecting IndexedDB when available and an injectable in-memory
 * fallback for preview shells or deterministic tests.
 *
 * @param model - Framework-independent Journey Model used for validation and serialization.
 * @returns A local-only Scenario repository.
 */
export function createBrowserScenarioRepository(model: JourneyModel): ScenarioRepository {
  if (typeof indexedDB !== "undefined") {
    return createScenarioRepository({
      model,
      backend: createIndexedDbScenarioBackend(),
    });
  }
  return createScenarioRepository({
    model,
    backend: createMemoryScenarioBackend(),
  });
}
