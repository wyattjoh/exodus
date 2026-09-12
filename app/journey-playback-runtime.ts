import type {
  CompiledScenario,
  JourneyModel,
  JourneyPhaseKind,
  JourneySample,
  JourneySampleResult,
  MultiLegJourneyTimeline,
  SimulationIssue,
} from "../src/index";

/** Presentation modes for mapping wall-clock playback onto authoritative Journey time. */
export type JourneyPlaybackMode = "true-time" | "phase-focus";

/** The narrow scheduler contract used by playback and deterministic lifecycle tests. */
export type JourneyPlaybackScheduler = {
  readonly requestFrame: (callback: (timestamp: number) => void) => number;
  readonly cancelFrame: (handle: number) => void;
};

/** Runtime state published to the React projection. */
export type JourneyPlaybackRuntimeState = {
  readonly sample: JourneySample | undefined;
  readonly isPlaying: boolean;
  readonly mode: JourneyPlaybackMode;
  readonly playbackRate: number;
  readonly focusPhaseIndex: number | undefined;
  readonly error: string | undefined;
};

/** Mutable controller seam kept independent from React and browser globals. */
export type JourneyPlaybackRuntime = {
  readonly getState: () => JourneyPlaybackRuntimeState;
  readonly subscribe: (listener: (state: JourneyPlaybackRuntimeState) => void) => () => void;
  readonly togglePlaying: () => void;
  readonly pause: () => void;
  readonly seek: (fraction: number) => void;
  readonly reset: () => void;
  readonly stepEvent: (direction: "next" | "previous") => void;
  readonly setMode: (mode: JourneyPlaybackMode) => void;
  readonly setPlaybackRate: (rate: number) => void;
  readonly setFocusPhaseIndex: (phaseIndex: number | undefined) => void;
  readonly replace: (scenario: CompiledScenario, timeline: MultiLegJourneyTimeline) => void;
  readonly dispose: () => void;
};

export type JourneyPlaybackRuntimeOptions = {
  readonly model: Pick<JourneyModel, "sampleJourneyAt" | "stepJourneyEvent">;
  readonly scenario: CompiledScenario;
  readonly timeline: MultiLegJourneyTimeline;
  readonly scheduler?: JourneyPlaybackScheduler | undefined;
  readonly playbackRate?: number | undefined;
};

const EPSILON = 1e-9;
const DEFAULT_PLAYBACK_RATE = 100;
const PLAYBACK_RATES = Object.freeze([1, 10, 100, 1_000, 10_000]);

const PHASE_FOCUS_WEIGHTS: Readonly<Record<JourneyPhaseKind, number>> = Object.freeze({
  "departure-transition": 1,
  "interstellar-cruise": 0.35,
  dwell: 0.35,
  "in-system-transfer": 0.35,
  "arrival-transition": 1,
});

const defaultScheduler: JourneyPlaybackScheduler = Object.freeze({
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
});

function initialFocusPhaseIndex(timeline: MultiLegJourneyTimeline): number | undefined {
  const index = timeline.phases.findIndex(
    (phase) =>
      phase.clusterCoordinateDuration.value > 0 &&
      (phase.kind === "in-system-transfer" || phase.kind === "dwell"),
  );
  if (index >= 0) {
    return index;
  }
  const firstElapsedPhase = timeline.phases.findIndex(
    (phase) => phase.clusterCoordinateDuration.value > 0,
  );
  return firstElapsedPhase >= 0 ? firstElapsedPhase : undefined;
}

/** Formats structured sampler issues without hiding their model paths. */
export function sampleError(result: JourneySampleResult): string {
  if (result.ok) {
    return "";
  }
  const message = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join(" ");
  return message || "The Journey sampler failed without details.";
}

function failureFromException(error: unknown): JourneySampleResult {
  const issue: SimulationIssue = {
    code: "invalid-coordinate-state",
    path: "playback.sampleJourneyAt",
    message: error instanceof Error ? error.message : "The Journey sampler failed unexpectedly.",
    entityType: undefined,
    entityId: undefined,
    relatedId: undefined,
  };
  return Object.freeze({ ok: false as const, state: undefined, issues: Object.freeze([issue]) });
}

function sampleAt(
  model: Pick<JourneyModel, "sampleJourneyAt">,
  scenario: CompiledScenario,
  timeline: MultiLegJourneyTimeline,
  coordinateTime: number,
  eventIndex?: number,
): JourneySampleResult {
  try {
    return model.sampleJourneyAt(scenario, timeline, coordinateTime, eventIndex);
  } catch (error) {
    return failureFromException(error);
  }
}

function eventIndexForStep(
  timeline: MultiLegJourneyTimeline,
  sample: JourneySample,
  direction: "next" | "previous",
): number | undefined {
  if (timeline.events.length === 0) {
    return undefined;
  }
  if (sample.eventIndex !== undefined) {
    return sample.eventIndex;
  }
  const current = sample.coordinateTime.value;
  if (direction === "next") {
    const nextIndex = timeline.events.findIndex(
      (event) => event.coordinateTime.value > current + 1e-7,
    );
    return nextIndex >= 0 ? nextIndex : timeline.events.length - 1;
  }
  let result: number | undefined;
  timeline.events.forEach((event, index) => {
    if (event.coordinateTime.value < current - 1e-7) {
      result = index;
    }
  });
  return result ?? 0;
}

function phaseAtCoordinate(
  timeline: MultiLegJourneyTimeline,
  coordinateTime: number,
): { readonly index: number; readonly end: number } | undefined {
  for (const [index, phase] of timeline.phases.entries()) {
    const start = phase.startCoordinateTime.value;
    const end = phase.endCoordinateTime.value;
    if (end <= start + EPSILON || end <= coordinateTime + EPSILON) {
      continue;
    }
    if (coordinateTime >= start - EPSILON) {
      return { index, end };
    }
  }
  return undefined;
}

/**
 * Returns the wall-clock weight of one phase in phase-focus mode.
 *
 * A selected phase has a larger weight, meaning it consumes more presentation time per unit of
 * authoritative coordinate time. This intentionally slows a short selected phase instead of
 * accidentally fast-forwarding it.
 */
export function phaseFocusPresentationWeight(
  phase: Pick<MultiLegJourneyTimeline["phases"][number], "kind">,
  focusPhaseIndex: number | undefined,
  phaseIndex: number,
): number {
  if (focusPhaseIndex !== undefined && phaseIndex === focusPhaseIndex) {
    return 8;
  }
  return PHASE_FOCUS_WEIGHTS[phase.kind] ?? 1;
}

/** Returns the presentation seconds needed to traverse one phase at a given playback rate. */
export function journeyPhasePresentationSeconds(
  timeline: MultiLegJourneyTimeline,
  phaseIndex: number,
  mode: JourneyPlaybackMode,
  focusPhaseIndex: number | undefined,
  playbackRate = 1,
): number {
  const phase = timeline.phases[phaseIndex];
  if (
    phase === undefined ||
    phase.clusterCoordinateDuration.value <= 0 ||
    !Number.isFinite(playbackRate) ||
    playbackRate <= 0
  ) {
    return 0;
  }
  if (mode === "true-time") {
    return phase.clusterCoordinateDuration.value / playbackRate;
  }
  return (
    (phase.clusterCoordinateDuration.value *
      phaseFocusPresentationWeight(phase, focusPhaseIndex, phaseIndex)) /
    playbackRate
  );
}

/**
 * Maps one wall-clock delta to a monotone authoritative coordinate-time delta.
 *
 * The function crosses phase boundaries exactly rather than interpolating any physical state.
 */
export function advanceJourneyCoordinateTime(
  timeline: MultiLegJourneyTimeline,
  coordinateTime: number,
  wallSeconds: number,
  playbackRate: number,
  mode: JourneyPlaybackMode,
  focusPhaseIndex: number | undefined,
): number {
  const start = timeline.departureCoordinateTime.value;
  const end = Math.max(start, timeline.arrivalCoordinateTime.value);
  let coordinate = Number.isFinite(coordinateTime)
    ? Math.max(start, Math.min(end, coordinateTime))
    : start;
  const wall = Number.isFinite(wallSeconds) ? Math.max(0, wallSeconds) : 0;
  const rate = Number.isFinite(playbackRate) ? Math.max(0, playbackRate) : 0;
  if (wall === 0 || rate === 0 || coordinate >= end - EPSILON) {
    return Math.min(end, coordinate);
  }
  if (mode === "true-time") {
    const next = coordinate + wall * rate;
    return next >= end - EPSILON ? end : Math.min(end, next);
  }

  let remainingWall = wall;
  let guard = 0;
  while (
    remainingWall > EPSILON &&
    coordinate < end - EPSILON &&
    guard <= timeline.phases.length + 1
  ) {
    guard += 1;
    const active = phaseAtCoordinate(timeline, coordinate);
    if (active === undefined) {
      return end;
    }
    const phase = timeline.phases[active.index];
    if (phase === undefined) {
      return end;
    }
    const weight = phaseFocusPresentationWeight(phase, focusPhaseIndex, active.index);
    const coordinateRate = rate / weight;
    if (coordinateRate <= 0) {
      return coordinate;
    }
    const distanceToBoundary = Math.max(0, active.end - coordinate);
    const wallToBoundary = distanceToBoundary / coordinateRate;
    if (remainingWall <= wallToBoundary + EPSILON) {
      if (remainingWall >= wallToBoundary - EPSILON) {
        return Math.min(end, active.end);
      }
      return Math.min(end, coordinate + remainingWall * coordinateRate);
    }
    coordinate = active.end;
    remainingWall = Math.max(0, remainingWall - wallToBoundary);
  }
  return Math.min(end, coordinate);
}

function normalizedRate(rate: number | undefined): number {
  return rate !== undefined && PLAYBACK_RATES.includes(rate) ? rate : DEFAULT_PLAYBACK_RATE;
}

function freezeState(state: JourneyPlaybackRuntimeState): JourneyPlaybackRuntimeState {
  return Object.freeze({ ...state });
}

function initialState(
  model: Pick<JourneyModel, "sampleJourneyAt">,
  scenario: CompiledScenario,
  timeline: MultiLegJourneyTimeline,
  playbackRate: number,
): JourneyPlaybackRuntimeState {
  const result = sampleAt(model, scenario, timeline, timeline.departureCoordinateTime.value);
  return freezeState({
    sample: result.ok ? result.state : undefined,
    isPlaying: false,
    mode: "true-time",
    playbackRate,
    focusPhaseIndex: initialFocusPhaseIndex(timeline),
    error: result.ok ? undefined : sampleError(result),
  });
}

/** Creates a deterministic playback runtime with an injected scheduler. */
export function createJourneyPlaybackRuntime(
  options: JourneyPlaybackRuntimeOptions,
): JourneyPlaybackRuntime {
  const scheduler = options.scheduler ?? defaultScheduler;
  let scenario = options.scenario;
  let timeline = options.timeline;
  let state = initialState(options.model, scenario, timeline, normalizedRate(options.playbackRate));
  let disposed = false;
  let frame: number | undefined;
  let frameGeneration = 0;
  let previousTimestamp: number | undefined;
  const listeners = new Set<(next: JourneyPlaybackRuntimeState) => void>();

  const publish = (next: JourneyPlaybackRuntimeState): void => {
    if (disposed) {
      return;
    }
    state = freezeState(next);
    for (const listener of listeners) {
      listener(state);
    }
  };

  const cancelPending = (): void => {
    frameGeneration += 1;
    previousTimestamp = undefined;
    if (frame !== undefined) {
      scheduler.cancelFrame(frame);
      frame = undefined;
    }
  };

  const fail = (result: JourneySampleResult): void => {
    cancelPending();
    publish({ ...state, sample: undefined, isPlaying: false, error: sampleError(result) });
  };

  const publishSample = (result: JourneySampleResult, isPlaying: boolean): void => {
    if (!result.ok) {
      fail(result);
      return;
    }
    publish({ ...state, sample: result.state, isPlaying, error: undefined });
  };

  const schedule = (): void => {
    if (disposed || !state.isPlaying || state.sample === undefined || frame !== undefined) {
      return;
    }
    const generation = ++frameGeneration;
    try {
      frame = scheduler.requestFrame((timestamp) => {
        if (disposed || generation !== frameGeneration) {
          return;
        }
        frame = undefined;
        if (!state.isPlaying || state.sample === undefined) {
          return;
        }
        const previous = previousTimestamp;
        previousTimestamp = timestamp;
        if (previous === undefined) {
          schedule();
          return;
        }
        const wallSeconds = Math.max(0, Math.min(0.25, (timestamp - previous) / 1_000));
        const nextCoordinateTime = advanceJourneyCoordinateTime(
          timeline,
          state.sample.coordinateTime.value,
          wallSeconds,
          state.playbackRate,
          state.mode,
          state.focusPhaseIndex,
        );
        const result = sampleAt(options.model, scenario, timeline, nextCoordinateTime);
        if (!result.ok) {
          fail(result);
          return;
        }
        const end = timeline.arrivalCoordinateTime.value;
        const reachedEnd = nextCoordinateTime >= end - EPSILON;
        publish({
          ...state,
          sample: result.state,
          isPlaying: !reachedEnd,
          error: undefined,
        });
        if (!reachedEnd) {
          schedule();
        } else {
          previousTimestamp = undefined;
        }
      });
    } catch (error) {
      fail(failureFromException(error));
    }
  };

  const play = (): void => {
    if (state.sample === undefined || state.error !== undefined) {
      return;
    }
    const end = timeline.arrivalCoordinateTime.value;
    if (state.sample.coordinateTime.value >= end - EPSILON) {
      publish({ ...state, isPlaying: false });
      return;
    }
    publish({ ...state, isPlaying: true, error: undefined });
    schedule();
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      if (disposed) {
        return () => undefined;
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    togglePlaying: () => {
      if (state.isPlaying) {
        cancelPending();
        publish({ ...state, isPlaying: false });
        return;
      }
      play();
    },
    pause: () => {
      cancelPending();
      if (state.isPlaying) {
        publish({ ...state, isPlaying: false });
      }
    },
    seek: (fraction) => {
      cancelPending();
      const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
      const coordinateTime =
        timeline.departureCoordinateTime.value +
        (timeline.arrivalCoordinateTime.value - timeline.departureCoordinateTime.value) * clamped;
      publishSample(sampleAt(options.model, scenario, timeline, coordinateTime), false);
    },
    reset: () => {
      cancelPending();
      publishSample(
        sampleAt(options.model, scenario, timeline, timeline.departureCoordinateTime.value),
        false,
      );
    },
    stepEvent: (direction) => {
      cancelPending();
      if (state.sample === undefined) {
        return;
      }
      const nextIndex =
        state.sample.eventIndex === undefined
          ? eventIndexForStep(timeline, state.sample, direction)
          : (() => {
              try {
                return options.model.stepJourneyEvent(timeline, state.sample.eventIndex, direction);
              } catch (error) {
                fail(failureFromException(error));
                return undefined;
              }
            })();
      if (nextIndex === undefined) {
        return;
      }
      publishSample(
        sampleAt(options.model, scenario, timeline, state.sample.coordinateTime.value, nextIndex),
        false,
      );
    },
    setMode: (mode) => publish({ ...state, mode }),
    setPlaybackRate: (rate) => publish({ ...state, playbackRate: normalizedRate(rate) }),
    setFocusPhaseIndex: (focusPhaseIndex) => publish({ ...state, focusPhaseIndex }),
    replace: (nextScenario, nextTimeline) => {
      cancelPending();
      scenario = nextScenario;
      timeline = nextTimeline;
      state = initialState(options.model, scenario, timeline, state.playbackRate);
      publish(state);
    },
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      cancelPending();
      listeners.clear();
    },
  };
}

export { DEFAULT_PLAYBACK_RATE, PLAYBACK_RATES };
