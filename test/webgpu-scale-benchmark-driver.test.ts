import { describe, expect, test } from "bun:test";
import {
  cleanupWebGpuBrowserResources,
  closeBrowser,
  connectWebGpuCdp,
  loadWebGpuBenchmarkBaseline,
  parseWebGpuBenchmarkOutput,
  terminateWebGpuProcess,
  waitForProcessExit,
  waitForWebGpuBenchmarkTerminal,
  type WebGpuBrowserProcess,
} from "../scripts/webgpu-scale-benchmark";
import { webDriverRequest } from "../scripts/webgpu-scale-conformance";
import {
  compareWebGpuBenchmarkBaseline,
  createUnavailableWebGpuBenchmarkResult,
  evaluateWebGpuBenchmark,
  defaultWebGpuBenchmarkBaseline,
  defaultWebGpuBenchmarkPreparation,
  describeWebGpuResourceMemory,
  type WebGpuBenchmarkBaseline,
} from "../src/webgpu-scale";

const measured = {
  result: {
    benchmarkVersion: "webgpu-million-points-v1",
    contractVersion: "gpu-cluster-lod-v1",
    scene: "million-visible-star-points",
    status: "measured",
    unavailableReason: undefined,
    timingSource: "request-animation-frame",
    warmupFrameCount: 30,
    sampleFrameCount: 60,
    visibleCount: 1_000_000,
    generationLatencyMilliseconds: 20,
    resourceBudget: {
      pointBufferBytes: 32_000_000,
      indirectBufferBytes: 16,
      uniformBufferBytes: 256,
      seedBufferBytes: 148,
      totalBufferBytes: 32_000_420,
      pointStrideBytes: 32,
      visibleCapacity: 1_000_000,
      candidateCount: 1_000_000,
      dispatchWorkgroups: 15_625,
      workgroupSize: 64,
      maxBufferSize: 67_108_864,
    },
    metadata: {
      browser: "Chrome",
      browserVersion: "152.0.7977.84",
      operatingSystem: "MacIntel",
      measuredAt: "2026-09-13T01:47:31.922Z",
    },
    thresholds: {
      minimumVisiblePoints: 900_000,
      targetVisiblePoints: 1_000_000,
      minimumFps: 60,
      minimumSustainedFps: 59.5,
      maximumP95FrameTimeMilliseconds: 16.67,
      maximumGenerationLatencyMilliseconds: 1000,
      maximumResourceBytes: 67_108_864,
    },
    pass: true,
    diagnostics: [],
    frameTimes: {
      p50Milliseconds: 16.666666666666668,
      p95Milliseconds: 16.666666666666668,
      p99Milliseconds: 16.666666666666668,
      maximumMilliseconds: 16.666666666666668,
      averageMilliseconds: 16.666666666666668,
      averageFps: 60.0,
      fpsAtP95: 60,
    },
  },
  baseline: { status: "pass", regressions: [], diagnostics: [] },
  conformance: { fixtureDiagnostics: [], gpuFixtureDiagnostics: [] },
};

type ControlledExit = "natural" | "sigterm" | "sigkill" | "rejected" | "never";

type ControlledProcess = WebGpuBrowserProcess & {
  readonly signals: Array<number | string>;
};

function controlledProcess(
  exit: ControlledExit,
  killThrows = false,
  events?: string[],
): ControlledProcess {
  let resolveExit: (() => void) | undefined;
  const exited =
    exit === "natural"
      ? Promise.resolve()
      : exit === "rejected"
        ? Promise.reject(new Error("exit channel failed"))
        : new Promise<void>((resolve) => {
            resolveExit = resolve;
          });
  const signals: Array<number | string> = [];
  return {
    exited,
    signals,
    kill: (signal?: number | string) => {
      signals.push(signal ?? 0);
      if (signal !== undefined) {
        events?.push(String(signal));
      }
      if (killThrows) {
        throw new Error(`signal ${String(signal)} failed`);
      }
      if (
        (exit === "sigterm" && signal === "SIGTERM") ||
        (exit === "sigkill" && signal === "SIGKILL")
      ) {
        resolveExit?.();
      }
    },
  };
}

describe("WebGPU benchmark browser driver parser", () => {
  test("accepts a measured terminal page envelope", () => {
    const output = parseWebGpuBenchmarkOutput(JSON.stringify(measured), "pass");
    expect(output.result.status).toBe("measured");
    expect(output.result.visibleCount).toBe(1_000_000);
    expect(output.result.sampleFrameCount).toBe(60);
  });

  test("keeps threshold failures and measured regressions in the measured class", async () => {
    const failedResult = evaluateWebGpuBenchmark({
      ...(measured.result as unknown as Parameters<typeof evaluateWebGpuBenchmark>[0]),
      generationLatencyMilliseconds: 2_000,
    });
    const failedPageBaseline = compareWebGpuBenchmarkBaseline(
      failedResult,
      defaultWebGpuBenchmarkBaseline(),
    );
    const failed = parseWebGpuBenchmarkOutput(
      JSON.stringify({ ...measured, result: failedResult, baseline: failedPageBaseline }),
      "fail",
    );
    expect(failed.result.status).toBe("measured");
    expect(failed.result.pass).toBe(false);
    expect(failed.baseline).toMatchObject({ status: "fail" });

    const loaded = await loadWebGpuBenchmarkBaseline();
    expect(loaded.measuredBaseline).toBeDefined();
    if (loaded.measuredBaseline === undefined) {
      return;
    }
    const targetResult = evaluateWebGpuBenchmark({
      ...(measured.result as unknown as Parameters<typeof evaluateWebGpuBenchmark>[0]),
      generationLatencyMilliseconds: 40,
      metadata: {
        ...measured.result.metadata,
        operatingSystem: loaded.measuredBaseline.metadata.operatingSystem,
        adapterName: loaded.measuredBaseline.metadata.adapterName,
        adapterVendor: loaded.measuredBaseline.metadata.adapterVendor,
        adapterArchitecture: loaded.measuredBaseline.metadata.adapterArchitecture,
      },
    });
    const pageBaseline = compareWebGpuBenchmarkBaseline(
      targetResult,
      defaultWebGpuBenchmarkBaseline(),
    );
    expect(pageBaseline.status).toBe("pass");
    const regression = parseWebGpuBenchmarkOutput(
      JSON.stringify({ ...measured, result: targetResult, baseline: pageBaseline }),
      "pass",
      loaded,
      loaded.measuredBaseline.machine,
      loaded.measuredBaseline.metadata.browserVersion,
    );
    expect(regression.result.status).toBe("measured");
    expect(regression.baseline).toMatchObject({ status: "fail" });
    expect(JSON.stringify(regression.baseline)).toContain("generation latency regressed");
  });

  test("accepts unavailable browser results without inventing frames", () => {
    const baseline = defaultWebGpuBenchmarkBaseline();
    const unavailable = createUnavailableWebGpuBenchmarkResult(
      "browser-missing: Chrome is not installed.",
      {
        browser: "Chrome",
        browserVersion: "unknown",
        operatingSystem: "test",
        adapterName: undefined,
        adapterVendor: undefined,
        adapterArchitecture: undefined,
        measuredAt: "2026-09-13T01:47:31.922Z",
      },
      defaultWebGpuBenchmarkPreparation().budget,
      baseline.thresholds,
    );
    const output = parseWebGpuBenchmarkOutput(
      JSON.stringify({
        result: unavailable,
        baseline: compareWebGpuBenchmarkBaseline(unavailable, baseline),
        conformance: { fixtureDiagnostics: [], gpuFixtureDiagnostics: [] },
      }),
      "unavailable",
    );
    expect(output.result.status).toBe("unavailable");
    expect(output.result.unavailableReason).toContain("browser-missing");
  });

  test("rejects a terminal class with incomplete or contradictory JSON", () => {
    expect(() =>
      parseWebGpuBenchmarkOutput(
        JSON.stringify({
          ...measured,
          result: { ...measured.result, visibleCount: 0 },
        }),
        "fail",
      ),
    ).toThrow("visibleCount");
    expect(() =>
      parseWebGpuBenchmarkOutput(
        JSON.stringify({
          ...measured,
          result: {
            ...measured.result,
            resourceBudget: { ...measured.result.resourceBudget, visibleCapacity: 999_999 },
          },
        }),
        "fail",
      ),
    ).toThrow(/canonical GPU resource shape|one-million-point target/);
    expect(() =>
      parseWebGpuBenchmarkOutput(
        JSON.stringify({ ...measured, result: { ...measured.result, warmupFrameCount: 29 } }),
        "fail",
      ),
    ).toThrow("exactly 30");
    expect(() =>
      parseWebGpuBenchmarkOutput(
        JSON.stringify({ ...measured, result: { ...measured.result, sampleFrameCount: 59 } }),
        "fail",
      ),
    ).toThrow("exactly 60");
    expect(() =>
      parseWebGpuBenchmarkOutput(
        JSON.stringify({
          ...measured,
          result: { ...measured.result, timingSource: "wall-clock" },
        }),
        "fail",
      ),
    ).toThrow("timingSource");
    expect(() => parseWebGpuBenchmarkOutput("not-json", "fail")).toThrow("valid terminal JSON");
    expect(() =>
      parseWebGpuBenchmarkOutput(JSON.stringify({ result: { status: "measured" } }), "unavailable"),
    ).toThrow("canonical terminal fields");
    expect(() =>
      parseWebGpuBenchmarkOutput(
        JSON.stringify({
          result: {
            ...measured.result,
            status: "unavailable",
            unavailableReason: "automation-unavailable",
            warmupFrameCount: 2,
            sampleFrameCount: 0,
          },
        }),
        "unavailable",
      ),
    ).toThrow("canonical terminal fields");
  });

  test("rejects missing baseline and conformance envelopes", () => {
    expect(() =>
      parseWebGpuBenchmarkOutput(
        JSON.stringify({ result: measured.result, conformance: measured.conformance }),
        "pass",
      ),
    ).toThrow("canonical terminal fields");
    expect(() =>
      parseWebGpuBenchmarkOutput(
        JSON.stringify({ result: measured.result, baseline: measured.baseline }),
        "pass",
      ),
    ).toThrow("canonical terminal fields");
  });

  test("rejects substituted thresholds and forged derived metrics", () => {
    expect(() =>
      parseWebGpuBenchmarkOutput(
        JSON.stringify({
          ...measured,
          result: {
            ...measured.result,
            thresholds: { ...measured.result.thresholds, minimumSustainedFps: 1 },
          },
        }),
        "pass",
      ),
    ).toThrow("canonical benchmark thresholds");
    expect(() =>
      parseWebGpuBenchmarkOutput(
        JSON.stringify({
          ...measured,
          result: {
            ...measured.result,
            frameTimes: { ...measured.result.frameTimes, averageFps: 120 },
          },
        }),
        "pass",
      ),
    ).toThrow("FPS fields");
    expect(() =>
      parseWebGpuBenchmarkOutput(
        JSON.stringify({
          ...measured,
          result: {
            ...measured.result,
            resourceBudget: { ...measured.result.resourceBudget, totalBufferBytes: 1 },
          },
        }),
        "pass",
      ),
    ).toThrow("canonical GPU resource shape");
    expect(() =>
      parseWebGpuBenchmarkOutput(
        JSON.stringify({ ...measured, result: { ...measured.result, pass: false } }),
        "fail",
      ),
    ).toThrow("canonical metric evaluation");
  });

  test("rejects forged baseline comparisons and changed canonical device limits", () => {
    expect(() =>
      parseWebGpuBenchmarkOutput(
        JSON.stringify({
          ...measured,
          baseline: { status: "fail", regressions: ["forged regression"], diagnostics: [] },
        }),
        "fail",
      ),
    ).toThrow("canonical threshold comparison");
    expect(() =>
      parseWebGpuBenchmarkOutput(
        JSON.stringify({
          ...measured,
          result: {
            ...measured.result,
            resourceBudget: { ...measured.result.resourceBudget, maxBufferSize: 1 },
          },
        }),
        "pass",
      ),
    ).toThrow("canonical GPU resource shape");
    const substitutedBaseline = {
      ...defaultWebGpuBenchmarkBaseline(),
      thresholds: {
        ...defaultWebGpuBenchmarkBaseline().thresholds,
        maximumResourceBytes: 1,
      },
    } as WebGpuBenchmarkBaseline;
    expect(() =>
      parseWebGpuBenchmarkOutput(JSON.stringify(measured), "pass", substitutedBaseline),
    ).toThrow("loaded benchmark baseline");
  });

  test("rejects incomplete or incompatible measured baselines", async () => {
    const baseline = await loadWebGpuBenchmarkBaseline();
    expect(baseline.measuredBaseline).toBeDefined();
    expect(() =>
      parseWebGpuBenchmarkOutput(JSON.stringify(measured), "pass", {
        ...defaultWebGpuBenchmarkBaseline(),
        measuredBaseline: {},
      } as WebGpuBenchmarkBaseline),
    ).toThrow("canonical fields");
    if (baseline.measuredBaseline !== undefined) {
      const incompatible = {
        ...baseline,
        measuredBaseline: {
          ...baseline.measuredBaseline,
          resourceBudget: { ...baseline.measuredBaseline.resourceBudget, totalBufferBytes: 1 },
        },
      } as WebGpuBenchmarkBaseline;
      expect(() =>
        parseWebGpuBenchmarkOutput(JSON.stringify(measured), "pass", incompatible),
      ).toThrow("canonical GPU resource shape");
      const invalidMetrics = {
        ...baseline,
        measuredBaseline: {
          ...baseline.measuredBaseline,
          generationLatencyMilliseconds: 10_000,
        },
      } as WebGpuBenchmarkBaseline;
      expect(() =>
        parseWebGpuBenchmarkOutput(JSON.stringify(measured), "pass", invalidMetrics),
      ).toThrow("canonical benchmark acceptance");
    }
  });

  test("confirms a process that exits naturally without sending a signal", async () => {
    const process = controlledProcess("natural");
    const termination = await terminateWebGpuProcess(process, 2);
    expect(termination).toEqual({
      confirmedExit: true,
      phase: "natural-exit",
      signals: [],
      errors: [],
    });
    expect(process.signals).toEqual([]);
  });

  test("confirms a process that exits after SIGTERM", async () => {
    const process = controlledProcess("sigterm");
    const termination = await terminateWebGpuProcess(process, 2);
    expect(termination.confirmedExit).toBe(true);
    expect(termination.phase).toBe("sigterm-exit");
    expect(termination.signals).toEqual(["SIGTERM"]);
    expect(process.signals).toEqual(["SIGTERM"]);
  });

  test("escalates from SIGTERM to SIGKILL and confirms the forced exit", async () => {
    const process = controlledProcess("sigkill");
    const termination = await terminateWebGpuProcess(process, 2);
    expect(termination.confirmedExit).toBe(true);
    expect(termination.phase).toBe("sigkill-exit");
    expect(termination.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(process.signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("contains signal errors while attempting both termination signals", async () => {
    const process = controlledProcess("never", true);
    const termination = await terminateWebGpuProcess(process, 2);
    expect(termination.confirmedExit).toBe(false);
    expect(termination.phase).toBe("unconfirmed");
    expect(termination.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(termination.errors.join(" ")).toContain("SIGTERM failed");
    expect(termination.errors.join(" ")).toContain("SIGKILL failed");
  });

  test("does not treat a rejected exited promise as confirmed", async () => {
    const process = controlledProcess("rejected");
    expect(await waitForProcessExit(process, 2)).toBe(false);
    const termination = await terminateWebGpuProcess(process, 2);
    expect(termination.confirmedExit).toBe(false);
    expect(termination.phase).toBe("unconfirmed");
    expect(termination.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(termination.errors.join(" ")).toContain("exit channel failed");
  });

  test("keeps independent teardown and gates temporary cleanup on confirmed exit", async () => {
    const events: string[] = [];
    const process = controlledProcess("never", false, events);
    await expect(
      cleanupWebGpuBrowserResources({
        browser: process,
        cdp: {
          send: async () => {
            events.push("cdp-close");
          },
          close: () => {
            events.push("socket-close");
          },
        },
        timeoutMs: 2,
        independentCleanup: [() => events.push("server-stop")],
        confirmedExitCleanup: [() => events.push("temp-remove")],
      }),
    ).rejects.toThrow("exit could not be confirmed");
    expect(process.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(events).toEqual(["cdp-close", "SIGTERM", "SIGKILL", "socket-close", "server-stop"]);

    const forcedEvents: string[] = [];
    const forced = controlledProcess("sigkill", false, forcedEvents);
    await cleanupWebGpuBrowserResources({
      browser: forced,
      cdp: {
        send: async () => {
          forcedEvents.push("cdp-close");
        },
        close: () => {
          forcedEvents.push("socket-close");
        },
      },
      timeoutMs: 2,
      independentCleanup: [() => forcedEvents.push("server-stop")],
      confirmedExitCleanup: [() => forcedEvents.push("temp-remove")],
    });
    expect(forced.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(forcedEvents).toEqual([
      "cdp-close",
      "SIGTERM",
      "SIGKILL",
      "socket-close",
      "server-stop",
      "temp-remove",
    ]);
  });

  test("surfaces an unconfirmed browser exit after CDP and socket cleanup", async () => {
    let closeCalls = 0;
    await expect(
      closeBrowser(
        controlledProcess("never"),
        {
          send: () => new Promise<never>(() => undefined),
          close: () => {
            closeCalls += 1;
          },
        },
        2,
      ),
    ).rejects.toThrow("exit could not be confirmed");
    expect(closeCalls).toBe(1);
  });

  test("bounds hanging CDP connect, send, and terminal snapshot operations", async () => {
    const never = new Promise<never>(() => undefined);
    let closed = 0;
    let openConnections = false;
    const originalWebSocket = globalThis.WebSocket;
    const webSocketGlobal = globalThis as typeof globalThis & {
      WebSocket: typeof WebSocket;
    };
    webSocketGlobal.WebSocket = class ControlledWebSocket {
      addEventListener(type: string, listener: EventListener): void {
        if (type === "open" && openConnections) {
          void listener(new Event("open"));
        }
      }
      removeEventListener(): void {
        // The connection test does not need listener bookkeeping.
      }
      send(): void {
        // No response is sent, exercising the request deadline.
      }
      close(): void {
        closed += 1;
      }
    } as unknown as typeof WebSocket;
    try {
      await expect(connectWebGpuCdp("ws://hanging", 2)).rejects.toThrow("timed out");
      expect(closed).toBe(1);
      openConnections = true;
      const cdp = await connectWebGpuCdp("ws://open", 10);
      await expect(cdp.send("Runtime.evaluate", {}, 2)).rejects.toThrow("timed out");
      cdp.close();
    } finally {
      webSocketGlobal.WebSocket = originalWebSocket;
    }
    await expect(
      waitForWebGpuBenchmarkTerminal(
        {
          send: () => never,
          close: () => undefined,
        },
        2,
      ),
    ).rejects.toThrow("timed out");
    const forgedBaselineText = JSON.stringify({
      ...measured,
      baseline: { status: "fail", regressions: ["forged"], diagnostics: [] },
    });
    await expect(
      waitForWebGpuBenchmarkTerminal(
        {
          send: async () => ({
            result: { value: { state: "pass", text: forgedBaselineText } },
          }),
          close: () => undefined,
        },
        20,
      ),
    ).rejects.toThrow("canonical threshold comparison");
  });

  test("bounds hanging WebDriver requests and child exit waits", async () => {
    const originalFetch = globalThis.fetch;
    const fetchGlobal = globalThis as typeof globalThis & { fetch: typeof fetch };
    fetchGlobal.fetch = (() => new Promise<never>(() => undefined)) as unknown as typeof fetch;
    try {
      await expect(webDriverRequest(18_080, "/session", {}, 2)).rejects.toThrow("timed out");
    } finally {
      fetchGlobal.fetch = originalFetch;
    }
    const never = new Promise<never>(() => undefined);
    expect(
      await waitForProcessExit(
        {
          exited: never,
          kill: () => undefined,
        },
        2,
      ),
    ).toBe(false);
  });

  test("rejects malformed metadata and incompatible baseline semantics", () => {
    expect(() =>
      parseWebGpuBenchmarkOutput(
        JSON.stringify({
          ...measured,
          result: {
            ...measured.result,
            metadata: { ...measured.result.metadata, measuredAt: "not-a-date" },
          },
        }),
        "pass",
      ),
    ).toThrow("ISO date");
    expect(() =>
      parseWebGpuBenchmarkOutput(
        JSON.stringify({
          ...measured,
          baseline: { status: "unavailable", regressions: [], diagnostics: ["incompatible"] },
        }),
        "pass",
      ),
    ).toThrow("measured benchmark must not have an unavailable baseline");
    expect(() =>
      parseWebGpuBenchmarkOutput(
        JSON.stringify({
          ...measured,
          baseline: { status: "fail", regressions: [], diagnostics: [] },
        }),
        "fail",
      ),
    ).toThrow("must explain");
    expect(() =>
      parseWebGpuBenchmarkOutput(
        JSON.stringify({
          ...measured,
          conformance: { fixtureDiagnostics: [42], gpuFixtureDiagnostics: [] },
        }),
        "pass",
      ),
    ).toThrow("string array");
  });
});
