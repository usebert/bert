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

const completion = read("server/completion-service.mjs");
assert(completion.includes("appendNcrsFromCheckCompletion"), "3: completion service writes NCR rows");
assert(completion.includes("findings: input.findings"), "3b: findings passed to NCR writer");

const routes = read("server/core-workflow-routes.mjs");
assert(routes.includes('app.post("/api/companies/:companyFolderId/ncrs"'), "4: folder-first NCR save route");

const appTsx = read("App.tsx");
const checkService = read("src/services/checkService.ts");
const clientNcrService = read("src/services/ncrService.ts");

assert(appTsx.includes("createNonConformancesFromAudit"), "5: client creates NCRs from audit submit");
assert(appTsx.includes("parseCompanySheetNcrs"), "6: client loads NCRs from workbook");
assert(appTsx.includes("mergeSheetNcrsIntoState"), "6b: sheet NCR merge helper wired");
assert(appTsx.includes("loadCompanySheetById") && appTsx.includes("mergeSheetNcrsIntoState(current, payload.data.NCRs"), "6c: load by sheet id merges NCR tab");
assert(checkService.includes('CHECK_COMPLETION_NCR_RECORDED_MESSAGE = "Non-conformance recorded."'), "7: success screen NCR recorded message");
assert(
  checkService.includes("CHECK_COMPLETION_NCR_WRITE_FAILED_MESSAGE"),
  "7b: partial-success warning when NCR write fails",
);
assert(appTsx.includes("CHECK_COMPLETION_NCR_RECORDED_MESSAGE"), "7c: completion summary shows NCR recorded");
assert(appTsx.includes("CHECK_COMPLETION_NCR_WRITE_FAILED_MESSAGE"), "7d: completion summary shows NCR write failure");
assert(appTsx.includes("ncrsRecorded"), "7e: completion summary tracks NCR count");
assert(appTsx.includes("ncrWriteFailed"), "7f: completion summary tracks NCR write failure");
assert(appTsx.includes("resolveNcrCompletionOutcome"), "7g: NCR outcome resolver used on submit");
assert(appTsx.includes("serverNcrs: result.ncrs"), "7h: server NCRs merged into client state");

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
  status: "Raised",
});
assert(row["NCR ID"] === "NCR-0001" && row.Archived === "false", "9: NCR row defaults active");
assert(isNcrFindingAnswer("nc") && isNcrFindingAnswer("fail"), "10: finding answer detection");

{
  const openBlankArchived = { "NCR ID": "n1", "Company ID": CO, Status: "Raised" };
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
  assert(ncrWorkbookRowIsOpen(openBlankArchived), "13: missing status treated as open");
}

assert(read("src/components/dashboard/ManagerRoleDashboard.tsx").includes("Open NCRs"), "14: manager dashboard shows open NCRs");
assert(clientNcrService.includes("NCR_SAFE_ERROR_CODES"), "15: safe client NCR error messages");
assert(clientNcrService.includes("resolveNcrCompletionOutcome"), "15b: client NCR outcome resolver");
assert(clientNcrService.includes('status === "archived"'), "15c: client parser hides status Archived only");

assert(JSON.parse(read("package.json")).scripts["verify:ncr-workflow"], "16: verify script registered");

console.log(`[verify:ncr-workflow] OK — ${checks} checks passed`);
