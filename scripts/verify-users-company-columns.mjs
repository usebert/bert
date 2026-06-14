#!/usr/bin/env node
/** Users tab Company columns — schema, migration, filter, auth index rebuild. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { USERS_TAB_CORE_COLUMNS } from "../server/users-tab-constants.mjs";
import {
  backfillRowCompanyFields,
  rowMatchesCompanyContext,
  rowPointsToOtherCompany,
} from "../server/users-tab-schema.mjs";

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

const constants = read("server/users-tab-constants.mjs");
const companyUsers = read("server/company-users.mjs");
const sheetFlow = read("server/company-user-sheet-flow.mjs");
const authIndex = read("server/auth-index.mjs");
const reader = read("server/users-tab-reader.mjs");
const serverMain = read("server/server.mjs");
const pkg = JSON.parse(read("package.json"));

const folderA = "folder-dovecote";
const folderB = "folder-other";
const companyName = "Dovecote Studio";
const masterSheetA = "sheet-dovecote-master";

/** 1: Core column order includes Company, CompanyId, CompanyFolderId. */
{
  assert(constants.includes("USERS_TAB_CORE_COLUMNS"), "1: USERS_TAB_CORE_COLUMNS defined");
  const idxCompany = USERS_TAB_CORE_COLUMNS.indexOf("Company");
  const idxCompanyId = USERS_TAB_CORE_COLUMNS.indexOf("CompanyId");
  const idxFolder = USERS_TAB_CORE_COLUMNS.indexOf("CompanyFolderId");
  assert(idxCompany >= 0 && idxCompanyId > idxCompany && idxFolder > idxCompanyId, "1b: company cols in order");
  assert(USERS_TAB_CORE_COLUMNS[0] === "Email" && USERS_TAB_CORE_COLUMNS[1] === "Name", "1c: Email/Name first");
}

/** 2: migrateUsersTabCompanyColumns exported and backfills blank rows. */
{
  assert(companyUsers.includes("export async function migrateUsersTabCompanyColumns"), "2: migration exported");
  assert(companyUsers.includes("backfillRowCompanyFields"), "2b: backfill helper used");
}

/** 3: Blank company cols backfill from context; other-company rows excluded. */
{
  const blankRow = { Email: "user@example.com", Status: "ACTIVE" };
  const filled = backfillRowCompanyFields(blankRow, {
    companyFolderId: folderA,
    companyName,
  });
  assert(filled.Company === companyName, "3: blank Company backfilled");
  assert(filled.CompanyId === folderA && filled.CompanyFolderId === folderA, "3b: blank ids backfilled");
  assert(rowMatchesCompanyContext(filled, { companyFolderId: folderA }), "3c: backfilled row matches context");
  const otherRow = { Email: "other@example.com", Status: "ACTIVE", CompanyId: folderB };
  assert(rowPointsToOtherCompany(otherRow, { companyFolderId: folderA }), "3d: other company excluded");
  assert(!rowMatchesCompanyContext(otherRow, { companyFolderId: folderA }), "3e: other company does not match");
  const legacyMasterSheetRow = { Email: "legacy@example.com", Status: "ACTIVE", CompanyId: masterSheetA };
  assert(
    rowMatchesCompanyContext(legacyMasterSheetRow, { companyFolderId: folderA, masterSheetId: masterSheetA }),
    "3f: legacy CompanyId=masterSheetId still matches",
  );
  const repairedLegacy = backfillRowCompanyFields(legacyMasterSheetRow, {
    companyFolderId: folderA,
    masterSheetId: masterSheetA,
    companyName,
  });
  assert(repairedLegacy.CompanyId === folderA && repairedLegacy.CompanyFolderId === folderA, "3g: legacy ids repaired on backfill");
}

/** 4: Active user list filters by company columns. */
{
  assert(sheetFlow.includes("rowMatchesCompanyContext"), "4: sheet flow filters by company context");
  assert(sheetFlow.includes("mapActiveCompanyMember(row, companyCtx)"), "4b: active member uses company context");
}

/** 5: Writer sets Company, CompanyId, CompanyFolderId. */
{
  assert(serverMain.includes("CompanyId: companyFolderId"), "5: writeCompanyUsers sets CompanyId");
  assert(serverMain.includes("CompanyFolderId: companyFolderId"), "5b: writeCompanyUsers sets CompanyFolderId");
  assert(companyUsers.includes("Company:"), "5c: writeUsersTabRecordByHeaders sets Company");
}

/** 6: Auth index rebuild uses row company columns and filters. */
{
  assert(authIndex.includes("pickRowCompanyName"), "6: auth index reads Company from row");
  assert(authIndex.includes("rowMatchesCompanyContext"), "6b: auth index filters by company cols");
  assert(authIndex.includes("entryFromUsersTabRow"), "6c: entry built from Users tab row");
}

/** 7: Schema repair wires company migration. */
{
  assert(reader.includes("migrateUsersTabCompanyColumns"), "7: repairUsersTabSchema wires company migration");
  assert(serverMain.includes("companyContext:"), "7b: godmode repair passes companyContext");
}

/** 8: npm script registered. */
assert(pkg.scripts["verify:users-company-columns"], "8: npm script registered");

console.log("[verify:users-company-columns] OK: all company column cases passed");
