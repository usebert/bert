/**
 * Production smoke verification LOLER equipment — workflow gate (bert-smoke-loler-*).
 */
import {
  calculateNextExaminationDueDate,
  lolerEquipmentComplianceStatus,
  normalizeLolerDateKey,
  summarizeLolerEquipment,
} from "./loler.mjs";
import { subtractDaysFromDateKey } from "./loler-examinations.mjs";
import { getUkTodayKey } from "./uk-date-time.mjs";
import { PRODUCTION_VERIFICATION_SMOKE_EMAIL } from "./production-verification-audit.mjs";

export const PRODUCTION_VERIFICATION_LOLER_EQUIPMENT_ID_PREFIX = "bert-smoke-loler-";
export const PRODUCTION_VERIFICATION_LOLER_ASSET_PREFIX = "BERT-VERIFY-LOLER-";
export const PRODUCTION_VERIFICATION_LOLER_EXAM_ID_PREFIX = "bert-smoke-loler-exam-";
export const PRODUCTION_VERIFICATION_LOLER_FAIL_EXAM_ID_PREFIX = "bert-smoke-loler-fail-";
export const PRODUCTION_VERIFICATION_LOLER_CERT_PREFIX = "BERT-VERIFY-CERT-";
export const PRODUCTION_VERIFICATION_LOLER_EQUIPMENT_NAME = "BERT Verification Lifting Accessory";
export const PRODUCTION_VERIFICATION_LOLER_DESCRIPTION =
  "Automated production LOLER workflow verification. Safe to remove.";
export const PRODUCTION_VERIFICATION_LOLER_EQUIPMENT_TYPE = "Lifting Accessory";
export const PRODUCTION_VERIFICATION_LOLER_SOURCE = "production-loler-workflow";
export const PRODUCTION_VERIFICATION_LOLER_MARKER = "verification";
export const PRODUCTION_VERIFICATION_LOLER_CLEANED_MARKER = "verification-cleaned";
export const PRODUCTION_VERIFICATION_LOLER_NOTES_MARKER =
  `[bert-verification] source=${PRODUCTION_VERIFICATION_LOLER_SOURCE} marker=${PRODUCTION_VERIFICATION_LOLER_MARKER}`;
export const PRODUCTION_VERIFICATION_LOLER_OBSERVATIONS_MARKER =
  `[bert-verification] source=${PRODUCTION_VERIFICATION_LOLER_SOURCE} marker=${PRODUCTION_VERIFICATION_LOLER_MARKER}`;

function trim(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return trim(value).toLowerCase();
}

function pickField(record = {}, ...keys) {
  for (const key of keys) {
    const direct = trim(record[key]);
    if (direct) {
      return direct;
    }
  }
  for (const [header, value] of Object.entries(record || {})) {
    const normalizedHeader = normalize(header).replace(/[^a-z0-9]/g, "");
    for (const key of keys) {
      const normalizedKey = normalize(key).replace(/[^a-z0-9]/g, "");
      if (normalizedHeader === normalizedKey || normalizedHeader.includes(normalizedKey)) {
        const text = trim(value);
        if (text) {
          return text;
        }
      }
    }
  }
  return "";
}

export function isVerificationLolerEquipmentId(equipmentId = "") {
  return trim(equipmentId).startsWith(PRODUCTION_VERIFICATION_LOLER_EQUIPMENT_ID_PREFIX);
}

export function isVerificationLolerExaminationId(examinationId = "") {
  const id = trim(examinationId);
  return (
    id.startsWith(PRODUCTION_VERIFICATION_LOLER_EXAM_ID_PREFIX) ||
    id.startsWith(PRODUCTION_VERIFICATION_LOLER_FAIL_EXAM_ID_PREFIX)
  );
}

export function isVerificationLolerAssetId(assetId = "") {
  return trim(assetId).toUpperCase().startsWith(PRODUCTION_VERIFICATION_LOLER_ASSET_PREFIX);
}

function notesContainVerificationMarker(notes = "") {
  const text = normalize(notes);
  return (
    text.includes(normalize(PRODUCTION_VERIFICATION_LOLER_SOURCE)) &&
    text.includes(`marker=${PRODUCTION_VERIFICATION_LOLER_MARKER}`)
  );
}

function observationsContainVerificationMarker(observations = "") {
  const text = normalize(observations);
  return (
    text.includes(normalize(PRODUCTION_VERIFICATION_LOLER_SOURCE)) &&
    text.includes(`marker=${PRODUCTION_VERIFICATION_LOLER_MARKER}`)
  );
}

export function isVerificationLolerEquipment(record = {}) {
  const equipmentId = pickField(record, "id", "equipmentId", "EquipmentId");
  if (isVerificationLolerEquipmentId(equipmentId)) {
    return true;
  }
  const assetId = pickField(record, "assetId", "AssetId");
  if (isVerificationLolerAssetId(assetId)) {
    return true;
  }
  const equipmentName = normalize(pickField(record, "equipmentName", "EquipmentName"));
  if (equipmentName === normalize(PRODUCTION_VERIFICATION_LOLER_EQUIPMENT_NAME)) {
    return true;
  }
  const notes = pickField(record, "notes", "Notes");
  if (notesContainVerificationMarker(notes)) {
    return true;
  }
  const description = normalize(pickField(record, "description", "Description"));
  if (description.includes("automated production loler workflow verification")) {
    return true;
  }
  return false;
}

export function isActiveVerificationLolerEquipment(record = {}) {
  if (!isVerificationLolerEquipment(record)) {
    return false;
  }
  const status = normalize(pickField(record, "status", "EquipmentStatus"));
  if (status === "archived") {
    return false;
  }
  const notes = pickField(record, "notes", "Notes");
  if (normalize(notes).includes(PRODUCTION_VERIFICATION_LOLER_CLEANED_MARKER)) {
    return false;
  }
  return true;
}

export function isOperationalLolerEquipment(record = {}) {
  return !isVerificationLolerEquipment(record);
}

export function isVerificationLolerExamination(record = {}) {
  const examinationId = pickField(record, "examinationId", "ExaminationId", "id");
  if (isVerificationLolerExaminationId(examinationId)) {
    return true;
  }
  const equipmentId = pickField(record, "equipmentId", "EquipmentId");
  if (isVerificationLolerEquipmentId(equipmentId)) {
    return true;
  }
  const observations = pickField(record, "observations", "Observations");
  if (observationsContainVerificationMarker(observations)) {
    return true;
  }
  return false;
}

export function isOperationalLolerExamination(record = {}) {
  if (!isVerificationLolerExamination(record)) {
    return true;
  }
  const observations = pickField(record, "observations", "Observations");
  return normalize(observations).includes(PRODUCTION_VERIFICATION_LOLER_CLEANED_MARKER);
}

export function buildProductionVerificationLolerEquipmentId(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_LOLER_EQUIPMENT_ID_PREFIX}${runId}`;
}

export function buildProductionVerificationLolerAssetId(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_LOLER_ASSET_PREFIX}${runId}`;
}

export function buildProductionVerificationLolerExamId(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_LOLER_EXAM_ID_PREFIX}${runId}`;
}

export function buildProductionVerificationLolerFailExamId(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_LOLER_FAIL_EXAM_ID_PREFIX}${runId}`;
}

export function buildProductionVerificationLolerCertReference(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_LOLER_CERT_PREFIX}${runId}`;
}

export function buildProductionVerificationLolerEquipment(input = {}) {
  const runId = input.runId ?? Date.now();
  const now = input.now instanceof Date ? input.now : new Date();
  const todayKey = trim(input.todayKey) || getUkTodayKey(now);
  const inServiceDate = subtractDaysFromDateKey(todayKey, 30) || todayKey;
  const equipmentId = trim(input.equipmentId) || buildProductionVerificationLolerEquipmentId(runId);
  const assetId = trim(input.assetId) || buildProductionVerificationLolerAssetId(runId);
  const examinationIntervalMonths = Number(input.examinationIntervalMonths) || 6;
  const nextExaminationDueDate =
    trim(input.nextExaminationDueDate) ||
    calculateNextExaminationDueDate({
      lastExaminationDate: inServiceDate,
      examinationIntervalMonths,
    }) ||
    todayKey;
  const assignedEmail = trim(input.assignedEmail || PRODUCTION_VERIFICATION_SMOKE_EMAIL).toLowerCase();

  return {
    equipmentId,
    assetId,
    equipmentName: trim(input.equipmentName) || PRODUCTION_VERIFICATION_LOLER_EQUIPMENT_NAME,
    equipmentType: trim(input.equipmentType) || PRODUCTION_VERIFICATION_LOLER_EQUIPMENT_TYPE,
    manufacturer: trim(input.manufacturer) || "BERT Demo",
    model: trim(input.model) || "Verification Sling",
    serialNumber: trim(input.serialNumber) || `BERT-${runId}`,
    siteName: trim(input.siteName) || "Rugby",
    areaName: trim(input.areaName) || "",
    ownerDepartment: trim(input.ownerDepartment) || "Verification",
    status: trim(input.status) || "active",
    examinationIntervalMonths,
    lastExaminationDate: trim(input.lastExaminationDate) || inServiceDate,
    nextExaminationDueDate,
    assignedPersonId: assignedEmail,
    assignedPersonName: trim(input.assignedPersonName) || "Smoke Verifier",
    notes: trim(input.notes) || `${PRODUCTION_VERIFICATION_LOLER_DESCRIPTION} ${PRODUCTION_VERIFICATION_LOLER_NOTES_MARKER}`,
    verificationSource: PRODUCTION_VERIFICATION_LOLER_SOURCE,
    verificationMarker: PRODUCTION_VERIFICATION_LOLER_MARKER,
  };
}

export function countLolerBaselines(equipment = [], schedules = [], examinations = [], todayKey = getUkTodayKey()) {
  const list = Array.isArray(equipment) ? equipment : [];
  const scheduleList = Array.isArray(schedules) ? schedules : [];
  const examList = Array.isArray(examinations) ? examinations : [];
  const operational = list.filter((item) => isOperationalLolerEquipment(item));
  const verification = list.filter((item) => isVerificationLolerEquipment(item));
  const activeVerification = list.filter((item) => isActiveVerificationLolerEquipment(item));
  const operationalSummary = summarizeLolerEquipment(operational, todayKey);
  const verificationSummary = summarizeLolerEquipment(verification, todayKey);
  const openSchedules = scheduleList.filter((item) => {
    const status = normalize(item.scheduleStatus || item.ScheduleStatus);
    return ["upcoming", "due_soon", "overdue"].includes(status);
  });
  const verificationOpenSchedules = openSchedules.filter((item) =>
    isVerificationLolerEquipmentId(item.equipmentId || item.EquipmentId),
  );
  const operationalOpenSchedules = openSchedules.filter((item) =>
    isOperationalLolerEquipment({ id: item.equipmentId || item.EquipmentId }),
  );
  const failedItems = operational.filter((item) => lolerEquipmentComplianceStatus(item, todayKey) === "out_of_service");
  const verificationExams = examList.filter((item) => isVerificationLolerExamination(item));

  return {
    visibleCount: list.length,
    operationalCount: operational.length,
    activeCount: operationalSummary.totalActive,
    dueSoonCount: operationalSummary.dueSoon,
    overdueCount: operationalSummary.overdue,
    outOfServiceCount: failedItems.length,
    verificationCount: verification.length,
    activeVerificationCount: activeVerification.length,
    verificationDueSoonCount: verificationSummary.dueSoon,
    verificationOverdueCount: verificationSummary.overdue,
    openScheduleCount: operationalOpenSchedules.length,
    verificationOpenScheduleCount: verificationOpenSchedules.length,
    examinationCount: examList.length,
    verificationExaminationCount: verificationExams.length,
  };
}

export function listActiveVerificationLolerEquipment(equipment = []) {
  return (Array.isArray(equipment) ? equipment : []).filter((item) => isActiveVerificationLolerEquipment(item));
}

export function findLolerEquipmentById(equipment = [], equipmentId = "") {
  const target = trim(equipmentId).toLowerCase();
  return (Array.isArray(equipment) ? equipment : []).find((item) => trim(item.id || item.equipmentId).toLowerCase() === target);
}

export function expectedNextExaminationDueDate(equipment = {}, examinationDate = "", todayKey = getUkTodayKey()) {
  const examDate = normalizeLolerDateKey(examinationDate) || todayKey;
  return calculateNextExaminationDueDate({
    lastExaminationDate: examDate,
    examinationIntervalMonths: Number(equipment.examinationIntervalMonths) || 6,
  });
}

export function equipmentAppearsInOperationalSummary(equipment = [], equipmentId = "", todayKey = getUkTodayKey()) {
  const operational = equipment.filter((item) => isOperationalLolerEquipment(item));
  const summary = summarizeLolerEquipment(operational, todayKey);
  const item = findLolerEquipmentById(equipment, equipmentId);
  if (!item) {
    return false;
  }
  const status = lolerEquipmentComplianceStatus(item, todayKey);
  if (status === "archived" || status === "out_of_service") {
    return summary.outOfService > 0 || summary.archived > 0;
  }
  if (status === "overdue") {
    return summary.overdue > 0;
  }
  if (status === "due_soon") {
    return summary.dueSoon > 0;
  }
  return summary.compliant > 0 || summary.totalActive > 0;
}
