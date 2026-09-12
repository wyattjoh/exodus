import type { CompiledScenario } from "../src/index";
import type { ScenarioStorageRecord } from "./scenario-repository";

/**
 * Result of a best-effort browser-local Scenario list refresh.
 */
export type ScenarioRefreshResult =
  | {
      readonly ok: true;
      readonly records: readonly ScenarioStorageRecord[];
    }
  | {
      readonly ok: false;
      readonly records: undefined;
      readonly error: string;
    };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Local Scenario list could not be refreshed.";
}

/**
 * Reads the local Scenario list without allowing a refresh failure to reject its caller.
 *
 * @param list - Repository list operation to execute.
 * @returns Committed records or a structured refresh error.
 */
export async function refreshScenarioRecords(
  list: () => Promise<readonly ScenarioStorageRecord[]>,
): Promise<ScenarioRefreshResult> {
  try {
    return Object.freeze({ ok: true as const, records: Object.freeze([...(await list())]) });
  } catch (error) {
    return Object.freeze({
      ok: false as const,
      records: undefined,
      error: errorMessage(error),
    });
  }
}

/**
 * Publishes a repository-committed Scenario before attempting a best-effort list refresh.
 *
 * The committed Scenario callback runs even when the follow-up list read fails. This keeps the
 * visible Scenario aligned with durable storage while the caller can surface the refresh error.
 *
 * @param scenario - Scenario returned by the successful repository mutation.
 * @param list - Repository list operation used to refresh saved-record controls.
 * @param publishScenario - UI/controller callback for the committed Scenario.
 * @param publishRecords - UI/controller callback for refreshed saved records.
 * @returns A recoverable refresh error message, or undefined when refresh succeeded.
 */
export async function publishCommittedScenario(
  scenario: CompiledScenario,
  list: () => Promise<readonly ScenarioStorageRecord[]>,
  publishScenario: (scenario: CompiledScenario) => void,
  publishRecords: (records: readonly ScenarioStorageRecord[]) => void,
): Promise<string | undefined> {
  publishScenario(scenario);
  const refreshed = await refreshScenarioRecords(list);
  if (!refreshed.ok) {
    return refreshed.error;
  }
  publishRecords(refreshed.records);
  return undefined;
}

/**
 * Combines a successful mutation message with an optional post-commit refresh failure.
 *
 * @param successMessage - Message describing the committed operation.
 * @param refreshFailure - Refresh error returned by publishCommittedScenario.
 * @returns A message that does not hide a committed mutation or a refresh failure.
 */
export function formatCommittedMutationMessage(
  successMessage: string,
  refreshFailure: string | undefined,
): string {
  if (refreshFailure === undefined) {
    return successMessage;
  }
  return `${successMessage} The Scenario was committed, but the local Scenario list could not be refreshed: ${refreshFailure}`;
}
