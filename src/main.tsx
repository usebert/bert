import React from "react";
import ReactDOM from "react-dom/client";
import App from "../App";
import { migrateLegacyStorageKeysOnce } from "./config/storageKeys";
import { runAppContextBootstrap } from "./utils/clearStaleCompanyLocalStorage";
import "./index.css";

migrateLegacyStorageKeysOnce();
runAppContextBootstrap();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

function installServiceWorkerStrategy() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    const isLocalDevHost =
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
      window.location.port === "5173";
    const shouldDisableServiceWorker = isLocalDevHost;

    if (shouldDisableServiceWorker) {
      // Keep local dev sessions cache-free to avoid stale JS chunks while iterating.
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          void registration.unregister();
        });
      });
      return;
    }

    void navigator.serviceWorker.register("/service-worker.js");
  });
}

installServiceWorkerStrategy();
