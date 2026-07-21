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
  't("audits.buildAudits")',
  't("audits.completeAssigned")',
  't("audits.manageForms")',
  't("audits.completedWork")',
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

assertContains("src/components/auditCentre/AuditCentreBackButton.tsx", [
  't("audits.backToCentre")',
  "min-h-[44px]",
]);

assertContains("src/screens/AuditBuilderScreen.tsx", ["AuditCentreBackButton"]);

assertContains("src/screens/GoogleFormsScreen.tsx", [
  "AuditCentreBackButton",
  "onBackToAuditCentre",
]);

assertContains("src/audits/AuditsWorkspace.tsx", [
  "AuditCentreBackButton",
  "onBackToAuditCentre",
]);

assertContains("src/screens/ResultsScreen.tsx", [
  "AuditCentreBackButton",
  "onBackToAuditCentre",
]);

assertContains("src/components/checks/CheckCompletionWizard.tsx", [
  "AuditCentreBackButton",
  "onBackToAuditCentre",
]);

assertContains("src/screens/AuditTemplateEditScreen.tsx", ["AuditCentreBackButton"]);

assert(appTsx.includes("handleNavigateToAuditCentre"), "App navigates back to Audit Centre");
assert(appTsx.includes('setScreen("auditCentre")'), "App sets auditCentre screen");
assert(appTsx.includes("onBackToAuditCentre={handleNavigateToAuditCentre}"), "child screens wired to Audit Centre back");
assert(appTsx.includes("onBackToAuditCentre={handleBackToAuditCentreFromCheck}"), "check completion saves and returns to Audit Centre");

function assertPrimaryNavIncludesSync(navBlockName) {
  const block = roleNav.match(new RegExp(`const ${navBlockName}[\\s\\S]*?\\];`))?.[0] ?? "";
  assert(block.includes('id: "sync", label: "Sync Centre"'), `${navBlockName} primary nav includes Sync Centre`);
}

assertPrimaryNavIncludesSync("MASTER_NAV");
assertPrimaryNavIncludesSync("COMPANY_ADMIN_NAV");
assertPrimaryNavIncludesSync("MANAGER_NAV");
assertPrimaryNavIncludesSync("AUDITOR_NAV");

assert(roleNav.includes("companyAdmin: []") && roleNav.includes("manager: []") && roleNav.includes("auditor: []"), "sync not duplicated in More bucket");
assert(appTsx.includes('setScreen(item.id)') && appTsx.includes('screen === "sync"'), "sync route opens from sidebar");
assert(appTsx.includes("navLabelForItem") && appTsx.includes("syncCentreBadgeCount"), "sync nav badge when pending/failed");
assert(roleNav.includes('id: "dashboard"') && roleNav.includes('id: "briefings"') && roleNav.includes('id: "reports"'), "existing nav items remain");

assert(read("src/permissions.ts").includes('if (itemId === "archive") return canAccessArchiveNav(role)'), "archive nav permission wired");
assert(roleNav.includes('id: "archive", label: "Archive"'), "archive nav item in role navigation");
assert(appTsx.includes('screen === "archive"'), "archive screen mounted in App");

console.log(`[verify:navigation] ${checks} checks OK`);
