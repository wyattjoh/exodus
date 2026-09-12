import {
  seconds,
  type CompiledGate,
  type CompiledOrbitalAnchor,
  type CompiledScenario,
  type GateWorldline,
  type JourneyClockReading,
  type JourneyEventKind,
  type JourneyModel,
  type JourneyPhaseKind,
  type JourneySample,
  type MultiLegJourneyPhase,
  type MultiLegJourneyTimeline,
  type OrbitalAnchorWorldline,
  type PositionVector,
  type Provenance,
  type ProvenanceKind,
  type RoutePlan,
  type ScenarioWorldlineResult,
  type Seconds,
  type StableId,
  type VelocityVector,
  type WorldlineIssue,
} from "../src/index";
import type { WebGpuRenderLine, WebGpuRenderPoint, WebGpuRenderScene } from "./webgpu-renderer";

/**
 * Number of metres in one astronomical unit used by the AU-scale System view.
 */
export const ASTRONOMICAL_UNIT_METERS = 149_597_870_700;

const DAY_SECONDS = 86_400;
const ORBIT_SAMPLE_WINDOW_SECONDS = 365.25 * DAY_SECONDS;
const DEFAULT_ORBIT_SAMPLE_COUNT = 48;
const EPSILON_SECONDS = 1e-7;

/**
 * A numeric vector in the local AU-scale System view.
 */
export type SystemExplorerVector3 = readonly [number, number, number];

/**
 * The explicit transform between Cluster-frame metres and local System-view AU coordinates.
 *
 * A System transform is deliberately independent from the Cluster explorer's normalized
 * light-year transform. The two views can therefore use different origins, units, and cameras
 * without changing either scene's geometry.
 */
export type SystemViewScaleTransform = {
  readonly kind: "system-au";
  readonly unit: "AU";
  readonly coordinateTime: Seconds;
  readonly originMeters: SystemExplorerVector3;
  readonly metersPerUnit: number;
  readonly toViewPosition: (position: PositionVector) => SystemExplorerVector3;
  readonly toWorldPosition: (position: SystemExplorerVector3) => SystemExplorerVector3;
  readonly worldToView: (position: PositionVector) => SystemExplorerVector3;
  readonly viewToWorld: (position: SystemExplorerVector3) => SystemExplorerVector3;
};

/**
 * Camera state for the independent AU-scale System view.
 */
export type SystemViewCameraState = {
  readonly target: SystemExplorerVector3;
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  readonly far: number;
};

/**
 * Creates an AU-view camera without sharing or mutating the Cluster camera state.
 *
 * @param target - Local AU point to center, defaulting to the System origin.
 * @param distance - Initial local camera distance in AU.
 * @param far - Far clipping distance in local AU.
 * @returns An immutable System camera state.
 */
export function createSystemViewCameraState(
  target: SystemExplorerVector3 = freezeVector(0, 0, 0),
  distance = 8,
  far = 100,
): SystemViewCameraState {
  return Object.freeze({
    target,
    yaw: Math.PI / 4,
    pitch: 0.36,
    distance: Math.max(0.25, Math.min(100_000, distance)),
    far: Math.max(100, Number.isFinite(far) ? far : 100),
  });
}

/**
 * Applies an orbit gesture to the independent System camera.
 *
 * @param camera - Current System camera.
 * @param deltaX - Horizontal pointer delta in pixels.
 * @param deltaY - Vertical pointer delta in pixels.
 * @returns Updated immutable camera state.
 */
export function orbitSystemViewCamera(
  camera: SystemViewCameraState,
  deltaX: number,
  deltaY: number,
): SystemViewCameraState {
  const maximumPitch = Math.PI / 2 - 0.05;
  return Object.freeze({
    ...camera,
    yaw: camera.yaw - deltaX * 0.008,
    pitch: Math.max(-maximumPitch, Math.min(maximumPitch, camera.pitch + deltaY * 0.008)),
  });
}

/**
 * Applies a pan gesture to the independent System camera.
 *
 * @param camera - Current System camera.
 * @param deltaX - Horizontal pointer delta in pixels.
 * @param deltaY - Vertical pointer delta in pixels.
 * @returns Updated immutable camera state.
 */
export function panSystemViewCamera(
  camera: SystemViewCameraState,
  deltaX: number,
  deltaY: number,
): SystemViewCameraState {
  const scale = camera.distance * 0.0015;
  return Object.freeze({
    ...camera,
    target: freezeVector(
      camera.target[0] - deltaX * scale,
      camera.target[1] + deltaY * scale,
      camera.target[2],
    ),
  });
}

/**
 * Applies a wheel zoom gesture to the independent System camera.
 *
 * @param camera - Current System camera.
 * @param deltaY - Pointer wheel delta.
 * @returns Updated immutable camera state.
 */
export function zoomSystemViewCamera(
  camera: SystemViewCameraState,
  deltaY: number,
): SystemViewCameraState {
  return Object.freeze({
    ...camera,
    distance: Math.max(0.25, Math.min(100_000, camera.distance * Math.exp(deltaY * 0.001))),
  });
}

/**
 * The result of applying one keyboard camera command to the System view.
 */
export type SystemViewCameraKeyResult = {
  readonly handled: boolean;
  readonly camera: SystemViewCameraState;
};

/**
 * Applies a deterministic keyboard equivalent of the System camera gestures.
 *
 * Arrow keys orbit, Shift+Arrow keys pan, +/- zoom, and Home restores the supplied reset camera.
 *
 * @param camera - Current System camera.
 * @param key - Keyboard key value from the focused canvas.
 * @param shiftKey - Whether Shift modifies an arrow key into a pan.
 * @param resetCamera - Camera state restored by Home.
 * @returns Whether the key was handled and the resulting immutable camera.
 */
export function systemViewCameraKey(
  camera: SystemViewCameraState,
  key: string,
  shiftKey: boolean,
  resetCamera: SystemViewCameraState,
): SystemViewCameraKeyResult {
  const gestureStep = 24;
  if (key === "Home") {
    return Object.freeze({ handled: true, camera: resetCamera });
  }
  if (key === "+" || key === "=") {
    return Object.freeze({ handled: true, camera: zoomSystemViewCamera(camera, -120) });
  }
  if (key === "-" || key === "_") {
    return Object.freeze({ handled: true, camera: zoomSystemViewCamera(camera, 120) });
  }
  if (shiftKey) {
    switch (key) {
      case "ArrowLeft":
        return Object.freeze({
          handled: true,
          camera: panSystemViewCamera(camera, -gestureStep, 0),
        });
      case "ArrowRight":
        return Object.freeze({
          handled: true,
          camera: panSystemViewCamera(camera, gestureStep, 0),
        });
      case "ArrowUp":
        return Object.freeze({
          handled: true,
          camera: panSystemViewCamera(camera, 0, -gestureStep),
        });
      case "ArrowDown":
        return Object.freeze({
          handled: true,
          camera: panSystemViewCamera(camera, 0, gestureStep),
        });
    }
  }
  switch (key) {
    case "ArrowLeft":
      return Object.freeze({
        handled: true,
        camera: orbitSystemViewCamera(camera, -gestureStep, 0),
      });
    case "ArrowRight":
      return Object.freeze({
        handled: true,
        camera: orbitSystemViewCamera(camera, gestureStep, 0),
      });
    case "ArrowUp":
      return Object.freeze({
        handled: true,
        camera: orbitSystemViewCamera(camera, 0, -gestureStep),
      });
    case "ArrowDown":
      return Object.freeze({
        handled: true,
        camera: orbitSystemViewCamera(camera, 0, gestureStep),
      });
  }
  return Object.freeze({ handled: false, camera });
}

/**
 * Converts the System camera shape to the existing renderer camera contract.
 *
 * @param camera - Independent System AU camera.
 * @returns A renderer camera copy; the Cluster camera is never reused.
 */
export function systemViewCameraForRenderer(camera: SystemViewCameraState): {
  readonly target: SystemExplorerVector3;
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  readonly far: number;
} {
  return Object.freeze({ ...camera });
}

/**
 * A provenance summary attached to one System-view body.
 */
export type SystemExplorerProvenanceSummary = {
  readonly primaryKind: ProvenanceKind;
  readonly kinds: readonly ProvenanceKind[];
  readonly authorities: readonly string[];
  readonly notes: readonly string[];
  readonly citations: readonly string[];
};

/**
 * One route-relevant Orbital Anchor or selected Gate at the active System-view epoch.
 */
export type SystemExplorerBody = {
  readonly id: StableId;
  readonly entityKind: "orbital-anchor" | "gate";
  readonly name: string;
  readonly designation: string;
  readonly systemId: StableId;
  readonly parentId: StableId | undefined;
  readonly orbitalAnchorId: StableId | undefined;
  readonly selected: boolean;
  readonly worldline: OrbitalAnchorWorldline | GateWorldline;
  readonly position: SystemExplorerVector3;
  readonly positionMeters: SystemExplorerVector3;
  readonly velocityMetersPerSecond: SystemExplorerVector3;
  readonly provenance: SystemExplorerProvenanceSummary;
};

/**
 * A nested anchor relationship rendered as a local line between a parent and child body.
 */
export type SystemExplorerNestedOrbitRelationship = {
  readonly parentId: StableId;
  readonly childId: StableId;
  readonly parentPosition: SystemExplorerVector3;
  readonly childPosition: SystemExplorerVector3;
};

/**
 * A Gate-to-anchor relationship retained even when no Keplerian orbit path is available.
 */
export type SystemExplorerGateOrbitRelationship = {
  readonly gateId: StableId;
  readonly orbitalAnchorId: StableId;
  readonly anchorPosition: SystemExplorerVector3;
  readonly gatePosition: SystemExplorerVector3;
};

/**
 * A model-sampled orbit path for an anchor or a Gate with orbital elements.
 */
export type SystemExplorerOrbit = {
  readonly bodyId: StableId;
  readonly parentId: StableId | undefined;
  readonly entityKind: "orbital-anchor" | "gate";
  readonly points: readonly SystemExplorerVector3[];
  readonly worldPositionsMeters: readonly SystemExplorerVector3[];
  readonly sampleCoordinateTimes: readonly Seconds[];
};

/**
 * A human-readable description of one Journey Timeline phase for the System view.
 */
export type SystemExplorerPhaseDescription = {
  readonly kind: JourneyPhaseKind;
  readonly stepIndex: number;
  readonly label: string;
  readonly detail: string;
  readonly departureGateId: StableId;
  readonly destinationGateId: StableId;
  readonly startCoordinateTime: Seconds;
  readonly endCoordinateTime: Seconds;
  readonly duration: Seconds;
  readonly start: JourneyClockReading;
  readonly end: JourneyClockReading;
  readonly eventKinds: readonly JourneyEventKind[];
  readonly hasCoast: boolean;
};

/**
 * The deterministic result of selecting a time in a Journey Timeline.
 */
export type SystemExplorerJourneyScrub = {
  readonly coordinateTime: Seconds;
  readonly relativeCoordinateTime: Seconds;
  readonly eventIndex: number | undefined;
  readonly phaseIndex: number | undefined;
  readonly phase: MultiLegJourneyPhase | undefined;
  readonly event: MultiLegJourneyTimeline["events"][number] | undefined;
  readonly clocks: JourneyClockReading;
  readonly shipPosition: PositionVector | undefined;
  readonly shipVelocity: VelocityVector | undefined;
  readonly view: "cluster" | "system" | undefined;
  readonly provenance: JourneySample["provenance"] | undefined;
  readonly uncertainty: JourneySample["uncertainty"] | undefined;
};

/**
 * One exact model transfer-phase boundary record.
 *
 * The endpoints are model-emitted states used for inspection; the System renderer does not connect
 * them into an inferred physical trajectory.
 */
export type SystemExplorerTransferSegment = {
  readonly kind: "acceleration" | "coast" | "braking";
  readonly startCoordinateTime: Seconds;
  readonly endCoordinateTime: Seconds;
  readonly startPosition: SystemExplorerVector3;
  readonly endPosition: SystemExplorerVector3;
  readonly startPositionMeters: SystemExplorerVector3;
  readonly endPositionMeters: SystemExplorerVector3;
  readonly startVelocityMetersPerSecond: SystemExplorerVector3;
  readonly endVelocityMetersPerSecond: SystemExplorerVector3;
};

/**
 * A planned moving-destination In-system Transfer prepared for exact event inspection.
 */
export type SystemExplorerTransferTrajectory = {
  readonly kind: "in-system-transfer";
  readonly departureGateId: StableId;
  readonly destinationGateId: StableId;
  readonly startCoordinateTime: Seconds;
  readonly endCoordinateTime: Seconds;
  readonly peakSpeed: number;
  readonly coastSpeed: number | undefined;
  readonly hasCoast: boolean;
  readonly segments: readonly SystemExplorerTransferSegment[];
  readonly activeSegment: SystemExplorerTransferSegment | undefined;
  readonly destinationIntercept: {
    readonly coordinateTime: Seconds;
    readonly position: PositionVector;
    readonly velocity: VelocityVector;
    readonly positionView: SystemExplorerVector3;
    readonly velocityMetersPerSecond: SystemExplorerVector3;
  };
  readonly events: readonly SystemExplorerTransferEvent[];
};

/**
 * One transfer event with an absolute Journey coordinate time and model-provided state.
 */
export type SystemExplorerTransferEvent = {
  readonly kind: "departure" | "acceleration-end" | "coast-start" | "flip" | "arrival";
  readonly phase: "acceleration" | "coast" | "braking";
  readonly coordinateTime: Seconds;
  readonly position: PositionVector;
  readonly velocity: VelocityVector;
  readonly positionView: SystemExplorerVector3;
  readonly velocityMetersPerSecond: SystemExplorerVector3;
};

/**
 * The immutable scene model consumed by the linked AU-scale System renderer.
 */
export type SystemExplorerScene = {
  readonly kind: "system";
  readonly scenarioId: StableId;
  readonly systemId: StableId;
  readonly systemName: string;
  readonly coordinateTime: number;
  readonly coordinateTimeQuantity: Seconds;
  readonly scale: SystemViewScaleTransform;
  readonly orbitalAnchors: readonly SystemExplorerBody[];
  readonly gates: readonly SystemExplorerBody[];
  readonly entities: readonly SystemExplorerBody[];
  readonly orbits: readonly SystemExplorerOrbit[];
  readonly nestedOrbitRelationships: readonly SystemExplorerNestedOrbitRelationship[];
  readonly gateOrbitRelationships: readonly SystemExplorerGateOrbitRelationship[];
  readonly journey: MultiLegJourneyTimeline | undefined;
  readonly phases: readonly SystemExplorerPhaseDescription[];
  readonly activeJourney: SystemExplorerJourneyScrub | undefined;
  readonly shipPosition: PositionVector | undefined;
  readonly shipVelocity: VelocityVector | undefined;
  readonly trajectory: SystemExplorerTransferTrajectory | undefined;
  readonly issues: readonly WorldlineIssue[];
};

/**
 * Model dependency needed by the System projection seam.
 */
export type SystemExplorerWorldlineModel = Pick<JourneyModel, "evaluateWorldlines">;

/**
 * A Route Plan or direct Journey Timeline accepted by the System projection.
 */
export type SystemExplorerJourney = RoutePlan | MultiLegJourneyTimeline;

/**
 * Options for building a linked System scene.
 */
export type BuildSystemExplorerSceneOptions = {
  readonly model: SystemExplorerWorldlineModel;
  readonly scenario: CompiledScenario;
  readonly systemId: StableId;
  readonly coordinateTime: Seconds | number;
  readonly journey: SystemExplorerJourney | undefined;
  readonly selectedGateIds: readonly StableId[] | undefined;
  readonly orbitSampleCount: number | undefined;
  readonly timelineEventIndex: number | undefined;
  readonly journeySample?: JourneySample | undefined;
};

function freezeVector(x: number, y: number, z: number): SystemExplorerVector3 {
  return Object.freeze([x, y, z]) as SystemExplorerVector3;
}

function numericPosition(position: PositionVector): SystemExplorerVector3 {
  return freezeVector(position.x.value, position.y.value, position.z.value);
}

function numericVelocity(velocity: VelocityVector): SystemExplorerVector3 {
  return freezeVector(velocity.x.value, velocity.y.value, velocity.z.value);
}

function coordinateValue(value: Seconds | number): number {
  return typeof value === "number" ? value : value.value;
}

function finiteCoordinate(value: Seconds | number, fallback: number): Seconds {
  const numeric = coordinateValue(value);
  return seconds(Number.isFinite(numeric) ? numeric : fallback);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values.filter((value) => value.length > 0))].sort());
}

function provenanceSummary(entity: {
  readonly canonicalIdentity: { readonly provenance: Provenance };
  readonly provenance: Provenance;
  readonly properties: Readonly<Record<string, { readonly provenance: Provenance }>>;
}): SystemExplorerProvenanceSummary {
  const records = [
    entity.canonicalIdentity.provenance,
    entity.provenance,
    ...Object.values(entity.properties).map((property) => property.provenance),
  ];
  return Object.freeze({
    primaryKind: entity.canonicalIdentity.provenance.kind,
    kinds: uniqueStrings(records.map((record) => record.kind)) as readonly ProvenanceKind[],
    authorities: uniqueStrings(records.map((record) => record.authority)),
    notes: uniqueStrings(
      records.flatMap((record) => (record.note === undefined ? [] : [record.note])),
    ),
    citations: uniqueStrings(
      records.flatMap((record) =>
        record.citations.map((citation) => `${citation.source} · ${citation.locator}`),
      ),
    ),
  });
}

function worldlinePosition(worldline: OrbitalAnchorWorldline | GateWorldline): PositionVector {
  return worldline.position;
}

function worldlineVelocity(worldline: OrbitalAnchorWorldline | GateWorldline): VelocityVector {
  return worldline.velocity;
}

function distanceBetween(left: SystemExplorerVector3, right: SystemExplorerVector3): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

/**
 * Creates the independent local transform used by an AU-scale System view.
 *
 * @param origin - Cluster-frame origin in metres, normally the selected System centre.
 * @param coordinateTime - Scenario-relative epoch represented by this transform.
 * @returns An immutable transform with forward and inverse local-coordinate functions.
 */
export function createSystemViewScaleTransform(
  origin: PositionVector,
  coordinateTime: Seconds = seconds(0),
): SystemViewScaleTransform {
  const originMeters = numericPosition(origin);
  const transform = {
    kind: "system-au" as const,
    unit: "AU" as const,
    coordinateTime,
    originMeters,
    metersPerUnit: ASTRONOMICAL_UNIT_METERS,
    toViewPosition: (position: PositionVector): SystemExplorerVector3 => {
      return freezeVector(
        (position.x.value - originMeters[0]) / ASTRONOMICAL_UNIT_METERS,
        (position.y.value - originMeters[1]) / ASTRONOMICAL_UNIT_METERS,
        (position.z.value - originMeters[2]) / ASTRONOMICAL_UNIT_METERS,
      );
    },
    toWorldPosition: (position: SystemExplorerVector3): SystemExplorerVector3 =>
      freezeVector(
        originMeters[0] + position[0] * ASTRONOMICAL_UNIT_METERS,
        originMeters[1] + position[1] * ASTRONOMICAL_UNIT_METERS,
        originMeters[2] + position[2] * ASTRONOMICAL_UNIT_METERS,
      ),
  } as const;
  return Object.freeze({
    ...transform,
    worldToView: transform.toViewPosition,
    viewToWorld: transform.toWorldPosition,
  });
}

function timelineForJourney(
  journey: SystemExplorerJourney | undefined,
): MultiLegJourneyTimeline | undefined {
  if (journey === undefined) {
    return undefined;
  }
  return journey.kind === "route-plan" ? journey.timeline : journey;
}

function phaseLabel(kind: JourneyPhaseKind): string {
  switch (kind) {
    case "departure-transition":
      return "Gate departure transition";
    case "arrival-transition":
      return "Gate arrival transition";
    case "interstellar-cruise":
      return "Interstellar Cruise";
    case "in-system-transfer":
      return "In-system Transfer";
    case "dwell":
      return "Dwell";
  }
}

function phaseDetail(phase: MultiLegJourneyPhase, eventKinds: readonly JourneyEventKind[]): string {
  switch (phase.kind) {
    case "in-system-transfer": {
      const transfer = phase.transfer;
      const hasCoast = transfer?.coastSpeed !== undefined;
      return hasCoast
        ? "Powered acceleration, capped coast, flip, and braking to the moving destination intercept."
        : "Powered acceleration, flip, and braking to the moving destination intercept.";
    }
    case "dwell":
      return "Ship remains comoving with the Gate; its proper time follows the Gate worldline.".concat(
        eventKinds.length === 0 ? "" : " Dwell boundaries are selectable.",
      );
    case "interstellar-cruise":
      return "Constant 0.999c Cluster-frame cruise to the destination Gate's future orbital position.";
    case "departure-transition":
      return "Instantaneous ZPZ-protected departure transition; no elapsed time.";
    case "arrival-transition":
      return "Instantaneous ZPZ-protected arrival transition; no elapsed time.";
  }
}

/**
 * Describes a model Journey phase without changing its timing or physics.
 *
 * @param phase - Complete phase emitted by the Journey Model.
 * @returns An immutable, provenance-neutral presentation description.
 */
export function describeJourneyPhase(phase: MultiLegJourneyPhase): SystemExplorerPhaseDescription;

/**
 * Describes a model Journey phase and attaches event labels from its parent timeline.
 *
 * @param phase - Complete phase emitted by the Journey Model.
 * @param timeline - Parent timeline used to attach event labels.
 * @returns An immutable, provenance-neutral presentation description.
 */
export function describeJourneyPhase(
  phase: MultiLegJourneyPhase,
  timeline: MultiLegJourneyTimeline,
): SystemExplorerPhaseDescription;

export function describeJourneyPhase(
  phase: MultiLegJourneyPhase,
  ...timelineArguments: [] | [timelineOrIndex: MultiLegJourneyTimeline]
): SystemExplorerPhaseDescription {
  const timelineOrIndex = timelineArguments[0];
  const timeline =
    typeof timelineOrIndex === "object" && timelineOrIndex !== null ? timelineOrIndex : undefined;
  const eventKinds =
    timeline === undefined
      ? []
      : timeline.events
          .filter(
            (event) =>
              event.stepIndex === phase.stepIndex &&
              event.phase === phase.kind &&
              event.coordinateTime.value >= phase.startCoordinateTime.value - EPSILON_SECONDS &&
              event.coordinateTime.value <= phase.endCoordinateTime.value + EPSILON_SECONDS,
          )
          .map((event) => event.kind);
  return Object.freeze({
    kind: phase.kind,
    stepIndex: phase.stepIndex,
    label: phaseLabel(phase.kind),
    detail: phaseDetail(phase, eventKinds),
    departureGateId: phase.departureGateId,
    destinationGateId: phase.destinationGateId,
    startCoordinateTime: phase.startCoordinateTime,
    endCoordinateTime: phase.endCoordinateTime,
    duration: phase.clusterCoordinateDuration,
    start: phase.start,
    end: phase.end,
    eventKinds: Object.freeze([...eventKinds]),
    hasCoast: phase.transfer?.coastSpeed !== undefined,
  });
}

function phaseIndexForTime(
  timeline: MultiLegJourneyTimeline,
  coordinateTime: number,
  event: MultiLegJourneyTimeline["events"][number] | undefined,
): number | undefined {
  if (event !== undefined) {
    const eventIndex = timeline.phases.findIndex(
      (phase) => phase.stepIndex === event.stepIndex && phase.kind === event.phase,
    );
    if (eventIndex >= 0) {
      return eventIndex;
    }
  }
  const containing = timeline.phases.findIndex(
    (phase) =>
      phase.endCoordinateTime.value > phase.startCoordinateTime.value &&
      coordinateTime >= phase.startCoordinateTime.value &&
      coordinateTime < phase.endCoordinateTime.value,
  );
  if (containing >= 0) {
    return containing;
  }
  const ending = timeline.phases.findIndex(
    (phase) => Math.abs(coordinateTime - phase.endCoordinateTime.value) <= EPSILON_SECONDS,
  );
  if (ending >= 0) {
    return ending;
  }
  return timeline.phases.length === 0 ? undefined : timeline.phases.length - 1;
}

type JourneyBoundary = {
  readonly coordinateTime: Seconds;
  readonly phaseIndex: number;
  readonly phase: MultiLegJourneyPhase;
  readonly clocks: JourneyClockReading;
};

function zeroJourneyClockReading(): JourneyClockReading {
  return Object.freeze({
    clusterCoordinateTime: seconds(0),
    shipProperTime: seconds(0),
    agingDifference: seconds(0),
  });
}

function nearestPhaseBoundary(
  timeline: MultiLegJourneyTimeline,
  coordinateTime: number,
): JourneyBoundary | undefined {
  let nearest: JourneyBoundary | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  timeline.phases.forEach((phase, phaseIndex) => {
    for (const [boundaryCoordinateTime, clocks] of [
      [phase.startCoordinateTime, phase.start],
      [phase.endCoordinateTime, phase.end],
    ] as const) {
      const distance = Math.abs(boundaryCoordinateTime.value - coordinateTime);
      if (distance <= nearestDistance) {
        nearestDistance = distance;
        nearest = { coordinateTime: boundaryCoordinateTime, phaseIndex, phase, clocks };
      }
    }
  });
  return nearest;
}

function emptyJourneyScrub(timeline: MultiLegJourneyTimeline): SystemExplorerJourneyScrub {
  const phase = timeline.phases[0];
  return Object.freeze({
    coordinateTime: phase?.startCoordinateTime ?? timeline.departureCoordinateTime,
    relativeCoordinateTime: seconds(0),
    eventIndex: undefined,
    phaseIndex: phase === undefined ? undefined : 0,
    phase,
    event: undefined,
    clocks: phase?.start ?? zeroJourneyClockReading(),
    shipPosition: phase?.startPosition,
    shipVelocity: phase?.startVelocity,
    view: undefined,
    provenance: undefined,
    uncertainty: undefined,
  });
}

function scrubJourneyBoundary(
  timeline: MultiLegJourneyTimeline,
  boundary: JourneyBoundary | undefined,
): SystemExplorerJourneyScrub {
  if (boundary === undefined) {
    return emptyJourneyScrub(timeline);
  }
  return Object.freeze({
    coordinateTime: boundary.coordinateTime,
    relativeCoordinateTime: seconds(
      boundary.coordinateTime.value - timeline.departureCoordinateTime.value,
    ),
    eventIndex: undefined,
    phaseIndex: boundary.phaseIndex,
    phase: boundary.phase,
    event: undefined,
    clocks: boundary.clocks,
    shipPosition: boundary.phase.startPosition,
    shipVelocity: boundary.phase.startVelocity,
    view: undefined,
    provenance: undefined,
    uncertainty: undefined,
  });
}

function eventIndexAtCoordinateTime(
  timeline: MultiLegJourneyTimeline,
  coordinateTime: number,
): number | undefined {
  const candidates = timeline.events
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) => Math.abs(event.coordinateTime.value - coordinateTime) <= EPSILON_SECONDS,
    );
  const ending = candidates.filter(({ event }) => {
    const phase = timeline.phases.find(
      (candidatePhase) =>
        candidatePhase.stepIndex === event.stepIndex && candidatePhase.kind === event.phase,
    );
    return (
      phase !== undefined &&
      phase.endCoordinateTime.value > phase.startCoordinateTime.value &&
      Math.abs(phase.endCoordinateTime.value - coordinateTime) <= EPSILON_SECONDS
    );
  });
  return (ending.length > 0 ? ending : candidates).at(-1)?.index;
}

function nearestEventIndex(
  timeline: MultiLegJourneyTimeline,
  coordinateTime: number,
): number | undefined {
  let nearestIndex: number | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  timeline.events.forEach((event, index) => {
    const distance = Math.abs(event.coordinateTime.value - coordinateTime);
    if (distance <= nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

/**
 * Selects an exact model-emitted Journey event by its stable timeline index.
 *
 * @param timeline - Complete Journey Timeline emitted by the Journey Model.
 * @param eventIndex - Zero-based index into the model-emitted event list.
 * @returns The exact event state, its phase, and model-provided cumulative clocks.
 */
export function scrubJourneyEvent(
  timeline: MultiLegJourneyTimeline,
  eventIndex: number,
): SystemExplorerJourneyScrub {
  const index = Math.max(0, Math.min(timeline.events.length - 1, Math.trunc(eventIndex)));
  const event = timeline.events[index];
  if (event === undefined) {
    return emptyJourneyScrub(timeline);
  }
  const phaseIndex = phaseIndexForTime(timeline, event.coordinateTime.value, event);
  return Object.freeze({
    coordinateTime: event.coordinateTime,
    relativeCoordinateTime: seconds(
      event.coordinateTime.value - timeline.departureCoordinateTime.value,
    ),
    eventIndex: index,
    phaseIndex,
    phase: phaseIndex === undefined ? undefined : timeline.phases[phaseIndex],
    event,
    clocks: event.clocks,
    shipPosition: event.position,
    shipVelocity: event.velocity,
    view: undefined,
    provenance: undefined,
    uncertainty: undefined,
  });
}

function scrubJourneySample(sample: JourneySample): SystemExplorerJourneyScrub {
  return Object.freeze({
    coordinateTime: sample.coordinateTime,
    relativeCoordinateTime: sample.clocks.clusterCoordinateTime,
    eventIndex: sample.eventIndex,
    phaseIndex: sample.phaseIndex,
    phase: sample.phase,
    event: sample.event,
    clocks: sample.clocks,
    shipPosition: sample.shipPosition,
    shipVelocity: sample.shipVelocity,
    view: sample.view,
    provenance: sample.provenance,
    uncertainty: sample.uncertainty,
  });
}

/**
 * Selects the nearest exact model-emitted event or phase boundary.
 *
 * Interior requests snap to the nearest model event; no clock, position, velocity, or transfer
 * state is interpolated in the projection layer.
 *
 * @param timeline - Complete Journey Timeline emitted by the Journey Model.
 * @param coordinateTime - Absolute Scenario time to inspect.
 * @returns A discrete model state with exact cumulative clocks.
 */
export function scrubJourneyTimeline(
  timeline: MultiLegJourneyTimeline,
  coordinateTime: Seconds | number,
): SystemExplorerJourneyScrub {
  const lower = timeline.departureCoordinateTime.value;
  const upper = Math.max(lower, timeline.arrivalCoordinateTime.value);
  const requested = coordinateValue(coordinateTime);
  const value = Number.isFinite(requested) ? Math.max(lower, Math.min(upper, requested)) : lower;
  const exactEventIndex = eventIndexAtCoordinateTime(timeline, value);
  if (exactEventIndex !== undefined) {
    return scrubJourneyEvent(timeline, exactEventIndex);
  }
  const nearestIndex = nearestEventIndex(timeline, value);
  if (nearestIndex !== undefined) {
    return scrubJourneyEvent(timeline, nearestIndex);
  }
  return scrubJourneyBoundary(timeline, nearestPhaseBoundary(timeline, value));
}

function addAncestors(
  scenario: CompiledScenario,
  anchorId: StableId,
  selected: Set<StableId>,
): void {
  let current: StableId | undefined = anchorId;
  const visited = new Set<StableId>();
  while (current !== undefined && !visited.has(current)) {
    visited.add(current);
    const anchor = scenario.index.orbitalAnchors.get(current);
    if (anchor === undefined) {
      return;
    }
    selected.add(anchor.id);
    current = anchor.parentId;
  }
}

function routeGateIds(
  scenario: CompiledScenario,
  timeline: MultiLegJourneyTimeline | undefined,
  systemId: StableId,
  selectedGateIds: readonly StableId[],
): readonly StableId[] {
  const ids = new Set<StableId>();
  for (const gateId of selectedGateIds) {
    const gate = scenario.index.gates.get(gateId);
    if (gate?.systemId === systemId) {
      ids.add(gateId);
    }
  }
  if (timeline !== undefined) {
    for (const phase of timeline.phases) {
      for (const gateId of [phase.departureGateId, phase.destinationGateId]) {
        const gate = scenario.index.gates.get(gateId);
        if (gate?.systemId === systemId) {
          ids.add(gateId);
        }
      }
    }
  }
  return Object.freeze([...ids]);
}

function worldlineForAnchor(
  worldlines: readonly OrbitalAnchorWorldline[],
  id: StableId,
): OrbitalAnchorWorldline | undefined {
  return worldlines.find((worldline) => worldline.id === id);
}

function worldlineForGate(
  worldlines: readonly GateWorldline[],
  id: StableId,
): GateWorldline | undefined {
  return worldlines.find((worldline) => worldline.id === id);
}

function transferBelongsToSystem(
  phase: MultiLegJourneyPhase,
  scenario: CompiledScenario,
  systemId: StableId,
): boolean {
  return (
    phase.kind === "in-system-transfer" &&
    scenario.index.gates.get(phase.departureGateId)?.systemId === systemId &&
    scenario.index.gates.get(phase.destinationGateId)?.systemId === systemId
  );
}

function transferPhaseForSystem(
  timeline: MultiLegJourneyTimeline | undefined,
  activeJourney: SystemExplorerJourneyScrub | undefined,
  scenario: CompiledScenario,
  systemId: StableId,
): MultiLegJourneyPhase | undefined {
  const transferPhases =
    timeline?.phases.filter((phase) => transferBelongsToSystem(phase, scenario, systemId)) ?? [];
  const activePhase = activeJourney?.phase;
  if (activePhase !== undefined && transferBelongsToSystem(activePhase, scenario, systemId)) {
    return activePhase;
  }
  const coordinateTime = activeJourney?.coordinateTime.value;
  if (coordinateTime !== undefined) {
    const startedTransfer = transferPhases.filter(
      (phase) => phase.startCoordinateTime.value <= coordinateTime + EPSILON_SECONDS,
    );
    return startedTransfer.at(-1) ?? transferPhases[0];
  }
  return transferPhases[0];
}

function bodyForAnchor(
  anchor: CompiledOrbitalAnchor,
  worldline: OrbitalAnchorWorldline,
  transform: SystemViewScaleTransform,
  selected: boolean,
): SystemExplorerBody {
  const position = worldlinePosition(worldline);
  const velocity = worldlineVelocity(worldline);
  return Object.freeze({
    id: anchor.id,
    entityKind: "orbital-anchor" as const,
    name: anchor.name,
    designation: anchor.designation,
    systemId: anchor.systemId,
    parentId: anchor.parentId,
    orbitalAnchorId: undefined,
    selected,
    worldline,
    position: transform.toViewPosition(position),
    positionMeters: numericPosition(position),
    velocityMetersPerSecond: numericVelocity(velocity),
    provenance: provenanceSummary(anchor),
  });
}

function bodyForGate(
  gate: CompiledGate,
  worldline: GateWorldline,
  transform: SystemViewScaleTransform,
  selected: boolean,
): SystemExplorerBody {
  const position = worldlinePosition(worldline);
  const velocity = worldlineVelocity(worldline);
  return Object.freeze({
    id: gate.id,
    entityKind: "gate" as const,
    name: gate.name,
    designation: gate.designation,
    systemId: gate.systemId,
    parentId: undefined,
    orbitalAnchorId: gate.orbitalAnchorId,
    selected,
    worldline,
    position: transform.toViewPosition(position),
    positionMeters: numericPosition(position),
    velocityMetersPerSecond: numericVelocity(velocity),
    provenance: provenanceSummary(gate),
  });
}

function orbitForBody(
  model: SystemExplorerWorldlineModel,
  scenario: CompiledScenario,
  body: CompiledOrbitalAnchor | CompiledGate,
  transform: SystemViewScaleTransform,
  coordinateTime: number,
  sampleCount: number,
): SystemExplorerOrbit | undefined {
  const entityKind = "orbitalAnchorId" in body ? "gate" : "orbital-anchor";
  if (body.orbitalElements === undefined || sampleCount < 2) {
    return undefined;
  }
  const count = Math.max(2, Math.min(256, Math.trunc(sampleCount)));
  const start = coordinateTime - ORBIT_SAMPLE_WINDOW_SECONDS / 2;
  const points: SystemExplorerVector3[] = [];
  const worldPositionsMeters: SystemExplorerVector3[] = [];
  const sampleCoordinateTimes: Seconds[] = [];
  for (let index = 0; index < count; index += 1) {
    const sampleTime = start + (ORBIT_SAMPLE_WINDOW_SECONDS * index) / (count - 1);
    const worldlines = model.evaluateWorldlines(scenario, seconds(sampleTime));
    if (!worldlines.ok) {
      continue;
    }
    const state =
      entityKind === "gate"
        ? worldlineForGate(worldlines.gates, body.id)
        : worldlineForAnchor(worldlines.orbitalAnchors, body.id);
    if (state === undefined) {
      continue;
    }
    const position = worldlinePosition(state);
    points.push(transform.toViewPosition(position));
    worldPositionsMeters.push(numericPosition(position));
    sampleCoordinateTimes.push(seconds(sampleTime));
  }
  if (points.length < 2) {
    return undefined;
  }
  return Object.freeze({
    bodyId: body.id,
    parentId: "orbitalAnchorId" in body ? body.orbitalAnchorId : body.parentId,
    entityKind,
    points: Object.freeze(points),
    worldPositionsMeters: Object.freeze(worldPositionsMeters),
    sampleCoordinateTimes: Object.freeze(sampleCoordinateTimes),
  });
}

function nestedRelationships(
  anchors: readonly SystemExplorerBody[],
): readonly SystemExplorerNestedOrbitRelationship[] {
  const byId = new Map(anchors.map((anchor) => [anchor.id, anchor]));
  return Object.freeze(
    anchors
      .filter((anchor) => anchor.parentId !== undefined && byId.has(anchor.parentId))
      .map((anchor) => {
        const parent = byId.get(anchor.parentId as StableId);
        if (parent === undefined) {
          throw new Error(`Missing rendered parent ${String(anchor.parentId)}.`);
        }
        return Object.freeze({
          parentId: parent.id,
          childId: anchor.id,
          parentPosition: parent.position,
          childPosition: anchor.position,
        });
      }),
  );
}

function gateRelationships(
  anchors: readonly SystemExplorerBody[],
  gates: readonly SystemExplorerBody[],
): readonly SystemExplorerGateOrbitRelationship[] {
  const byId = new Map(anchors.map((anchor) => [anchor.id, anchor]));
  return Object.freeze(
    gates
      .filter((gate) => gate.orbitalAnchorId !== undefined && byId.has(gate.orbitalAnchorId))
      .map((gate) => {
        const anchor = byId.get(gate.orbitalAnchorId as StableId);
        if (anchor === undefined || gate.orbitalAnchorId === undefined) {
          throw new Error(`Missing rendered Gate anchor for ${gate.id}.`);
        }
        return Object.freeze({
          gateId: gate.id,
          orbitalAnchorId: gate.orbitalAnchorId,
          anchorPosition: anchor.position,
          gatePosition: gate.position,
        });
      }),
  );
}

function transferEvent(
  event: NonNullable<MultiLegJourneyTimeline["legs"][number]["timeline"]> extends never
    ? never
    : {
        readonly kind: "departure" | "acceleration-end" | "coast-start" | "flip" | "arrival";
        readonly phase: "acceleration" | "coast" | "braking";
        readonly clocks: JourneyClockReading;
        readonly cumulativeClusterCoordinateTime: Seconds;
        readonly position: PositionVector;
        readonly velocity: VelocityVector;
      },
  transferStart: number,
  transform: SystemViewScaleTransform,
): SystemExplorerTransferEvent {
  return Object.freeze({
    kind: event.kind,
    phase: event.phase,
    coordinateTime: seconds(transferStart + event.cumulativeClusterCoordinateTime.value),
    position: event.position,
    velocity: event.velocity,
    positionView: transform.toViewPosition(event.position),
    velocityMetersPerSecond: numericVelocity(event.velocity),
  });
}

function transferSegment(
  phase: NonNullable<MultiLegJourneyPhase["transfer"]>["phases"][number],
  transferStart: number,
  transform: SystemViewScaleTransform,
): SystemExplorerTransferSegment {
  const startPosition = transform.toViewPosition(phase.startPosition);
  const endPosition = transform.toViewPosition(phase.endPosition);
  return Object.freeze({
    kind: phase.kind,
    startCoordinateTime: seconds(transferStart + phase.start.clusterCoordinateTime.value),
    endCoordinateTime: seconds(transferStart + phase.end.clusterCoordinateTime.value),
    startPosition,
    endPosition,
    startPositionMeters: numericPosition(phase.startPosition),
    endPositionMeters: numericPosition(phase.endPosition),
    startVelocityMetersPerSecond: numericVelocity(phase.startVelocity),
    endVelocityMetersPerSecond: numericVelocity(phase.endVelocity),
  });
}

function buildTransferTrajectory(
  phase: MultiLegJourneyPhase,
  transform: SystemViewScaleTransform,
  coordinateTime: number,
): SystemExplorerTransferTrajectory | undefined {
  const transfer = phase.transfer;
  if (transfer === undefined) {
    return undefined;
  }
  const transferStart = phase.startCoordinateTime.value;
  const segments = transfer.phases.map((candidate) =>
    transferSegment(candidate, transferStart, transform),
  );
  const activeSegment = [...segments]
    .reverse()
    .find(
      (segment) =>
        coordinateTime >= segment.startCoordinateTime.value - EPSILON_SECONDS &&
        coordinateTime <= segment.endCoordinateTime.value + EPSILON_SECONDS,
    );
  const destinationPosition = transfer.destinationPosition;
  return Object.freeze({
    kind: "in-system-transfer" as const,
    departureGateId: phase.departureGateId,
    destinationGateId: phase.destinationGateId,
    startCoordinateTime: phase.startCoordinateTime,
    endCoordinateTime: phase.endCoordinateTime,
    peakSpeed: transfer.peakSpeed.value,
    coastSpeed: transfer.coastSpeed?.value,
    hasCoast: transfer.coastSpeed !== undefined,
    segments: Object.freeze(segments),
    activeSegment,
    destinationIntercept: Object.freeze({
      coordinateTime: transfer.arrivalCoordinateTime,
      position: destinationPosition,
      velocity: transfer.destinationVelocity,
      positionView: transform.toViewPosition(destinationPosition),
      velocityMetersPerSecond: numericVelocity(transfer.destinationVelocity),
    }),
    events: Object.freeze(
      transfer.events.map((event) => transferEvent(event, transferStart, transform)),
    ),
  });
}

function emptyScene(
  scenario: CompiledScenario,
  systemId: StableId,
  coordinateTime: Seconds,
  systemName: string,
  transform: SystemViewScaleTransform,
  journey: MultiLegJourneyTimeline | undefined,
  phases: readonly SystemExplorerPhaseDescription[],
  activeJourney: SystemExplorerJourneyScrub | undefined,
  issues: readonly WorldlineIssue[],
): SystemExplorerScene {
  return Object.freeze({
    kind: "system" as const,
    scenarioId: scenario.id,
    systemId,
    systemName,
    coordinateTime: coordinateTime.value,
    coordinateTimeQuantity: coordinateTime,
    scale: transform,
    orbitalAnchors: Object.freeze([]),
    gates: Object.freeze([]),
    entities: Object.freeze([]),
    orbits: Object.freeze([]),
    nestedOrbitRelationships: Object.freeze([]),
    gateOrbitRelationships: Object.freeze([]),
    journey,
    phases,
    activeJourney,
    shipPosition: activeJourney?.shipPosition,
    shipVelocity: activeJourney?.shipVelocity,
    trajectory: undefined,
    issues: Object.freeze([...issues]),
  });
}

/**
 * Builds the model-backed AU-scale scene for one selected System.
 *
 * The projection calls `evaluateWorldlines` for the active epoch and for orbit samples. It never
 * solves an orbit, predicts a Gate, or recomputes transfer timing in UI code. Only Gates on the
 * supplied Journey (or explicitly selected Gates when no Journey exists) and their ancestor
 * Orbital Anchors are included, so unrelated generated scenery remains absent.
 *
 * @param options - Model, Scenario, selected System, epoch, Journey, and selected Gates.
 * @returns An immutable local scene with model states, orbit relationships, phase descriptions,
 * transfer geometry, and numerical diagnostics.
 */
export function buildSystemExplorerScene(
  options: BuildSystemExplorerSceneOptions,
): SystemExplorerScene {
  const system = options.scenario.index.systems.get(options.systemId);
  const fallbackTime = options.scenario.epoch.coordinateTime.value;
  const requestedCoordinateTime = finiteCoordinate(options.coordinateTime, fallbackTime);
  const journey = timelineForJourney(options.journey);
  const phases =
    journey === undefined
      ? Object.freeze([])
      : Object.freeze(journey.phases.map((phase) => describeJourneyPhase(phase, journey)));
  const activeJourney =
    options.journeySample !== undefined
      ? scrubJourneySample(options.journeySample)
      : journey === undefined
        ? undefined
        : options.timelineEventIndex === undefined
          ? scrubJourneyTimeline(journey, requestedCoordinateTime)
          : scrubJourneyEvent(journey, options.timelineEventIndex);
  const coordinateTime = activeJourney?.coordinateTime ?? requestedCoordinateTime;
  const origin =
    system?.positionAtEpoch ??
    ({
      x: { value: 0, unit: "m" },
      y: { value: 0, unit: "m" },
      z: { value: 0, unit: "m" },
    } as PositionVector);
  const transform = createSystemViewScaleTransform(origin, coordinateTime);
  if (system === undefined) {
    return emptyScene(
      options.scenario,
      options.systemId,
      coordinateTime,
      options.systemId,
      transform,
      journey,
      phases,
      activeJourney,
      [],
    );
  }

  let worldlines: ScenarioWorldlineResult;
  try {
    worldlines = options.model.evaluateWorldlines(options.scenario, coordinateTime);
  } catch (error) {
    const issue = {
      code: "non-finite-worldline" as const,
      path: "worldlines",
      message:
        error instanceof Error ? error.message : "The Journey Model worldline evaluator failed.",
      entityType: "orbital-anchor" as const,
      entityId: options.scenario.orbitalAnchors[0]?.id ?? system.id,
    };
    return emptyScene(
      options.scenario,
      system.id,
      coordinateTime,
      system.name,
      transform,
      journey,
      phases,
      activeJourney,
      [issue],
    );
  }
  if (!worldlines.ok) {
    return emptyScene(
      options.scenario,
      system.id,
      coordinateTime,
      system.name,
      transform,
      journey,
      phases,
      activeJourney,
      worldlines.issues,
    );
  }

  const selectedIds = new Set(options.selectedGateIds ?? []);
  const gateIds = routeGateIds(options.scenario, journey, system.id, [...selectedIds]);
  const anchorIds = new Set<StableId>();
  for (const gateId of gateIds) {
    const gate = options.scenario.index.gates.get(gateId);
    if (gate !== undefined) {
      addAncestors(options.scenario, gate.orbitalAnchorId, anchorIds);
    }
  }
  const anchors = options.scenario.orbitalAnchors
    .filter((anchor) => anchor.systemId === system.id && anchorIds.has(anchor.id))
    .flatMap((anchor) => {
      const state = worldlineForAnchor(worldlines.orbitalAnchors, anchor.id);
      return state === undefined ? [] : [bodyForAnchor(anchor, state, transform, false)];
    });
  const gates = options.scenario.gates
    .filter((gate) => gate.systemId === system.id && gateIds.includes(gate.id))
    .flatMap((gate) => {
      const state = worldlineForGate(worldlines.gates, gate.id);
      return state === undefined
        ? []
        : [bodyForGate(gate, state, transform, selectedIds.has(gate.id))];
    });
  const anchorBodies = Object.freeze(anchors);
  const gateBodies = Object.freeze(gates);
  const entities = Object.freeze([...anchorBodies, ...gateBodies]);
  const orbits = Object.freeze(
    [
      ...options.scenario.orbitalAnchors
        .filter((anchor) => anchorIds.has(anchor.id))
        .map((anchor) =>
          orbitForBody(
            options.model,
            options.scenario,
            anchor,
            transform,
            coordinateTime.value,
            options.orbitSampleCount ?? DEFAULT_ORBIT_SAMPLE_COUNT,
          ),
        ),
      ...options.scenario.gates
        .filter((gate) => gateIds.includes(gate.id))
        .map((gate) =>
          orbitForBody(
            options.model,
            options.scenario,
            gate,
            transform,
            coordinateTime.value,
            options.orbitSampleCount ?? DEFAULT_ORBIT_SAMPLE_COUNT,
          ),
        ),
    ].filter((orbit): orbit is SystemExplorerOrbit => orbit !== undefined),
  );
  const transferPhase = transferPhaseForSystem(journey, activeJourney, options.scenario, system.id);
  const trajectory =
    transferPhase === undefined
      ? undefined
      : buildTransferTrajectory(transferPhase, transform, coordinateTime.value);
  return Object.freeze({
    kind: "system" as const,
    scenarioId: options.scenario.id,
    systemId: system.id,
    systemName: system.name,
    coordinateTime: coordinateTime.value,
    coordinateTimeQuantity: coordinateTime,
    scale: transform,
    orbitalAnchors: anchorBodies,
    gates: gateBodies,
    entities,
    orbits,
    nestedOrbitRelationships: nestedRelationships(anchorBodies),
    gateOrbitRelationships: gateRelationships(anchorBodies, gateBodies),
    journey,
    phases,
    activeJourney,
    shipPosition:
      options.journeySample?.view === "cluster" ? undefined : activeJourney?.shipPosition,
    shipVelocity:
      options.journeySample?.view === "cluster" ? undefined : activeJourney?.shipVelocity,
    trajectory,
    issues: Object.freeze([]),
  });
}

function pointColor(body: SystemExplorerBody): readonly [number, number, number, number] {
  if (body.selected) {
    return Object.freeze([1, 1, 1, 1]) as readonly [number, number, number, number];
  }
  return body.entityKind === "gate"
    ? (Object.freeze([0.96, 0.75, 0.34, 1]) as readonly [number, number, number, number])
    : (Object.freeze([0.54, 0.88, 0.76, 0.98]) as readonly [number, number, number, number]);
}

function lineColor(
  kind: "orbit" | "relationship" | "acceleration" | "coast" | "braking" | "intercept",
): readonly [number, number, number, number] {
  switch (kind) {
    case "orbit":
      return Object.freeze([0.35, 0.68, 0.68, 0.48]) as readonly [number, number, number, number];
    case "relationship":
      return Object.freeze([0.55, 0.65, 0.7, 0.62]) as readonly [number, number, number, number];
    case "acceleration":
      return Object.freeze([0.35, 0.84, 0.98, 0.98]) as readonly [number, number, number, number];
    case "coast":
      return Object.freeze([0.96, 0.78, 0.36, 0.98]) as readonly [number, number, number, number];
    case "braking":
      return Object.freeze([0.98, 0.46, 0.5, 0.98]) as readonly [number, number, number, number];
    case "intercept":
      return Object.freeze([1, 1, 1, 0.92]) as readonly [number, number, number, number];
  }
}

function line(
  from: SystemExplorerVector3,
  to: SystemExplorerVector3,
  color: readonly [number, number, number, number],
): WebGpuRenderLine {
  return Object.freeze({ from, to, color });
}

function hasRenderableExtent(value: WebGpuRenderLine): boolean {
  return (
    Math.hypot(
      value.from[0] - value.to[0],
      value.from[1] - value.to[1],
      value.from[2] - value.to[2],
    ) > 1e-9
  );
}

/**
 * Converts a System scene into points and lines for the existing injected WebGPU renderer.
 *
 * @param scene - Model-backed AU-scale System scene.
 * @returns Render data containing selected bodies, nested relationships, sampled orbits, and exact
 * transfer event markers. No line segment is inferred between transfer events.
 */
export function buildSystemWebGpuRenderScene(scene: SystemExplorerScene): WebGpuRenderScene {
  const points: WebGpuRenderPoint[] = scene.entities.map((body) =>
    Object.freeze({ position: body.position, color: pointColor(body) }),
  );
  const connections: WebGpuRenderLine[] = [];
  for (const orbit of scene.orbits) {
    for (let index = 1; index < orbit.points.length; index += 1) {
      const previous = orbit.points[index - 1];
      const current = orbit.points[index];
      if (previous !== undefined && current !== undefined) {
        connections.push(line(previous, current, lineColor("orbit")));
      }
    }
  }
  for (const relationship of scene.nestedOrbitRelationships) {
    connections.push(
      line(relationship.parentPosition, relationship.childPosition, lineColor("relationship")),
    );
  }
  for (const relationship of scene.gateOrbitRelationships) {
    connections.push(
      line(relationship.anchorPosition, relationship.gatePosition, lineColor("relationship")),
    );
  }
  if (scene.shipPosition !== undefined) {
    points.push(
      Object.freeze({
        position: scene.scale.toViewPosition(scene.shipPosition),
        color: Object.freeze([0.98, 0.98, 1, 1]) as readonly [number, number, number, number],
      }),
    );
  }
  const trajectory = scene.trajectory;
  if (trajectory !== undefined) {
    points.push(
      Object.freeze({
        position: trajectory.destinationIntercept.positionView,
        color: lineColor("intercept"),
      }),
      ...trajectory.events.map((event) =>
        Object.freeze({ position: event.positionView, color: lineColor(event.phase) }),
      ),
    );
  }
  return Object.freeze({
    points: Object.freeze(points),
    connections: Object.freeze(connections.filter(hasRenderableExtent)),
  });
}

/**
 * Projects a world position into the selected System's AU view.
 *
 * @param transform - Independent System scale transform.
 * @param position - Cluster-frame position emitted by the Journey Model.
 * @returns Local AU coordinates.
 */
export function projectSystemPosition(
  transform: SystemViewScaleTransform,
  position: PositionVector,
): SystemExplorerVector3 {
  return transform.toViewPosition(position);
}

/**
 * Returns the physical distance between two local System-view positions in metres.
 *
 * @param left - First local position in AU.
 * @param right - Second local position in AU.
 * @returns Euclidean distance in metres.
 */
export function systemViewDistanceMeters(
  left: SystemExplorerVector3,
  right: SystemExplorerVector3,
): number {
  return distanceBetween(left, right) * ASTRONOMICAL_UNIT_METERS;
}
