#!/usr/bin/env node
/** verify:ncr-ui — BERT NCR module Release 6 checks. */
import { readFileSync } from "node:fs";
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
  console.log(`ok ${caseCount}: ${message}`);
}
function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

const pkg = JSON.parse(read("package.json"));
const workspace = read("src/ncrs/NcrWorkspace.tsx");
const screen = read("src/screens/NonConformanceScreen.tsx");
const adapter = read("src/ncrs/adapters/ncrListAdapter.ts");
const ncrService = read("src/services/ncrService.ts");
const app = read("App.tsx");

assert(Boolean(pkg.scripts?.["verify:ncr-ui"]), "package.json defines verify:ncr-ui");
assert(workspace.includes("NcrWorkspace"), "shared NCR workspace exists");
assert(workspace.includes("PageContainer"), "uses PageContainer");
assert(workspace.includes("NcrSummaryCards"), "summary strip wired");
assert(workspace.includes("NcrFilters"), "filters wired");
assert(workspace.includes("NcrList"), "NCR list wired");
assert(screen.includes("NcrWorkspace"), "NonConformanceScreen delegates to workspace");

assert(workspace.includes("open"), "Open tab");
assert(workspace.includes("overdue"), "Overdue tab");
assert(workspace.includes("awaiting-verification"), "Awaiting Verification tab");
assert(workspace.includes("closed"), "Closed tab");

assert(workspace.includes("rootCause"), "root cause field distinct");
assert(workspace.includes("correctiveAction"), "corrective action field distinct");
assert(workspace.includes("investigationNotes"), "investigation notes distinct");
assert(workspace.includes("onSaveProgress"), "save progress preserved");
assert(workspace.includes("onComplete"), "completion preserved");
assert(workspace.includes("NCR_EVIDENCE_PENDING_MESSAGE"), "pending evidence state");
assert(workspace.includes("EvidenceUploadChoice"), "evidence upload wired");
assert(workspace.includes("auditorIdentityTokens"), "auditor scoping preserved");
assert(adapter.includes("isUkOverdue"), "overdue uses existing date logic");
assert(ncrService.includes("NCR_EVIDENCE_FAILED_MESSAGE"), "NCR evidence service unchanged");
assert(app.includes("parseCompanySheetNcrs"), "NCR workbook load preserved");

console.log(`PASS: verify-ncr-ui (${caseCount} checks)`);
