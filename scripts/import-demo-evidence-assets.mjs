#!/usr/bin/env node
/**
 * Import externally generated Midlands demo evidence assets.
 *
 * Usage:
 *   DEMO_COMPANY_SEED_CONFIRM=yes BERT_DEMO_DEFAULT_PASSWORD='...' npm run import:demo-evidence-assets -- --anchor-date=2026-07-24
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
import { MIDLANDS_EVIDENCE_REPORT_FILE, evidenceAssetsDir } from "../shared/midlands-precast-evidence.mjs";
import {
  buildEvidencePlanFromHistory,
  evidenceOutputDir,
  importLocalEvidenceBundle,
  loadMidlandsHistoryForEvidence,
  readArg,
  resolveSessionsRoot,
} from "./lib/demo-evidence-script-utils.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const confirm = String(process.env[DEMO_COMPANY_SEED_CONFIRM_ENV] || "").trim().toLowerCase();
if (confirm !== "yes") {
  console.error(`ERROR: Set ${DEMO_COMPANY_SEED_CONFIRM_ENV}=yes to import Midlands demo evidence assets.`);
  process.exit(1);
}

const password = String(process.env.BERT_DEMO_DEFAULT_PASSWORD || "").trim();
if (!password || password.length < 12) {
  console.error("ERROR: Set BERT_DEMO_DEFAULT_PASSWORD (>= 12 chars).");
  process.exit(1);
}

const anchorDate = readArg(process.argv, "--anchor-date") || "2026-07-24";
const sessionsRoot = resolveSessionsRoot(root);
const assetsDir = evidenceAssetsDir(sessionsRoot, anchorDate);
const outputDir = evidenceOutputDir(sessionsRoot, anchorDate);

if (!fs.existsSync(assetsDir)) {
  console.error(`ERROR: Assets folder not found: ${assetsDir}`);
  console.error("Run npm run export:demo-evidence-prompts first, then place generated images in the assets folder.");
  process.exit(1);
}

const history = await loadMidlandsHistoryForEvidence({
  root,
  anchorDate,
  companyFolderId: readDemoCompanyFolderId(),
  masterSheetId: readDemoCompanySpreadsheetId(),
  password,
});

const plan = buildEvidencePlanFromHistory(history);

let bundle;
try {
  bundle = importLocalEvidenceBundle({ plan, assetsDir, outputDir });
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}

const report = {
  companyName: MIDLANDS_DEMO_COMPANY_NAME,
  mode: "imported-assets",
  anchorDate,
  assetsDir,
  outputDir,
  fingerprint: bundle.manifest.fingerprint,
  summary: bundle.manifest.summary,
  linkage: bundle.manifest.linkage,
  pairAssignments: bundle.manifest.pairAssignments,
  generatedAt: new Date().toISOString(),
};

const reportPath = path.join(root, MIDLANDS_EVIDENCE_REPORT_FILE);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log("\nMidlands demo evidence import complete");
console.log(`  Anchor date: ${anchorDate}`);
console.log(`  Assets: ${assetsDir}`);
console.log(`  Output: ${outputDir}`);
console.log(`  Images: ${bundle.manifest.summary.imageCount}`);
console.log(`  Fingerprint: ${bundle.manifest.fingerprint}`);
console.log(`  Report: ${reportPath}`);
