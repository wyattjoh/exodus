import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join, win32 } from "node:path";
import type { WebGpuBenchmarkMachine } from "../src/webgpu-scale";

export const WEBGPU_DESKTOP_BROWSERS = ["Chrome", "Edge", "Firefox", "Safari"] as const;
export type WebGpuDesktopBrowser = (typeof WEBGPU_DESKTOP_BROWSERS)[number];

/**
 * Browser channel metadata used to prevent stable evidence claims for unknown overrides.
 */
export type WebGpuBrowserReleaseChannel = "stable" | "unknown";

export type WebGpuBrowserInstallation = {
  readonly browser: WebGpuDesktopBrowser;
  readonly platform: string;
  readonly path: string | undefined;
  readonly source: "environment" | "known-path" | "path" | "missing";
  readonly releaseChannel: WebGpuBrowserReleaseChannel;
};

/**
 * Minimal lifecycle surface shared by every spawned external process.
 */
export type WebGpuProcess = {
  readonly exited: Promise<unknown>;
  readonly kill: (signal?: number | WebGpuProcessSignal) => unknown;
};

/**
 * Injectable lifecycle surface for one bounded external command.
 */
export type WebGpuCommandProcess = WebGpuProcess & {
  readonly stdout: ReadableStream<Uint8Array> | null | undefined;
  readonly stderr: ReadableStream<Uint8Array> | null | undefined;
};

/**
 * Signal names recorded by the bounded process-termination state machine.
 */
export type WebGpuProcessSignal = "SIGTERM" | "SIGKILL";

/**
 * Observable result of bounded process termination.
 */
export type WebGpuProcessTermination = {
  readonly confirmedExit: boolean;
  readonly phase: "natural-exit" | "sigterm-exit" | "sigkill-exit" | "unconfirmed";
  readonly signals: readonly WebGpuProcessSignal[];
  readonly errors: readonly string[];
};

/**
 * Callbacks used for teardown that is independent of process termination or safe only after exit.
 */
export type WebGpuProcessCleanupOptions = {
  readonly label?: string;
  readonly timeoutMs?: number;
  readonly independentCleanup?: readonly (() => unknown)[];
  readonly confirmedExitCleanup?: readonly (() => unknown)[];
};

/**
 * Options for the bounded external-command runner.
 */
export type WebGpuCommandRunnerOptions = {
  readonly timeoutMs?: number;
  /** Maximum bytes read from each piped output stream; never above the hard default cap. */
  readonly maxOutputBytes?: number;
  /** Working directory for the default child process. */
  readonly cwd?: string;
  /** Environment for the default child process; omitted values inherit the host environment. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Injectable child-process seam used by deterministic tests. */
  readonly spawn?: (command: readonly string[]) => WebGpuCommandProcess;
};

/**
 * Bounded command output and exit status.
 */
export type WebGpuCommandResult = {
  readonly exitCode: number | undefined;
  readonly stdout: string;
  readonly stderr: string;
};

/**
 * Default maximum bytes consumed from each external-command output stream.
 */
export const MAX_WEBGPU_COMMAND_OUTPUT_BYTES = 64 * 1024;

const DEFAULT_WEBGPU_COMMAND_TIMEOUT_MS = 5_000;
const WEBGPU_COMMAND_CLEANUP_TIMEOUT_MS = 2_000;
const WEBGPU_COMMAND_KILL_GRACE_MS = 250;

export type WebGpuBrowserDiscoveryOptions = {
  /** Platform seam used by deterministic discovery tests; defaults to process.platform. */
  readonly platform?: string;
  /** Environment seam used by deterministic discovery tests; defaults to process.env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** PATH-entry seam; defaults to the platform PATH value. */
  readonly pathEntries?: readonly string[];
  /** Executability seam; defaults to an X_OK filesystem check. */
  readonly isExecutable?: (pathname: string) => Promise<boolean> | boolean;
};

function commandTimeoutMilliseconds(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_WEBGPU_COMMAND_TIMEOUT_MS;
  }
  return Math.max(1, Math.ceil(timeoutMs));
}

function commandOutputLimitBytes(maxOutputBytes: number | undefined): number {
  if (
    maxOutputBytes === undefined ||
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes <= 0
  ) {
    return MAX_WEBGPU_COMMAND_OUTPUT_BYTES;
  }
  return Math.min(maxOutputBytes, MAX_WEBGPU_COMMAND_OUTPUT_BYTES);
}

function processCleanupTimeoutMilliseconds(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return WEBGPU_COMMAND_CLEANUP_TIMEOUT_MS;
  }
  return Math.max(1, Math.ceil(timeoutMs));
}

function processWaitTimeoutMilliseconds(deadline: number, maximum: number): number {
  return Math.max(1, Math.min(maximum, deadline - Date.now()));
}

function withCommandTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const pending = Promise.resolve(operation);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(`automation-unavailable: ${label} timed out after ${String(timeoutMs)}ms.`));
    }, timeoutMs);
    pending.then(
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function readBoundedCommandOutput(
  stream: ReadableStream<Uint8Array> | null | undefined,
  deadline: number,
  maxOutputBytes: number,
  label: string,
): Promise<string> {
  if (stream === null || stream === undefined) {
    return "";
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`automation-unavailable: ${label} output read timed out.`);
      }
      const next = await withCommandTimeout(reader.read(), Math.max(1, remaining), label);
      if (next.done) {
        break;
      }
      totalBytes += next.value.byteLength;
      if (totalBytes > maxOutputBytes) {
        throw new Error(
          `automation-unavailable: ${label} output exceeded ${String(maxOutputBytes)} bytes.`,
        );
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  } catch (error) {
    try {
      void Promise.resolve(reader.cancel()).catch(() => undefined);
    } catch {
      // Continue bounded process cleanup when an injected reader cannot cancel.
    }
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The stream may already have released its reader after cancellation.
    }
  }
}

function defaultCommandProcess(
  command: readonly string[],
  options: WebGpuCommandRunnerOptions,
): WebGpuCommandProcess {
  return Bun.spawn([...command], {
    stdout: "pipe",
    stderr: "pipe",
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
  }) as unknown as WebGpuCommandProcess;
}

type ProcessExitWait = {
  readonly confirmedExit: boolean;
  readonly outcome: "exited" | "timed-out" | "rejected" | "unreadable";
  readonly error: string | undefined;
};

async function waitForProcessExitState(
  process: WebGpuProcess,
  timeoutMs: number,
  label: string,
): Promise<ProcessExitWait> {
  let exited: Promise<unknown>;
  try {
    exited = process.exited;
  } catch (error) {
    return Object.freeze({
      confirmedExit: false,
      outcome: "unreadable",
      error: errorMessage(error),
    });
  }
  try {
    const outcome = await withCommandTimeout(
      Promise.resolve(exited).then(
        () => ({ outcome: "exited" as const, error: undefined }),
        (error: unknown) => ({ outcome: "rejected" as const, error: errorMessage(error) }),
      ),
      Math.max(1, timeoutMs),
      label,
    );
    return Object.freeze({
      confirmedExit: outcome.outcome === "exited",
      outcome: outcome.outcome,
      error: outcome.error,
    });
  } catch (error) {
    return Object.freeze({
      confirmedExit: false,
      outcome: "timed-out",
      error: errorMessage(error),
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Waits for a process to confirm natural exit without treating rejection as proof of termination.
 *
 * @param process - Spawned process lifecycle seam.
 * @param timeoutMs - Maximum wait for exit confirmation.
 * @returns True only when the exited promise fulfills.
 */
export async function waitForProcessExit(
  process: WebGpuProcess,
  timeoutMs: number,
): Promise<boolean> {
  const wait = await waitForProcessExitState(
    process,
    processCleanupTimeoutMilliseconds(timeoutMs),
    "process natural exit",
  );
  return wait.confirmedExit;
}

function appendExitWaitError(errors: string[], label: string, wait: ProcessExitWait): void {
  if (wait.confirmedExit) {
    return;
  }
  errors.push(
    wait.error === undefined
      ? `${label} ${wait.outcome}`
      : `${label} ${wait.outcome}: ${wait.error}`,
  );
}

/**
 * Terminates one process with observable natural-exit, SIGTERM, and SIGKILL phases.
 *
 * A rejected or unreadable `exited` promise is never treated as proof of termination. Kill and
 * exit-channel failures are retained in the result while every escalation phase is attempted.
 *
 * @param process - Spawned process lifecycle seam.
 * @param timeoutMs - Bounded total cleanup window used for exit phases.
 * @param label - Diagnostic process name.
 * @returns The confirmed phase, signal ordering, and contained lifecycle errors.
 */
export async function terminateWebGpuProcess(
  process: WebGpuProcess,
  timeoutMs = WEBGPU_COMMAND_CLEANUP_TIMEOUT_MS,
  label = "external process",
): Promise<WebGpuProcessTermination> {
  const signals: WebGpuProcessSignal[] = [];
  const errors: string[] = [];
  const totalTimeoutMs = processCleanupTimeoutMilliseconds(timeoutMs);
  const deadline = Date.now() + totalTimeoutMs;
  const grace = Math.min(WEBGPU_COMMAND_KILL_GRACE_MS, totalTimeoutMs);
  const natural = await waitForProcessExitState(
    process,
    processWaitTimeoutMilliseconds(deadline, grace),
    `${label} natural exit`,
  );
  appendExitWaitError(errors, `${label} natural exit`, natural);
  if (natural.confirmedExit) {
    return Object.freeze({
      confirmedExit: true,
      phase: "natural-exit",
      signals: Object.freeze(signals),
      errors: Object.freeze(errors),
    });
  }

  signals.push("SIGTERM");
  try {
    process.kill("SIGTERM");
  } catch (error) {
    errors.push(`${label} SIGTERM failed: ${errorMessage(error)}`);
  }
  const sigterm = await waitForProcessExitState(
    process,
    processWaitTimeoutMilliseconds(deadline, grace),
    `${label} SIGTERM exit`,
  );
  appendExitWaitError(errors, `${label} SIGTERM exit`, sigterm);
  if (sigterm.confirmedExit) {
    return Object.freeze({
      confirmedExit: true,
      phase: "sigterm-exit",
      signals: Object.freeze(signals),
      errors: Object.freeze(errors),
    });
  }

  signals.push("SIGKILL");
  try {
    process.kill("SIGKILL");
  } catch (error) {
    errors.push(`${label} SIGKILL failed: ${errorMessage(error)}`);
  }
  const sigkill = await waitForProcessExitState(
    process,
    processWaitTimeoutMilliseconds(deadline, totalTimeoutMs),
    `${label} SIGKILL exit`,
  );
  appendExitWaitError(errors, `${label} SIGKILL exit`, sigkill);
  return Object.freeze({
    confirmedExit: sigkill.confirmedExit,
    phase: sigkill.confirmedExit ? "sigkill-exit" : "unconfirmed",
    signals: Object.freeze(signals),
    errors: Object.freeze(errors),
  });
}

/**
 * Describes an unconfirmed process exit as an automation failure.
 *
 * @param label - Diagnostic process name.
 * @param termination - State-machine result.
 * @returns A failure only when process exit was not confirmed.
 */
export function webGpuProcessTerminationFailure(
  label: string,
  termination: WebGpuProcessTermination,
): Error | undefined {
  if (termination.confirmedExit) {
    return undefined;
  }
  const signals = termination.signals.length === 0 ? "none" : termination.signals.join(" -> ");
  const details = [`phase=${termination.phase}`, `signals=${signals}`, ...termination.errors].join(
    "; ",
  );
  return new Error(`automation-unavailable: ${label} exit could not be confirmed (${details}).`);
}

/**
 * Attempts process-independent cleanup and gates temporary-resource removal on confirmed exit.
 *
 * @param process - Spawned process, or undefined when no child was created.
 * @param options - Cleanup labels, bounded waits, and independent/confirmed callbacks.
 * @returns The process termination result when a process was supplied.
 * @throws Error when process exit or cleanup cannot be confirmed.
 */
export async function cleanupWebGpuProcess(
  process: WebGpuProcess | undefined,
  options: WebGpuProcessCleanupOptions = {},
): Promise<WebGpuProcessTermination | undefined> {
  const label = options.label ?? "external process";
  const timeoutMs = processCleanupTimeoutMilliseconds(
    options.timeoutMs ?? WEBGPU_COMMAND_CLEANUP_TIMEOUT_MS,
  );
  const errors: string[] = [];
  let termination: WebGpuProcessTermination | undefined;
  let confirmedExit = process === undefined;
  if (process !== undefined) {
    try {
      termination = await terminateWebGpuProcess(process, timeoutMs, label);
      confirmedExit = termination.confirmedExit;
      const failure = webGpuProcessTerminationFailure(label, termination);
      if (failure !== undefined) {
        errors.push(failure.message);
      }
    } catch (error) {
      errors.push(`automation-unavailable: ${label} termination failed: ${errorMessage(error)}.`);
    }
  }
  for (const [index, cleanup] of (options.independentCleanup ?? []).entries()) {
    try {
      await withCommandTimeout(
        Promise.resolve().then(cleanup),
        timeoutMs,
        `${label} independent cleanup ${String(index + 1)}`,
      );
    } catch (error) {
      errors.push(
        `${label} independent cleanup ${String(index + 1)} failed: ${errorMessage(error)}.`,
      );
    }
  }
  if (confirmedExit) {
    for (const [index, cleanup] of (options.confirmedExitCleanup ?? []).entries()) {
      try {
        await withCommandTimeout(
          Promise.resolve().then(cleanup),
          timeoutMs,
          `${label} confirmed-exit cleanup ${String(index + 1)}`,
        );
      } catch (error) {
        errors.push(
          `${label} confirmed-exit cleanup ${String(index + 1)} failed: ${errorMessage(error)}.`,
        );
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join(" "));
  }
  return termination;
}

/**
 * Runs one external command with bounded exit, kill, and stdout/stderr handling.
 *
 * @param command - Executable and arguments to run.
 * @param options - Timeout, output cap, and injectable process seam.
 * @returns Bounded decoded output and the settled exit code.
 * @throws Error when spawning, waiting, or reading output cannot complete safely.
 */
export async function runBoundedWebGpuCommand(
  command: readonly string[],
  options: WebGpuCommandRunnerOptions = {},
): Promise<WebGpuCommandResult> {
  const timeoutMs = commandTimeoutMilliseconds(options.timeoutMs);
  const maxOutputBytes = commandOutputLimitBytes(options.maxOutputBytes);
  let process: WebGpuCommandProcess;
  try {
    process = (options.spawn ?? ((commandValue) => defaultCommandProcess(commandValue, options)))(
      command,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown spawn failure";
    throw new Error(
      `automation-unavailable: ${command[0] ?? "command"} could not start (${detail}).`,
    );
  }
  const deadline = Date.now() + timeoutMs;
  let stdout: Promise<string> | undefined;
  let stderr: Promise<string> | undefined;
  try {
    stdout = readBoundedCommandOutput(
      process.stdout,
      deadline,
      maxOutputBytes,
      `${command[0] ?? "command"} stdout`,
    );
    stderr = readBoundedCommandOutput(
      process.stderr,
      deadline,
      maxOutputBytes,
      `${command[0] ?? "command"} stderr`,
    );
    const [exitCode, [stdoutText, stderrText]] = await Promise.all([
      withCommandTimeout(
        process.exited,
        Math.max(1, deadline - Date.now()),
        `${command[0] ?? "command"} process exit`,
      ),
      Promise.all([stdout, stderr]),
    ]);
    return Object.freeze({
      exitCode: typeof exitCode === "number" ? exitCode : undefined,
      stdout: stdoutText,
      stderr: stderrText,
    });
  } catch (error) {
    void stdout?.catch(() => undefined);
    void stderr?.catch(() => undefined);
    const termination = await terminateWebGpuProcess(
      process,
      Math.min(WEBGPU_COMMAND_CLEANUP_TIMEOUT_MS, timeoutMs),
      command[0] ?? "command",
    );
    const terminationFailure = webGpuProcessTerminationFailure(
      command[0] ?? "command",
      termination,
    );
    if (terminationFailure !== undefined) {
      const detail = errorMessage(error);
      throw new Error(`${terminationFailure.message} Original failure: ${detail}.`);
    }
    if (error instanceof Error && error.message.startsWith("automation-unavailable:")) {
      throw error;
    }
    const detail = errorMessage(error);
    throw new Error(`automation-unavailable: ${command[0] ?? "command"} failed (${detail}).`);
  }
}

const BROWSER_OVERRIDE_KEYS: Record<WebGpuDesktopBrowser, readonly string[]> = {
  Chrome: ["WEBGPU_BROWSER", "WEBGPU_CHROME", "CHROME_PATH"],
  Edge: ["WEBGPU_EDGE", "EDGE_PATH"],
  Firefox: ["WEBGPU_FIREFOX", "FIREFOX_PATH"],
  Safari: ["WEBGPU_SAFARI", "SAFARI_PATH"],
};

const BROWSER_PATH_COMMANDS: Record<WebGpuDesktopBrowser, readonly string[]> = {
  // The stable conformance matrix intentionally excludes generic Chromium and beta binaries.
  Chrome: ["google-chrome", "google-chrome-stable"],
  Edge: ["microsoft-edge", "microsoft-edge-stable", "msedge"],
  Firefox: ["firefox", "firefox-esr"],
  Safari: [],
};

function pathForPlatform(platform: string, base: string, ...parts: string[]): string {
  return platform === "win32" ? win32.join(base, ...parts) : join(base, ...parts);
}

function knownBrowserPaths(
  browser: WebGpuDesktopBrowser,
  platform: string,
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  if (platform === "darwin") {
    const applications = "/Applications";
    const paths: Record<WebGpuDesktopBrowser, readonly string[]> = {
      Chrome: [
        pathForPlatform(
          platform,
          applications,
          "Google Chrome.app",
          "Contents",
          "MacOS",
          "Google Chrome",
        ),
      ],
      Edge: [
        pathForPlatform(
          platform,
          applications,
          "Microsoft Edge.app",
          "Contents",
          "MacOS",
          "Microsoft Edge",
        ),
      ],
      Firefox: [
        pathForPlatform(platform, applications, "Firefox.app", "Contents", "MacOS", "firefox"),
      ],
      Safari: [
        pathForPlatform(platform, applications, "Safari.app", "Contents", "MacOS", "Safari"),
      ],
    };
    return paths[browser];
  }

  if (platform === "win32") {
    const programFiles = env.ProgramW6432 ?? env.ProgramFiles ?? "C:\\Program Files";
    const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const localAppData = env.LOCALAPPDATA ?? "C:\\Users\\user\\AppData\\Local";
    const paths: Record<WebGpuDesktopBrowser, readonly string[]> = {
      Chrome: [
        pathForPlatform(platform, programFiles, "Google", "Chrome", "Application", "chrome.exe"),
        pathForPlatform(platform, programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
        pathForPlatform(platform, localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      ],
      Edge: [
        pathForPlatform(platform, programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
        pathForPlatform(
          platform,
          programFilesX86,
          "Microsoft",
          "Edge",
          "Application",
          "msedge.exe",
        ),
      ],
      Firefox: [
        pathForPlatform(platform, programFiles, "Mozilla Firefox", "firefox.exe"),
        pathForPlatform(platform, programFilesX86, "Mozilla Firefox", "firefox.exe"),
      ],
      Safari: [],
    };
    return paths[browser];
  }

  if (platform === "linux" || platform === "freebsd") {
    const roots = ["/usr/bin", "/usr/local/bin", "/snap/bin"];
    const commands = BROWSER_PATH_COMMANDS[browser];
    return roots.flatMap((root) => commands.map((command) => join(root, command)));
  }

  return [];
}

function pathCommandsForPlatform(
  browser: WebGpuDesktopBrowser,
  platform: string,
): readonly string[] {
  const commands = BROWSER_PATH_COMMANDS[browser];
  return platform === "win32"
    ? commands.map((command) => (command.endsWith(".exe") ? command : `${command}.exe`))
    : commands;
}

function uniquePaths(paths: readonly string[]): readonly string[] {
  return [...new Set(paths.filter((pathname) => pathname.length > 0))];
}

/**
 * Discovers one desktop browser without assuming the coordinator's host platform or installed
 * applications. Environment overrides win, followed by known platform locations and PATH.
 *
 * @param browser - Browser to locate.
 * @param options - Injectable platform, environment, PATH, and filesystem seams.
 * @returns A truthful installation record; a missing browser has no guessed executable path.
 */
export async function discoverWebGpuBrowser(
  browser: WebGpuDesktopBrowser,
  options: WebGpuBrowserDiscoveryOptions = {},
): Promise<WebGpuBrowserInstallation> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const isExecutable = options.isExecutable ?? existingExecutable;
  const overrides = BROWSER_OVERRIDE_KEYS[browser].flatMap((key) => {
    const value = env[key];
    return value === undefined || value.length === 0 ? [] : [value];
  });
  if (overrides.length > 0) {
    for (const pathname of uniquePaths(overrides)) {
      try {
        if (await isExecutable(pathname)) {
          return Object.freeze({
            browser,
            platform,
            path: pathname,
            source: "environment",
            releaseChannel: "unknown",
          });
        }
      } catch {
        // An explicit but inaccessible override is a missing requested browser, not a fallback.
      }
    }
    return Object.freeze({
      browser,
      platform,
      path: undefined,
      source: "missing",
      releaseChannel: "unknown",
    });
  }
  const known = knownBrowserPaths(browser, platform, env);
  const delimiter = platform === "win32" ? ";" : ":";
  const pathEntries =
    options.pathEntries ??
    (env.PATH ?? "")
      .split(delimiter)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  const pathCandidates = pathEntries.flatMap((entry) =>
    pathCommandsForPlatform(browser, platform).map((command) =>
      pathForPlatform(platform, entry, command),
    ),
  );
  const candidates: readonly (readonly [string, WebGpuBrowserInstallation["source"]])[] = [
    ...uniquePaths(overrides).map(
      (pathname): readonly [string, WebGpuBrowserInstallation["source"]] => [
        pathname,
        "environment",
      ],
    ),
    ...uniquePaths(known).map(
      (pathname): readonly [string, WebGpuBrowserInstallation["source"]] => [
        pathname,
        "known-path",
      ],
    ),
    ...uniquePaths(pathCandidates).map(
      (pathname): readonly [string, WebGpuBrowserInstallation["source"]] => [pathname, "path"],
    ),
  ];
  for (const [pathname, source] of candidates) {
    try {
      if (await isExecutable(pathname)) {
        return Object.freeze({
          browser,
          platform,
          path: pathname,
          source,
          releaseChannel: "stable",
        });
      }
    } catch {
      // A broken or inaccessible candidate is absent, not evidence of another browser.
    }
  }
  return Object.freeze({
    browser,
    platform,
    path: undefined,
    source: "missing",
    releaseChannel: "stable",
  });
}

/**
 * Discovers all desktop browser candidates concurrently while preserving browser order.
 *
 * @param options - Injectable discovery seams.
 * @returns One truthful installation record per supported browser name.
 */
export async function discoverWebGpuBrowsers(
  options: WebGpuBrowserDiscoveryOptions = {},
): Promise<readonly WebGpuBrowserInstallation[]> {
  return Object.freeze(
    await Promise.all(
      WEBGPU_DESKTOP_BROWSERS.map((browser) => discoverWebGpuBrowser(browser, options)),
    ),
  );
}

export type WebGpuHostMachine = WebGpuBenchmarkMachine;

/**
 * Injectable command seam for deterministic host-identity tests.
 */
export type WebGpuHostDetectionOptions = {
  /** Injectable process seam and bounded runner options for deterministic tests. */
  readonly command?: WebGpuCommandRunnerOptions;
};

const HOST_COMMAND_TIMEOUT_MS = 5_000;

async function commandOutput(
  command: readonly string[],
  options: WebGpuCommandRunnerOptions = {},
): Promise<string | undefined> {
  try {
    const output = await runBoundedWebGpuCommand(command, {
      ...options,
      timeoutMs: options.timeoutMs ?? HOST_COMMAND_TIMEOUT_MS,
    });
    if (output.exitCode !== 0) {
      return undefined;
    }
    return (output.stdout || output.stderr).trim() || undefined;
  } catch {
    return undefined;
  }
}

function valueOrUnknown(value: string | undefined): string {
  return value === undefined || value.length === 0 ? "unknown" : value;
}

function memoryDescription(value: string | undefined): string {
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    return valueOrUnknown(value);
  }
  const gibibytes = bytes / 1024 ** 3;
  return `${Number.isInteger(gibibytes) ? String(gibibytes) : gibibytes.toFixed(1)} GiB`;
}

function hostMetalVersion(displayData: string | undefined): string | undefined {
  return displayData?.match(/Metal Support:\s*(Metal\s+[\d.]+)/i)?.[1];
}

/**
 * Detects host evidence without manufacturing a machine identity for another target.
 *
 * macOS values come from the host's own system tools. Missing values remain `unknown`; they are
 * never replaced with the coordinator's machine details. The WebGPU adapter's architecture is
 * reported separately by the browser page and must not be inferred from host Metal support.
 *
 * @param options - Optional bounded command seam for deterministic tests.
 * @returns Host identity and graphics API evidence, with missing values as unknown.
 */
export async function detectWebGpuHostMachine(
  options: WebGpuHostDetectionOptions = {},
): Promise<WebGpuHostMachine> {
  if (process.platform !== "darwin") {
    return Object.freeze({
      model: "unknown",
      chip: "unknown",
      memory: "unknown",
      operatingSystem: process.platform,
      hostGraphicsApi: { name: undefined, version: undefined },
    });
  }
  const [model, chip, memory, version, build, displayData] = await Promise.all([
    commandOutput(["sysctl", "-n", "hw.model"], options.command),
    commandOutput(["sysctl", "-n", "machdep.cpu.brand_string"], options.command),
    commandOutput(["sysctl", "-n", "hw.memsize"], options.command),
    commandOutput(["sw_vers", "-productVersion"], options.command),
    commandOutput(["sw_vers", "-buildVersion"], options.command),
    commandOutput(["system_profiler", "SPDisplaysDataType"], options.command),
  ]);
  const operatingSystem =
    version === undefined
      ? "macOS unknown"
      : build === undefined
        ? `macOS ${version}`
        : `macOS ${version} (${build})`;
  return Object.freeze({
    model: valueOrUnknown(model),
    chip: valueOrUnknown(chip),
    memory: memoryDescription(memory),
    operatingSystem,
    hostGraphicsApi: Object.freeze({
      name:
        displayData === undefined || hostMetalVersion(displayData) === undefined
          ? undefined
          : "Metal",
      version: hostMetalVersion(displayData),
    }),
  });
}

export async function existingExecutable(pathname: string): Promise<boolean> {
  try {
    await access(pathname, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads a browser executable version through the bounded command runner.
 *
 * @param pathname - Executable path to invoke with `--version`.
 * @param options - Optional timeout, output cap, and injected process seam.
 * @returns The first dotted numeric version, or undefined when execution is unavailable.
 */
export async function executableVersion(
  pathname: string,
  options: WebGpuCommandRunnerOptions = {},
): Promise<string | undefined> {
  try {
    const output = await runBoundedWebGpuCommand([pathname, "--version"], {
      ...options,
      timeoutMs: options.timeoutMs ?? HOST_COMMAND_TIMEOUT_MS,
    });
    if (output.exitCode !== 0) {
      return undefined;
    }
    return (output.stdout || output.stderr).match(/(\d+(?:\.\d+)+)/)?.[1];
  } catch {
    return undefined;
  }
}
