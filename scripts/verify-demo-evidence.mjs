#!/usr/bin/env node
/**
 * Verifier for Midlands synthetic demo evidence generation.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEMO_COMPANY_NAME as DOVECOTE_COMPANY_NAME } from "../shared/demo-company-seed.mjs";
import { MIDLANDS_DEMO_COMPANY_NAME } from "../shared/demo-environment.mjs";
import { buildMidlandsPrecastSeed } from "../shared/midlands-precast-seed.mjs";
import { buildMidlandsPrecastHistory } from "../shared/midlands-precast-history.mjs";
import {
  buildMidlandsEvidencePlan,
  buildEvidenceManifest,
  computeEvidenceManifestFingerprint,
  isMidlandsSyntheticEvidenceFileName,
  renderEvidencePlanItem,
  MIDLANDS_EVIDENCE_RUNTIME_DIR,
} from "../shared/midlands-precast-evidence.mjs";
import {
  evidenceOutputDir,
  generateLocalEvidenceBundle,
  resolveSessionsRoot,
} from "./lib/demo-evidence-script-utils.mjs";

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

const plan1 = buildMidlandsEvidencePlan({ history, anchorDate: anchor });
const plan2 = buildMidlandsEvidencePlan({ history, anchorDate: anchor });
assert(fs.existsSync(path.join(root, "shared/midlands-precast-evidence.mjs")), "evidence module exists");
assert(fs.existsSync(path.join(root, "shared/midlands-evidence-render.mjs")), "evidence render module exists");
assert(fs.existsSync(path.join(root, "scripts/generate-demo-evidence.mjs")), "generate script exists");
assert(fs.existsSync(path.join(root, "scripts/seed-demo-evidence.mjs")), "seed script exists");
assert(JSON.parse(read("package.json")).scripts["generate:demo-evidence"], "generate npm script registered");
assert(JSON.parse(read("package.json")).scripts["seed:demo-evidence"], "seed npm script registered");
assert(JSON.parse(read("package.json")).scripts["verify:demo-evidence"], "verify npm script registered");

assert(plan1.items.length >= 35 && plan1.items.length <= 50, "image count in target range");
assert(plan1.summary.beforeAfterPairs >= 4, "before/after pairs present");
assert(plan1.summary.linkedRecords.findings >= 15 && plan1.summary.linkedRecords.findings <= 20, "findings linked");
assert(plan1.summary.linkedRecords.incidents >= 6 && plan1.summary.linkedRecords.incidents <= 8, "incidents linked");
assert(plan1.summary.linkedRecords.ncrs >= 5 && plan1.summary.linkedRecords.ncrs <= 7, "ncrs linked");
assert(plan1.summary.linkedRecords.actions >= 8 && plan1.summary.linkedRecords.actions <= 12, "actions linked");

const findingIds = new Set(history.auditFindings.map((row) => row["Finding ID"]));
const incidentIds = new Set(history.incidents.map((row) => row.IncidentId));
const ncrIds = new Set(history.ncrs.map((row) => row["NCR ID"]));
const actionIds = new Set(history.actions.map((row) => row["Action ID"]));
const resultIds = new Set(history.auditResults.map((row) => row["Result ID"]));

assert(
  plan1.items.every((item) => isMidlandsSyntheticEvidenceFileName(item.fileName)),
  "deterministic synthetic filenames",
);
assert(new Set(plan1.items.map((item) => item.fileName)).size === plan1.items.length, "unique filenames");
assert(
  plan1.items.every((item) => {
    if (item.recordType === "finding") return findingIds.has(item.recordId);
    if (item.recordType === "incident") return incidentIds.has(item.recordId);
    if (item.recordType === "ncr") return ncrIds.has(item.recordId);
    if (item.recordType === "action") return actionIds.has(item.recordId);
    return false;
  }),
  "all evidence items reference existing records",
);
assert(
  plan1.items.filter((item) => item.recordType !== "incident").every((item) => !item.resultId || resultIds.has(item.resultId)),
  "audit-linked evidence references existing results",
);

const pairGroups = new Map();
for (const item of plan1.items.filter((entry) => entry.pairId)) {
  const list = pairGroups.get(item.pairId) || [];
  list.push(item);
  pairGroups.set(item.pairId, list);
}
assert(
  [...pairGroups.values()].every((group) => group.some((item) => item.pairRole === "before") && group.some((item) => item.pairRole === "after")),
  "before/after pairs complete",
);
assert(
  [...pairGroups.values()].every((group) => new Set(group.map((item) => item.recordId)).size === 1),
  "before/after pairs share parent record",
);

const sessionsRoot = resolveSessionsRoot(root);
const outputA = path.join(sessionsRoot, "demo-environment-evidence", `${anchor}-verify-a`);
const outputB = path.join(sessionsRoot, "demo-environment-evidence", `${anchor}-verify-b`);
fs.rmSync(outputA, { recursive: true, force: true });
fs.rmSync(outputB, { recursive: true, force: true });
const bundleA = generateLocalEvidenceBundle({ plan: plan1, outputDir: outputA });
const bundleB = generateLocalEvidenceBundle({ plan: plan2, outputDir: outputB });

assert(bundleA.manifest.fingerprint === bundleB.manifest.fingerprint, "identical manifest fingerprint across runs");
assert(
  bundleA.rendered.every((file, index) => file.sha256 === bundleB.rendered[index]?.sha256),
  "identical file hashes across runs",
);
assert(
  bundleA.rendered.every((file) => file.size > 1024),
  "non-zero file sizes",
);
assert(
  bundleA.rendered.every((file) => file.width >= 640 && file.height >= 480),
  "minimum dimensions",
);
assert(
  bundleA.rendered.every((file) => file.mimeType === "image/png"),
  "png output type",
);

const manifestText = JSON.stringify(bundleA.manifest);
assert(!manifestText.includes(DOVECOTE_COMPANY_NAME), "manifest does not reference Dovecote");
assert(!manifestText.match(/@usebert\.co\.uk/), "manifest avoids real demo emails");
assert(!manifestText.match(/https?:\/\//), "manifest has no external URLs");
assert(!read("shared/midlands-precast-evidence.mjs").includes(DOVECOTE_COMPANY_NAME), "evidence module separate from Dovecote");
assert(read("scripts/seed-demo-evidence.mjs").includes("assertDemoCompanyAllowed"), "live mode guarded");
assert(read("scripts/seed-demo-evidence.mjs").includes("uploadAuditEvidenceToDrive"), "uses audit evidence upload pathway");
assert(read("scripts/seed-demo-evidence.mjs").includes("uploadIncidentEvidenceToDrive"), "uses incident evidence upload pathway");
assert(read("scripts/generate-demo-evidence.mjs").includes("local-generation"), "dry-run default local mode");
assert(read(".gitignore").includes("demo-environment-evidence-report.json"), "evidence report gitignored");

const rendered = plan1.items.slice(0, 3).map((item) => renderEvidencePlanItem(item));
assert(
  rendered.every((file) => file.buffer.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))),
  "valid png signature",
);

const stableFingerprint = computeEvidenceManifestFingerprint(buildEvidenceManifest(plan1, bundleA.rendered));
assert(stableFingerprint === bundleA.manifest.fingerprint, "fingerprint helper stable");

console.log(`\nverify:demo-evidence passed (${checks} checks).`);
console.log(`Fingerprint (${anchor}): ${bundleA.manifest.fingerprint}`);
console.log(`Images: ${bundleA.manifest.summary.imageCount} (Rugby ${bundleA.manifest.summary.bySite.rugby}, Coventry ${bundleA.manifest.summary.bySite.coventry})`);
