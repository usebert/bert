#!/usr/bin/env node
/**
 * completionService foundation — eligibility, AuditResults writes, folder-filtered reads.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUDIT_RESULTS_TAB_COLUMNS,
  auditResultMatchesCompanyFolder,
  buildAuditResultRow,
  listAuditResults,
  submitCompletedCheck,
  submitCompletedCheckDirect,
  verifyScheduleCompletionEligibility,
} from "../server/completion-service.mjs";
import { isScheduleAssignedToUser } from "../shared/schedule-assignment.mjs";

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

const pkg = JSON.parse(read("package.json"));
const completionService = read("server/completion-service.mjs");
const checkService = read("server/check-service.mjs");
const workbookService = read("server/workbook-service.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");
const godmodeService = read("server/godmode-service.mjs");

assert(pkg.scripts["verify:completion-service-foundation"], "1: npm script registered");
assert(completionService.includes("verifyScheduleCompletionEligibility"), "2: verifyScheduleCompletionEligibility exported");
assert(completionService.includes("submitCompletedCheck"), "3: submitCompletedCheck exported");
assert(completionService.includes("pending_queue_save_start"), "3a: submitCompletedCheck saves pending queue first");
assert(completionService.includes("syncPendingCompletionToWorkbook"), "3b: background sync helper exported");
assert(completionService.includes("listAuditResults"), "4: listAuditResults exported");
assert(completionService.includes("buildAuditResultRow"), "5: buildAuditResultRow exported");
assert(completionService.includes("readTabRecords"), "6: reads AuditResults via workbookService readTabRecords");
assert(completionService.includes("appendTabRows"), "7: writes AuditResults via workbookService appendTabRows");
assert(workbookService.includes("export async function appendTabRows"), "8: workbookService.appendTabRows exported");
assert(checkService.includes('from "./completion-service.mjs"'), "9: checkService delegates to completionService");
assert(coreRoutes.includes("/api/companies/:companyId/checks/:scheduleId/complete"), "10: complete check route wired");
assert(coreRoutes.includes("/api/companies/:companyId/audit-results"), "11: audit-results list route wired");
assert(godmodeService.includes('from "./completion-service.mjs"'), "12: godmode reads via completionService");
assert(!completionService.includes("masterSheetCache"), "13: no masterSheet cache truth");
assert(!completionService.includes("resolveCompanyById"), "14: no registry resolve truth");
assert(!completionService.includes("session-fallback"), "15: no session fallback truth");

const companyFolderId = "folder-company-a";
const otherFolderId = "folder-other";
const masterSheetId = "sheet-123";
const scheduleId = "s-live";

const scheduleRecords = [
  {
    "Schedule ID": scheduleId,
    "Company Folder ID": companyFolderId,
    "Schedule Name": "Live check",
    Status: "Live",
    "Assigned User Emails": "manager@testco.test",
    "Audit ID": "a1",
    "Template Name": "Walk",
    Frequency: "Daily",
  },
  {
    "Schedule ID": "s-other-company",
    "Company Folder ID": otherFolderId,
    "Schedule Name": "Other company",
    Status: "Live",
    "Assigned User Emails": "manager@testco.test",
    "Audit ID": "a3",
    "Template Name": "Walk",
    Frequency: "Daily",
  },
];

const auditResultStore = [];

async function mockReadTabRecords(_auth, _deps, _sheetId, tabName) {
  if (tabName === "Schedules") {
    return { ok: true, records: scheduleRecords, rowCount: scheduleRecords.length };
  }
  if (tabName === "AuditResults") {
    return { ok: true, records: [...auditResultStore], rowCount: auditResultStore.length };
  }
  return { ok: true, records: [], rowCount: 0 };
}

async function mockAppendTabRows(_auth, _deps, _sheetId, tabName, _columns, rows = []) {
  if (tabName === "AuditResults") {
    auditResultStore.push(...rows);
  }
  return { ok: true, written: rows.length };
}

async function mockEnsureTabColumns() {
  return { addedColumns: [], headers: AUDIT_RESULTS_TAB_COLUMNS };
}

const mockDeps = {
  readTabRecords: mockReadTabRecords,
  appendTabRows: mockAppendTabRows,
  ensureTabColumns: mockEnsureTabColumns,
  masterSheetCache: {
    getEntry: (id) => (id === companyFolderId ? { masterSheetId } : null),
  },
  pendingCompletionQueue: {
    enqueuePendingCompletion(input = {}) {
      const resultId = String(input.resultId || input.row?.["Result ID"] || "").trim();
      pendingQueueStore.push(input);
      return { resultId, syncStatus: "pending" };
    },
  },
};

const pendingQueueStore = [];

const row = buildAuditResultRow({
  companyFolderId,
  scheduleId,
  completedByEmail: "manager@testco.test",
  completedByName: "Site Manager",
  answers: { q1: "pass" },
  findings: [{ id: "f1", severity: "low" }],
  evidence: [{ ref: "photo-1" }],
});
assert(row["Company ID"] === companyFolderId, "16: CompanyId set");
assert(row["Company Folder ID"] === companyFolderId, "17: CompanyFolderId set");
assert(row["Company ID"] === row["Company Folder ID"], "18: CompanyId === CompanyFolderId");
assert(row["Schedule ID"] === scheduleId, "19: ScheduleId set");
assert(row["Completed By Email"] === "manager@testco.test", "20: CompletedByEmail set");
assert(row["Completed By Name"] === "Site Manager", "21: CompletedByName set");
assert(row["Answers JSON"] === JSON.stringify({ q1: "pass" }), "22: AnswersJson stringified");
assert(row["Findings JSON"] === JSON.stringify([{ id: "f1", severity: "low" }]), "23: FindingsJson stringified");
assert(row["Evidence Refs"] === JSON.stringify([{ ref: "photo-1" }]), "24: EvidenceRefs stringified");
assert(AUDIT_RESULTS_TAB_COLUMNS.includes("Result ID"), "25: required columns include Result ID");
assert(AUDIT_RESULTS_TAB_COLUMNS.includes("Evidence Refs"), "26: required columns include Evidence Refs");

const eligible = await verifyScheduleCompletionEligibility(
  {},
  mockDeps,
  {
    scheduleId,
    email: "manager@testco.test",
    companyFolderId,
    masterSheetId,
  },
);
assert(eligible.ok, "27: assigned user passes eligibility");
assert(isScheduleAssignedToUser(eligible.schedule, "manager@testco.test"), "28: eligibility uses AssignedUserEmails");

const blockedAssignee = await verifyScheduleCompletionEligibility(
  {},
  mockDeps,
  {
    scheduleId,
    email: "other@testco.test",
    companyFolderId,
    masterSheetId,
  },
);
assert(!blockedAssignee.ok && blockedAssignee.code === "CHECK_NOT_ASSIGNED", "29: non-assigned user blocked");

const blockedCompany = await verifyScheduleCompletionEligibility(
  {},
  mockDeps,
  {
    scheduleId: "s-other-company",
    email: "manager@testco.test",
    companyFolderId,
    masterSheetId,
  },
);
assert(!blockedCompany.ok, "30: wrong-company schedule blocked for selected folder");

const submitted = await submitCompletedCheck(
  {},
  {
    ...mockDeps,
    pendingCompletionQueue: {
      enqueuePendingCompletion(input) {
        return {
          resultId: input.resultId,
          syncStatus: "pending",
        };
      },
    },
  },
  {
    scheduleId,
    email: "manager@testco.test",
    completedByName: "Site Manager",
    companyFolderId,
    masterSheetId,
    answers: { q1: "pass" },
    findings: [],
    evidence: [],
  },
);
assert(submitted.ok, "31: assigned user can complete check with pending queue");
assert(submitted.syncStatus === "pending", "31b: completion returns pending syncStatus");

const directSubmitted = await submitCompletedCheckDirect(
  {},
  mockDeps,
  {
    scheduleId,
    email: "manager@testco.test",
    completedByName: "Site Manager",
    companyFolderId,
    masterSheetId,
    answers: { q1: "pass" },
    findings: [],
    evidence: [],
  },
);
assert(directSubmitted.ok, "31c: direct completion path still works");
assert(auditResultStore.length === 1, "32: one AuditResults row written via direct path");
assert(auditResultStore[0]["Schedule ID"] === scheduleId, "33: written row has ScheduleId");
assert(auditResultStore[0]["Company ID"] === companyFolderId, "34: written row CompanyId correct");

auditResultStore.push({
  "Result ID": "result-other",
  "Company ID": otherFolderId,
  "Company Folder ID": otherFolderId,
  "Schedule ID": "s-other",
  Status: "completed",
});
auditResultStore.push({
  "Result ID": "result-own",
  "Company ID": companyFolderId,
  "Company Folder ID": companyFolderId,
  "Schedule ID": scheduleId,
  Status: "completed",
});

const listed = await listAuditResults(
  {},
  mockDeps,
  { companyFolderId, masterSheetId },
);
assert(listed.ok, "35: listAuditResults succeeds");
assert(listed.results.length === 2, "36: results filtered to own company rows only");
assert(
  listed.results.every((record) => auditResultMatchesCompanyFolder(record, companyFolderId)),
  "37: all listed results match company folder",
);
assert(!listed.results.some((record) => record["Result ID"] === "result-other"), "38: wrong-company result excluded");

console.log(`[verify:completion-service-foundation] OK — ${caseCount} cases passed`);
