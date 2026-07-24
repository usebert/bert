/**
 * Midlands Precast — Phase 3 deterministic evidence plan, import pipeline and linkage.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AUDIT_EVIDENCE_DRIVE_PATH_PREFIX,
  buildAuditEvidenceFileName,
  sanitizeAuditEvidenceRefsForWorkbook,
} from "../server/audit-evidence-upload.mjs";
import {
  INCIDENT_EVIDENCE_DRIVE_PATH_PREFIX,
  buildIncidentEvidenceFileName,
  sanitizeEvidenceUrlsForWorkbook,
} from "../server/incident-evidence-upload.mjs";
import { serializeNcrEvidenceRefs } from "./ncr.mjs";
import {
  anchorSeedNumber,
  createSeededRandom,
  shuffleDeterministic,
} from "./midlands-history-prng.mjs";
import { isLegacyPlaceholderEvidenceBuffer } from "./midlands-evidence-legacy.mjs";
import {
  BEFORE_AFTER_PAIR_DEFINITIONS,
  EVIDENCE_SCENE_CATALOG,
  buildImageSpec,
  sceneByKey,
} from "./midlands-evidence-specs.mjs";
import {
  applyResolvedSceneToItem,
  validateEvidencePlanSemantics,
} from "./midlands-evidence-scene-resolver.mjs";
import { MIDLANDS_SITE_COVENTRY_ID } from "./demo-environment.mjs";

export const MIDLANDS_EVIDENCE_RUNTIME_DIR = ".sessions/demo-environment-evidence";
export const MIDLANDS_EVIDENCE_REPORT_FILE = "demo-environment-evidence-report.json";
export const EVIDENCE_ASSETS_SUBDIR = "assets";
export const EVIDENCE_PROMPT_PACK_SUBDIR = "prompt-pack";

export const TARGET_IMAGE_MIN = 40;
export const TARGET_IMAGE_MAX = 50;
export const MAX_IMAGES_PER_RECORD = 3;
export const MIN_EVIDENCE_WIDTH = 640;
export const MIN_EVIDENCE_HEIGHT = 480;
export const MIN_EVIDENCE_BYTES = 12_000;
export const ACCEPTED_EVIDENCE_EXTENSIONS = [".jpg", ".jpeg", ".png"];

const TARGET_LINKED = {
  finding: { records: 16, images: 18 },
  incident: { records: 6, images: 8 },
  ncr: { records: 5, images: 6 },
  action: { records: 8, images: 10 },
};

export { EVIDENCE_SCENE_CATALOG, BEFORE_AFTER_PAIR_DEFINITIONS };

function recordKey(recordType, recordId) {
  return `${recordType}:${recordId}`;
}

function recordIdForType(record, recordType) {
  if (recordType === "finding") return record["Finding ID"];
  if (recordType === "incident") return record.IncidentId;
  if (recordType === "ncr") return record["NCR ID"];
  if (recordType === "action") return record["Action ID"];
  return "";
}

function recordText(record, recordType) {
  if (recordType === "finding") {
    return `${record.Note || ""} ${record["Question Text"] || ""}`;
  }
  if (recordType === "incident") {
    return `${record.Description || ""} ${record.IncidentType || ""} ${record.Location || ""}`;
  }
  if (recordType === "ncr") {
    return `${record.Title || ""} ${record.Description || ""}`;
  }
  if (recordType === "action") {
    return `${record["Corrective Action"] || ""} ${record.Comments || ""} ${record["Source Audit Name"] || ""}`;
  }
  return "";
}

function areaForRecord(record, recordType) {
  if (recordType === "finding") return record["Area ID"] || "";
  if (recordType === "incident") return record.Location || "";
  if (recordType === "ncr") return record.Site || "";
  if (recordType === "action") return record["Source Audit Name"] || "";
  return "";
}

function buildFileName(evidenceId, ext = "jpg") {
  return `${evidenceId}.${ext}`;
}

function evidenceIdFor(slot) {
  return `midlands-demo-ev-${String(slot).padStart(4, "0")}`;
}

function dimensionsForSlot(slot) {
  const landscape = slot % 3 !== 0;
  const mobile = slot % 4 !== 1;
  if (landscape) {
    return {
      width: mobile ? 1280 : 1440,
      height: mobile ? 720 : 900,
      orientation: "landscape",
      quality: mobile ? "mobile" : "standard",
    };
  }
  return {
    width: mobile ? 720 : 900,
    height: mobile ? 1280 : 1200,
    orientation: "portrait",
    quality: mobile ? "mobile" : "standard",
  };
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function mimeTypeForExtension(ext) {
  const lower = String(ext || "").toLowerCase();
  if (lower === ".png") return "image/png";
  return "image/jpeg";
}

function drivePathForItem(item) {
  if (item.recordType === "incident") {
    return `${INCIDENT_EVIDENCE_DRIVE_PATH_PREFIX}/${item.recordId}`;
  }
  if (item.resultId) {
    return `${AUDIT_EVIDENCE_DRIVE_PATH_PREFIX}/${item.resultId}`;
  }
  return `${AUDIT_EVIDENCE_DRIVE_PATH_PREFIX}/${item.recordId}`;
}

function pickRecordForPair(rng, pairDef, pools, usedParents) {
  const pool = shuffleDeterministic(rng, pools[pairDef.recordType] || []);
  const matched = pool.filter((record) => {
    const id = recordIdForType(record, pairDef.recordType);
    if (!id || usedParents.has(recordKey(pairDef.recordType, id))) return false;
    if (pairDef.matchNote && !pairDef.matchNote.test(recordText(record, pairDef.recordType))) return false;
    return true;
  });
  const candidates = matched.length ? matched : pool.filter((record) => {
    const id = recordIdForType(record, pairDef.recordType);
    return id && !usedParents.has(recordKey(pairDef.recordType, id));
  });
  return candidates[0] || pool[0];
}

function baseFieldsForRecord(record, recordType) {
  const recordId = recordIdForType(record, recordType);
  return {
    recordType,
    recordId,
    findingId: recordType === "finding" ? recordId : "",
    incidentId: recordType === "incident" ? recordId : "",
    ncrId: recordType === "ncr" ? recordId : "",
    actionId: recordType === "action" ? recordId : "",
    resultId: record["Result ID"] || "",
    questionId: record["Question ID"] || record["Source Question ID"] || "",
    auditId: record["Audit ID"] || record["Source Audit ID"] || "",
    area: areaForRecord(record, recordType),
    contextNote: recordText(record, recordType).slice(0, 120),
  };
}

export function buildMidlandsEvidencePlan({ history, anchorDate } = {}) {
  if (!history?.auditFindings?.length) {
    throw new Error("Midlands history payload is required to build an evidence plan.");
  }
  const anchorKey = history.anchorDate || anchorDate;
  const rng = createSeededRandom(anchorSeedNumber(`${anchorKey}|evidence-plan-v2`));

  const pools = {
    finding: shuffleDeterministic(rng, [...history.auditFindings]),
    incident: shuffleDeterministic(
      rng,
      history.incidents.filter((row) => String(row.IncidentId || "").startsWith("midlands-")),
    ),
    ncr: shuffleDeterministic(rng, [...history.ncrs]),
    action: shuffleDeterministic(
      rng,
      history.actions.filter((row) => row.Archived !== "true"),
    ),
  };

  const items = [];
  const usedParents = new Set();
  const imagesPerRecord = new Map();
  let slot = 0;

  function canAdd(recordType, recordId, count = 1) {
    const key = recordKey(recordType, recordId);
    return (imagesPerRecord.get(key) || 0) + count <= MAX_IMAGES_PER_RECORD;
  }

  function track(recordType, recordId, count = 1) {
    const key = recordKey(recordType, recordId);
    imagesPerRecord.set(key, (imagesPerRecord.get(key) || 0) + count);
  }

  function addItem(input, record) {
    if (!canAdd(input.recordType, input.recordId)) {
      return null;
    }
    slot += 1;
    const dims = dimensionsForSlot(slot);
    const evidenceId = evidenceIdFor(slot);
    const item = {
      evidenceId,
      fileName: buildFileName(evidenceId, "jpg"),
      mimeType: "image/jpeg",
      sceneKey: input.sceneKey || "rugby-batching-panel",
      title: input.title || "",
      site: input.site || "rugby",
      category: "rugby",
      variant: input.variant || "single",
      pairId: input.pairId || "",
      pairRole: input.pairRole || "",
      recordType: input.recordType,
      recordId: input.recordId,
      resultId: input.resultId || "",
      questionId: input.questionId || "",
      auditId: input.auditId || "",
      actionId: input.actionId || "",
      findingId: input.findingId || "",
      ncrId: input.ncrId || "",
      incidentId: input.incidentId || "",
      area: input.area || "",
      contextNote: input.contextNote || "",
      anchorDate: anchorKey,
      source: "imported-synthetic-photo",
      ...dims,
      drivePath: "",
      renderSeed: anchorSeedNumber(`${anchorKey}|${evidenceId}`),
    };
    if (record) {
      applyResolvedSceneToItem(item, record);
    } else {
      const scene = sceneByKey(item.sceneKey);
      item.category = scene.category;
      item.site = item.site || scene.site;
    }
    item.drivePath = drivePathForItem(item);
    items.push(item);
    track(input.recordType, input.recordId);
    return item;
  }

  for (const pairDef of BEFORE_AFTER_PAIR_DEFINITIONS) {
    const record = pickRecordForPair(rng, pairDef, pools, usedParents);
    if (!record) continue;
    const base = baseFieldsForRecord(record, pairDef.recordType);
    const parentKey = recordKey(pairDef.recordType, base.recordId);
    if (!canAdd(pairDef.recordType, base.recordId, 2)) continue;
    usedParents.add(parentKey);

    addItem({
      ...base,
      pairId: pairDef.pairId,
      pairRole: "before",
      variant: "before",
    }, record);
    addItem({
      ...base,
      pairId: pairDef.pairId,
      pairRole: "after",
      variant: "after",
    }, record);
  }

  function addSingles(recordType, targetRecords) {
    let recordsAdded = 0;
    for (const record of pools[recordType]) {
      if (recordsAdded >= targetRecords) break;
      const base = baseFieldsForRecord(record, recordType);
      if (usedParents.has(recordKey(recordType, base.recordId))) {
        if ((imagesPerRecord.get(recordKey(recordType, base.recordId)) || 0) >= MAX_IMAGES_PER_RECORD) {
          continue;
        }
      }
      if (!canAdd(recordType, base.recordId)) continue;
      const added = addItem({ ...base }, record);
      if (!added) continue;
      recordsAdded += 1;
      usedParents.add(recordKey(recordType, base.recordId));
    }
    return recordsAdded;
  }

  addSingles("finding", TARGET_LINKED.finding.records);
  addSingles("incident", TARGET_LINKED.incident.records);
  addSingles("ncr", TARGET_LINKED.ncr.records);
  addSingles("action", TARGET_LINKED.action.records);

  while (items.length < TARGET_IMAGE_MIN) {
    const fillerType = ["finding", "incident", "ncr", "action"][items.length % 4];
    const record = pools[fillerType].find((row) => {
      const id = recordIdForType(row, fillerType);
      return id && canAdd(fillerType, id);
    });
    if (!record) break;
    const base = baseFieldsForRecord(record, fillerType);
    addItem({ ...base }, record);
  }

  const finalItems = items.slice(0, TARGET_IMAGE_MAX);
  const semanticErrors = validateEvidencePlanSemantics({ items: finalItems }, history);
  if (semanticErrors.length) {
    throw new Error(`Evidence plan semantic validation failed:\n${semanticErrors.join("\n")}`);
  }
  return {
    anchorDate: anchorKey,
    generatedAt: new Date().toISOString(),
    items: finalItems,
    imageSpecs: finalItems.map((item) => buildImageSpec(item, sceneByKey(item.sceneKey))),
    summary: summarizeEvidencePlan(finalItems),
  };
}

export function summarizeEvidencePlan(items = []) {
  const byCategory = {};
  const bySite = { rugby: 0, coventry: 0 };
  const byRecordType = {};
  const pairIds = new Set(items.filter((item) => item.pairId).map((item) => item.pairId));
  const imagesPerRecord = new Map();
  for (const item of items) {
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
    bySite[item.site] = (bySite[item.site] || 0) + 1;
    byRecordType[item.recordType] = (byRecordType[item.recordType] || 0) + 1;
    const key = recordKey(item.recordType, item.recordId);
    imagesPerRecord.set(key, (imagesPerRecord.get(key) || 0) + 1);
  }
  return {
    imageCount: items.length,
    byCategory,
    bySite,
    byRecordType,
    beforeAfterPairs: pairIds.size,
    linkedRecords: {
      findings: new Set(items.filter((i) => i.recordType === "finding").map((i) => i.recordId)).size,
      incidents: new Set(items.filter((i) => i.recordType === "incident").map((i) => i.recordId)).size,
      ncrs: new Set(items.filter((i) => i.recordType === "ncr").map((i) => i.recordId)).size,
      actions: new Set(items.filter((i) => i.recordType === "action").map((i) => i.recordId)).size,
    },
    maxImagesOnRecord: Math.max(0, ...imagesPerRecord.values()),
    imagesPerRecord: Object.fromEntries(imagesPerRecord),
  };
}

export function resolveImportedAssetPath(assetsDir, item) {
  const candidates = [
    pathJoin(assetsDir, item.fileName),
    ...ACCEPTED_EVIDENCE_EXTENSIONS.map((ext) => pathJoin(assetsDir, `${item.evidenceId}${ext}`)),
  ];
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (existsSync(candidate)) return candidate;
  }
  return "";
}

function pathJoin(...parts) {
  return path.join(...parts);
}

function existsSync(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

export function readImageDimensions(buffer, mimeType) {
  if (mimeType === "image/png" || buffer[0] === 0x89) {
    if (buffer.length < 24) return { width: 0, height: 0 };
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
  }
  return { width: 0, height: 0 };
}

export function validateImportedAsset(buffer, item, { allowLegacy = false } = {}) {
  const errors = [];
  if (!buffer?.length) {
    errors.push(`${item.evidenceId}: empty file`);
    return { ok: false, errors };
  }
  if (buffer.length < MIN_EVIDENCE_BYTES) {
    errors.push(`${item.evidenceId}: file smaller than ${MIN_EVIDENCE_BYTES} bytes`);
  }
  const mimeType =
    buffer[0] === 0x89
      ? "image/png"
      : buffer[0] === 0xff && buffer[1] === 0xd8
        ? "image/jpeg"
        : item.mimeType;
  if (!["image/png", "image/jpeg"].includes(mimeType)) {
    errors.push(`${item.evidenceId}: unsupported image type`);
  }
  const { width, height } = readImageDimensions(buffer, mimeType);
  if (width < MIN_EVIDENCE_WIDTH || height < MIN_EVIDENCE_HEIGHT) {
    errors.push(`${item.evidenceId}: dimensions ${width}x${height} below minimum ${MIN_EVIDENCE_WIDTH}x${MIN_EVIDENCE_HEIGHT}`);
  }
  if (!allowLegacy && isLegacyPlaceholderEvidenceBuffer(buffer, item)) {
    errors.push(`${item.evidenceId}: rejected legacy procedural placeholder output`);
  }
  return {
    ok: errors.length === 0,
    errors,
    mimeType,
    width: width || item.width,
    height: height || item.height,
    size: buffer.length,
    sha256: hashBuffer(buffer),
  };
}

export function importEvidenceAssets({ plan, assetsDir, outputDir }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const rendered = [];
  const errors = [];
  const usedPaths = new Map();

  for (const item of plan.items) {
    const sourcePath = resolveImportedAssetPath(assetsDir, item);
    if (!sourcePath) {
      errors.push(`${item.evidenceId}: missing asset (expected ${item.fileName} or ${item.evidenceId}.jpg/.png)`);
      continue;
    }
    if (usedPaths.has(sourcePath)) {
      errors.push(`${item.evidenceId}: duplicate asset file ${path.basename(sourcePath)}`);
      continue;
    }
    usedPaths.set(sourcePath, item.evidenceId);
    const buffer = fs.readFileSync(sourcePath);
    const validation = validateImportedAsset(buffer, item);
    if (!validation.ok) {
      errors.push(...validation.errors);
      continue;
    }
    const ext = path.extname(sourcePath).toLowerCase() || ".jpg";
    const fileName = `${item.evidenceId}${ext}`;
    const localPath = path.join(outputDir, fileName);
    fs.copyFileSync(sourcePath, localPath);
    rendered.push({
      ...item,
      fileName,
      mimeType: validation.mimeType,
      width: validation.width,
      height: validation.height,
      buffer,
      size: validation.size,
      sha256: validation.sha256,
      localPath,
      dataUrl: `data:${validation.mimeType};base64,${buffer.toString("base64")}`,
    });
  }

  if (errors.length) {
    const error = new Error(`Evidence import failed:\n${errors.join("\n")}`);
    error.details = errors;
    throw error;
  }
  if (rendered.length !== plan.items.length) {
    throw new Error(`Evidence import incomplete: expected ${plan.items.length}, imported ${rendered.length}`);
  }

  const manifest = buildEvidenceManifest(plan, rendered);
  fs.writeFileSync(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { rendered, manifest, outputDir };
}

export function buildEvidenceManifest(plan, renderedFiles = []) {
  const fileById = new Map(renderedFiles.map((file) => [file.evidenceId, file]));
  const files = plan.items.map((item) => {
    const rendered = fileById.get(item.evidenceId) || {};
    return {
      evidenceId: item.evidenceId,
      fileName: rendered.fileName || item.fileName,
      mimeType: rendered.mimeType || item.mimeType,
      size: rendered.size || 0,
      sha256: rendered.sha256 || "",
      width: rendered.width || item.width,
      height: rendered.height || item.height,
      orientation: item.orientation,
      sceneKey: item.sceneKey,
      site: item.site,
      category: item.category,
      variant: item.variant,
      pairId: item.pairId,
      pairRole: item.pairRole,
      recordType: item.recordType,
      recordId: item.recordId,
      resultId: item.resultId,
      questionId: item.questionId,
      drivePath: item.drivePath,
      source: item.source,
      localPath: rendered.localPath || "",
    };
  });
  const payload = {
    anchorDate: plan.anchorDate,
    generatedAt: plan.generatedAt,
    pipeline: "imported-assets-v2",
    summary: summarizeEvidenceManifest(files, plan.summary),
    files,
    linkage: buildLinkageIndex(plan.items),
    pairAssignments: buildPairAssignments(plan.items),
  };
  payload.fingerprint = computeEvidenceManifestFingerprint(payload);
  return payload;
}

function summarizeEvidenceManifest(files, planSummary) {
  return {
    ...planSummary,
    imageCount: files.length,
    uniqueFileNames: new Set(files.map((file) => file.fileName)).size,
    sha256Hashes: files.map((file) => file.sha256).filter(Boolean),
  };
}

export function computeEvidenceManifestFingerprint(manifest) {
  const stable = {
    anchorDate: manifest.anchorDate,
    pipeline: manifest.pipeline || "imported-assets-v2",
    files: (manifest.files || []).map((file) => ({
      evidenceId: file.evidenceId,
      fileName: file.fileName,
      sha256: file.sha256,
      recordType: file.recordType,
      recordId: file.recordId,
      pairId: file.pairId,
      pairRole: file.pairRole,
    })),
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function buildLinkageIndex(items) {
  const grouped = {};
  for (const item of items) {
    const key = `${item.recordType}:${item.recordId}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item.evidenceId);
  }
  return grouped;
}

function buildPairAssignments(items) {
  const pairs = {};
  for (const item of items.filter((entry) => entry.pairId)) {
    if (!pairs[item.pairId]) {
      pairs[item.pairId] = {
        pairId: item.pairId,
        recordType: item.recordType,
        recordId: item.recordId,
        beforeEvidenceId: "",
        afterEvidenceId: "",
      };
    }
    if (item.pairRole === "before") pairs[item.pairId].beforeEvidenceId = item.evidenceId;
    if (item.pairRole === "after") pairs[item.pairId].afterEvidenceId = item.evidenceId;
  }
  return pairs;
}

export function buildWorkbookEvidencePatches(history, plan, uploaded = new Map()) {
  const byResult = new Map();
  const byFinding = new Map();
  const byIncident = new Map();
  const byNcr = new Map();
  const byAction = new Map();

  for (const item of plan.items) {
    const upload = uploaded.get(item.evidenceId) || {};
    const addedAt = history.anchorDate ? `${history.anchorDate}T10:00:00.000Z` : new Date().toISOString();
    if (item.recordType === "incident") {
      const list = byIncident.get(item.incidentId) || [];
      list.push(
        sanitizeEvidenceUrlsForWorkbook([
          {
            id: item.evidenceId,
            name:
              upload.fileName
              || buildIncidentEvidenceFileName(item.incidentId, list.length, item.fileName, item.mimeType),
            mimeType: item.mimeType,
            previewUrl: upload.driveLink || "",
            driveLink: upload.driveLink || "",
            driveFileId: upload.driveFileId || "",
            addedAt,
            source: item.source,
          },
        ])[0],
      );
      byIncident.set(item.incidentId, list);
      continue;
    }

    const auditRef = sanitizeAuditEvidenceRefsForWorkbook([
      {
        questionId: item.questionId || "q-evidence",
        evidenceId: item.evidenceId,
        name:
          upload.fileName
          || buildAuditEvidenceFileName(item.resultId || item.recordId, 0, item.fileName, item.mimeType),
        mimeType: item.mimeType,
        driveLink: upload.driveLink || "",
        driveFileId: upload.driveFileId || "",
        addedAt,
        source: item.source,
      },
    ])[0];

    if (item.resultId) {
      const refs = byResult.get(item.resultId) || [];
      refs.push(auditRef);
      byResult.set(item.resultId, refs);
    }
    if (item.findingId) {
      const refs = byFinding.get(item.findingId) || [];
      refs.push(item.evidenceId);
      byFinding.set(item.findingId, refs);
    }
    if (item.ncrId) {
      const refs = byNcr.get(item.ncrId) || [];
      refs.push(auditRef);
      byNcr.set(item.ncrId, refs);
    }
    if (item.actionId) {
      const refs = byAction.get(item.actionId) || [];
      refs.push({
        evidenceId: item.evidenceId,
        driveLink: upload.driveLink || "",
      });
      byAction.set(item.actionId, refs);
    }
  }

  return {
    auditResults: history.auditResults
      .map((row) => {
        const refs = byResult.get(row["Result ID"]);
        if (!refs?.length) return null;
        return {
          ...row,
          "Evidence Refs": JSON.stringify(sanitizeAuditEvidenceRefsForWorkbook(refs)),
        };
      })
      .filter(Boolean),
    auditFindings: history.auditFindings
      .map((row) => {
        const refs = byFinding.get(row["Finding ID"]);
        if (!refs?.length) return null;
        return {
          ...row,
          "Local Evidence Refs": refs.join(", "),
        };
      })
      .filter(Boolean),
    incidents: history.incidents
      .map((row) => {
        const refs = byIncident.get(row.IncidentId);
        if (!refs?.length) return null;
        return {
          ...row,
          EvidenceUrls: JSON.stringify(sanitizeEvidenceUrlsForWorkbook(refs)),
        };
      })
      .filter(Boolean),
    ncrs: history.ncrs
      .map((row) => {
        const refs = byNcr.get(row["NCR ID"]);
        if (!refs?.length) return null;
        return {
          ...row,
          "Evidence Refs": serializeNcrEvidenceRefs(refs),
          "Evidence Count": String(refs.length),
        };
      })
      .filter(Boolean),
    actions: history.actions
      .map((row) => {
        const refs = byAction.get(row["Action ID"]);
        if (!refs?.length) return null;
        const links = refs.map((ref) => ref.driveLink).filter(Boolean);
        return {
          ...row,
          "Evidence Links": links.join(", "),
          "Local Evidence Refs": refs.map((ref) => ref.evidenceId).join(", "),
        };
      })
      .filter(Boolean),
  };
}

export function isMidlandsSyntheticEvidenceFileName(name = "") {
  return /^midlands-demo-ev-\d{4}\.(jpe?g|png)$/i.test(String(name));
}

export function areaSiteFromHistory(history, areaId = "") {
  if (String(areaId).includes(MIDLANDS_SITE_COVENTRY_ID) || String(areaId).includes("coventry")) {
    return "coventry";
  }
  return "rugby";
}

export function evidenceAssetsDir(sessionsRoot, anchorDate) {
  return path.join(sessionsRoot, "demo-environment-evidence", anchorDate, EVIDENCE_ASSETS_SUBDIR);
}

export function evidencePromptPackDir(sessionsRoot, anchorDate) {
  return path.join(sessionsRoot, "demo-environment-evidence", anchorDate, EVIDENCE_PROMPT_PACK_SUBDIR);
}
