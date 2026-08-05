#!/usr/bin/env node
/**
 * Production Risk Register workflow smoke test.
 */
import dotenv from "dotenv";
import { createFetchTransport } from "./lib/production-auth-health-core.mjs";
import {
  formatRiskRegisterWorkflowReport,
  loadRiskRegisterWorkflowConfig,
  RISK_REGISTER_VERIFIER_BUDGET_MS,
  runProductionRiskRegisterWorkflowChecks,
} from "./lib/production-risk-register-workflow-core.mjs";

dotenv.config();

let interruptCleanup = null;
let shuttingDown = false;

async function handleShutdownSignal(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.error(`\n[risk-register-workflow] Received ${signal} — attempting verification-only cleanup...`);
  try {
    if (typeof interruptCleanup === "function") {
      const cleanupResult = await interruptCleanup();
      if (cleanupResult?.ok) {
        console.error("[risk-register-workflow] Verification cleanup completed during shutdown.");
      } else {
        console.error(
          `[risk-register-workflow] Verification cleanup did not fully succeed: ${JSON.stringify(cleanupResult?.results || cleanupResult)}`,
        );
      }
    } else {
      console.error("[risk-register-workflow] No verification cleanup handler was registered.");
    }
  } catch (error) {
    console.error(
      `[risk-register-workflow] Verification cleanup failed during shutdown: ${error instanceof Error ? error.message : String(error)}`,
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
  const config = loadRiskRegisterWorkflowConfig();
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
        "  BERT_SMOKE_ALLOW_RISK_REGISTER_MUTATION=1 \\",
        "  npm run verify:production-risk-register-workflow",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(`[risk-register-workflow] Starting production Risk Register workflow verifier (budget ${RISK_REGISTER_VERIFIER_BUDGET_MS}ms).`);

  const transport = createFetchTransport(config.apiBase, config.appOrigin, config.timeoutMs);
  const result = await runProductionRiskRegisterWorkflowChecks(config, transport, {
    registerInterruptCleanup(fn) {
      interruptCleanup = fn;
    },
  });

  console.log(formatRiskRegisterWorkflowReport(result));
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(`[risk-register-workflow] Fatal error: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});
