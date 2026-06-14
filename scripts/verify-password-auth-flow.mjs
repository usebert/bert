#!/usr/bin/env node
/** Reset and login must share user-auth-service — single PasswordHash source on Users tab. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const userAuth = read("server/user-auth-service.mjs");
const resetModule = read("server/password-reset.mjs");
const authService = read("server/auth-service.mjs");
const companyUsers = read("server/company-users.mjs");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:password-auth-flow"], "PKG: npm script registered");

assert(userAuth.includes("from \"./master-auth.mjs\""), "1a: hash helpers sourced from master-auth");
assert(userAuth.includes("writeUsersTabRecordByHeaders"), "1b: writes by sheet headers not column index");
assert(userAuth.includes("readCompanyUsersTabRecord"), "1c: reads Users tab row by email header");

assert(resetModule.includes("user-auth-service.mjs"), "2a: password reset imports user-auth-service");
assert(authService.includes("user-auth-service.mjs"), "2b: login imports user-auth-service");

assert(!resetModule.includes("updateConfig(auth, masterSheetId, { ...cfg, [key]:"), "3a: reset does not write Config UserAuth");
assert(companyUsers.includes("PasswordHash"), "3b: Users tab schema includes PasswordHash column");

assert(userAuth.includes("attemptUsersTabPasswordLogin"), "4: shared Users tab login fallback");
assert(userAuth.includes("debugVerifyUserPassword"), "5: godmode debug helper exported");
assert(read("shared/auth-index-trust.mjs").includes("7oakcottages@gmail.com"), "6: stale Rock Solid audit email documented");

console.log(`[verify:password-auth-flow] OK — ${caseCount} cases passed`);
