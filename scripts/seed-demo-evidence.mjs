#!/usr/bin/env node
/**
 * Seed Midlands synthetic evidence (dry-run default).
 *
 * Usage:
 *   DEMO_COMPANY_SEED_CONFIRM=yes BERT_DEMO_DEFAULT_PASSWORD='...' npm run seed:demo-evidence -- --anchor-date=2026-07-24
 *   ... npm run seed:demo-evidence -- --live --anchor-date=2026-07-24
 *   ... npm run seed:demo-evidence -- --live-preflight --anchor-date=2026-07-24
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEMO_COMPANY_FOLDER_ENV,
  DEMO_COMPANY_SEED_CONFIRM_ENV,
  DEMO_COMPANY_SPREADSHEET_ENV,
  MIDLANDS_DEMO_COMPANY_NAME,
  assertDemoCompanyAllowed,
  isDemoEnvironmentEnabled,
  readDemoCompanyFolderId,
  readDemoCompanySpreadsheetId,
} from "../shared/demo-environment.mjs";
import {
  buildWorkbookEvidencePatches,
  MIDLANDS_EVIDENCE_REPORT_FILE,
  preflightLiveEvidenceUpload,
} from "../shared/midlands-precast-evidence.mjs";
import { uploadAuditEvidenceToDrive } from "../server/audit-evidence-upload.mjs";
import { uploadIncidentEvidenceToDrive } from "../server/incident-evidence-upload.mjs";
import { AUDIT_RESULTS_TAB_COLUMNS } from "../server/completion-service.mjs";
import { NCR_TAB_COLUMNS } from "../shared/ncr.mjs";
import { INCIDENTS_TAB, INCIDENTS_TAB_COLUMNS } from "../server/incidents-service.mjs";
import {
  buildEvidencePlanFromHistory,
  evidenceAssetsDir,
  loadImportedEvidenceBundle,
  loadMidlandsHistoryForEvidence,
  readArg,
  resolveSessionsRoot,
} from "./lib/demo-evidence-script-utils.mjs";
import {
  applyPriorUploadReuse,
  assertPreflightOrExit,
  discoverDriveUploadsForReuse,
  loadPriorUploadManifest,
  printPreflightSummary,
  writeLiveUploadManifest,
} from "./lib/demo-evidence-live-upload.mjs";
import {
  buildWorkbookDeps,
  ensureWorkbookTabs,
  loadGoogleAuth,
  writeMergedTab,
} from "./lib/demo-environment-script-utils.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const confirm = String(process.env[DEMO_COMPANY_SEED_CONFIRM_ENV] || "").trim().toLowerCase();
if (confirm !== "yes") {
  console.error(`ERROR: Set ${DEMO_COMPANY_SEED_CONFIRM_ENV}=yes to seed Midlands demo evidence.`);
  process.exit(1);
}

const live = process.argv.includes("--live");
const livePreflight = process.argv.includes("--live-preflight");
const cleanup = process.argv.includes("--cleanup-demo-evidence");
if (live && process.argv.includes("--dry-run")) {
  console.error("ERROR: Use either --live or --dry-run, not both.");
  process.exit(1);
}
if (live && livePreflight) {
  console.error("ERROR: Use either --live or --live-preflight, not both.");
  process.exit(1);
}

const password = String(process.env.BERT_DEMO_DEFAULT_PASSWORD || "").trim();
if (!password || password.length < 12) {
  console.error("ERROR: Set BERT_DEMO_DEFAULT_PASSWORD (>= 12 chars).");
  process.exit(1);
}

const anchorDate = readArg(process.argv, "--anchor-date") || "2026-07-24";
const companyFolderId = readDemoCompanyFolderId();
const masterSheetId = readDemoCompanySpreadsheetId();

const guard = assertDemoCompanyAllowed({
  companyName: MIDLANDS_DEMO_COMPANY_NAME,
  companyFolderId,
  masterSheetId,
  requireWorkspaceIds: live || livePreflight,
  requireSpreadsheet: live || livePreflight,
});
if (!guard.ok) {
  console.error(`ERROR: ${guard.error}`);
  process.exit(1);
}

if ((live || livePreflight) && !isDemoEnvironmentEnabled()) {
  console.error("ERROR: --live requires DEMO_ENVIRONMENT_ENABLED=true");
  process.exit(1);
}

if (cleanup) {
  console.error("ERROR: --cleanup-demo-evidence is not enabled in this phase. Use manual Drive review if required.");
  process.exit(1);
}

const sessionsRoot = resolveSessionsRoot(root);
const outputDir = path.join(sessionsRoot, "demo-environment-evidence", anchorDate);
const assetsDir = evidenceAssetsDir(sessionsRoot, anchorDate);

const history = await loadMidlandsHistoryForEvidence({
  root,
  anchorDate,
  companyFolderId: companyFolderId || `demo-folder-midlands-precast-concrete-ltd`,
  masterSheetId: masterSheetId || `demo-workbook-midlands-precast-concrete-ltd`,
  password,
});

const plan = buildEvidencePlanFromHistory(history);
const priorManifestPath = path.join(outputDir, "manifest.live.json");
const priorState = loadPriorUploadManifest(priorManifestPath);
const priorBySha = priorState.bySha;

let bundle;
try {
  bundle = loadImportedEvidenceBundle({ plan, sessionsRoot, anchorDate });
} catch (error) {
  console.error(error?.message || error);
  console.error(`\nExpected imported assets in: ${assetsDir}`);
  console.error("Run export -> external generation -> import before seeding evidence.");
  process.exit(1);
}
const { rendered, manifest } = bundle;

const preflight = preflightLiveEvidenceUpload({ history, rendered });
if (livePreflight) {
  printPreflightSummary(preflight, { label: "live-preflight" });
  process.exit(preflight.ok ? 0 : 1);
}

let mode = "local-manifest";
let liveApplied = false;
let liveNote = "";
const uploaded = new Map();

if (live) {
  if (!companyFolderId || !masterSheetId) {
    console.error(`ERROR: --live requires ${DEMO_COMPANY_FOLDER_ENV} and ${DEMO_COMPANY_SPREADSHEET_ENV}`);
    process.exit(1);
  }

  assertPreflightOrExit(preflight);

  try {
    const auth = loadGoogleAuth(sessionsRoot);
    const deps = buildWorkbookDeps();
    await ensureWorkbookTabs(auth, deps, masterSheetId);

    const { auditGroups, incidentGroups } = preflight;
    const discovered = await discoverDriveUploadsForReuse(auth, deps, {
      companyFolderId,
      masterSheetId,
      auditGroups,
      incidentGroups,
    });
    if (discovered.size > 0) {
      console.log(`[live] reusing ${discovered.size} file(s) discovered on Drive`);
    }

    for (const [resultId, files] of auditGroups.entries()) {
      const toUpload = [];
      for (const file of files) {
        if (applyPriorUploadReuse(file, priorBySha, uploaded, discovered)) {
          continue;
        }
        toUpload.push({
          evidenceId: file.evidenceId,
          questionId: file.questionId,
          name: file.fileName,
          mimeType: file.mimeType,
          dataUrl: file.dataUrl,
          addedAt: `${anchorDate}T10:00:00.000Z`,
        });
      }
      if (!toUpload.length) {
        writeLiveUploadManifest(priorManifestPath, manifest, uploaded);
        continue;
      }
      const result = await uploadAuditEvidenceToDrive(auth, deps, {
        companyFolderId,
        masterSheetId,
        resultId,
        files: toUpload,
      });
      if (!result.ok) {
        writeLiveUploadManifest(priorManifestPath, manifest, uploaded);
        throw new Error(result.error || "Audit evidence upload failed.");
      }
      for (const ref of result.evidenceRefs || []) {
        uploaded.set(ref.evidenceId, {
          driveFileId: ref.driveFileId,
          driveLink: ref.driveLink,
          fileName: ref.name,
        });
      }
      writeLiveUploadManifest(priorManifestPath, manifest, uploaded);
      console.log(`[live] audit evidence saved for ${resultId} (${toUpload.length} uploaded, group total ${files.length})`);
    }

    for (const [incidentId, files] of incidentGroups.entries()) {
      const toUpload = [];
      for (const file of files) {
        if (applyPriorUploadReuse(file, priorBySha, uploaded, discovered)) {
          continue;
        }
        toUpload.push({
          id: file.evidenceId,
          name: file.fileName,
          mimeType: file.mimeType,
          dataUrl: file.dataUrl,
          addedAt: `${anchorDate}T10:00:00.000Z`,
        });
      }
      if (!toUpload.length) {
        writeLiveUploadManifest(priorManifestPath, manifest, uploaded);
        continue;
      }
      const result = await uploadIncidentEvidenceToDrive(auth, deps, {
        companyFolderId,
        masterSheetId,
        incidentId,
        files: toUpload,
      });
      if (!result.ok) {
        writeLiveUploadManifest(priorManifestPath, manifest, uploaded);
        throw new Error(result.error || "Incident evidence upload failed.");
      }
      for (const ref of result.evidenceUrls || []) {
        uploaded.set(ref.id, {
          driveFileId: ref.driveFileId,
          driveLink: ref.driveLink || ref.previewUrl,
          fileName: ref.name,
        });
      }
      writeLiveUploadManifest(priorManifestPath, manifest, uploaded);
      console.log(`[live] incident evidence saved for ${incidentId} (${toUpload.length} uploaded, group total ${files.length})`);
    }

    const patches = buildWorkbookEvidencePatches(history, plan, uploaded);
    const AUDIT_FINDINGS_COLUMNS = [
      "Finding ID",
      "Local Submission ID",
      "Result ID",
      "Audit ID",
      "Area ID",
      "Company ID",
      "Question ID",
      "Question Text",
      "Answer",
      "Risk Level",
      "Risk Category",
      "Auto Action Required",
      "Requires Photo Evidence",
      "Requires Manager Review",
      "Note",
      "Local Evidence Refs",
      "Created At",
      "Updated At",
      "Created By",
      "Updated By",
      "Sync Status",
      "Sync Attempts",
      "Last Sync Error",
      "Remote Row ID",
      "Schema Version",
    ];
    const ACTIONS_COLUMNS = [
      "Action ID",
      "Company ID",
      "Source Audit ID",
      "Source Audit Name",
      "Source Question ID",
      "Source Question Text",
      "Source Answer",
      "Non Conformance ID",
      "Severity",
      "Status",
      "Assigned To User ID",
      "Assigned To Name",
      "Created By User ID",
      "Created At",
      "Updated At",
      "Due Date",
      "Closed At",
      "Verified By User ID",
      "Verification Notes",
      "Evidence Links",
      "Local Evidence Refs",
      "Comments",
      "Recurrence Flag",
      "Root Cause",
      "Corrective Action",
      "Preventive Action",
      "Risk Category",
      "Requires Manager Review",
      "Suggestion JSON",
      "Sync Status",
      "Sync Attempts",
      "Last Sync Error",
      "Remote Row ID",
      "Schema Version",
      "Archived",
      "ArchivedAt",
      "ArchivedBy",
      "ArchiveReason",
    ];

    const writes = [
      ["AuditResults", AUDIT_RESULTS_TAB_COLUMNS, patches.auditResults, ["Result ID"]],
      ["AuditFindings", AUDIT_FINDINGS_COLUMNS, patches.auditFindings, ["Finding ID"]],
      ["Actions", ACTIONS_COLUMNS, patches.actions, ["Action ID"]],
      ["NCRs", NCR_TAB_COLUMNS, patches.ncrs, ["NCR ID"]],
      [INCIDENTS_TAB, INCIDENTS_TAB_COLUMNS, patches.incidents, ["IncidentId"]],
    ];
    for (const [tab, columns, rows, keys] of writes) {
      if (!rows.length) continue;
      await writeMergedTab(auth, deps, masterSheetId, tab, columns, rows, keys);
      console.log(`[live] upserted ${rows.length} evidence-linked rows into ${tab}`);
    }

    liveApplied = true;
    mode = "live-drive-workbook";
    liveNote = "Evidence uploaded and workbook rows patched.";
    writeLiveUploadManifest(priorManifestPath, manifest, uploaded);
  } catch (error) {
    liveNote = `Live apply failed: ${error instanceof Error ? error.message : String(error)}`;
    mode = "local-manifest-live-failed";
    console.error("WARNING:", error?.stack || error);
  }
}

const report = {
  companyName: MIDLANDS_DEMO_COMPANY_NAME,
  mode,
  liveApplied,
  liveNote,
  anchorDate,
  outputDir,
  fingerprint: manifest.fingerprint,
  summary: manifest.summary,
  linkage: manifest.linkage,
  uploadedCount: uploaded.size,
  preflight: preflight.counts,
  generatedAt: new Date().toISOString(),
};

const reportPath = path.join(root, MIDLANDS_EVIDENCE_REPORT_FILE);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log("\nMidlands demo evidence seed complete");
console.log(`  Anchor date: ${anchorDate}`);
console.log(`  Mode: ${mode}`);
console.log(`  Fingerprint: ${manifest.fingerprint}`);
console.log(`  Images: ${manifest.summary.imageCount}`);
console.log(`  Output: ${outputDir}`);
console.log(`  Report: ${reportPath}`);
if (liveNote) console.log(`  Note: ${liveNote}`);
