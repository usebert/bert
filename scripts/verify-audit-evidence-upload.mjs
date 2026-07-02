#!/usr/bin/env node
/**
 * Audit/check evidence upload — Drive path, workbook metadata, and submit wiring.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUDIT_EVIDENCE_DRIVE_PATH_PREFIX,
  buildAuditEvidenceFileName,
  sanitizeAuditEvidenceRefsForWorkbook,
  uploadAuditEvidenceToDrive,
} from "../server/audit-evidence-upload.mjs";
import { buildAuditResultRow } from "../server/completion-service.mjs";
import { INCIDENT_EVIDENCE_DRIVE_PATH_PREFIX } from "../server/incident-evidence-upload.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;

function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const pkg = JSON.parse(read("package.json"));
const uploadModule = read("server/audit-evidence-upload.mjs");
const completionService = read("server/completion-service.mjs");
const folderStructure = read("server/company-folder-structure.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");
const checkClient = read("src/services/checkService.ts");
const checkEvidenceClient = read("src/services/checkEvidenceService.ts");
const appTsx = read("App.tsx");
const incidentUpload = read("server/incident-evidence-upload.mjs");

assert(pkg.scripts["verify:audit-evidence-upload"], "PKG: npm script registered");

assert(
  AUDIT_EVIDENCE_DRIVE_PATH_PREFIX === "03 - Evidence/Photos/Audits",
  "PATH: audit evidence prefix",
);
assert(folderStructure.includes('await ensureNamedFolder(drive, "Audits", photosId)'), "PATH: Audits folder under Photos");
assert(uploadModule.includes("ensureAuditEvidenceFolderId"), "PATH: uses ensureAuditEvidenceFolderId");
assert(completionService.includes("uploadAuditEvidenceToDrive"), "SERVER: check completion uploads evidence");
assert(completionService.includes("normalizeAuditEvidenceUploadFile"), "SERVER: normalises serialisable evidence payloads");
assert(uploadModule.includes("audit_evidence_upload_start"), "SERVER: logs audit evidence upload start");
assert(uploadModule.includes("audit_evidence_folder_ready"), "SERVER: logs audit evidence folder ready");
assert(uploadModule.includes("audit_evidence_file_start"), "SERVER: logs per-file upload start");
assert(uploadModule.includes("audit_evidence_file_success"), "SERVER: logs per-file upload success");
assert(completionService.includes("audit_evidence_upload_skipped"), "SERVER: warns when evidence refs lack files");
assert(coreRoutes.includes("evidenceFiles: req.body?.evidenceFiles"), "API: check complete accepts evidenceFiles");
assert(coreRoutes.includes("evidenceUploadWarning: result.evidenceUploadWarning"), "API: returns evidence upload warning");

assert(
  INCIDENT_EVIDENCE_DRIVE_PATH_PREFIX === "03 - Evidence/Photos/Incidents",
  "PATH: incident evidence prefix unchanged",
);
assert(incidentUpload.includes("ensureIncidentEvidenceFolderId"), "PATH: incident helper unchanged");

assert(
  buildAuditEvidenceFileName("result-abc", 0, "photo.jpg", "image/jpeg") === "result-abc-photo-1.jpg",
  "NAME: safe audit photo filename",
);

const sanitized = sanitizeAuditEvidenceRefsForWorkbook([
  {
    questionId: "q1",
    evidenceId: "e1",
    name: "result-abc-photo-1.jpg",
    mimeType: "image/jpeg",
    driveLink: "https://drive.google.com/file/d/abc/view",
    driveFileId: "abc",
    addedAt: "2026-04-19T09:30:00.000Z",
    dataUrl: "data:image/jpeg;base64,abc",
  },
]);
assert(sanitized.length === 1, "WORKBOOK: evidence ref sanitised");
assert(!JSON.stringify(sanitized).includes("base64"), "WORKBOOK: no base64 in evidence refs");
assert(sanitized[0].driveFileId === "abc", "WORKBOOK: driveFileId preserved");
assert(sanitized[0].driveLink.includes("drive.google.com"), "WORKBOOK: driveLink preserved");
assert(sanitized[0].questionId === "q1", "WORKBOOK: questionId preserved");

const row = buildAuditResultRow({
  resultId: "result-xyz",
  scheduleId: "sched-1",
  companyFolderId: "folder-1",
  companyId: "folder-1",
  auditId: "audit-1",
  auditName: "Daily check",
  evidenceRefs: sanitized,
});
assert(!row["Evidence Refs"].includes("base64"), "WORKBOOK: Evidence Refs JSON has no base64");
assert(row["Evidence Refs"].includes("drive.google.com"), "WORKBOOK: Evidence Refs contains Drive link");
assert(row["Evidence Refs"].includes("questionId"), "WORKBOOK: Evidence Refs keeps question linkage");

const emptyUpload = await uploadAuditEvidenceToDrive({}, { google: null }, {
  companyFolderId: "folder-1",
  resultId: "result-empty",
  files: [],
});
assert(emptyUpload.ok && emptyUpload.evidenceRefs.length === 0, "SUBMIT: no evidence upload allowed");

const noEvidenceRow = buildAuditResultRow({
  resultId: "result-no-evidence",
  scheduleId: "sched-2",
  companyFolderId: "folder-1",
  companyId: "folder-1",
  auditId: "audit-2",
  auditName: "Weekly check",
  evidenceRefs: [],
});
assert(noEvidenceRow["Evidence Refs"] === "[]", "SUBMIT: completion works with no evidence");

assert(appTsx.includes("prepareSerializableAuditEvidenceFiles"), "APP: serialises audit evidence before submit");
assert(appTsx.includes("audit_evidence_selected"), "APP: logs audit evidence selection");
assert(appTsx.includes("audit_complete_submit"), "APP: logs audit complete submit payload");
assert(appTsx.includes("buildAuditEvidenceUploadPayload"), "APP: submit-time evidence payload fallback");
assert(checkEvidenceClient.includes("buildAuditEvidenceUploadPayload"), "CLIENT: can rebuild serialisable evidence at submit");
assert(appTsx.includes("Check completed, but evidence upload failed"), "APP: evidence upload failure shows warning");
assert(checkClient.includes("evidenceFiles: input.evidenceFiles"), "CLIENT: sends serialisable evidenceFiles in JSON");
assert(!checkClient.includes("new File("), "CLIENT: no raw File objects in check submit");
assert(checkEvidenceClient.includes("prepareSerializableAuditEvidenceFiles"), "CLIENT: strips non-serialisable payloads");

console.log(`PASS: verify-audit-evidence-upload (${caseCount} checks)`);
