import { meters, metersPerSecond, metersPerSecondSquared, seconds, vector3 } from "./quantities";
import type { ScenarioInput } from "./model";

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
