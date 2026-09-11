import {
  SPEED_OF_LIGHT,
  meters,
  metersPerSecond,
  metersPerSecondSquared,
  seconds,
  vector3,
} from "./quantities";
import type { ScenarioInput } from "./model";
import type { MultiLegJourneyRequest } from "./simulation";

const origin = vector3(meters(0), meters(0), meters(0));
const terraPosition = vector3(meters(0), meters(0), meters(0));
const selenePosition = vector3(meters(3.6e16), meters(0), meters(0));
const stationaryVelocity = vector3(metersPerSecond(0), metersPerSecond(0), metersPerSecond(0));

/**
 * A deterministic complete Scenario used by the textual demonstration and public-seam tests.
 */
export const minimalScenario: ScenarioInput = Object.freeze({
  id: "scenario:minimal",
  designation: "SCN-MINIMAL",
  name: "Minimal Centauri Cluster",
  epoch: Object.freeze({
    label: "T+0",
    coordinateTime: seconds(0),
  }),
  systems: Object.freeze([
    Object.freeze({
      id: "system:terra",
      designation: "CEN-0001",
      name: "Terra",
      positionAtEpoch: terraPosition,
      velocityAtEpoch: stationaryVelocity,
    }),
    Object.freeze({
      id: "system:selene",
      designation: "CEN-0002",
      name: "Selene",
      positionAtEpoch: selenePosition,
      velocityAtEpoch: stationaryVelocity,
    }),
  ]),
  orbitalAnchors: Object.freeze([
    Object.freeze({
      id: "anchor:terra-star",
      designation: "CEN-0001-A",
      name: "Terra Primary",
      kind: "star",
      systemId: "system:terra",
      parentId: undefined,
      positionAtEpoch: origin,
      velocityAtEpoch: stationaryVelocity,
      orbitalElements: undefined,
      orbit: undefined,
    }),
    Object.freeze({
      id: "anchor:selene-star",
      designation: "CEN-0002-A",
      name: "Selene Primary",
      kind: "star",
      systemId: "system:selene",
      parentId: undefined,
      positionAtEpoch: selenePosition,
      velocityAtEpoch: stationaryVelocity,
      orbitalElements: undefined,
      orbit: undefined,
    }),
  ]),
  gates: Object.freeze([
    Object.freeze({
      id: "gate:terra",
      designation: "GATE-CEN-0001",
      name: "Terra Gate of Heaven",
      systemId: "system:terra",
      orbitalAnchorId: "anchor:terra-star",
      positionAtEpoch: origin,
      velocityAtEpoch: stationaryVelocity,
      orbitalElements: undefined,
      orbit: undefined,
    }),
    Object.freeze({
      id: "gate:selene",
      designation: "GATE-CEN-0002",
      name: "Selene Gate of Heaven",
      systemId: "system:selene",
      orbitalAnchorId: "anchor:selene-star",
      positionAtEpoch: selenePosition,
      velocityAtEpoch: stationaryVelocity,
      orbitalElements: undefined,
      orbit: undefined,
    }),
  ]),
  gateConnections: Object.freeze([
    Object.freeze({
      id: "connection:terra-selene",
      designation: "LINK-CEN-0001-0002",
      name: "Terra–Selene Link",
      gateAId: "gate:terra",
      gateBId: "gate:selene",
    }),
  ]),
  shipProfiles: Object.freeze([
    Object.freeze({
      id: "ship:survey",
      designation: "SHIP-SURVEY-1",
      name: "Survey Ship",
      acceleration: metersPerSecondSquared(9.80665),
      brakingAcceleration: metersPerSecondSquared(9.80665),
      maximumSublightSpeed: metersPerSecond(0.2 * 299_792_458),
      hasZpzGenerator: true,
    }),
  ]),
});

const syntheticTerraPosition = vector3(meters(0), meters(0), meters(0));
const syntheticAuroraPosition = vector3(meters(4e16), meters(0), meters(0));
const syntheticAuroraExitPosition = vector3(meters(4e16), meters(1e13), meters(0));
const syntheticHeliosPosition = vector3(meters(8e16), meters(0), meters(0));
const syntheticStationaryVelocity = vector3(
  metersPerSecond(0),
  metersPerSecond(0),
  metersPerSecond(0),
);
const syntheticAuroraVelocity = vector3(
  metersPerSecond(0.05 * SPEED_OF_LIGHT.value),
  metersPerSecond(0),
  metersPerSecond(0),
);

/**
 * A deterministic four-Gate Scenario used for the public multi-leg Journey acceptance fixture.
 */
export const multiLegJourneyScenario: ScenarioInput = Object.freeze({
  id: "scenario:multi-leg",
  designation: "SCN-MULTI-LEG",
  name: "Multi-leg Centauri Cluster",
  epoch: Object.freeze({ label: "T+0", coordinateTime: seconds(0) }),
  systems: Object.freeze([
    Object.freeze({
      id: "system:terra",
      designation: "CEN-1001",
      name: "Terra",
      positionAtEpoch: syntheticTerraPosition,
      velocityAtEpoch: syntheticStationaryVelocity,
    }),
    Object.freeze({
      id: "system:aurora",
      designation: "CEN-1002",
      name: "Aurora",
      positionAtEpoch: syntheticAuroraPosition,
      velocityAtEpoch: syntheticStationaryVelocity,
    }),
    Object.freeze({
      id: "system:helios",
      designation: "CEN-1003",
      name: "Helios",
      positionAtEpoch: syntheticHeliosPosition,
      velocityAtEpoch: syntheticStationaryVelocity,
    }),
  ]),
  orbitalAnchors: Object.freeze([
    Object.freeze({
      id: "anchor:terra-star",
      designation: "CEN-1001-A",
      name: "Terra Primary",
      kind: "star",
      systemId: "system:terra",
      parentId: undefined,
      positionAtEpoch: syntheticTerraPosition,
      velocityAtEpoch: syntheticStationaryVelocity,
      orbitalElements: undefined,
      orbit: undefined,
    }),
    Object.freeze({
      id: "anchor:aurora-star",
      designation: "CEN-1002-A",
      name: "Aurora Primary",
      kind: "star",
      systemId: "system:aurora",
      parentId: undefined,
      positionAtEpoch: syntheticAuroraPosition,
      velocityAtEpoch: syntheticAuroraVelocity,
      orbitalElements: undefined,
      orbit: undefined,
    }),
    Object.freeze({
      id: "anchor:helios-star",
      designation: "CEN-1003-A",
      name: "Helios Primary",
      kind: "star",
      systemId: "system:helios",
      parentId: undefined,
      positionAtEpoch: syntheticHeliosPosition,
      velocityAtEpoch: syntheticStationaryVelocity,
      orbitalElements: undefined,
      orbit: undefined,
    }),
  ]),
  gates: Object.freeze([
    Object.freeze({
      id: "gate:terra",
      designation: "GATE-CEN-1001",
      name: "Terra Gate of Heaven",
      systemId: "system:terra",
      orbitalAnchorId: "anchor:terra-star",
      positionAtEpoch: syntheticTerraPosition,
      velocityAtEpoch: syntheticStationaryVelocity,
      orbitalElements: undefined,
      orbit: undefined,
    }),
    Object.freeze({
      id: "gate:aurora-entry",
      designation: "GATE-CEN-1002-ENTRY",
      name: "Aurora Entry Gate of Heaven",
      systemId: "system:aurora",
      orbitalAnchorId: "anchor:aurora-star",
      positionAtEpoch: syntheticAuroraPosition,
      velocityAtEpoch: syntheticAuroraVelocity,
      orbitalElements: undefined,
      orbit: undefined,
    }),
    Object.freeze({
      id: "gate:aurora-exit",
      designation: "GATE-CEN-1002-EXIT",
      name: "Aurora Exit Gate of Heaven",
      systemId: "system:aurora",
      orbitalAnchorId: "anchor:aurora-star",
      positionAtEpoch: syntheticAuroraExitPosition,
      velocityAtEpoch: syntheticAuroraVelocity,
      orbitalElements: undefined,
      orbit: undefined,
    }),
    Object.freeze({
      id: "gate:helios",
      designation: "GATE-CEN-1003",
      name: "Helios Gate of Heaven",
      systemId: "system:helios",
      orbitalAnchorId: "anchor:helios-star",
      positionAtEpoch: syntheticHeliosPosition,
      velocityAtEpoch: syntheticStationaryVelocity,
      orbitalElements: undefined,
      orbit: undefined,
    }),
  ]),
  gateConnections: Object.freeze([
    Object.freeze({
      id: "connection:terra-aurora-entry",
      designation: "LINK-CEN-1001-1002",
      name: "Terra–Aurora Link",
      gateAId: "gate:terra",
      gateBId: "gate:aurora-entry",
    }),
    Object.freeze({
      id: "connection:aurora-exit-helios",
      designation: "LINK-CEN-1002-1003",
      name: "Aurora–Helios Link",
      gateAId: "gate:aurora-exit",
      gateBId: "gate:helios",
    }),
  ]),
  shipProfiles: Object.freeze([
    Object.freeze({
      id: "ship:survey",
      designation: "SHIP-SURVEY-1",
      name: "Survey Ship",
      acceleration: metersPerSecondSquared(10),
      brakingAcceleration: metersPerSecondSquared(10),
      maximumSublightSpeed: metersPerSecond(0.2 * SPEED_OF_LIGHT.value),
      hasZpzGenerator: true,
    }),
  ]),
});

/**
 * The deterministic route for {@link multiLegJourneyScenario}: two cruises, one Dwell, and
 * the required Aurora In-system Transfer.
 */
export const multiLegJourneyRequest: MultiLegJourneyRequest = Object.freeze({
  kind: "journey",
  departureGateId: "gate:terra",
  destinationGateId: "gate:helios",
  shipProfileId: "ship:survey",
  departureCoordinateTime: seconds(0),
  legs: Object.freeze([
    Object.freeze({ kind: "interstellar-cruise", destinationGateId: "gate:aurora-entry" }),
    Object.freeze({
      kind: "dwell",
      gateId: "gate:aurora-entry",
      duration: seconds(2 * 86_400),
    }),
    Object.freeze({ kind: "in-system-transfer", destinationGateId: "gate:aurora-exit" }),
    Object.freeze({ kind: "interstellar-cruise", destinationGateId: "gate:helios" }),
  ]),
});
