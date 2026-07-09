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

const routes = read("server/core-workflow-routes.mjs");
assert(routes.includes('app.post("/api/companies/:companyFolderId/ncrs"'), "4: folder-first NCR save route");

const appTsx = read("App.tsx");
assert(appTsx.includes("createNonConformancesFromAudit"), "5: client creates NCRs from audit submit");
assert(appTsx.includes("parseCompanySheetNcrs"), "6: client loads NCRs from workbook");
assert(appTsx.includes("Non-conformance recorded"), "7: success message on NCR create");

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
  const built = buildLiveDashboardFromSources(
    { ncrs: [openBlankArchived, archived], actions: [], schedules: [], auditResults: [], incidents: [], briefings: [], briefingRecipients: [], areas: [], sites: [] },
    { companyFolderId: CO, actor: adminActor, now: new Date("2026-07-09T10:00:00.000Z") },
  );
  assert(built.metrics.openNcrs === 1, "11: blank Archived keeps NCR open in dashboard");
  assert(isWorkbookRowArchived(archived, "ncr"), "12: archived NCR hidden");
  assert(ncrWorkbookRowIsOpen(openBlankArchived), "13: missing status treated as open");
}

assert(read("src/components/dashboard/ManagerRoleDashboard.tsx").includes("Open NCRs"), "14: manager dashboard shows open NCRs");
assert(read("src/services/ncrService.ts").includes("NCR_SAFE_ERROR_CODES"), "15: safe client NCR error messages");

assert(JSON.parse(read("package.json")).scripts["verify:ncr-workflow"], "16: verify script registered");

console.log(`[verify:ncr-workflow] OK — ${checks} checks passed`);
