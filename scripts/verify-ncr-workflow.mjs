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

assert(JSON.parse(read("package.json")).scripts["verify:ncr-workflow"], "20: verify script registered");

console.log(`[verify:ncr-workflow] OK — ${checks} checks passed`);
