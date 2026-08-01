#!/usr/bin/env node
/**
 * Production Actions workflow smoke test.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   BERT_SMOKE_USERNAME=mr.important \
 *   BERT_SMOKE_PASSWORD='...' \
 *   BERT_SMOKE_COMPANY_FOLDER_ID=... \
 *   BERT_SMOKE_MASTER_SHEET_ID=... \
 *   BERT_SMOKE_ALLOW_ACTION_MUTATION=1 \
 *   npm run verify:production-actions-workflow
 */
import dotenv from "dotenv";
import { createFetchTransport } from "./lib/production-auth-health-core.mjs";
import {
  formatActionsWorkflowReport,
  loadActionsWorkflowConfig,
  runProductionActionsWorkflowChecks,
} from "./lib/production-actions-workflow-core.mjs";

dotenv.config();

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

  const startedAt = Date.now();
  const transport = createFetchTransport(config.apiBase, config.appOrigin, config.timeoutMs);
  const result = await runProductionActionsWorkflowChecks(config, transport);

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
  console.log(formatActionsWorkflowReport(result));
  console.log(`Elapsed: ${Date.now() - startedAt}ms`);
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
