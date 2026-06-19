#!/usr/bin/env node
/** Google Drive id validation — rejects corrupted Dovecote fixture ids from the incident report. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isValidCompanyFolderId,
  isValidGoogleSpreadsheetId,
  sanitizeCompanyFolderId,
  sanitizeGoogleSpreadsheetId,
  validateCompanyDriveIds,
} from "../shared/google-drive-id.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const DOVECOTE_FOLDER = "1TVQ-gbpxoOzE6PCkHX581eTDgtMC11lc";
const DOVECOTE_SHEET = "1PlwknNgtt-4j08matn1w4358YTe5SXFs5Hh0zA_m3So";
const CORRUPT_FOLDER = "1TVQ-gbpxoOzE6PCkHX581eTDgtMC1lc";
const CORRUPT_SHEET = "1PlwknNgtt-4jO8matn1w4358YTe5SXFs5HhOzA_m3So";

assert(isValidCompanyFolderId(DOVECOTE_FOLDER), "1: Dovecote folder id valid");
assert(isValidGoogleSpreadsheetId(DOVECOTE_SHEET), "2: Dovecote master sheet valid");
assert(!isValidCompanyFolderId(CORRUPT_FOLDER), "3: truncated folder id rejected");
assert(sanitizeCompanyFolderId(CORRUPT_FOLDER) === "", "4: corrupted folder sanitized away");
assert(sanitizeGoogleSpreadsheetId(CORRUPT_SHEET) === CORRUPT_SHEET, "5: same-length sheet still passes format");
assert(
  validateCompanyDriveIds({ companyFolderId: DOVECOTE_FOLDER, masterSheetId: DOVECOTE_SHEET })?.companyFolderId ===
    DOVECOTE_FOLDER,
  "6: validateCompanyDriveIds accepts Dovecote pair",
);
assert(validateCompanyDriveIds({ companyFolderId: CORRUPT_FOLDER, masterSheetId: DOVECOTE_SHEET }) === null, "7: corrupt folder pair rejected");

const clientHint = read("src/lib/companyLoginHint.ts");
const contextService = read("src/services/companyContextService.ts");
const userService = read("src/services/companyUserService.ts");
const foundation = read("server/company-users-foundation.mjs");
const authService = read("server/auth-service.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");

assert(clientHint.includes("validateCompanyDriveIds"), "8: login hint validates on read/write");
assert(contextService.includes("sanitizeCompanyFolderId"), "9: members context sanitizes folder id");
assert(userService.includes("INVALID_COMPANY_ID"), "10: client blocks invalid company id before fetch");
assert(foundation.includes("isValidCompanyFolderId"), "11: server foundation uses strict folder validation");
assert(authService.includes("sanitizeGoogleSpreadsheetId"), "12: login ignores invalid client sheet hints");
assert(coreRoutes.includes("sanitizeCompanyFolderId"), "13: users route sanitizes query ids");

console.log("[verify:google-drive-id] OK: drive id validation contract passed");
