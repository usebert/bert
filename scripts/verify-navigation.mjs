#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
let checks = 0;

function read(filePath) {
  return fs.readFileSync(path.join(root, filePath), "utf8");
}

function assert(condition, message) {
  checks += 1;
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function assertContains(filePath, snippets) {
  const content = read(filePath);
  for (const snippet of snippets) {
    assert(content.includes(snippet), `Missing "${snippet}" in ${filePath}`);
  }
}

function assertNotContains(filePath, snippets) {
  const content = read(filePath);
  for (const snippet of snippets) {
    assert(!content.includes(snippet), `Unexpected "${snippet}" still present in ${filePath}`);
  }
}

const roleNav = read("src/config/roleNavigation.ts");
const appTsx = read("App.tsx");
const permissions = read("src/permissions.ts");

assert(roleNav.includes('id: "auditCentre", label: "Audit Centre"'), "sidebar template includes Audit Centre");
assert(roleNav.includes("COMPANY_ADMIN_NAV") && roleNav.includes("MANAGER_NAV") && roleNav.includes("AUDITOR_NAV"), "role nav buckets present");

assertNotContains("src/config/roleNavigation.ts", [
  'id: "googleForms", label: "Google Forms"',
  'id: "audits", label: "Complete Work"',
  'id: "audits", label: "My Checks"',
]);

assert(roleNav.includes('export const COMPLETE_WORK_NAV_SCREEN_ID = "audits"'), "Complete Work internal route remains audits");
assert(roleNav.includes("isAuditCentreNavActive"), "Audit Centre nav active helper exported");
assert(roleNav.includes('"googleForms"'), "googleForms remains an internal child route");

assertContains("src/screens/AuditCentreScreen.tsx", [
  "Build audits/checks",
  "Complete assigned work",
  "Manage forms",
  "Completed work",
  'screen: "auditBuilder"',
  'screen: "audits"',
  'screen: "googleForms"',
  'screen: "results"',
]);

assertContains("App.tsx", [
  "AuditCentreScreen",
  "screen === \"auditCentre\"",
  "isAuditCentreNavActive",
  "canAccessAuditCentre",
]);

assert(appTsx.includes('screen === "googleForms"'), "Google Forms screen still mounted");
assert(appTsx.includes("isCompleteWorkListScreen(screen)"), "Complete Work list still mounted via audits route");
assert(appTsx.includes('screen === "auditBuilder"'), "Audit Builder still mounted");

assert(permissions.includes("canAccessAuditCentre"), "Audit Centre permission helper exists");
assert(permissions.includes('if (itemId === "auditCentre") return canAccessAuditCentre(role)'), "nav permission wired");
assert(permissions.includes('if (itemId === "audits")'), "audits route permission unchanged");
assert(permissions.includes('if (itemId === "googleForms")'), "googleForms route permission unchanged");

assertContains("src/config/navStructure.ts", ['"auditCentre"']);
assert(read("src/config/navStructure.ts").includes('MOBILE_BOTTOM_NAV_IDS = ["dashboard", "auditCentre"'), "mobile tab uses Audit Centre");

assertContains("package.json", ["verify:navigation"]);

console.log(`[verify:navigation] ${checks} checks OK`);
