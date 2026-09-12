import type {
  CompiledGate,
  CompiledGateConnection,
  CompiledScenario,
  CompiledSystem,
  Provenance,
  ProvenanceKind,
  StableId,
} from "../src/index";
import { provenanceKinds } from "./planning";

/**
 * A three-dimensional point in the normalized Cluster view coordinate space.
 */
export type ExplorerVector3 = readonly [number, number, number];

/**
 * The entity categories that can be rendered or inspected in the Cluster view.
 */
export type ExplorerEntityKind = "system" | "gate";

/**
 * The role a selected Gate can fill in the shared Journey-planning selection.
 */
export type ExplorerGateRole = "departure" | "destination";

/**
 * Provenance information shown beside a Cluster entity.
 */
export type ExplorerProvenanceSummary = {
  readonly primaryKind: ProvenanceKind;
  readonly kinds: readonly ProvenanceKind[];
  readonly authorities: readonly string[];
  readonly notes: readonly string[];
  readonly citations: readonly string[];
};

/**
 * A searchable System or Gate prepared for Cluster rendering.
 */
export type ExplorerPoint = {
  readonly id: StableId;
  readonly entityKind: ExplorerEntityKind;
  readonly name: string;
  readonly designation: string;
  readonly systemId: StableId;
  readonly orbitalAnchorId: StableId | undefined;
  readonly position: ExplorerVector3;
  readonly positionMeters: ExplorerVector3;
  readonly provenance: ExplorerProvenanceSummary;
};

/**
 * A Gate Connection prepared for line rendering and provenance inspection.
 *
 * The connection identifies paired Gates only. It does not represent a zero-duration movement;
 * the existing Journey Model supplies the Interstellar Cruise between the paired endpoints.
 */
export type ExplorerConnection = {
  readonly id: StableId;
  readonly name: string;
  readonly designation: string;
  readonly gateAId: StableId;
  readonly gateBId: StableId;
  readonly endpoints: readonly [ExplorerVector3, ExplorerVector3];
  readonly provenance: ExplorerProvenanceSummary;
};

/**
 * The immutable scene model consumed by the WebGPU renderer and interaction controller.
 */
export type ClusterExplorerScene = {
  readonly scenarioId: StableId;
  readonly coordinateTime: number;
  readonly extentMeters: number;
  readonly systems: readonly ExplorerPoint[];
  readonly gates: readonly ExplorerPoint[];
  readonly entities: readonly ExplorerPoint[];
  readonly connections: readonly ExplorerConnection[];
};

/**
 * The single selection state shared by the Cluster explorer and Journey planner controls.
 */
export type ExplorerSelection = {
  readonly departureGateId: StableId | undefined;
  readonly destinationGateId: StableId | undefined;
  readonly focusedEntityId: StableId | undefined;
  readonly selectedEntityId: StableId | undefined;
};

/**
 * Camera state for the responsive orbit, zoom, pan, and focus controls.
 */
export type CameraState = {
  readonly target: ExplorerVector3;
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  /** Far clipping distance for linked views with a wider local extent, when supplied. */
  readonly far: number | undefined;
};

/**
 * A viewport used by pointer picking and projection helpers.
 */
export type ExplorerViewport = {
  readonly width: number;
  readonly height: number;
};

/**
 * A point projected into canvas pixel coordinates.
 */
export type ProjectedExplorerPoint = {
  readonly x: number;
  readonly y: number;
  readonly depth: number;
  readonly visible: boolean;
};

/**
 * Pointer state used to distinguish a click from a cumulative camera drag.
 */
export type ExplorerPointerGesture = {
  readonly pointerId: number;
  readonly originX: number;
  readonly originY: number;
  readonly x: number;
  readonly y: number;
  readonly moved: boolean;
  readonly pan: boolean;
};

/**
 * Total pointer displacement that changes a canvas interaction from click to drag.
 */
export const EXPLORER_POINTER_DRAG_THRESHOLD = 3;

/**
 * Starts a deterministic pointer gesture at its origin.
 */
export function beginExplorerPointerGesture(
  pointerId: number,
  x: number,
  y: number,
  pan: boolean,
): ExplorerPointerGesture {
  return Object.freeze({
    pointerId,
    originX: x,
    originY: y,
    x,
    y,
    moved: false,
    pan,
  });
}

/**
 * Accumulates movement against the original pointer-down position.
 */
export function moveExplorerPointerGesture(
  gesture: ExplorerPointerGesture,
  x: number,
  y: number,
): ExplorerPointerGesture {
  return Object.freeze({
    ...gesture,
    x,
    y,
    moved:
      gesture.moved ||
      Math.hypot(x - gesture.originX, y - gesture.originY) > EXPLORER_POINTER_DRAG_THRESHOLD,
  });
}

/**
 * Reports whether a pointer-up may perform a normal click pick.
 */
export function shouldPickExplorerPointerUp(
  gesture: ExplorerPointerGesture | undefined,
  pointerId: number,
  cancelled: boolean,
): boolean {
  return cancelled !== true && gesture?.pointerId === pointerId && gesture.moved !== true;
}

const CAMERA_MIN_DISTANCE = 0.08;
const CAMERA_MAX_DISTANCE = 20;
const CAMERA_MAX_PITCH = Math.PI / 2 - 0.05;
const DEFAULT_CAMERA_DISTANCE = 3.2;
const DEFAULT_CAMERA_YAW = Math.PI / 4;
const DEFAULT_CAMERA_PITCH = 0.36;

function vector(x: number, y: number, z: number): ExplorerVector3 {
  return Object.freeze([x, y, z]) as ExplorerVector3;
}

function finiteVector(position: {
  readonly x: { readonly value: number };
  readonly y: { readonly value: number };
  readonly z: { readonly value: number };
}): ExplorerVector3 {
  return vector(position.x.value, position.y.value, position.z.value);
}

function magnitude(position: ExplorerVector3): number {
  return Math.hypot(position[0], position[1], position[2]);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values.filter((value) => value.length > 0))].sort());
}

function provenanceSummary(entity: {
  readonly canonicalIdentity: { readonly provenance: Provenance };
  readonly provenance: Provenance;
  readonly properties: Readonly<Record<string, { readonly provenance: Provenance }>>;
}): ExplorerProvenanceSummary {
  const records = [entity.canonicalIdentity.provenance, entity.provenance];
  records.push(...Object.values(entity.properties).map((property) => property.provenance));
  const kinds = uniqueStrings(records.map((record) => record.kind)) as readonly ProvenanceKind[];
  const primaryKind = entity.canonicalIdentity.provenance.kind;
  const authorities = uniqueStrings(records.map((record) => record.authority));
  const notes = uniqueStrings(
    records.flatMap((record) => (record.note === undefined ? [] : [record.note])),
  );
  const citations = uniqueStrings(
    records.flatMap((record) =>
      record.citations.map((citation) => `${citation.source} · ${citation.locator}`),
    ),
  );
  return Object.freeze({ primaryKind, kinds, authorities, notes, citations });
}

function normalizedPosition(position: ExplorerVector3, extentMeters: number): ExplorerVector3 {
  return vector(position[0] / extentMeters, position[1] / extentMeters, position[2] / extentMeters);
}

function pointFromSystem(system: CompiledSystem, extentMeters: number): ExplorerPoint {
  const positionMeters = finiteVector(system.positionAtEpoch);
  return Object.freeze({
    id: system.id,
    entityKind: "system" as const,
    name: system.name,
    designation: system.designation,
    systemId: system.id,
    orbitalAnchorId: undefined,
    position: normalizedPosition(positionMeters, extentMeters),
    positionMeters,
    provenance: provenanceSummary(system),
  });
}

function pointFromGate(gate: CompiledGate, extentMeters: number): ExplorerPoint {
  const positionMeters = finiteVector(gate.positionAtEpoch);
  return Object.freeze({
    id: gate.id,
    entityKind: "gate" as const,
    name: gate.name,
    designation: gate.designation,
    systemId: gate.systemId,
    orbitalAnchorId: gate.orbitalAnchorId,
    position: normalizedPosition(positionMeters, extentMeters),
    positionMeters,
    provenance: provenanceSummary(gate),
  });
}

function connectionFromGatePair(
  connection: CompiledGateConnection,
  gates: ReadonlyMap<StableId, ExplorerPoint>,
): ExplorerConnection | undefined {
  const gateA = gates.get(connection.gateAId);
  const gateB = gates.get(connection.gateBId);
  if (gateA === undefined || gateB === undefined) {
    return undefined;
  }
  return Object.freeze({
    id: connection.id,
    name: connection.name,
    designation: connection.designation,
    gateAId: connection.gateAId,
    gateBId: connection.gateBId,
    endpoints: Object.freeze([gateA.position, gateB.position]) as ExplorerConnection["endpoints"],
    provenance: provenanceSummary(connection),
  });
}

function visible(point: ExplorerPoint, allowedKinds: readonly ProvenanceKind[]): boolean {
  if (allowedKinds.includes(point.provenance.primaryKind)) {
    return true;
  }
  return allowedKinds.includes("override") && point.provenance.kinds.includes("override");
}

function connectionVisible(
  connection: ExplorerConnection,
  allowedKinds: readonly ProvenanceKind[],
): boolean {
  if (allowedKinds.includes(connection.provenance.primaryKind)) {
    return true;
  }
  return allowedKinds.includes("override") && connection.provenance.kinds.includes("override");
}

/**
 * Builds the deterministic, normalized Cluster scene for a compiled Scenario.
 *
 * @param scenario - The canonical or currently materialized Scenario to display.
 * @param allowedKinds - Provenance categories that remain visible.
 * @returns An immutable scene with Systems, Gates, and paired Gate Connections.
 */
export function buildClusterExplorerScene(
  scenario: CompiledScenario,
  allowedKinds: readonly ProvenanceKind[] = provenanceKinds,
): ClusterExplorerScene {
  const allPositions = [
    ...scenario.systems.map((system) => finiteVector(system.positionAtEpoch)),
    ...scenario.gates.map((gate) => finiteVector(gate.positionAtEpoch)),
  ];
  const extentMeters = Math.max(1, ...allPositions.map(magnitude));
  const systems = scenario.systems
    .map((system) => pointFromSystem(system, extentMeters))
    .filter((point) => visible(point, allowedKinds));
  const gates = scenario.gates
    .map((gate) => pointFromGate(gate, extentMeters))
    .filter((point) => visible(point, allowedKinds));
  const gateMap = new Map(gates.map((gate) => [gate.id, gate]));
  const connections = scenario.gateConnections
    .map((connection) => connectionFromGatePair(connection, gateMap))
    .filter(
      (connection): connection is ExplorerConnection =>
        connection !== undefined && connectionVisible(connection, allowedKinds),
    );
  return Object.freeze({
    scenarioId: scenario.id,
    coordinateTime: scenario.epoch.coordinateTime.value,
    extentMeters,
    systems: Object.freeze(systems),
    gates: Object.freeze(gates),
    entities: Object.freeze([...systems, ...gates]),
    connections: Object.freeze(connections),
  });
}

function searchScore(point: ExplorerPoint, query: string): number | undefined {
  const values = [point.designation.toLocaleLowerCase(), point.name.toLocaleLowerCase(), point.id];
  const exact = values.findIndex((value) => value === query);
  if (exact >= 0) {
    return exact;
  }
  const prefix = values.findIndex((value) => value.startsWith(query));
  if (prefix >= 0) {
    return 10 + prefix;
  }
  const contains = values.findIndex((value) => value.includes(query));
  return contains >= 0 ? 20 + contains : undefined;
}

/**
 * Searches visible Systems and Gates by stable name, designation, or identifier.
 *
 * @param scene - The filtered Cluster scene to search.
 * @param query - User-entered name, designation, or stable identifier text.
 * @returns Stable, relevance-ordered matching entities.
 */
export function searchClusterExplorer(
  scene: ClusterExplorerScene,
  query: string,
): readonly ExplorerPoint[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length === 0) {
    return Object.freeze([...scene.entities]);
  }
  return Object.freeze(
    scene.entities
      .map((point, index) => ({ point, score: searchScore(point, normalized), index }))
      .filter(
        (
          entry,
        ): entry is {
          readonly point: ExplorerPoint;
          readonly score: number;
          readonly index: number;
        } => entry.score !== undefined,
      )
      .sort(
        (left, right) =>
          left.score - right.score ||
          left.point.designation.localeCompare(right.point.designation) ||
          left.index - right.index,
      )
      .map((entry) => entry.point),
  );
}

/**
 * Alias for callers that describe the operation as searching Explorer entities.
 *
 * @param scene - The filtered Cluster scene to search.
 * @param query - User-entered name, designation, or stable identifier text.
 * @returns Stable, relevance-ordered matching entities.
 */
export const searchExplorerEntities = searchClusterExplorer;

/**
 * Finds a rendered System or Gate by its stable identifier.
 *
 * @param scene - The Cluster scene to inspect.
 * @param entityId - Stable entity identifier.
 * @returns The matching point, or `undefined` when it is filtered or absent.
 */
export function findExplorerEntity(
  scene: ClusterExplorerScene,
  entityId: StableId | undefined,
): ExplorerPoint | undefined {
  if (entityId === undefined) {
    return undefined;
  }
  return scene.entities.find((entity) => entity.id === entityId);
}

/**
 * Lists Gate Connections associated with a System or Gate.
 *
 * @param scene - The Cluster scene to inspect.
 * @param entityId - Stable System or Gate identifier.
 * @returns Connections that remain visible under the active Provenance filter.
 */
export function connectionsForExplorerEntity(
  scene: ClusterExplorerScene,
  entityId: StableId,
): readonly ExplorerConnection[] {
  const entity = findExplorerEntity(scene, entityId);
  const gateIds =
    entity?.entityKind === "system"
      ? scene.gates.filter((gate) => gate.systemId === entity.systemId).map((gate) => gate.id)
      : entity?.entityKind === "gate"
        ? [entity.id]
        : [];
  return Object.freeze(
    scene.connections.filter(
      (connection) => gateIds.includes(connection.gateAId) || gateIds.includes(connection.gateBId),
    ),
  );
}

/**
 * Creates one shared selection state for the Cluster explorer and planner controls.
 *
 * @param departureGateId - Initial departure Gate, if one is available.
 * @param destinationGateId - Initial destination Gate, if one is available.
 * @returns An immutable selection state.
 */
export function createExplorerSelection(
  departureGateId: StableId | undefined,
  destinationGateId: StableId | undefined,
): ExplorerSelection {
  return Object.freeze({
    departureGateId,
    destinationGateId,
    focusedEntityId: undefined,
    selectedEntityId: undefined,
  });
}

/**
 * Keeps shared Gate selections valid after a Scenario or materialized region changes.
 *
 * @param selection - Current shared selection.
 * @param gates - Gate identities available to the active Scenario.
 * @returns A normalized immutable selection.
 */
export function normalizeExplorerSelection(
  selection: ExplorerSelection,
  gates: readonly { readonly id: StableId }[],
): ExplorerSelection {
  const first = gates[0]?.id;
  const last = gates.at(-1)?.id ?? first;
  const gateIds = new Set(gates.map((gate) => gate.id));
  return Object.freeze({
    ...selection,
    departureGateId:
      selection.departureGateId !== undefined && gateIds.has(selection.departureGateId)
        ? selection.departureGateId
        : first,
    destinationGateId:
      selection.destinationGateId !== undefined && gateIds.has(selection.destinationGateId)
        ? selection.destinationGateId
        : last,
  });
}

/**
 * Focuses and selects a System or Gate without changing Journey endpoint roles.
 *
 * @param selection - Current shared selection.
 * @param entityId - Stable entity identifier to inspect.
 * @returns Updated immutable selection.
 */
export function selectExplorerEntity(
  selection: ExplorerSelection,
  entityId: StableId,
): ExplorerSelection {
  return Object.freeze({ ...selection, focusedEntityId: entityId, selectedEntityId: entityId });
}

/**
 * Assigns a Gate to the departure or destination role while preserving one shared selection.
 *
 * @param selection - Current shared selection.
 * @param role - Planner endpoint role to update.
 * @param gateId - Stable Gate identifier.
 * @returns Updated immutable selection.
 */
export function selectExplorerGate(
  selection: ExplorerSelection,
  role: ExplorerGateRole,
  gateId: StableId,
): ExplorerSelection {
  return Object.freeze({
    ...selection,
    departureGateId: role === "departure" ? gateId : selection.departureGateId,
    destinationGateId: role === "destination" ? gateId : selection.destinationGateId,
    focusedEntityId: gateId,
    selectedEntityId: gateId,
  });
}

/**
 * Creates the initial Cluster camera.
 *
 * @param target - Optional normalized Cluster point to center.
 * @returns An immutable camera state.
 */
export function createCameraState(target: ExplorerVector3 | undefined): CameraState {
  return Object.freeze({
    target: target ?? vector(0, 0, 0),
    yaw: DEFAULT_CAMERA_YAW,
    pitch: DEFAULT_CAMERA_PITCH,
    distance: DEFAULT_CAMERA_DISTANCE,
    far: undefined,
  });
}

/**
 * Applies a pointer orbit delta while clamping the camera above and below the Cluster plane.
 *
 * @param camera - Current camera state.
 * @param deltaX - Horizontal pointer movement in pixels.
 * @param deltaY - Vertical pointer movement in pixels.
 * @returns Updated immutable camera state.
 */
export function orbitCamera(camera: CameraState, deltaX: number, deltaY: number): CameraState {
  return Object.freeze({
    ...camera,
    yaw: camera.yaw - deltaX * 0.008,
    pitch: Math.max(
      CAMERA_MAX_PITCH * -1,
      Math.min(CAMERA_MAX_PITCH, camera.pitch + deltaY * 0.008),
    ),
  });
}

/**
 * Applies a wheel zoom delta without allowing the camera to cross the target or leave the scene.
 *
 * @param camera - Current camera state.
 * @param deltaY - Pointer wheel delta.
 * @returns Updated immutable camera state.
 */
export function zoomCamera(camera: CameraState, deltaY: number): CameraState {
  return Object.freeze({
    ...camera,
    distance: Math.max(
      CAMERA_MIN_DISTANCE,
      Math.min(CAMERA_MAX_DISTANCE, camera.distance * Math.exp(deltaY * 0.001)),
    ),
  });
}

/**
 * Pans the camera target in normalized Cluster coordinates.
 *
 * @param camera - Current camera state.
 * @param deltaX - Horizontal pointer movement in pixels.
 * @param deltaY - Vertical pointer movement in pixels.
 * @returns Updated immutable camera state.
 */
export function panCamera(camera: CameraState, deltaX: number, deltaY: number): CameraState {
  const scale = camera.distance * 0.0015;
  return Object.freeze({
    ...camera,
    target: vector(
      camera.target[0] - deltaX * scale,
      camera.target[1] + deltaY * scale,
      camera.target[2],
    ),
  });
}

/**
 * Focuses the camera on a rendered entity while retaining a useful orbit distance.
 *
 * @param camera - Current camera state.
 * @param position - Normalized point to inspect.
 * @returns Updated immutable camera state.
 */
export function focusCameraOnPoint(camera: CameraState, position: ExplorerVector3): CameraState {
  return Object.freeze({
    ...camera,
    target: position,
    distance: Math.max(CAMERA_MIN_DISTANCE * 2, Math.min(camera.distance * 0.45, 2.8)),
  });
}

function subtract(left: ExplorerVector3, right: ExplorerVector3): ExplorerVector3 {
  return vector(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function dot(left: ExplorerVector3, right: ExplorerVector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: ExplorerVector3, right: ExplorerVector3): ExplorerVector3 {
  return vector(
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  );
}

function normalize(position: ExplorerVector3): ExplorerVector3 {
  const length = magnitude(position);
  return length === 0
    ? vector(0, 0, 0)
    : vector(position[0] / length, position[1] / length, position[2] / length);
}

function matrixValue(matrix: Float32Array, index: number): number {
  const value = matrix[index];
  if (value === undefined) {
    throw new Error(`Matrix index ${String(index)} is outside the 4x4 matrix.`);
  }
  return value;
}

function multiplyMatrices(left: Float32Array, right: Float32Array): Float32Array {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let inner = 0; inner < 4; inner += 1) {
        value += matrixValue(left, row + inner * 4) * matrixValue(right, inner + column * 4);
      }
      result[row + column * 4] = value;
    }
  }
  return result;
}

/**
 * Creates the column-major view-projection matrix shared by rendering and pointer picking.
 *
 * @param camera - Orbit camera state.
 * @param viewport - Canvas viewport dimensions.
 * @returns A column-major 4x4 matrix for WebGPU and screen projection.
 */
export function createExplorerViewProjectionMatrix(
  camera: CameraState,
  viewport: ExplorerViewport,
): Float32Array {
  const aspect = viewport.height <= 0 ? 1 : Math.max(0.1, viewport.width / viewport.height);
  const target = camera.target;
  const cameraPosition = vector(
    target[0] + camera.distance * Math.cos(camera.pitch) * Math.sin(camera.yaw),
    target[1] + camera.distance * Math.sin(camera.pitch),
    target[2] + camera.distance * Math.cos(camera.pitch) * Math.cos(camera.yaw),
  );
  const backward = normalize(subtract(cameraPosition, target));
  const right = normalize(cross(vector(0, 1, 0), backward));
  const up = cross(backward, right);
  const view = new Float32Array([
    right[0],
    up[0],
    backward[0],
    0,
    right[1],
    up[1],
    backward[1],
    0,
    right[2],
    up[2],
    backward[2],
    0,
    -dot(right, cameraPosition),
    -dot(up, cameraPosition),
    -dot(backward, cameraPosition),
    1,
  ]);
  const fieldOfView = Math.PI / 3;
  const near = 0.01;
  const far =
    camera.far === undefined || !Number.isFinite(camera.far) || camera.far <= near
      ? 100
      : camera.far;
  const f = 1 / Math.tan(fieldOfView / 2);
  const projection = new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    far / (near - far),
    -1,
    0,
    0,
    (far * near) / (near - far),
    0,
  ]);
  return multiplyMatrices(projection, view);
}

/**
 * Projects one normalized Cluster point into canvas pixels.
 *
 * @param point - Normalized scene point.
 * @param camera - Current camera state.
 * @param viewport - Canvas viewport dimensions.
 * @returns Pixel coordinates, depth, and visibility.
 */
export function projectExplorerPoint(
  point: ExplorerVector3,
  camera: CameraState,
  viewport: ExplorerViewport,
): ProjectedExplorerPoint {
  const matrix = createExplorerViewProjectionMatrix(camera, viewport);
  const clipX =
    matrixValue(matrix, 0) * point[0] +
    matrixValue(matrix, 4) * point[1] +
    matrixValue(matrix, 8) * point[2] +
    matrixValue(matrix, 12);
  const clipY =
    matrixValue(matrix, 1) * point[0] +
    matrixValue(matrix, 5) * point[1] +
    matrixValue(matrix, 9) * point[2] +
    matrixValue(matrix, 13);
  const clipZ =
    matrixValue(matrix, 2) * point[0] +
    matrixValue(matrix, 6) * point[1] +
    matrixValue(matrix, 10) * point[2] +
    matrixValue(matrix, 14);
  const clipW =
    matrixValue(matrix, 3) * point[0] +
    matrixValue(matrix, 7) * point[1] +
    matrixValue(matrix, 11) * point[2] +
    matrixValue(matrix, 15);
  if (clipW <= 0) {
    return Object.freeze({ x: 0, y: 0, depth: 1, visible: false });
  }
  const normalizedX = clipX / clipW;
  const normalizedY = clipY / clipW;
  const depth = clipZ / clipW;
  return Object.freeze({
    x: (normalizedX * 0.5 + 0.5) * viewport.width,
    y: (1 - (normalizedY * 0.5 + 0.5)) * viewport.height,
    depth,
    visible:
      depth >= 0 &&
      depth <= 1 &&
      normalizedX >= -1.1 &&
      normalizedX <= 1.1 &&
      normalizedY >= -1.1 &&
      normalizedY <= 1.1,
  });
}

/**
 * Selects the nearest visible rendered entity under a pointer location.
 *
 * @param scene - Filtered Cluster scene.
 * @param camera - Current camera state.
 * @param viewport - Canvas viewport dimensions.
 * @param x - Pointer x coordinate in canvas pixels.
 * @param y - Pointer y coordinate in canvas pixels.
 * @param radius - Maximum selection radius in pixels.
 * @returns The nearest System or Gate, or `undefined` when nothing is hit.
 */
export function pickExplorerEntity(
  scene: ClusterExplorerScene,
  camera: CameraState,
  viewport: ExplorerViewport,
  x: number,
  y: number,
  radius = 24,
): ExplorerPoint | undefined {
  const candidates = scene.entities
    .map((entity) => {
      const projected = projectExplorerPoint(entity.position, camera, viewport);
      const distance = Math.hypot(projected.x - x, projected.y - y);
      return { entity, projected, distance };
    })
    .filter((candidate) => candidate.projected.visible && candidate.distance <= radius)
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        (left.entity.entityKind === "gate" ? -1 : 1) -
          (right.entity.entityKind === "gate" ? -1 : 1) ||
        left.projected.depth - right.projected.depth,
    );
  return candidates[0]?.entity;
}
