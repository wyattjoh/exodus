/**
 * The version of the deterministic CPU Cluster generator shipped by this package.
 */
export const DEFAULT_CLUSTER_GENERATOR_VERSION = "globular-v1";

/**
 * Generator implementations retained by this package. Every entry has a matching deterministic
 * implementation in `cluster-generation.ts`; arbitrary version strings are not namespaces.
 */
export const SUPPORTED_CLUSTER_GENERATOR_VERSIONS = Object.freeze([
  DEFAULT_CLUSTER_GENERATOR_VERSION,
] as const);

/**
 * The metadata version used for hand-authored Scenarios without a procedural generator.
 */
export const DEFAULT_SCENARIO_GENERATOR_VERSION = "manual-v1";

/**
 * Generator metadata versions accepted by Scenario persistence. `manual-v1` is a non-procedural
 * marker; `globular-v1` is the only retained Cluster generator implementation.
 */
export const SUPPORTED_SCENARIO_GENERATOR_VERSIONS = Object.freeze([
  DEFAULT_SCENARIO_GENERATOR_VERSION,
  ...SUPPORTED_CLUSTER_GENERATOR_VERSIONS,
] as const);

/**
 * Returns whether a version names a retained deterministic Cluster generator implementation.
 *
 * @param version - The normalized generator version to check.
 * @returns True only when the CPU generator can reproduce that version.
 */
export function isSupportedClusterGeneratorVersion(version: string): boolean {
  return SUPPORTED_CLUSTER_GENERATOR_VERSIONS.includes(
    version as (typeof SUPPORTED_CLUSTER_GENERATOR_VERSIONS)[number],
  );
}

/**
 * Returns whether a version is valid Scenario generator metadata.
 *
 * @param version - The normalized Scenario generator version to check.
 * @returns True for hand-authored metadata or a retained procedural implementation.
 */
export function isSupportedScenarioGeneratorVersion(version: string): boolean {
  return SUPPORTED_SCENARIO_GENERATOR_VERSIONS.includes(
    version as (typeof SUPPORTED_SCENARIO_GENERATOR_VERSIONS)[number],
  );
}
