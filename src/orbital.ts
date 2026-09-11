import {
  meters,
  metersPerSecond,
  seconds,
  vector3,
  type PositionVector,
  type Seconds,
  type VelocityVector,
} from "./quantities";
import { addVector, scaleVector, subtractVector, type NumericVector3 } from "./vector";
import type {
  CompiledOrbitalAnchor,
  CompiledScenario,
  GateWorldline,
  OrbitalAnchorWorldline,
  ScenarioWorldlineFailure,
  ScenarioWorldlineResult,
  ScenarioWorldlineSuccess,
  StableId,
  WorldlineIssue,
  WorldlineIssueCode,
} from "./model";

const TWO_PI = 2 * Math.PI;
const ORBIT_SOLVER_TOLERANCE = 1e-14;
const ORBIT_SOLVER_MAX_ITERATIONS = 96;

/**
 * A numeric Cartesian state used internally while resolving a hierarchy.
 */
type NumericState = {
  readonly position: NumericVector3;
  readonly velocity: NumericVector3;
};

type ResolutionFailure = {
  readonly code: WorldlineIssueCode;
  readonly message: string;
};

type ResolutionResult =
  | { readonly ok: true; readonly state: NumericState }
  | { readonly ok: false; readonly issue: ResolutionFailure };

function stateToVectors(state: NumericState): {
  readonly position: PositionVector;
  readonly velocity: VelocityVector;
} {
  return {
    position: vector3(meters(state.position.x), meters(state.position.y), meters(state.position.z)),
    velocity: vector3(
      metersPerSecond(state.velocity.x),
      metersPerSecond(state.velocity.y),
      metersPerSecond(state.velocity.z),
    ),
  };
}

function finiteState(state: NumericState): boolean {
  return (
    Number.isFinite(state.position.x) &&
    Number.isFinite(state.position.y) &&
    Number.isFinite(state.position.z) &&
    Number.isFinite(state.velocity.x) &&
    Number.isFinite(state.velocity.y) &&
    Number.isFinite(state.velocity.z)
  );
}

function normalizeAngle(value: number): number {
  const normalized = value % TWO_PI;
  return normalized < 0 ? normalized + TWO_PI : normalized;
}

function eccentricAnomaly(meanAnomaly: number, eccentricity: number): number | undefined {
  const mean = normalizeAngle(meanAnomaly);
  let lower = mean - eccentricity;
  let upper = mean + eccentricity;
  let candidate = eccentricity < 0.8 ? mean : Math.PI;

  for (let iteration = 0; iteration < ORBIT_SOLVER_MAX_ITERATIONS; iteration += 1) {
    const functionValue = candidate - eccentricity * Math.sin(candidate) - mean;
    const derivative = 1 - eccentricity * Math.cos(candidate);
    if (Math.abs(functionValue) <= ORBIT_SOLVER_TOLERANCE) {
      return candidate;
    }

    if (functionValue > 0) {
      upper = Math.min(upper, candidate);
    } else {
      lower = Math.max(lower, candidate);
    }

    const newtonCandidate = candidate - functionValue / derivative;
    candidate =
      Number.isFinite(newtonCandidate) && newtonCandidate > lower && newtonCandidate < upper
        ? newtonCandidate
        : (lower + upper) / 2;
  }

  return undefined;
}

function rotatePerifocal(
  x: number,
  y: number,
  inclination: number,
  longitudeOfAscendingNode: number,
  argumentOfPeriapsis: number,
): { readonly x: number; readonly y: number; readonly z: number } {
  const cosOmega = Math.cos(longitudeOfAscendingNode);
  const sinOmega = Math.sin(longitudeOfAscendingNode);
  const cosInclination = Math.cos(inclination);
  const sinInclination = Math.sin(inclination);
  const cosArgument = Math.cos(argumentOfPeriapsis);
  const sinArgument = Math.sin(argumentOfPeriapsis);

  const xPerifocal = cosArgument * x - sinArgument * y;
  const yPerifocal = sinArgument * x + cosArgument * y;
  return {
    x: cosOmega * xPerifocal - sinOmega * cosInclination * yPerifocal,
    y: sinOmega * xPerifocal + cosOmega * cosInclination * yPerifocal,
    z: sinInclination * yPerifocal,
  };
}

function evaluateOrbit(anchor: CompiledOrbitalAnchor, elapsedSeconds: number): ResolutionResult {
  const elements = anchor.orbitalElements;
  if (elements === undefined) {
    return {
      ok: false,
      issue: {
        code: "invalid-orbital-elements",
        message: `Orbital Anchor ${anchor.id} has no Keplerian elements.`,
      },
    };
  }

  const semiMajorAxis = elements.semiMajorAxis.value;
  const eccentricity = elements.eccentricity;
  const gravitationalParameter = elements.gravitationalParameter.value;
  if (
    !Number.isFinite(semiMajorAxis) ||
    semiMajorAxis <= 0 ||
    !Number.isFinite(eccentricity) ||
    eccentricity < 0 ||
    eccentricity >= 1 ||
    !Number.isFinite(gravitationalParameter) ||
    gravitationalParameter <= 0
  ) {
    return {
      ok: false,
      issue: {
        code: "invalid-orbital-elements",
        message: `Orbital Anchor ${anchor.id} contains invalid elliptic Keplerian elements.`,
      },
    };
  }

  const meanMotion = Math.sqrt(
    gravitationalParameter / (semiMajorAxis * semiMajorAxis * semiMajorAxis),
  );
  const meanAnomaly = elements.meanAnomalyAtEpoch + meanMotion * elapsedSeconds;
  if (!Number.isFinite(meanMotion) || !Number.isFinite(meanAnomaly)) {
    return {
      ok: false,
      issue: {
        code: "non-finite-worldline",
        message: `Orbital Anchor ${anchor.id} produced a non-finite mean anomaly.`,
      },
    };
  }

  const eccentricAnomalyValue = eccentricAnomaly(meanAnomaly, eccentricity);
  if (eccentricAnomalyValue === undefined) {
    return {
      ok: false,
      issue: {
        code: "non-convergent-orbit",
        message: `Kepler's equation did not converge for Orbital Anchor ${anchor.id}.`,
      },
    };
  }

  const cosineEccentricAnomaly = Math.cos(eccentricAnomalyValue);
  const sineEccentricAnomaly = Math.sin(eccentricAnomalyValue);
  const oneMinusEccentricitySquared = 1 - eccentricity * eccentricity;
  const radius = semiMajorAxis * (1 - eccentricity * cosineEccentricAnomaly);
  const positionScale = Math.sqrt(oneMinusEccentricitySquared);
  const velocityScale = Math.sqrt(gravitationalParameter * semiMajorAxis) / radius;
  const position = rotatePerifocal(
    semiMajorAxis * (cosineEccentricAnomaly - eccentricity),
    semiMajorAxis * positionScale * sineEccentricAnomaly,
    elements.inclination,
    elements.longitudeOfAscendingNode,
    elements.argumentOfPeriapsis,
  );
  const velocity = rotatePerifocal(
    -velocityScale * sineEccentricAnomaly,
    velocityScale * positionScale * cosineEccentricAnomaly,
    elements.inclination,
    elements.longitudeOfAscendingNode,
    elements.argumentOfPeriapsis,
  );
  const result: NumericState = { position, velocity };
  if (!finiteState(result)) {
    return {
      ok: false,
      issue: {
        code: "non-finite-worldline",
        message: `Orbital Anchor ${anchor.id} produced a non-finite position or velocity.`,
      },
    };
  }

  return { ok: true, state: result };
}

function systemState(scenario: CompiledScenario, systemId: StableId): ResolutionResult {
  const system = scenario.index.systems.get(systemId);
  if (system === undefined) {
    return {
      ok: false,
      issue: {
        code: "non-finite-worldline",
        message: `System ${systemId} is missing while resolving a worldline.`,
      },
    };
  }

  const state: NumericState = {
    position: {
      x: system.positionAtEpoch.x.value,
      y: system.positionAtEpoch.y.value,
      z: system.positionAtEpoch.z.value,
    },
    velocity: { x: 0, y: 0, z: 0 },
  };
  return finiteState(state)
    ? { ok: true, state }
    : {
        ok: false,
        issue: {
          code: "non-finite-worldline",
          message: `System ${systemId} produced a non-finite position or velocity.`,
        },
      };
}

function resolveAnchor(
  scenario: CompiledScenario,
  anchor: CompiledOrbitalAnchor,
  elapsedSeconds: number,
  cache: Map<StableId, ResolutionResult>,
  visiting: Set<StableId>,
): ResolutionResult {
  const cached = cache.get(anchor.id);
  if (cached !== undefined) {
    return cached;
  }
  if (visiting.has(anchor.id)) {
    const result: ResolutionResult = {
      ok: false,
      issue: {
        code: "invalid-orbital-elements",
        message: `Orbital Anchor ${anchor.id} participates in a cycle.`,
      },
    };
    cache.set(anchor.id, result);
    return result;
  }

  visiting.add(anchor.id);
  let result: ResolutionResult;
  if (anchor.orbitalElements !== undefined) {
    const relative = evaluateOrbit(anchor, elapsedSeconds);
    if (!relative.ok) {
      result = relative;
    } else {
      const center =
        anchor.parentId === undefined
          ? systemState(scenario, anchor.systemId)
          : resolveAnchor(
              scenario,
              scenario.index.orbitalAnchors.get(anchor.parentId) as CompiledOrbitalAnchor,
              elapsedSeconds,
              cache,
              visiting,
            );
      result = center.ok
        ? {
            ok: true,
            state: {
              position: addVector(center.state.position, relative.state.position),
              velocity: addVector(center.state.velocity, relative.state.velocity),
            },
          }
        : center;
    }
  } else if (anchor.parentId === undefined) {
    const position = {
      x: anchor.positionAtEpoch.x.value,
      y: anchor.positionAtEpoch.y.value,
      z: anchor.positionAtEpoch.z.value,
    };
    const velocity = {
      x: anchor.velocityAtEpoch.x.value,
      y: anchor.velocityAtEpoch.y.value,
      z: anchor.velocityAtEpoch.z.value,
    };
    result = {
      ok: true,
      state: {
        position: addVector(position, scaleVector(velocity, elapsedSeconds)),
        velocity,
      },
    };
  } else {
    const parent = scenario.index.orbitalAnchors.get(anchor.parentId);
    if (parent === undefined) {
      result = {
        ok: false,
        issue: {
          code: "non-finite-worldline",
          message: `Orbital Anchor ${anchor.id} references missing parent ${anchor.parentId}.`,
        },
      };
    } else {
      const parentResult = resolveAnchor(scenario, parent, elapsedSeconds, cache, visiting);
      const offsetPosition = subtractVector(
        {
          x: anchor.positionAtEpoch.x.value,
          y: anchor.positionAtEpoch.y.value,
          z: anchor.positionAtEpoch.z.value,
        },
        {
          x: parent.positionAtEpoch.x.value,
          y: parent.positionAtEpoch.y.value,
          z: parent.positionAtEpoch.z.value,
        },
      );
      const offsetVelocity = subtractVector(
        {
          x: anchor.velocityAtEpoch.x.value,
          y: anchor.velocityAtEpoch.y.value,
          z: anchor.velocityAtEpoch.z.value,
        },
        {
          x: parent.velocityAtEpoch.x.value,
          y: parent.velocityAtEpoch.y.value,
          z: parent.velocityAtEpoch.z.value,
        },
      );
      result = parentResult.ok
        ? {
            ok: true,
            state: {
              position: addVector(
                parentResult.state.position,
                addVector(offsetPosition, scaleVector(offsetVelocity, elapsedSeconds)),
              ),
              velocity: addVector(parentResult.state.velocity, offsetVelocity),
            },
          }
        : parentResult;
    }
  }

  visiting.delete(anchor.id);
  cache.set(anchor.id, result);
  return result;
}

function issue(
  code: WorldlineIssueCode,
  path: string,
  message: string,
  entityType: "orbital-anchor" | "gate",
  entityId: StableId,
): WorldlineIssue {
  return Object.freeze({ code, path, message, entityType, entityId });
}

function failure(issues: readonly WorldlineIssue[]): ScenarioWorldlineFailure {
  return Object.freeze({
    ok: false as const,
    worldlines: undefined,
    orbitalAnchors: [] as const,
    gates: [] as const,
    issues: Object.freeze(
      [...issues].sort((left, right) => {
        const pathComparison = left.path.localeCompare(right.path);
        return pathComparison === 0 ? left.code.localeCompare(right.code) : pathComparison;
      }),
    ),
  });
}

function success(
  coordinateTime: Seconds,
  orbitalAnchors: readonly OrbitalAnchorWorldline[],
  gates: readonly GateWorldline[],
): ScenarioWorldlineSuccess {
  const immutableAnchors = Object.freeze([...orbitalAnchors]);
  const immutableGates = Object.freeze([...gates]);
  return Object.freeze({
    ok: true as const,
    worldlines: Object.freeze({
      coordinateTime,
      orbitalAnchors: immutableAnchors,
      gates: immutableGates,
    }),
    orbitalAnchors: immutableAnchors,
    gates: immutableGates,
    issues: [] as const,
  });
}

/**
 * Resolves every route-relevant Orbital Anchor and Gate at one absolute Cluster Coordinate Time.
 *
 * Hierarchical elliptic Keplerian elements are evaluated relative to the Scenario epoch. Legacy
 * anchors without elements retain their constant-velocity epoch state, while child and Gate
 * states without elements comove with their parent while preserving their epoch offset.
 *
 * @param scenario - The immutable compiled Scenario to evaluate.
 * @param coordinateTime - The absolute Cluster Coordinate Time at which to resolve states.
 * @returns Immutable worldline states or structured numerical diagnostics without partial output.
 */
export function evaluateScenarioWorldlines(
  scenario: CompiledScenario,
  coordinateTime: Seconds,
): ScenarioWorldlineResult {
  if (coordinateTime.unit !== "s" || !Number.isFinite(coordinateTime.value)) {
    return failure([
      issue(
        "invalid-coordinate-time",
        "coordinateTime",
        "Worldline coordinateTime must be a finite SI duration.",
        "orbital-anchor",
        scenario.orbitalAnchors[0]?.id ?? ("unknown" as StableId),
      ),
    ]);
  }

  const elapsedSeconds = coordinateTime.value - scenario.epoch.coordinateTime.value;
  if (!Number.isFinite(elapsedSeconds)) {
    return failure([
      issue(
        "invalid-coordinate-time",
        "coordinateTime",
        "Worldline coordinateTime is not finite relative to the Scenario epoch.",
        "orbital-anchor",
        scenario.orbitalAnchors[0]?.id ?? ("unknown" as StableId),
      ),
    ]);
  }

  const cache = new Map<StableId, ResolutionResult>();
  const anchorStates: OrbitalAnchorWorldline[] = [];
  const issues: WorldlineIssue[] = [];
  for (const anchor of scenario.orbitalAnchors) {
    const resolved = resolveAnchor(scenario, anchor, elapsedSeconds, cache, new Set());
    if (!resolved.ok) {
      issues.push(
        issue(
          resolved.issue.code,
          `orbitalAnchors.${anchor.id}`,
          resolved.issue.message,
          "orbital-anchor",
          anchor.id,
        ),
      );
      continue;
    }
    const vectors = stateToVectors(resolved.state);
    anchorStates.push(
      Object.freeze({
        id: anchor.id,
        systemId: anchor.systemId,
        parentId: anchor.parentId,
        coordinateTime,
        position: vectors.position,
        velocity: vectors.velocity,
      }),
    );
  }

  if (issues.length > 0) {
    return failure(issues);
  }

  const anchorStateById = new Map(anchorStates.map((state) => [state.id, state]));
  const gateStates: GateWorldline[] = [];
  for (const gate of scenario.gates) {
    const anchor = scenario.index.orbitalAnchors.get(gate.orbitalAnchorId);
    const anchorState = anchorStateById.get(gate.orbitalAnchorId);
    if (anchor === undefined || anchorState === undefined) {
      issues.push(
        issue(
          "non-finite-worldline",
          `gates.${gate.id}.orbitalAnchorId`,
          `Gate ${gate.id} cannot resolve Orbital Anchor ${gate.orbitalAnchorId}.`,
          "gate",
          gate.id,
        ),
      );
      continue;
    }

    const anchorNumericState: NumericState = {
      position: {
        x: anchorState.position.x.value,
        y: anchorState.position.y.value,
        z: anchorState.position.z.value,
      },
      velocity: {
        x: anchorState.velocity.x.value,
        y: anchorState.velocity.y.value,
        z: anchorState.velocity.z.value,
      },
    };
    let resolved: ResolutionResult;
    if (gate.orbitalElements !== undefined) {
      const pseudoAnchor: CompiledOrbitalAnchor = {
        id: gate.id,
        designation: gate.designation,
        name: gate.name,
        kind: "barycenter",
        systemId: gate.systemId,
        parentId: undefined,
        positionAtEpoch: gate.positionAtEpoch,
        velocityAtEpoch: gate.velocityAtEpoch,
        orbitalElements: gate.orbitalElements,
      };
      const relative = evaluateOrbit(pseudoAnchor, elapsedSeconds);
      resolved = relative.ok
        ? {
            ok: true,
            state: {
              position: addVector(anchorNumericState.position, relative.state.position),
              velocity: addVector(anchorNumericState.velocity, relative.state.velocity),
            },
          }
        : relative;
    } else {
      const offsetPosition = subtractVector(
        {
          x: gate.positionAtEpoch.x.value,
          y: gate.positionAtEpoch.y.value,
          z: gate.positionAtEpoch.z.value,
        },
        {
          x: anchor.positionAtEpoch.x.value,
          y: anchor.positionAtEpoch.y.value,
          z: anchor.positionAtEpoch.z.value,
        },
      );
      const offsetVelocity = subtractVector(
        {
          x: gate.velocityAtEpoch.x.value,
          y: gate.velocityAtEpoch.y.value,
          z: gate.velocityAtEpoch.z.value,
        },
        {
          x: anchor.velocityAtEpoch.x.value,
          y: anchor.velocityAtEpoch.y.value,
          z: anchor.velocityAtEpoch.z.value,
        },
      );
      resolved = {
        ok: true,
        state: {
          position: addVector(
            anchorNumericState.position,
            addVector(offsetPosition, scaleVector(offsetVelocity, elapsedSeconds)),
          ),
          velocity: addVector(anchorNumericState.velocity, offsetVelocity),
        },
      };
    }

    if (!resolved.ok) {
      issues.push(
        issue(
          resolved.issue.code,
          `gates.${gate.id}.orbitalElements`,
          resolved.issue.message,
          "gate",
          gate.id,
        ),
      );
      continue;
    }
    if (!finiteState(resolved.state)) {
      issues.push(
        issue(
          "non-finite-worldline",
          `gates.${gate.id}`,
          `Gate ${gate.id} produced a non-finite position or velocity.`,
          "gate",
          gate.id,
        ),
      );
      continue;
    }

    const vectors = stateToVectors(resolved.state);
    gateStates.push(
      Object.freeze({
        id: gate.id,
        systemId: gate.systemId,
        orbitalAnchorId: gate.orbitalAnchorId,
        coordinateTime,
        position: vectors.position,
        velocity: vectors.velocity,
      }),
    );
  }

  return issues.length > 0 ? failure(issues) : success(coordinateTime, anchorStates, gateStates);
}

/**
 * Evaluates the worldline of one Gate and returns its state alongside all numerical diagnostics.
 *
 * @param scenario - The immutable compiled Scenario to evaluate.
 * @param gateId - The Gate identifier to resolve.
 * @param coordinateTime - The absolute Cluster Coordinate Time at which to resolve the Gate.
 * @returns The matching Gate state, or a failure with no partial state.
 */
export function evaluateGateWorldline(
  scenario: CompiledScenario,
  gateId: StableId,
  coordinateTime: Seconds,
):
  | { readonly ok: true; readonly state: GateWorldline; readonly issues: readonly [] }
  | { readonly ok: false; readonly state: undefined; readonly issues: readonly WorldlineIssue[] } {
  const result = evaluateScenarioWorldlines(scenario, coordinateTime);
  if (!result.ok) {
    return Object.freeze({ ok: false as const, state: undefined, issues: result.issues });
  }

  const state = result.gates.find((candidate) => candidate.id === gateId);
  if (state === undefined) {
    return Object.freeze({
      ok: false as const,
      state: undefined,
      issues: [
        issue(
          "non-finite-worldline",
          `gates.${gateId}`,
          `Gate ${gateId} does not exist in the compiled Scenario.`,
          "gate",
          gateId,
        ),
      ],
    });
  }

  return Object.freeze({ ok: true as const, state, issues: [] as const });
}
