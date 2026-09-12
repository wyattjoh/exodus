import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import {
  detectWebGpuHostMachine,
  discoverWebGpuBrowsers,
  executableVersion,
  runBoundedWebGpuCommand,
  type WebGpuBrowserInstallation,
  type WebGpuBrowserReleaseChannel,
  type WebGpuHostMachine,
} from "./webgpu-scale-environment";
import {
  cleanupWebGpuBrowserResources,
  loadWebGpuBenchmarkBaseline,
  parseWebGpuBenchmarkOutput,
  waitForProcessExit,
  withWebGpuTimeout,
  type WebGpuBenchmarkPageOutput,
} from "./webgpu-scale-benchmark";
import {
  compareWebGpuBenchmarkBaseline,
  defaultWebGpuBenchmarkBaseline,
  type WebGpuBenchmarkBaseline,
  type WebGpuBenchmarkResult,
} from "../src/webgpu-scale";

/**
 * One desktop-browser conformance outcome with a stable or explicitly unknown channel claim.
 */
export type WebGpuBrowserConformanceStatus =
  | "pass"
  | "fail"
  | "browser-webgpu-unavailable"
  | "browser-missing"
  | "automation-unavailable";

/**
 * Machine-readable result for one browser in the local conformance matrix.
 */
export type WebGpuBrowserConformanceResult = {
  readonly browser: string;
  readonly releaseChannel: WebGpuBrowserReleaseChannel;
  readonly version: string;
  readonly operatingSystem: string;
  readonly adapter: {
    readonly name: string | undefined;
    readonly vendor: string | undefined;
    readonly architecture: string | undefined;
  };
  readonly procedure: string;
  readonly status: WebGpuBrowserConformanceStatus;
  readonly capabilityResult: "pass" | "fail" | "not-run";
  readonly fixtureResult: "pass" | "fail" | "not-run";
  readonly performanceResult: "pass" | "fail" | "not-run";
  readonly reason: string | undefined;
  readonly benchmark: unknown;
  readonly checkedAt: string;
};

/**
 * Aggregate counts for a browser conformance matrix.
 */
export type WebGpuBrowserConformanceSummary = {
  readonly pass: number;
  readonly fail: number;
  readonly browserWebGpuUnavailable: number;
  readonly browserMissing: number;
  readonly automationUnavailable: number;
};

/**
 * Aggregate channel claim for a conformance report.
 *
 * `mixed` means that the report contains both stable and unknown channel claims. `unknown` is used
 * when no browser was actually measured, even if only stable-channel missing rows were discovered.
 */
export type WebGpuAggregateReleaseChannel = "stable" | "unknown" | "mixed";

/**
 * Machine-readable conformance report with an explicitly derived aggregate channel claim.
 */
export type WebGpuBrowserConformanceReport = {
  readonly reportVersion: "webgpu-conformance-v1";
  readonly releaseChannel: WebGpuAggregateReleaseChannel;
  readonly measuredAt: string;
  readonly machine: WebGpuHostMachine;
  readonly procedure: string;
  readonly summary: WebGpuBrowserConformanceSummary;
  readonly browsers: readonly WebGpuBrowserConformanceResult[];
};

const PROCEDURE =
  "Production Vite build on trusted localhost; create WebGPU device; validate required limits and formats; dispatch bounded compute; draw indirect; read back count and numeric/exact-text fixtures; complete 30 warm-up and 60 sample frames.";
const WEBDRIVER_OPERATION_TIMEOUT_MS = 5_000;
const SAFARI_STARTUP_TIMEOUT_MS = 5_000;
const SAFARI_BENCHMARK_TIMEOUT_MS = 180_000;
const PROCESS_CLEANUP_TIMEOUT_MS = 2_000;
const SAFARI_PORT_PROBE_TIMEOUT_MS = 500;

async function boundedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  const controller = new AbortController();
  try {
    return await withWebGpuTimeout(
      fetch(url, { ...init, signal: controller.signal }),
      timeoutMs,
      label,
    );
  } catch (error) {
    try {
      controller.abort();
    } catch {
      // A completed or mocked request may not expose abortable state.
    }
    throw error;
  }
}

export function classifyWebGpuConformanceReason(reason: string): WebGpuBrowserConformanceStatus {
  if (reason.startsWith("browser-missing:")) {
    return "browser-missing";
  }
  if (reason.startsWith("automation-unavailable:")) {
    return "automation-unavailable";
  }
  return "browser-webgpu-unavailable";
}

/**
 * Derives the aggregate release-channel claim from discovered browser rows.
 *
 * @param results - Browser rows included in the conformance report.
 * @returns Stable only when an executed row is stable and no row claims an unknown channel; mixed
 * when stable and unknown claims coexist; otherwise unknown.
 */
export function aggregateWebGpuReleaseChannel(
  results: readonly WebGpuBrowserConformanceResult[],
): WebGpuAggregateReleaseChannel {
  if (results.length === 0) {
    return "unknown";
  }
  const channels = new Set(results.map((result) => result.releaseChannel));
  if (channels.size > 1) {
    return "mixed";
  }
  if (channels.has("unknown")) {
    return "unknown";
  }
  const executed = results.some((result) => result.status === "pass" || result.status === "fail");
  return executed ? "stable" : "unknown";
}

/**
 * Summarizes matrix statuses without collapsing environment outcomes into failures or passes.
 *
 * @param results - Browser outcomes to aggregate.
 * @returns Deterministic counts by status.
 */
export function summarizeWebGpuConformance(
  results: readonly WebGpuBrowserConformanceResult[],
): WebGpuBrowserConformanceSummary {
  const summary = {
    pass: 0,
    fail: 0,
    browserWebGpuUnavailable: 0,
    browserMissing: 0,
    automationUnavailable: 0,
  };
  for (const result of results) {
    switch (result.status) {
      case "pass":
        summary.pass += 1;
        break;
      case "fail":
        summary.fail += 1;
        break;
      case "browser-webgpu-unavailable":
        summary.browserWebGpuUnavailable += 1;
        break;
      case "browser-missing":
        summary.browserMissing += 1;
        break;
      case "automation-unavailable":
        summary.automationUnavailable += 1;
        break;
    }
  }
  return Object.freeze(summary);
}

async function commandText(
  command: readonly string[],
  timeoutMs = WEBDRIVER_OPERATION_TIMEOUT_MS,
): Promise<string> {
  const output = await runBoundedWebGpuCommand(command, { timeoutMs });
  const text = (output.stdout || output.stderr).trim();
  if (output.exitCode !== 0) {
    throw new Error(text || `${command[0] ?? "command"} exited with ${String(output.exitCode)}.`);
  }
  return text;
}

function resultForPage(
  browser: string,
  releaseChannel: WebGpuBrowserReleaseChannel,
  page: WebGpuBenchmarkPageOutput,
  machine: WebGpuHostMachine,
): WebGpuBrowserConformanceResult {
  const result = Object.freeze({
    ...page.result,
    metadata: Object.freeze({
      ...page.result.metadata,
      operatingSystem: machine.operatingSystem,
    }),
  });
  if (result.status === "unavailable") {
    const reason = result.unavailableReason ?? "The benchmark page reported no reason.";
    return Object.freeze({
      browser,
      releaseChannel,
      version: result.metadata.browserVersion,
      operatingSystem: result.metadata.operatingSystem,
      adapter: {
        name: result.metadata.adapterName,
        vendor: result.metadata.adapterVendor,
        architecture: result.metadata.adapterArchitecture,
      },
      procedure: PROCEDURE,
      status: classifyWebGpuConformanceReason(reason),
      capabilityResult: "fail",
      fixtureResult: "not-run",
      performanceResult: "not-run",
      reason,
      benchmark: result,
      checkedAt: result.metadata.measuredAt,
    });
  }
  const fixtureDiagnostics = page.conformance as
    | {
        readonly fixtureDiagnostics?: readonly unknown[];
        readonly gpuFixtureDiagnostics?: readonly unknown[];
      }
    | undefined;
  const fixtureFailure =
    (fixtureDiagnostics?.fixtureDiagnostics?.length ?? 0) > 0 ||
    (fixtureDiagnostics?.gpuFixtureDiagnostics?.length ?? 0) > 0;
  const baseline =
    typeof page.baseline === "object" && page.baseline !== null && !Array.isArray(page.baseline)
      ? (page.baseline as {
          readonly status?: unknown;
          readonly regressions?: readonly unknown[];
          readonly diagnostics?: readonly unknown[];
        })
      : undefined;
  const baselineFailure = result.pass && baseline?.status === "fail";
  const passed = result.pass && !fixtureFailure && !baselineFailure;
  const baselineFailureReason = baselineFailure
    ? `Measured regression baseline failed: ${[
        ...(baseline.regressions ?? []),
        ...(baseline.diagnostics ?? []),
      ].join(" ")}`
    : undefined;
  const reason = passed
    ? undefined
    : [
        ...result.diagnostics,
        ...(fixtureFailure ? ["GPU conformance fixture diagnostics are non-empty."] : []),
        ...(baselineFailureReason === undefined ? [] : [baselineFailureReason]),
      ].join(" ");
  return Object.freeze({
    browser,
    releaseChannel,
    version: result.metadata.browserVersion,
    operatingSystem: result.metadata.operatingSystem,
    adapter: {
      name: result.metadata.adapterName,
      vendor: result.metadata.adapterVendor,
      architecture: result.metadata.adapterArchitecture,
    },
    procedure: PROCEDURE,
    status: passed ? "pass" : "fail",
    capabilityResult: "pass",
    fixtureResult: fixtureFailure ? "fail" : "pass",
    performanceResult: result.pass && !baselineFailure ? "pass" : "fail",
    reason,
    benchmark: result,
    checkedAt: result.metadata.measuredAt,
  });
}

function environmentOutcome(
  browser: string,
  releaseChannel: WebGpuBrowserReleaseChannel,
  status: "browser-missing" | "automation-unavailable",
  reason: string,
  machine: WebGpuHostMachine,
  version = "not-installed",
): WebGpuBrowserConformanceResult {
  return Object.freeze({
    browser,
    releaseChannel,
    version,
    operatingSystem: machine.operatingSystem,
    adapter: { name: undefined, vendor: undefined, architecture: undefined },
    procedure: PROCEDURE,
    status,
    capabilityResult: "not-run",
    fixtureResult: "not-run",
    performanceResult: "not-run",
    reason,
    benchmark: undefined,
    checkedAt: new Date().toISOString(),
  });
}

function missingBrowser(
  installation: WebGpuBrowserInstallation,
  machine: WebGpuHostMachine,
): WebGpuBrowserConformanceResult {
  const reason = `browser-missing: ${installation.browser} is not installed or available on the ${installation.platform} target machine.`;
  return environmentOutcome(
    installation.browser,
    installation.releaseChannel,
    "browser-missing",
    reason,
    machine,
  );
}

async function installedWithoutAutomation(
  installation: WebGpuBrowserInstallation,
  machine: WebGpuHostMachine,
): Promise<WebGpuBrowserConformanceResult> {
  const version = (await executableVersion(installation.path ?? "")) ?? "unknown";
  return environmentOutcome(
    installation.browser,
    installation.releaseChannel,
    "automation-unavailable",
    `automation-unavailable: ${installation.browser} executable is installed but this aggregate command has no ${installation.browser} driver adapter.`,
    machine,
    version,
  );
}

function staticServer(): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
      if (relative.split("/").includes("..")) {
        return new Response("Bad request", { status: 400 });
      }
      const pathname = resolve(process.cwd(), "dist", relative);
      const file = Bun.file(pathname);
      if (!(await file.exists())) {
        return new Response("Not found", { status: 404 });
      }
      const types: Readonly<Record<string, string>> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
      };
      return new Response(file, {
        headers: { "content-type": types[extname(pathname)] ?? "application/octet-stream" },
      });
    },
  });
}

async function availableSafariDriverPort(): Promise<number> {
  for (let port = 18_080; port < 18_100; port += 1) {
    try {
      await boundedFetch(
        `http://127.0.0.1:${String(port)}/status`,
        {},
        SAFARI_PORT_PROBE_TIMEOUT_MS,
        "SafariDriver port probe",
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("automation-unavailable: SafariDriver port probe timed out")
      ) {
        continue;
      }
      return port;
    }
  }
  throw new Error("automation-unavailable: no local SafariDriver port was available.");
}

/**
 * Sends one Safari WebDriver request with bounded network and response-body waits.
 *
 * @param port - Local WebDriver port.
 * @param pathname - WebDriver resource path.
 * @param init - Request method and body.
 * @param timeoutMs - Maximum request and response wait.
 * @returns The HTTP status and WebDriver `value` payload.
 * @throws Error when the request or response exceeds its deadline.
 */
export async function webDriverRequest(
  port: number,
  pathname: string,
  init: RequestInit = {},
  timeoutMs = WEBDRIVER_OPERATION_TIMEOUT_MS,
): Promise<{ readonly status: number; readonly value: unknown }> {
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  const label = `Safari WebDriver ${pathname}`;
  try {
    const response = await withWebGpuTimeout(
      fetch(`http://127.0.0.1:${String(port)}${pathname}`, {
        ...init,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
        signal: controller.signal,
      }),
      timeoutMs,
      label,
    );
    const body = (await withWebGpuTimeout(
      response.json(),
      Math.max(1, deadline - Date.now()),
      `${label} response`,
    )) as { readonly value?: unknown };
    return { status: response.status, value: body.value };
  } catch (error) {
    try {
      controller.abort();
    } catch {
      // A completed or mocked request may not expose abortable state.
    }
    throw error;
  }
}

function webdriverValueRecord(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("SafariDriver returned a non-object value.");
  }
  return value as JsonRecord;
}

type JsonRecord = Record<string, unknown>;

async function runSafari(
  machine: WebGpuHostMachine,
  releaseChannel: WebGpuBrowserReleaseChannel,
  baseline: WebGpuBenchmarkBaseline,
): Promise<WebGpuBrowserConformanceResult> {
  const safariVersion = await commandText(["safaridriver", "--version"], SAFARI_STARTUP_TIMEOUT_MS);
  const versionMatch = safariVersion.match(/Safari ([\d.]+)/);
  const version = versionMatch?.[1] ?? "unknown";
  const port = await availableSafariDriverPort();
  let safariDriver: Bun.Subprocess | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  let sessionId: string | undefined;
  try {
    safariDriver = Bun.spawn(["safaridriver", "--port", String(port)], {
      stdout: "ignore",
      stderr: "ignore",
    });
    server = staticServer();
    const deadline = Date.now() + SAFARI_STARTUP_TIMEOUT_MS;
    let driverReady = false;
    while (Date.now() < deadline) {
      try {
        const status = await boundedFetch(
          `http://127.0.0.1:${String(port)}/status`,
          {},
          Math.min(WEBDRIVER_OPERATION_TIMEOUT_MS, Math.max(1, deadline - Date.now())),
          "SafariDriver startup status",
        );
        if (status.ok) {
          driverReady = true;
          break;
        }
      } catch {
        // SafariDriver is still starting; each status request is independently bounded.
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    if (!driverReady) {
      throw new Error("automation-unavailable: SafariDriver did not become ready.");
    }
    const session = await webDriverRequest(port, "/session", {
      method: "POST",
      body: JSON.stringify({ capabilities: { alwaysMatch: { browserName: "safari" } } }),
    });
    if (session.status >= 300) {
      const details = webdriverValueRecord(session.value);
      const reason = String(details.message ?? "Safari WebDriver did not create a session.");
      return environmentOutcome(
        "Safari",
        releaseChannel,
        "automation-unavailable",
        `automation-unavailable: ${reason}`,
        machine,
        version,
      );
    }
    const sessionRecord = webdriverValueRecord(session.value);
    sessionId = String(sessionRecord.sessionId ?? "");
    if (sessionId.length === 0) {
      throw new Error("SafariDriver returned no session id.");
    }
    await webDriverRequest(port, `/session/${sessionId}/url`, {
      method: "POST",
      body: JSON.stringify({
        url: `${server?.url ?? ""}webgpu-scale-benchmark.html?conformance=safari`,
      }),
    });
    const deadlineForPage = Date.now() + SAFARI_BENCHMARK_TIMEOUT_MS;
    while (Date.now() < deadlineForPage) {
      const remainingForPage = deadlineForPage - Date.now();
      const execution = await webDriverRequest(
        port,
        `/session/${sessionId}/execute/sync`,
        {
          method: "POST",
          body: JSON.stringify({
            script:
              "const element = document.getElementById('webgpu-scale-result'); return element === null ? null : { state: element.className, text: element.textContent || '' };",
            args: [],
          }),
        },
        Math.min(WEBDRIVER_OPERATION_TIMEOUT_MS, Math.max(1, remainingForPage)),
      );
      if (execution.status < 300 && execution.value !== null) {
        const snapshot = webdriverValueRecord(execution.value);
        const state = snapshot.state;
        if (state === "pass" || state === "fail" || state === "unavailable") {
          const page = parseWebGpuBenchmarkOutput(
            String(snapshot.text ?? ""),
            state,
            thresholdBaseline(baseline),
            machine,
            version,
          );
          return resultForPage("Safari", releaseChannel, page, machine);
        }
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
    throw new Error("automation-unavailable: Safari benchmark page did not reach terminal JSON.");
  } finally {
    if (sessionId !== undefined) {
      try {
        await Promise.race([
          webDriverRequest(port, `/session/${sessionId}`, { method: "DELETE" }),
          new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000)),
        ]);
      } catch {
        // The process cleanup below is authoritative when the session is already gone.
      }
    }
    await cleanupWebGpuBrowserResources({
      ...(safariDriver === undefined ? {} : { browser: safariDriver }),
      label: "SafariDriver",
      timeoutMs: PROCESS_CLEANUP_TIMEOUT_MS,
      independentCleanup: [() => server?.stop(true)],
    });
  }
}

async function runChrome(
  browserPath: string,
  releaseChannel: WebGpuBrowserReleaseChannel,
  machine: WebGpuHostMachine,
  baseline: WebGpuBenchmarkBaseline,
): Promise<WebGpuBrowserConformanceResult> {
  const temporary = await mkdtemp(join(tmpdir(), "webgpu-conformance-"));
  const outputPath = join(temporary, "chrome.json");
  let driver: Bun.Subprocess | undefined;
  try {
    driver = Bun.spawn(
      ["bun", "run", "benchmark:webgpu-scale", "--", "--no-build", "--write-result", outputPath],
      {
        stdout: "ignore",
        stderr: "ignore",
        env: { ...process.env, WEBGPU_BROWSER: browserPath },
      },
    );
    if (!(await waitForProcessExit(driver, SAFARI_BENCHMARK_TIMEOUT_MS))) {
      throw new Error("automation-unavailable: Chrome conformance driver timed out.");
    }
    driver = undefined;
    if (!(await Bun.file(outputPath).exists())) {
      throw new Error("automation-unavailable: Chrome driver produced no result file.");
    }
    const output = webdriverValueRecord(await Bun.file(outputPath).json());
    const result = webdriverValueRecord(output.result);
    const conformance = output.conformance;
    const conformanceRecord =
      typeof conformance === "object" && conformance !== null && !Array.isArray(conformance)
        ? (conformance as JsonRecord)
        : undefined;
    const canonicalPageBaseline = compareWebGpuBenchmarkBaseline(
      result as unknown as WebGpuBenchmarkResult,
      defaultWebGpuBenchmarkBaseline(),
    );
    const pageState =
      result.status === "unavailable"
        ? "unavailable"
        : result.pass === true &&
            canonicalPageBaseline.status === "pass" &&
            Array.isArray(conformanceRecord?.fixtureDiagnostics) &&
            conformanceRecord.fixtureDiagnostics.length === 0 &&
            Array.isArray(conformanceRecord?.gpuFixtureDiagnostics) &&
            conformanceRecord.gpuFixtureDiagnostics.length === 0
          ? "pass"
          : "fail";
    const page = parseWebGpuBenchmarkOutput(
      JSON.stringify({ result, baseline: canonicalPageBaseline, conformance }),
      pageState,
      baseline,
      machine,
    );
    return resultForPage("Chrome", releaseChannel, page, machine);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Chrome conformance driver failed.";
    return Object.freeze({
      browser: "Chrome",
      releaseChannel,
      version: "unknown",
      operatingSystem: machine.operatingSystem,
      adapter: { name: undefined, vendor: undefined, architecture: undefined },
      procedure: PROCEDURE,
      status: "automation-unavailable",
      capabilityResult: "not-run",
      fixtureResult: "not-run",
      performanceResult: "not-run",
      reason: reason.startsWith("automation-unavailable:")
        ? reason
        : `automation-unavailable: ${reason}`,
      benchmark: undefined,
      checkedAt: new Date().toISOString(),
    });
  } finally {
    await cleanupWebGpuBrowserResources({
      ...(driver === undefined ? {} : { browser: driver }),
      label: "Chrome conformance driver",
      timeoutMs: PROCESS_CLEANUP_TIMEOUT_MS,
      confirmedExitCleanup: [() => rm(temporary, { recursive: true, force: true })],
    });
  }
}

function thresholdBaseline(baseline: WebGpuBenchmarkBaseline): WebGpuBenchmarkBaseline {
  const { measuredBaseline, ...thresholdsOnly } = baseline;
  void measuredBaseline;
  return Object.freeze(thresholdsOnly);
}

async function run(): Promise<void> {
  const machine = await detectWebGpuHostMachine();
  const baseline = await loadWebGpuBenchmarkBaseline();
  const thresholdsOnly = thresholdBaseline(baseline);
  await commandText(["bun", "run", "build"], SAFARI_BENCHMARK_TIMEOUT_MS);
  const results: WebGpuBrowserConformanceResult[] = [];
  const installations = await discoverWebGpuBrowsers();
  const chrome = installations.find((installation) => installation.browser === "Chrome");
  if (chrome?.path !== undefined) {
    try {
      results.push(await runChrome(chrome.path, chrome.releaseChannel, machine, baseline));
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Chrome conformance execution failed.";
      results.push(
        environmentOutcome(
          "Chrome",
          chrome.releaseChannel,
          "automation-unavailable",
          reason.startsWith("automation-unavailable:")
            ? reason
            : `automation-unavailable: ${reason}`,
          machine,
        ),
      );
    }
  } else if (chrome !== undefined) {
    results.push(missingBrowser(chrome, machine));
  }
  for (const browser of ["Edge", "Firefox"] as const) {
    const installation = installations.find((candidate) => candidate.browser === browser);
    if (installation?.path !== undefined) {
      results.push(await installedWithoutAutomation(installation, machine));
    } else if (installation !== undefined) {
      results.push(missingBrowser(installation, machine));
    }
  }
  const safari = installations.find((installation) => installation.browser === "Safari");
  if (safari?.path !== undefined) {
    try {
      results.push(await runSafari(machine, safari.releaseChannel, thresholdsOnly));
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Safari conformance execution failed.";
      results.push(
        environmentOutcome(
          "Safari",
          safari.releaseChannel,
          "automation-unavailable",
          reason.startsWith("automation-unavailable:")
            ? reason
            : `automation-unavailable: ${reason}`,
          machine,
          "unknown",
        ),
      );
    }
  } else if (safari !== undefined) {
    results.push(missingBrowser(safari, machine));
  }
  const report: WebGpuBrowserConformanceReport = Object.freeze({
    reportVersion: "webgpu-conformance-v1",
    releaseChannel: aggregateWebGpuReleaseChannel(results),
    measuredAt: new Date().toISOString(),
    machine,
    procedure: PROCEDURE,
    summary: summarizeWebGpuConformance(results),
    browsers: Object.freeze(results),
  });
  const destination = process.argv.includes("--write-result")
    ? process.argv[process.argv.indexOf("--write-result") + 1]
    : undefined;
  if (destination !== undefined) {
    await mkdir(dirname(resolve(process.cwd(), destination)), { recursive: true });
    await Bun.write(resolve(process.cwd(), destination), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) {
  try {
    await run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
