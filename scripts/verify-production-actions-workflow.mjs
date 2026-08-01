#!/usr/bin/env node
/**
 * Production Actions workflow smoke test.
 */
import dotenv from "dotenv";
import { createFetchTransport } from "./lib/production-auth-health-core.mjs";
import {
  ACTIONS_VERIFIER_BUDGET_MS,
  formatActionsWorkflowReport,
  loadActionsWorkflowConfig,
  runProductionActionsWorkflowChecks,
} from "./lib/production-actions-workflow-core.mjs";

dotenv.config();

let interruptCleanup = null;
let shuttingDown = false;

async function handleShutdownSignal(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.error(`\n[actions-workflow] Received ${signal} — attempting verification-only cleanup...`);
  try {
    if (typeof interruptCleanup === "function") {
      const cleanupResult = await interruptCleanup();
      if (cleanupResult?.ok) {
        console.error("[actions-workflow] Verification cleanup completed during shutdown.");
      } else {
        console.error(
          `[actions-workflow] Verification cleanup did not fully succeed: ${JSON.stringify(cleanupResult?.results || cleanupResult)}`,
        );
      }
    } else {
      console.error("[actions-workflow] No verification cleanup handler was registered.");
    }
  } catch (error) {
    console.error(
      `[actions-workflow] Verification cleanup failed during shutdown: ${error instanceof Error ? error.message : String(error)}`,
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
  const config = loadActionsWorkflowConfig();
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
        "  BERT_SMOKE_ALLOW_ACTION_MUTATION=1 \\",
        "  npm run verify:production-actions-workflow",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(
    `[actions-workflow] Starting production Actions workflow verifier (budget ${ACTIONS_VERIFIER_BUDGET_MS}ms).`,
  );

  const startedAt = Date.now();
  const transport = createFetchTransport(config.apiBase, config.appOrigin, config.timeoutMs);
  const result = await runProductionActionsWorkflowChecks(config, transport, {
    registerInterruptCleanup(fn) {
      interruptCleanup = fn;
    },
  });

  if (result.apiVersion) {
    console.log(
      `Live API version: ${result.apiVersion}${result.shortSha ? ` (${result.shortSha})` : ""}`,
    );
  }
  if (result.mutationSkipped) {
    console.log(
      "Mutation skipped intentionally — set BERT_SMOKE_ALLOW_ACTION_MUTATION=1 to exercise the full Actions lifecycle.",
    );
  }
  if (result.timedOut) {
    console.error(
      `[actions-workflow] Timed out during ${result.failedStage || "unknown stage"}: ${result.timeoutMethod || "REQUEST"} ${result.timeoutSafeUrl || ""} (${result.timeoutElapsedMs || 0}ms)`,
    );
  }
  console.log(formatActionsWorkflowReport(result));
  console.log(`Elapsed: ${Date.now() - startedAt}ms`);
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
