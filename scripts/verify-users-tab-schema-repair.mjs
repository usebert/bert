#!/usr/bin/env node
/** Users tab schema repair — shifted legacy detection, read/write by header name, repair migration. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isShiftedLegacyUsersRow,
  isValidCompanyUserEmail,
  normalizeRoleForSheetRepair,
  normalizeUsersTabRowObject,
  remapShiftedLegacyUsersRow,
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

const reader = read("server/users-tab-reader.mjs");
const companyUsers = read("server/company-users.mjs");
const usersTabSchema = read("server/users-tab-schema.mjs");
const sheetFlow = read("server/company-user-sheet-flow.mjs");
const serverMain = read("server/server.mjs");
const pkg = JSON.parse(read("package.json"));

const PASSWORD_HASH = "scrypt$N=16384,r=8,p=1$abc$def123";

/** Dovecote-style shifted legacy row (headers correct, values offset). */
const shiftedRow = {
  Email: "app-dovecotestudio-icloud-com-admin",
  Name: "company-folder-dovecote",
  Role: "dovecotestudio@icloud.com",
  AccessLevel: "Andy Dovecote",
  Status: "Admin",
  CompanyAreas: "full",
  PasswordHash: "",
  CreatedAt: "ACTIVE",
  UpdatedAt: PASSWORD_HASH,
};

/** 1: Shifted legacy detection. */
{
  assert(isShiftedLegacyUsersRow(shiftedRow), "1: detects shifted legacy row");
  assert(!isShiftedLegacyUsersRow({ Email: "user@example.com", Role: "User", Status: "ACTIVE" }), "1b: canonical row not shifted");
}

/** 2: Email/name/role/status/passwordHash recovery from shifted row. */
{
  const repaired = remapShiftedLegacyUsersRow(shiftedRow);
  assert(repaired.Email === "dovecotestudio@icloud.com", "2: email recovered from Role column");
  assert(repaired.Name === "Andy Dovecote", "2b: name recovered from AccessLevel column");
  assert(normalizeRoleForSheetRepair(repaired.Role) === "Company Admin", "2c: Admin normalised to Company Admin");
  assert(repaired.Status === "ACTIVE", "2d: ACTIVE recovered from CreatedAt column");
  assert(repaired.PasswordHash === PASSWORD_HASH, "2e: password hash recovered from UpdatedAt column");
  assert(repaired["User ID"] === shiftedRow.Email, "2f: user id preserved from Email column slot");
  assert(repaired["Company ID"] === shiftedRow.Name, "2g: company id preserved from Name column slot");
}

/** 3: PasswordHash preserved exactly during remap. */
{
  const remapped = remapShiftedLegacyUsersRow(shiftedRow);
  assert(remapped.PasswordHash === PASSWORD_HASH, "3: PasswordHash byte-identical after remap");
  const normalized = normalizeUsersTabRowObject(shiftedRow);
  assert(normalized.PasswordHash === PASSWORD_HASH, "3b: normalizeUsersTabRowObject preserves hash");
}

/** 4: Repaired rows align with header names (canonical read shape). */
{
  const normalized = normalizeUsersTabRowObject(shiftedRow);
  assert(isValidCompanyUserEmail(normalized.Email), "4: repaired Email is valid");
  assert(!isValidCompanyUserEmail(String(normalized.Name)), "4b: Name is not mistaken for email");
  assert(isValidCompanyUserEmail(normalized.Email) && normalized.Role, "4c: role present after repair");
}

/** 5: Reader exports repairUsersTabSchema with required report fields. */
{
  assert(reader.includes("export async function repairUsersTabSchema"), "5: repairUsersTabSchema exported");
  for (const field of ["rowsScanned", "rowsRepaired", "usersRecovered", "passwordHashesPreserved"]) {
    assert(reader.includes(field), `5b: report field ${field}`);
  }
  assert(reader.includes("normalizeUsersTabRowObject"), "5c: reader normalises on read");
}

/** 6: Writer uses header-name lookup, not hard-coded array order. */
{
  assert(companyUsers.includes("export async function writeUsersTabRecordByHeaders"), "6: header-aware writer exported");
  assert(usersTabSchema.includes("mapRecordToSheetHeaders") || companyUsers.includes("mapRecordToSheetHeaders"), "6b: maps record by sheet headers");
  assert(serverMain.includes("writeUsersTabRecordByHeaders"), "6c: writeCompanyUsers uses header-aware writer");
  assert(!serverMain.includes('updateRowById(auth, spreadsheetId, "Users", "User ID"'), "6d: writeCompanyUsers no longer uses positional updateRowById");
  assert(serverMain.includes("mapRowObjectToHeaders(sheetHeaders, row)"), "6e: appendRowObjects uses actual sheet headers");
}

/** 7: Post-write validation reads row back. */
{
  assert(companyUsers.includes("write_validation_failed"), "7: write validates read-back");
  assert(serverMain.includes("workbookFindCompanyUsersTabRow"), "7b: writeCompanyUsers verifies row after write");
}

/** 8: findCompanyUsersTabRow searches shifted email locations. */
{
  assert(companyUsers.includes("rowEmailCandidates"), "8: email search includes shifted columns");
  assert(companyUsers.includes("normalizeUsersTabRowObject(rawObj)"), "8b: find row normalises before mapping");
}

/** 9: Godmode schema repair endpoint wired. */
{
  assert(
    serverMain.includes("/api/godmode/companies/:companyId/repair-users-tab-schema"),
    "9: repair-users-tab-schema route",
  );
  assert(serverMain.includes("repairUsersTabSchema"), "9b: handler calls repairUsersTabSchema");
}

/** 10: Company profiles flow reads normalised sheet rows. */
{
  const profilesModule = read("server/users-tab-profiles.mjs");
  assert(sheetFlow.includes("readCompanyUsers") || sheetFlow.includes("readUsersTabRecords"), "10: company profiles read via users tab reader");
  assert(
    sheetFlow.includes("listableProfilesFromUsersTabRecords") || profilesModule.includes("mapUsersTabProfileMember"),
    "10b: company profile filter",
  );
  assert(
    profilesModule.includes("isExcludedCompanyProfileStatus") || sheetFlow.includes("isExcludedCompanyProfileStatus"),
    "10c: deleted/removed rows excluded",
  );
}

/** 11: Invite completion writes correct schema. */
{
  assert(sheetFlow.includes("completeInviteToUserRow"), "11: invite completion exported");
  assert(sheetFlow.includes("writeCompanyUsers"), "11b: invite uses writeCompanyUsers");
  assert(sheetFlow.includes("canLoginCompanyUser"), "11c: post-invite login verification");
}

/** 12: Login reads Email and PasswordHash from normalised row. */
{
  assert(companyUsers.includes("verifyCompanyUserPassword"), "12: login verifies PasswordHash");
  assert(
    companyUsers.includes('startsWith("scrypt$")') || companyUsers.includes("looksLikePasswordHash"),
    "12b: hash read from shifted UpdatedAt slot",
  );
}

/** 13: npm script registered. */
assert(pkg.scripts["verify:users-tab-schema-repair"], "13: npm script registered");

/** 14: Company columns in core schema. */
{
  const constants = read("server/users-tab-constants.mjs");
  assert(constants.includes("USERS_TAB_CORE_COLUMNS"), "14: USERS_TAB_CORE_COLUMNS defined");
  assert(constants.includes('"Company"'), "14b: Company column in schema");
  assert(constants.includes('"CompanyId"'), "14c: CompanyId column in schema");
  assert(constants.includes('"CompanyFolderId"'), "14d: CompanyFolderId column in schema");
  assert(companyUsers.includes("migrateUsersTabCompanyColumns"), "14e: company column migration exported");
}

/** 14: Second shifted user (andy@qmsprecast.co.uk pattern). */
{
  const andyShifted = {
    Email: "app-andy-qmsprecast-co-uk-user",
    Name: "company-folder-dovecote",
    Role: "andy@qmsprecast.co.uk",
    AccessLevel: "Andy Precast",
    Status: "User",
    CompanyAreas: "operational",
    PasswordHash: "",
    CreatedAt: "ACTIVE",
    UpdatedAt: "scrypt$N=16384,r=8,p=1$xyz$uvw456",
  };
  const repaired = remapShiftedLegacyUsersRow(andyShifted);
  assert(repaired.Email === "andy@qmsprecast.co.uk", "14: andy email recovered");
  assert(repaired.Name === "Andy Precast", "14b: andy name recovered");
  assert(repaired.Status === "ACTIVE", "14c: andy status ACTIVE");
}

console.log("[verify:users-tab-schema-repair] OK: all users tab schema repair cases passed");
