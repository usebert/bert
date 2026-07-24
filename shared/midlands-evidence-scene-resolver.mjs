/**
 * Semantic scene resolution and validation for Midlands demo evidence.
 */
import { sceneByKey } from "./midlands-evidence-specs.mjs";

export const ISSUE_CATEGORIES = [
  "ESTOP",
  "CONVEYOR_GUARD",
  "PLANT_GUARDING",
  "EMERGENCY_ROUTE",
  "SILO_TAG",
  "ELECTRICAL",
  "CEMENT_DUST",
  "MOULD_OIL",
  "LIFTING_TAG",
  "WHEEL_CHOCKS",
  "WASHOUT",
  "LOADER",
  "CRANE",
  "BANKSMAN",
  "BARRIER",
  "STORAGE_STACK",
  "PRODUCT_LABEL",
  "CUBE_QUALITY",
  "REPAIR_DOC",
  "GROUT_TRIP",
  "ADMIXTURE_SPILL",
  "LAB_SAMPLE",
  "SILO_DUST",
  "PRODUCT_SHIFT",
  "ROUTE_MARKING",
  "PRODUCT_QUALITY",
  "PPE",
  "CORRECTED",
];

export const SCENE_ISSUE_MAP = {
  "rugby-conveyor-guard": ["CONVEYOR_GUARD", "PLANT_GUARDING"],
  "rugby-guard-repaired": ["CONVEYOR_GUARD", "PLANT_GUARDING", "CORRECTED"],
  "rugby-estop-cover": ["ESTOP", "CONVEYOR_GUARD"],
  "rugby-emergency-route-blocked": ["EMERGENCY_ROUTE"],
  "rugby-silo-ladder-tag-missing": ["SILO_TAG"],
  "rugby-damaged-110v-lead": ["ELECTRICAL"],
  "rugby-cement-dust-silo": ["CEMENT_DUST"],
  "rugby-cement-dust-silo-cleaned": ["CEMENT_DUST", "CORRECTED"],
  "rugby-mould-oil-no-containment": ["MOULD_OIL"],
  "rugby-washout-housekeeping": ["WASHOUT"],
  "rugby-washout-sump-blocked": ["WASHOUT"],
  "rugby-washout-cleaned": ["WASHOUT", "CORRECTED"],
  "rugby-washout-overflow": ["WASHOUT"],
  "rugby-admixture-leak": ["ADMIXTURE_SPILL"],
  "rugby-admixture-contained": ["ADMIXTURE_SPILL", "CORRECTED"],
  "rugby-lab-sample-console": ["LAB_SAMPLE"],
  "rugby-silo-fill-dust": ["SILO_DUST"],
  "rugby-loader-pedestrian-near-miss": ["LOADER"],
  "rugby-loader-leak": ["LOADER"],
  "rugby-grout-trip-hazard": ["GROUT_TRIP"],
  "rugby-grout-cleared": ["GROUT_TRIP", "CORRECTED"],
  "rugby-lab-cubes": ["CUBE_QUALITY"],
  "rugby-ppe-setup": ["PPE"],
  "coventry-chain-tag": ["LIFTING_TAG"],
  "coventry-lifting-tag-replaced": ["LIFTING_TAG", "CORRECTED"],
  "coventry-lifting-tag-missing-dispatch": ["LIFTING_TAG"],
  "coventry-wheel-chocks-missing": ["WHEEL_CHOCKS"],
  "coventry-trailer-no-banksman": ["BANKSMAN"],
  "coventry-damaged-barrier": ["BARRIER"],
  "coventry-barrier-repaired": ["BARRIER", "CORRECTED"],
  "coventry-unstable-stack": ["STORAGE_STACK"],
  "coventry-stack-corrected": ["STORAGE_STACK", "CORRECTED"],
  "coventry-crane-zone": ["CRANE"],
  "coventry-crane-slew-walkway": ["CRANE"],
  "coventry-route-marking-corrected": ["ROUTE_MARKING", "CORRECTED"],
  "coventry-forklift-route": ["LOADER"],
  "quality-label-issue": ["PRODUCT_LABEL"],
  "quality-label-corrected": ["PRODUCT_LABEL", "CORRECTED"],
  "quality-edge-spall": ["PRODUCT_QUALITY"],
  "quality-finished-repair": ["PRODUCT_QUALITY", "CORRECTED"],
  "quality-repair-documentation": ["REPAIR_DOC"],
  "incident-spill-isolated": ["ADMIXTURE_SPILL"],
  "incident-blocked-route": ["EMERGENCY_ROUTE"],
  "incident-damaged-barrier": ["BARRIER"],
  "incident-product-movement": ["PRODUCT_SHIFT"],
  "incident-lifting-quarantine": ["LIFTING_TAG"],
  "incident-washout-slip": ["WASHOUT"],
  "rugby-batching-panel": ["PLANT_GUARDING"],
};

const FORBIDDEN_SCENE_PAIRS = [
  ["ELECTRICAL", "WASHOUT"],
  ["ELECTRICAL", "LOADER"],
  ["LIFTING_TAG", "PRODUCT_LABEL"],
  ["CEMENT_DUST", "MOULD_OIL"],
  ["WHEEL_CHOCKS", "BARRIER"],
  ["WASHOUT", "LOADER"],
  ["ESTOP", "MOULD_OIL"],
  ["SILO_TAG", "MOULD_OIL"],
  ["EMERGENCY_ROUTE", "ADMIXTURE_SPILL"],
  ["GROUT_TRIP", "CEMENT_DUST"],
  ["BANKSMAN", "BARRIER"],
  ["CUBE_QUALITY", "LIFTING_TAG"],
  ["REPAIR_DOC", "WASHOUT"],
];

const SCENE_SELECTION_RULES = [
  { categories: ["ESTOP"], scene: "rugby-estop-cover" },
  { categories: ["CONVEYOR_GUARD"], scene: "rugby-conveyor-guard", afterScene: "rugby-guard-repaired" },
  { categories: ["PLANT_GUARDING"], scene: "rugby-conveyor-guard", afterScene: "rugby-guard-repaired" },
  { categories: ["EMERGENCY_ROUTE"], scene: "rugby-emergency-route-blocked" },
  { categories: ["SILO_TAG"], scene: "rugby-silo-ladder-tag-missing" },
  { categories: ["ELECTRICAL"], scene: "rugby-damaged-110v-lead" },
  { categories: ["CEMENT_DUST"], scene: "rugby-cement-dust-silo", afterScene: "rugby-cement-dust-silo-cleaned" },
  { categories: ["MOULD_OIL"], scene: "rugby-mould-oil-no-containment" },
  { categories: ["LIFTING_TAG"], scene: "coventry-chain-tag", afterScene: "coventry-lifting-tag-replaced", site: "coventry" },
  { categories: ["WHEEL_CHOCKS"], scene: "coventry-wheel-chocks-missing", site: "coventry" },
  { categories: ["WASHOUT"], scene: "rugby-washout-sump-blocked", afterScene: "rugby-washout-cleaned" },
  { categories: ["LOADER"], scene: "rugby-loader-pedestrian-near-miss" },
  { categories: ["CRANE"], scene: "coventry-crane-slew-walkway", altScene: "coventry-crane-zone", site: "coventry" },
  { categories: ["BANKSMAN"], scene: "coventry-trailer-no-banksman", site: "coventry" },
  { categories: ["BARRIER"], scene: "coventry-damaged-barrier", afterScene: "coventry-barrier-repaired", site: "coventry" },
  { categories: ["STORAGE_STACK"], scene: "coventry-unstable-stack", afterScene: "coventry-stack-corrected", site: "coventry" },
  { categories: ["PRODUCT_LABEL"], scene: "quality-label-issue", afterScene: "quality-label-corrected" },
  { categories: ["CUBE_QUALITY"], scene: "rugby-lab-cubes" },
  { categories: ["REPAIR_DOC"], scene: "quality-repair-documentation" },
  { categories: ["GROUT_TRIP"], scene: "rugby-grout-trip-hazard", afterScene: "rugby-grout-cleared" },
  { categories: ["ADMIXTURE_SPILL"], scene: "rugby-admixture-leak", afterScene: "rugby-admixture-contained" },
  { categories: ["LAB_SAMPLE"], scene: "rugby-lab-sample-console" },
  { categories: ["SILO_DUST"], scene: "rugby-silo-fill-dust" },
  { categories: ["PRODUCT_SHIFT"], scene: "incident-product-movement", site: "coventry" },
  { categories: ["ROUTE_MARKING"], scene: "coventry-route-marking-corrected", site: "coventry" },
  { categories: ["PRODUCT_QUALITY"], scene: "quality-edge-spall", afterScene: "quality-finished-repair" },
  { categories: ["PPE"], scene: "rugby-ppe-setup" },
];

const PAIR_SCENE_OVERRIDES = {
  "pair-conveyor-guard": { before: "rugby-conveyor-guard", after: "rugby-guard-repaired" },
  "pair-washout": { before: "rugby-washout-sump-blocked", after: "rugby-washout-cleaned" },
  "pair-barrier-coventry": { before: "coventry-damaged-barrier", after: "coventry-barrier-repaired" },
  "pair-lifting-tag": { before: "coventry-chain-tag", after: "coventry-lifting-tag-replaced" },
  "pair-storage-stack": { before: "coventry-unstable-stack", after: "coventry-stack-corrected" },
  "pair-quality-label": { before: "quality-label-issue", after: "quality-label-corrected" },
};

export function recordText(record, recordType) {
  if (!record) return "";
  if (recordType === "finding") {
    return `${record.Note || ""} ${record["Question Text"] || ""}`.trim();
  }
  if (recordType === "incident") {
    return `${record.Description || ""} ${record.Title || ""} ${record.IncidentType || ""}`.trim();
  }
  if (recordType === "ncr") {
    return `${record.Title || ""} ${record.Description || ""}`.trim();
  }
  if (recordType === "action") {
    return `${record["Corrective Action"] || ""} ${record.Comments || ""} ${record["Source Question Text"] || ""} ${record["Source Audit Name"] || ""}`.trim();
  }
  return "";
}

export function recordTextForClassification(record, recordType) {
  if (!record) return "";
  if (recordType === "finding") {
    const note = String(record.Note || "").trim();
    if (note) return note;
    return String(record["Question Text"] || "").trim();
  }
  if (recordType === "action") {
    const actionText = `${record["Corrective Action"] || ""} ${record.Comments || ""}`.trim();
    const questionText = String(record["Source Question Text"] || "").trim();
    if (actionText) return `${actionText} ${questionText}`.trim();
    return `${questionText} ${record["Source Audit Name"] || ""}`.trim();
  }
  return recordText(record, recordType);
}

export function recordStatus(record, recordType) {
  if (!record) return "";
  if (recordType === "action" || recordType === "ncr") return String(record.Status || "");
  if (recordType === "incident") return String(record.Status || record.InvestigationStatus || "");
  return "open";
}

export function classifyRecordIssues(record, recordType) {
  const text = recordTextForClassification(record, recordType).toLowerCase();
  const status = recordStatus(record, recordType).toLowerCase();
  const issues = new Set();

  if (/e-?stop|emergency stop/.test(text)) {
    issues.add("ESTOP");
    issues.add("CONVEYOR_GUARD");
  }
  if (/conveyor guard|guard bent|guard section|guarding issue|guarding intact|awaiting replacement/.test(text)) {
    issues.add("CONVEYOR_GUARD");
    issues.add("PLANT_GUARDING");
  }
  if (/emergency route|blocked by pallet/.test(text)) issues.add("EMERGENCY_ROUTE");
  if (/inspection tag.*ladder|ladder.*tag|silo ladder/.test(text)) issues.add("SILO_TAG");
  if (/110v|110 v|electrical lead|damaged lead/.test(text)) issues.add("ELECTRICAL");
  if (/cement dust/.test(text)) issues.add("CEMENT_DUST");
  if (/mould oil|oil stored without|secondary containment/.test(text)) issues.add("MOULD_OIL");
  if (/chain tag|lifting.*tag|sling|loler|lifting accessory/.test(text)) issues.add("LIFTING_TAG");
  if (/chock/.test(text)) issues.add("WHEEL_CHOCKS");
  if (/washout|sump/.test(text)) issues.add("WASHOUT");
  if (/overflow/.test(text)) issues.add("WASHOUT");
  if (/loader reversing|front loader|near miss with pedestrian|hydraulic leak/.test(text)) issues.add("LOADER");
  if (/crane|slew|exclusion zone/.test(text)) issues.add("CRANE");
  if (/banksman|trailer load/.test(text)) issues.add("BANKSMAN");
  if (/barrier/.test(text)) issues.add("BARRIER");
  if (/stack over|storage stack|unstable stack/.test(text)) issues.add("STORAGE_STACK");
  if (/label mismatch|identification label|product label|product identification/.test(text)) {
    issues.add("PRODUCT_LABEL");
  }
  if (/cube|strength below/.test(text)) issues.add("CUBE_QUALITY");
  if (/documentation incomplete|repair documentation/.test(text)) issues.add("REPAIR_DOC");
  if (/grout|trip hazard/.test(text)) issues.add("GROUT_TRIP");
  if (/admixture|leak at coupling/.test(text)) issues.add("ADMIXTURE_SPILL");
  if (/lab sample|batching console/.test(text)) issues.add("LAB_SAMPLE");
  if (/silo fill|dust exposure/.test(text)) issues.add("SILO_DUST");
  if (/product shift|during loading/.test(text)) issues.add("PRODUCT_SHIFT");
  if (/repainted|route remark/.test(text)) issues.add("ROUTE_MARKING");
  if (/edge spall|finished unit/.test(text)) issues.add("PRODUCT_QUALITY");
  if (/immediate correction|correction applied|corrective work verified|verified on walkaround/.test(text) && /closed|completed/.test(status)) {
    issues.add("CORRECTED");
  }

  if (/loader reversing|front loader|near miss with pedestrian|hydraulic leak/.test(text)) issues.add("LOADER");
  if (!issues.size && recordType === "incident" && /spill|oil/.test(text)) issues.add("ADMIXTURE_SPILL");
  if (!issues.size && recordType === "ncr" && /environmental|washout/.test(text)) issues.add("WASHOUT");
  if (!issues.size && recordType === "ncr" && /guarding/.test(text)) issues.add("PLANT_GUARDING");

  return [...issues];
}

function isClosedRecord(record, recordType) {
  const status = recordStatus(record, recordType).toLowerCase();
  return ["closed", "completed"].includes(status);
}

const ISSUE_PRIORITY = [
  "ESTOP",
  "CONVEYOR_GUARD",
  "PLANT_GUARDING",
  "ELECTRICAL",
  "SILO_TAG",
  "GROUT_TRIP",
  "EMERGENCY_ROUTE",
  "CEMENT_DUST",
  "MOULD_OIL",
  "WASHOUT",
  "LIFTING_TAG",
  "WHEEL_CHOCKS",
  "ADMIXTURE_SPILL",
  "LAB_SAMPLE",
  "SILO_DUST",
  "CRANE",
  "BANKSMAN",
  "ROUTE_MARKING",
  "BARRIER",
  "STORAGE_STACK",
  "PRODUCT_SHIFT",
  "PRODUCT_LABEL",
  "CUBE_QUALITY",
  "REPAIR_DOC",
  "PRODUCT_QUALITY",
  "LOADER",
  "PPE",
];

function pickRuleForIssues(issues) {
  for (const category of ISSUE_PRIORITY) {
    if (!issues.includes(category)) continue;
    const rule = SCENE_SELECTION_RULES.find((entry) => entry.categories.includes(category));
    if (rule) return rule;
  }
  return null;
}

export function resolveSceneKeyForRecord(record, recordType, options = {}) {
  const { pairId = "", pairRole = "", preferCorrected = false } = options;
  if (pairId && PAIR_SCENE_OVERRIDES[pairId]) {
    const scenes = PAIR_SCENE_OVERRIDES[pairId];
    if (pairRole === "after") return scenes.after;
    if (pairRole === "before") return scenes.before;
  }

  const issues = classifyRecordIssues(record, recordType);
  const rule = pickRuleForIssues(issues);
  if (!rule) {
    return options.fallbackScene || "rugby-batching-panel";
  }

  const wantsCorrected =
    preferCorrected
    || pairRole === "after"
    || (recordType === "action" && isClosedRecord(record, recordType) && issues.includes("CORRECTED"))
    || (recordType === "action" && isClosedRecord(record, recordType));

  const text = recordText(record, recordType).toLowerCase();
  if (issues.includes("ROUTE_MARKING") && /repainted|route remark/.test(text)) {
    return "coventry-route-marking-corrected";
  }
  if (issues.includes("CRANE") && /slew|walkway/.test(text)) {
    return "coventry-crane-slew-walkway";
  }
  if (issues.includes("CRANE") && /exclusion/.test(text)) {
    return "coventry-crane-zone";
  }
  if (issues.includes("WASHOUT") && /overflow/.test(text)) {
    return "rugby-washout-overflow";
  }
  if (issues.includes("LIFTING_TAG") && recordType === "ncr" && /dispatch/.test(text)) {
    return pairRole === "after" ? "coventry-lifting-tag-replaced" : "coventry-lifting-tag-missing-dispatch";
  }
  if (issues.includes("GROUT_TRIP") && wantsCorrected) {
    return "rugby-grout-cleared";
  }
  if (issues.includes("GROUT_TRIP")) {
    return "rugby-grout-trip-hazard";
  }
  if (issues.includes("REPAIR_DOC")) {
    return "quality-repair-documentation";
  }
  if (issues.includes("PRODUCT_QUALITY") && wantsCorrected) {
    return "quality-finished-repair";
  }
  if (issues.includes("ADMIXTURE_SPILL") && wantsCorrected) {
    return "rugby-admixture-contained";
  }
  if (issues.includes("CEMENT_DUST") && wantsCorrected) {
    return "rugby-cement-dust-silo-cleaned";
  }

  if (wantsCorrected && rule.afterScene) {
    return rule.afterScene;
  }

  return rule.scene;
}

export function sceneIssueCategories(sceneKey) {
  return SCENE_ISSUE_MAP[sceneKey] || [];
}

function categoriesConflict(recordIssues, sceneIssues) {
  if (!sceneIssues.length) return true;
  const overlap = sceneIssues.some((issue) => recordIssues.includes(issue));
  if (!overlap) return true;
  for (const [left, right] of FORBIDDEN_SCENE_PAIRS) {
    const recordHasLeft = recordIssues.includes(left);
    const recordHasRight = recordIssues.includes(right);
    const sceneHasLeft = sceneIssues.includes(left);
    const sceneHasRight = sceneIssues.includes(right);
    if (recordHasLeft && sceneHasRight && !recordHasRight) return true;
    if (recordHasRight && sceneHasLeft && !recordHasLeft) return true;
  }
  return false;
}

export function validateSceneMatchesRecord(sceneKey, record, recordType, options = {}) {
  const recordIssues = classifyRecordIssues(record, recordType);
  const sceneIssues = sceneIssueCategories(sceneKey);
  if (!sceneIssues.length) {
    return { ok: false, reason: `unknown scene ${sceneKey}` };
  }
  if (categoriesConflict(recordIssues, sceneIssues)) {
    return {
      ok: false,
      reason: `scene ${sceneKey} [${sceneIssues.join(",")}] does not match record issues [${recordIssues.join(",")}]`,
    };
  }
  if (options.pairRole === "after" && !sceneIssues.includes("CORRECTED") && !sceneKey.includes("repaired") && !sceneKey.includes("corrected") && !sceneKey.includes("cleaned") && !sceneKey.includes("contained") && !sceneKey.includes("replaced") && !sceneKey.includes("marking")) {
    return { ok: false, reason: `after scene ${sceneKey} does not depict corrected condition` };
  }
  if (options.pairRole === "before" && sceneIssues.includes("CORRECTED")) {
    return { ok: false, reason: `before scene ${sceneKey} should not be corrected-only` };
  }
  return { ok: true, recordIssues, sceneIssues };
}

export function applyResolvedSceneToItem(item, record) {
  const sceneKey = resolveSceneKeyForRecord(record, item.recordType, {
    pairId: item.pairId,
    pairRole: item.pairRole,
    preferCorrected: item.recordType === "action" && isClosedRecord(record, item.recordType),
  });
  const scene = sceneByKey(sceneKey);
  item.sceneKey = sceneKey;
  item.site = scene.site || item.site;
  item.category = scene.category;
  item.issueCategories = classifyRecordIssues(record, item.recordType);
  item.sceneIssueCategories = sceneIssueCategories(sceneKey);
  if (item.pairRole === "before") item.variant = "before";
  else if (item.pairRole === "after") item.variant = "after";
  else if (item.recordType === "action" && isClosedRecord(record, item.recordType)) item.variant = "after";
  else item.variant = scene.variant || "single";
  item.title = recordText(record, item.recordType).slice(0, 120) || scene.subject;
  return item;
}

export function getRecordFromHistory(history, recordType, recordId) {
  if (recordType === "finding") return history.auditFindings.find((row) => row["Finding ID"] === recordId);
  if (recordType === "incident") return history.incidents.find((row) => row.IncidentId === recordId);
  if (recordType === "ncr") return history.ncrs.find((row) => row["NCR ID"] === recordId);
  if (recordType === "action") return history.actions.find((row) => row["Action ID"] === recordId);
  return null;
}

export function validateEvidencePlanSemantics(plan, history) {
  const errors = [];
  for (const item of plan.items) {
    const record = getRecordFromHistory(history, item.recordType, item.recordId);
    if (!record) {
      errors.push(`${item.evidenceId}: missing record ${item.recordType}:${item.recordId}`);
      continue;
    }
    const validation = validateSceneMatchesRecord(item.sceneKey, record, item.recordType, {
      pairRole: item.pairRole,
    });
    if (!validation.ok) {
      errors.push(`${item.evidenceId} (${item.recordId}): ${validation.reason}`);
    }
  }
  return errors;
}

export function computePromptPackFingerprint(pack) {
  const stable = {
    anchorDate: pack.anchorDate,
    specs: (pack.specs || []).map((spec) => ({
      evidenceId: spec.evidenceId,
      linkedRecordId: spec.linkedRecordId,
      sceneKey: spec.sceneKey,
      recordType: spec.recordType,
      beforeAfterState: spec.beforeAfterState,
      expectedFileName: spec.expectedFileName,
    })),
  };
  return stable;
}
