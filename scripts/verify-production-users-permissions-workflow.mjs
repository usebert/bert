#!/usr/bin/env node
/**
 * Production Users & Permissions workflow smoke test.
 */
import dotenv from "dotenv";
import { createFetchTransport } from "./lib/production-auth-health-core.mjs";
import {
  formatUsersPermissionsWorkflowReport,
  loadUsersPermissionsWorkflowConfig,
  USERS_PERMISSIONS_VERIFIER_BUDGET_MS,
  runProductionUsersPermissionsWorkflowChecks,
} from "./lib/production-users-permissions-workflow-core.mjs";

dotenv.config();

let interruptCleanup = null;
let shuttingDown = false;

async function handleShutdownSignal(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.error(`\n[users-permissions-workflow] Received ${signal} — attempting verification-only cleanup...`);
  try {
    if (typeof interruptCleanup === "function") {
      await interruptCleanup();
    }
  } catch (error) {
    console.error(
      `[users-permissions-workflow] Cleanup failed during shutdown: ${error instanceof Error ? error.message : String(error)}`,
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
  const config = loadUsersPermissionsWorkflowConfig();
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
        "  BERT_SMOKE_ALLOW_USER_MUTATION=1 \\",
        "  npm run verify:production-users-permissions-workflow",
      ].join("\n"),
    );
    process.exit(1);
  }

  const runId = Date.now();
  console.log(
    `[users-permissions] Starting production Users & Permissions verifier (budget ${USERS_PERMISSIONS_VERIFIER_BUDGET_MS}ms, run bert-smoke-user-${runId}).`,
  );

  const startedAt = Date.now();
  const transport = createFetchTransport(config.apiBase, config.appOrigin, config.timeoutMs);
  const result = await runProductionUsersPermissionsWorkflowChecks(config, transport, {
    runId,
    registerInterruptCleanup(fn) {
      interruptCleanup = fn;
    },
    logStage(line) {
      console.log(line);
    },
  });

  console.log(formatUsersPermissionsWorkflowReport(result));
  console.log(`Elapsed: ${Date.now() - startedAt}ms`);
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
