type CdpMessage = {
  readonly id?: number;
  readonly result?: unknown;
  readonly error?: { readonly message?: string };
};

type CdpTarget = {
  readonly webSocketDebuggerUrl?: string;
};

class CdpClient {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { readonly resolve: (value: unknown) => void; readonly reject: (error: Error) => void }
  >();
  private readonly opened: Promise<void>;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve());
      this.socket.addEventListener("error", () => reject(new Error("CDP WebSocket failed.")));
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id === undefined) {
        return;
      }
      const request = this.pending.get(message.id);
      if (request === undefined) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error !== undefined) {
        request.reject(new Error(message.error.message ?? "CDP command failed."));
        return;
      }
      request.resolve(message.result);
    });
    this.socket.addEventListener("close", () => {
      for (const request of this.pending.values()) {
        request.reject(new Error("CDP WebSocket closed."));
      }
      this.pending.clear();
    });
  }

  async command(method: string, params: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
    await this.opened;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const response = (await this.command("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })) as {
      readonly exceptionDetails?: { readonly text?: string };
      readonly result?: { readonly value?: T; readonly description?: string };
    };
    if (response.exceptionDetails !== undefined) {
      throw new Error(response.exceptionDetails.text ?? "Browser evaluation failed.");
    }
    return response.result?.value as T;
  }

  close(): void {
    this.socket.close();
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(
  client: CdpClient,
  expression: string,
  timeoutMilliseconds = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await client.evaluate<boolean>(expression)) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for browser expression: ${expression}`);
}

async function cdpBaseUrl(): Promise<string> {
  const base = process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222";
  const response = await fetch(`${base}/json/version`);
  if (!response.ok) {
    throw new Error(`Chrome CDP is unavailable at ${base}. Set CHROME_CDP_URL to its HTTP URL.`);
  }
  return base;
}

async function openTarget(base: string, url: string): Promise<CdpClient> {
  const query = encodeURIComponent(url);
  let response = await fetch(`${base}/json/new?${query}`, { method: "PUT" });
  if (!response.ok) {
    response = await fetch(`${base}/json/new?${query}`);
  }
  if (!response.ok) {
    throw new Error(`Chrome CDP could not create a fresh page (${response.status}).`);
  }
  const target = (await response.json()) as CdpTarget;
  if (target.webSocketDebuggerUrl === undefined) {
    throw new Error("Chrome CDP returned a page without a WebSocket URL.");
  }
  return new CdpClient(target.webSocketDebuggerUrl);
}

const distRoot = new URL("../dist/", import.meta.url);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    if (relative.includes("..")) {
      return new Response("Not found", { status: 404 });
    }
    const file = Bun.file(new URL(relative, distRoot));
    return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
  },
});
const url = `${server.url.origin}/`;
let client: CdpClient | undefined;

try {
  const base = await cdpBaseUrl();
  client = await openTarget(base, url);
  await client.command("Page.enable");
  await client.command("Runtime.enable");
  await client.command("Network.enable");
  await client.evaluate(`(async()=>{
    await Promise.all((await navigator.serviceWorker.getRegistrations()).map((registration)=>registration.unregister()));
    await Promise.all((await caches.keys()).map((key)=>caches.delete(key)));
    return true;
  })()`);
  await client.command("Page.navigate", { url });
  await waitFor(client, 'document.querySelector("h1")?.textContent === "Journey calculator"');
  await waitFor(client, "navigator.serviceWorker?.ready !== undefined");
  await client.command("Page.reload", { ignoreCache: true });
  await waitFor(client, "navigator.serviceWorker?.controller !== null");
  const online = await client.evaluate<{
    readonly manifestStatus: number;
    readonly cacheKeys: readonly string[];
    readonly cachedRequestCount: number;
  }>(`(async()=>{
    const manifest = await fetch("/manifest.webmanifest");
    const cacheKeys = await caches.keys();
    const cache = await caches.open(cacheKeys.find((key)=>key.startsWith("centauri-journey-calculator-")));
    return {manifestStatus:manifest.status,cacheKeys,cachedRequestCount:(await cache.keys()).length};
  })()`);
  if (
    online.manifestStatus !== 200 ||
    online.cacheKeys.length !== 1 ||
    online.cachedRequestCount < 6
  ) {
    throw new Error(`Online PWA setup is incomplete: ${JSON.stringify(online)}`);
  }

  await client.command("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await client.command("Page.reload", { ignoreCache: true });
  await waitFor(client, 'document.querySelector("h1")?.textContent === "Journey calculator"');
  await waitFor(
    client,
    'document.querySelector(".app-status")?.textContent?.includes("Offline-ready")',
  );
  await client.evaluate('document.querySelector("form")?.requestSubmit()');
  await waitFor(client, 'document.querySelector("table") !== null', 30_000);
  const offline = await client.evaluate<{
    readonly hasTable: boolean;
    readonly hasWorkerResult: boolean;
    readonly cachedAssets: number;
  }>(`(async()=>{
    const cacheKey = (await caches.keys()).find((key)=>key.startsWith("centauri-journey-calculator-"));
    const cache = cacheKey === undefined ? undefined : await caches.open(cacheKey);
    return {
      hasTable:document.querySelector("table") !== null,
      hasWorkerResult:document.querySelector(".result-card") !== null,
      cachedAssets:cache === undefined ? 0 : (await cache.keys()).length,
    };
  })()`);
  if (
    !offline.hasTable ||
    !offline.hasWorkerResult ||
    offline.cachedAssets < online.cachedRequestCount
  ) {
    throw new Error(`Offline calculator smoke failed: ${JSON.stringify(offline)}`);
  }
  console.log(`PWA offline smoke passed (${offline.cachedAssets} cached requests).`);
} finally {
  if (client !== undefined) {
    try {
      await client.command("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
    } catch {
      // The browser may already be gone after a failed smoke run.
    }
    client.close();
  }
  server.stop();
}
