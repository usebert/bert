#!/usr/bin/env node
/**
 * Generate Midlands synthetic evidence locally (dry-run default).
 *
 * Usage:
 *   DEMO_COMPANY_SEED_CONFIRM=yes BERT_DEMO_DEFAULT_PASSWORD='...' npm run generate:demo-evidence -- --anchor-date=2026-07-24
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEMO_COMPANY_SEED_CONFIRM_ENV,
  MIDLANDS_DEMO_COMPANY_NAME,
  readDemoCompanyFolderId,
  readDemoCompanySpreadsheetId,
} from "../shared/demo-environment.mjs";
import { MIDLANDS_EVIDENCE_REPORT_FILE } from "../shared/midlands-precast-evidence.mjs";
import {
  buildEvidencePlanFromHistory,
  evidenceOutputDir,
  generateLocalEvidenceBundle,
  loadMidlandsHistoryForEvidence,
  readArg,
  resolveSessionsRoot,
} from "./lib/demo-evidence-script-utils.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const confirm = String(process.env[DEMO_COMPANY_SEED_CONFIRM_ENV] || "").trim().toLowerCase();
if (confirm !== "yes") {
  console.error(`ERROR: Set ${DEMO_COMPANY_SEED_CONFIRM_ENV}=yes to generate Midlands demo evidence.`);
  process.exit(1);
}

const password = String(process.env.BERT_DEMO_DEFAULT_PASSWORD || "").trim();
if (!password || password.length < 12) {
  console.error("ERROR: Set BERT_DEMO_DEFAULT_PASSWORD (>= 12 chars).");
  process.exit(1);
}

const anchorDate = readArg(process.argv, "--anchor-date") || "2026-07-24";
const sessionsRoot = resolveSessionsRoot(root);
const outputDir = evidenceOutputDir(sessionsRoot, anchorDate);

const history = await loadMidlandsHistoryForEvidence({
  root,
  anchorDate,
  companyFolderId: readDemoCompanyFolderId(),
  masterSheetId: readDemoCompanySpreadsheetId(),
  password,
});

const plan = buildEvidencePlanFromHistory(history);
const { manifest } = generateLocalEvidenceBundle({ plan, outputDir });

const report = {
  companyName: MIDLANDS_DEMO_COMPANY_NAME,
  mode: "local-generation",
  anchorDate,
  outputDir,
  fingerprint: manifest.fingerprint,
  summary: manifest.summary,
  linkage: manifest.linkage,
  generatedAt: new Date().toISOString(),
};

const reportPath = path.join(root, MIDLANDS_EVIDENCE_REPORT_FILE);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log("\nMidlands demo evidence generation complete");
console.log(`  Anchor date: ${anchorDate}`);
console.log(`  Mode: local-generation`);
console.log(`  Images: ${manifest.summary.imageCount}`);
console.log(`  Fingerprint: ${manifest.fingerprint}`);
console.log(`  Output: ${outputDir}`);
console.log(`  Report: ${reportPath}`);
console.log(`  Linked records: findings ${manifest.summary.linkedRecords.findings}, incidents ${manifest.summary.linkedRecords.incidents}, ncrs ${manifest.summary.linkedRecords.ncrs}, actions ${manifest.summary.linkedRecords.actions}`);
console.log(`  Before/after pairs: ${manifest.summary.beforeAfterPairs}`);
