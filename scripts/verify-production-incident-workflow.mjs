#!/usr/bin/env node
/**
 * Production Incident workflow smoke test.
 */
import dotenv from "dotenv";
import { createFetchTransport } from "./lib/production-auth-health-core.mjs";
import {
  formatIncidentWorkflowReport,
  INCIDENT_VERIFIER_BUDGET_MS,
  loadIncidentWorkflowConfig,
  runProductionIncidentWorkflowChecks,
} from "./lib/production-incident-workflow-core.mjs";

dotenv.config();

let interruptCleanup = null;
let shuttingDown = false;

async function handleShutdownSignal(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.error(`\n[incident-workflow] Received ${signal} — attempting verification-only cleanup...`);
  try {
    if (typeof interruptCleanup === "function") {
      const cleanupResult = await interruptCleanup();
      if (cleanupResult?.ok) {
        console.error("[incident-workflow] Verification cleanup completed during shutdown.");
      } else {
        console.error(
          `[incident-workflow] Verification cleanup did not fully succeed: ${JSON.stringify(cleanupResult?.results || cleanupResult)}`,
        );
      }
    } else {
      console.error("[incident-workflow] No verification cleanup handler was registered.");
    }
  } catch (error) {
    console.error(
      `[incident-workflow] Verification cleanup failed during shutdown: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  process.exit(signal === "SIGINT" ? 130 : 143);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void handleShutdownSignal(signal);
  });
}

async function main() {
  const config = loadIncidentWorkflowConfig();
  if (config.missing.length > 0) {
    console.error(
      [
        "Missing required smoke-test environment variables:",
        ...config.missing.map((key) => `  - ${key}`),
        "",
        "Example:",
        "  BERT_SMOKE_USERNAME=mr.important \\",
        "  BERT_SMOKE_PASSWORD='...' \\",
        "  BERT_SMOKE_COMPANY_FOLDER_ID=... \\",
        "  BERT_SMOKE_MASTER_SHEET_ID=... \\",
        "  BERT_SMOKE_ALLOW_INCIDENT_MUTATION=1 \\",
        "  npm run verify:production-incident-workflow",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(
    `[incident-workflow] Starting production Incident workflow verifier (budget ${INCIDENT_VERIFIER_BUDGET_MS}ms).`,
  );

  const startedAt = Date.now();
  const transport = createFetchTransport(config.apiBase, config.appOrigin, config.timeoutMs);
  const result = await runProductionIncidentWorkflowChecks(config, transport, {
    registerInterruptCleanup(fn) {
      interruptCleanup = fn;
    },
  });

  console.log(formatIncidentWorkflowReport(result));
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(`[incident-workflow] Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
