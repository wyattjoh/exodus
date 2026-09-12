import { createWorkerPlanningEndpoint } from "./worker-planning";

type WorkerGlobal = typeof globalThis & {
  readonly postMessage: (message: unknown) => void;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
};

const workerGlobal = globalThis as WorkerGlobal;
const endpoint = createWorkerPlanningEndpoint({
  postMessage(message) {
    workerGlobal.postMessage(message);
  },
});

workerGlobal.onmessage = (event) => {
  endpoint.handleMessage(event.data);
};
