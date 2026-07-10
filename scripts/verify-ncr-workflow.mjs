#!/usr/bin/env node
/**
 * NCR workflow verifier — audit non-conformance creation, workbook writes, list + dashboard reads.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildNcrWorkbookRow,
  isNcrFindingAnswer,
  mapNcrWorkbookRowToClient,
  ncrWorkbookRowIsOpen,
  NCR_TAB,
  NCR_TAB_COLUMNS,
} from "../shared/ncr.mjs";
import { buildLiveDashboardFromSources } from "../shared/live-dashboard.mjs";
import { isWorkbookRowArchived } from "../shared/archive.mjs";

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
}

const CO = "folder-ncr-test";
const adminActor = { kind: "company", role: "Admin", email: "admin@test.co", companyId: CO };

assert(read("shared/ncr.mjs").includes("NCR_TAB_COLUMNS"), "1: shared NCR columns defined");
assert(NCR_TAB === "NCRs", "1b: NCR tab name");
assert(NCR_TAB_COLUMNS.includes("NCR ID") && NCR_TAB_COLUMNS.includes("Archived"), "1c: required NCR headers");

const ncrService = read("server/ncr-service.mjs");
assert(ncrService.includes("appendNcrsFromCheckCompletion"), "2: server appends NCRs on check completion");
assert(ncrService.includes("NCR_WRITE_FAILED"), "2b: safe NCR write error code");
assert(ncrService.includes("NCR_DUPLICATE_SKIPPED"), "2c: duplicate NCR protection code");
assert(ncrService.includes("local::"), "2d: NCR dedupe includes local submission id");

const completion = read("server/completion-service.mjs");
assert(completion.includes("appendNcrsFromCheckCompletion"), "3: completion service writes NCR rows");
assert(completion.includes("findings: input.findings"), "3b: findings passed to NCR writer");
assert(completion.includes('buildAuditResultRow'), "3c: audit result row written on check completion");
assert(
  completion.indexOf("write_audit_results_end") < completion.indexOf("audit_evidence_upload_start"),
  "3d: evidence upload deferred until after audit result write",
);
assert(completion.includes("CHECK_COMPLETION_ROUTE_TIMEOUT_MS = 120_000"), "3e: route timeout budget increased");
assert(completion.includes("ncrWriteWarningFromResult"), "3f: NCR failure returns partial success after audit write");

const routes = read("server/core-workflow-routes.mjs");
assert(routes.includes('app.post("/api/companies/:companyFolderId/ncrs"'), "4: folder-first NCR save route");

const appTsx = read("App.tsx");
const checkService = read("src/services/checkService.ts");
const clientNcrService = read("src/services/ncrService.ts");
const nonConformanceScreen = read("src/screens/NonConformanceScreen.tsx");
const managerDashboard = read("src/components/dashboard/ManagerRoleDashboard.tsx");

assert(appTsx.includes("createNonConformancesFromAudit"), "5: client creates NCRs from audit submit");
assert(appTsx.includes("parseCompanySheetNcrs"), "6: client loads NCRs from workbook");
assert(appTsx.includes("mergeSheetNcrsIntoState"), "6b: sheet NCR merge helper wired");
assert(
  appTsx.includes("loadCompanySheetById") && appTsx.includes("mergeSheetNcrsIntoState(current, payload.data.NCRs"),
  "6c: load by sheet id merges NCR tab",
);
assert(
  appTsx.includes('screen !== "nonConformance"') && appTsx.includes("loadCompanySheetById(masterSheetId, companyFolderId"),
  "6d: NCR screen refresh loads workbook NCRs",
);
assert(
  appTsx.includes("assignedChecksState.hasLoadedOnce") && appTsx.includes("loadCompanySheetById(masterSheetId, companyFolderId"),
  "6e: assigned checks hydration loads workbook NCRs",
);
assert(!appTsx.includes("issue${issuesFound === 1 ? \"\" : \"s\"} flagged"), "6f: misleading issue-flagged toast removed");

assert(checkService.includes('CHECK_COMPLETION_NCR_RECORDED_MESSAGE = "Non-conformance recorded."'), "7: success screen NCR recorded message");
assert(checkService.includes("CHECK_COMPLETION_NCR_WRITE_FAILED_MESSAGE"), "7b: partial-success warning when NCR write fails");
assert(appTsx.includes("CHECK_COMPLETION_NCR_RECORDED_MESSAGE"), "7c: completion summary shows NCR recorded");
assert(appTsx.includes("CHECK_COMPLETION_NCR_WRITE_FAILED_MESSAGE"), "7d: completion summary shows NCR write failure");
assert(appTsx.includes("ncrsRecorded"), "7e: completion summary tracks NCR count");
assert(appTsx.includes("ncrWriteFailed"), "7f: completion summary tracks NCR write failure");
assert(appTsx.includes("resolveNcrCompletionOutcome"), "7g: NCR outcome resolver used on submit");
assert(appTsx.includes("checkCompletionLocalIdRef"), "7i: stable local submission id for retry dedupe");
assert(appTsx.includes("isCheckCompletionTimeoutError"), "7j: timeout abort mapped to sync-centre message");
assert(checkService.includes("Check submission is taking longer than expected"), "7k: slow submit user message");

const server = read("server/server.mjs");
assert(server.includes('"NCRs"'), "8: NCRs tab in company sheet read list");

const row = buildNcrWorkbookRow({
  reference: "NCR-0001",
  companyFolderId: CO,
  auditId: "audit-1",
  auditName: "Daily walk",
  questionId: "q1",
  questionText: "Fire exit clear?",
  answer: "nc",
  note: "Blocked",
  site: "Yard",
  auditorName: "Alex",
  auditorUserId: "alex@test.co",
  status: "Open",
});
assert(row["NCR ID"] === "NCR-0001" && row.Archived === "false", "9: NCR row defaults active");
assert(row.Status === "Open", "9b: NCR row status Open by default");
assert(isNcrFindingAnswer("nc") && isNcrFindingAnswer("fail"), "10: finding answer detection");

{
  const openBlankArchived = { "NCR ID": "n1", "Company ID": CO, Status: "Open" };
  const archived = { "NCR ID": "n2", "Company ID": CO, Status: "Open", Archived: "true" };
  const statusArchived = { "NCR ID": "n3", "Company ID": CO, Status: "Archived" };
  const built = buildLiveDashboardFromSources(
    {
      ncrs: [openBlankArchived, archived, statusArchived],
      actions: [],
      schedules: [],
      auditResults: [],
      incidents: [],
      briefings: [],
      briefingRecipients: [],
      areas: [],
      sites: [],
    },
    { companyFolderId: CO, actor: adminActor, now: new Date("2026-07-09T10:00:00.000Z") },
  );
  assert(built.metrics.openNcrs === 1, "11: blank Archived keeps NCR open in dashboard");
  assert(isWorkbookRowArchived(archived, "ncr"), "12: archived NCR hidden");
  assert(isWorkbookRowArchived(statusArchived, "ncr"), "12b: status Archived hides NCR");
  assert(ncrWorkbookRowIsOpen(openBlankArchived), "13: Open status treated as open");
}

assert(nonConformanceScreen.includes("No NCRs recorded"), "14: NCR screen empty state");
assert(managerDashboard.includes("Open NCRs"), "15: manager dashboard shows open NCRs");
assert(clientNcrService.includes("NCR_SAFE_ERROR_CODES"), "16: safe client NCR error messages");
assert(clientNcrService.includes("resolveNcrCompletionOutcome"), "16b: client NCR outcome resolver");
assert(clientNcrService.includes('status === "archived"'), "16c: client parser hides status Archived only");
assert(clientNcrService.includes("NCR_DUPLICATE_SKIPPED"), "16d: duplicate skip safe message");

assert(appTsx.includes("skipWorkbookPersist: true"), "17: online submit avoids duplicate client workbook writes");
assert(appTsx.includes("serverNcrs: result.ncrs"), "18: offline sync merges server NCRs");
assert(ncrService.includes("findingKey"), "19: server dedupes by audit/question/result");

assert(clientNcrService.includes("mergeCompletionNcrsIntoState"), "21: immediate post-submit NCR merge helper");
assert(clientNcrService.includes("buildNonConformanceFromCompletionContext"), "21b: completion NCR record builder");
assert(clientNcrService.includes("summarizeNcrVisibilityPipeline"), "21c: safe NCR visibility diagnostics");
assert(appTsx.includes("mergeCompletionNcrsIntoState"), "21d: App merges completion NCRs into state");
assert(appTsx.includes("user.companyAreas.length === 0) return null"), "21e: blank companyAreas means all-site access");
assert(appTsx.includes("if (!site) return true"), "21f: blank NCR site stays visible for scoped managers");
assert(nonConformanceScreen.includes("auditorIdentityTokens"), "21g: auditor NCR list matches email or username");
assert(routes.includes("ncrs: result.ncrs || []"), "21h: completion route returns ncrs array");
assert(NCR_TAB_COLUMNS.includes("Evidence Refs"), "21i: NCR tab has Evidence Refs column");
assert(NCR_TAB_COLUMNS.includes("Evidence Count"), "21j: NCR tab has Evidence Count column");
assert(ncrService.includes("linkEvidenceRefsToNcrs"), "21k: server backfills NCR evidence after upload");
assert(completion.includes("linkEvidenceRefsToNcrs"), "21l: completion links evidence to NCRs after Drive upload");
assert(completion.includes("evidenceRefs,"), "21m: completion passes evidence refs into NCR writer");
assert(routes.includes("evidenceRefs: result.evidenceRefs"), "21n: completion response returns evidenceRefs");
assert(clientNcrService.includes("attachEvidenceRefsToNcrs"), "21o: client attaches evidence refs to NCRs");
assert(clientNcrService.includes("auditEvidenceToNcrEvidence"), "21p: client maps audit evidence to NCR evidence");
assert(clientNcrService.includes("resolveNcrEvidenceFromAuditResult"), "21q: NCR evidence fallback from audit result");
assert(appTsx.includes("evidenceMap: evidence"), "21r: online submit passes evidence map into NCR create");
assert(appTsx.includes("evidenceRefs: result.evidenceRefs"), "21s: online submit merges returned evidence refs");
assert(nonConformanceScreen.includes("NCR_EVIDENCE_PENDING_MESSAGE"), "21t: NCR detail shows pending evidence state");
assert(nonConformanceScreen.includes("Open evidence"), "21u: NCR detail links uploaded evidence");
assert(clientNcrService.includes("collectNcrEvidenceFromSources"), "21w: collect NCR evidence with check-level fallback");
assert(clientNcrService.includes("fallbackToAll"), "21x: evidence filter supports check-level fallback");
assert(appTsx.includes("collectNcrEvidenceFromSources"), "21y: App uses shared NCR evidence collector");
assert(nonConformanceScreen.includes("NCR_EVIDENCE_PENDING_MESSAGE"), "21z: pending evidence visible in NCR detail");

{
  const pendingOnly = buildNcrWorkbookRow({
    reference: "NCR-0300",
    companyFolderId: CO,
    auditId: "dc-hs-audit",
    auditName: "DC H&S Audit",
    questionId: "q-fail",
    questionText: "Fire exit clear?",
    answer: "fail",
    note: "pooppoo",
    resultId: "result-pending-1",
    evidenceRefs: [
      {
        evidenceId: "ev-pending-1",
        questionId: "q-other",
        name: "photo-1.jpg",
      },
    ],
  });
  assert(pendingOnly["Evidence Count"] === "1", "29: check-level evidence fallback attaches photo to NCR");
  assert(pendingOnly["Evidence Refs"].includes("ev-pending-1"), "29b: pending evidence metadata stored on NCR row");
  assert(pendingOnly["Evidence Refs"].startsWith("'"), "29c: Evidence Refs JSON protected from Sheets mangling");
  const mappedPending = mapNcrWorkbookRowToClient(pendingOnly, CO);
  assert(mappedPending.evidence.length === 1, "29d: fresh NCR does not render as 0 evidence");
  assert(mappedPending.evidence[0].uploadStatus === "pending", "29e: NCR detail shows pending before Drive upload");
  assert(mappedPending.investigationNotes === "pooppoo", "29f: note/description preserved with evidence");

  const uploaded = buildNcrWorkbookRow({
    reference: "NCR-0301",
    companyFolderId: CO,
    auditId: "dc-hs-audit",
    auditName: "DC H&S Audit",
    questionId: "q-fail",
    questionText: "Fire exit clear?",
    answer: "fail",
    evidenceRefs: [
      {
        evidenceId: "ev-up-1",
        questionId: "q-fail",
        name: "photo-1.jpg",
        driveLink: "https://drive.google.com/file/d/xyz/view",
        driveFileId: "xyz",
      },
    ],
  });
  const mappedUploaded = mapNcrWorkbookRowToClient(uploaded, CO);
  assert(mappedUploaded.evidence[0].previewUrl.includes("drive.google.com"), "30: Drive evidence shown after upload/backfill");

  const countOnly = {
    "NCR ID": "NCR-0302",
    Reference: "NCR-0302",
    "Company Folder ID": CO,
    Status: "Open",
    "Evidence Count": "2",
    "Evidence Refs": "",
    "Source Question ID": "q1",
  };
  const mappedCountOnly = mapNcrWorkbookRowToClient(countOnly, CO);
  assert(mappedCountOnly.evidence.length === 2, "31: Evidence Count alone creates pending evidence stubs");
  assert(mappedCountOnly.evidence.every((item) => item.uploadStatus === "pending"), "31b: count-only stubs are pending");
}

{
  const withEvidence = buildNcrWorkbookRow({
    reference: "NCR-0200",
    companyFolderId: CO,
    auditId: "dc-hs-audit",
    auditName: "DC H&S Audit",
    questionId: "q-fail",
    questionText: "Fire exit clear?",
    answer: "fail",
    note: "Blocked",
    resultId: "result-ev-1",
    evidenceRefs: [
      {
        evidenceId: "ev-1",
        questionId: "q-fail",
        name: "photo-1.jpg",
        driveLink: "https://drive.google.com/file/d/abc/view",
        driveFileId: "abc",
      },
      {
        evidenceId: "ev-other",
        questionId: "q-other",
        name: "other.jpg",
        driveLink: "https://drive.google.com/file/d/other/view",
      },
    ],
  });
  assert(withEvidence["Evidence Count"] === "1", "27: NCR row stores only question-scoped evidence count");
  assert(withEvidence["Evidence Refs"].includes("ev-1"), "27b: NCR Evidence Refs includes matching photo");
  assert(!withEvidence["Evidence Refs"].includes("ev-other"), "27c: NCR Evidence Refs excludes other question photos when match exists");
  const mappedEvidence = mapNcrWorkbookRowToClient(withEvidence, CO);
  assert(mappedEvidence.evidence.length === 1, "27d: mapped NCR evidence count > 0");
  assert(mappedEvidence.evidence[0].previewUrl.includes("drive.google.com"), "27e: mapped NCR evidence has Drive link");
  assert(mappedEvidence.resultId === "result-ev-1", "27f: mapped NCR keeps source result id");

  const noEvidence = buildNcrWorkbookRow({
    reference: "NCR-0201",
    companyFolderId: CO,
    auditId: "audit-x",
    auditName: "Walk",
    questionId: "q1",
    questionText: "Ok?",
    answer: "nc",
  });
  assert(noEvidence["Evidence Count"] === "0", "28: missing evidence fields mean zero evidence");
  assert(mapNcrWorkbookRowToClient(noEvidence, CO).evidence.length === 0, "28b: no-evidence NCR still maps cleanly");
}

{
  const auditRow = buildNcrWorkbookRow({
    reference: "NCR-0042",
    companyFolderId: CO,
    auditId: "dc-hs-audit",
    auditName: "DC H&S Audit",
    questionId: "q-google-form",
    questionText: "",
    answer: "nc",
    note: "Complete linked Google Form",
    site: "",
    auditorName: "Alex",
    auditorUserId: "alex@test.co",
    status: "Open",
    resultId: "result-1",
    localSubmissionId: "local-1",
  });
  assert(auditRow["Source Audit ID"] === "dc-hs-audit", "22: workbook NCR has source audit id");
  assert(auditRow["Source Question ID"] === "q-google-form", "22b: workbook NCR has source question id");
  assert(auditRow.Status === "Open", "22c: workbook NCR status Open");
  assert(auditRow.Archived === "false", "22d: workbook NCR archived false by default");

  const mapped = mapNcrWorkbookRowToClient(auditRow, CO);
  assert(mapped.reference === "NCR-0042", "23: mapped client NCR has reference");
  assert(mapped.auditQuestion === "DC H&S Audit - Complete linked Google Form", "23b: title fallback from audit + note");
  assert(mapped.status === "Raised", "23c: Open maps to Raised for UI");

  const blankStatusRow = buildNcrWorkbookRow({
    reference: "NCR-0043",
    companyFolderId: CO,
    auditId: "audit-2",
    auditName: "Walk",
    questionId: "q2",
    questionText: "Exit clear?",
    answer: "fail",
    status: "",
  });
  const blankStatusMapped = mapNcrWorkbookRowToClient(blankStatusRow, CO);
  assert(blankStatusMapped.status === "Raised", "24: blank status defaults to Raised");

  const archivedRow = buildNcrWorkbookRow({
    reference: "NCR-0099",
    companyFolderId: CO,
    auditId: "audit-3",
    auditName: "Walk",
    questionId: "q3",
    questionText: "Old issue",
    answer: "nc",
    archived: "true",
  });
  assert(isWorkbookRowArchived(archivedRow, "ncr"), "25: archived workbook NCR hidden from active lists");
}

function filterNcrsLikeApp(records, allowedSiteIds, sites) {
  if (!allowedSiteIds) return records;
  const allowedNames = new Set(
    sites
      .filter((site) => allowedSiteIds.has(site.id) && site.active)
      .map((site) => site.name.trim().toLowerCase().replace(/\s+/g, " ")),
  );
  if (allowedNames.size === 0) return [];
  return records.filter((record) => {
    const site = String(record.site || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (!site) return true;
    return allowedNames.has(site);
  });
}

{
  const sites = [
    { id: "site-yard", name: "Yard", active: true },
    { id: "site-office", name: "Office", active: true },
  ];
  const records = [
    { reference: "NCR-0100", site: "Yard" },
    { reference: "NCR-0101", site: "" },
  ];
  const scoped = filterNcrsLikeApp(records, new Set(["site-yard"]), sites);
  assert(scoped.length === 2, "26: blank-site NCR visible to scoped manager");
  assert(scoped.some((item) => item.reference === "NCR-0101"), "26b: blank-site NCR included");
}

assert(JSON.parse(read("package.json")).scripts["verify:ncr-workflow"], "20: verify script registered");

console.log(`[verify:ncr-workflow] OK — ${checks} checks passed`);
