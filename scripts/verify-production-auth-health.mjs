#!/usr/bin/env node
/**
 * Production authentication health smoke test.
 *
 * Proves the live BERT API can authenticate users and resolve company context
 * after deployment. Read-only against workbook data; creates only login/logout sessions.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   BERT_SMOKE_USERNAME=mr.important \
 *   BERT_SMOKE_PASSWORD='...' \
 *   BERT_SMOKE_COMPANY_FOLDER_ID=1tDKluapYfY-RkuxXc6eoRnGHL38XCswx \
 *   BERT_SMOKE_MASTER_SHEET_ID=1MntKgSgVmTmlpzZhnCZdDQtdmPw7GcXptlAp88Ewrkc \
 *   BERT_SMOKE_EXPECTED_EMAIL=bert.demo+mr.important@usebert.co.uk \
 *   npm run verify:production-auth-health
 */
import dotenv from "dotenv";
import {
  createFetchTransport,
  formatReport,
  loadSmokeConfig,
  runProductionAuthHealthChecks,
} from "./lib/production-auth-health-core.mjs";

dotenv.config();

async function main() {
  const config = loadSmokeConfig();
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
        "  npm run verify:production-auth-health",
      ].join("\n"),
    );
    process.exit(1);
  }

  const transport = createFetchTransport(config.apiBase, config.appOrigin, config.timeoutMs);
  const result = await runProductionAuthHealthChecks(config, transport);
  if (result.apiVersion) {
    console.log(
      `Live API version: ${result.apiVersion}${result.shortSha ? ` (${result.shortSha})` : ""}`,
    );
  }
  console.log(formatReport(result));
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
