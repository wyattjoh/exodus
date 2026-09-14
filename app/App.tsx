import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type JSX,
} from "react";
import {
  createJourneyModel,
  type CompiledScenario,
  type ProvenanceKind,
  type RoutePlan,
  type RoutePlanningResult,
  type StableId,
  type WorkerGeneratedClusterRegion,
  type WorkerPlanningProgress,
  type WorkerPlanningTask,
} from "../src/index";
import { createBrowserScenarioRepository } from "./browser-storage";
import { createBrowserWorkerPlanningAdapter } from "./browser-worker";
import { WebGpuClusterExplorer, type ClusterGenerationView } from "./WebGpuClusterExplorer";
import {
  createExplorerSelection,
  normalizeExplorerSelection,
  selectExplorerGate,
  type ExplorerSelection,
} from "./cluster-explorer";
import { bundledCatalogScenarioInput, createLocalScenarioInput } from "./catalog";
import {
  applyNominalUncertainty,
  buildRoutePlanningRequest,
  createPlanningRevisionController,
  formatGateLabel,
  formatSystemLabel,
  getScenarioUncertaintyControls,
  provenanceKinds,
  resolveSystemGateEndpoints,
  type ScenarioUncertaintyControl,
} from "./planning";
import type {
  ScenarioRepository,
  ScenarioRepositoryIssue,
  ScenarioRepositoryResult,
  ScenarioStorageRecord,
} from "./scenario-repository";
import { formatDuration, formatPercent, formatPhaseKind } from "./format";
import { JourneyPlaybackPanel, PLAYBACK_RATES, useJourneyPlayback } from "./journey-playback";
import {
  formatCommittedMutationMessage,
  publishCommittedScenario,
  refreshScenarioRecords,
} from "./storage-flow";

const DAY_SECONDS = 86_400;
const DEFAULT_LATEST_ARRIVAL_DAYS = 365.25 * 20;
const DEFAULT_STRATEGIC_WAIT_DAYS = 30;

type WorkerFailureView = {
  readonly outcome: string;
  readonly code: string;
  readonly message: string;
  readonly cause: string | undefined;
};

type PlanningState = "idle" | "running" | "complete" | "cancelled";
type OfflineStatus = "preparing" | "ready" | "unavailable";

function compileBundledCatalog(): CompiledScenario {
  const result = createJourneyModel().compileScenario(bundledCatalogScenarioInput);
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }
  return result.scenario;
}

function shipLabel(scenario: CompiledScenario, shipId: StableId): string {
  const ship = scenario.index.shipProfiles.get(shipId);
  return ship === undefined ? shipId : `${ship.name} · ${ship.designation}`;
}

function issueText(issues: readonly ScenarioRepositoryIssue[]): string {
  return issues.map((value) => `${value.path}: ${value.message}`).join(" ");
}

function repositoryError(result: ScenarioRepositoryResult): string {
  return result.ok ? "" : issueText(result.issues);
}

function asWorkerFailure(response: {
  readonly outcome: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly cause: string | undefined;
  };
}): WorkerFailureView {
  return Object.freeze({
    outcome: response.outcome,
    code: response.error.code,
    message: response.error.message,
    cause: response.error.cause,
  });
}

function routeIssueSummary(result: RoutePlanningResult): string {
  if (result.ok) {
    return "";
  }
  return result.issues.map((issue) => `${issue.code} · ${issue.path}: ${issue.message}`).join(" ");
}

function playbackRateLabel(rate: number): string {
  return `${Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 0 }).format(rate)}×`;
}

function ResultPanel({
  result,
}: { readonly result: RoutePlanningResult | undefined }): JSX.Element {
  if (result === undefined) {
    return (
      <section className="empty-result" aria-labelledby="result-heading">
        <h2 id="result-heading">Journey result</h2>
        <p>Choose exact Gates and a Ship Profile, then plan a bounded Journey.</p>
      </section>
    );
  }
  if (!result.ok) {
    return (
      <section className="result-card failure-card" aria-labelledby="result-heading" role="alert">
        <div className="result-heading-row">
          <div>
            <p className="eyebrow">Structured outcome</p>
            <h2 id="result-heading">{result.outcome}</h2>
          </div>
          <span className="status-pill status-error">No Route Plan</span>
        </div>
        <p>{routeIssueSummary(result)}</p>
        <ul className="issue-list">
          {result.issues.map((issue, index) => (
            <li key={`${issue.path}-${index}`}>
              <strong>{issue.code}</strong>
              <span>{issue.message}</span>
              <code>{issue.path}</code>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return <SuccessfulResult result={result} />;
}

function SuccessfulResult({
  result,
}: { readonly result: Extract<RoutePlanningResult, { ok: true }> }): JSX.Element {
  const plan = result.plan;
  return (
    <section className="result-stack" aria-labelledby="result-heading">
      <article className="result-card result-hero">
        <div className="result-heading-row">
          <div>
            <p className="eyebrow">Nominal earliest arrival</p>
            <h2 id="result-heading">{formatDuration(plan.arrivalCoordinateTime)}</h2>
          </div>
          <span className="status-pill status-success">{plan.optimality}</span>
        </div>
        <p className="result-summary">
          {plan.gateLegCount} Gate leg{plan.gateLegCount === 1 ? "" : "s"} ·{" "}
          {plan.refinementQuality} · {formatPercent(plan.refinementScore)} refinement coverage
        </p>
        <dl className="metric-grid">
          <Metric
            label="Cluster Coordinate Time"
            value={formatDuration(plan.clusterCoordinateTime)}
          />
          <Metric label="Ship Proper Time" value={formatDuration(plan.shipProperTime)} />
          <Metric label="Aging Difference" value={formatDuration(plan.agingDifference)} />
          <Metric
            label="Arrival bounds"
            value={`${formatDuration(plan.arrivalCoordinateTimeBounds.lower)} – ${formatDuration(plan.arrivalCoordinateTimeBounds.upper)}`}
          />
        </dl>
      </article>

      <section className="result-card" aria-labelledby="alternatives-heading">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Trade-offs</p>
            <h2 id="alternatives-heading">Route alternatives</h2>
          </div>
          <span className="count-badge">{result.alternatives.length}</span>
        </div>
        {result.alternatives.length === 0 ? (
          <p className="muted">No non-winning routes were retained for this bounded search.</p>
        ) : (
          <div className="alternative-list">
            {result.alternatives.map((alternative, index) => (
              <div className="alternative-row" key={`${alternative.gateIds.join("/")}-${index}`}>
                <div>
                  <strong>Alternative {index + 1}</strong>
                  <span>{alternative.gateIds.length - 1} Gate legs</span>
                </div>
                <div className="alternative-times">
                  <span>{formatDuration(alternative.arrivalCoordinateTime)} coordinate</span>
                  <span>{formatDuration(alternative.shipProperTime)} ship</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {result.sensitivity.length > 0 ? (
          <p className="sensitivity-note">
            {result.sensitivity.length} alternative arrival range
            {result.sensitivity.length === 1 ? "" : "s"} overlap the nominal winner.
          </p>
        ) : null}
      </section>

      <PhaseTable plan={plan} />
    </section>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PhaseTable({ plan }: { readonly plan: RoutePlan }): JSX.Element {
  return (
    <section className="result-card" aria-labelledby="timeline-heading">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Journey Timeline</p>
          <h2 id="timeline-heading">Every elapsed phase</h2>
        </div>
        <span className="count-badge">{plan.timeline.phases.length}</span>
      </div>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">
            Cumulative Cluster Coordinate Time, Ship Proper Time, and Aging Difference for each
            Journey phase.
          </caption>
          <thead>
            <tr>
              <th scope="col">Phase</th>
              <th scope="col">From → To</th>
              <th scope="col">Cluster Coordinate</th>
              <th scope="col">Ship Proper</th>
              <th scope="col">Aging Difference</th>
            </tr>
          </thead>
          <tbody>
            {plan.timeline.phases.map((phase) => (
              <tr key={`${phase.stepIndex}-${phase.kind}`}>
                <th scope="row">
                  <span className="phase-index">
                    {String(phase.stepIndex + 1).padStart(2, "0")}
                  </span>
                  {formatPhaseKind(phase.kind)}
                </th>
                <td>
                  <span className="route-cell">{phase.departureGateId}</span>
                  <span className="route-cell">→ {phase.destinationGateId}</span>
                </td>
                <td>
                  <strong>{formatDuration(phase.end.clusterCoordinateTime)}</strong>
                  <small>+{formatDuration(phase.clusterCoordinateDuration)}</small>
                </td>
                <td>
                  <strong>{formatDuration(phase.end.shipProperTime)}</strong>
                  <small>+{formatDuration(phase.shipProperDuration)}</small>
                </td>
                <td>
                  <strong>{formatDuration(phase.end.agingDifference)}</strong>
                  <small>+{formatDuration(phase.agingDifference)}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProvenanceFilter({
  selected,
  onChange,
}: {
  readonly selected: readonly ProvenanceKind[];
  readonly onChange: (kind: ProvenanceKind, enabled: boolean) => void;
}): JSX.Element {
  return (
    <fieldset className="control-group">
      <legend>Provenance filter</legend>
      <p className="control-help">
        Filter the Cluster explorer and route data without adding a hidden cost to generated links.
      </p>
      <div className="check-grid">
        {provenanceKinds.map((kind) => (
          <label className="check-label" key={kind}>
            <input
              type="checkbox"
              checked={selected.includes(kind)}
              onChange={(event) => onChange(kind, event.currentTarget.checked)}
            />
            <span>{kind.replace("-", " ")}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function UncertaintyControls({
  controls,
  values,
  onChange,
  onApply,
  disabled,
}: {
  readonly controls: readonly ScenarioUncertaintyControl[];
  readonly values: Readonly<Record<string, number>>;
  readonly onChange: (path: string, value: number) => void;
  readonly onApply: () => void | Promise<void>;
  readonly disabled: boolean;
}): JSX.Element {
  return (
    <fieldset className="control-group">
      <legend>Uncertainty nominal</legend>
      <p className="control-help">
        Select a nominal inside each source range. Bounds and provenance stay attached to the
        Scenario.
      </p>
      {controls.length === 0 ? (
        <p className="muted">This Scenario has no ranged physical properties.</p>
      ) : (
        <>
          {controls.map((control) => {
            const value = values[control.path] ?? control.nominal;
            return (
              <label className="range-label" key={control.path}>
                <span>
                  <strong>{control.label}</strong>
                  <span className="range-meta">
                    {control.lower}–{control.upper} {control.unit} · {control.provenanceKind}
                  </span>
                </span>
                <output htmlFor={`range-${control.path}`}>
                  {value} {control.unit}
                </output>
                <input
                  id={`range-${control.path}`}
                  type="range"
                  min={control.lower}
                  max={control.upper}
                  step={(control.upper - control.lower) / 100}
                  value={value}
                  onChange={(event) => onChange(control.path, Number(event.currentTarget.value))}
                />
              </label>
            );
          })}
          <button
            className="button button-subtle"
            type="button"
            onClick={() => void onApply()}
            disabled={disabled}
          >
            Apply nominal selection
          </button>
        </>
      )}
    </fieldset>
  );
}

function StorageControls({
  repository,
  scenario,
  records,
  onScenario,
  onRecords,
  onMessage,
}: {
  readonly repository: ScenarioRepository;
  readonly scenario: CompiledScenario;
  readonly records: readonly ScenarioStorageRecord[];
  readonly onScenario: (scenario: CompiledScenario) => void;
  readonly onRecords: (records: readonly ScenarioStorageRecord[]) => void;
  readonly onMessage: (message: string) => void;
}): JSX.Element {
  const [selectedId, setSelectedId] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const save = async (): Promise<void> => {
    const result = await repository.save(scenario, scenario.name);
    if (!result.ok) {
      onMessage(repositoryError(result));
      return;
    }
    const refreshFailure = await publishCommittedScenario(
      result.scenario,
      repository.list,
      onScenario,
      onRecords,
    );
    onMessage(
      formatCommittedMutationMessage(
        `Saved ${result.record.label} locally (revision ${result.record.revision}).`,
        refreshFailure,
      ),
    );
  };

  const create = async (): Promise<void> => {
    const id = `scenario:local-${Date.now()}`;
    const result = await repository.create(createLocalScenarioInput(id), "My local Scenario");
    if (!result.ok) {
      onMessage(repositoryError(result));
      return;
    }
    const refreshFailure = await publishCommittedScenario(
      result.scenario,
      repository.list,
      (committed) => {
        onScenario(committed);
        setSelectedId(committed.id);
      },
      onRecords,
    );
    onMessage(
      formatCommittedMutationMessage(
        "Created a local Scenario copy. The bundled catalog remains read-only.",
        refreshFailure,
      ),
    );
  };

  const open = async (): Promise<void> => {
    if (selectedId.length === 0) {
      onMessage("Select a saved Scenario first.");
      return;
    }
    const result = await repository.open(selectedId);
    if (!result.ok) {
      onMessage(repositoryError(result));
      return;
    }
    onScenario(result.scenario);
    onMessage(`Opened ${result.record.label}.`);
  };

  const exportCurrent = async (): Promise<void> => {
    const exported = await repository.export(scenario.id);
    const serialized = exported.ok ? exported.serialized : undefined;
    if (serialized === undefined) {
      onMessage("Save this Scenario locally before exporting it.");
      return;
    }
    downloadScenario(`${scenario.designation}.json`, serialized);
    onMessage("Exported canonical Scenario JSON.");
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file === undefined) {
      return;
    }
    const result = await repository.migrate(await file.text(), file.name);
    if (!result.ok) {
      onMessage(repositoryError(result));
      return;
    }
    const refreshFailure = await publishCommittedScenario(
      result.scenario,
      repository.list,
      (committed) => {
        onScenario(committed);
        setSelectedId(committed.id);
      },
      onRecords,
    );
    onMessage(
      formatCommittedMutationMessage(
        result.migrated
          ? `Migrated and imported ${file.name} from schema ${String(result.migratedFrom)}.`
          : `Imported ${file.name}.`,
        refreshFailure,
      ),
    );
  };

  return (
    <section className="control-card" aria-labelledby="storage-heading">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Local-first storage</p>
          <h2 id="storage-heading">Scenario library</h2>
        </div>
        <span className="storage-badge">Browser-local</span>
      </div>
      <p className="control-help">
        Bundled catalog data is read-only. Local copies, overrides, and Journey inputs stay in this
        browser and never leave it.
      </p>
      <div className="storage-actions">
        <button className="button button-primary" type="button" onClick={() => void create()}>
          Create local copy
        </button>
        <button className="button button-subtle" type="button" onClick={() => void save()}>
          Save current
        </button>
        <button className="button button-subtle" type="button" onClick={() => void exportCurrent()}>
          Export JSON
        </button>
        <label className="button button-subtle file-button">
          Import &amp; migrate
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            onChange={(event) => void importFile(event)}
          />
        </label>
      </div>
      <div className="open-row">
        <label htmlFor="saved-scenario">Open saved Scenario</label>
        <select
          id="saved-scenario"
          value={selectedId}
          onChange={(event) => setSelectedId(event.currentTarget.value)}
        >
          <option value="">Choose a local Scenario…</option>
          {records.map((record) => (
            <option key={record.id} value={record.id}>
              {record.label} · r{record.revision}
            </option>
          ))}
        </select>
        <button
          className="button button-subtle"
          type="button"
          onClick={() => void open()}
          disabled={selectedId.length === 0}
        >
          Open
        </button>
      </div>
      {scenario.overrideLayers.length > 0 ? (
        <div className="override-list">
          <span className="override-title">Active override layers</span>
          {scenario.overrideLayers.map((layer) => (
            <span className="override-chip" key={layer.id}>
              {layer.label}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function downloadScenario(filename: string, serialized: string): void {
  const blob = new Blob([serialized], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * The first local React Journey calculator application.
 *
 * @returns Accessible calculator controls and model-backed route results.
 */
export default function App(): JSX.Element {
  const model = useMemo(() => createJourneyModel(), []);
  const repository = useMemo(() => createBrowserScenarioRepository(model), [model]);
  const adapter = useMemo(() => createBrowserWorkerPlanningAdapter(), []);
  const [scenario, setScenario] = useState<CompiledScenario>(() => compileBundledCatalog());
  const [generatedScenario, setGeneratedScenario] = useState<CompiledScenario | undefined>(
    undefined,
  );
  const [records, setRecords] = useState<readonly ScenarioStorageRecord[]>([]);
  const [selection, setSelection] = useState<ExplorerSelection>(() =>
    createExplorerSelection("gate:terra", "gate:helios"),
  );
  const [selectedShip, setSelectedShip] = useState<StableId>("ship:survey");
  const [generationState, setGenerationState] = useState<ClusterGenerationView["state"]>("idle");
  const [generationProgress, setGenerationProgress] = useState<WorkerPlanningProgress | undefined>(
    undefined,
  );
  const [generationError, setGenerationError] = useState<string | undefined>(undefined);
  const [departureDays, setDepartureDays] = useState(0);
  const [latestArrivalDays, setLatestArrivalDays] = useState(DEFAULT_LATEST_ARRIVAL_DAYS);
  const [strategicWaitDays, setStrategicWaitDays] = useState(DEFAULT_STRATEGIC_WAIT_DAYS);
  const [selectedProvenance, setSelectedProvenance] =
    useState<readonly ProvenanceKind[]>(provenanceKinds);
  const [nominals, setNominals] = useState<Readonly<Record<string, number>>>({});
  const [planningState, setPlanningState] = useState<PlanningState>("idle");
  const [progress, setProgress] = useState<WorkerPlanningProgress | undefined>(undefined);
  const [result, setResult] = useState<RoutePlanningResult | undefined>(undefined);
  const [workerFailure, setWorkerFailure] = useState<WorkerFailureView | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [storageError, setStorageError] = useState("");
  const [offlineStatus, setOfflineStatus] = useState<OfflineStatus>("preparing");
  const activeTask = useRef<WorkerPlanningTask<RoutePlanningResult> | undefined>(undefined);
  const generationTask = useRef<WorkerPlanningTask<WorkerGeneratedClusterRegion> | undefined>(
    undefined,
  );
  const planningRevision = useMemo(() => createPlanningRevisionController(), []);
  const activeScenario = generatedScenario ?? scenario;
  const selectedDeparture = selection.departureGateId ?? "";
  const selectedDestination = selection.destinationGateId ?? "";
  const uncertaintyControls = useMemo(() => getScenarioUncertaintyControls(scenario), [scenario]);
  const plannedJourney = result?.ok === true ? result.plan : undefined;
  const playback = useJourneyPlayback(model, activeScenario, plannedJourney?.timeline);

  useEffect(() => {
    let current = true;
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.ready
        .then(() => {
          if (current) {
            setOfflineStatus("ready");
          }
        })
        .catch(() => {
          if (current) {
            setOfflineStatus("unavailable");
          }
        });
    } else {
      setOfflineStatus("unavailable");
    }
    void refreshScenarioRecords(repository.list).then((refreshed) => {
      if (!current) {
        return;
      }
      if (!refreshed.ok) {
        setStorageError(refreshed.error);
        return;
      }
      setStorageError("");
      setRecords(refreshed.records);
    });
    return () => {
      current = false;
    };
  }, [repository]);

  useEffect(() => {
    setNominals((previous) => {
      const next: Record<string, number> = {};
      for (const control of uncertaintyControls) {
        next[control.path] = previous[control.path] ?? control.nominal;
      }
      return next;
    });
  }, [uncertaintyControls]);

  useEffect(() => {
    let current = true;
    planningRevision.invalidate();
    activeTask.current?.cancel();
    activeTask.current = undefined;
    generationTask.current?.cancel();
    setGeneratedScenario(undefined);
    setGenerationState("running");
    setGenerationProgress(undefined);
    setGenerationError(undefined);
    let task: WorkerPlanningTask<WorkerGeneratedClusterRegion> | undefined;
    try {
      task = adapter.generate(
        {
          logicalPopulation: 10_000_000,
          materializedSystemCount: 64,
          seed: "calculator-cluster-v1",
          generatorVersion: "globular-v1",
        },
        {
          onProgress: (value) => {
            if (current) {
              setGenerationProgress(value);
            }
          },
        },
      );
      generationTask.current = task;
      void task.promise
        .then((response) => {
          if (!current) {
            return;
          }
          if (!response.ok) {
            setGenerationState(response.outcome === "cancelled" ? "idle" : "failed");
            setGenerationError(response.error.message);
            return;
          }
          const imported = model.importScenario(response.result.scenario);
          if (!imported.ok) {
            setGenerationState("failed");
            setGenerationError(
              imported.issues.map((issue) => `${issue.path}: ${issue.message}`).join(" "),
            );
            return;
          }
          const combined = model.compileScenario({
            ...scenario,
            systems: [...scenario.systems, ...imported.scenario.systems],
            orbitalAnchors: [...scenario.orbitalAnchors, ...imported.scenario.orbitalAnchors],
            gates: [...scenario.gates, ...imported.scenario.gates],
            gateConnections: [...scenario.gateConnections, ...imported.scenario.gateConnections],
            shipProfiles: [...scenario.shipProfiles, ...imported.scenario.shipProfiles],
            generatorVersion: imported.scenario.generatorVersion,
            seed: imported.scenario.seed,
            logicalPopulation: imported.scenario.logicalPopulation,
            generation: imported.scenario.generation,
          });
          if (!combined.ok) {
            setGenerationState("failed");
            setGenerationError(
              combined.issues.map((issue) => `${issue.path}: ${issue.message}`).join(" "),
            );
            return;
          }
          planningRevision.invalidate();
          activeTask.current?.cancel();
          activeTask.current = undefined;
          setPlanningState("idle");
          setProgress(undefined);
          setResult(undefined);
          setWorkerFailure(undefined);
          setGeneratedScenario(combined.scenario);
          setGenerationState("complete");
        })
        .catch((error: unknown) => {
          if (current) {
            setGenerationState("failed");
            setGenerationError(error instanceof Error ? error.message : "Generated region failed.");
          }
        });
    } catch (error) {
      setGenerationState("failed");
      setGenerationError(error instanceof Error ? error.message : "Generated region failed.");
    }
    return () => {
      current = false;
      task?.cancel();
      if (generationTask.current === task) {
        generationTask.current = undefined;
      }
    };
  }, [adapter, model, planningRevision, scenario]);

  useEffect(() => {
    setSelection((previous) => normalizeExplorerSelection(previous, activeScenario.gates));
    if (!activeScenario.index.shipProfiles.has(selectedShip)) {
      setSelectedShip(activeScenario.shipProfiles[0]?.id ?? "");
    }
  }, [activeScenario, selectedShip]);

  useEffect(() => {
    return () => {
      activeTask.current?.cancel();
      generationTask.current?.cancel();
      void adapter.dispose();
    };
  }, [adapter]);

  const toggleProvenance = (kind: ProvenanceKind, enabled: boolean): void => {
    setSelectedProvenance((previous) => {
      if (enabled) {
        return previous.includes(kind) ? previous : Object.freeze([...previous, kind]);
      }
      return Object.freeze(previous.filter((value) => value !== kind));
    });
  };

  const replaceScenario = useCallback(
    (next: CompiledScenario): void => {
      planningRevision.invalidate();
      activeTask.current?.cancel();
      activeTask.current = undefined;
      setScenario(next);
      setPlanningState("idle");
      setProgress(undefined);
      setResult(undefined);
      setWorkerFailure(undefined);
    },
    [planningRevision],
  );

  const applyNominals = async (): Promise<void> => {
    try {
      let next = scenario;
      for (const control of uncertaintyControls) {
        const nominal = nominals[control.path] ?? control.nominal;
        if (nominal !== control.nominal) {
          next = applyNominalUncertainty(model, next, control, nominal);
        }
      }
      const saved = await repository.save(next, next.name);
      if (!saved.ok) {
        setMessage(repositoryError(saved));
        return;
      }
      const refreshFailure = await publishCommittedScenario(
        saved.scenario,
        repository.list,
        replaceScenario,
        setRecords,
      );
      setStorageError(refreshFailure ?? "");
      setMessage(
        formatCommittedMutationMessage(
          "Nominal selection applied and persisted as reversible override layers.",
          refreshFailure,
        ),
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Nominal selection could not be applied.",
      );
    }
  };

  const plan = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (planningState === "running") {
      return;
    }
    if (
      selectedDeparture.length === 0 ||
      selectedDestination.length === 0 ||
      selectedShip.length === 0
    ) {
      setMessage("Select a departure Gate, destination Gate, and Ship Profile.");
      return;
    }
    setPlanningState("running");
    setProgress(undefined);
    setResult(undefined);
    setWorkerFailure(undefined);
    setMessage("");
    const requestRevision = planningRevision.current();
    const departureCoordinateTime =
      activeScenario.epoch.coordinateTime.value + departureDays * DAY_SECONDS;
    const request = buildRoutePlanningRequest({
      departureGateId: selectedDeparture,
      destinationGateId: selectedDestination,
      shipProfileId: selectedShip,
      departureCoordinateTime,
      latestArrivalCoordinateTime: departureCoordinateTime + latestArrivalDays * DAY_SECONDS,
      maximumStrategicWait: strategicWaitDays * DAY_SECONDS,
      provenanceKinds: selectedProvenance,
      maxAlternatives: 5,
    });
    let task: WorkerPlanningTask<RoutePlanningResult> | undefined;
    try {
      task = adapter.plan(model.createScenarioExport(activeScenario), request, {
        onProgress: (value) => {
          if (planningRevision.isCurrent(requestRevision)) {
            setProgress(value);
          }
        },
      });
      activeTask.current = task;
      const response = await task.promise;
      if (!planningRevision.isCurrent(requestRevision)) {
        return;
      }
      if (response.ok) {
        setResult(response.result);
        setPlanningState("complete");
        if (!response.result.ok) {
          setMessage(routeIssueSummary(response.result));
        }
      } else {
        setWorkerFailure(asWorkerFailure(response));
        setPlanningState(response.outcome === "cancelled" ? "cancelled" : "complete");
      }
    } catch (error) {
      if (!planningRevision.isCurrent(requestRevision)) {
        return;
      }
      setWorkerFailure({
        outcome: "failed",
        code: "operation-failed",
        message:
          error instanceof Error ? error.message : "Planning failed before the worker responded.",
        cause: undefined,
      });
      setPlanningState("complete");
    } finally {
      if (task !== undefined && activeTask.current === task) {
        activeTask.current = undefined;
      }
    }
  };

  const cancelPlan = (): void => {
    if (activeTask.current?.cancel() === true) {
      setMessage("Cancellation requested; waiting for the worker terminal response.");
    }
  };

  const revertLayer = async (layerId: string): Promise<void> => {
    try {
      const reverted = model.revertScenarioOverride(scenario, layerId);
      const saved = await repository.save(reverted, reverted.name);
      if (!saved.ok) {
        setMessage(repositoryError(saved));
        return;
      }
      const refreshFailure = await publishCommittedScenario(
        saved.scenario,
        repository.list,
        replaceScenario,
        setRecords,
      );
      setStorageError(refreshFailure ?? "");
      setMessage(
        formatCommittedMutationMessage(
          `Reverted ${layerId} and persisted the replacement Scenario.`,
          refreshFailure,
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Override could not be reverted.");
    }
  };

  const progressPercent =
    progress === undefined ? 0 : (progress.completedWork / progress.totalWork) * 100;
  const departureOptions = activeScenario.gates;
  const destinationOptions = activeScenario.gates;
  const systemOptions = activeScenario.systems.filter((system) =>
    activeScenario.gates.some((gate) => gate.systemId === system.id),
  );
  const selectedDepartureSystem =
    activeScenario.index.gates.get(selectedDeparture)?.systemId ?? systemOptions[0]?.id ?? "";
  const selectedDestinationSystem =
    activeScenario.index.gates.get(selectedDestination)?.systemId ?? systemOptions[1]?.id ?? "";

  const updateSelection = (next: ExplorerSelection): void => {
    const endpointsChanged =
      next.departureGateId !== selection.departureGateId ||
      next.destinationGateId !== selection.destinationGateId;
    if (endpointsChanged) {
      planningRevision.invalidate();
      activeTask.current?.cancel();
      activeTask.current = undefined;
      setPlanningState("idle");
      setProgress(undefined);
      setResult(undefined);
      setWorkerFailure(undefined);
      setMessage("");
    }
    setSelection(next);
  };

  const selectSystems = (departureSystemId: StableId, destinationSystemId: StableId): void => {
    const endpoints = resolveSystemGateEndpoints(
      activeScenario,
      departureSystemId,
      destinationSystemId,
    );
    if (endpoints === undefined) {
      setMessage("No connected Gate course joins those Systems.");
      return;
    }
    const withDeparture = selectExplorerGate(selection, "departure", endpoints.departureGateId);
    updateSelection(selectExplorerGate(withDeparture, "destination", endpoints.destinationGateId));
  };

  const selectDepartureSystem = (systemId: StableId): void => {
    selectSystems(
      systemId,
      systemId === selectedDestinationSystem ? selectedDepartureSystem : selectedDestinationSystem,
    );
  };

  const selectDestinationSystem = (systemId: StableId): void => {
    selectSystems(
      systemId === selectedDepartureSystem ? selectedDestinationSystem : selectedDepartureSystem,
      systemId,
    );
  };

  return (
    <div className="app-shell">
      {storageError ? (
        <div className="notice notice-error" role="alert">
          {storageError}
        </div>
      ) : null}
      {message ? (
        <output className="notice" aria-live="polite">
          {message}
        </output>
      ) : null}

      <WebGpuClusterExplorer
        scenario={activeScenario}
        selection={selection}
        onSelectionChange={updateSelection}
        selectedProvenance={selectedProvenance}
        onProvenanceChange={toggleProvenance}
        generation={{
          state: generationState,
          progress: generationProgress,
          error: generationError,
        }}
        model={model}
        plannedJourney={plannedJourney}
        journeySample={playback?.sample}
        isJourneyPlaying={playback?.isPlaying ?? false}
      />

      <div className="workspace" aria-label="Journey planning overlay">
        <aside className="journey-console" aria-label="Journey planner">
          <form className="planner-form" onSubmit={(event) => void plan(event)}>
            <div className="journey-console-heading">
              <div>
                <p className="eyebrow">EXODUS / CENTAURI CLUSTER</p>
                <h1>Plan a destination</h1>
              </div>
              <span className="status-dot" aria-hidden="true" />
            </div>

            <fieldset className="system-endpoints">
              <legend className="sr-only">Journey Systems</legend>
              <label>
                <span>Source</span>
                <select
                  value={selectedDepartureSystem}
                  onChange={(event) => selectDepartureSystem(event.currentTarget.value)}
                >
                  {systemOptions.map((system) => (
                    <option key={system.id} value={system.id}>
                      {formatSystemLabel(activeScenario, system.id)}
                    </option>
                  ))}
                </select>
              </label>
              <span className="course-arrow" aria-hidden="true">
                →
              </span>
              <label>
                <span>Destination</span>
                <select
                  value={selectedDestinationSystem}
                  onChange={(event) => selectDestinationSystem(event.currentTarget.value)}
                >
                  {systemOptions.map((system) => (
                    <option key={system.id} value={system.id}>
                      {formatSystemLabel(activeScenario, system.id)}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>

            <div className="planner-actions">
              <button
                className="button button-primary plan-button"
                type="submit"
                disabled={planningState === "running"}
              >
                {planningState === "running"
                  ? "Plotting course…"
                  : plannedJourney === undefined
                    ? "Plan course"
                    : "Replan course"}
              </button>
              {planningState === "running" ? (
                <button className="button button-danger" type="button" onClick={cancelPlan}>
                  Cancel
                </button>
              ) : null}
            </div>

            {planningState === "running" ? (
              <div className="progress-block" aria-live="polite">
                <div className="progress-label">
                  <span>{progress?.stage ?? "queued"}</span>
                  <span>{Math.round(progressPercent)}%</span>
                </div>
                <progress max="100" value={progressPercent} />
              </div>
            ) : null}

            {plannedJourney !== undefined && playback !== undefined ? (
              <section className="active-course" aria-labelledby="active-course-heading">
                <div>
                  <p className="eyebrow">Course ready</p>
                  <h2 id="active-course-heading">
                    {activeScenario.index.systems.get(selectedDepartureSystem)?.name ??
                      selectedDepartureSystem}
                    <span aria-hidden="true"> → </span>
                    {activeScenario.index.systems.get(selectedDestinationSystem)?.name ??
                      selectedDestinationSystem}
                  </h2>
                  <p>
                    {plannedJourney.gateLegCount} leg
                    {plannedJourney.gateLegCount === 1 ? "" : "s"} · arrives in{" "}
                    {formatDuration(plannedJourney.clusterCoordinateTime)}
                  </p>
                </div>
                <div className="course-playback-controls">
                  <button
                    className="button course-play-button"
                    type="button"
                    onClick={playback.togglePlaying}
                    disabled={playback.sample === undefined}
                  >
                    <span aria-hidden="true">{playback.isPlaying ? "Ⅱ" : "▶"}</span>
                    {playback.isPlaying ? "Pause" : "Play"}
                  </button>
                  <label className="course-speed-control">
                    <span>Speed</span>
                    <select
                      value={playback.playbackRate}
                      aria-label="Playback speed"
                      onChange={(event) =>
                        playback.setPlaybackRate(Number(event.currentTarget.value))
                      }
                    >
                      {PLAYBACK_RATES.map((rate) => (
                        <option value={rate} key={rate}>
                          {playbackRateLabel(rate)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="button course-reset-button"
                    type="button"
                    onClick={playback.reset}
                  >
                    Restart
                  </button>
                </div>
              </section>
            ) : null}

            {workerFailure ? (
              <output className="course-error" role="alert">
                {workerFailure.message}
              </output>
            ) : null}
            {planningState === "cancelled" ? (
              <output className="course-error">Planning was cancelled.</output>
            ) : null}

            <details className="journey-advanced">
              <summary>
                <span>Advanced</span>
                <small>Gates, ship, timing, data & details</small>
              </summary>
              <div className="advanced-stack">
                <fieldset className="control-group">
                  <legend>Exact Gate endpoints</legend>
                  <label>
                    <span>Departure Gate</span>
                    <select
                      value={selectedDeparture}
                      onChange={(event) =>
                        updateSelection(
                          selectExplorerGate(selection, "departure", event.currentTarget.value),
                        )
                      }
                    >
                      {departureOptions.map((gate) => (
                        <option key={gate.id} value={gate.id}>
                          {formatGateLabel(activeScenario, gate.id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Destination Gate</span>
                    <select
                      value={selectedDestination}
                      onChange={(event) =>
                        updateSelection(
                          selectExplorerGate(selection, "destination", event.currentTarget.value),
                        )
                      }
                    >
                      {destinationOptions.map((gate) => (
                        <option key={gate.id} value={gate.id}>
                          {formatGateLabel(activeScenario, gate.id)}
                        </option>
                      ))}
                    </select>
                  </label>
                </fieldset>

                <fieldset className="control-group">
                  <legend>Ship and epoch</legend>
                  <label>
                    <span>Ship Profile</span>
                    <select
                      value={selectedShip}
                      onChange={(event) => setSelectedShip(event.currentTarget.value)}
                    >
                      {scenario.shipProfiles.map((ship) => (
                        <option key={ship.id} value={ship.id}>
                          {shipLabel(scenario, ship.id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Departure epoch ({activeScenario.epoch.label} days)</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={departureDays}
                      onChange={(event) =>
                        setDepartureDays(Math.max(0, Number(event.currentTarget.value)))
                      }
                    />
                  </label>
                </fieldset>

                <fieldset className="control-group">
                  <legend>Planning horizons</legend>
                  <label>
                    <span>Latest arrival horizon (days)</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={latestArrivalDays}
                      onChange={(event) =>
                        setLatestArrivalDays(Math.max(0, Number(event.currentTarget.value)))
                      }
                    />
                  </label>
                  <label>
                    <span>Strategic-wait horizon (days)</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={strategicWaitDays}
                      onChange={(event) =>
                        setStrategicWaitDays(Math.max(0, Number(event.currentTarget.value)))
                      }
                    />
                  </label>
                </fieldset>

                <ProvenanceFilter selected={selectedProvenance} onChange={toggleProvenance} />
                <UncertaintyControls
                  controls={uncertaintyControls}
                  values={nominals}
                  onChange={(path, value) =>
                    setNominals((previous) => ({ ...previous, [path]: value }))
                  }
                  onApply={applyNominals}
                  disabled={uncertaintyControls.every(
                    (control) => (nominals[control.path] ?? control.nominal) === control.nominal,
                  )}
                />

                {playback !== undefined ? <JourneyPlaybackPanel playback={playback} /> : null}
                {result !== undefined ? <ResultPanel result={result} /> : null}

                <StorageControls
                  repository={repository}
                  scenario={scenario}
                  records={records}
                  onScenario={replaceScenario}
                  onRecords={setRecords}
                  onMessage={setMessage}
                />

                {scenario.overrideLayers.length > 0 ? (
                  <section className="control-card" aria-labelledby="revert-heading">
                    <div className="section-heading-row">
                      <h2 id="revert-heading">Revert overrides</h2>
                      <span className="count-badge">{scenario.overrideLayers.length}</span>
                    </div>
                    <div className="revert-list">
                      {scenario.overrideLayers.map((layer) => (
                        <button
                          className="revert-row"
                          type="button"
                          key={layer.id}
                          onClick={() => void revertLayer(layer.id)}
                        >
                          <span>{layer.label}</span>
                          <span aria-hidden="true">↩</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                <p className="app-meta">
                  {offlineStatus === "ready"
                    ? "Offline-ready"
                    : offlineStatus === "preparing"
                      ? "Preparing offline cache"
                      : "Local-only mode"}
                  {" · Catalog "}
                  {scenario.designation}
                </p>
              </div>
            </details>
          </form>
        </aside>
      </div>
    </div>
  );
}
