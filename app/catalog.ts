import {
  metersPerSecondSquared,
  multiLegJourneyScenario,
  provisionalProvenance,
  rangeClaim,
  type ScenarioInput,
} from "../src/index";

/**
 * Version of the immutable catalog bundled with the first browser calculator.
 */
export const BUNDLED_CATALOG_VERSION = "catalog-v1";

const surveyShip = multiLegJourneyScenario.shipProfiles[0];
if (surveyShip === undefined) {
  throw new Error("The bundled catalog requires the survey Ship Profile fixture.");
}

const accelerationClaim = rangeClaim({
  lower: metersPerSecondSquared(8),
  upper: metersPerSecondSquared(12),
  nominal: metersPerSecondSquared(10),
  provenance: provisionalProvenance(
    "The first bundled catalog uses a deliberately broad Ship Profile range until source data is curated.",
  ),
});

/**
 * Read-only Scenario input used as the browser calculator's bundled catalog.
 *
 * The data is a synthetic first-milestone fixture. It is never written back to the bundle; a user
 * saves a local Scenario copy through the repository seam before applying overrides.
 */
export const bundledCatalogScenarioInput: ScenarioInput = Object.freeze({
  ...multiLegJourneyScenario,
  id: "catalog:centauri-first-milestone",
  designation: "CAT-CENTAURI-001",
  name: "Centauri First-Milestone Catalog",
  shipProfiles: Object.freeze([
    Object.freeze({
      ...surveyShip,
      properties: Object.freeze({
        acceleration: Object.freeze({
          claim: accelerationClaim,
        }),
        brakingAcceleration: Object.freeze({
          claim: accelerationClaim,
        }),
      }),
    }),
  ]),
});

/**
 * Creates a local Scenario input from the bundled catalog without mutating catalog data.
 *
 * @param id - Stable identifier for the new local Scenario.
 * @param name - Optional user-facing Scenario name.
 * @returns A complete independent Scenario input suitable for compilation or persistence.
 */
export function createLocalScenarioInput(id: string, name = "My Centauri Scenario"): ScenarioInput {
  return Object.freeze({
    ...bundledCatalogScenarioInput,
    id,
    designation: `LOCAL-${id.replace(/[^A-Za-z0-9]+/g, "-").toUpperCase()}`,
    name,
  });
}
