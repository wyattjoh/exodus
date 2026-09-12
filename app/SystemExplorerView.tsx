import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import "./system-view.css";
import type { CompiledScenario, ProvenanceKind, StableId } from "../src/index";
import { formatDuration, formatPhaseKind } from "./format";
import {
  beginExplorerPointerGesture,
  moveExplorerPointerGesture,
  shouldPickExplorerPointerUp,
  type ExplorerPointerGesture,
} from "./cluster-explorer";
import {
  buildSystemExplorerScene,
  buildSystemWebGpuRenderScene,
  createSystemViewCameraState,
  orbitSystemViewCamera,
  panSystemViewCamera,
  systemViewCameraForRenderer,
  systemViewCameraKey,
  zoomSystemViewCamera,
  type SystemExplorerJourney,
  type SystemExplorerScene,
  type SystemExplorerVector3,
  type SystemViewCameraState,
  type SystemExplorerWorldlineModel,
} from "./system-explorer";
import {
  createWebGpuRenderer,
  type WebGpuApi,
  type WebGpuCanvas,
  type WebGpuFailure,
  type WebGpuRenderScene,
  type WebGpuRenderer,
  type WebGpuStartupBoundary,
} from "./webgpu-renderer";

/**
 * Props for the linked AU-scale System view.
 */
export type SystemExplorerViewProps = {
  readonly model: SystemExplorerWorldlineModel;
  readonly scenario: CompiledScenario;
  readonly systemId: StableId;
  readonly journey: SystemExplorerJourney | undefined;
  readonly selectedGateIds: readonly StableId[];
  readonly onClose: () => void;
};

type StartupState =
  | { readonly state: "starting" }
  | { readonly state: "ready"; readonly renderer: WebGpuRenderer }
  | { readonly state: "failed"; readonly failure: WebGpuFailure };

function webGpuApi(): WebGpuApi | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }
  return (navigator as Navigator & { readonly gpu: WebGpuApi | undefined }).gpu;
}

function viewportFor(canvas: HTMLCanvasElement): {
  readonly width: number;
  readonly height: number;
} {
  return Object.freeze({
    width: Math.max(1, canvas.clientWidth || canvas.width),
    height: Math.max(1, canvas.clientHeight || canvas.height),
  });
}

function formatVector(vector: readonly [number, number, number], unit: string): string {
  return `(${vector.map((value) => value.toPrecision(5)).join(", ")}) ${unit}`;
}

function phaseColor(kind: "acceleration" | "coast" | "braking"): string {
  return `system-phase-${kind}`;
}

function initialCamera(scene: SystemExplorerScene): SystemViewCameraState {
  const framePoints: SystemExplorerVector3[] = [
    ...scene.entities.map((body) => body.position),
    ...scene.orbits.flatMap((orbit) => orbit.points),
  ];
  if (scene.trajectory !== undefined) {
    framePoints.push(
      ...scene.trajectory.events.map((event) => event.positionView),
      scene.trajectory.destinationIntercept.positionView,
    );
  }
  if (framePoints.length === 0) {
    return createSystemViewCameraState();
  }
  const minimum = framePoints.reduce(
    (current, point) => [
      Math.min(current[0], point[0]),
      Math.min(current[1], point[1]),
      Math.min(current[2], point[2]),
    ],
    [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
  );
  const maximum = framePoints.reduce(
    (current, point) => [
      Math.max(current[0], point[0]),
      Math.max(current[1], point[1]),
      Math.max(current[2], point[2]),
    ],
    [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  );
  const target = Object.freeze([
    (minimum[0] + maximum[0]) / 2,
    (minimum[1] + maximum[1]) / 2,
    (minimum[2] + maximum[2]) / 2,
  ]) as SystemExplorerVector3;
  const extent = framePoints.reduce(
    (maximumDistance, point) =>
      Math.max(
        maximumDistance,
        Math.hypot(point[0] - target[0], point[1] - target[1], point[2] - target[2]),
      ),
    0,
  );
  return createSystemViewCameraState(target, Math.max(8, extent * 3.5), Math.max(100, extent * 8));
}

function selectedBodyClass(selected: boolean): string {
  return selected ? "system-body is-selected" : "system-body";
}

function provenanceLabel(kind: ProvenanceKind): string {
  return kind.replace("-", " ");
}

function renderSystemScene(scene: SystemExplorerScene): WebGpuRenderScene {
  return buildSystemWebGpuRenderScene(scene);
}

/**
 * Renders a linked System scene with an independent WebGPU canvas, AU transform, and camera.
 *
 * The component owns only presentation state: worldlines, phase boundaries, transfer endpoints,
 * and clocks all come from the injected Journey Model or its Journey Timeline.
 *
 * @param props - Compiled Scenario, model seam, selected System, Journey, and close callback.
 * @returns An accessible local System inspection view.
 */
export function SystemExplorerView({
  model,
  scenario,
  systemId,
  journey,
  selectedGateIds,
  onClose,
}: SystemExplorerViewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGpuRenderer | undefined>(undefined);
  const cameraRef = useRef<SystemViewCameraState>(createSystemViewCameraState());
  const pointerRef = useRef<ExplorerPointerGesture | undefined>(undefined);
  const previousSceneKeyRef = useRef("");
  const [startup, setStartup] = useState<StartupState>({ state: "starting" });
  const [renderWarning, setRenderWarning] = useState("");
  const [cameraRevision, setCameraRevision] = useState(0);
  const journeyTimeline =
    journey === undefined ? undefined : journey.kind === "route-plan" ? journey.timeline : journey;
  const journeyKey =
    journeyTimeline === undefined
      ? "none"
      : `${journeyTimeline.departureCoordinateTime.value}:${journeyTimeline.arrivalCoordinateTime.value}`;
  const initialEventIndex =
    journeyTimeline === undefined || journeyTimeline.events.length === 0 ? undefined : 0;
  const [selectedEventIndex, setSelectedEventIndex] = useState<number | undefined>(
    initialEventIndex,
  );
  const selectedTimelineEvent =
    selectedEventIndex === undefined ? undefined : journeyTimeline?.events[selectedEventIndex];
  const coordinateTime =
    selectedTimelineEvent?.coordinateTime.value ?? scenario.epoch.coordinateTime.value;
  const scene = useMemo(
    () =>
      buildSystemExplorerScene({
        model,
        scenario,
        systemId,
        coordinateTime,
        journey,
        selectedGateIds,
        orbitSampleCount: undefined,
        timelineEventIndex: selectedEventIndex,
      }),
    [coordinateTime, journey, model, scenario, selectedEventIndex, selectedGateIds, systemId],
  );
  const renderScene = useMemo(() => renderSystemScene(scene), [scene]);
  const timeline = scene.journey;
  const timelineEvents = timeline?.events.map((event, index) => ({ event, index })) ?? [];
  const localEvents = timelineEvents.filter(({ event }) => {
    if (event.gateId === undefined) {
      return false;
    }
    return scenario.index.gates.get(event.gateId)?.systemId === systemId;
  });
  const activePhase =
    scene.activeJourney?.phaseIndex === undefined
      ? undefined
      : scene.phases[scene.activeJourney.phaseIndex];
  const transferTrajectory = scene.trajectory;
  const transferEvents =
    transferTrajectory === undefined
      ? []
      : timelineEvents.filter(
          ({ event }) =>
            event.phase === "in-system-transfer" &&
            event.coordinateTime.value >= transferTrajectory.startCoordinateTime.value - 1e-7 &&
            event.coordinateTime.value <= transferTrajectory.endCoordinateTime.value + 1e-7,
        );

  useEffect(() => {
    setSelectedEventIndex(
      journeyTimeline === undefined || journeyTimeline.events.length === 0 ? undefined : 0,
    );
  }, [journeyTimeline]);

  useEffect(() => {
    const sceneKey = `${scene.systemId}:${journeyKey}:${scene.activeJourney?.phaseIndex ?? "none"}:${scene.trajectory?.destinationGateId ?? "none"}`;
    if (previousSceneKeyRef.current === sceneKey) {
      return;
    }
    previousSceneKeyRef.current = sceneKey;
    cameraRef.current = initialCamera(scene);
    setCameraRevision((value) => value + 1);
  }, [journeyKey, scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return undefined;
    }
    let active = true;
    let lost = false;
    const boundary: WebGpuStartupBoundary = {
      gpu: webGpuApi(),
      canvas: canvas as unknown as WebGpuCanvas,
      requirements: undefined,
    };
    void createWebGpuRenderer(boundary, {
      scheduler: undefined,
      onRenderError: (error) => {
        if (active) {
          setRenderWarning(error instanceof Error ? error.message : "A WebGPU frame failed.");
        }
      },
      onDeviceLost: (failure) => {
        if (!active) {
          return;
        }
        lost = true;
        rendererRef.current?.destroy();
        rendererRef.current = undefined;
        setStartup({ state: "failed", failure });
      },
    }).then((result) => {
      if (!active) {
        if (result.ok) {
          result.renderer.destroy();
        }
        return;
      }
      if (!result.ok) {
        setStartup({ state: "failed", failure: result.failure });
        return;
      }
      if (lost) {
        result.renderer.destroy();
        return;
      }
      rendererRef.current = result.renderer;
      const viewport = viewportFor(canvas);
      result.renderer.resize(viewport.width, viewport.height, globalThis.devicePixelRatio || 1);
      setStartup({ state: "ready", renderer: result.renderer });
      setCameraRevision((value) => value + 1);
    });
    return () => {
      active = false;
      rendererRef.current?.destroy();
      rendererRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer === undefined || cameraRevision < 0) {
      return;
    }
    renderer.setScene(renderScene, systemViewCameraForRenderer(cameraRef.current));
  }, [cameraRevision, renderScene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (
      canvas === null ||
      renderer === undefined ||
      startup.state !== "ready" ||
      typeof ResizeObserver === "undefined"
    ) {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      const viewport = viewportFor(canvas);
      renderer.resize(viewport.width, viewport.height, globalThis.devicePixelRatio || 1);
      renderer.setScene(renderScene, systemViewCameraForRenderer(cameraRef.current));
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [renderScene, startup.state]);

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = beginExplorerPointerGesture(
      event.pointerId,
      event.clientX,
      event.clientY,
      event.shiftKey,
    );
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    const previous = pointerRef.current;
    if (previous === undefined || previous.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - previous.x;
    const deltaY = event.clientY - previous.y;
    if (deltaX === 0 && deltaY === 0) {
      return;
    }
    cameraRef.current = previous.pan
      ? panSystemViewCamera(cameraRef.current, deltaX, deltaY)
      : orbitSystemViewCamera(cameraRef.current, deltaX, deltaY);
    pointerRef.current = moveExplorerPointerGesture(previous, event.clientX, event.clientY);
    setCameraRevision((value) => value + 1);
  };

  const releasePointer = (event: PointerEvent<HTMLCanvasElement>): void => {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already have been released by the browser.
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>): void => {
    const previous = pointerRef.current;
    pointerRef.current = undefined;
    releasePointer(event);
    shouldPickExplorerPointerUp(previous, event.pointerId, false);
  };

  const handlePointerCancel = (event: PointerEvent<HTMLCanvasElement>): void => {
    pointerRef.current = undefined;
    releasePointer(event);
  };

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    cameraRef.current = zoomSystemViewCamera(cameraRef.current, event.deltaY);
    setCameraRevision((value) => value + 1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLCanvasElement>): void => {
    const result = systemViewCameraKey(
      cameraRef.current,
      event.key,
      event.shiftKey,
      initialCamera(scene),
    );
    if (!result.handled) {
      return;
    }
    event.preventDefault();
    cameraRef.current = result.camera;
    setCameraRevision((value) => value + 1);
  };

  const resetCamera = (): void => {
    cameraRef.current = initialCamera(scene);
    setCameraRevision((value) => value + 1);
  };

  return (
    <section className="system-view-card" aria-labelledby="system-view-heading">
      <div className="section-heading-row system-view-heading">
        <div>
          <p className="eyebrow">LINKED VIEW / SYSTEM FRAME</p>
          <h2 id="system-view-heading">{scene.systemName} System</h2>
        </div>
        <div className="system-view-actions">
          <span className="status-pill status-success">AU-scale</span>
          <button className="button button-subtle" type="button" onClick={onClose}>
            Back to Cluster
          </button>
        </div>
      </div>
      <p className="control-help system-view-intro">
        Local geometry uses a separate AU origin and camera. The Cluster light-year scene remains
        unchanged while this view follows model worldlines at the selected epoch.
      </p>
      {startup.state === "failed" ? (
        <section className="webgpu-failure system-view-failure" role="alert">
          <p className="eyebrow">Capability required</p>
          <h3>System WebGPU view unavailable</h3>
          <p>{startup.failure.message}</p>
          <p className="failure-detail">{startup.failure.detail}</p>
          <code>{startup.failure.code}</code>
        </section>
      ) : (
        <div className="system-view-layout">
          <div className="system-view-viewport-wrap">
            <div className="system-view-toolbar">
              <div>
                <span className="system-scale-label">1 view unit = 1 AU</span>
                <small>Origin: {formatVector(scene.scale.originMeters, "m")}</small>
              </div>
              <button className="button button-subtle" type="button" onClick={resetCamera}>
                Reset camera
              </button>
            </div>
            <div className="system-canvas-frame">
              <canvas
                ref={canvasRef}
                className="system-canvas"
                width={960}
                height={560}
                tabIndex={0}
                aria-label={`${scene.systemName} System AU-scale view. Drag to orbit, shift-drag to pan, scroll to zoom, or use arrow keys, Shift+arrow keys, plus, minus, and Home.`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                onWheel={handleWheel}
                onKeyDown={handleKeyDown}
              />
              {startup.state === "starting" ? (
                <output className="canvas-overlay" aria-live="polite">
                  Connecting to WebGPU…
                </output>
              ) : null}
            </div>
            <p className="control-help system-camera-help">
              Drag to orbit · Shift-drag to pan · scroll to zoom · Arrow keys orbit · Shift+Arrow
              keys pan · +/− zoom · Home resets the camera.
            </p>
            <div className="system-legend" aria-label="System geometry legend">
              <span>
                <i className="system-legend-swatch system-swatch-anchor" />
                Orbital Anchor
              </span>
              <span>
                <i className="system-legend-swatch system-swatch-gate" />
                Selected Gate
              </span>
              <span>
                <i className="system-legend-swatch system-swatch-acceleration" />
                Acceleration event
              </span>
              <span>
                <i className="system-legend-swatch system-swatch-coast" />
                Coast event
              </span>
              <span>
                <i className="system-legend-swatch system-swatch-braking" />
                Braking event
              </span>
              <span>
                <i className="system-legend-swatch system-swatch-intercept" />
                Moving intercept
              </span>
            </div>
            {timeline !== undefined ? (
              <div className="system-scrubber" aria-label="Journey epoch controls">
                <div className="system-scrubber-heading">
                  <label htmlFor="system-epoch-event">Journey Model event</label>
                  <output htmlFor="system-epoch-event">
                    {scene.activeJourney?.event === undefined
                      ? "Phase boundary"
                      : `T+${formatDuration(scene.coordinateTime - scenario.epoch.coordinateTime.value)}`}
                  </output>
                </div>
                {timelineEvents.length > 0 ? (
                  <select
                    id="system-epoch-event"
                    className="system-event-select"
                    value={selectedEventIndex ?? ""}
                    onChange={(event) => {
                      const nextIndex = Number(event.currentTarget.value);
                      if (Number.isInteger(nextIndex)) {
                        setSelectedEventIndex(nextIndex);
                      }
                    }}
                  >
                    {timelineEvents.map(({ event, index }) => (
                      <option
                        value={index}
                        key={`${event.kind}-${event.coordinateTime.value}-${index}`}
                      >
                        {index + 1}. {formatPhaseKind(event.kind)} · {formatPhaseKind(event.phase)}{" "}
                        · T+
                        {formatDuration(
                          event.coordinateTime.value - scenario.epoch.coordinateTime.value,
                        )}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="muted">This Journey has no model-emitted events to inspect.</p>
                )}
                <p className="control-help system-discrete-help">
                  Inspection is discrete: the view samples only exact model events or phase
                  boundaries; it never interpolates a physical state between them.
                </p>
                {localEvents.length > 0 ? (
                  <div className="system-event-buttons" aria-label="Local Journey events">
                    {localEvents.map(({ event, index }) => (
                      <button
                        className="button button-subtle"
                        type="button"
                        key={`${event.kind}-${event.coordinateTime.value}-${index}`}
                        aria-pressed={selectedEventIndex === index}
                        onClick={() => setSelectedEventIndex(index)}
                      >
                        {formatPhaseKind(event.kind)} ·{" "}
                        {formatDuration(
                          event.coordinateTime.value - scenario.epoch.coordinateTime.value,
                        )}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="muted system-no-journey">
                Select exact Gate endpoints and plan a Journey to inspect phase timing and transfer
                geometry here.
              </p>
            )}
          </div>
          <aside
            className="system-view-inspector"
            aria-label="System geometry and Journey inspection"
          >
            {scene.activeJourney !== undefined && activePhase !== undefined ? (
              <section className="system-active-phase" aria-live="polite">
                <p className="eyebrow">Active epoch</p>
                <h3>{activePhase.label}</h3>
                <p>{activePhase.detail}</p>
                <dl className="system-clock-grid">
                  <div>
                    <dt>Cluster Coordinate</dt>
                    <dd>{formatDuration(scene.activeJourney.clocks.clusterCoordinateTime)}</dd>
                  </div>
                  <div>
                    <dt>Ship Proper</dt>
                    <dd>{formatDuration(scene.activeJourney.clocks.shipProperTime)}</dd>
                  </div>
                  <div>
                    <dt>Aging Difference</dt>
                    <dd>{formatDuration(scene.activeJourney.clocks.agingDifference)}</dd>
                  </div>
                </dl>
                {scene.activeJourney.event !== undefined ? (
                  <p className="system-active-event">
                    Event: <strong>{formatPhaseKind(scene.activeJourney.event.kind)}</strong>
                  </p>
                ) : null}
              </section>
            ) : null}
            <section className="system-body-list" aria-labelledby="system-bodies-heading">
              <div className="explorer-results-heading">
                <span id="system-bodies-heading">Route geometry</span>
                <span className="count-badge">{scene.entities.length}</span>
              </div>
              {scene.entities.length === 0 ? (
                <p className="muted">No selected route bodies are available in this System.</p>
              ) : (
                <div className="system-bodies">
                  {scene.entities.map((body) => (
                    <article className={selectedBodyClass(body.selected)} key={body.id}>
                      <div className="system-body-heading">
                        <strong>{body.name}</strong>
                        <span
                          className={`provenance-tag provenance-${body.provenance.primaryKind}`}
                        >
                          {provenanceLabel(body.provenance.primaryKind)}
                        </span>
                      </div>
                      <code>{body.designation}</code>
                      <small>
                        {body.entityKind === "gate" ? "Gate of Heaven" : body.entityKind}
                      </small>
                      <dl>
                        <div>
                          <dt>Position</dt>
                          <dd>{formatVector(body.position, "AU")}</dd>
                        </div>
                        <div>
                          <dt>Velocity</dt>
                          <dd>{formatVector(body.velocityMetersPerSecond, "m/s")}</dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>
              )}
            </section>
            {scene.trajectory !== undefined ? (
              <section className="system-transfer-panel" aria-labelledby="system-transfer-heading">
                <div className="explorer-results-heading">
                  <span id="system-transfer-heading">In-system Transfer geometry</span>
                  <span className="status-pill status-success">
                    {scene.trajectory.hasCoast
                      ? "accel · coast · flip · brake"
                      : "accel · flip · brake"}
                  </span>
                </div>
                <p className="control-help">
                  {scene.trajectory.departureGateId} → {scene.trajectory.destinationGateId}; event
                  markers are exact model states, and no line implies a physical path between them.
                </p>
                <div className="system-transfer-segments">
                  {scene.trajectory.segments.map((segment) => (
                    <div
                      className={`system-transfer-segment ${phaseColor(segment.kind)}`}
                      key={segment.kind}
                    >
                      <strong>{formatPhaseKind(segment.kind)}</strong>
                      <span>
                        {formatDuration(
                          segment.endCoordinateTime.value - segment.startCoordinateTime.value,
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                {transferEvents.length > 0 ? (
                  <div className="system-transfer-events" aria-label="Transfer model events">
                    <span className="system-transfer-events-heading">Exact transfer events</span>
                    {transferEvents.map(({ event, index }) => (
                      <button
                        className="button button-subtle"
                        type="button"
                        key={`${event.kind}-${event.coordinateTime.value}-${index}`}
                        aria-pressed={selectedEventIndex === index}
                        onClick={() => setSelectedEventIndex(index)}
                      >
                        <strong>{formatPhaseKind(event.kind)}</strong>
                        <small>
                          T+
                          {formatDuration(
                            event.coordinateTime.value - scenario.epoch.coordinateTime.value,
                          )}
                        </small>
                      </button>
                    ))}
                  </div>
                ) : null}
                <p className="system-intercept-note">
                  Moving destination intercept (model state):{" "}
                  {formatVector(scene.trajectory.destinationIntercept.positionView, "AU")} ·{" "}
                  {formatVector(
                    scene.trajectory.destinationIntercept.velocityMetersPerSecond,
                    "m/s",
                  )}
                </p>
              </section>
            ) : null}
            {scene.phases.length > 0 ? (
              <section className="system-phase-list" aria-labelledby="system-phases-heading">
                <div className="explorer-results-heading">
                  <span id="system-phases-heading">Journey phases</span>
                  <span className="count-badge">{scene.phases.length}</span>
                </div>
                <div className="system-phase-buttons">
                  {scene.phases.map((phase, index) => {
                    const phaseEventIndex =
                      timeline?.events.findIndex(
                        (event) =>
                          event.stepIndex === phase.stepIndex &&
                          event.phase === phase.kind &&
                          Math.abs(event.coordinateTime.value - phase.startCoordinateTime.value) <=
                            1e-7,
                      ) ?? -1;
                    return (
                      <button
                        className={`system-phase-button ${activePhase?.stepIndex === phase.stepIndex && activePhase.kind === phase.kind ? "is-active" : ""}`}
                        type="button"
                        key={`${phase.stepIndex}-${phase.kind}`}
                        disabled={phaseEventIndex < 0}
                        onClick={() => {
                          if (phaseEventIndex >= 0) {
                            setSelectedEventIndex(phaseEventIndex);
                          }
                        }}
                      >
                        <span>
                          {index + 1}. {phase.label}
                        </span>
                        <small>{formatDuration(phase.duration)}</small>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}
            {scene.issues.length > 0 ? (
              <output className="notice notice-warning" aria-live="polite">
                {scene.issues.map((issue) => issue.message).join(" ")}
              </output>
            ) : null}
          </aside>
        </div>
      )}
      {renderWarning ? (
        <output className="notice notice-warning" aria-live="polite">
          {renderWarning}
        </output>
      ) : null}
    </section>
  );
}
