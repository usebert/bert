#!/usr/bin/env node
/**
 * Production Risk Assessment workflow smoke test.
 */
import dotenv from "dotenv";
import { createFetchTransport } from "./lib/production-auth-health-core.mjs";
import {
  RA_VERIFIER_BUDGET_MS,
  formatRiskAssessmentWorkflowReport,
  loadRiskAssessmentWorkflowConfig,
  runProductionRiskAssessmentWorkflowChecks,
} from "./lib/production-risk-assessment-workflow-core.mjs";

dotenv.config();

let interruptCleanup = null;
let shuttingDown = false;

async function handleShutdownSignal(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.error(`\n[risk-assessment-workflow] Received ${signal} — attempting verification-only cleanup...`);
  try {
    if (typeof interruptCleanup === "function") {
      const cleanupResult = await interruptCleanup();
      if (cleanupResult?.ok) {
        console.error("[risk-assessment-workflow] Verification cleanup completed during shutdown.");
      } else {
        console.error(
          `[risk-assessment-workflow] Verification cleanup did not fully succeed: ${JSON.stringify(cleanupResult?.results || cleanupResult)}`,
        );
      }
    } else {
      console.error("[risk-assessment-workflow] No verification cleanup handler was registered.");
    }
  } catch (error) {
    console.error(
      `[risk-assessment-workflow] Verification cleanup failed during shutdown: ${error instanceof Error ? error.message : String(error)}`,
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
  const config = loadRiskAssessmentWorkflowConfig();
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
        "  BERT_SMOKE_ALLOW_RISK_ASSESSMENT_MUTATION=1 \\",
        "  npm run verify:production-risk-assessment-workflow",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(
    `[risk-assessment-workflow] Starting production Risk Assessment workflow verifier (budget ${RA_VERIFIER_BUDGET_MS}ms).`,
  );

  const startedAt = Date.now();
  const transport = createFetchTransport(config.apiBase, config.appOrigin, config.timeoutMs);
  const result = await runProductionRiskAssessmentWorkflowChecks(config, transport, {
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
      "Mutation skipped intentionally — set BERT_SMOKE_ALLOW_RISK_ASSESSMENT_MUTATION=1 to exercise the full Risk Assessment lifecycle.",
    );
  }
  if (result.timedOut) {
    console.error(
      `[risk-assessment-workflow] Timed out during ${result.failedStage || "unknown stage"}: ${result.timeoutMethod || "REQUEST"} ${result.timeoutSafeUrl || ""} (${result.timeoutElapsedMs || 0}ms)`,
    );
  }
  console.log(formatRiskAssessmentWorkflowReport(result));
  console.log(`Elapsed: ${Date.now() - startedAt}ms`);
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
