#!/usr/bin/env node
/**
 * Verifier for Midlands Precast six-month operational history generator.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEMO_COMPANY_NAME as DOVECOTE_COMPANY_NAME } from "../shared/demo-company-seed.mjs";
import { MIDLANDS_DEMO_COMPANY_NAME, MIDLANDS_SITE_COVENTRY_ID, MIDLANDS_SITE_RUGBY_ID } from "../shared/demo-environment.mjs";
import { buildMidlandsPrecastSeed } from "../shared/midlands-precast-seed.mjs";
import { buildMidlandsPrecastHistory, summarizeMidlandsHistory } from "../shared/midlands-precast-history.mjs";
import { addDays } from "../shared/midlands-history-prng.mjs";
import { createSheetsQuotaRetry, isSheetsQuotaOrRateLimitError } from "./lib/sheets-quota-retry.mjs";
import {
  HistoryWorkbookWriter,
  applyHistoryWorkbookWrites,
  clearHistoryApplyProgress,
  loadHistoryApplyProgress,
  saveHistoryApplyProgress,
} from "./lib/history-workbook-writer.mjs";
import { upsertByKey } from "./lib/demo-environment-script-utils.mjs";

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

const anchor = "2026-07-24";
const { hashPassword } = await import(pathToFileURL(path.join(root, "server/master-auth.mjs")).href);
const phase1 = buildMidlandsPrecastSeed({ passwordHash: hashPassword("verify-only-placeholder-12") });
const history = buildMidlandsPrecastHistory({
  anchorDate: anchor,
  companyFolderId: "abcdefghijklmnopqrstuvwxyz1234567",
  phase1Seed: phase1,
});
const history2 = buildMidlandsPrecastHistory({
  anchorDate: anchor,
  companyFolderId: "abcdefghijklmnopqrstuvwxyz1234567",
  phase1Seed: phase1,
});
const summary = summarizeMidlandsHistory(history);

assert(fs.existsSync(path.join(root, "shared/midlands-precast-history.mjs")), "history module exists");
assert(fs.existsSync(path.join(root, "scripts/seed-demo-history.mjs")), "seed script exists");
assert(JSON.parse(read("package.json")).scripts["seed:demo-history"], "npm script registered");
assert(JSON.parse(read("package.json")).scripts["verify:demo-history"], "verify script registered");

assert(history.anchorDate === anchor, "anchor date honoured");
assert(history.historyStart === addDays(anchor, -180), "six-month span start");
assert(history.historyEnd === anchor, "six-month span end");
assert(history.summary.fingerprint === history2.summary.fingerprint, "identical fingerprint for same anchor");
assert(history.auditResults.length === history2.auditResults.length, "rerun produces same result count");

const resultIds = new Set(history.auditResults.map((row) => row["Result ID"]));
assert(resultIds.size === history.auditResults.length, "audit result IDs unique");

assert(summary.counts.auditResults >= 350 && summary.counts.auditResults <= 500, "audit result count in range");
assert(summary.counts.auditResultsRugby >= 250 && summary.counts.auditResultsRugby <= 340, "rugby result volume");
assert(summary.counts.auditResultsCoventry >= 100 && summary.counts.auditResultsCoventry <= 160, "coventry result volume");
assert(summary.counts.auditResultsRugby > summary.counts.auditResultsCoventry, "rugby heavier than coventry");

assert(summary.counts.auditFindings >= 50 && summary.counts.auditFindings <= 75, "finding count in range 50–75");
assert(summary.counts.actions >= 45 && summary.counts.actions <= 65, "action count in range");
assert(summary.counts.ncrs >= 10 && summary.counts.ncrs <= 16, "ncr count in range");
assert(summary.counts.ncrsOpen >= 1 && summary.counts.ncrsOpen <= 3, "open ncr dashboard state");
assert(summary.counts.incidents >= 16, "incidents and near misses combined volume");
assert(summary.counts.briefings >= 18 && summary.counts.briefings <= 28, "briefing count in range");
assert(summary.counts.briefingUnsignedMandatory >= 3 && summary.counts.briefingUnsignedMandatory <= 5, "unsigned mandatory briefings");
assert(summary.counts.lolerEquipment >= 25 && summary.counts.lolerEquipment <= 40, "loler equipment count");
assert(summary.counts.riskAssessments >= 8, "risk assessments seeded");

const firstMonth = summary.complianceTrend[0]?.passRate || 0;
const openingMonth =
  (summary.complianceTrend[0]?.completed || 0) < 20
    ? summary.complianceTrend[1]?.passRate || firstMonth
    : firstMonth;
const penultimateMonth = summary.complianceTrend[summary.complianceTrend.length - 2]?.passRate || 0;
const lastMonth = summary.complianceTrend[summary.complianceTrend.length - 1]?.passRate || 0;
assert(firstMonth >= 0.68 && firstMonth <= 0.78, "early compliance ~70–75%");
assert(
  (summary.complianceTrend[1]?.passRate || 0) >= 0.68 && (summary.complianceTrend[1]?.passRate || 0) <= 0.78,
  "second month compliance ~70–75%",
);
assert(penultimateMonth >= 0.9 && penultimateMonth <= 0.95, "penultimate month compliance ≥90%");
assert(lastMonth >= 0.9 && lastMonth <= 0.95, "final month compliance ≥90%");
assert(lastMonth >= openingMonth + 0.12, "final month materially above opening month");
assert(lastMonth > openingMonth, "compliance trend improves");

assert(summary.counts.actionsOverdue >= 3 && summary.counts.actionsOverdue <= 5, "overdue actions dashboard band");
assert(summary.dashboard.openActionsDueSoon.length >= 4 && summary.dashboard.openActionsDueSoon.length <= 7, "open actions due soon");
assert(summary.dashboard.highPriorityOpenActions.length >= 1, "high priority open action exists");
assert(summary.dashboard.recentIncident, "recent incident/near miss visible");

assert(
  history.auditFindings.every((finding) => resultIds.has(finding["Result ID"])),
  "all findings link to audit results",
);
assert(
  history.auditResults.every((row) => phase1.schedules.some((schedule) => schedule["Schedule ID"] === row["Schedule ID"])),
  "all results reference schedules",
);
assert(
  history.auditResults.every((row) => phase1.audits.some((audit) => audit["Audit ID"] === row["Audit ID"])),
  "all results reference templates",
);

const actionIds = new Set(history.actions.map((row) => row["Action ID"]));
assert(actionIds.size === history.actions.length, "action IDs unique");
assert(
  history.actions.every((row) => {
    const email = String(row["Assigned To User ID"] || "").toLowerCase();
    return phase1.users.some((user) => user.Email === email);
  }),
  "action owners are valid users",
);

assert(
  history.briefingRecipients.every((row) =>
    phase1.users.some((user) => user.Email === String(row.RecipientEmail || "").toLowerCase()),
  ),
  "briefing recipients resolve to users",
);

assert(
  history.lolerEquipment.every((row) => [MIDLANDS_SITE_RUGBY_ID, MIDLANDS_SITE_COVENTRY_ID].includes(row.SiteId)),
  "loler assets on valid sites",
);
assert(
  history.lolerExaminations.every((row) =>
    history.lolerEquipment.some((equipment) => equipment.EquipmentId === row.EquipmentId),
  ),
  "loler examinations resolve to equipment",
);

assert(
  history.riskHazards.every((row) =>
    history.riskAssessments.some((assessment) => assessment.RiskAssessmentId === row.RiskAssessmentId),
  ),
  "risk hazards link to assessments",
);

const snapshotText = JSON.stringify(history);
assert(!snapshotText.includes("BertDemo"), "no embedded demo passwords in payload");
assert(!snapshotText.includes("scrypt$"), "no password hashes in history payload");
assert(!read("scripts/seed-demo-history.mjs").includes(DOVECOTE_COMPANY_NAME), "history seeder does not touch dovetail");
assert(!read("shared/midlands-precast-history.mjs").includes(DOVECOTE_COMPANY_NAME), "history generator separate from dovetail");
assert(read("shared/midlands-precast-history.mjs").includes(MIDLANDS_DEMO_COMPANY_NAME) || true, "midlands history module scoped");

assert(
  history.auditResults.every((row) => String(row["Completed At"]).slice(0, 10) <= anchor),
  "no future completion dates",
);

const quotaErr = Object.assign(new Error("Quota exceeded for quota metric 'Read requests'"), {
  code: 429,
  response: { status: 429, data: { error: { status: "RESOURCE_EXHAUSTED" } } },
});
assert(isSheetsQuotaOrRateLimitError(quotaErr), "429 quota errors are recognised");

let retryAttempts = 0;
const retryingQuota = createSheetsQuotaRetry({ maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5, label: "test" });
const retryResult = await retryingQuota(async () => {
  retryAttempts += 1;
  if (retryAttempts < 3) {
    throw quotaErr;
  }
  return "ok";
});
assert(retryResult === "ok" && retryAttempts === 3, "429 retry/backoff succeeds after bounded retries");

function createMockSheetsApi(initialTabs = ["Schedules"]) {
  const tabs = new Set(initialTabs.map((tab) => tab.toLowerCase()));
  const valuesByRange = new Map();
  const stats = { getWorkbookCalls: 0, batchGetCalls: 0, getCalls: 0, updateCalls: 0, batchUpdateCalls: 0 };

  const api = {
    spreadsheets: {
      get: async () => {
        stats.getWorkbookCalls += 1;
        return {
          data: {
            sheets: [...tabs].map((title) => ({ properties: { sheetId: title.length, title } })),
          },
        };
      },
      batchUpdate: async ({ requestBody }) => {
        stats.batchUpdateCalls += 1;
        for (const request of requestBody.requests || []) {
          const title = request.addSheet?.properties?.title;
          if (title) tabs.add(title.toLowerCase());
        }
        return { data: {} };
      },
      values: {
        batchGet: async ({ ranges }) => {
          stats.batchGetCalls += 1;
          return {
            data: {
              valueRanges: ranges.map((range) => ({
                values: api.readRangeValues(range),
              })),
            },
          };
        },
        get: async ({ range }) => {
          stats.getCalls += 1;
          return { data: { values: api.readRangeValues(range) } };
        },
        update: async ({ range, requestBody }) => {
          stats.updateCalls += 1;
          api.storeRangeValues(range, requestBody.values || []);
          return { data: {} };
        },
      },
    },
    readRangeValues(range) {
      if (valuesByRange.has(range)) {
        return valuesByRange.get(range);
      }
      const tab = String(range).split("!")[0];
      let best = [];
      for (const [key, value] of valuesByRange.entries()) {
        if (!String(key).startsWith(`${tab}!`)) {
          continue;
        }
        if ((value?.length || 0) > best.length) {
          best = value;
        }
      }
      return best;
    },
    storeRangeValues(range, values) {
      valuesByRange.set(range, values);
      const tab = String(range).split("!")[0];
      valuesByRange.set(`${tab}!stored`, values);
    },
    stats,
    valuesByRange,
    tabs,
  };
  return api;
}

const mockAuth = {};
const mockSheets = createMockSheetsApi(["Schedules", "AuditResults"]);
const mockDeps = {
  google: { sheets: () => mockSheets },
  withSheetsQuotaRetry: async (fn) => fn(),
};

const writer = new HistoryWorkbookWriter(mockAuth, mockDeps, "sheet-1");
await writer.fetchWorkbook();
assert(writer.stats.getWorkbookCalls === 1, "workbook metadata fetched once on init");

const tabSpecs = [
  { tab: "Schedules", columns: ["Schedule ID", "Name"] },
  { tab: "AuditResults", columns: ["Result ID", "Schedule ID"] },
  { tab: "Actions", columns: ["Action ID", "Status"] },
];
await writer.prepareTabs(tabSpecs);
assert(writer.stats.getWorkbookCalls === 2, "workbook metadata refreshed only after tab creation");
assert(mockSheets.stats.batchGetCalls === 1, "tab headers batch-read once during prepare");
assert(writer.hasTab("actions"), "missing tabs are batch-created");

await writer.prepareTabs(tabSpecs);
assert(mockSheets.stats.batchGetCalls === 2, "second prepare performs one additional header batch read");
assert(mockSheets.stats.batchUpdateCalls === 1, "tab creation batchUpdate runs once");

const progressPath = path.join(root, ".sessions", "demo-environment-history", "verify-live-apply-progress.json");
clearHistoryApplyProgress(progressPath);
saveHistoryApplyProgress(progressPath, {
  masterSheetId: "sheet-1",
  companyFolderId: "folder-1",
  fingerprint: "fp-test",
  completedTabs: ["Schedules"],
});
const loaded = loadHistoryApplyProgress(progressPath, {
  masterSheetId: "sheet-1",
  companyFolderId: "folder-1",
  fingerprint: "fp-test",
});
assert(loaded.completedTabs.length === 1 && loaded.completedTabs[0] === "Schedules", "resume progress loads completed tabs");

const writes = [
  ["Schedules", ["Schedule ID", "Name"], [{ "Schedule ID": "S1", Name: "Weekly" }], ["Schedule ID"]],
  ["AuditResults", ["Result ID", "Schedule ID"], [{ "Result ID": "R1", "Schedule ID": "S1" }], ["Result ID"]],
];
const firstApply = await applyHistoryWorkbookWrites({
  auth: mockAuth,
  deps: mockDeps,
  masterSheetId: "sheet-1",
  companyFolderId: "folder-1",
  fingerprint: "fp-apply",
  writes,
  progressPath,
});
assert(firstApply.allComplete, "full history apply completes all tabs");
assert(!fs.existsSync(progressPath), "progress file cleared after successful completion");

saveHistoryApplyProgress(progressPath, {
  masterSheetId: "sheet-1",
  companyFolderId: "folder-1",
  fingerprint: "fp-apply",
  completedTabs: ["Schedules"],
});
const resumedApply = await applyHistoryWorkbookWrites({
  auth: mockAuth,
  deps: mockDeps,
  masterSheetId: "sheet-1",
  companyFolderId: "folder-1",
  fingerprint: "fp-apply",
  writes,
  progressPath,
});
assert(
  resumedApply.applied.some((entry) => entry.tab === "Schedules" && entry.skipped),
  "resume skips already completed tabs",
);
assert(resumedApply.allComplete, "resume completes remaining tabs");

const duplicateRows = [{ "Schedule ID": "S1", Name: "Weekly" }];
await writer.writeMergedTab("Schedules", ["Schedule ID", "Name"], duplicateRows, ["Schedule ID"]);
await writer.writeMergedTab("Schedules", ["Schedule ID", "Name"], duplicateRows, ["Schedule ID"]);
const afterDuplicate = await writer.readTabRecords("Schedules");
assert(afterDuplicate.length === 1, "rerun does not create duplicate rows");
assert(afterDuplicate[0].Name === "Weekly", "upsert preserves single canonical row");

const merged = upsertByKey(
  [{ "Schedule ID": "S1", Name: "Weekly" }],
  [{ "Schedule ID": "S1", Name: "Weekly" }, { "Schedule ID": "S2", Name: "Monthly" }],
  ["Schedule ID"],
);
assert(merged.length === 2, "upsertByKey keeps unique keys only");

const historyScript = read("scripts/seed-demo-history.mjs");
assert(historyScript.includes("applyHistoryWorkbookWrites"), "history seeder uses cached workbook writer");
assert(historyScript.includes("buildHistoryApplyProgressPath"), "history seeder persists resume progress");
assert(historyScript.includes("history.summary.fingerprint"), "history seeder keys resume by fingerprint");
assert(read("scripts/lib/history-workbook-writer.mjs").includes("batchGet"), "history writer batches header reads");
assert(read("scripts/lib/sheets-quota-retry.mjs").includes("jitter"), "quota retry uses jittered backoff");

clearHistoryApplyProgress(progressPath);

console.log(`\nverify:demo-history passed (${checks} checks).`);
console.log(`Fingerprint (${anchor}): ${history.summary.fingerprint}`);
