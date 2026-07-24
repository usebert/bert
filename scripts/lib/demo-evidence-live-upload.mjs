/**
 * Live Midlands demo evidence upload — preflight grouping, idempotent manifest, Drive reuse.
 */
import fs from "node:fs";
import path from "node:path";
import { buildAuditEvidenceFileName } from "../../server/audit-evidence-upload.mjs";
import { buildIncidentEvidenceFileName } from "../../server/incident-evidence-upload.mjs";
import {
  ensureAuditEvidenceFolderId,
  ensureCompanyFolderStructure,
  ensureIncidentEvidenceFolderId,
} from "../../server/company-folder-structure.mjs";
import {
  enrichEvidenceRenderedFile,
  resolveAuditUploadParentId,
  resolveIncidentParentId,
  resolveLiveAuditUploadParentId,
} from "../../shared/midlands-precast-evidence.mjs";

export function loadPriorUploadManifest(manifestPath) {
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    return { files: [], bySha: new Map(), byEvidenceId: new Map() };
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const bySha = new Map();
  const byEvidenceId = new Map();
  for (const file of files) {
    if (file.sha256) bySha.set(file.sha256, file);
    if (file.evidenceId) byEvidenceId.set(file.evidenceId, file);
  }
  return { manifest, files, bySha, byEvidenceId };
}

export function writeLiveUploadManifest(manifestPath, manifest, uploaded = new Map()) {
  const next = {
    ...manifest,
    liveUploadUpdatedAt: new Date().toISOString(),
    files: (manifest.files || []).map((file) => {
      const upload = uploaded.get(file.evidenceId) || {};
      return {
        ...file,
        driveFileId: upload.driveFileId || file.driveFileId || "",
        driveLink: upload.driveLink || file.driveLink || "",
        uploadSkipped: Boolean(upload.skipped),
      };
    }),
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function buildFolderStructureDeps(deps = {}) {
  return {
    google: deps.google,
    ensureTabExists: deps.ensureTabExists,
    ensureColumns: deps.ensureColumns,
    getWorkbook: deps.getWorkbook,
    getTabValues: deps.getTabValues,
    withSheetsQuotaRetry: deps.withSheetsQuotaRetry,
    safeLower: deps.safeLower,
  };
}

async function listDriveFilesByName(drive, folderId) {
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id,name,webViewLink,md5Checksum)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 200,
  });
  const byName = new Map();
  for (const file of response.data.files || []) {
    const name = String(file.name || "").trim();
    if (name) byName.set(name, file);
  }
  return byName;
}

export async function discoverDriveUploadsForReuse(auth, deps, input = {}) {
  const companyFolderId = String(input.companyFolderId || "").trim();
  const masterSheetId = String(input.masterSheetId || "").trim();
  const auditGroups = input.auditGroups || new Map();
  const incidentGroups = input.incidentGroups || new Map();
  const discovered = new Map();

  if (!companyFolderId || !deps?.google) {
    return discovered;
  }

  const structure = await ensureCompanyFolderStructure(buildFolderStructureDeps(deps), auth, {
    companyRootFolderId: companyFolderId,
    masterSheetId,
    syncWorkbookTab: false,
    placeFiles: false,
  });
  const photosFolderId = structure.folderIds.EVIDENCE_PHOTOS;
  if (!photosFolderId) {
    return discovered;
  }

  const drive = deps.google.drive({ version: "v3", auth });

  for (const [resultId, files] of auditGroups.entries()) {
    if (!resultId || !files.length) continue;
    const ensured = await ensureAuditEvidenceFolderId(drive, photosFolderId, resultId);
    const byName = await listDriveFilesByName(drive, ensured.folderId);
    files.forEach((file, index) => {
      const expectedName =
        buildAuditEvidenceFileName(resultId, index, file.fileName, file.mimeType) || file.fileName;
      const match = byName.get(expectedName) || byName.get(file.fileName);
      if (match?.id) {
        discovered.set(file.evidenceId, {
          driveFileId: match.id,
          driveLink: match.webViewLink || "",
          fileName: match.name,
          skipped: true,
          source: "drive-discovery",
        });
      }
    });
  }

  for (const [incidentId, files] of incidentGroups.entries()) {
    if (!incidentId || !files.length) continue;
    const ensured = await ensureIncidentEvidenceFolderId(drive, photosFolderId, incidentId);
    const byName = await listDriveFilesByName(drive, ensured.folderId);
    files.forEach((file, index) => {
      const expectedName =
        buildIncidentEvidenceFileName(incidentId, index, file.fileName, file.mimeType) || file.fileName;
      const match = byName.get(expectedName) || byName.get(file.fileName);
      if (match?.id) {
        discovered.set(file.evidenceId, {
          driveFileId: match.id,
          driveLink: match.webViewLink || "",
          fileName: match.name,
          skipped: true,
          source: "drive-discovery",
        });
      }
    });
  }

  return discovered;
}

export function applyPriorUploadReuse(file, priorBySha, uploaded, discovered = new Map()) {
  const prior = priorBySha.get(file.sha256);
  if (prior?.driveFileId) {
    uploaded.set(file.evidenceId, {
      driveFileId: prior.driveFileId,
      driveLink: prior.driveLink || "",
      fileName: prior.fileName || file.fileName,
      skipped: true,
      source: "manifest-sha256",
    });
    return true;
  }
  const driveHit = discovered.get(file.evidenceId);
  if (driveHit?.driveFileId) {
    uploaded.set(file.evidenceId, driveHit);
    return true;
  }
  return false;
}

export function printPreflightSummary(preflight, { label = "live-preflight" } = {}) {
  console.log(`\n[${label}] total images: ${preflight.counts.totalImages}`);
  console.log(`[${label}] audit parents: ${preflight.counts.auditParentCount} (${preflight.counts.auditImages} images)`);
  console.log(`[${label}] incident parents: ${preflight.counts.incidentParentCount} (${preflight.counts.incidentImages} images)`);
  console.log(`[${label}] audit groups:`, preflight.counts.byAuditParent);
  console.log(`[${label}] incident groups:`, preflight.counts.byIncidentParent);
  if (!preflight.ok) {
    console.error(`[${label}] FAILED (${preflight.errors.length} issues):`);
    for (const error of preflight.errors) {
      console.error(`  - ${error}`);
    }
  } else {
    console.log(`[${label}] OK — all parent IDs resolved`);
  }
}

export function assertPreflightOrExit(preflight) {
  printPreflightSummary(preflight);
  if (!preflight.ok) {
    process.exit(1);
  }
}

export function resolveGroupedParentId(file) {
  const enriched = enrichEvidenceRenderedFile(file);
  if (enriched.recordType === "incident") {
    return resolveIncidentParentId(enriched);
  }
  return resolveLiveAuditUploadParentId(enriched);
}
