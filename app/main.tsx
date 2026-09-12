import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Calculator root element is missing.");
}

createRoot(root).render(<App />);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).catch(() => {
    // The calculator remains usable in development when a service worker is unavailable.
  });
}
