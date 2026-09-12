import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const PUBLIC_PRECACHED_ASSETS = [
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/service-worker.js",
] as const;

function productionServiceWorkerPlugin(): Plugin {
  let renderedServiceWorker: string | undefined;

  return {
    name: "centauri-production-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const precacheAssets = new Set<string>([
        "/",
        "/index.html",
        "/webgpu-scale-benchmark.html",
        ...PUBLIC_PRECACHED_ASSETS,
      ]);
      for (const [fileName, artifact] of Object.entries(bundle)) {
        if (artifact.type === "asset" && /\.html$/i.test(fileName)) {
          precacheAssets.add(`/${fileName}`);
          if (typeof artifact.source === "string") {
            for (const match of artifact.source.matchAll(/(?:src|href)="(\/[^\"]+)"/g)) {
              const url = match[1];
              if (url !== undefined) {
                precacheAssets.add(url);
              }
            }
          }
        }
        if (
          artifact.type === "chunk" ||
          (artifact.type === "asset" && /\.(?:css|js)$/i.test(fileName))
        ) {
          precacheAssets.add(`/${fileName}`);
        }
      }

      const assets = [...precacheAssets].sort();
      const template = readFileSync(new URL("./public/service-worker.js", import.meta.url), "utf8");
      const version = createHash("sha256")
        .update(template)
        .update(JSON.stringify(assets))
        .digest("hex")
        .slice(0, 12);
      const rendered = template
        .replace('const CACHE_VERSION = "dev";', `const CACHE_VERSION = "v-${version}";`)
        .replace(
          "const PRECACHE_ASSETS = [];",
          `const PRECACHE_ASSETS = ${JSON.stringify(assets)};`,
        );
      if (rendered === template) {
        throw new Error("The production service-worker template has no build placeholders.");
      }
      renderedServiceWorker = rendered;
    },
    writeBundle(options) {
      if (renderedServiceWorker === undefined) {
        throw new Error("The production service worker was not generated.");
      }
      if (options.dir === undefined) {
        throw new Error("The production service worker requires a directory output.");
      }
      writeFileSync(resolve(options.dir, "service-worker.js"), renderedServiceWorker);
    },
  };
}

export default defineConfig({
  plugins: [productionServiceWorkerPlugin()],
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve("index.html"),
        webgpuScaleBenchmark: resolve("webgpu-scale-benchmark.html"),
      },
    },
  },
  worker: {
    format: "es",
  },
});
