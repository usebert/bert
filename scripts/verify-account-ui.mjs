#!/usr/bin/env node
/**
 * Account UI — name, email, role, company visible; no technical clutter for company roles.
 */
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

const accountScreen = read("src/screens/AccountSettingsScreen.tsx");
const accountSummary = read("src/components/AccountIdentitySummary.tsx");
const uxDeclutter = read("src/utils/uxDeclutter.ts");
const appTsx = read("App.tsx");
const serverMain = read("server/server.mjs");
const authService = read("server/auth-service.mjs");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:account-ui"], "PKG: npm script registered");
assert(accountScreen.includes("AccountIdentitySummary"), "account screen uses identity summary");
assert(accountScreen.includes("Signed in as"), "account section labels signed-in identity");
assert(accountSummary.includes("resolveUserEmail"), "email resolved from session user");
assert(accountSummary.includes("getAccountRoleLabel"), "role label shown");
assert(accountSummary.includes("companyName") && accountSummary.includes("Company"), "company name shown");
assert(uxDeclutter.includes("getAccountRoleDetail"), "Godmode role detail available");
assert(!accountScreen.includes("masterSheetId"), "account screen does not show master sheet id");
assert(!accountScreen.includes("registry"), "account screen does not show registry jargon");
assert(appTsx.includes('screen === "account"'), "account route rendered in App");
assert(
  serverMain.includes('app.get("/api/auth/company/session"') && serverMain.includes("companyName"),
  "session refresh returns companyName",
);
assert(
  authService.includes("buildCompanySessionPayload") || serverMain.includes("buildCompanySessionPayload"),
  "company session payload builder exists",
);
assert(
  /buildCompanySessionPayload[\s\S]*?email[\s\S]*?companyName[\s\S]*?role/.test(authService),
  "session payload includes email, role, companyName",
);

console.log(`[verify:account-ui] OK — ${caseCount} cases passed`);
