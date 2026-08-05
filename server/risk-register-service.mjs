/**
 * Risk Register service — list, detail, and workbook tab provisioning.
 */
import {
  RISK_REGISTER_CONTROLS_TAB,
  RISK_REGISTER_CONTROLS_TAB_COLUMNS,
  RISK_REGISTER_REQUIRED_TABS,
  RISK_REGISTER_REVIEWS_TAB,
  RISK_REGISTER_REVIEWS_TAB_COLUMNS,
  RISK_REGISTER_TAB,
  RISK_REGISTER_TAB_COLUMNS,
  mapRiskRegisterControlRecord,
  mapRiskRegisterRecord,
  mapRiskRegisterReviewRecord,
} from "../shared/risk-register.mjs";
import { resolveCompanyScheduleContext } from "./schedule-service.mjs";
import {
  ensureTabColumns as workbookEnsureTabColumns,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";
import { healthSafetyApiFailure } from "./health-safety-service.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

function resolveReadTabRecords(deps) {
  return typeof deps?.readTabRecords === "function" ? deps.readTabRecords : workbookReadTabRecords;
}

function resolveEnsureTabColumns(deps) {
  return typeof deps?.ensureTabColumns === "function" ? deps.ensureTabColumns : workbookEnsureTabColumns;
}

export async function ensureRiskRegisterTabs(auth, deps, masterSheetId) {
  const ensureTabColumns = resolveEnsureTabColumns(deps);
  for (const tab of RISK_REGISTER_REQUIRED_TABS) {
    const columns =
      tab === RISK_REGISTER_TAB
        ? RISK_REGISTER_TAB_COLUMNS
        : tab === RISK_REGISTER_CONTROLS_TAB
          ? RISK_REGISTER_CONTROLS_TAB_COLUMNS
          : RISK_REGISTER_REVIEWS_TAB_COLUMNS;
    await ensureTabColumns(auth, deps, masterSheetId, tab, columns);
  }
}

async function readRiskRecords(auth, deps, masterSheetId) {
  const readTabRecords = resolveReadTabRecords(deps);
  const result = await readTabRecords(auth, deps, masterSheetId, RISK_REGISTER_TAB, {
    expectedHeaders: RISK_REGISTER_TAB_COLUMNS,
  });
  return result?.records || [];
}

async function readControlRecords(auth, deps, masterSheetId) {
  const readTabRecords = resolveReadTabRecords(deps);
  const result = await readTabRecords(auth, deps, masterSheetId, RISK_REGISTER_CONTROLS_TAB, {
    expectedHeaders: RISK_REGISTER_CONTROLS_TAB_COLUMNS,
  });
  return result?.records || [];
}

async function readReviewRecords(auth, deps, masterSheetId) {
  const readTabRecords = resolveReadTabRecords(deps);
  const result = await readTabRecords(auth, deps, masterSheetId, RISK_REGISTER_REVIEWS_TAB, {
    expectedHeaders: RISK_REGISTER_REVIEWS_TAB_COLUMNS,
  });
  return result?.records || [];
}

function mapRiskRecordsSafely(records = [], todayKey = getUkTodayKey()) {
  const items = [];
  for (const record of records) {
    try {
      const mapped = mapRiskRegisterRecord(record, { todayKey });
      if (mapped?.id) {
        items.push(mapped);
      }
    } catch {
      /* skip malformed */
    }
  }
  return items;
}

function mapControlRecordsSafely(records = []) {
  const items = [];
  for (const record of records) {
    try {
      const mapped = mapRiskRegisterControlRecord(record);
      if (mapped?.id) {
        items.push(mapped);
      }
    } catch {
      /* skip malformed */
    }
  }
  return items;
}

function mapReviewRecordsSafely(records = []) {
  const items = [];
  for (const record of records) {
    try {
      const mapped = mapRiskRegisterReviewRecord(record);
      if (mapped?.id) {
        items.push(mapped);
      }
    } catch {
      /* skip malformed */
    }
  }
  return items;
}

export async function loadRiskRegisterContext(auth, deps, input = {}) {
  const resolved = await resolveCompanyScheduleContext(auth, deps, input);
  if (!resolved.ok) {
    return resolved;
  }
  const masterSheetId = trim(resolved.masterSheetId);
  await ensureRiskRegisterTabs(auth, deps, masterSheetId);
  const todayKey = getUkTodayKey();
  const [riskRecords, controlRecords, reviewRecords] = await Promise.all([
    readRiskRecords(auth, deps, masterSheetId),
    readControlRecords(auth, deps, masterSheetId),
    readReviewRecords(auth, deps, masterSheetId),
  ]);
  return {
    ok: true,
    companyFolderId: resolved.companyFolderId,
    masterSheetId,
    risks: mapRiskRecordsSafely(riskRecords, todayKey),
    controls: mapControlRecordsSafely(controlRecords),
    reviews: mapReviewRecordsSafely(reviewRecords),
    riskRecords,
    controlRecords,
    reviewRecords,
    todayKey,
  };
}

export function actorCanAccessCompanyRiskRegister(actor, companyFolderId, alternateIds = []) {
  const sessionCompany = trim(actor?.companyFolderId || actor?.companyId);
  const allowed = new Set([trim(companyFolderId), sessionCompany, ...alternateIds.map((id) => trim(id))].filter(Boolean));
  return allowed.has(trim(companyFolderId)) || allowed.has(sessionCompany);
}

export async function listCompanyRiskRegister(auth, deps, resolved, actor, options = {}) {
  if (!actorCanAccessCompanyRiskRegister(actor, resolved.companyFolderId, resolved.alternateIds)) {
    return healthSafetyApiFailure("RISK_REGISTER_FORBIDDEN", "You do not have access to this company.", 403);
  }
  const loaded = await loadRiskRegisterContext(auth, deps, {
    companyFolderId: resolved.companyFolderId,
    masterSheetId: resolved.masterSheetId,
  });
  if (!loaded.ok) {
    return loaded;
  }
  const includeArchived = options.includeArchived === true;
  const items = loaded.risks.filter((item) => includeArchived || !item.archivedAt);
  return { ok: true, items };
}

export async function getCompanyRiskRegisterItem(auth, deps, resolved, actor, riskId, options = {}) {
  const listed = await listCompanyRiskRegister(auth, deps, resolved, actor, {
    includeArchived: options.includeArchived === true,
  });
  if (!listed.ok) {
    return listed;
  }
  const item = listed.items.find((entry) => entry.id === trim(riskId));
  if (!item) {
    return healthSafetyApiFailure("RISK_REGISTER_NOT_FOUND", "Risk Register record not found.", 404);
  }
  const loaded = await loadRiskRegisterContext(auth, deps, {
    companyFolderId: resolved.companyFolderId,
    masterSheetId: resolved.masterSheetId,
  });
  const controls = loaded.controls.filter((control) => trim(control.riskId) === trim(riskId) && !control.archivedAt);
  const reviews = loaded.reviews.filter((review) => trim(review.riskId) === trim(riskId));
  return { ok: true, item, controls, reviews };
}
