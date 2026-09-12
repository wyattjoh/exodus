import { describe, expect, test } from "bun:test";

import {
  beginExplorerPointerGesture,
  buildClusterExplorerScene,
  connectionsForExplorerEntity,
  createCameraState,
  createExplorerSelection,
  focusCameraOnPoint,
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
  test("normalizes Systems, Gates, and paired Gate Connections for stable search", () => {
    const scene = buildClusterExplorerScene(
      requireScenario(multiLegJourneyScenario),
      provenanceKinds,
    );

    expect(scene.systems.map((system) => system.designation).sort()).toEqual([
      "CEN-1001",
      "CEN-1002",
      "CEN-1003",
    ]);
    expect(scene.gates).toHaveLength(4);
    expect(scene.connections).toHaveLength(2);
    expect(searchClusterExplorer(scene, "CEN-1002").map((point) => point.id)).toEqual([
      "system:aurora",
      "gate:aurora-entry",
      "gate:aurora-exit",
    ]);
    expect(
      connectionsForExplorerEntity(scene, "system:aurora")
        .map((connection) => connection.id)
        .sort(),
    ).toEqual(["connection:aurora-exit-helios", "connection:terra-aurora-entry"]);
    expect(scene.connections[0]?.name).toContain("Link");
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
    expect(scene.systems.every((system) => system.provenance.kinds.includes("generated"))).toBe(
      true,
    );
    expect(buildClusterExplorerScene(generated.scenario, ["novel"])).toMatchObject({
      systems: [],
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
