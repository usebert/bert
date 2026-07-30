#!/usr/bin/env node
/**
 * Production audit workflow smoke test.
 *
 * Verifies assigned-check loading, audit open, draft save/resume/edit, and — when a
 * dedicated verification schedule exists — safe submission with AuditResults + dashboard checks.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   BERT_SMOKE_USERNAME=mr.important \
 *   BERT_SMOKE_PASSWORD='...' \
 *   BERT_SMOKE_COMPANY_FOLDER_ID=... \
 *   BERT_SMOKE_MASTER_SHEET_ID=... \
 *   npm run verify:production-audit-workflow
 */
import dotenv from "dotenv";
import { createFetchTransport } from "./lib/production-auth-health-core.mjs";
import {
  formatAuditWorkflowReport,
  loadAuditWorkflowConfig,
  runProductionAuditWorkflowChecks,
} from "./lib/production-audit-workflow-core.mjs";

dotenv.config();

async function main() {
  const config = loadAuditWorkflowConfig();
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
        "  npm run verify:production-audit-workflow",
      ].join("\n"),
    );
    process.exit(1);
  }

  const startedAt = Date.now();
  const transport = createFetchTransport(config.apiBase, config.appOrigin, config.timeoutMs);
  const result = await runProductionAuditWorkflowChecks(config, transport);

  if (result.apiVersion) {
    console.log(
      `Live API version: ${result.apiVersion}${result.shortSha ? ` (${result.shortSha})` : ""}`,
    );
  }
  if (result.submissionSkipped) {
    console.log(
      "Submission skipped intentionally — set BERT_SMOKE_ALLOW_VERIFICATION_SUBMIT=1 to exercise end-to-end submit.",
    );
  }
  console.log(formatAuditWorkflowReport(result));
  console.log(`Elapsed: ${Date.now() - startedAt}ms`);
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
