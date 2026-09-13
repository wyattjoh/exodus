import { describe, expect, test } from "bun:test";

import {
  beginExplorerPointerGesture,
  buildClusterExplorerNeighborhood,
  buildClusterExplorerNeighborhoodAt,
  buildClusterExplorerScene,
  connectionsForExplorerEntity,
  createCameraState,
  createExplorerSelection,
  explorerFocusConnectionOpacity,
  explorerFocusPointOpacity,
  focusCameraOnNeighborhood,
  focusCameraOnPoint,
  interpolateCameraState,
  normalizeExplorerSelection,
  orbitCamera,
  pickExplorerEntity,
  moveExplorerPointerGesture,
  projectExplorerPoint,
  searchClusterExplorer,
  selectExplorerEntity,
  selectExplorerGate,
  shouldPickExplorerPointerUp,
  zoomCamera,
} from "../app/cluster-explorer";
import { generateClusterRegion, multiLegJourneyScenario } from "../src/index";
import { createJourneyModel } from "../src/index";
import { provenanceKinds } from "../app/planning";

function requireScenario(input: unknown) {
  const result = createJourneyModel().compileScenario(input);
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }
  return result.scenario;
}

describe("Cluster explorer scene and selection seam", () => {
  test("normalizes Systems, stars, Gates, and paired Gate Connections for stable search", () => {
    const scene = buildClusterExplorerScene(
      requireScenario(multiLegJourneyScenario),
      provenanceKinds,
    );

    expect(scene.systems.map((system) => system.designation).sort()).toEqual([
      "CEN-1001",
      "CEN-1002",
      "CEN-1003",
    ]);
    expect(scene.stars).toHaveLength(3);
    expect(scene.gates).toHaveLength(4);
    expect(scene.connections).toHaveLength(2);
    expect(searchClusterExplorer(scene, "CEN-1002").map((point) => point.id)).toEqual([
      "system:aurora",
      "anchor:aurora-star",
      "gate:aurora-entry",
      "gate:aurora-exit",
    ]);
    expect(
      connectionsForExplorerEntity(scene, "system:aurora")
        .map((connection) => connection.id)
        .sort(),
    ).toEqual(["connection:aurora-exit-helios", "connection:terra-aurora-entry"]);
    expect(
      connectionsForExplorerEntity(scene, "anchor:aurora-star")
        .map((connection) => connection.id)
        .sort(),
    ).toEqual(["connection:aurora-exit-helios", "connection:terra-aurora-entry"]);
    expect(scene.stars.find((star) => star.id === "anchor:aurora-star")).toMatchObject({
      id: "anchor:aurora-star",
      entityKind: "star",
      systemId: "system:aurora",
      orbitalAnchorId: "anchor:aurora-star",
    });
    expect(scene.connections[0]?.name).toContain("Link");
  });

  test("builds a bounded, selectable neighborhood around one materialized System", () => {
    const fullScene = buildClusterExplorerScene(
      requireScenario(multiLegJourneyScenario),
      provenanceKinds,
    );
    const neighborhood = buildClusterExplorerNeighborhood(fullScene, "system:aurora", 1);
    const camera = focusCameraOnNeighborhood(
      createCameraState(undefined),
      neighborhood,
      "system:aurora",
    );

    const focusedSystem = neighborhood.systems[0];
    if (focusedSystem === undefined) {
      throw new Error("Expected the focused System in its materialized neighborhood.");
    }
    expect(neighborhood.systems).toHaveLength(2);
    expect(focusedSystem.id).toBe("system:aurora");
    expect(neighborhood.entities).toEqual(neighborhood.systems);
    expect(neighborhood.stars).toEqual([]);
    expect(neighborhood.gates).toEqual([]);
    expect(neighborhood.connections).toEqual([]);
    expect(camera.target).toEqual(focusedSystem.position);
    expect(camera.distance).toBeGreaterThanOrEqual(0.18);
    expect(camera.distance).toBeLessThanOrEqual(1.6);
  });

  test("updates the bounded neighborhood around a moving camera target", () => {
    const generated = generateClusterRegion({
      logicalPopulation: 32,
      materializedSystemCount: 8,
      seed: "moving-neighborhood-test",
      generatorVersion: "globular-v1",
    });
    const fullScene = buildClusterExplorerScene(generated.scenario, provenanceKinds);
    const destination = fullScene.systems.at(-1);
    const center = fullScene.systems[0]?.position;
    if (destination === undefined || center === undefined) {
      throw new Error("Expected generated Systems for a moving neighborhood.");
    }
    const neighborhood = buildClusterExplorerNeighborhoodAt(fullScene, center, 3, [destination.id]);

    expect(neighborhood.systems).toHaveLength(3);
    expect(neighborhood.systems[0]?.id).toBe(destination.id);
    expect(neighborhood.systems.map((system) => system.id)).toContain(destination.id);
    expect(neighborhood.entities).toEqual(neighborhood.systems);
  });

  test("eases camera travel between materialized System neighborhoods", () => {
    const from = createCameraState([0, 0, 0]);
    const to = Object.freeze({
      ...from,
      target: [1, 2, 3] as const,
      distance: 1,
    });

    expect(interpolateCameraState(from, to, 0)).toEqual(from);
    expect(interpolateCameraState(from, to, 1)).toEqual(to);
    expect(interpolateCameraState(from, to, 0.25).target).toEqual([0.15625, 0.3125, 0.46875]);
  });

  test("keeps generated provenance visible and filterable after materialization", () => {
    const generated = generateClusterRegion({
      logicalPopulation: 32,
      materializedSystemCount: 8,
      seed: "explorer-test",
      generatorVersion: "globular-v1",
    });
    const scene = buildClusterExplorerScene(generated.scenario, ["generated"]);

    expect(scene.systems).toHaveLength(8);
    expect(scene.stars).toHaveLength(8);
    expect(scene.systems.every((system) => system.provenance.kinds.includes("generated"))).toBe(
      true,
    );
    expect(buildClusterExplorerScene(generated.scenario, ["novel"])).toMatchObject({
      systems: [],
      stars: [],
      gates: [],
      connections: [],
    });
  });

  test("uses one shared selection for endpoint roles and inspection focus", () => {
    const initial = createExplorerSelection("gate:terra", "gate:helios");
    const departure = selectExplorerGate(initial, "departure", "gate:aurora-entry");
    const inspected = selectExplorerEntity(departure, "system:aurora");
    const destination = selectExplorerGate(inspected, "destination", "gate:aurora-exit");

    expect(destination).toEqual({
      departureGateId: "gate:aurora-entry",
      destinationGateId: "gate:aurora-exit",
      focusedEntityId: "gate:aurora-exit",
      selectedEntityId: "gate:aurora-exit",
    });
    expect(
      normalizeExplorerSelection(destination, [{ id: "gate:terra" }, { id: "gate:helios" }]),
    ).toMatchObject({
      departureGateId: "gate:terra",
      destinationGateId: "gate:helios",
    });
  });

  test("fades unrelated points and links while retaining the focused Gate relationship", () => {
    const scene = buildClusterExplorerScene(
      requireScenario(multiLegJourneyScenario),
      provenanceKinds,
    );

    expect(explorerFocusPointOpacity(scene, "gate:terra", "gate:terra", 1)).toBe(1);
    expect(explorerFocusPointOpacity(scene, "gate:terra", "gate:aurora-entry", 1)).toBe(1);
    expect(explorerFocusPointOpacity(scene, "gate:terra", "system:helios", 1)).toBeLessThan(0.5);
    expect(
      explorerFocusConnectionOpacity(scene, "gate:terra", "connection:terra-aurora-entry", 1),
    ).toBe(0.9);
    expect(
      explorerFocusConnectionOpacity(scene, "gate:terra", "connection:aurora-exit-helios", 1),
    ).toBeLessThan(0.5);
    expect(explorerFocusPointOpacity(scene, "gate:terra", "system:helios", 0)).toBe(1);
  });

  test("classifies cumulative drag, normal click, and pointer cancellation deterministically", () => {
    const click = beginExplorerPointerGesture(7, 100, 100, false);
    expect(shouldPickExplorerPointerUp(click, 7, false)).toBe(true);
    expect(shouldPickExplorerPointerUp(click, 7, true)).toBe(false);

    const cumulative = moveExplorerPointerGesture(
      moveExplorerPointerGesture(click, 102, 100),
      104,
      100,
    );
    expect(cumulative.moved).toBe(true);
    expect(shouldPickExplorerPointerUp(cumulative, 7, false)).toBe(false);
    expect(shouldPickExplorerPointerUp(cumulative, 8, false)).toBe(false);
  });

  test("supports camera focus, orbit, zoom, and pointer picking", () => {
    const scene = buildClusterExplorerScene(
      requireScenario(multiLegJourneyScenario),
      provenanceKinds,
    );
    const camera = createCameraState(undefined);
    const terra = scene.gates.find((gate) => gate.id === "gate:terra");
    if (terra === undefined) {
      throw new Error("Expected the Terra Gate in the fixture.");
    }
    const focused = focusCameraOnPoint(camera, terra.position);
    const viewport = { width: 800, height: 500 } as const;
    const projected = projectExplorerPoint(terra.position, focused, viewport);
    const picked = pickExplorerEntity(scene, focused, viewport, projected.x, projected.y);
    const orbited = orbitCamera(focused, 20, -12);
    const zoomed = zoomCamera(orbited, -100_000);

    expect(projected.visible).toBe(true);
    expect(picked?.id).toBe("gate:terra");
    expect(orbited.yaw).not.toBe(focused.yaw);
    expect(zoomed.distance).toBeGreaterThanOrEqual(0.08);
  });
});
