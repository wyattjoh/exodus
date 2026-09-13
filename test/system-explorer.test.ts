import { describe, expect, test } from "bun:test";

import {
  createJourneyModel,
  meters,
  metersCubedPerSecondSquared,
  metersPerSecond,
  multiLegJourneyRequest,
  multiLegJourneyScenario,
  sampleJourneyAt,
  seconds,
  vector3,
  type ScenarioInput,
} from "../src/index";
import {
  buildSystemExplorerScene,
  buildSystemWebGpuRenderScene,
  createSystemViewCameraState,
  createSystemViewScaleTransform,
  describeJourneyPhase,
  scrubJourneyEvent,
  scrubJourneyTimeline,
  systemViewCameraKey,
} from "../app/system-explorer";

function requireScenario(input: unknown) {
  const result = createJourneyModel().compileScenario(input);
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }
  return result.scenario;
}

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Expected an item at index ${index}.`);
  }
  return value;
}

const solarMu = metersCubedPerSecondSquared(1.32712440018e20);

function nestedScenario(): ScenarioInput {
  const source = requireScenario(multiLegJourneyScenario);
  return {
    ...multiLegJourneyScenario,
    orbitalAnchors: [
      ...source.orbitalAnchors,
      {
        id: "anchor:aurora-planet",
        designation: "CEN-1002-P",
        name: "Aurora Planet",
        kind: "planet",
        systemId: "system:aurora",
        parentId: "anchor:aurora-star",
        positionAtEpoch: vector3(meters(1.5e11), meters(0), meters(0)),
        velocityAtEpoch: vector3(metersPerSecond(0), metersPerSecond(29_784), metersPerSecond(0)),
        orbitalElements: {
          semiMajorAxis: meters(1.5e11),
          eccentricity: 0,
          inclination: 0,
          longitudeOfAscendingNode: 0,
          argumentOfPeriapsis: 0,
          meanAnomalyAtEpoch: 0,
          gravitationalParameter: solarMu,
        },
      },
      {
        id: "anchor:aurora-unrelated",
        designation: "CEN-1002-X",
        name: "Unrelated Aurora Body",
        kind: "moon",
        systemId: "system:aurora",
        parentId: "anchor:aurora-star",
        positionAtEpoch: vector3(meters(2e11), meters(0), meters(0)),
        velocityAtEpoch: vector3(metersPerSecond(0), metersPerSecond(24_000), metersPerSecond(0)),
        orbitalElements: {
          semiMajorAxis: meters(2e11),
          eccentricity: 0,
          inclination: 0,
          longitudeOfAscendingNode: 0,
          argumentOfPeriapsis: 0,
          meanAnomalyAtEpoch: 0,
          gravitationalParameter: solarMu,
        },
      },
    ],
    gates: multiLegJourneyScenario.gates.map((gate) =>
      gate.id === "gate:aurora-entry" || gate.id === "gate:aurora-exit"
        ? {
            ...gate,
            orbitalAnchorId: "anchor:aurora-planet",
            positionAtEpoch: vector3(
              meters(1.5e11),
              meters(gate.id === "gate:aurora-exit" ? 1e13 : 0),
              meters(0),
            ),
            velocityAtEpoch: vector3(
              metersPerSecond(0),
              metersPerSecond(29_784),
              metersPerSecond(0),
            ),
          }
        : gate,
    ),
  };
}

describe("AU-scale System explorer projection seam", () => {
  test("uses a dedicated AU transform that round-trips world positions", () => {
    const transform = createSystemViewScaleTransform(
      vector3(meters(4e12), meters(-2e12), meters(7e12)),
      seconds(42),
    );
    const world = vector3(meters(4e12 + 149_597_870_700), meters(-2e12), meters(7e12));
    const local = transform.toViewPosition(world);
    const roundTrip = transform.toWorldPosition(local);

    expect(transform.unit).toBe("AU");
    expect(transform.metersPerUnit).toBe(149_597_870_700);
    expect(local).toEqual([1, 0, 0]);
    expect(roundTrip).toEqual([world.x.value, world.y.value, world.z.value]);
  });

  test("renders only route-relevant nested anchors and selected Gates from model worldlines", () => {
    const model = createJourneyModel();
    const nested = requireScenario(nestedScenario());
    const nestedScene = buildSystemExplorerScene({
      model,
      scenario: nested,
      systemId: "system:aurora",
      coordinateTime: seconds(0),
      journey: undefined,
      selectedGateIds: ["gate:aurora-entry", "gate:aurora-exit"],
      selectedOrbitalAnchorIds: undefined,
      orbitSampleCount: 8,
      timelineEventIndex: undefined,
    });
    const nestedWorldlines = model.evaluateWorldlines(nested, seconds(0));
    expect(nestedWorldlines.ok).toBe(true);
    if (!nestedWorldlines.ok) {
      return;
    }
    const entry = nestedWorldlines.gates.find((gate) => gate.id === "gate:aurora-entry");
    const renderedEntry = nestedScene.gates.find((gate) => gate.id === "gate:aurora-entry");
    expect(entry).toBeDefined();
    expect(renderedEntry).toBeDefined();

    expect(nestedScene.orbitalAnchors.map((anchor) => anchor.id).sort()).toEqual([
      "anchor:aurora-planet",
      "anchor:aurora-star",
    ]);
    expect(nestedScene.gates.map((gate) => gate.id).sort()).toEqual([
      "gate:aurora-entry",
      "gate:aurora-exit",
    ]);
    expect(
      nestedScene.orbitalAnchors.some((anchor) => anchor.id === "anchor:aurora-unrelated"),
    ).toBe(false);
    expect(nestedScene.nestedOrbitRelationships).toEqual([
      expect.objectContaining({
        parentId: "anchor:aurora-star",
        childId: "anchor:aurora-planet",
      }),
    ]);
    const emptyRouteScene = buildSystemExplorerScene({
      model,
      scenario: nested,
      systemId: "system:aurora",
      coordinateTime: seconds(0),
      journey: undefined,
      selectedGateIds: undefined,
      selectedOrbitalAnchorIds: undefined,
      orbitSampleCount: 8,
      timelineEventIndex: undefined,
    });
    expect(emptyRouteScene.entities).toEqual([]);

    const selectedStarScene = buildSystemExplorerScene({
      model,
      scenario: nested,
      systemId: "system:aurora",
      coordinateTime: seconds(0),
      journey: undefined,
      selectedGateIds: undefined,
      selectedOrbitalAnchorIds: ["anchor:aurora-star"],
      orbitSampleCount: 8,
      timelineEventIndex: undefined,
    });
    expect(selectedStarScene.entities.map((entity) => entity.id)).toEqual(["anchor:aurora-star"]);
    expect(selectedStarScene.orbitalAnchors[0]?.selected).toBe(true);

    expect(renderedEntry?.worldline.position).toEqual(entry?.position);
    expect(renderedEntry?.worldline.velocity).toEqual(entry?.velocity);

    const baseScenario = requireScenario(multiLegJourneyScenario);
    const journey = model.simulateJourney(baseScenario, multiLegJourneyRequest);
    expect(journey.ok).toBe(true);
    if (!journey.ok) {
      return;
    }
    const transfer = journey.timeline.phases.find((phase) => phase.kind === "in-system-transfer");
    if (transfer?.transfer === undefined) {
      throw new Error("Expected the acceptance Journey to contain a transfer.");
    }
    const transferScene = buildSystemExplorerScene({
      model,
      scenario: baseScenario,
      systemId: "system:aurora",
      coordinateTime: transfer.startCoordinateTime,
      journey: journey.timeline,
      selectedGateIds: undefined,
      selectedOrbitalAnchorIds: undefined,
      orbitSampleCount: undefined,
      timelineEventIndex: undefined,
    });
    expect(transferScene.trajectory?.segments.map((segment) => segment.kind)).toEqual([
      "acceleration",
      "braking",
    ]);
    expect(transferScene.trajectory?.events.map((event) => event.kind)).toEqual([
      "departure",
      "flip",
      "arrival",
    ]);
    expect(transferScene.trajectory?.destinationIntercept.position).toEqual(
      transfer.transfer.destinationPosition,
    );
  });

  test("keeps transfer, Dwell, and Interstellar Cruise descriptions distinct", () => {
    const scenario = requireScenario(multiLegJourneyScenario);
    const result = createJourneyModel().simulateJourney(scenario, multiLegJourneyRequest);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const descriptions = result.timeline.phases.map((phase) => describeJourneyPhase(phase));
    expect(descriptions.map((description) => description.kind)).toEqual([
      "departure-transition",
      "interstellar-cruise",
      "arrival-transition",
      "dwell",
      "in-system-transfer",
      "departure-transition",
      "interstellar-cruise",
      "arrival-transition",
    ]);
    expect(
      descriptions.find((description) => description.kind === "in-system-transfer")?.label,
    ).toBe("In-system Transfer");
    expect(descriptions.find((description) => description.kind === "dwell")?.label).toBe("Dwell");
    expect(
      descriptions.find((description) => description.kind === "interstellar-cruise")?.label,
    ).toBe("Interstellar Cruise");
  });

  test("scrubs exact model events without interpolating transfer geometry", () => {
    const model = createJourneyModel();
    const scenario = requireScenario(multiLegJourneyScenario);
    const result = model.simulateJourney(scenario, multiLegJourneyRequest);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const transfer = result.timeline.phases.find((phase) => phase.kind === "in-system-transfer");
    if (transfer?.transfer === undefined) {
      throw new Error("Expected a transfer timeline.");
    }
    const flipIndex = result.timeline.events.findIndex((event) => event.kind === "transfer-flip");
    const arrivalIndex = result.timeline.events.findIndex(
      (event) => event.kind === "transfer-arrival",
    );
    const flip = result.timeline.events[flipIndex];
    const arrival = result.timeline.events[arrivalIndex];
    if (flip === undefined || arrival === undefined) {
      throw new Error("Expected transfer flip and arrival events.");
    }

    const atFlip = scrubJourneyEvent(result.timeline, flipIndex);
    const atArrival = scrubJourneyTimeline(result.timeline, transfer.endCoordinateTime);
    expect(atFlip.eventIndex).toBe(flipIndex);
    expect(atFlip.event?.kind).toBe("transfer-flip");
    expect(atFlip.clocks).toEqual(flip.clocks);
    expect(atFlip.phase?.kind).toBe("in-system-transfer");
    expect(atArrival.eventIndex).toBe(arrivalIndex);
    expect(atArrival.event?.kind).toBe("transfer-arrival");
    expect(atArrival.clocks).toEqual(transfer.end);
    expect(atArrival.coordinateTime.value).toBe(arrival.coordinateTime.value);

    const interior = scrubJourneyTimeline(
      result.timeline,
      seconds(
        flip.coordinateTime.value +
          (arrival.coordinateTime.value - flip.coordinateTime.value) * 0.25,
      ),
    );
    expect(interior.coordinateTime.value).toBe(flip.coordinateTime.value);
    expect(interior.clocks).toEqual(flip.clocks);

    const sample = sampleJourneyAt(
      scenario,
      result.timeline,
      seconds(
        flip.coordinateTime.value +
          (arrival.coordinateTime.value - flip.coordinateTime.value) * 0.25,
      ),
    );
    expect(sample.ok).toBe(true);
    if (!sample.ok) {
      return;
    }
    const scene = buildSystemExplorerScene({
      model,
      scenario,
      systemId: "system:aurora",
      coordinateTime: sample.state.coordinateTime,
      journey: result.timeline,
      selectedGateIds: undefined,
      selectedOrbitalAnchorIds: undefined,
      orbitSampleCount: undefined,
      timelineEventIndex: flipIndex,
      journeySample: sample.state,
    });
    if (scene.activeJourney === undefined) {
      throw new Error("Expected the scene to expose active Journey state.");
    }
    expect(scene.activeJourney.eventIndex).toBe(sample.state.eventIndex);
    expect(scene.activeJourney.event).toBe(sample.state.event);
    expect(scene.activeJourney.coordinateTime.value).toBe(sample.state.coordinateTime.value);
    expect(scene.activeJourney.shipPosition).toEqual(sample.state.shipPosition);
    expect(scene.trajectory?.activeSegment?.kind).toBe("braking");
    expect(scene.trajectory?.activeSegment?.endCoordinateTime.value).toBeGreaterThanOrEqual(
      flip.coordinateTime.value,
    );
    const renderScene = buildSystemWebGpuRenderScene(scene);
    const flipMarker = scene.trajectory?.events.find((event) => event.kind === "flip");
    expect(flipMarker).toBeDefined();
    expect(renderScene.points).toContainEqual(
      expect.objectContaining({ position: flipMarker?.positionView }),
    );
    expect(renderScene.connections.length).toBeGreaterThan(0);
    expect(
      renderScene.connections.every(
        (connection) =>
          Math.hypot(
            connection.from[0] - connection.to[0],
            connection.from[1] - connection.to[1],
            connection.from[2] - connection.to[2],
          ) > 1e-9,
      ),
    ).toBe(true);

    const secondTransfer = Object.freeze({
      ...transfer,
      stepIndex: transfer.stepIndex + 1,
      destinationGateId: transfer.departureGateId,
      transfer: Object.freeze({
        ...transfer.transfer,
        destinationPosition: vector3(meters(4e16 + 2e13), meters(2e13), meters(0)),
      }),
    });
    const secondFlip = Object.freeze({
      ...flip,
      stepIndex: secondTransfer.stepIndex,
    });
    const duplicateTransferTimeline = Object.freeze({
      ...result.timeline,
      phases: Object.freeze([...result.timeline.phases, secondTransfer]),
      events: Object.freeze([...result.timeline.events, secondFlip]),
    });
    const duplicateScene = buildSystemExplorerScene({
      model,
      scenario,
      systemId: "system:aurora",
      coordinateTime: flip.coordinateTime,
      journey: duplicateTransferTimeline,
      selectedGateIds: undefined,
      selectedOrbitalAnchorIds: undefined,
      orbitSampleCount: undefined,
      timelineEventIndex: undefined,
    });
    expect(duplicateScene.activeJourney?.phase?.stepIndex).toBe(secondTransfer.stepIndex);
    expect(duplicateScene.trajectory?.destinationGateId).toBe(secondTransfer.destinationGateId);
    expect(duplicateScene.trajectory?.destinationIntercept.position).toEqual(
      secondTransfer.transfer.destinationPosition,
    );
  });

  test("maps keyboard camera controls to deterministic orbit, pan, and zoom gestures", () => {
    const camera = createSystemViewCameraState();
    const resetCamera = createSystemViewCameraState();
    const orbit = systemViewCameraKey(camera, "ArrowRight", false, resetCamera);
    expect(orbit.handled).toBe(true);
    expect(orbit.camera.yaw).not.toBe(camera.yaw);
    expect(orbit.camera.target).toEqual(camera.target);

    const pan = systemViewCameraKey(camera, "ArrowRight", true, resetCamera);
    expect(pan.handled).toBe(true);
    expect(pan.camera.target).not.toEqual(camera.target);
    expect(pan.camera.yaw).toBe(camera.yaw);

    const zoomIn = systemViewCameraKey(camera, "+", false, resetCamera);
    const zoomOut = systemViewCameraKey(camera, "-", false, resetCamera);
    expect(zoomIn.handled).toBe(true);
    expect(zoomIn.camera.distance).toBeLessThan(camera.distance);
    expect(zoomOut.handled).toBe(true);
    expect(zoomOut.camera.distance).toBeGreaterThan(camera.distance);

    const home = systemViewCameraKey(orbit.camera, "Home", false, resetCamera);
    expect(home.handled).toBe(true);
    expect(home.camera).toBe(resetCamera);

    const ignored = systemViewCameraKey(camera, "x", false, resetCamera);
    expect(ignored.handled).toBe(false);
    expect(ignored.camera).toBe(camera);
  });
});
