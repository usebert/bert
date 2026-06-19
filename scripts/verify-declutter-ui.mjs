#!/usr/bin/env node
/**
 * UX declutter — company Admin/Manager/Auditor/User surfaces hide sync, repair, registry, raw IDs.
 * Godmode keeps Advanced diagnostics collapsed by default.
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

const uxDeclutter = read("src/utils/uxDeclutter.ts");
const roleNav = read("src/config/roleNavigation.ts");
const permissions = read("src/permissions.ts");
const godmodePanel = read("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx");
const schedulesScreen = read("src/screens/SchedulesScreen.tsx");
const usersPanel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
const jobsPanel = read("src/components/godmode/GodmodeBackgroundJobsPanel.tsx");
const appTsx = read("App.tsx");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:declutter-ui"], "PKG: npm script registered");
assert(uxDeclutter.includes("canShowTechnicalUi") && uxDeclutter.includes('role === "Master"'), "technical UI Master-only");
assert(roleNav.includes("companyAdmin: []") && roleNav.includes("manager: []") && roleNav.includes("auditor: []"), "no More-menu clutter for company roles");
assert(!roleNav.match(/COMPANY_ADMIN_NAV[\s\S]*?id: "admin"/), "company admin nav has no workspace tab");
assert(!roleNav.match(/AUDITOR_NAV[\s\S]*?id: "sync"/), "auditor nav has no sync tab");
assert(!permissions.match(/canViewSyncCentre[\s\S]*?Auditor.*true/) || permissions.includes('role === "Master"'), "sync centre not default for auditors via nav");
assert(godmodePanel.includes("Advanced diagnostics") && godmodePanel.includes("useState(false)"), "godmode diagnostics collapsed by default");
assert(schedulesScreen.includes("showAssigneeDiagnostics"), "schedule diagnostics gated by prop");
assert(appTsx.includes("showAssigneeDiagnostics={canShowTechnicalUi(currentUser.role)}"), "App gates schedule diagnostics to Master");
assert(usersPanel.includes("canShowTechnicalUi"), "users panel gates re-sync to Master");
assert(!usersPanel.includes("GodmodeBackgroundJobsPanel"), "background jobs panel not on users screen");
assert(jobsPanel.includes("canShowTechnicalUi"), "background jobs panel respects technical UI gate");
assert(uxDeclutter.includes("softenUserFacingMessage"), "company-facing messages softened");
assert(!appTsx.includes("could not reach BERT"), "no legacy BERT reach error string");

console.log(`[verify:declutter-ui] OK — ${caseCount} cases passed`);
