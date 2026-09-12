import { describe, expect, test } from "bun:test";
import {
  aggregateWebGpuReleaseChannel,
  classifyWebGpuConformanceReason,
  summarizeWebGpuConformance,
  type WebGpuBrowserConformanceResult,
} from "../scripts/webgpu-scale-conformance";

function outcome(
  status: WebGpuBrowserConformanceResult["status"],
  releaseChannel: WebGpuBrowserConformanceResult["releaseChannel"] = "stable",
): WebGpuBrowserConformanceResult {
  return {
    browser: status,
    releaseChannel,
    version: "test",
    operatingSystem: "test",
    adapter: { name: undefined, vendor: undefined, architecture: undefined },
    procedure: "test procedure",
    status,
    capabilityResult: "not-run",
    fixtureResult: "not-run",
    performanceResult: "not-run",
    reason: undefined,
    benchmark: undefined,
    checkedAt: "2026-09-12T00:00:00.000Z",
  };
}

describe("WebGPU browser conformance aggregation", () => {
  test("derives stable, unknown, and mixed aggregate channel claims", () => {
    expect(aggregateWebGpuReleaseChannel([outcome("pass")])).toBe("stable");
    expect(aggregateWebGpuReleaseChannel([outcome("pass"), outcome("browser-missing")])).toBe(
      "stable",
    );
    expect(aggregateWebGpuReleaseChannel([outcome("pass", "unknown")])).toBe("unknown");
    expect(
      aggregateWebGpuReleaseChannel([
        outcome("pass"),
        outcome("automation-unavailable", "unknown"),
      ]),
    ).toBe("mixed");
    expect(
      aggregateWebGpuReleaseChannel([
        outcome("browser-missing"),
        outcome("automation-unavailable"),
      ]),
    ).toBe("unknown");
    expect(aggregateWebGpuReleaseChannel([])).toBe("unknown");
  });

  test("keeps measured, browser, and automation outcomes distinct", () => {
    const summary = summarizeWebGpuConformance([
      outcome("pass"),
      outcome("fail"),
      outcome("browser-webgpu-unavailable"),
      outcome("browser-missing"),
      outcome("automation-unavailable"),
    ]);
    expect(summary).toEqual({
      pass: 1,
      fail: 1,
      browserWebGpuUnavailable: 1,
      browserMissing: 1,
      automationUnavailable: 1,
    });
    expect(classifyWebGpuConformanceReason("browser-missing: absent")).toBe("browser-missing");
    expect(classifyWebGpuConformanceReason("automation-unavailable: no driver")).toBe(
      "automation-unavailable",
    );
    expect(classifyWebGpuConformanceReason("adapter unavailable")).toBe(
      "browser-webgpu-unavailable",
    );
  });
});
