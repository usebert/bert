#!/usr/bin/env node
/** Users tab reader — resolve legacy tab names, ensure headers, surface Google errors. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findUsersTabTitle,
  USERS_TAB_CANONICAL,
  USERS_TAB_LEGACY_NAMES,
  USERS_TAB_MINIMUM_HEADERS,
} from "../server/users-tab-reader.mjs";

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

const reader = read("server/users-tab-reader.mjs");
const userService = read("server/company-user-service.mjs");
const companyUsers = read("server/company-users.mjs");
const serverMain = read("server/server.mjs");
const pkg = JSON.parse(read("package.json"));

/** 1: resolveUsersTab exported with metadata + header ensure. */
{
  assert(reader.includes("export async function resolveUsersTab"), "1: resolveUsersTab exported");
  assert(reader.includes("findUsersTabTitle"), "1b: legacy tab finder");
  assert(reader.includes("ensureColumns"), "1c: ensureColumns for headers");
  assert(reader.includes("createIfMissing"), "1d: create Users tab when missing");
}

/** 2: Legacy tab resolution order — exact, case-insensitive, legacy names. */
{
  assert(USERS_TAB_CANONICAL === "Users", "2: canonical tab name");
  assert(USERS_TAB_LEGACY_NAMES.includes("CompanyUsers"), "2b: CompanyUsers legacy");
  assert(USERS_TAB_LEGACY_NAMES.includes("Company Login"), "2c: Company Login legacy");
  const exact = findUsersTabTitle(["Config", "Users", "Schedule"]);
  assert(exact?.tabTitle === "Users" && exact.matchKind === "exact", "2d: exact Users match");
  const legacy = findUsersTabTitle(["Config", "CompanyUsers"]);
  assert(legacy?.tabTitle === "CompanyUsers" && legacy.matchKind === "legacy", "2e: legacy tab match");
  const caseInsensitive = findUsersTabTitle(["users"]);
  assert(caseInsensitive?.tabTitle === "users" && caseInsensitive.matchKind === "case_insensitive", "2f: case-insensitive");
}

/** 3: Minimum required headers include PasswordHash (sanitized on read). */
{
  for (const header of [
    "Email",
    "Name",
    "Role",
    "AccessLevel",
    "Status",
    "CompanyAreas",
    "PasswordHash",
    "CreatedAt",
    "UpdatedAt",
  ]) {
    assert(USERS_TAB_MINIMUM_HEADERS.includes(header), `3: minimum header ${header}`);
  }
  assert(reader.includes("sanitizeUsersTabRecords"), "3b: PasswordHash stripped on read");
}

/** 4: readCompanyUsers logs Google errors and classifies permission denied. */
{
  assert(reader.includes("export async function readCompanyUsers"), "4: readCompanyUsers exported");
  assert(reader.includes("GOOGLE_SHEETS_PERMISSION_DENIED"), "4b: permission denied code");
  assert(reader.includes("[users-tab-reader] read failed"), "4c: structured read failure log");
  assert(reader.includes("googleError"), "4d: google error payload logged");
}

/** 5: Company member list uses readCompanyUsers, not full workbook scan. */
{
  assert(userService.includes("readCompanyUsers"), "5: company-user-service uses readCompanyUsers");
  assert(userService.includes("resolveUsersTab"), "5b: resolveUsersTab wired");
  assert(userService.includes("isStaleMasterSheetError"), "5c: stale masterSheetId retry");
  assert(companyUsers.includes("resolveUsersTabTitle"), "5d: company-users resolves tab title");
}

/** 6: Godmode repair endpoint + advanced diagnostics action. */
{
  assert(serverMain.includes("/api/godmode/companies/:companyId/repair-users-tab"), "6: repair route");
  assert(serverMain.includes("repairUsersTab"), "6b: repairUsersTab handler");
  const panel = read("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx");
  assert(panel.includes("Repair Users tab"), "6c: godmode advanced diagnostics button");
}

assert(pkg.scripts["verify:users-tab-reader"], "7: npm script registered");

console.log("[verify:users-tab-reader] OK: all users tab reader cases passed");
