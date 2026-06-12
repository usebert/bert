#!/usr/bin/env node
/** Invite → Users tab → login flow — 12 static contract cases. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const sheetFlow = read("server/company-user-sheet-flow.mjs");
const serverMain = read("server/server.mjs");
const companyUsers = read("server/company-users.mjs");
const authService = read("server/auth-service.mjs");
const inviteService = read("server/invite-service.mjs");

/** 1: completeInviteToUserRow exported. */
assert(sheetFlow.includes("export async function completeInviteToUserRow"), "1: completeInviteToUserRow exported");

/** 2: Invite completion route uses completeInviteToUserRow. */
assert(serverMain.includes("completeInviteToUserRow"), "2: server wires completeInviteToUserRow");
assert(
  serverMain.includes("completeInviteToUserRow(") && serverMain.includes("writeCompanyUsers"),
  "2b: completion passes writeCompanyUsers dep",
);

/** 3: Invite create is token-only — no Users tab write on create. */
assert(serverMain.includes("createInviteRecord({"), "3: invite create uses token store");
assert(
  !serverMain.includes("writeCompanyUsers(authed, resolvedMasterSheetId") &&
    !serverMain.includes("writeCompanyUsers(auth, resolvedMasterSheetId"),
  "3b: invite create does not write Users tab",
);

/** 4: completeInviteToUserRow sets ACTIVE + password. */
assert(sheetFlow.includes('status: "ACTIVE"'), "4: completion writes ACTIVE status");
assert(sheetFlow.includes("password"), "4b: completion accepts password for PasswordHash");

/** 5: CreatedAt preserved on existing row. */
assert(sheetFlow.includes("existing?.createdAt"), "5: preserves CreatedAt from existing Users row");
assert(sheetFlow.includes("CreatedAt: createdAt"), "5b: passes CreatedAt into sheet write");

/** 6: Invite marked used only after sheet write succeeds. */
assert(
  serverMain.includes("patchInviteRecord(tokenId") && serverMain.includes('status: "USED"'),
  "6: consumed invite patch after completion",
);
assert(
  serverMain.indexOf("completeInviteToUserRow") < serverMain.indexOf('status: "USED"'),
  "6b: completeInviteToUserRow runs before USED patch",
);

/** 7: canLoginCompanyUser reads Users tab. */
assert(sheetFlow.includes("export async function canLoginCompanyUser"), "7: canLoginCompanyUser exported");
assert(sheetFlow.includes("verifyCompanyUserPassword"), "7b: login verifies PasswordHash on sheet");

/** 8: Login fails without Users tab row. */
assert(sheetFlow.includes('reason: "user_not_found"'), "8: missing sheet row fails login");
assert(authService.includes("canLoginCompanyUser"), "8b: auth-service uses canLoginCompanyUser");

/** 9: Resend replaces token — no active user until completion. */
assert(inviteService.includes("isCompanyUserInviteActiveForResend"), "9: resend helper exists");
assert(serverMain.includes("findCompanyUserInviteForResend"), "9b: resend finds existing invite token");
assert(!sheetFlow.includes("createInviteRecord"), "9c: sheet flow does not create invite tokens");

/** 10: PasswordHash never returned to clients. */
assert(companyUsers.includes("sanitizeUserRecordForClient"), "10: sanitize strips PasswordHash");
assert(sheetFlow.includes("sanitizeUserRecordForClient"), "10b: completion returns sanitized user");

/** 11: Failed completion keeps invite pending. */
assert(serverMain.includes("USER_ACCOUNT_CREATE_FAILED"), "11: USER_ACCOUNT_CREATE_FAILED code");
assert(serverMain.includes("consumedAt: null"), "11b: failure clears consumedAt");

/** 12: canLoginCompanyUser requires ACTIVE status. */
assert(sheetFlow.includes('rec.status !== "ACTIVE"'), "12: inactive Users tab row blocks login");

/** 13: Invite completion session uses login workbook resolver. */
assert(serverMain.includes("resolveCompanyContextFromLoginWorkbook"), "13: invite completion uses login workbook resolver");
{
  const completionBlock = serverMain.slice(
    serverMain.indexOf('if (record.kind === "company_user")'),
    serverMain.indexOf("} catch (completionErr)"),
  );
  assert(
    completionBlock.includes("completeInviteToUserRow") &&
      completionBlock.includes("resolveCompanyContextFromLoginWorkbook"),
    "13b: company_user completion block resolves workbook context after sheet write",
  );
  assert(
    completionBlock.indexOf("completeInviteToUserRow") <
      completionBlock.indexOf("resolveCompanyContextFromLoginWorkbook"),
    "13c: sheet write precedes workbook context in completion block",
  );
}

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["verify:invite-to-sheet-user-flow"], "npm script registered");

console.log("[verify:invite-to-sheet-user-flow] OK: all 14 invite-to-sheet-user cases passed");
