#!/usr/bin/env node
/**
 * Users from company workbook — Users tab truth, ACTIVE + CompanyFolderId filter, no cache-only users.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isActiveUser, isListableCompanyProfile } from "../shared/schedule-assignees.mjs";
import {
  DOVECOTE_EXPECTED_EMAILS,
  DOVECOTE_FOLDER_ID,
  DOVECOTE_MASTER_SHEET_ID,
  DOVECOTE_USERS_TAB_HEADERS,
  DOVECOTE_USERS_TAB_ROWS,
} from "./fixtures/dovecote-users-tab.fixture.mjs";
import { listableProfilesFromUsersTabRecords } from "../server/users-tab-profiles.mjs";

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

function rowsToRecords(headers, rows) {
  return rows.map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? "";
    });
    return record;
  });
}

const pkg = JSON.parse(read("package.json"));
const userService = read("server/company-user-service.mjs");
const foundation = read("server/company-users-foundation.mjs");
const sheetFlow = read("server/company-user-sheet-flow.mjs");
const serverMain = read("server/server.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");

assert(pkg.scripts["verify:users-from-company-workbook"], "1: npm script registered");
assert(userService.includes("export async function readUsersTab"), "2: userService.readUsersTab");
assert(userService.includes("listActiveUsers"), "3: userService.listActiveUsers");
assert(userService.includes("repairUsersTabSchema"), "4: userService.repairUsersTabSchema");
assert(userService.includes("writeUserRow"), "5: userService.writeUserRow");
assert(userService.includes("rebuildUserCacheFromSheet"), "6: userService.rebuildUserCacheFromSheet");
assert(foundation.includes("listCompanyProfiles"), "7: foundation listCompanyProfiles canonical path");
assert(!foundation.includes("cacheOnlyUsers") || foundation.includes("cacheOnlyUsersRemoved"), "8: cache-only users removed on sync");
assert(sheetFlow.includes("listActiveUsersFromSheet"), "9: listActiveUsersFromSheet helper");
assert(coreRoutes.includes("listCompanyProfiles"), "10: routes use foundation listCompanyProfiles path");

const records = rowsToRecords(DOVECOTE_USERS_TAB_HEADERS, DOVECOTE_USERS_TAB_ROWS);
const companyCtx = {
  companyFolderId: DOVECOTE_FOLDER_ID,
  companyId: DOVECOTE_FOLDER_ID,
  companyName: "Dovecote Studio",
  masterSheetId: DOVECOTE_MASTER_SHEET_ID,
};
const mapped = listableProfilesFromUsersTabRecords(records, companyCtx);

assert(mapped.members.length === 3, "11: Dovecote fixture yields 3 listable profiles");
assert(
  mapped.members.every((row) => isActiveUser(row) && isListableCompanyProfile(row)),
  "12: all fixture profiles are ACTIVE listable",
);
assert(
  DOVECOTE_EXPECTED_EMAILS.every((email) =>
    mapped.members.some((row) => String(row.email).toLowerCase() === email),
  ),
  "13: expected Dovecote emails present",
);
assert(!mapped.members.some((row) => "passwordHash" in row || "PasswordHash" in row), "14: no PasswordHash in profiles");

const pendingRecord = {
  Email: "pending@example.com",
  Name: "Pending",
  Role: "Auditor",
  Status: "INVITED",
  CompanyFolderId: DOVECOTE_FOLDER_ID,
};
const withPending = listableProfilesFromUsersTabRecords([...records, pendingRecord], companyCtx);
assert(
  withPending.members.length === mapped.members.length,
  "15: pending invites excluded from active list",
);

console.log(`[verify:users-from-company-workbook] OK — ${caseCount} cases passed`);
