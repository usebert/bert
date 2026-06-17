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
  appTsx.includes("completeCheck") && appTsx.includes("completeAuditModeFlow"),
  "2f: submit flow calls completeCheck",
);
assert(
  /completeAuditModeFlow[\s\S]{0,2500}assignedContext/.test(appTsx),
  "2g: submit uses assigned schedule context not localStorage ids",
);

/** 3: Friendly loading, success, error, timeout states. */
assert(checkService.includes("CHECK_COMPLETION_TIMEOUT_MS"), "3: completion timeout constant");
assert(checkService.includes("CHECK_COMPLETION_NOT_ASSIGNED_MESSAGE"), "3b: not-assigned user message");
assert(review.includes("Submitting…"), "3c: review UI shows submitting state");
assert(review.includes("submitError"), "3d: review UI shows submit error");
assert(appTsx.includes("checkSubmitState"), "3e: App tracks check submit state");
assert(appTsx.includes("setAuditCompletionSummary"), "3f: success summary after completion");

/** 4: Session-scoped company folder on submit body (no authoritative client query params). */
assert(!checkService.includes('params.set("companyFolderId"'), "4: client does not send company query params for complete");
assert(!checkService.includes("PasswordHash"), "4b: no PasswordHash in check client");

console.log(`[verify:complete-check-wiring] OK — ${caseCount} cases passed`);
