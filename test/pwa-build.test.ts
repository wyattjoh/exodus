import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

const repositoryRoot = new URL("..", import.meta.url);
const distRoot = new URL("../dist/", import.meta.url);

function distFile(pathname: string): Bun.BunFile {
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  return Bun.file(new URL(relativePath, distRoot));
}

function localUrls(document: string): readonly string[] {
  return Object.freeze(
    [...document.matchAll(/(?:src|href)="(\/[^\"]+)"/g)]
      .map((match) => match[1])
      .filter((value): value is string => value !== undefined),
  );
}

function moduleUrls(document: string): readonly string[] {
  return Object.freeze(
    [
      ...[
        ...document.matchAll(/\b(?:import|export)\s*(?:[^"'()]*?\sfrom\s*)?["']([^"']+)["']/g),
      ].map((match) => match[1]),
      ...[...document.matchAll(/\bnew URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g)].map(
        (match) => match[1],
      ),
    ].filter((value): value is string => value !== undefined),
  );
}

function styleUrls(document: string): readonly string[] {
  return Object.freeze(
    [...document.matchAll(/url\(\s*["']?([^\)"']+)["']?\s*\)/g)]
      .map((match) => match[1])
      .filter((value): value is string => value !== undefined),
  );
}

function resolveLocalUrl(parent: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    return undefined;
  }
  const resolved = new URL(specifier, `https://pwa.invalid${parent}`);
  return resolved.origin === "https://pwa.invalid" ? resolved.pathname : undefined;
}

async function dependencyGraph(entries: readonly string[]): Promise<readonly string[]> {
  const pending = [...new Set(entries)];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const pathname = pending.shift();
    if (pathname === undefined || seen.has(pathname)) {
      continue;
    }
    seen.add(pathname);
    const file = distFile(pathname);
    if (!(await file.exists())) {
      continue;
    }
    const document = await file.text();
    const references = pathname.endsWith(".css")
      ? styleUrls(document)
      : pathname.endsWith(".js")
        ? moduleUrls(document)
        : [];
    for (const reference of references) {
      const resolved = resolveLocalUrl(pathname, reference);
      if (resolved !== undefined && !seen.has(resolved)) {
        pending.push(resolved);
      }
    }
  }
  return Object.freeze([...seen].sort());
}

async function buildProductionAssets(): Promise<void> {
  const process = Bun.spawn(["bun", "run", "build"], {
    cwd: repositoryRoot.pathname,
    env: { ...globalThis.process.env, NODE_ENV: "production" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(process.stderr).text();
    throw new Error(`Production build failed: ${stderr}`);
  }
}

describe("production PWA build", () => {
  test("emits a complete installable and offline dependency graph", async () => {
    await buildProductionAssets();
    const indexHtml = await distFile("/").text();
    const benchmarkPath = "/webgpu-scale-benchmark.html";
    const benchmarkHtml = await distFile(benchmarkPath).text();
    const manifest = (await distFile("/manifest.webmanifest").json()) as {
      readonly name?: unknown;
      readonly short_name?: unknown;
      readonly start_url?: unknown;
      readonly scope?: unknown;
      readonly display?: unknown;
      readonly background_color?: unknown;
      readonly theme_color?: unknown;
      readonly icons?: readonly {
        readonly src?: unknown;
        readonly sizes?: unknown;
        readonly type?: unknown;
      }[];
    };
    const serviceWorker = await distFile("/service-worker.js").text();
    const precacheStart = serviceWorker.indexOf("const PRECACHE_ASSETS = ");
    const precacheEnd = serviceWorker.indexOf(";\nconst SHELL", precacheStart);
    if (precacheStart < 0 || precacheEnd < 0) {
      throw new Error("The built service worker has no generated precache list.");
    }
    const precache = JSON.parse(
      serviceWorker.slice(precacheStart + "const PRECACHE_ASSETS = ".length, precacheEnd),
    ) as readonly string[];
    const indexUrls = localUrls(indexHtml);
    const benchmarkUrls = localUrls(benchmarkHtml);
    const entryScriptUrl = indexUrls.find((url) => /\/assets\/index-.+\.js$/.test(url));
    if (entryScriptUrl === undefined) {
      throw new Error("The built entry HTML has no hashed application script.");
    }
    const entryScript = await distFile(entryScriptUrl).text();
    const manifestUrls = [
      manifest.start_url,
      manifest.scope,
      ...(manifest.icons ?? []).map((icon) => icon.src),
    ].filter((value): value is string => typeof value === "string");

    expect(entryScript).not.toContain("jsxDEV");
    expect(entryScript).toContain("service-worker.js");
    expect(manifest.name).toBe("Centauri Journey Calculator");
    expect(manifest.short_name).toBe("Journey Calculator");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toBe("#0a0f12");
    expect(manifest.theme_color).toBe("#0a0f12");
    expect(manifest.icons).toEqual([
      expect.objectContaining({ src: "/icon-192.png", sizes: "192x192", type: "image/png" }),
      expect.objectContaining({ src: "/icon-512.png", sizes: "512x512", type: "image/png" }),
    ]);
    expect(serviceWorker).not.toContain('const CACHE_VERSION = "dev"');
    expect(serviceWorker).toContain("await caches.delete(CACHE_NAME)");
    expect(serviceWorker).toContain(
      "Promise.all([...new Set(SHELL)].map((request) => precache(cache, request)))",
    );
    expect(serviceWorker).toContain("caches.match(event.request)");
    expect(serviceWorker).toContain(
      "The requested local asset is not cached by the WebGPU PWA shell.",
    );
    expect(precache.some((url) => /\/assets\/worker-planning-worker-.+\.js$/.test(url))).toBe(true);

    expect(precache).toContain(benchmarkPath);
    for (const url of [...indexUrls, ...benchmarkUrls, ...manifestUrls, ...precache]) {
      expect(await distFile(url).exists()).toBe(true);
    }
    for (const url of [...indexUrls, benchmarkPath, ...benchmarkUrls]) {
      expect(precache).toContain(url);
    }
    for (const url of manifestUrls) {
      expect(precache).toContain(url);
    }

    const graph = await dependencyGraph([
      "/index.html",
      benchmarkPath,
      ...indexUrls,
      ...benchmarkUrls,
      ...manifestUrls,
    ]);
    expect(graph.length).toBeGreaterThan(0);
    for (const url of graph) {
      expect(precache).toContain(url);
      expect(await distFile(url).exists()).toBe(true);
    }
    const builtAssetUrls = (await readdir(new URL("../dist/assets/", import.meta.url)))
      .filter((name) => !name.endsWith(".map"))
      .map((name) => `/assets/${name}`);
    for (const url of builtAssetUrls) {
      expect(precache).toContain(url);
    }
  });
});
