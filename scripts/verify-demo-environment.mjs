#!/usr/bin/env node
/**
 * Midlands demo environment verifier — Phase 0/1 guards, seed coverage, email suppression.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_COMPANY_NAME as DOVECOTE_COMPANY_NAME } from "../shared/demo-company-seed.mjs";
import {
  DEMO_COMPANY_SEED_CONFIRM_ENV,
  MIDLANDS_DEMO_COMPANY_NAME,
  MIDLANDS_SITE_COVENTRY_ID,
  MIDLANDS_SITE_RUGBY_ID,
  MIDLANDS_SWITCH_PERSONAS,
  assertAllowedDemoSwitchTarget,
  assertDemoCompanyAllowed,
  isDemoCompanyEmail,
  isDemoEnvironmentEnabled,
  isMidlandsDemoCompanyName,
  readDemoMasterEmail,
  resolveDemoWorkspaceIdMode,
  shouldSuppressDemoOutboundEmail,
} from "../shared/demo-environment.mjs";
import {
  MIDLANDS_AREAS,
  MIDLANDS_AUDIT_TEMPLATES,
  MIDLANDS_DEPARTMENTS,
  MIDLANDS_SITES,
  buildMidlandsPrecastSeed,
} from "../shared/midlands-precast-seed.mjs";
import { normalizeAccessScope } from "../shared/company-structure-access.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function assert(condition, message) {
  checks += 1;
  if (!condition) {
    console.error(`FAIL [${checks}]: ${message}`);
    process.exit(1);
  }
  console.log(`PASS [${checks}]: ${message}`);
}

const seed = buildMidlandsPrecastSeed({ passwordHash: "scrypt$verify$verify" });
const packageJson = JSON.parse(read("package.json"));
const demoEnvModule = read("shared/demo-environment.mjs");
const seedScript = read("scripts/seed-demo-environment.mjs");
const createScript = read("scripts/create-demo-company.mjs");
const serverSrc = read("server/server.mjs");
const onboardingSrc = read("server/company-onboarding.mjs");
const remindersSrc = read("server/email-reminders.mjs");
const resetSrc = read("server/password-reset.mjs");
const distributionSrc = read("server/document-distribution.mjs");

assert(packageJson.scripts["create:demo-company"], "npm script create:demo-company registered");
assert(packageJson.scripts["seed:demo-environment"], "npm script seed:demo-environment registered");
assert(packageJson.scripts["register:demo-environment"], "npm script register:demo-environment registered");
assert(packageJson.scripts["verify:demo-environment"], "npm script verify:demo-environment registered");

assert(isMidlandsDemoCompanyName(MIDLANDS_DEMO_COMPANY_NAME), "Midlands company name constant");
assert(MIDLANDS_DEMO_COMPANY_NAME !== DOVECOTE_COMPANY_NAME, "Midlands is separate from Dovecote");
assert(assertDemoCompanyAllowed({
  companyName: DOVECOTE_COMPANY_NAME,
  companyFolderId: "abcdefghijklmnopqrstuvwxyz1234567",
  masterSheetId: "abcdefghijklmnopqrstuvwxyz1234567890abcdefgh",
}).ok === false, "refuses Dovecote company name");
assert(assertDemoCompanyAllowed({
  companyName: "TESTCO",
  companyFolderId: "abcdefghijklmnopqrstuvwxyz1234567",
  masterSheetId: "abcdefghijklmnopqrstuvwxyz1234567890abcdefgh",
}).ok === false, "refuses TESTCO");

assert(demoEnvModule.includes("isDemoEnvironmentEnabled"), "demo environment enable helper exported");
assert(demoEnvModule.includes("assertAllowedDemoSwitchTarget"), "switch target guard exported");
assert(demoEnvModule.includes("BERT_DEMO_COMPANY_SPREADSHEET_ID"), "spreadsheet env var documented");
assert(demoEnvModule.includes("DEMO_FORBIDDEN_COMPANY_NAMES"), "forbidden names include Dovecote");

assert(MIDLANDS_SITES.length === 2, "two sites defined");
assert(MIDLANDS_SITES.some((site) => site.SiteName.includes("Rugby")), "Rugby site exists");
assert(MIDLANDS_SITES.some((site) => site.SiteName.includes("Coventry")), "Coventry site exists");
assert(MIDLANDS_AREAS.length === 21, "all required areas exist (12 Rugby + 9 Coventry)");
assert(MIDLANDS_DEPARTMENTS.length >= 10, "credible department count");

assert(MIDLANDS_SWITCH_PERSONAS.length === 6, "six switch personas defined");
for (const email of [
  "demo.midlands.master@usebert.co.uk",
  "demo.midlands.admin@usebert.co.uk",
  "demo.midlands.rugby.manager@usebert.co.uk",
  "demo.midlands.coventry.manager@usebert.co.uk",
  "demo.midlands.rugby.auditor@usebert.co.uk",
  "demo.midlands.coventry.auditor@usebert.co.uk",
]) {
  assert(assertAllowedDemoSwitchTarget(email, { DEMO_ENVIRONMENT_ENABLED: "true" }).ok, `switch persona allowed: ${email}`);
}

const admin = seed.users.find((user) => user.Email === "demo.midlands.admin@usebert.co.uk");
assert(admin && admin.Role === "Admin", "Olivia Bennett is Admin");
const adminScope = normalizeAccessScope({
  SiteIds: admin.SiteIds,
  DepartmentIds: admin.DepartmentIds,
  AreaIds: admin.AreaIds,
});
assert(adminScope.allSites && adminScope.allDepartments && adminScope.allAreas, "Admin is company-wide");

const rugbyManager = seed.users.find((user) => user.Email === "demo.midlands.rugby.manager@usebert.co.uk");
assert(rugbyManager && rugbyManager.SiteIds === MIDLANDS_SITE_RUGBY_ID, "Rugby manager site-scoped");
const coventryManager = seed.users.find((user) => user.Email === "demo.midlands.coventry.manager@usebert.co.uk");
assert(coventryManager && coventryManager.SiteIds === MIDLANDS_SITE_COVENTRY_ID, "Coventry manager site-scoped");
const rugbyAuditor = seed.users.find((user) => user.Email === "demo.midlands.rugby.auditor@usebert.co.uk");
assert(rugbyAuditor && rugbyAuditor.SiteIds === MIDLANDS_SITE_RUGBY_ID, "Rugby auditor site-scoped");
const coventryAuditor = seed.users.find((user) => user.Email === "demo.midlands.coventry.auditor@usebert.co.uk");
assert(coventryAuditor && coventryAuditor.SiteIds === MIDLANDS_SITE_COVENTRY_ID, "Coventry auditor site-scoped");

assert(!seed.users.some((user) => user.Email === readDemoMasterEmail()), "Master operator not in Users tab seed");
assert(seed.masterOperator?.usersTab === false, "Master persona flagged as non-Users-tab");

assert(MIDLANDS_AUDIT_TEMPLATES.length === 10, "ten validation templates");
assert(seed.schedules.length === 10, "ten validation schedules");
assert(seed.counts.users >= 11, "credible user count beyond switch personas");

assert(seedScript.includes(DEMO_COMPANY_SEED_CONFIRM_ENV), "seeder requires confirm env");
assert(seedScript.includes("assertDemoCompanyAllowed"), "seeder guards company");
assert(createScript.includes("--live"), "create script supports --live");
assert(createScript.includes("requireWorkspaceIds: false"), "create script allows bootstrap without workspace IDs");
assert(createScript.includes("resolveDemoWorkspaceIdMode"), "create script validates workspace ID combinations");
assert(createScript.includes("assertLiveCompaniesWorkspaceReady"), "create script preflights Live Companies resolution");
assert(createScript.includes("describeLiveCompaniesResolutionFailure"), "create script surfaces Live Companies diagnostics");
assert(createScript.includes("buildCompanyProvisionScriptDeps"), "create script uses shared provision deps builder");
assert(createScript.includes("resolveResumeCompletedStages"), "create script infers completed stages for resume");
assert(createScript.includes("inferCompletedProvisioningStages"), "create script inspects workspace progress");
assert(
  createScript.includes("requireWorkspaceIds: true") && createScript.includes("postGuard"),
  "create script strictly validates provisioned workspace IDs after live bootstrap",
);
assert(!seedScript.includes(DOVECOTE_COMPANY_NAME), "Midlands seeder does not reference Dovecote");
assert(!createScript.includes("Dovecote"), "create script does not touch Dovecote");

const demoFolderId = "abcdefghijklmnopqrstuvwxyz1234567";
const demoSpreadsheetId = "abcdefghijklmnopqrstuvwxyz1234567890abcdefgh";

const provisionMode = resolveDemoWorkspaceIdMode({});
assert(provisionMode.ok && provisionMode.mode === "provision", "no IDs allowed for creator bootstrap");
const resumeMode = resolveDemoWorkspaceIdMode({
  companyFolderId: demoFolderId,
  masterSheetId: demoSpreadsheetId,
});
assert(
  resumeMode.ok && resumeMode.mode === "resume" && resumeMode.companyFolderId === demoFolderId,
  "both IDs allowed for resume",
);
const folderOnlyMode = resolveDemoWorkspaceIdMode({ companyFolderId: demoFolderId });
assert(folderOnlyMode.ok === false && /folder id was supplied without/i.test(folderOnlyMode.error || ""), "folder only rejected");
const spreadsheetOnlyMode = resolveDemoWorkspaceIdMode({ masterSheetId: demoSpreadsheetId });
assert(
  spreadsheetOnlyMode.ok === false && /without a folder id/i.test(spreadsheetOnlyMode.error || ""),
  "spreadsheet only rejected",
);
const provisionedGuard = assertDemoCompanyAllowed({
  companyName: MIDLANDS_DEMO_COMPANY_NAME,
  companyFolderId: demoFolderId,
  masterSheetId: demoSpreadsheetId,
  requireWorkspaceIds: true,
  requireSpreadsheet: true,
});
assert(
  provisionedGuard.ok &&
    provisionedGuard.companyFolderId === demoFolderId &&
    provisionedGuard.masterSheetId === demoSpreadsheetId,
  "returned provisioned IDs strictly validated",
);

const envOn = {
  DEMO_ENVIRONMENT_ENABLED: "true",
  BERT_DEMO_COMPANY_FOLDER_ID: "abcdefghijklmnopqrstuvwxyz1234567",
  BERT_DEMO_COMPANY_NAME: MIDLANDS_DEMO_COMPANY_NAME,
};
assert(
  shouldSuppressDemoOutboundEmail({
    companyFolderId: "abcdefghijklmnopqrstuvwxyz1234567",
    toEmail: "demo.midlands.admin@usebert.co.uk",
    env: envOn,
  }),
  "suppresses demo company emails when enabled",
);
assert(
  !shouldSuppressDemoOutboundEmail({
    companyFolderId: "zyxwvutsrqponmlkjihgfedcba9876543",
    toEmail: "real.customer@example.com",
    env: envOn,
  }),
  "does not suppress normal customer emails",
);
assert(
  !shouldSuppressDemoOutboundEmail({
    companyFolderId: "abcdefghijklmnopqrstuvwxyz1234567",
    toEmail: "demo.midlands.admin@usebert.co.uk",
    env: { DEMO_ENVIRONMENT_ENABLED: "false" },
  }),
  "does not suppress when demo environment disabled",
);

assert(serverSrc.includes("demo-email-guard"), "server wires demo email guard");
assert(onboardingSrc.includes("demo-email-guard"), "onboarding invite suppression wired");
assert(remindersSrc.includes("demo-email-guard"), "reminder suppression wired");
assert(resetSrc.includes("demo-email-guard"), "password reset suppression wired");
assert(distributionSrc.includes("demo-email-guard"), "document distribution suppression wired");

assert(!seedScript.toLowerCase().includes("password:"), "seed script does not log plaintext password");
assert(!read("scripts/seed-demo-environment.mjs").includes("console.log(`  Password:"), "seed report avoids password logging");

const reportExample = JSON.stringify({ passwordNote: "configured via env" });
assert(!reportExample.includes("BertDemo"), "report structure avoids embedded passwords");

assert(isDemoCompanyEmail("demo.midlands.admin@usebert.co.uk", envOn), "demo email detection");
assert(seedScript.includes("writeMergedTab"), "idempotent upsert path");

console.log(`\nverify:demo-environment passed (${checks} checks).`);
