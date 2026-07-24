#!/usr/bin/env node
/**
 * Verifier for Midlands demo evidence import pipeline.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEMO_COMPANY_NAME as DOVECOTE_COMPANY_NAME } from "../shared/demo-company-seed.mjs";
import { MIDLANDS_DEMO_COMPANY_NAME } from "../shared/demo-environment.mjs";
import { buildMidlandsPrecastSeed } from "../shared/midlands-precast-seed.mjs";
import { buildMidlandsPrecastHistory } from "../shared/midlands-precast-history.mjs";
import {
  isLegacyPlaceholderEvidenceBuffer,
  legacyPlaceholderSha256ForItem,
  renderLegacyPlaceholderForItem,
} from "../shared/midlands-evidence-legacy.mjs";
import {
  validateEvidencePlanSemantics,
} from "../shared/midlands-evidence-scene-resolver.mjs";
import {
  MAX_IMAGES_PER_RECORD,
  MIN_EVIDENCE_HEIGHT,
  MIN_EVIDENCE_WIDTH,
  buildMidlandsEvidencePlan,
  buildEvidenceManifest,
  computeEvidenceManifestFingerprint,
  isMidlandsSyntheticEvidenceFileName,
  validateImportedAsset,
} from "../shared/midlands-precast-evidence.mjs";
import {
  createVerifierFixtureImage,
  evidenceOutputDir,
  importLocalEvidenceBundle,
  readArg,
  resolveSessionsRoot,
  writeVerifierFixtureAssets,
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

const anchor = readArg(process.argv, "--anchor-date") || "2026-07-24";
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
assert(fs.existsSync(path.join(root, "shared/midlands-evidence-specs.mjs")), "evidence specs module exists");
assert(fs.existsSync(path.join(root, "shared/midlands-evidence-legacy.mjs")), "legacy placeholder detector exists");
assert(fs.existsSync(path.join(root, "scripts/export-demo-evidence-prompts.mjs")), "export prompts script exists");
assert(fs.existsSync(path.join(root, "scripts/import-demo-evidence-assets.mjs")), "import assets script exists");
assert(fs.existsSync(path.join(root, "scripts/generate-demo-evidence.mjs")), "generate script exists");
assert(fs.existsSync(path.join(root, "scripts/seed-demo-evidence.mjs")), "seed script exists");

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["export:demo-evidence-prompts"], "export prompts npm script registered");
assert(pkg.scripts["import:demo-evidence-assets"], "import assets npm script registered");
assert(pkg.scripts["generate:demo-evidence"], "generate npm script registered");
assert(pkg.scripts["seed:demo-evidence"], "seed npm script registered");
assert(pkg.scripts["verify:demo-evidence"], "verify npm script registered");

assert(plan1.items.length >= 40 && plan1.items.length <= 50, "image count in target range");
assert(plan1.summary.beforeAfterPairs === 6, "six before/after pairs planned");
assert(plan1.summary.linkedRecords.findings >= 14 && plan1.summary.linkedRecords.findings <= 18, "findings linked");
assert(plan1.summary.linkedRecords.incidents >= 5 && plan1.summary.linkedRecords.incidents <= 7, "incidents linked");
assert(plan1.summary.linkedRecords.ncrs >= 4 && plan1.summary.linkedRecords.ncrs <= 6, "ncrs linked");
assert(plan1.summary.linkedRecords.actions >= 6 && plan1.summary.linkedRecords.actions <= 10, "actions linked");
assert(plan1.summary.maxImagesOnRecord <= MAX_IMAGES_PER_RECORD, "no record exceeds configured image limit");

assert(JSON.stringify(plan1.items.map((item) => item.evidenceId)) === JSON.stringify(plan2.items.map((item) => item.evidenceId)), "deterministic evidence IDs");
assert(
  plan1.items.every((item) => isMidlandsSyntheticEvidenceFileName(item.fileName)),
  "deterministic evidence filenames",
);
assert(new Set(plan1.items.map((item) => item.fileName)).size === plan1.items.length, "unique filenames");
assert(plan1.imageSpecs.length === plan1.items.length, "image specs available for each item");
assert(
  plan1.imageSpecs.every((spec) => spec.prompt && spec.expectedFileName && spec.evidenceId),
  "image specs include prompts and filenames",
);
assert(validateEvidencePlanSemantics(plan1, history).length === 0, "semantic scene-to-record validation passes");

const findingIds = new Set(history.auditFindings.map((row) => row["Finding ID"]));
const incidentIds = new Set(history.incidents.map((row) => row.IncidentId));
const ncrIds = new Set(history.ncrs.map((row) => row["NCR ID"]));
const actionIds = new Set(history.actions.map((row) => row["Action ID"]));
const resultIds = new Set(history.auditResults.map((row) => row["Result ID"]));

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
assert(pairGroups.size === 6, "six pair groups in plan");
assert(
  [...pairGroups.values()].every((group) => group.some((item) => item.pairRole === "before") && group.some((item) => item.pairRole === "after")),
  "before/after pairs complete",
);
assert(
  new Set([...pairGroups.values()].map((group) => `${group[0].recordType}:${group[0].recordId}`)).size === 6,
  "each before/after pair uses a different parent record",
);
assert(
  [...pairGroups.values()].every((group) => {
    const before = group.find((item) => item.pairRole === "before");
    const after = group.find((item) => item.pairRole === "after");
    return before && after && before.evidenceId !== after.evidenceId;
  }),
  "before/after pair evidence IDs differ",
);

const legacySample = renderLegacyPlaceholderForItem(plan1.items[0]);
assert(isLegacyPlaceholderEvidenceBuffer(legacySample, plan1.items[0]), "legacy placeholder detector catches old renderer output");
const fixture = createVerifierFixtureImage(plan1.items[0]);
assert(!isLegacyPlaceholderEvidenceBuffer(fixture, plan1.items[0]), "verifier fixture is not classified as legacy placeholder");
assert(legacyPlaceholderSha256ForItem(plan1.items[0]) !== computeEvidenceManifestFingerprint({ anchorDate: anchor, files: [] }), "legacy hash helper works");

const sessionsRoot = resolveSessionsRoot(root);
const outputA = path.join(sessionsRoot, "demo-environment-evidence", `${anchor}-verify-a`);
const outputB = path.join(sessionsRoot, "demo-environment-evidence", `${anchor}-verify-b`);
const assetsA = path.join(outputA, "assets");
const assetsB = path.join(outputB, "assets");
fs.rmSync(outputA, { recursive: true, force: true });
fs.rmSync(outputB, { recursive: true, force: true });
writeVerifierFixtureAssets({ plan: plan1, assetsDir: assetsA });
writeVerifierFixtureAssets({ plan: plan2, assetsDir: assetsB });

const bundleA = importLocalEvidenceBundle({ plan: plan1, assetsDir: assetsA, outputDir: outputA });
const bundleB = importLocalEvidenceBundle({ plan: plan2, assetsDir: assetsB, outputDir: outputB });

assert(
  [...pairGroups.values()].every((group) => {
    const before = bundleA.rendered.find((file) => file.evidenceId === group.find((item) => item.pairRole === "before")?.evidenceId);
    const after = bundleA.rendered.find((file) => file.evidenceId === group.find((item) => item.pairRole === "after")?.evidenceId);
    return before && after && before.sha256 !== after.sha256;
  }),
  "before/after pair file hashes differ",
);

assert(bundleA.manifest.fingerprint === bundleB.manifest.fingerprint, "identical manifest fingerprint across runs");
assert(
  bundleA.rendered.every((file, index) => file.sha256 === bundleB.rendered[index]?.sha256),
  "identical file hashes across runs",
);
assert(bundleA.rendered.every((file) => file.size >= 12_000), "non-trivial file sizes");
assert(
  bundleA.rendered.every((file) => file.width >= MIN_EVIDENCE_WIDTH && file.height >= MIN_EVIDENCE_HEIGHT),
  "imported images meet minimum dimensions",
);
assert(
  bundleA.rendered.every((file) => file.mimeType === "image/png" || file.mimeType === "image/jpeg"),
  "png or jpeg output type",
);
assert(
  bundleA.rendered.every((file) => !isLegacyPlaceholderEvidenceBuffer(file.buffer, plan1.items.find((item) => item.evidenceId === file.evidenceId))),
  "no legacy procedural placeholder fingerprints in imported bundle",
);

const manifestText = JSON.stringify(bundleA.manifest);
assert(!manifestText.includes(DOVECOTE_COMPANY_NAME), "manifest does not reference Dovecote");
assert(!manifestText.match(/@usebert\.co\.uk/), "manifest avoids real demo emails");
assert(!manifestText.match(/https?:\/\//), "manifest has no external URLs");
assert(read("shared/midlands-precast-evidence.mjs").includes("validateEvidencePlanSemantics"), "evidence plan enforces semantic validation");
assert(!read("shared/midlands-precast-evidence.mjs").includes("renderSyntheticEvidencePng"), "production evidence module no longer renders placeholders");
assert(fs.existsSync(path.join(root, "shared/midlands-evidence-scene-resolver.mjs")), "semantic scene resolver exists");
assert(!read("scripts/generate-demo-evidence.mjs").includes("renderEvidencePlanItem"), "generate script no longer renders placeholders");
assert(read("scripts/seed-demo-evidence.mjs").includes("assertDemoCompanyAllowed"), "live mode guarded");
assert(read("scripts/seed-demo-evidence.mjs").includes("uploadAuditEvidenceToDrive"), "uses audit evidence upload pathway");
assert(read("scripts/seed-demo-evidence.mjs").includes("uploadIncidentEvidenceToDrive"), "uses incident evidence upload pathway");
assert(read("scripts/seed-demo-evidence.mjs").includes("priorBySha"), "hash-based idempotency retained");
assert(read("scripts/generate-demo-evidence.mjs").includes("imported-generation"), "generate uses imported asset pipeline");
assert(read(".gitignore").includes("demo-environment-evidence-report.json"), "evidence report gitignored");

const stableFingerprint = computeEvidenceManifestFingerprint(buildEvidenceManifest(plan1, bundleA.rendered));
assert(stableFingerprint === bundleA.manifest.fingerprint, "fingerprint helper stable");

const rejected = validateImportedAsset(legacySample, plan1.items[0]);
assert(!rejected.ok, "import validator rejects legacy placeholder output");

console.log(`\nverify:demo-evidence passed (${checks} checks).`);
console.log(`Fingerprint (${anchor}): ${bundleA.manifest.fingerprint}`);
console.log(`Images: ${bundleA.manifest.summary.imageCount} (Rugby ${bundleA.manifest.summary.bySite.rugby}, Coventry ${bundleA.manifest.summary.bySite.coventry})`);
console.log(`Pair parents: ${Object.values(bundleA.manifest.pairAssignments).map((pair) => `${pair.recordType}:${pair.recordId}`).join(", ")}`);
