/**
 * Midlands Precast — Phase 3 deterministic synthetic evidence plan and linkage.
 */
import crypto from "node:crypto";
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
import { renderSyntheticEvidencePng } from "./midlands-evidence-render.mjs";
import { MIDLANDS_SITE_COVENTRY_ID } from "./demo-environment.mjs";

export const MIDLANDS_EVIDENCE_RUNTIME_DIR = ".sessions/demo-environment-evidence";
export const MIDLANDS_EVIDENCE_REPORT_FILE = "demo-environment-evidence-report.json";

const TARGET_IMAGE_MIN = 35;
const TARGET_IMAGE_MAX = 50;

export const EVIDENCE_SCENE_CATALOG = [
  { key: "rugby-cement-dust", site: "rugby", title: "Cement dust near mixer platform", category: "rugby" },
  { key: "rugby-silo-access", site: "rugby", title: "Silo ladder access inspection", category: "rugby" },
  { key: "rugby-conveyor-guard", site: "rugby", title: "Damaged conveyor guard section", category: "rugby" },
  { key: "rugby-emergency-route", site: "rugby", title: "Blocked emergency access route", category: "rugby" },
  { key: "rugby-admixture-bund", site: "rugby", title: "Admixture stained bund area", category: "rugby" },
  { key: "rugby-washout-housekeeping", site: "rugby", title: "Washout area housekeeping", category: "rugby" },
  { key: "rugby-loader-leak", site: "rugby", title: "Loader hydraulic leak trace", category: "rugby" },
  { key: "rugby-estop-label", site: "rugby", title: "Missing emergency stop label", category: "rugby" },
  { key: "rugby-damaged-lead", site: "rugby", title: "Damaged electrical lead", category: "rugby" },
  { key: "rugby-mould-oil", site: "rugby", title: "Mould oil storage arrangement", category: "rugby" },
  { key: "rugby-ppe-setup", site: "rugby", title: "PPE station condition", category: "rugby" },
  { key: "rugby-lab-cubes", site: "rugby", title: "Lab cube testing setup", category: "rugby-quality" },
  { key: "rugby-calibration-label", site: "rugby", title: "Calibration label condition", category: "rugby" },
  { key: "rugby-batching-panel", site: "rugby", title: "Batching control panel", category: "rugby" },
  { key: "rugby-aggregate-bay", site: "rugby", title: "Aggregate bay housekeeping", category: "rugby" },
  { key: "rugby-pedestrian-barrier", site: "rugby", title: "Pedestrian barrier defect", category: "rugby" },
  { key: "rugby-guard-repaired", site: "rugby", title: "Repaired conveyor guard", category: "rugby", variant: "after" },
  { key: "rugby-washout-cleaned", site: "rugby", title: "Cleaned washout area", category: "rugby", variant: "after" },
  { key: "rugby-spill-contained", site: "rugby", title: "Spill containment correction", category: "rugby", variant: "after" },
  { key: "rugby-inspection-tag", site: "rugby", title: "Replacement inspection tag", category: "rugby", variant: "after" },
  { key: "rugby-housekeeping-improved", site: "rugby", title: "Improved platform housekeeping", category: "rugby", variant: "after" },
  { key: "coventry-chain-tag", site: "coventry", title: "Lifting chain tag defect", category: "coventry" },
  { key: "coventry-shackle-wear", site: "coventry", title: "Worn shackle identification tag", category: "coventry" },
  { key: "coventry-unstable-stack", site: "coventry", title: "Unstable product storage stack", category: "coventry" },
  { key: "coventry-damaged-barrier", site: "coventry", title: "Damaged pedestrian barrier", category: "coventry" },
  { key: "coventry-forklift-route", site: "coventry", title: "Obstructed forklift route", category: "coventry" },
  { key: "coventry-crane-zone", site: "coventry", title: "Crane exclusion zone marking", category: "coventry" },
  { key: "coventry-dispatch-congestion", site: "coventry", title: "Dispatch yard congestion", category: "coventry" },
  { key: "coventry-wheel-chocks", site: "coventry", title: "Missing wheel chocks", category: "coventry" },
  { key: "coventry-trailer-loading", site: "coventry", title: "Trailer loading setup", category: "coventry" },
  { key: "coventry-grinding-dust", site: "coventry", title: "Dust from remedial grinding", category: "coventry" },
  { key: "coventry-barrier-repaired", site: "coventry", title: "Repaired pedestrian barrier", category: "coventry", variant: "after" },
  { key: "coventry-stack-corrected", site: "coventry", title: "Corrected storage stack", category: "coventry", variant: "after" },
  { key: "coventry-lifting-tag-replaced", site: "coventry", title: "Replacement lifting tag", category: "coventry", variant: "after" },
  { key: "coventry-route-cleared", site: "coventry", title: "Cleared forklift route", category: "coventry", variant: "after" },
  { key: "coventry-loading-segregation", site: "coventry", title: "Improved loading segregation", category: "coventry", variant: "after" },
  { key: "quality-cube-setup", site: "rugby", title: "Concrete cube test setup", category: "quality" },
  { key: "quality-mix-sheet", site: "rugby", title: "Mix documentation sheet", category: "quality" },
  { key: "quality-edge-spall", site: "coventry", title: "Damaged precast edge", category: "quality" },
  { key: "quality-label-issue", site: "coventry", title: "Product identification label", category: "quality" },
  { key: "quality-rebar-check", site: "rugby", title: "Reinforcement placement check", category: "quality" },
  { key: "quality-curing-board", site: "rugby", title: "Curing record board", category: "quality" },
  { key: "quality-finished-repair", site: "coventry", title: "Repaired finished product", category: "quality", variant: "after" },
  { key: "quality-label-corrected", site: "coventry", title: "Corrected product labelling", category: "quality", variant: "after" },
  { key: "incident-spill-isolated", site: "rugby", title: "Spill area after isolation", category: "incident" },
  { key: "incident-blocked-route", site: "rugby", title: "Blocked route near miss area", category: "incident" },
  { key: "incident-damaged-barrier", site: "coventry", title: "Damaged barrier incident scene", category: "incident" },
  { key: "incident-product-movement", site: "coventry", title: "Product movement area", category: "incident" },
  { key: "incident-route-conflict", site: "rugby", title: "Loader route conflict zone", category: "incident" },
  { key: "incident-lifting-quarantine", site: "coventry", title: "Defective lifting accessory quarantined", category: "incident" },
  { key: "incident-washout-slip", site: "rugby", title: "Washout slip hazard area", category: "incident" },
  { key: "incident-oil-containment", site: "rugby", title: "Oil spill containment", category: "incident" },
];

const BEFORE_AFTER_PAIRS = [
  {
    pairId: "pair-conveyor-guard",
    beforeScene: "rugby-conveyor-guard",
    afterScene: "rugby-guard-repaired",
    recordTypes: ["finding", "action", "ncr"],
  },
  {
    pairId: "pair-washout",
    beforeScene: "rugby-washout-housekeeping",
    afterScene: "rugby-washout-cleaned",
    recordTypes: ["finding", "action", "incident"],
  },
  {
    pairId: "pair-barrier-coventry",
    beforeScene: "coventry-damaged-barrier",
    afterScene: "coventry-barrier-repaired",
    recordTypes: ["finding", "incident", "action"],
  },
  {
    pairId: "pair-lifting-tag",
    beforeScene: "coventry-chain-tag",
    afterScene: "coventry-lifting-tag-replaced",
    recordTypes: ["finding", "ncr", "action"],
  },
  {
    pairId: "pair-storage-stack",
    beforeScene: "coventry-unstable-stack",
    afterScene: "coventry-stack-corrected",
    recordTypes: ["finding", "incident"],
  },
  {
    pairId: "pair-quality-label",
    beforeScene: "quality-label-issue",
    afterScene: "quality-label-corrected",
    recordTypes: ["ncr", "action"],
  },
];

function siteFromArea(areaId = "") {
  return String(areaId).includes("coventry") ? "coventry" : "rugby";
}

function sceneByKey(key) {
  return EVIDENCE_SCENE_CATALOG.find((entry) => entry.key === key) || EVIDENCE_SCENE_CATALOG[0];
}

function pickScenes(rng, site, count, usedKeys = new Set()) {
  const pool = shuffleDeterministic(
    rng,
    EVIDENCE_SCENE_CATALOG.filter((entry) => entry.site === site && !usedKeys.has(entry.key)),
  );
  return pool.slice(0, count);
}

function buildFileName(recordId, slot, ext = "png") {
  return `midlands-demo-synthetic-${recordId}-${String(slot).padStart(3, "0")}.${ext}`;
}

function evidenceIdFor(slot) {
  return `midlands-demo-ev-${String(slot).padStart(4, "0")}`;
}

function dimensionsForSlot(rng, slot) {
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

function drivePathForItem(item) {
  if (item.recordType === "incident") {
    return `${INCIDENT_EVIDENCE_DRIVE_PATH_PREFIX}/${item.recordId}`;
  }
  if (item.resultId) {
    return `${AUDIT_EVIDENCE_DRIVE_PATH_PREFIX}/${item.resultId}`;
  }
  return `${AUDIT_EVIDENCE_DRIVE_PATH_PREFIX}/${item.recordId}`;
}

export function buildMidlandsEvidencePlan({ history, anchorDate } = {}) {
  if (!history?.auditFindings?.length) {
    throw new Error("Midlands history payload is required to build an evidence plan.");
  }
  const anchorKey = history.anchorDate || anchorDate;
  const rng = createSeededRandom(anchorSeedNumber(`${anchorKey}|evidence-plan`));

  const findings = shuffleDeterministic(rng, [...history.auditFindings]);
  const incidents = shuffleDeterministic(
    rng,
    history.incidents.filter((row) => String(row.IncidentId || "").startsWith("midlands-")),
  );
  const ncrs = shuffleDeterministic(rng, [...history.ncrs]);
  const actions = shuffleDeterministic(
    rng,
    history.actions.filter((row) => row.Archived !== "true"),
  );

  const selectedFindings = findings.slice(0, 16);
  const selectedIncidents = incidents.slice(0, 7);
  const selectedNcrs = ncrs.slice(0, 6);
  const selectedActions = actions.slice(0, 8);

  const items = [];
  const usedScenes = new Set();
  let slot = 0;

  function addItem(input) {
    slot += 1;
    const dims = dimensionsForSlot(rng, slot);
    const sequence = input.sequence || 1;
    const recordId = input.recordId;
    const fileName = buildFileName(recordId, slot, "png");
    const evidenceId = evidenceIdFor(slot);
    const scene = sceneByKey(input.sceneKey);
    const item = {
      evidenceId,
      fileName,
      mimeType: "image/png",
      sceneKey: scene.key,
      title: input.title || scene.title,
      site: input.site || scene.site,
      category: scene.category,
      variant: input.variant || scene.variant || "single",
      pairId: input.pairId || "",
      pairRole: input.pairRole || "",
      recordType: input.recordType,
      recordId,
      resultId: input.resultId || "",
      questionId: input.questionId || "",
      auditId: input.auditId || "",
      actionId: input.actionId || "",
      findingId: input.findingId || "",
      ncrId: input.ncrId || "",
      incidentId: input.incidentId || "",
      anchorDate: anchorKey,
      ...dims,
      drivePath: "",
      renderSeed: anchorSeedNumber(`${anchorKey}|${evidenceId}`),
    };
    item.drivePath = drivePathForItem(item);
    items.push(item);
    usedScenes.add(scene.key);
    return item;
  }

  for (const finding of selectedFindings) {
    const site = siteFromArea(finding["Area ID"]);
    const scenes = pickScenes(rng, site, 1, usedScenes);
    const sceneKey = scenes[0]?.key || (site === "coventry" ? "coventry-forklift-route" : "rugby-cement-dust");
    addItem({
      recordType: "finding",
      recordId: finding["Finding ID"],
      findingId: finding["Finding ID"],
      resultId: finding["Result ID"],
      questionId: finding["Question ID"],
      auditId: finding["Audit ID"],
      sceneKey,
      site,
      title: String(finding.Note || sceneByKey(sceneKey).title).slice(0, 48),
      sequence: 1,
    });
  }

  for (const incident of selectedIncidents) {
    const site = String(incident.Location || "").toLowerCase().includes("coventry") ? "coventry" : "rugby";
    const incidentScenes = EVIDENCE_SCENE_CATALOG.filter((entry) => entry.category === "incident" && entry.site === site);
    const scene = incidentScenes[Math.floor(rng() * incidentScenes.length)] || sceneByKey("incident-spill-isolated");
    addItem({
      recordType: "incident",
      recordId: incident.IncidentId,
      incidentId: incident.IncidentId,
      sceneKey: scene.key,
      site,
      title: String(incident.Description || scene.title).slice(0, 48),
      sequence: 1,
    });
    if (String(incident.IncidentType || "").toLowerCase().includes("near")) {
      addItem({
        recordType: "incident",
        recordId: incident.IncidentId,
        incidentId: incident.IncidentId,
        sceneKey: scene.key,
        site,
        sequence: 2,
        title: `${scene.title} follow-up`,
      });
    }
  }

  for (const ncr of selectedNcrs) {
    const site = String(ncr.Site || "").toLowerCase().includes("coventry") ? "coventry" : "rugby";
    const quality =
      String(ncr.Title || "").toLowerCase().includes("concrete")
      || String(ncr.Description || "").toLowerCase().includes("quality");
    const scenePool = EVIDENCE_SCENE_CATALOG.filter((entry) =>
      (quality ? entry.category === "quality" : entry.site === site),
    );
    const scene = scenePool[Math.floor(rng() * scenePool.length)] || sceneByKey("quality-cube-setup");
    addItem({
      recordType: "ncr",
      recordId: ncr["NCR ID"],
      ncrId: ncr["NCR ID"],
      resultId: ncr["Result ID"],
      questionId: ncr["Source Question ID"] || "q-ncr-linked",
      auditId: ncr["Source Audit ID"],
      sceneKey: scene.key,
      site,
      title: String(ncr.Title || scene.title).slice(0, 48),
      sequence: 1,
    });
  }

  for (const action of selectedActions) {
    const site =
      String(action["Source Audit Name"] || "").toLowerCase().includes("dispatch")
      || String(action["Source Audit Name"] || "").toLowerCase().includes("crane")
      || String(action["Source Audit Name"] || "").toLowerCase().includes("forklift")
        ? "coventry"
        : "rugby";
    const scenes = pickScenes(rng, site, 1, usedScenes);
    addItem({
      recordType: "action",
      recordId: action["Action ID"],
      actionId: action["Action ID"],
      questionId: action["Source Question ID"],
      auditId: action["Source Audit ID"],
      sceneKey: scenes[0]?.key || "rugby-housekeeping-improved",
      site,
      title: String(action["Corrective Action"] || action.Comments || "Corrective action evidence").slice(0, 48),
      sequence: 1,
      variant: action.Status === "Closed" ? "after" : "single",
    });
  }

  for (const pair of BEFORE_AFTER_PAIRS) {
    const candidates = {
      finding: selectedFindings,
      incident: selectedIncidents,
      ncr: selectedNcrs,
      action: selectedActions,
    };
    for (const type of pair.recordTypes) {
      const record = candidates[type]?.find((row) => {
        const id = row["Finding ID"] || row.IncidentId || row["NCR ID"] || row["Action ID"];
        return !items.some((item) => item.pairId === pair.pairId && item.recordId === id);
      });
      if (!record) continue;
      const recordId = record["Finding ID"] || record.IncidentId || record["NCR ID"] || record["Action ID"];
      const base = {
        recordId,
        findingId: record["Finding ID"] || "",
        incidentId: record.IncidentId || "",
        ncrId: record["NCR ID"] || "",
        actionId: record["Action ID"] || "",
        resultId: record["Result ID"] || "",
        questionId: record["Question ID"] || record["Source Question ID"] || "",
        auditId: record["Audit ID"] || record["Source Audit ID"] || "",
        pairId: pair.pairId,
        recordType: type,
      };
      addItem({
        ...base,
        sceneKey: pair.beforeScene,
        variant: "before",
        pairRole: "before",
        sequence: 1,
        site: sceneByKey(pair.beforeScene).site,
      });
      addItem({
        ...base,
        sceneKey: pair.afterScene,
        variant: "after",
        pairRole: "after",
        sequence: 2,
        site: sceneByKey(pair.afterScene).site,
      });
      break;
    }
  }

  while (items.length < TARGET_IMAGE_MIN) {
    const fillerFinding = findings[items.length % findings.length];
    const site = siteFromArea(fillerFinding["Area ID"]);
    const scenes = pickScenes(rng, site, 1, usedScenes);
    addItem({
      recordType: "finding",
      recordId: fillerFinding["Finding ID"],
      findingId: fillerFinding["Finding ID"],
      resultId: fillerFinding["Result ID"],
      questionId: fillerFinding["Question ID"],
      auditId: fillerFinding["Audit ID"],
      sceneKey: scenes[0]?.key || "rugby-aggregate-bay",
      site,
      sequence: 3,
    });
  }

  const finalItems = finalizeEvidenceItems(items);
  return {
    anchorDate: anchorKey,
    generatedAt: new Date().toISOString(),
    items: finalItems,
    summary: summarizeEvidencePlan(finalItems),
  };
}

function finalizeEvidenceItems(items) {
  const pairItems = items.filter((item) => item.pairId);
  const selected = [...pairItems];
  const selectedIds = new Set(selected.map((item) => item.evidenceId));
  const minRecords = { finding: 15, incident: 6, ncr: 5, action: 8 };

  for (const [recordType, minCount] of Object.entries(minRecords)) {
    const pool = items.filter((item) => item.recordType === recordType && !item.pairId);
    const byRecord = new Map();
    for (const item of pool) {
      const list = byRecord.get(item.recordId) || [];
      list.push(item);
      byRecord.set(item.recordId, list);
    }
    let recordsChosen = 0;
    for (const recordItems of byRecord.values()) {
      if (recordsChosen >= minCount) break;
      const item = recordItems[0];
      if (!selectedIds.has(item.evidenceId)) {
        selected.push(item);
        selectedIds.add(item.evidenceId);
      }
      recordsChosen += 1;
    }
  }

  for (const item of items) {
    if (selected.length >= TARGET_IMAGE_MAX) break;
    if (selectedIds.has(item.evidenceId)) continue;
    selected.push(item);
    selectedIds.add(item.evidenceId);
  }

  while (selected.length < TARGET_IMAGE_MIN) {
    const donor = items.find((item) => !selectedIds.has(item.evidenceId));
    if (!donor) break;
    selected.push(donor);
    selectedIds.add(donor.evidenceId);
  }

  return selected.slice(0, TARGET_IMAGE_MAX);
}

export function summarizeEvidencePlan(items = []) {
  const byCategory = {};
  const bySite = { rugby: 0, coventry: 0 };
  const byRecordType = {};
  const pairIds = new Set(items.filter((item) => item.pairId).map((item) => item.pairId));
  for (const item of items) {
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
    bySite[item.site] = (bySite[item.site] || 0) + 1;
    byRecordType[item.recordType] = (byRecordType[item.recordType] || 0) + 1;
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
  };
}

export function renderEvidencePlanItem(item) {
  const buffer = renderSyntheticEvidencePng({
    seed: item.renderSeed,
    width: item.width,
    height: item.height,
    sceneKey: item.sceneKey,
    title: item.title,
    site: item.site,
    variant: item.variant,
    quality: item.quality,
  });
  return {
    ...item,
    buffer,
    size: buffer.length,
    sha256: hashBuffer(buffer),
  };
}

export function buildEvidenceManifest(plan, renderedFiles = []) {
  const fileById = new Map(renderedFiles.map((file) => [file.evidenceId, file]));
  const files = plan.items.map((item) => {
    const rendered = fileById.get(item.evidenceId) || {};
    return {
      evidenceId: item.evidenceId,
      fileName: item.fileName,
      mimeType: item.mimeType,
      size: rendered.size || 0,
      sha256: rendered.sha256 || "",
      width: item.width,
      height: item.height,
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
      localPath: rendered.localPath || "",
    };
  });
  const payload = {
    anchorDate: plan.anchorDate,
    generatedAt: plan.generatedAt,
    summary: summarizeEvidenceManifest(files, plan.summary),
    files,
    linkage: buildLinkageIndex(plan.items),
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
  return String(name).startsWith("midlands-demo-synthetic-");
}

export function areaSiteFromHistory(history, areaId = "") {
  if (String(areaId).includes(MIDLANDS_SITE_COVENTRY_ID) || String(areaId).includes("coventry")) {
    return "coventry";
  }
  return "rugby";
}
