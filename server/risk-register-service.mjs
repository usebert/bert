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
import {
  dedupeRiskRegisterDetailLoad,
  ensureRiskRegisterTabsCached,
  invalidateRiskRegisterWorkbookCache,
  riskRegisterCacheKey,
} from "./risk-register-cache.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

function resolveReadTabRecords(deps) {
  return typeof deps?.readTabRecords === "function" ? deps.readTabRecords : workbookReadTabRecords;
}

function resolveEnsureTabColumns(deps) {
  return typeof deps?.ensureTabColumns === "function" ? deps.ensureTabColumns : workbookEnsureTabColumns;
}

export function logRiskRegisterDetailTiming(stage, details = {}) {
  console.info("[risk-register:detail-timing]", {
    stage: trim(stage) || "total",
    riskId: trim(details.riskId) || undefined,
    workbookId: trim(details.workbookId) || undefined,
    rowCounts: details.rowCounts || undefined,
    durationMs: Number(details.durationMs) || 0,
    totalMs: Number(details.totalMs) || 0,
  });
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

async function ensureRiskRegisterTabsOnce(auth, deps, masterSheetId) {
  return ensureRiskRegisterTabsCached(masterSheetId, () => ensureRiskRegisterTabs(auth, deps, masterSheetId));
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

function pickRiskId(record = {}) {
  return trim(record.RiskId || record.riskId || record.id);
}

function pickControlRiskId(record = {}) {
  return trim(record.RiskId || record.riskId);
}

function pickReviewRiskId(record = {}) {
  return trim(record.RiskId || record.riskId);
}

export async function loadRiskRegisterContext(auth, deps, input = {}) {
  const resolved = await resolveCompanyScheduleContext(auth, deps, input);
  if (!resolved.ok) {
    return resolved;
  }
  const masterSheetId = trim(resolved.masterSheetId);
  await ensureRiskRegisterTabsOnce(auth, deps, masterSheetId);
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

export async function loadRiskRegisterDetail(auth, deps, resolved, riskId, options = {}) {
  const startedAt = Date.now();
  const targetRiskId = trim(riskId);
  const masterSheetId = trim(resolved?.masterSheetId);
  const companyFolderId = trim(resolved?.companyFolderId);
  if (!masterSheetId || !targetRiskId) {
    return healthSafetyApiFailure("RISK_REGISTER_INVALID", "Risk Register detail requires workbook and risk ID.", 400);
  }

  const cacheKey = riskRegisterCacheKey(masterSheetId, `detail:${targetRiskId}`);
  return dedupeRiskRegisterDetailLoad(cacheKey, async () => {
    let stageStarted = Date.now();
    const todayKey = getUkTodayKey();
    const includeArchived = options.includeArchived === true;

    await ensureRiskRegisterTabsOnce(auth, deps, masterSheetId);
    logRiskRegisterDetailTiming("tab_ensure", {
      riskId: targetRiskId,
      workbookId: masterSheetId,
      durationMs: Date.now() - stageStarted,
      totalMs: Date.now() - startedAt,
    });

    stageStarted = Date.now();
    const riskRecords = await readRiskRecords(auth, deps, masterSheetId);
    const riskRecord = riskRecords.find((record) => pickRiskId(record) === targetRiskId);
    logRiskRegisterDetailTiming("risk_row_lookup", {
      riskId: targetRiskId,
      workbookId: masterSheetId,
      rowCounts: { risks: riskRecords.length },
      durationMs: Date.now() - stageStarted,
      totalMs: Date.now() - startedAt,
    });
    if (!riskRecord) {
      return healthSafetyApiFailure("RISK_REGISTER_NOT_FOUND", "Risk Register record not found.", 404);
    }

    stageStarted = Date.now();
    let item;
    try {
      item = mapRiskRegisterRecord(riskRecord, { todayKey });
    } catch (error) {
      return healthSafetyApiFailure(
        "RISK_REGISTER_PARSE_FAILED",
        error instanceof Error ? error.message : "Could not parse Risk Register record.",
        500,
      );
    }
    logRiskRegisterDetailTiming("parse_normalise", {
      riskId: targetRiskId,
      workbookId: masterSheetId,
      durationMs: Date.now() - stageStarted,
      totalMs: Date.now() - startedAt,
    });

    if (!includeArchived && item.archivedAt) {
      return healthSafetyApiFailure("RISK_REGISTER_NOT_FOUND", "Risk Register record not found.", 404);
    }

    stageStarted = Date.now();
    const controlRecords = await readControlRecords(auth, deps, masterSheetId);
    const controls = [];
    for (const record of controlRecords) {
      if (pickControlRiskId(record) !== targetRiskId) {
        continue;
      }
      try {
        const mapped = mapRiskRegisterControlRecord(record);
        if (!includeArchived && mapped.archivedAt) {
          continue;
        }
        controls.push(mapped);
      } catch {
        /* skip malformed */
      }
    }
    logRiskRegisterDetailTiming("controls_read", {
      riskId: targetRiskId,
      workbookId: masterSheetId,
      rowCounts: { controls: controlRecords.length, matchedControls: controls.length },
      durationMs: Date.now() - stageStarted,
      totalMs: Date.now() - startedAt,
    });

    stageStarted = Date.now();
    const reviewRecords = await readReviewRecords(auth, deps, masterSheetId);
    const reviews = mapReviewRecordsSafely(
      reviewRecords.filter((record) => pickReviewRiskId(record) === targetRiskId),
    );
    logRiskRegisterDetailTiming("reviews_read", {
      riskId: targetRiskId,
      workbookId: masterSheetId,
      rowCounts: { reviews: reviewRecords.length, matchedReviews: reviews.length },
      durationMs: Date.now() - stageStarted,
      totalMs: Date.now() - startedAt,
    });

    stageStarted = Date.now();
    const response = { ok: true, item, controls, reviews };
    logRiskRegisterDetailTiming("response_build", {
      riskId: targetRiskId,
      workbookId: masterSheetId,
      rowCounts: { controls: controls.length, reviews: reviews.length },
      durationMs: Date.now() - stageStarted,
      totalMs: Date.now() - startedAt,
    });
    logRiskRegisterDetailTiming("total", {
      riskId: targetRiskId,
      workbookId: masterSheetId,
      rowCounts: { risks: riskRecords.length, controls: controlRecords.length, reviews: reviewRecords.length },
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
    });
    return response;
  });
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
  if (!actorCanAccessCompanyRiskRegister(actor, resolved.companyFolderId, resolved.alternateIds)) {
    return healthSafetyApiFailure("RISK_REGISTER_FORBIDDEN", "You do not have access to this company.", 403);
  }
  return loadRiskRegisterDetail(auth, deps, resolved, riskId, options);
}

export { invalidateRiskRegisterWorkbookCache };
