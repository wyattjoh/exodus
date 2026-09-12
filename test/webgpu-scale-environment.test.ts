import { describe, expect, test } from "bun:test";
import {
  discoverWebGpuBrowser,
  discoverWebGpuBrowsers,
  executableVersion,
  runBoundedWebGpuCommand,
  type WebGpuCommandProcess,
} from "../scripts/webgpu-scale-environment";

function filesystem(paths: readonly string[]): (pathname: string) => boolean {
  const available = new Set(paths);
  return (pathname) => available.has(pathname);
}

function outputStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function processWithOutput(
  stdout: string,
  options: {
    readonly exitCode?: number;
    readonly settleOnKill?: boolean;
    readonly settleOnSecondKill?: boolean;
  } = {},
): WebGpuCommandProcess & { readonly killCalls: () => number } {
  let resolveExit: (value: number) => void = () => undefined;
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  if (options.exitCode !== undefined) {
    resolveExit(options.exitCode);
  }
  let killCalls = 0;
  return {
    exited,
    stdout: outputStream(stdout),
    stderr: outputStream(""),
    kill: () => {
      killCalls += 1;
      if (options.settleOnKill !== false || (options.settleOnSecondKill && killCalls > 1)) {
        resolveExit(137);
      }
    },
    killCalls: () => killCalls,
  };
}

describe("WebGPU desktop browser discovery", () => {
  test("escalates a hanging child kill within the shared command deadline", async () => {
    const process = processWithOutput("version", {
      settleOnKill: false,
      settleOnSecondKill: true,
    });
    await expect(
      runBoundedWebGpuCommand(["fake-browser", "--version"], {
        timeoutMs: 5,
        spawn: () => process,
      }),
    ).rejects.toThrow("process exit timed out");
    expect(process.killCalls()).toBe(2);
  });

  test("bounds oversized command output and reports unknown browser versions", async () => {
    const process = processWithOutput("123456789", { exitCode: 0, settleOnKill: true });
    await expect(
      runBoundedWebGpuCommand(["fake-browser", "--version"], {
        timeoutMs: 50,
        maxOutputBytes: 8,
        spawn: () => process,
      }),
    ).rejects.toThrow("output exceeded");
    expect(process.killCalls()).toBe(0);
    const versionProcess = processWithOutput("123456789", { exitCode: 0, settleOnKill: true });
    await expect(
      executableVersion("fake-browser", {
        timeoutMs: 50,
        maxOutputBytes: 8,
        spawn: () => versionProcess,
      }),
    ).resolves.toBeUndefined();
    expect(versionProcess.killCalls()).toBe(0);
  });

  test("uses an explicit Chrome override before platform locations", async () => {
    const installation = await discoverWebGpuBrowser("Chrome", {
      platform: "darwin",
      env: {
        WEBGPU_BROWSER: "/opt/test/Chrome",
        PATH: "/opt/bin",
      },
      isExecutable: filesystem(["/opt/test/Chrome", "/opt/bin/google-chrome"]),
    });
    expect(installation).toEqual({
      browser: "Chrome",
      platform: "darwin",
      path: "/opt/test/Chrome",
      source: "environment",
      releaseChannel: "unknown",
    });
  });

  test("discovers Linux PATH browsers and keeps Safari platform-missing", async () => {
    const installations = await discoverWebGpuBrowsers({
      platform: "linux",
      env: { PATH: "/opt/bin" },
      isExecutable: filesystem([
        "/opt/bin/google-chrome",
        "/opt/bin/microsoft-edge",
        "/opt/bin/firefox",
      ]),
    });
    expect(installations).toEqual([
      {
        browser: "Chrome",
        platform: "linux",
        path: "/opt/bin/google-chrome",
        source: "path",
        releaseChannel: "stable",
      },
      {
        browser: "Edge",
        platform: "linux",
        path: "/opt/bin/microsoft-edge",
        source: "path",
        releaseChannel: "stable",
      },
      {
        browser: "Firefox",
        platform: "linux",
        path: "/opt/bin/firefox",
        source: "path",
        releaseChannel: "stable",
      },
      {
        browser: "Safari",
        platform: "linux",
        path: undefined,
        source: "missing",
        releaseChannel: "stable",
      },
    ]);
  });

  test("uses Windows installation roots without inventing Safari", async () => {
    const chromePath = "C:\\Tools\\Chrome\\google-chrome.exe";
    const edgePath = "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe";
    const installations = await discoverWebGpuBrowsers({
      platform: "win32",
      env: {
        ProgramFiles: "C:\\Program Files",
        PATH: "C:\\Tools\\Chrome",
      },
      isExecutable: filesystem([chromePath, edgePath]),
    });
    expect(installations[0]).toEqual({
      browser: "Chrome",
      platform: "win32",
      path: chromePath,
      source: "path",
      releaseChannel: "stable",
    });
    expect(installations[1]).toEqual({
      browser: "Edge",
      platform: "win32",
      path: edgePath,
      source: "known-path",
      releaseChannel: "stable",
    });
    expect(installations[2]?.path).toBeUndefined();
    expect(installations[3]).toEqual({
      browser: "Safari",
      platform: "win32",
      path: undefined,
      source: "missing",
      releaseChannel: "stable",
    });
  });

  test("excludes beta and generic Chromium candidates from the stable matrix", async () => {
    const installations = await discoverWebGpuBrowsers({
      platform: "darwin",
      env: { PATH: "/opt/bin" },
      isExecutable: filesystem([
        "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/opt/bin/chromium",
      ]),
    });
    expect(installations[0]).toMatchObject({
      browser: "Chrome",
      path: undefined,
      releaseChannel: "stable",
    });
  });

  test("marks an explicit browser override as an unknown channel", async () => {
    const installation = await discoverWebGpuBrowser("Chrome", {
      platform: "darwin",
      env: {
        WEBGPU_BROWSER: "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
      },
      isExecutable: filesystem([
        "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
      ]),
    });
    expect(installation).toMatchObject({
      browser: "Chrome",
      source: "environment",
      releaseChannel: "unknown",
    });
  });

  test("does not treat an unavailable override as an installed browser", async () => {
    const installation = await discoverWebGpuBrowser("Chrome", {
      platform: "linux",
      env: { WEBGPU_BROWSER: "/opt/unsupported/Chrome", PATH: "/opt/bin" },
      isExecutable: filesystem(["/opt/bin/google-chrome"]),
    });
    expect(installation.path).toBeUndefined();
    expect(installation.source).toBe("missing");
    expect(installation.platform).toBe("linux");
  });
});
