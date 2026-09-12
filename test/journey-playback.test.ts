import { describe, expect, test } from "bun:test";

import {
  compileScenario,
  exactClaim,
  generatedProvenance,
  multiLegJourneyRequest,
  multiLegJourneyScenario,
  sampleJourneyAt,
  seconds,
  simulateJourney,
  stepJourneyEvent,
  type CompiledScenario,
  type JourneySampleResult,
  type MultiLegJourneyTimeline,
} from "../src/index";
import {
  advanceJourneyCoordinateTime,
  createJourneyPlaybackRuntime,
  journeyPhasePresentationSeconds,
  type JourneyPlaybackScheduler,
} from "../app/journey-playback-runtime";
import {
  formatInspectableValue,
  inspectJourneyDiscrepancies,
  projectJourneyArrivalWindow,
  deriveJourneyPlaybackAnnouncement,
} from "../app/journey-inspection";

function requireScenario(input: unknown): CompiledScenario {
  const result = compileScenario(input);
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }
  return result.scenario;
}

function requireTimeline(scenario: CompiledScenario): MultiLegJourneyTimeline {
  const result = simulateJourney(scenario, multiLegJourneyRequest);
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }
  return result.timeline;
}

function fixture(): {
  readonly scenario: CompiledScenario;
  readonly timeline: MultiLegJourneyTimeline;
} {
  const scenario = requireScenario(multiLegJourneyScenario);
  return { scenario, timeline: requireTimeline(scenario) };
}

function schedulerFixture(): {
  readonly scheduler: JourneyPlaybackScheduler;
  readonly pending: () => readonly number[];
  readonly flush: (handle: number, timestamp: number) => void;
  readonly requestCount: () => number;
  readonly cancelCount: () => number;
} {
  let nextHandle = 0;
  let requests = 0;
  let cancellations = 0;
  const callbacks = new Map<number, (timestamp: number) => void>();
  const cancelled = new Set<number>();
  const scheduler: JourneyPlaybackScheduler = {
    requestFrame: (callback) => {
      const handle = ++nextHandle;
      requests += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      cancellations += 1;
      cancelled.add(handle);
    },
  };
  return {
    scheduler,
    pending: () => [...callbacks.keys()].filter((handle) => !cancelled.has(handle)),
    flush: (handle, timestamp) => {
      const callback = callbacks.get(handle);
      if (callback === undefined) {
        throw new Error(`No callback ${handle}.`);
      }
      callbacks.delete(handle);
      callback(timestamp);
    },
    requestCount: () => requests,
    cancelCount: () => cancellations,
  };
}

const model = { sampleJourneyAt, stepJourneyEvent };

describe("Journey playback mapping and lifecycle", () => {
  test("preserves true-time ratios and expands a selected short phase", () => {
    const { timeline } = fixture();
    const elapsed = timeline.phases
      .map((phase, index) => ({ phase, index }))
      .filter(({ phase }) => phase.clusterCoordinateDuration.value > 0);
    const first = elapsed[0];
    const second = elapsed[1];
    if (first === undefined || second === undefined) {
      throw new Error("Expected at least two elapsed phases.");
    }

    const firstTrue = journeyPhasePresentationSeconds(
      timeline,
      first.index,
      "true-time",
      first.index,
    );
    const secondTrue = journeyPhasePresentationSeconds(
      timeline,
      second.index,
      "true-time",
      first.index,
    );
    expect(firstTrue / secondTrue).toBeCloseTo(
      first.phase.clusterCoordinateDuration.value / second.phase.clusterCoordinateDuration.value,
      10,
    );

    const focused = journeyPhasePresentationSeconds(
      timeline,
      first.index,
      "phase-focus",
      first.index,
    );
    expect(focused).toBeGreaterThan(firstTrue);

    const focusedEnd = advanceJourneyCoordinateTime(
      timeline,
      first.phase.startCoordinateTime.value,
      focused,
      1,
      "phase-focus",
      first.index,
    );
    expect(focusedEnd).toBeCloseTo(first.phase.endCoordinateTime.value, 8);

    let previous = Number(first.phase.startCoordinateTime.value);
    for (const wallSeconds of [0.01, 0.1, 1, 10, 100]) {
      const next = advanceJourneyCoordinateTime(
        timeline,
        previous,
        wallSeconds,
        1,
        "phase-focus",
        first.index,
      );
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
    expect(
      advanceJourneyCoordinateTime(
        timeline,
        timeline.arrivalCoordinateTime.value,
        10,
        1,
        "phase-focus",
        first.index,
      ),
    ).toBe(timeline.arrivalCoordinateTime.value);
  });

  test("uses one scheduled loop and advances each timestamp delta once", () => {
    const { scenario, timeline } = fixture();
    const fake = schedulerFixture();
    const runtime = createJourneyPlaybackRuntime({
      model,
      scenario,
      timeline,
      scheduler: fake.scheduler,
      playbackRate: 1,
    });
    const states: ReturnType<typeof runtime.getState>[] = [];
    runtime.subscribe((state) => states.push(state));
    runtime.setMode("true-time");
    runtime.togglePlaying();
    expect(fake.requestCount()).toBe(1);
    expect(fake.pending()).toHaveLength(1);

    const firstHandle = fake.pending()[0];
    if (firstHandle === undefined) {
      throw new Error("Expected the first frame.");
    }
    fake.flush(firstHandle, 0);
    expect(fake.requestCount()).toBe(2);
    const secondHandle = fake.pending()[0];
    if (secondHandle === undefined) {
      throw new Error("Expected the second frame.");
    }
    const before = runtime.getState().sample?.coordinateTime.value ?? 0;
    fake.flush(secondHandle, 1_000);
    const after = runtime.getState().sample?.coordinateTime.value ?? 0;
    expect(after - before).toBeCloseTo(0.25, 8);
    expect(fake.requestCount()).toBe(3);
    expect(states.filter((state) => state.isPlaying)).not.toHaveLength(0);
    runtime.dispose();
  });

  test("cancels pending work for pause, seek, event-step, replacement, and disposal", () => {
    const { scenario, timeline } = fixture();
    const fake = schedulerFixture();
    const runtime = createJourneyPlaybackRuntime({
      model,
      scenario,
      timeline,
      scheduler: fake.scheduler,
    });
    let publications = 0;
    runtime.subscribe(() => {
      publications += 1;
    });
    runtime.togglePlaying();
    const firstHandle = fake.pending()[0];
    if (firstHandle === undefined) {
      throw new Error("Expected a pending frame.");
    }
    runtime.pause();
    expect(fake.cancelCount()).toBe(1);
    const afterPause = publications;
    fake.flush(firstHandle, 1_000);
    expect(publications).toBe(afterPause);

    runtime.seek(0.25);
    expect(runtime.getState().isPlaying).toBe(false);
    runtime.togglePlaying();
    const secondHandle = fake.pending()[0];
    if (secondHandle === undefined) {
      throw new Error("Expected a second pending frame.");
    }
    runtime.stepEvent("next");
    expect(fake.cancelCount()).toBe(2);
    const afterStep = publications;
    fake.flush(secondHandle, 2_000);
    expect(publications).toBe(afterStep);

    runtime.togglePlaying();
    const thirdHandle = fake.pending()[0];
    if (thirdHandle === undefined) {
      throw new Error("Expected a third pending frame.");
    }
    runtime.replace(scenario, timeline);
    expect(fake.cancelCount()).toBe(3);
    const afterReplace = publications;
    fake.flush(thirdHandle, 3_000);
    expect(publications).toBe(afterReplace);

    runtime.togglePlaying();
    const fourthHandle = fake.pending()[0];
    if (fourthHandle === undefined) {
      throw new Error("Expected a fourth pending frame.");
    }
    runtime.dispose();
    expect(fake.cancelCount()).toBe(4);
    const afterDispose = publications;
    fake.flush(fourthHandle, 4_000);
    expect(publications).toBe(afterDispose);
  });

  test("does not throw on sampler initialization and stops after a sampler failure", () => {
    const { scenario, timeline } = fixture();
    const initializationFailure = createJourneyPlaybackRuntime({
      model: {
        sampleJourneyAt: () => ({
          ok: false,
          state: undefined,
          issues: [
            {
              code: "invalid-coordinate-state",
              path: "test.initialization",
              message: "initial sampler failure",
              entityType: undefined,
              entityId: undefined,
              relatedId: undefined,
            },
          ],
        }),
        stepJourneyEvent,
      },
      scenario,
      timeline,
      scheduler: schedulerFixture().scheduler,
    });
    expect(initializationFailure.getState().sample).toBeUndefined();
    expect(initializationFailure.getState().error).toContain("initial sampler failure");
    initializationFailure.dispose();

    const fake = schedulerFixture();
    const runtime = createJourneyPlaybackRuntime({
      model,
      scenario,
      timeline,
      scheduler: fake.scheduler,
    });
    runtime.seek(1);
    runtime.togglePlaying();
    expect(fake.requestCount()).toBe(0);

    const failingFake = schedulerFixture();
    let failAfterFirstSample = false;
    const failingModel = {
      sampleJourneyAt: (
        nextScenario: CompiledScenario,
        nextTimeline: MultiLegJourneyTimeline,
        coordinateTime: number | import("../src/index").Seconds,
        eventIndex?: number,
      ): JourneySampleResult => {
        if (failAfterFirstSample) {
          return {
            ok: false,
            state: undefined,
            issues: [
              {
                code: "invalid-coordinate-state",
                path: "test.sampler",
                message: "fixture sampler failure",
                entityType: undefined,
                entityId: undefined,
                relatedId: undefined,
              },
            ],
          };
        }
        return sampleJourneyAt(nextScenario, nextTimeline, coordinateTime, eventIndex);
      },
      stepJourneyEvent,
    };
    const failingRuntime = createJourneyPlaybackRuntime({
      model: failingModel,
      scenario,
      timeline,
      scheduler: failingFake.scheduler,
    });
    failingRuntime.togglePlaying();
    const firstHandle = failingFake.pending()[0];
    if (firstHandle === undefined) {
      throw new Error("Expected a failure test frame.");
    }
    failingFake.flush(firstHandle, 0);
    failAfterFirstSample = true;
    const secondHandle = failingFake.pending()[0];
    if (secondHandle === undefined) {
      throw new Error("Expected a second failure test frame.");
    }
    failingFake.flush(secondHandle, 1_000);
    expect(failingRuntime.getState().isPlaying).toBe(false);
    expect(failingRuntime.getState().sample).toBeUndefined();
    expect(failingRuntime.getState().error).toContain("fixture sampler failure");
    expect(failingFake.pending()).toHaveLength(0);
    failingRuntime.replace(scenario, timeline);
    expect(failingRuntime.getState().sample).toBeUndefined();
    expect(failingRuntime.getState().error).toContain("fixture sampler failure");
    failingRuntime.dispose();
    runtime.dispose();
  });

  test("keeps the uncertainty overlay accessible and visibly distinct", async () => {
    const markup = await Bun.file("app/journey-playback.tsx").text();
    const styles = await Bun.file("app/styles.css").text();
    expect(markup).toContain('className="journey-arrival-overlay"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-live="polite" aria-atomic="true"');
    expect(markup).not.toContain('className="journey-clock-grid" aria-live');
    expect(markup).toContain("Secondary bounded arrival window");
    expect(styles).toContain(".journey-arrival-window");
    expect(styles).toContain(".journey-arrival-nominal");
  });

  test("derives discrete announcements without coordinate-time ticks", () => {
    const { scenario, timeline } = fixture();
    const first = sampleJourneyAt(scenario, timeline, timeline.departureCoordinateTime);
    const middle = sampleJourneyAt(
      scenario,
      timeline,
      timeline.departureCoordinateTime.value +
        (timeline.arrivalCoordinateTime.value - timeline.departureCoordinateTime.value) / 3,
    );
    expect(first.ok).toBe(true);
    expect(middle.ok).toBe(true);
    if (!first.ok || !middle.ok) {
      return;
    }
    const firstAnnouncement = deriveJourneyPlaybackAnnouncement({
      sample: first.state,
      timeline,
      isPlaying: false,
      error: undefined,
    });
    const samePhaseAnnouncement = deriveJourneyPlaybackAnnouncement({
      sample: {
        ...first.state,
        coordinateTime: seconds(first.state.coordinateTime.value + 1),
      },
      timeline,
      isPlaying: false,
      error: undefined,
    });
    expect(samePhaseAnnouncement).toBe(firstAnnouncement);
    expect(
      deriveJourneyPlaybackAnnouncement({
        sample: middle.state,
        timeline,
        isPlaying: true,
        error: undefined,
      }),
    ).not.toBe(firstAnnouncement);
    expect(
      deriveJourneyPlaybackAnnouncement({
        sample: undefined,
        timeline,
        isPlaying: false,
        error: "bad",
      }),
    ).toContain("bad");
  });
});

describe("Journey arrival and Canon inspection projections", () => {
  test("projects bounded arrival windows safely beside the nominal endpoint", () => {
    const { scenario, timeline } = fixture();
    const sampleResult = sampleJourneyAt(scenario, timeline, timeline.departureCoordinateTime);
    expect(sampleResult.ok).toBe(true);
    if (!sampleResult.ok) {
      return;
    }
    const projection = projectJourneyArrivalWindow(sampleResult.state, timeline);
    expect(projection.nominalPercent).toBe(100);
    expect(projection.leftPercent).toBeGreaterThanOrEqual(0);
    expect(projection.upperPercent).toBeLessThanOrEqual(100);
    expect(projection.widthPercent).toBeGreaterThanOrEqual(0);
    expect(projection.ariaLabel).toContain("Nominal Journey arrival");

    const degenerate = projectJourneyArrivalWindow(sampleResult.state, {
      ...timeline,
      arrivalCoordinateTime: timeline.departureCoordinateTime,
    });
    expect(degenerate.leftPercent).toBe(100);
    expect(degenerate.widthPercent).toBe(0);
  });

  test("formats cyclic and structured Canon values without unsafe stringification", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(formatInspectableValue(cyclic)).toContain("[cyclic]");
    expect(formatInspectableValue({ z: seconds(2), a: [seconds(1), 2] })).toContain("a:");
  });

  test("exposes both sides and provenance for a real Canon discrepancy", () => {
    const scenario = requireScenario({
      ...multiLegJourneyScenario,
      canonicalClaims: [
        {
          id: "claim:journey-duration",
          subject: "journey",
          property: "journey-duration",
          claim: exactClaim(seconds(1), generatedProvenance("fix-round-1")),
        },
      ],
    });
    const timeline = requireTimeline(scenario);
    const sampleResult = sampleJourneyAt(scenario, timeline, timeline.departureCoordinateTime);
    expect(sampleResult.ok).toBe(true);
    if (!sampleResult.ok) {
      return;
    }
    const inspections = inspectJourneyDiscrepancies(sampleResult.state, timeline);
    expect(inspections).toHaveLength(1);
    const inspection = inspections[0];
    if (inspection === undefined) {
      return;
    }
    expect(inspection.message).toContain("journey-duration");
    expect(inspection.canonicalClaim.nominal).toContain("s");
    expect(inspection.canonicalClaim.provenance.kind).toBe("generated");
    expect(inspection.canonicalClaim.provenance.source).toBe("fix-round-1");
    expect(inspection.derivedResult.nominal).toMatch(/[a-z]/);
    expect(inspection.derivedResult.lower).toMatch(/[a-z]/);
    expect(inspection.derivedResult.upper).toMatch(/[a-z]/);
  });
});
