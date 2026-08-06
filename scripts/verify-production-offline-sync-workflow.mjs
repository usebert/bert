#!/usr/bin/env node
/**
 * Production Offline Sync workflow smoke test.
 */
import dotenv from "dotenv";
import { COMPANY_SESSION_COOKIE } from "./lib/production-auth-health-core.mjs";
import { createFetchTransport } from "./lib/production-auth-health-core.mjs";
import {
  createProductionOfflineBrowserRunner,
  transportCookiesToPlaywright,
} from "./lib/production-offline-browser-runner.mjs";
import { createOfflineSyncStorageSimulator } from "./lib/offline-sync-storage-simulator.mjs";
import {
  formatOfflineSyncWorkflowReport,
  loadOfflineSyncWorkflowConfig,
  OFFLINE_SYNC_VERIFIER_BUDGET_MS,
  runProductionOfflineSyncWorkflowChecks,
} from "./lib/production-offline-sync-workflow-core.mjs";
import { buildProductionOfflineRunId } from "../shared/production-verification-offline-sync.mjs";

dotenv.config();

let interruptCleanup = null;
let shuttingDown = false;

async function handleShutdownSignal(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.error(`\n[offline-sync] Received ${signal} — attempting verification-only cleanup...`);
  try {
    if (typeof interruptCleanup === "function") {
      const cleanupResult = await interruptCleanup();
      console.error(`[offline-sync] Interrupt cleanup: ${JSON.stringify(cleanupResult?.results || cleanupResult)}`);
    }
  } catch (error) {
    console.error(
      `[offline-sync] Interrupt cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  process.exit(signal === "SIGINT" ? 130 : 143);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void handleShutdownSignal(signal);
  });
}

function createHybridOfflineClient(config, transport, options = {}) {
  const simulator = createOfflineSyncStorageSimulator({
    config,
    request: transport.request.bind(transport),
    runId: options.runId,
    offlineRunId: options.offlineRunId,
  });
  const browserRunner = options.browserRunner;
  if (!browserRunner) {
    return simulator;
  }
  return {
    ...simulator,
    async probeCapability() {
      return browserRunner.probeCapability();
    },
    get capabilityAvailable() {
      return simulator.capabilityAvailable;
    },
    set capabilityAvailable(value) {
      simulator.capabilityAvailable = value;
    },
    get serviceWorkerRegistered() {
      return browserRunner ? true : simulator.serviceWorkerRegistered;
    },
    get onlineListenerRegistered() {
      return simulator.onlineListenerRegistered;
    },
    async goOfflineBrowser() {
      return browserRunner.setOffline(true);
    },
    async restoreOnlineBrowser() {
      await browserRunner.setOffline(false);
      return browserRunner.waitForQueueDrain();
    },
  };
}

async function main() {
  const config = loadOfflineSyncWorkflowConfig();
  if (config.missing.length > 0) {
    console.error(
      [
        "Missing required smoke-test environment variables:",
        ...config.missing.map((key) => `  - ${key}`),
        "",
        "Example:",
        "  BERT_SMOKE_USERNAME=mr.important \\",
        "  BERT_SMOKE_PASSWORD='<set securely in your environment>' \\",
        "  BERT_SMOKE_COMPANY_FOLDER_ID=... \\",
        "  BERT_SMOKE_MASTER_SHEET_ID=... \\",
        "  BERT_SMOKE_ALLOW_OFFLINE_MUTATION=1 \\",
        "  npm run verify:production-offline-sync-workflow",
      ].join("\n"),
    );
    process.exit(1);
  }

  const runId = Date.now();
  const offlineRunId = buildProductionOfflineRunId(runId);
  console.log(
    `[offline-sync] Starting production Offline Sync verifier (budget ${OFFLINE_SYNC_VERIFIER_BUDGET_MS}ms, run ${offlineRunId}).`,
  );

  const transport = createFetchTransport(config.apiBase, config.appOrigin, config.timeoutMs);
  let browserRunner = null;
  if (trim(process.env.BERT_SMOKE_OFFLINE_USE_BROWSER).toLowerCase() !== "0") {
    browserRunner = await createProductionOfflineBrowserRunner(config, transport, { runId, offlineRunId });
    if (browserRunner) {
      const probe = await browserRunner.probeCapability();
      console.log(`[offline-sync] Browser capability probe: ${JSON.stringify(probe)}`);
    }
  }

  const offlineClient = createHybridOfflineClient(config, transport, {
    runId,
    offlineRunId,
    browserRunner,
  });
  if (browserRunner) {
    const probe = await browserRunner.probeCapability();
    offlineClient.capabilityAvailable = probe.capabilityAvailable;
  }

  const result = await runProductionOfflineSyncWorkflowChecks(config, transport, {
    runId,
    offlineClient,
    registerInterruptCleanup(fn) {
      interruptCleanup = fn;
    },
  });

  if (browserRunner) {
    result.appSha = (await browserRunner.getAppSha()) || result.appSha;
    await browserRunner.close();
  }

  console.log(formatOfflineSyncWorkflowReport(result));
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(`[offline-sync] Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
