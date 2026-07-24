#!/usr/bin/env node
/**
 * Export Midlands demo evidence prompt/spec pack for external image generation.
 *
 * Usage:
 *   DEMO_COMPANY_SEED_CONFIRM=yes BERT_DEMO_DEFAULT_PASSWORD='...' npm run export:demo-evidence-prompts -- --anchor-date=2026-07-24
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
import {
  buildPromptPack,
  formatPromptPackMarkdown,
} from "../shared/midlands-evidence-specs.mjs";
import {
  EVIDENCE_ASSETS_SUBDIR,
  EVIDENCE_PROMPT_PACK_SUBDIR,
  evidenceAssetsDir,
  evidencePromptPackDir,
} from "../shared/midlands-precast-evidence.mjs";
import {
  buildEvidencePlanFromHistory,
  loadMidlandsHistoryForEvidence,
  readArg,
  resolveSessionsRoot,
} from "./lib/demo-evidence-script-utils.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const confirm = String(process.env[DEMO_COMPANY_SEED_CONFIRM_ENV] || "").trim().toLowerCase();
if (confirm !== "yes") {
  console.error(`ERROR: Set ${DEMO_COMPANY_SEED_CONFIRM_ENV}=yes to export Midlands demo evidence prompts.`);
  process.exit(1);
}

const password = String(process.env.BERT_DEMO_DEFAULT_PASSWORD || "").trim();
if (!password || password.length < 12) {
  console.error("ERROR: Set BERT_DEMO_DEFAULT_PASSWORD (>= 12 chars).");
  process.exit(1);
}

const anchorDate = readArg(process.argv, "--anchor-date") || "2026-07-24";
const sessionsRoot = resolveSessionsRoot(root);
const promptDir = evidencePromptPackDir(sessionsRoot, anchorDate);
const assetsDir = evidenceAssetsDir(sessionsRoot, anchorDate);

const history = await loadMidlandsHistoryForEvidence({
  root,
  anchorDate,
  companyFolderId: readDemoCompanyFolderId(),
  masterSheetId: readDemoCompanySpreadsheetId(),
  password,
});

const plan = buildEvidencePlanFromHistory(history);
const pack = buildPromptPack(plan);
pack.assetsDirectory = assetsDir;
pack.promptPackDirectory = promptDir;

fs.mkdirSync(promptDir, { recursive: true });
fs.mkdirSync(assetsDir, { recursive: true });

const jsonPath = path.join(promptDir, "evidence-prompts.json");
const mdPath = path.join(promptDir, "evidence-prompts.md");
const readmePath = path.join(promptDir, "README.md");

fs.writeFileSync(jsonPath, `${JSON.stringify(pack, null, 2)}\n`);
fs.writeFileSync(mdPath, formatPromptPackMarkdown(pack));
fs.writeFileSync(
  readmePath,
  [
    "# Midlands demo evidence asset pipeline",
    "",
    `Anchor date: ${anchorDate}`,
    "",
    "1. Generate one image per spec in `evidence-prompts.md` using an external image system.",
    `2. Save each file to \`${assetsDir}\` using the exact \`expectedFileName\` (JPG or PNG).`,
    "3. Run `npm run import:demo-evidence-assets -- --anchor-date=" + anchorDate + "`",
    "4. Run `npm run generate:demo-evidence -- --anchor-date=" + anchorDate + "` or `npm run seed:demo-evidence`",
    "",
  ].join("\n"),
);

console.log("\nMidlands demo evidence prompt export complete");
console.log(`  Company: ${MIDLANDS_DEMO_COMPANY_NAME}`);
console.log(`  Anchor date: ${anchorDate}`);
console.log(`  Images planned: ${pack.imageCount}`);
console.log(`  Prompt pack: ${promptDir}`);
console.log(`  JSON: ${jsonPath}`);
console.log(`  Markdown: ${mdPath}`);
console.log(`  Expected assets folder: ${assetsDir}`);
console.log(`  Assets subdir name: ${EVIDENCE_ASSETS_SUBDIR}`);
console.log(`  Prompt pack subdir: ${EVIDENCE_PROMPT_PACK_SUBDIR}`);
