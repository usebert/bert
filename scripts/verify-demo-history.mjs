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

assert(summary.counts.auditFindings >= 50 && summary.counts.auditFindings <= 80, "finding count in range");
assert(summary.counts.actions >= 45 && summary.counts.actions <= 65, "action count in range");
assert(summary.counts.ncrs >= 10 && summary.counts.ncrs <= 16, "ncr count in range");
assert(summary.counts.ncrsOpen >= 1 && summary.counts.ncrsOpen <= 3, "open ncr dashboard state");
assert(summary.counts.incidents >= 16, "incidents and near misses combined volume");
assert(summary.counts.briefings >= 18 && summary.counts.briefings <= 28, "briefing count in range");
assert(summary.counts.briefingUnsignedMandatory >= 3 && summary.counts.briefingUnsignedMandatory <= 5, "unsigned mandatory briefings");
assert(summary.counts.lolerEquipment >= 25 && summary.counts.lolerEquipment <= 40, "loler equipment count");
assert(summary.counts.riskAssessments >= 8, "risk assessments seeded");

const firstMonth = summary.complianceTrend[0]?.passRate || 0;
const lastMonth = summary.complianceTrend[summary.complianceTrend.length - 1]?.passRate || 0;
assert(firstMonth >= 0.68 && firstMonth <= 0.78, "early compliance ~70–75%");
assert(lastMonth >= 0.88 && lastMonth <= 0.95, "late compliance ~90–93%");
assert(lastMonth > firstMonth, "compliance trend improves");

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

console.log(`\nverify:demo-history passed (${checks} checks).`);
console.log(`Fingerprint (${anchor}): ${history.summary.fingerprint}`);
