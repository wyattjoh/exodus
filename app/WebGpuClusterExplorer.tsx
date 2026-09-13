import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import "./cluster-explorer.css";
import { SUPPORTED_CLUSTER_GENERATOR_VERSIONS } from "../src/index";
import type {
  CompiledScenario,
  JourneyModel,
  JourneySample,
  ProvenanceKind,
  RoutePlan,
  StableId,
  WorkerPlanningProgress,
} from "../src/index";
import { provenanceKinds } from "./planning";
import { formatDuration, formatPhaseKind } from "./format";
import {
  beginExplorerPointerGesture,
  buildClusterExplorerScene,
  connectionsForExplorerEntity,
  createCameraState,
  createExplorerViewProjectionMatrix,
  explorerFocusConnectionOpacity,
  explorerFocusPointOpacity,
  findExplorerEntity,
  focusCameraOnPoint,
  orbitCamera,
  panCamera,
  pickExplorerEntity,
  projectExplorerPoint,
  searchClusterExplorer,
  selectExplorerEntity,
  selectExplorerGate,
  moveExplorerPointerGesture,
  shouldPickExplorerPointerUp,
  zoomCamera,
  type CameraState,
  type ClusterExplorerScene,
  type ExplorerPointerGesture,
  type ExplorerPoint,
  type ExplorerSelection,
} from "./cluster-explorer";
import { SystemExplorerView } from "./SystemExplorerView";
import {
  createWebGpuScaleRenderer,
  type WebGpuApi,
  type WebGpuCanvas,
  type WebGpuFailure,
  type WebGpuRenderScene,
  type WebGpuScaleRenderScene,
  type WebGpuScaleRenderer,
  type WebGpuStartupBoundary,
} from "./webgpu-renderer";
import { createWebGpuScaleContract, prepareWebGpuScale } from "../src/webgpu-scale";

/**
 * Background generated-region state displayed by the Cluster explorer.
 */
export type ClusterGenerationView = {
  readonly state: "idle" | "running" | "complete" | "failed";
  readonly progress: WorkerPlanningProgress | undefined;
  readonly error: string | undefined;
};

/**
 * Props for the WebGPU Cluster explorer.
 */
export type WebGpuClusterExplorerProps = {
  readonly scenario: CompiledScenario;
  readonly selection: ExplorerSelection;
  readonly onSelectionChange: (selection: ExplorerSelection) => void;
  readonly selectedProvenance: readonly ProvenanceKind[];
  readonly onProvenanceChange: (kind: ProvenanceKind, enabled: boolean) => void;
  readonly generation: ClusterGenerationView;
  readonly model: Pick<JourneyModel, "evaluateWorldlines"> | undefined;
  readonly plannedJourney: RoutePlan | undefined;
  readonly journeySample: JourneySample | undefined;
};

function color(
  red: number,
  green: number,
  blue: number,
  alpha: number,
): readonly [number, number, number, number] {
  return Object.freeze([red, green, blue, alpha]) as readonly [number, number, number, number];
}

const PROVENANCE_COLORS: Readonly<
  Record<ProvenanceKind, readonly [number, number, number, number]>
> = Object.freeze({
  novel: color(0.55, 0.88, 0.77, 0.98),
  "supplementary-official": color(0.6, 0.77, 0.94, 0.98),
  provisional: color(0.95, 0.78, 0.4, 0.98),
  generated: color(0.72, 0.56, 0.95, 0.98),
  override: color(1, 0.48, 0.48, 0.98),
});
const SELECTED_COLOR = Object.freeze([1, 0.95, 0.82, 1]) as readonly [
  number,
  number,
  number,
  number,
];
const DEPARTURE_COLOR = Object.freeze([1, 0.66, 0.2, 1]) as readonly [
  number,
  number,
  number,
  number,
];
const DESTINATION_COLOR = Object.freeze([1, 0.3, 0.16, 1]) as readonly [
  number,
  number,
  number,
  number,
];
const SHIP_COLOR = Object.freeze([1, 0.92, 0.62, 1]) as readonly [number, number, number, number];
const CONNECTION_ALPHA = 0.42;
const FOCUS_TRANSITION_MILLISECONDS = 520;

type ClusterContextMenu = {
  readonly entityId: StableId;
  readonly x: number;
  readonly y: number;
};

type SystemFocus = {
  readonly entityId: StableId;
  readonly systemId: StableId;
};

type StartupState =
  | { readonly state: "starting" }
  | { readonly state: "ready"; readonly renderer: WebGpuScaleRenderer }
  | { readonly state: "failed"; readonly failure: WebGpuFailure };

function provenanceColor(kind: ProvenanceKind): readonly [number, number, number, number] {
  return PROVENANCE_COLORS[kind];
}

function pointColor(
  point: ExplorerPoint,
  selection: ExplorerSelection,
): readonly [number, number, number, number] {
  if (point.id === selection.departureGateId) {
    return DEPARTURE_COLOR;
  }
  if (point.id === selection.destinationGateId) {
    return DESTINATION_COLOR;
  }
  if (point.id === selection.selectedEntityId) {
    return SELECTED_COLOR;
  }
  return provenanceColor(point.provenance.primaryKind);
}

function connectionColor(kind: ProvenanceKind): readonly [number, number, number, number] {
  const color = provenanceColor(kind);
  return Object.freeze([color[0], color[1], color[2], CONNECTION_ALPHA]) as readonly [
    number,
    number,
    number,
    number,
  ];
}

function colorWithOpacity(
  value: readonly [number, number, number, number],
  opacity: number,
): readonly [number, number, number, number] {
  return Object.freeze([value[0], value[1], value[2], value[3] * opacity]) as readonly [
    number,
    number,
    number,
    number,
  ];
}

function renderScene(
  scene: ClusterExplorerScene,
  selection: ExplorerSelection,
  journeySample: JourneySample | undefined,
  focusEntityId: StableId | undefined,
  focusProgress: number,
): WebGpuRenderScene {
  const gatePositions =
    journeySample === undefined
      ? undefined
      : new Map(
          journeySample.worldlines.gates.map((gate) => [
            gate.id,
            Object.freeze([
              gate.position.x.value / scene.extentMeters,
              gate.position.y.value / scene.extentMeters,
              gate.position.z.value / scene.extentMeters,
            ]) as readonly [number, number, number],
          ]),
        );
  const shipPoint =
    journeySample === undefined
      ? []
      : [
          Object.freeze({
            position: Object.freeze([
              journeySample.shipPosition.x.value / scene.extentMeters,
              journeySample.shipPosition.y.value / scene.extentMeters,
              journeySample.shipPosition.z.value / scene.extentMeters,
            ]) as readonly [number, number, number],
            color: SHIP_COLOR,
          }),
        ];
  return Object.freeze({
    points: Object.freeze([
      ...scene.entities.map((point) =>
        Object.freeze({
          position: gatePositions?.get(point.id) ?? point.position,
          color: colorWithOpacity(
            pointColor(point, selection),
            focusEntityId === undefined
              ? 1
              : explorerFocusPointOpacity(scene, focusEntityId, point.id, focusProgress),
          ),
        }),
      ),
      ...shipPoint,
    ]),
    connections: Object.freeze(
      scene.connections.map((connection) => {
        const from = gatePositions?.get(connection.gateAId) ?? connection.endpoints[0];
        const to = gatePositions?.get(connection.gateBId) ?? connection.endpoints[1];
        return Object.freeze({
          from,
          to,
          color: colorWithOpacity(
            connectionColor(connection.provenance.primaryKind),
            focusEntityId === undefined
              ? 1
              : explorerFocusConnectionOpacity(scene, focusEntityId, connection.id, focusProgress),
          ),
        });
      }),
    ),
  });
}

function renderScaleScene(
  scene: ClusterExplorerScene,
  selection: ExplorerSelection,
  journeySample: JourneySample | undefined,
  scenario: CompiledScenario,
  cameraState: CameraState,
  canvas: HTMLCanvasElement,
  focusEntityId: StableId | undefined,
  focusProgress: number,
): WebGpuScaleRenderScene {
  const seed = scenario.seed?.value ?? scenario.seed?.text ?? scenario.id;
  const requestedGeneratorVersion =
    scenario.generation?.generatorVersion ?? scenario.generatorVersion;
  const generatorVersion =
    requestedGeneratorVersion !== undefined &&
    SUPPORTED_CLUSTER_GENERATOR_VERSIONS.includes(
      requestedGeneratorVersion as (typeof SUPPORTED_CLUSTER_GENERATOR_VERSIONS)[number],
    )
      ? requestedGeneratorVersion
      : (SUPPORTED_CLUSTER_GENERATOR_VERSIONS[0] ?? "globular-v1");
  const contract = createWebGpuScaleContract({
    logicalPopulation: Math.max(1, scenario.logicalPopulation ?? scene.systems.length),
    seed,
    generatorVersion,
    regionRadiusMeters: Math.max(1, scene.extentMeters),
  });
  const viewport = viewportFor(canvas);
  const preparation = prepareWebGpuScale(contract, {
    viewProjectionMatrix: Array.from(createExplorerViewProjectionMatrix(cameraState, viewport)),
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    cameraDistance: cameraState.distance,
    far: cameraState.far ?? 100,
    worldRadiusMeters: contract.regionRadiusMeters,
  });
  const focusPoint = findExplorerEntity(scene, focusEntityId);
  return Object.freeze({
    preparation,
    overlay: renderScene(scene, selection, journeySample, focusEntityId, focusProgress),
    focusFog:
      focusPoint === undefined
        ? undefined
        : Object.freeze({
            center: focusPoint.position,
            strength: Math.max(0, Math.min(1, focusProgress)),
            near: 0.08,
            far: 0.9,
          }),
  });
}

function webGpuApi(): WebGpuApi | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }
  const candidate = (navigator as Navigator & { readonly gpu: unknown | undefined }).gpu;
  return candidate as WebGpuApi | undefined;
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

function labelForPoint(point: ExplorerPoint): string {
  return `${point.name} · ${point.designation}`;
}

function provenanceLabel(kind: ProvenanceKind): string {
  return kind.replace("-", " ");
}

function gateLabel(scene: ClusterExplorerScene, gateId: StableId): string {
  const gate = scene.gates.find((value) => value.id === gateId);
  return gate === undefined ? gateId : labelForPoint(gate);
}

function selectedPoint(
  scene: ClusterExplorerScene,
  selection: ExplorerSelection,
): ExplorerPoint | undefined {
  return findExplorerEntity(scene, selection.selectedEntityId ?? selection.focusedEntityId);
}

function generationLabel(generation: ClusterGenerationView): string {
  if (generation.state === "running") {
    const progress = generation.progress;
    return progress === undefined
      ? "Materializing generated Systems…"
      : `Materializing generated Systems · ${Math.round((progress.completedWork / progress.totalWork) * 100)}%`;
  }
  if (generation.state === "complete") {
    return "Generated Systems materialized";
  }
  if (generation.state === "failed") {
    return "Generated region unavailable";
  }
  return "Generated region queued";
}

/**
 * Renders the provenance-aware, searchable WebGPU Cluster explorer.
 *
 * @param props - Active Scenario, shared Gate selection, filters, and generation progress.
 * @returns An accessible three-dimensional Cluster view or a hard WebGPU capability failure.
 */
export function WebGpuClusterExplorer({
  scenario,
  selection,
  onSelectionChange,
  selectedProvenance,
  onProvenanceChange,
  generation,
  model,
  plannedJourney,
  journeySample,
}: WebGpuClusterExplorerProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGpuScaleRenderer | undefined>(undefined);
  const cameraRef = useRef<CameraState>(createCameraState(undefined));
  const pointerRef = useRef<ExplorerPointerGesture | undefined>(undefined);
  const [startup, setStartup] = useState<StartupState>({ state: "starting" });
  const [renderWarning, setRenderWarning] = useState("");
  const [query, setQuery] = useState("");
  const [cameraRevision, setCameraRevision] = useState(0);
  const [contextMenu, setContextMenu] = useState<ClusterContextMenu | undefined>(undefined);
  const [focusEntityId, setFocusEntityId] = useState<StableId | undefined>(undefined);
  const [focusProgress, setFocusProgress] = useState(0);
  const [systemFocus, setSystemFocus] = useState<SystemFocus | undefined>(undefined);
  const initiallyFocusedScenario = useRef<CompiledScenario | undefined>(undefined);

  const scene = useMemo(
    () => buildClusterExplorerScene(scenario, selectedProvenance),
    [scenario, selectedProvenance],
  );
  const searchResults = useMemo(
    () => searchClusterExplorer(scene, query).slice(0, 32),
    [scene, query],
  );
  const inspected = selectedPoint(scene, selection);
  const inspectedConnections =
    inspected === undefined ? [] : connectionsForExplorerEntity(scene, inspected.id);
  const selectedGateIds = [
    selection.departureGateId,
    selection.destinationGateId,
    inspected?.entityKind === "gate" ? inspected.id : undefined,
  ].filter((gateId): gateId is StableId => gateId !== undefined);
  const selectedOrbitalAnchorIds =
    systemFocus === undefined
      ? []
      : scenario.index.orbitalAnchors.get(systemFocus.entityId)?.kind === "star"
        ? [systemFocus.entityId]
        : scenario.index.systems.has(systemFocus.entityId)
          ? scenario.orbitalAnchors
              .filter(
                (anchor) => anchor.systemId === systemFocus.systemId && anchor.kind === "star",
              )
              .map((anchor) => anchor.id)
          : [];
  const generatedSystemCount = scenario.systems.filter(
    (system) => system.provenance.kind === "generated",
  ).length;

  useEffect(() => {
    if (initiallyFocusedScenario.current === scenario) {
      return;
    }
    const origin = findExplorerEntity(scene, selection.departureGateId);
    if (origin === undefined) {
      return;
    }
    cameraRef.current = focusCameraOnPoint(cameraRef.current, origin.position);
    initiallyFocusedScenario.current = scenario;
    setCameraRevision((value) => value + 1);
  }, [scenario, scene, selection.departureGateId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || systemFocus !== undefined) {
      return undefined;
    }
    setStartup({ state: "starting" });
    let active = true;
    let lost = false;
    const boundary: WebGpuStartupBoundary = {
      gpu: webGpuApi(),
      canvas: canvas as unknown as WebGpuCanvas,
      requirements: undefined,
    };
    void createWebGpuScaleRenderer(boundary, {
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
        setRenderWarning("");
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
  }, [systemFocus]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (renderer === undefined || canvas === null || cameraRevision < 0) {
      return;
    }
    renderer.setScaleScene(
      renderScaleScene(
        scene,
        selection,
        journeySample,
        scenario,
        cameraRef.current,
        canvas,
        focusEntityId,
        focusProgress,
      ),
      cameraRef.current,
    );
  }, [journeySample, scene, selection, scenario, cameraRevision, focusEntityId, focusProgress]);

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
      renderer.setScaleScene(
        renderScaleScene(
          scene,
          selection,
          journeySample,
          scenario,
          cameraRef.current,
          canvas,
          focusEntityId,
          focusProgress,
        ),
        cameraRef.current,
      );
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [journeySample, scene, selection, scenario, startup.state, focusEntityId, focusProgress]);

  useEffect(() => {
    if (contextMenu === undefined) {
      return undefined;
    }
    const close = (): void => setContextMenu(undefined);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [contextMenu]);

  useEffect(() => {
    if (focusEntityId === undefined || model === undefined) {
      return undefined;
    }
    const point = findExplorerEntity(scene, focusEntityId);
    if (point === undefined) {
      setFocusEntityId(undefined);
      setFocusProgress(0);
      return undefined;
    }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduceMotion ? 0 : FOCUS_TRANSITION_MILLISECONDS;
    const startedAt = performance.now();
    let animationFrame = 0;
    const advance = (now: number): void => {
      const progress = duration === 0 ? 1 : Math.min(1, (now - startedAt) / duration);
      setFocusProgress(progress);
      if (progress < 1) {
        animationFrame = requestAnimationFrame(advance);
        return;
      }
      setSystemFocus(Object.freeze({ entityId: point.id, systemId: point.systemId }));
    };
    animationFrame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(animationFrame);
  }, [focusEntityId, model, scene]);

  const select = (point: ExplorerPoint): void => {
    setContextMenu(undefined);
    onSelectionChange(selectExplorerEntity(selection, point.id));
  };

  const pickAt = (canvas: HTMLCanvasElement, x: number, y: number): ExplorerPoint | undefined => {
    const viewport = viewportFor(canvas);
    const point = pickExplorerEntity(scene, cameraRef.current, viewport, x, y);
    if (point !== undefined) {
      select(point);
    }
    return point;
  };

  const openContextMenu = (point: ExplorerPoint, event: ReactMouseEvent<HTMLElement>): void => {
    event.preventDefault();
    if (selection.selectedEntityId !== point.id) {
      setContextMenu(undefined);
      return;
    }
    setContextMenu(Object.freeze({ entityId: point.id, x: event.clientX, y: event.clientY }));
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    const point = findExplorerEntity(scene, selection.selectedEntityId);
    if (point === undefined) {
      setContextMenu(undefined);
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const projected = projectExplorerPoint(
      point.position,
      cameraRef.current,
      viewportFor(event.currentTarget),
    );
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    if (!projected.visible || Math.hypot(projected.x - pointerX, projected.y - pointerY) > 24) {
      setContextMenu(undefined);
      return;
    }
    setContextMenu(Object.freeze({ entityId: point.id, x: event.clientX, y: event.clientY }));
  };

  const zoomInto = (point: ExplorerPoint): void => {
    if (model === undefined) {
      return;
    }
    setContextMenu(undefined);
    cameraRef.current = focusCameraOnPoint(cameraRef.current, point.position);
    setFocusProgress(0);
    setFocusEntityId(point.id);
    setCameraRevision((value) => value + 1);
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) {
      return;
    }
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
      ? panCamera(cameraRef.current, deltaX, deltaY)
      : orbitCamera(cameraRef.current, deltaX, deltaY);
    pointerRef.current = moveExplorerPointerGesture(previous, event.clientX, event.clientY);
    setCameraRevision((value) => value + 1);
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>): void => {
    const previous = pointerRef.current;
    pointerRef.current = undefined;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already have been released by the browser.
    }
    if (shouldPickExplorerPointerUp(previous, event.pointerId, false)) {
      const bounds = event.currentTarget.getBoundingClientRect();
      pickAt(event.currentTarget, event.clientX - bounds.left, event.clientY - bounds.top);
    }
  };

  const handlePointerCancel = (event: PointerEvent<HTMLCanvasElement>): void => {
    pointerRef.current = undefined;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already have been released by the browser.
    }
  };

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    cameraRef.current = zoomCamera(cameraRef.current, event.deltaY);
    setCameraRevision((value) => value + 1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLCanvasElement>): void => {
    if (scene.entities.length === 0) {
      return;
    }
    const currentIndex = scene.entities.findIndex(
      (point) => point.id === selection.focusedEntityId || point.id === selection.selectedEntityId,
    );
    const nextIndex =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? (currentIndex + 1 + scene.entities.length) % scene.entities.length
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? (currentIndex - 1 + scene.entities.length) % scene.entities.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? scene.entities.length - 1
              : -1;
    if (nextIndex >= 0) {
      event.preventDefault();
      const point = scene.entities[nextIndex];
      if (point !== undefined) {
        select(point);
      }
      return;
    }
    if (event.key === "Enter" && inspected !== undefined) {
      event.preventDefault();
      onSelectionChange(selectExplorerEntity(selection, inspected.id));
      return;
    }
    if (
      (event.key === "d" || event.key === "D" || event.key === "a" || event.key === "A") &&
      inspected?.entityKind === "gate"
    ) {
      event.preventDefault();
      onSelectionChange(
        selectExplorerGate(
          selection,
          event.key.toLocaleLowerCase() === "d" ? "destination" : "departure",
          inspected.id,
        ),
      );
    }
  };

  const resetCamera = (): void => {
    cameraRef.current = createCameraState(undefined);
    setCameraRevision((value) => value + 1);
  };

  const roleButtons = (point: ExplorerPoint): JSX.Element => (
    <div className="inspector-actions">
      <button
        className="button button-subtle"
        type="button"
        onClick={() => onSelectionChange(selectExplorerGate(selection, "departure", point.id))}
        disabled={point.entityKind !== "gate" || selection.departureGateId === point.id}
      >
        Set departure
      </button>
      <button
        className="button button-subtle"
        type="button"
        onClick={() => onSelectionChange(selectExplorerGate(selection, "destination", point.id))}
        disabled={point.entityKind !== "gate" || selection.destinationGateId === point.id}
      >
        Set destination
      </button>
    </div>
  );

  if (systemFocus !== undefined && model !== undefined) {
    return (
      <SystemExplorerView
        model={model}
        scenario={scenario}
        systemId={systemFocus.systemId}
        journey={plannedJourney}
        journeySample={journeySample}
        selectedGateIds={selectedGateIds}
        selectedOrbitalAnchorIds={selectedOrbitalAnchorIds}
        onClose={() => {
          setSystemFocus(undefined);
          setFocusEntityId(undefined);
          setFocusProgress(0);
          cameraRef.current = createCameraState(undefined);
          setCameraRevision((value) => value + 1);
        }}
      />
    );
  }

  const contextPoint =
    contextMenu === undefined ? undefined : findExplorerEntity(scene, contextMenu.entityId);

  return (
    <section className="explorer-card immersive-map" aria-labelledby="cluster-explorer-heading">
      <header className="section-heading-row explorer-heading map-hud map-hud-header">
        <div>
          <p className="eyebrow">WebGPU / CLUSTER FRAME</p>
          <h2 id="cluster-explorer-heading">Centauri Cluster explorer</h2>
        </div>
        <div className="explorer-status" aria-label="Cluster generation status">
          <span className="status-pill status-success">3D</span>
          {journeySample !== undefined ? (
            <span className="status-pill status-neutral">
              Active {journeySample.view === "cluster" ? "Cluster" : "System"} sample
            </span>
          ) : null}
          <span>{generationLabel(generation)}</span>
        </div>
      </header>
      <p className="control-help explorer-intro map-hud map-hud-intro">
        Systems and stars are shown at Cluster scale. Select an entity, then right-click it to zoom
        into its AU-scale System. Gate Connections identify paired Gates; Journey playback shares
        the same coordinate time.
      </p>
      <p className="map-route-status" aria-label="Active route endpoints">
        <strong>Departure</strong>{" "}
        {selection.departureGateId === undefined
          ? "Not selected"
          : gateLabel(scene, selection.departureGateId)}{" "}
        <span aria-hidden="true">→</span> <strong>Destination</strong>{" "}
        {selection.destinationGateId === undefined
          ? "Not selected"
          : gateLabel(scene, selection.destinationGateId)}
        {plannedJourney === undefined ? " · Select endpoints to plan" : " · Route plan active"}
      </p>
      {startup.state === "failed" ? (
        <section className="webgpu-failure" role="alert" aria-labelledby="webgpu-failure-heading">
          <p className="eyebrow">Capability required</p>
          <h3 id="webgpu-failure-heading">WebGPU unavailable</h3>
          <p>{startup.failure.message}</p>
          <p className="failure-detail">{startup.failure.detail}</p>
          <code>{startup.failure.code}</code>
          {startup.failure.diagnostics.length > 0 ? (
            <details className="failure-diagnostics">
              <summary>Compatibility diagnostics</summary>
              <ul>
                {startup.failure.diagnostics.map((diagnostic, index) => (
                  <li key={`${diagnostic.kind}:${diagnostic.name}:${index}`}>
                    <strong>{diagnostic.name}</strong>: {diagnostic.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : (
        <div className="explorer-layout map-hud-layout">
          <div className="explorer-viewport-wrap map-hud-viewport">
            <div className="explorer-toolbar">
              <label className="explorer-search">
                <span>Search name or stable designation</span>
                <input
                  type="search"
                  value={query}
                  placeholder="e.g. Terra or GATE-CEN-1001"
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
              </label>
              <button className="button button-subtle" type="button" onClick={resetCamera}>
                Reset camera
              </button>
            </div>
            <div className="explorer-canvas-frame">
              <canvas
                ref={canvasRef}
                className="cluster-canvas"
                width={960}
                height={640}
                tabIndex={0}
                aria-label="Three-dimensional Centauri Cluster. Select an entity, then right-click it for zoom actions. Use arrow keys to navigate entities, drag to orbit, and scroll to zoom."
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                onWheel={handleWheel}
                onKeyDown={handleKeyDown}
                onContextMenu={handleContextMenu}
              />
              {contextPoint !== undefined && contextMenu !== undefined ? (
                <div
                  className="cluster-context-menu"
                  role="menu"
                  aria-label={`${contextPoint.name} actions`}
                  style={{ left: contextMenu.x, top: contextMenu.y }}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => zoomInto(contextPoint)}
                    disabled={model === undefined || focusEntityId !== undefined}
                  >
                    Zoom in to System
                  </button>
                </div>
              ) : null}
              {focusEntityId !== undefined ? (
                <output className="canvas-overlay focus-transition-label" aria-live="polite">
                  Entering AU-scale System…
                </output>
              ) : startup.state === "starting" ? (
                <output className="canvas-overlay" aria-live="polite">
                  Connecting to WebGPU…
                </output>
              ) : null}
            </div>
            <div className="explorer-legend" aria-label="Provenance and Journey legend">
              {provenanceKinds.map((kind) => (
                <span className={`provenance-key provenance-${kind}`} key={kind}>
                  <span className="provenance-swatch" aria-hidden="true" />
                  {provenanceLabel(kind)}
                </span>
              ))}
              <span className="provenance-key journey-departure-key">
                <span className="provenance-swatch" aria-hidden="true" />
                Departure Gate
              </span>
              <span className="provenance-key journey-destination-key">
                <span className="provenance-swatch" aria-hidden="true" />
                Destination Gate
              </span>
              {journeySample !== undefined ? (
                <span className="provenance-key journey-ship-key">
                  <span className="provenance-swatch" aria-hidden="true" />
                  Current ship sample
                </span>
              ) : null}
            </div>
            <p className="camera-help">
              Click to select · right-click the selected entity to zoom in · drag to orbit ·
              Shift-drag to pan · scroll to zoom · arrow keys to navigate
            </p>
          </div>
          <aside
            className="explorer-inspector map-hud map-hud-inspector"
            aria-label="Cluster search and inspection"
          >
            <fieldset className="explorer-filter">
              <legend>Visible Provenance</legend>
              {provenanceKinds.map((kind) => (
                <label className="check-label" key={kind}>
                  <input
                    type="checkbox"
                    checked={selectedProvenance.includes(kind)}
                    onChange={(event) => onProvenanceChange(kind, event.currentTarget.checked)}
                  />
                  <span>{provenanceLabel(kind)}</span>
                </label>
              ))}
            </fieldset>
            <div className="explorer-results">
              <div className="explorer-results-heading">
                <span>Search results</span>
                <span className="count-badge">{searchResults.length}</span>
              </div>
              {searchResults.length === 0 ? (
                <p className="muted">No visible System, star, or Gate matches.</p>
              ) : (
                <div className="explorer-result-list">
                  {searchResults.map((point) => (
                    <button
                      className={`explorer-result ${selection.selectedEntityId === point.id ? "is-selected" : ""}`}
                      type="button"
                      key={point.id}
                      onClick={() => select(point)}
                      onContextMenu={(event) => openContextMenu(point, event)}
                    >
                      <span>{labelForPoint(point)}</span>
                      <small>
                        {point.entityKind} · {provenanceLabel(point.provenance.primaryKind)}
                      </small>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {journeySample !== undefined ? (
              <section
                className="journey-inspection cluster-journey-inspection"
                aria-label="Active Journey sample"
              >
                <div className="explorer-results-heading">
                  <span>Active Journey sample</span>
                  <span className="status-pill status-success">
                    {journeySample.view === "cluster" ? "Cluster" : "System"}
                  </span>
                </div>
                <p>
                  <strong>
                    {journeySample.phase === undefined
                      ? "No active phase"
                      : formatPhaseKind(journeySample.phase.kind)}
                  </strong>{" "}
                  · T+{formatDuration(journeySample.clocks.clusterCoordinateTime)}
                </p>
                <dl className="journey-clock-grid">
                  <div>
                    <dt>Cluster Coordinate</dt>
                    <dd>{formatDuration(journeySample.clocks.clusterCoordinateTime)}</dd>
                  </div>
                  <div>
                    <dt>Ship Proper</dt>
                    <dd>{formatDuration(journeySample.clocks.shipProperTime)}</dd>
                  </div>
                  <div>
                    <dt>Aging Difference</dt>
                    <dd>{formatDuration(journeySample.clocks.agingDifference)}</dd>
                  </div>
                </dl>
                <p className="control-help">
                  Ship state is sampled from the Journey Model at the same coordinate time used by
                  the linked System view.
                </p>
              </section>
            ) : null}
            <div className="explorer-inspection">
              <div className="explorer-results-heading">
                <span>Provenance inspection</span>
                {generatedSystemCount > 0 ? (
                  <span className="count-badge">{generatedSystemCount} generated</span>
                ) : null}
              </div>
              {inspected === undefined ? (
                <p className="muted">
                  Select a System, star, or Gate in the view to inspect its context.
                </p>
              ) : (
                <>
                  <h3>{inspected.name}</h3>
                  <code>{inspected.designation}</code>
                  <div className="provenance-tags">
                    {inspected.provenance.kinds.map((kind) => (
                      <span className={`provenance-tag provenance-${kind}`} key={kind}>
                        {provenanceLabel(kind)}
                      </span>
                    ))}
                  </div>
                  <p className="inspector-meta">
                    {inspected.entityKind === "system"
                      ? "System"
                      : inspected.entityKind === "star"
                        ? "Star / Orbital Anchor"
                        : "Gate of Heaven"}{" "}
                    · stable id {inspected.id}
                  </p>
                  {roleButtons(inspected)}
                  {inspectedConnections.length > 0 ? (
                    <div className="connection-list">
                      <strong>Gate Connections</strong>
                      <p className="control-help">
                        Paired endpoints for Journey legs; no hidden travel phase is implied.
                      </p>
                      {inspectedConnections.map((connection) => (
                        <div className="connection-row" key={connection.id}>
                          <span>{gateLabel(scene, connection.gateAId)}</span>
                          <span aria-hidden="true">↔</span>
                          <span>{gateLabel(scene, connection.gateBId)}</span>
                          <small>
                            {connection.designation} ·{" "}
                            {provenanceLabel(connection.provenance.primaryKind)}
                          </small>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">
                      No visible Gate Connections are associated with this entity.
                    </p>
                  )}
                  {inspected.provenance.notes.length > 0 ? (
                    <p className="inspector-note">{inspected.provenance.notes.join(" ")}</p>
                  ) : null}
                  {inspected.provenance.citations.length > 0 ? (
                    <p className="inspector-note">
                      Sources: {inspected.provenance.citations.join("; ")}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </aside>
        </div>
      )}
      {generation.state === "failed" && generation.error !== undefined ? (
        <output className="notice notice-warning" aria-live="polite">
          {generation.error}
        </output>
      ) : null}
      {renderWarning ? (
        <output className="notice notice-warning" aria-live="polite">
          {renderWarning}
        </output>
      ) : null}
    </section>
  );
}
