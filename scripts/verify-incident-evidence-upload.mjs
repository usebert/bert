#!/usr/bin/env node
/**
 * Incident evidence upload — Drive path, workbook metadata, and submit wiring.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INCIDENT_EVIDENCE_DRIVE_PATH_PREFIX,
  buildIncidentEvidenceFileName,
  sanitizeEvidenceUrlsForWorkbook,
  uploadIncidentEvidenceToDrive,
} from "../server/incident-evidence-upload.mjs";
import { buildIncidentRow } from "../server/incidents-service.mjs";

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
const uploadModule = read("server/incident-evidence-upload.mjs");
const incidentsService = read("server/incidents-service.mjs");
const folderStructure = read("server/company-folder-structure.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");
const incidentsClient = read("src/services/incidentsService.ts");
const appTsx = read("App.tsx");
const screen = read("src/screens/IncidentReportingScreen.tsx");

assert(pkg.scripts["verify:incident-evidence-upload"], "PKG: npm script registered");

assert(
  INCIDENT_EVIDENCE_DRIVE_PATH_PREFIX === "03 - Evidence/Photos/Incidents",
  "PATH: incident evidence prefix",
);
assert(folderStructure.includes('await ensureNamedFolder(drive, "Incidents", photosId)'), "PATH: Incidents folder under Photos");
assert(uploadModule.includes("ensureIncidentEvidenceFolderId"), "PATH: uses ensureIncidentEvidenceFolderId");
assert(incidentsService.includes("uploadIncidentEvidenceToDrive"), "SERVER: incident submit uploads evidence");
assert(incidentsService.includes("normalizeEvidenceUploadFile"), "SERVER: normalises serialisable evidence payloads");
assert(uploadModule.includes("evidence_upload_file_start"), "SERVER: logs per-file upload start");
assert(uploadModule.includes("evidence_upload_file_success"), "SERVER: logs per-file upload success");
assert(
  coreRoutes.includes('app.post("/api/companies/:companyFolderId/incidents/:incidentId/evidence"'),
  "API: incident evidence upload route",
);

assert(
  buildIncidentEvidenceFileName("INC-2026-0001", 0, "photo.jpg", "image/jpeg") === "INC-2026-0001-photo-1.jpg",
  "NAME: safe incident photo filename",
);

const sanitized = sanitizeEvidenceUrlsForWorkbook([
  {
    id: "e1",
    name: "INC-2026-0001-photo-1.jpg",
    mimeType: "image/jpeg",
    previewUrl: "data:image/jpeg;base64,abc",
    driveLink: "https://drive.google.com/file/d/abc/view",
    driveFileId: "abc",
    addedAt: "2026-04-19T09:30:00.000Z",
  },
]);
assert(sanitized.length === 1, "WORKBOOK: data URL stripped from saved evidence");
assert(!sanitized[0].previewUrl.startsWith("data:"), "WORKBOOK: previewUrl is Drive link only");
assert(sanitized[0].driveFileId === "abc", "WORKBOOK: driveFileId preserved");

const row = buildIncidentRow({
  incidentId: "INC-2026-0002",
  incidentType: "Near Miss",
  severity: "Minor",
  incidentDate: "2026-04-19",
  reporterName: "Alex",
  department: "Ops",
  location: "Yard",
  description: "Test",
  evidenceUrls: sanitized,
});
assert(!row.EvidenceUrls.includes("base64"), "WORKBOOK: EvidenceUrls JSON has no base64");
assert(row.EvidenceUrls.includes("drive.google.com"), "WORKBOOK: EvidenceUrls contains Drive link");

const emptyUpload = await uploadIncidentEvidenceToDrive({}, { google: null }, {
  companyFolderId: "folder-1",
  incidentId: "INC-2026-0003",
  files: [],
});
assert(emptyUpload.ok && emptyUpload.evidenceUrls.length === 0, "SUBMIT: no evidence upload allowed");

assert(appTsx.includes("prepareSerializableEvidenceUploadFiles"), "APP: serialises evidence before workbook save");
assert(appTsx.includes("Incident saved, but evidence upload failed"), "APP: evidence upload failure shows warning");
assert(incidentsClient.includes("prepareSerializableEvidenceUploadFiles"), "CLIENT: strips non-serialisable File payloads");
assert(incidentsClient.includes("pickEvidenceUrls"), "CLIENT: parses evidenceUrls arrays from API");
assert(screen.includes("evidenceUploadData"), "UI: stores dataUrl when file is selected");
assert(screen.includes("evidenceUploadFiles"), "UI: submits serialisable evidence payloads");
assert(appTsx.includes("Uploading evidence"), "UI: shows uploading evidence phase");

console.log(`PASS: verify-incident-evidence-upload (${caseCount} checks)`);
