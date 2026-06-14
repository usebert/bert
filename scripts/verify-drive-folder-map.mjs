#!/usr/bin/env node
/**
 * Drive folder map — company folder anchor, workbook discovery, both naming patterns.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCompanyMasterSheetName,
  buildCompanyWorkbookName,
} from "../server/company-folder-structure.mjs";
import {
  DOVECOTE_FOLDER_ID,
  DOVECOTE_MASTER_SHEET_ID,
  DOVECOTE_COMPANY_NAME,
} from "./fixtures/dovecote-users-tab.fixture.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;

function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const pkg = JSON.parse(read("package.json"));
const companyService = read("server/company-service.mjs");
const folderStructure = read("server/company-folder-structure.mjs");
const resolver = read("server/company-folder-resolver.mjs");
const foundation = read("server/company-users-foundation.mjs");

assert(pkg.scripts["verify:drive-folder-map"], "1: npm script registered");
assert(companyService.includes("findCompanyWorkbook"), "2: companyService.findCompanyWorkbook exported");
assert(companyService.includes("ensureCompanyWorkbook"), "3: companyService.ensureCompanyWorkbook exported");
assert(companyService.includes("ensureRequiredTabs"), "4: companyService.ensureRequiredTabs exported");
assert(companyService.includes("resolveCompanyFromFolder"), "5: companyService.resolveCompanyFromFolder exported");

assert(folderStructure.includes("export async function findCompanyWorkbook"), "6: findCompanyWorkbook in folder structure");
assert(folderStructure.includes("export async function ensureCompanyWorkbook"), "7: ensureCompanyWorkbook alias");
assert(folderStructure.includes("buildCompanyWorkbookName"), "8: BERT Workbook naming helper");
assert(folderStructure.includes("bert workbook"), "9: discovery matches BERT Workbook pattern");
assert(folderStructure.includes("01 - BERT System Files"), "10: standard folder tree includes BERT System Files");
assert(folderStructure.includes("Company Workbook"), "11: Company Workbook subfolder in tree");

assert(
  buildCompanyMasterSheetName("Dovecote Studio") === "Dovecote Studio - BERT Master Sheet",
  "12: Dovecote master sheet name",
);
assert(
  buildCompanyWorkbookName("Dovecote Studio") === "Dovecote Studio - BERT Workbook",
  "13: Dovecote workbook alternate name",
);
assert(folderStructure.includes("scoreMasterSheetCandidate"), "14: scoring helper for both workbook names");
assert(folderStructure.includes('lower.includes("bert workbook")'), "15: scores BERT Workbook candidates");

assert(resolver.includes("discoverCompanyMasterSheetInFolder"), "16: resolver uses folder discovery");
assert(resolver.includes("preferFolderResolution"), "17: folder discovery wins over stale hints");
assert(foundation.includes("preferFolderResolution: true"), "18: users foundation prefers folder resolution");

assert(DOVECOTE_FOLDER_ID === "1TVQ-gbpxoOzE6PCkHX581eTDgtMC11c", "19: Dovecote folder id fixture");
assert(
  DOVECOTE_MASTER_SHEET_ID === "1PlwknNgtt-4j08matn1w4358YTe5SXFs5Hh0zA_m3So",
  "20: Dovecote masterSheetId fixture (not stale 1PIwkn)",
);
assert(DOVECOTE_COMPANY_NAME === "Dovecote Studio", "21: Dovecote company name fixture");

console.log(`[verify:drive-folder-map] OK — ${caseCount} cases passed`);
