#!/usr/bin/env node
/** Complete Check — assigned-check open + POST complete to AuditResults (folder-first). */
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

const appTsx = read("App.tsx");
const checkService = read("src/services/checkService.ts");
const coreRoutes = read("server/core-workflow-routes.mjs");
const completionService = read("server/completion-service.mjs");
const review = read("src/components/checks/CheckCompletionReview.tsx");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:complete-check-wiring"], "PKG: npm script registered");

/** 1: Canonical completion route on client + server. */
assert(checkService.includes("completeCheck"), "1: client completeCheck exported");
assert(
  checkService.includes("/api/companies/") && checkService.includes("/checks/") && checkService.includes("/complete"),
  "1b: client uses folder-first complete route",
);
assert(!checkService.includes("/api/google-sheet-by-id/"), "1c: client does not use legacy sheet sync for completion");
assert(coreRoutes.includes('app.post("/api/companies/:companyId/checks/:scheduleId/complete"'), "1d: server route registered");
assert(completionService.includes("verifyScheduleCompletionEligibility"), "1e: server verifies assignee eligibility");
assert(appTsx.includes("usesAssignedChecksCompletionFlow"), "1f: completion wizard for all assigned-check roles");
assert(!/canCompleteAuditAsAuditor\(currentUser\.role\)[\s\S]{0,400}CheckCompletionWizard/.test(appTsx), "1g: wizard not auditor-only");
assert(read("server/bert-cors.mjs").includes("PUT"), "1h: CORS allows PUT preflight for template sync");

/** 2: Open check from assigned-checks API only — no localStorage schedule truth. */
assert(appTsx.includes("assignedCheckByAuditId"), "2: App maps auditId to assigned schedule from API");
assert(appTsx.includes("activeAssignedCheck"), "2b: App tracks active assigned check context");
assert(appTsx.includes("fetchAssignedChecks"), "2c: assigned checks loaded from session API");
assert(!appTsx.includes("localStorage.getItem(storageKeys.companyName)"), "2d: no localStorage companyName read in App");
assert(
  /startAudit[\s\S]{0,1800}assignedCheckByAuditId/.test(appTsx),
  "2e: startAudit validates assigned-check mapping",
);
assert(
  /const activeAudit = useMemo\([\s\S]{0,900}assignedAudits\.find/.test(appTsx),
  "2e1: activeAudit resolves API assigned-check audits for wizard",
);
assert(
  /renderManagerDashboard=\{\(\)\s*=>\s*\(\s*<ManagerRoleDashboard[\s\S]*?onOpenAudit=\{startAudit\}/.test(appTsx),
  "2e2: dashboard Things to do uses same startAudit handler as Complete Work",
);
assert(
  read("src/components/dashboard/DashboardThingsToDoSection.tsx").includes("AssignedCheckActionRow"),
  "2e3: dashboard Things to do reuses AssignedCheckActionRow",
);
assert(
  appTsx.includes("completeCheck") && appTsx.includes("completeAuditModeFlow"),
  "2f: submit flow calls completeCheck",
);
assert(
  /completeAuditModeFlow[\s\S]{0,2500}assignedContext/.test(appTsx),
  "2g: submit uses assigned schedule context not localStorage ids",
);

/** 3: Friendly loading, success, error, timeout states. */
assert(checkService.includes("CHECK_COMPLETION_TIMEOUT_MS"), "3: completion timeout constant");
assert(
  !checkService.includes("CHECK_COMPLETION_TIMEOUT_MESSAGE") ||
    !/Master Sheet/i.test(
      checkService.match(/CHECK_COMPLETION_TIMEOUT_MESSAGE\s*=\s*\n?\s*"([^"]+)"/)?.[1] || "",
    ),
  "3a: completion timeout message must not mention Master Sheet",
);
assert(checkService.includes("CHECK_COMPLETION_NOT_ASSIGNED_MESSAGE"), "3b: not-assigned user message");
assert(!checkService.includes('masterSheetId: String(input.companyContext.masterSheetId'), "3b1: completeCheck does not send client masterSheetId");
assert(review.includes("Submitting…"), "3c: review UI shows submitting state");
assert(review.includes("submitError"), "3d: review UI shows submit error");
assert(appTsx.includes("checkSubmitState"), "3e: App tracks check submit state");
assert(appTsx.includes("setAuditCompletionSummary"), "3f: success summary after completion");
assert(checkService.includes('CHECK_COMPLETION_SUCCESS_MESSAGE = "Check submitted successfully."'), "3f1: canonical success message constant");
assert(appTsx.includes("CHECK_COMPLETION_SUCCESS_MESSAGE"), "3f2: App uses canonical success message");
assert(appTsx.includes("Back to Things to do"), "3f3: success panel back button label");
assert(
  /screen === "complete"[\s\S]{0,200}usesAssignedChecksCompletionFlow\(currentUser\.role\)[\s\S]{0,200}auditCompletionSummary &&/.test(
    appTsx,
  ),
  "3g: success summary renders without active audit",
);
assert(
  /screen === "complete"[\s\S]{0,200}!activeAudit[\s\S]{0,400}usesAssignedChecksCompletionFlow\(currentUser\.role\)/.test(
    appTsx,
  ),
  "3g1: complete screen guard keeps success summary for assigned-check roles",
);
assert(
  !/finishCompletionSummary[\s\S]{0,1200}setAuditCompletionSummary\(null\)/.test(appTsx),
  "3g2: finishCompletionSummary does not clear completion summary",
);
assert(
  !/Master Sheet/i.test(
    checkService.match(/CHECK_COMPLETION_TIMEOUT_MESSAGE\s*=\s*\n?\s*"([^"]+)"/)?.[1] || "",
  ),
  "3h: completion timeout does not mention Master Sheet",
);

/** 4: Session-scoped company folder on submit body (no authoritative client query params). */
assert(!checkService.includes('params.set("companyFolderId"'), "4: client does not send company query params for complete");
assert(!checkService.includes("PasswordHash"), "4b: no PasswordHash in check client");
assert(
  !/completeCheck[\s\S]{0,900}masterSheetId/.test(checkService),
  "4c: completeCheck does not send client masterSheetId",
);
assert(
  /respondJson\(504[\s\S]{0,400}CHECK_COMPLETION_TIMEOUT/.test(coreRoutes),
  "4d: route timeout returns CHECK_COMPLETION_TIMEOUT",
);
assert(
  completionService.indexOf("write_audit_results_end") < completionService.indexOf("audit_evidence_upload_start"),
  "4e: audit result written before deferred evidence upload",
);
assert(checkService.includes("isCheckCompletionTimeoutError"), "4f: client timeout abort helper");
assert(
  Number(checkService.match(/CHECK_COMPLETION_TIMEOUT_MS = ([\d_]+)/)?.[1]?.replace(/_/g, "") || 0) >= 120_000,
  "4g: client timeout allows server route budget",
);

const ncrService = read("server/ncr-service.mjs");
assert(
  completionService.includes("resolvedContext: eligibility.resolvedContext"),
  "4h: complete-check passes server-resolved context into NCR creation",
);
assert(ncrService.includes("isValidNcrResolvedContext"), "4i: NCR writer validates resolvedContext before reuse");
assert(ncrService.includes("resolveNcrWriteContext"), "4j: NCR writer coalesces resolvedContext vs resolve fallback");
assert(
  /appendNcrsFromCheckCompletion[\s\S]{0,1200}resolveNcrWriteContext/.test(ncrService),
  "4k: appendNcrsFromCheckCompletion uses resolveNcrWriteContext",
);
assert(
  /resolveNcrWriteContext[\s\S]{0,600}resolveCompanyScheduleContext/.test(ncrService),
  "4l: NCR writer falls back to resolveCompanyScheduleContext when resolvedContext absent",
);
assert(
  completionService.includes("trustSessionContext: input.trustSessionContext === true"),
  "4m: completion eligibility forwards session-trusted context flag",
);
assert(
  coreRoutes.includes("trustSessionContext") && coreRoutes.includes("sessionMasterSheetId"),
  "4n: complete-check route derives session-trusted workbook context",
);
assert(
  read("server/schedule-service.mjs").includes("tryResolveTrustedCompanyScheduleContext"),
  "4o: schedule service exposes trusted workbook context fast path",
);

console.log(`[verify:complete-check-wiring] OK — ${caseCount} cases passed`);
