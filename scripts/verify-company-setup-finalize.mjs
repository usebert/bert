#!/usr/bin/env node
/**
 * Company onboarding finalize — probeCompanyLoginSheet wiring, retry/repair, customer-safe errors.
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

const companyOnboarding = read("server/company-onboarding.mjs");
const serverMain = read("server/server.mjs");
const inviteRoutes = read("server/invite-routes.mjs");
const inviteMessages = read("src/utils/inviteCompletionMessages.ts");
const formScreen = read("src/screens/CompanyOnboardingFormScreen.tsx");
const godmodePanel = read("src/components/admin/CompanyOnboardingInvitePanel.tsx");
const pkg = JSON.parse(read("package.json"));

const INTERNAL_SETUP_MESSAGE = "Company setup could not finish because of an internal setup error.";

// ─── finalize: probeCompanyLoginSheet must be defined via deps ───────────────

assert(
  serverMain.includes("probeCompanyLoginSheet,") || serverMain.includes("probeCompanyLoginSheet\n"),
  "1: server passes probeCompanyLoginSheet into onboarding deps",
);
assert(
  /probeCompanyLoginSheet,\s*\n\s*repairCompanyInviteTarget/.test(companyOnboarding),
  "2: company-onboarding destructures probeCompanyLoginSheet from deps",
);
assert(
  !companyOnboarding.split("\n").some((line) => line.startsWith("import") && line.includes("probeCompanyLoginSheet")),
  "3: probeCompanyLoginSheet is injected via deps, not imported",
);
assert(
  companyOnboarding.indexOf("probeCompanyLoginSheet,") < companyOnboarding.indexOf("await probeCompanyLoginSheet"),
  "3b: probeCompanyLoginSheet destructured before finalize calls",
);
assert(
  (companyOnboarding.match(/await probeCompanyLoginSheet\(/g) || []).length >= 2,
  "4: finalize path probes Users tab after provisioning",
);
assert(serverMain.includes("async function probeCompanyLoginSheet"), "5: probeCompanyLoginSheet defined once in server.mjs");
assert(serverMain.includes("verifyCompanyUserPassword"), "6: probe uses Users tab password verification");
assert(serverMain.includes("readCompanyUsersTabRecord"), "7: probe reads Users tab records");

// ─── users preserved on retry / partial provision ───────────────────────────

assert(companyOnboarding.includes("readCompanyUsersTabRecord(authed, masterSheetId"), "8: finalize checks existing Users row before write");
assert(companyOnboarding.includes("if (!existingUser)"), "9: finalize preserves existing Users tab rows");
assert(companyOnboarding.includes('app.post("/api/onboarding/company-onboarding/invites/:inviteId/retry"'), "10: godmode retry route exists");
assert(companyOnboarding.includes('app.post("/api/onboarding/company-onboarding/invites/:inviteId/repair"'), "11: godmode repair route exists");
assert(companyOnboarding.includes("runHeadlessInviteProvisioning"), "12: headless retry reuses provisioning pipeline");

// ─── structured errors: customer-safe, godmode keeps diagnostics ────────────

assert(companyOnboarding.includes("COMPANY_ONBOARDING_INTERNAL_SETUP_ERROR_MESSAGE"), "13: internal setup error constant exported");
assert(companyOnboarding.includes("customerProvisionErrorSummary"), "14: customer provision error sanitizer exported");
assert(inviteRoutes.includes("customerProvisionErrorSummary"), "15: invite GET sanitizes provisionError for customers");
assert(inviteMessages.includes(INTERNAL_SETUP_MESSAGE), "16: frontend maps provisioning failures to internal setup copy");
assert(formScreen.includes("mapCompanyOnboardingInviteError"), "17: onboarding form uses customer-safe error mapper");
assert(!formScreen.includes("details.provisionError") && !formScreen.includes("invite.provisionError"), "18: onboarding form never renders raw provisionError");
assert(godmodePanel.includes("invite.provisionError"), "19: godmode panel may show technical provisionError");
assert(godmodePanel.includes("provisionStage"), "20: godmode panel shows failed step (e.g. finalize)");
assert(companyOnboarding.includes('code: "PROVISIONING_FAILED"'), "21: finalize failure returns structured PROVISIONING_FAILED code");
assert(companyOnboarding.includes("provisionStage:"), "22: failure records provisionStage for godmode");

// ─── imports / no ReferenceError at finalize ────────────────────────────────

const installBlock = companyOnboarding.slice(
  companyOnboarding.indexOf("export function installCompanyOnboardingRoutes"),
  companyOnboarding.indexOf("async function sendInviteEmail"),
);
assert(installBlock.includes("probeCompanyLoginSheet"), "23: installCompanyOnboardingRoutes binds probeCompanyLoginSheet");
assert(
  companyOnboarding.includes('app.post("/api/onboarding/company/:tokenParam/complete"'),
  "24: customer finalize endpoint registered",
);
assert(
  companyOnboarding.includes("provisionStage: companyFolderId && masterSheetId ? \"finalize\""),
  "25: internal errors at finalize stage tagged as finalize",
);

assert(pkg.scripts["verify:company-setup-finalize"], "26: npm script registered");

console.log(`[verify:company-setup-finalize] OK — ${caseCount} cases passed`);
