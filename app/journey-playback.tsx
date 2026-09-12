import { useEffect, useMemo, useSyncExternalStore } from "react";
import type {
  CompiledScenario,
  JourneyModel,
  JourneySample,
  MultiLegJourneyTimeline,
  StableId,
} from "../src/index";
import { formatDuration, formatPhaseKind } from "./format";
import {
  createJourneyPlaybackRuntime,
  DEFAULT_PLAYBACK_RATE,
  PLAYBACK_RATES,
  type JourneyPlaybackMode,
  type JourneyPlaybackRuntime,
  type JourneyPlaybackScheduler,
} from "./journey-playback-runtime";
import {
  deriveJourneyPlaybackAnnouncement,
  inspectJourneyDiscrepancies,
  projectJourneyArrivalWindow,
} from "./journey-inspection";

export type { JourneyPlaybackMode, JourneyPlaybackScheduler } from "./journey-playback-runtime";

/** Immutable playback state shared by the Cluster and System projections. */
export type JourneyPlaybackState = {
  readonly timeline: MultiLegJourneyTimeline;
  readonly sample: JourneySample | undefined;
  readonly isPlaying: boolean;
  readonly mode: JourneyPlaybackMode;
  readonly playbackRate: number;
  readonly focusPhaseIndex: number | undefined;
  readonly error: string | undefined;
  readonly seek: (fraction: number) => void;
  readonly togglePlaying: () => void;
  readonly reset: () => void;
  readonly stepEvent: (direction: "next" | "previous") => void;
  readonly setMode: (mode: JourneyPlaybackMode) => void;
  readonly setPlaybackRate: (rate: number) => void;
  readonly setFocusPhaseIndex: (phaseIndex: number | undefined) => void;
};

/** Props for the shared Journey playback controls. */
export type JourneyPlaybackPanelProps = {
  readonly playback: JourneyPlaybackState;
};

function defaultBrowserScheduler(): JourneyPlaybackScheduler {
  return {
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
  };
}

function usePlaybackRuntime(
  model: Pick<JourneyModel, "sampleJourneyAt" | "stepJourneyEvent">,
  scenario: CompiledScenario,
  timeline: MultiLegJourneyTimeline | undefined,
): JourneyPlaybackRuntime | undefined {
  const runtime = useMemo(
    () =>
      timeline === undefined
        ? undefined
        : createJourneyPlaybackRuntime({
            model,
            scenario,
            timeline,
            scheduler:
              typeof requestAnimationFrame === "function" ? defaultBrowserScheduler() : undefined,
          }),
    [model, scenario, timeline],
  );

  useEffect(() => {
    return () => runtime?.dispose();
  }, [runtime]);

  return runtime;
}

/**
 * Owns lifecycle-safe playback through the injected runtime seam.
 *
 * The hook is intentionally thin: the runtime owns sampling, scheduling, cancellation, and stale
 * callback rejection; React only subscribes to its immutable state snapshot.
 */
export function useJourneyPlayback(
  model: Pick<JourneyModel, "sampleJourneyAt" | "stepJourneyEvent">,
  scenario: CompiledScenario,
  timeline: MultiLegJourneyTimeline | undefined,
): JourneyPlaybackState | undefined {
  const runtime = usePlaybackRuntime(model, scenario, timeline);
  const snapshot = useSyncExternalStore(
    runtime?.subscribe ?? (() => () => undefined),
    runtime?.getState ?? (() => undefined),
    runtime?.getState ?? (() => undefined),
  );

  return useMemo(() => {
    if (runtime === undefined || timeline === undefined || snapshot === undefined) {
      return undefined;
    }
    return {
      timeline,
      sample: snapshot.sample,
      isPlaying: snapshot.isPlaying,
      mode: snapshot.mode,
      playbackRate: snapshot.playbackRate,
      focusPhaseIndex: snapshot.focusPhaseIndex,
      error: snapshot.error,
      seek: runtime.seek,
      togglePlaying: runtime.togglePlaying,
      reset: runtime.reset,
      stepEvent: runtime.stepEvent,
      setMode: runtime.setMode,
      setPlaybackRate: runtime.setPlaybackRate,
      setFocusPhaseIndex: runtime.setFocusPhaseIndex,
    } satisfies JourneyPlaybackState;
  }, [runtime, snapshot, timeline]);
}

function displaySeconds(
  sample: JourneySample | undefined,
  key: keyof JourneySample["clocks"],
): string {
  return sample === undefined ? "Unavailable" : formatDuration(sample.clocks[key]);
}

/** Renders accessible play, seek, exact event stepping, and nominal/uncertainty timeline controls. */
export function JourneyPlaybackPanel({ playback }: JourneyPlaybackPanelProps): JSX.Element {
  const sample = playback.sample;
  const duration =
    playback.timeline.arrivalCoordinateTime.value - playback.timeline.departureCoordinateTime.value;
  const elapsed =
    sample === undefined
      ? 0
      : sample.coordinateTime.value - playback.timeline.departureCoordinateTime.value;
  const fraction = duration <= 0 ? 1 : Math.max(0, Math.min(1, elapsed / duration));
  const phaseLabel =
    sample?.phase === undefined ? "No active phase" : formatPhaseKind(sample.phase.kind);
  const arrivalWindow =
    sample === undefined ? undefined : projectJourneyArrivalWindow(sample, playback.timeline);
  const discrepancies =
    sample === undefined ? [] : inspectJourneyDiscrepancies(sample, playback.timeline);
  const announcement = deriveJourneyPlaybackAnnouncement({
    sample,
    timeline: playback.timeline,
    isPlaying: playback.isPlaying,
    error: playback.error,
  });
  return (
    <section className="journey-playback-card" aria-labelledby="journey-playback-heading">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Authoritative Journey sampler</p>
          <h2 id="journey-playback-heading">Scrub the Journey</h2>
        </div>
        <span
          className={`status-pill ${playback.error ? "status-error" : playback.isPlaying ? "status-success" : "status-neutral"}`}
        >
          {playback.error ? "Needs attention" : playback.isPlaying ? "Playing" : "Paused"}
        </span>
      </div>
      <output className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </output>
      <div className="journey-playback-controls">
        <button
          className="button button-primary"
          type="button"
          onClick={playback.togglePlaying}
          disabled={sample === undefined}
        >
          {playback.isPlaying ? "Pause" : "Play"}
        </button>
        <button
          className="button button-subtle"
          type="button"
          onClick={() => playback.stepEvent("previous")}
        >
          Previous event
        </button>
        <button
          className="button button-subtle"
          type="button"
          onClick={() => playback.stepEvent("next")}
        >
          Next event
        </button>
        <button className="button button-subtle" type="button" onClick={playback.reset}>
          Reset
        </button>
      </div>
      <label className="journey-scrubber">
        <span>Journey position</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.0001"
          value={fraction}
          aria-label="Scrub Journey position"
          disabled={sample === undefined}
          onChange={(event) => playback.seek(Number(event.currentTarget.value))}
        />
        <output>{displaySeconds(sample, "clusterCoordinateTime")}</output>
        {arrivalWindow !== undefined ? (
          <>
            <div
              className="journey-arrival-overlay"
              role="img"
              aria-label={arrivalWindow.ariaLabel}
            >
              <span
                className="journey-arrival-window"
                style={{
                  left: `${arrivalWindow.leftPercent}%`,
                  width: `${arrivalWindow.widthPercent}%`,
                }}
              />
              <span
                className="journey-arrival-nominal"
                style={{ left: `${arrivalWindow.nominalPercent}%` }}
              />
            </div>
            <div className="journey-arrival-key" aria-label="Journey arrival legend">
              <span>
                <i className="journey-arrival-key-window" />
                Secondary bounded arrival window
              </span>
              <span>
                <i className="journey-arrival-key-nominal" />
                Nominal arrival
              </span>
            </div>
          </>
        ) : null}
      </label>
      <div className="journey-playback-options">
        <label>
          <span>Playback mapping</span>
          <select
            value={playback.mode}
            onChange={(event) => playback.setMode(event.currentTarget.value as JourneyPlaybackMode)}
          >
            <option value="true-time">True-time phase ratios</option>
            <option value="phase-focus">Phase-focus (nonuniform)</option>
          </select>
        </label>
        <label>
          <span>Focus phase (nonuniform)</span>
          <select
            value={playback.focusPhaseIndex ?? ""}
            disabled={playback.mode !== "phase-focus"}
            onChange={(event) => {
              const value = event.currentTarget.value;
              playback.setFocusPhaseIndex(value.length === 0 ? undefined : Number(value));
            }}
          >
            {playback.timeline.phases.map((phase, index) => (
              <option value={index} key={`${phase.stepIndex}-${phase.kind}`}>
                {index + 1}. {formatPhaseKind(phase.kind)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Playback rate</span>
          <select
            value={playback.playbackRate}
            onChange={(event) => playback.setPlaybackRate(Number(event.currentTarget.value))}
          >
            {PLAYBACK_RATES.map((rate) => (
              <option value={rate} key={rate}>
                {rate}× coordinate time
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="journey-playback-mode">
        {playback.mode === "true-time"
          ? "True-time mapping preserves every phase duration ratio."
          : "Phase-focus mapping is intentionally nonuniform and only changes playback presentation."}
      </p>
      <dl className="journey-clock-grid">
        <div>
          <dt>Cluster Coordinate</dt>
          <dd>{displaySeconds(sample, "clusterCoordinateTime")}</dd>
        </div>
        <div>
          <dt>Ship Proper</dt>
          <dd>{displaySeconds(sample, "shipProperTime")}</dd>
        </div>
        <div>
          <dt>Aging Difference</dt>
          <dd>{displaySeconds(sample, "agingDifference")}</dd>
        </div>
      </dl>
      <div className="journey-playback-meta">
        <span>
          Phase: <strong>{phaseLabel}</strong>
        </span>
        <span>
          View:{" "}
          <strong>
            {sample?.view === "cluster"
              ? "Cluster"
              : sample === undefined
                ? "Unavailable"
                : "System"}
          </strong>
        </span>
        <span>
          Event:{" "}
          <strong>
            {sample?.event === undefined ? "continuous sample" : formatPhaseKind(sample.event.kind)}
          </strong>
        </span>
      </div>
      {sample?.phaseDetails !== undefined ? (
        <details className="journey-inspection">
          <summary>Inspect uncertainty, provenance, and discrepancies</summary>
          <p>
            {sample.phaseDetails.provenance.notes.join(" ") || "No additional provenance notes."}
          </p>
          <p>Sources: {sample.phaseDetails.provenance.citations.join("; ") || "none recorded"}</p>
          <p>
            Uncertainty: {sample.uncertainty.hasUncertainty ? "bounded" : "nominal only"}. Source
            paths: {sample.uncertainty.sourcePaths.join(", ") || "none"}
          </p>
          <p>
            Arrival window: {formatDuration(sample.uncertainty.arrivalWindow.lower)} –{" "}
            {formatDuration(sample.uncertainty.arrivalWindow.upper)}
          </p>
          <p>
            Active clock bounds:{" "}
            {formatDuration(sample.uncertainty.clockBounds.lower.clusterCoordinateTime)} –{" "}
            {formatDuration(sample.uncertainty.clockBounds.upper.clusterCoordinateTime)}
          </p>
          <section
            className="journey-discrepancy-list"
            aria-labelledby="journey-discrepancies-heading"
          >
            <h3 id="journey-discrepancies-heading">Corresponding Canon discrepancies</h3>
            {discrepancies.length === 0 ? (
              <p>No discrepancies are associated with this phase.</p>
            ) : (
              discrepancies.map((discrepancy) => (
                <article
                  className="journey-discrepancy"
                  key={`${discrepancy.property}-${discrepancy.message}`}
                >
                  <h4>{discrepancy.property}</h4>
                  <p>{discrepancy.message}</p>
                  <div className="journey-discrepancy-columns">
                    <div>
                      <strong>Canonical Claim</strong>
                      <p>Kind: {discrepancy.canonicalClaim.kind}</p>
                      {discrepancy.canonicalClaim.statement !== undefined ? (
                        <p>Statement: {discrepancy.canonicalClaim.statement}</p>
                      ) : null}
                      {discrepancy.canonicalClaim.value !== undefined ? (
                        <p>Value: {discrepancy.canonicalClaim.value}</p>
                      ) : null}
                      <p>Nominal: {discrepancy.canonicalClaim.nominal}</p>
                      {discrepancy.canonicalClaim.lower !== undefined ? (
                        <p>
                          Range: {discrepancy.canonicalClaim.lower} –{" "}
                          {discrepancy.canonicalClaim.upper}
                        </p>
                      ) : null}
                      <p>
                        Provenance: {discrepancy.canonicalClaim.provenance.kind} /{" "}
                        {discrepancy.canonicalClaim.provenance.authority}
                      </p>
                      {discrepancy.canonicalClaim.provenance.source !== undefined ? (
                        <p>Source: {discrepancy.canonicalClaim.provenance.source}</p>
                      ) : null}
                      {discrepancy.canonicalClaim.provenance.note !== undefined ? (
                        <p>Note: {discrepancy.canonicalClaim.provenance.note}</p>
                      ) : null}
                      {discrepancy.canonicalClaim.provenance.citations.length > 0 ? (
                        <p>
                          Citations: {discrepancy.canonicalClaim.provenance.citations.join("; ")}
                        </p>
                      ) : null}
                      <p>
                        Precision: {discrepancy.canonicalClaim.precision.significantDigits}{" "}
                        significant digits ({discrepancy.canonicalClaim.precision.source})
                      </p>
                    </div>
                    <div>
                      <strong>Derived Result</strong>
                      <p>Nominal: {discrepancy.derivedResult.nominal}</p>
                      <p>
                        Bounds: {discrepancy.derivedResult.lower} –{" "}
                        {discrepancy.derivedResult.upper}
                      </p>
                      <p>
                        Precision: {discrepancy.derivedResult.precision.significantDigits}{" "}
                        significant digits ({discrepancy.derivedResult.precision.source})
                      </p>
                    </div>
                  </div>
                </article>
              ))
            )}
          </section>
        </details>
      ) : null}
      {playback.error ? (
        <output className="notice notice-warning" role="alert">
          {playback.error}
        </output>
      ) : null}
    </section>
  );
}

/** Stable identifier helper kept local so consumers can key Journey controls by a timeline. */
export function journeyPlaybackKey(timeline: MultiLegJourneyTimeline): StableId {
  return `${timeline.departureGateId}:${timeline.destinationGateId}:${timeline.departureCoordinateTime.value}:${timeline.arrivalCoordinateTime.value}` as StableId;
}

export { DEFAULT_PLAYBACK_RATE };
