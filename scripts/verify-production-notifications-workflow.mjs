#!/usr/bin/env node
/**
 * Production Notifications workflow smoke test.
 */
import dotenv from "dotenv";
import { createFetchTransport } from "./lib/production-auth-health-core.mjs";
import {
  formatNotificationsWorkflowReport,
  loadNotificationsWorkflowConfig,
  NOTIFICATIONS_VERIFIER_BUDGET_MS,
  runProductionNotificationsWorkflowChecks,
} from "./lib/production-notifications-workflow-core.mjs";

dotenv.config();

let interruptCleanup = null;
let shuttingDown = false;

async function handleShutdownSignal(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.error(`\n[notifications-workflow] Received ${signal} — attempting verification-only cleanup...`);
  try {
    if (typeof interruptCleanup === "function") {
      await interruptCleanup();
    }
  } catch (error) {
    console.error(
      `[notifications-workflow] Cleanup failed during shutdown: ${error instanceof Error ? error.message : String(error)}`,
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
  const config = loadNotificationsWorkflowConfig();
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
        "  BERT_SMOKE_ALLOW_NOTIFICATION_MUTATION=1 \\",
        "  npm run verify:production-notifications-workflow",
      ].join("\n"),
    );
    process.exit(1);
  }

  const runId = Date.now();
  console.log(
    `[notifications] Starting production Notifications verifier (budget ${NOTIFICATIONS_VERIFIER_BUDGET_MS}ms, run bert-smoke-notification-${runId}).`,
  );

  const startedAt = Date.now();
  const transport = createFetchTransport(config.apiBase, config.appOrigin, config.timeoutMs);
  const result = await runProductionNotificationsWorkflowChecks(config, transport, {
    runId,
    registerInterruptCleanup(fn) {
      interruptCleanup = fn;
    },
    logStage(line) {
      console.log(line);
    },
  });

  console.log(formatNotificationsWorkflowReport(result));
  console.log(`Elapsed: ${Date.now() - startedAt}ms`);
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
