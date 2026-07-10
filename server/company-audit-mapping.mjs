import {
  LEGACY_SCHEDULE_TAB,
  SCHEDULES_TAB,
} from "../shared/schedule-save.mjs";
import { scheduleTabRecordsPreferCanonical } from "../shared/schedule-list.mjs";
import {
  AUDIT_TEMPLATE_TRANSLATIONS_COLUMNS,
  AUDIT_TEMPLATE_TRANSLATIONS_TAB,
  DEFAULT_FORM_LANGUAGE,
  defaultTranslationStatusForLanguage,
  normalizeFormLanguage,
} from "./template-languages.mjs";
import { REVISION_CONTROL_COLUMNS } from "../shared/revision-control.mjs";

export { AUDIT_TEMPLATE_TRANSLATIONS_TAB, AUDIT_TEMPLATE_TRANSLATIONS_COLUMNS };

export const AUDIT_TEMPLATES_TAB = "AuditTemplates";
export const AREA_AUDITS_TAB = "AreaAudits";
export const USER_AREA_ACCESS_TAB = "UserAreaAccess";
export const USER_AUDIT_ACCESS_TAB = "UserAuditAccess";

export const AUDIT_TEMPLATES_COLUMNS = [
  "Audit ID",
  "Audit Name",
  "Category",
  "Status",
  "Default Frequency",
  "Created At",
  "Google Form ID",
  "Google Form Template Status",
  "Language",
  "Default Language",
  "Translation Status",
  ...REVISION_CONTROL_COLUMNS,
  "Archived",
  "ArchivedAt",
  "ArchivedBy",
  "ArchiveReason",
];

export const AREA_AUDITS_COLUMNS = [
  "Area ID",
  "Audit ID",
  "Status",
  "Frequency Override",
  "Notes",
];

export const USER_AREA_ACCESS_COLUMNS = ["Email", "Area ID", "Access"];

export const USER_AUDIT_ACCESS_COLUMNS = ["Email", "Audit ID", "Access"];

const SHEET_ACCESS_LEVELS = new Set(["no_access", "can_complete", "full_access"]);

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function normalizeAccessLevel(access = "") {
  const value = String(access || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (value === "complete") return "can_complete";
  if (value === "no access" || value === "no_access") return "no_access";
  if (value === "can complete" || value === "can_complete") return "can_complete";
  if (value === "full access" || value === "full_access" || value === "oversight") return "full_access";
  return SHEET_ACCESS_LEVELS.has(value) ? value : "no_access";
}

function sheetAccessToUi(access) {
  const normalized = normalizeAccessLevel(access);
  if (normalized === "can_complete") return "Can complete";
  if (normalized === "full_access") return "Full access";
  return "No access";
}

function uiAccessToSheet(access = "") {
  const normalized = normalizeAccessLevel(access);
  return normalized;
}

function rowToAuditTemplate(row) {
  const id = String(row["Audit ID"] || row.auditId || "").trim();
  const name = String(row["Audit Name"] || row.auditName || "").trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    category: String(row.Category || row.category || "").trim(),
    status: String(row.Status || row.status || "active").trim().toLowerCase(),
    defaultFrequency: String(row["Default Frequency"] || row.defaultFrequency || "").trim(),
    createdAt: String(row["Created At"] || row.createdAt || "").trim(),
    googleFormId: String(row["Google Form ID"] || row.googleFormId || "").trim(),
    googleFormTemplateStatus: String(row["Google Form Template Status"] || row.googleFormTemplateStatus || "").trim(),
    language: normalizeFormLanguage(row.Language || row.language),
    defaultLanguage: normalizeFormLanguage(row["Default Language"] || row.defaultLanguage || DEFAULT_FORM_LANGUAGE),
    translationStatus: String(row["Translation Status"] || row.translationStatus || "").trim(),
    formNumber: String(row["Form Number"] || row.formNumber || row.form_number || "").trim(),
    revisionNumber: Number(row["Revision Number"] || row.revisionNumber || row.revision_number || 1) || 1,
    revisionId: String(row["Revision ID"] || row.revisionId || row.revision_id || "").trim(),
    supersedesRevisionId: String(row["Supersedes Revision ID"] || row.supersedesRevisionId || "").trim(),
    supersededByRevisionId: String(row["Superseded By Revision ID"] || row.supersededByRevisionId || "").trim(),
    revisionReason: String(row["Revision Reason"] || row.revisionReason || "").trim(),
    copyReason: String(row["Copy Reason"] || row.copyReason || "").trim(),
    archived: String(row.Archived || row.archived || "").trim(),
    archivedAt: String(row.ArchivedAt || row.archivedAt || "").trim(),
    archivedBy: String(row.ArchivedBy || row.archivedBy || "").trim(),
    archiveReason: String(row.ArchiveReason || row.archiveReason || "").trim(),
  };
}

function rowToAreaAudit(row) {
  const areaId = String(row["Area ID"] || row.areaId || "").trim();
  const auditId = String(row["Audit ID"] || row.auditId || "").trim();
  if (!areaId || !auditId) return null;
  const status = String(row.Status || row.status || "active").trim().toLowerCase();
  return {
    areaId,
    auditId,
    status: status === "inactive" ? "inactive" : "active",
    frequencyOverride: String(row["Frequency Override"] || row.frequencyOverride || "").trim(),
    notes: String(row.Notes || row.notes || "").trim(),
  };
}

function rowToUserAreaAccess(row) {
  const email = normalizeEmail(row.Email || row.email);
  const areaId = String(row["Area ID"] || row.areaId || "").trim();
  if (!email || !areaId) return null;
  return {
    email,
    areaId,
    access: String(row.Access || row.access || "allowed").trim().toLowerCase(),
  };
}

function rowToUserAuditAccess(row) {
  const email = normalizeEmail(row.Email || row.email);
  const auditId = String(row["Audit ID"] || row.auditId || "").trim();
  if (!email || !auditId) return null;
  return {
    email,
    auditId,
    access: normalizeAccessLevel(row.Access || row.access),
    uiAccess: sheetAccessToUi(row.Access || row.access),
  };
}

function areaAuditsToRows(mappings) {
  return mappings.map((mapping) => [
    mapping.areaId,
    mapping.auditId,
    mapping.status === "inactive" ? "inactive" : "active",
    mapping.frequencyOverride || "",
    mapping.notes || "",
  ]);
}

function sheetStatusFromTemplate(template = {}) {
  const status = String(template.status || "").trim().toLowerCase();
  if (status === "superseded" || status === "archived" || status === "inactive" || status === "draft") {
    return status;
  }
  if (template.active === false) return "inactive";
  return "active";
}

function auditTemplatesToRows(templates) {
  return templates.map((template) => {
    const status = sheetStatusFromTemplate(template);
    const archived =
      status === "superseded" || status === "archived" || status === "inactive"
        ? "true"
        : String(template.archived || "").trim() || "false";
    return [
      template.id,
      template.name,
      template.category || "",
      status,
      template.defaultFrequency || "",
      template.createdAt || "",
      template.googleFormId || "",
      template.googleFormTemplateStatus || "",
      normalizeFormLanguage(template.language),
      normalizeFormLanguage(template.defaultLanguage || DEFAULT_FORM_LANGUAGE),
      template.translationStatus ||
        defaultTranslationStatusForLanguage(normalizeFormLanguage(template.language)),
      template.formNumber || "",
      String(template.revisionNumber || 1),
      template.revisionId || "",
      template.supersedesRevisionId || "",
      template.supersededByRevisionId || "",
      template.revisionReason || "",
      template.copyReason || "",
      archived,
      template.archivedAt || "",
      template.archivedBy || "",
      template.archiveReason || template.revisionReason || "",
    ];
  });
}

function userAreaAccessToRows(rows) {
  return rows.map((row) => [row.email, row.areaId, row.access || "allowed"]);
}

function userAuditAccessToRows(rows) {
  return rows.map((row) => [row.email, row.auditId, row.access || "no_access"]);
}

async function readTabRecords(deps, auth, spreadsheetId, tab, columns, mapper) {
  const { ensureColumns, getTabValues, rowsToRecords } = deps;
  await ensureColumns(auth, spreadsheetId, tab, columns);
  const rows = rowsToRecords(await getTabValues(auth, spreadsheetId, tab));
  return rows.map(mapper).filter(Boolean);
}

async function writeTab(deps, auth, spreadsheetId, tab, columns, dataRows) {
  const { ensureColumns, withSheetsQuotaRetry } = deps;
  const { google } = deps;
  await ensureColumns(auth, spreadsheetId, tab, columns);
  const sheets = google.sheets({ version: "v4", auth });
  const lastCol = String.fromCharCode(64 + Math.max(columns.length, 1));
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${tab}!A:${lastCol}`,
    }),
  );
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [columns, ...dataRows],
      },
    }),
  );
}

async function readAreaAudits(deps, auth, spreadsheetId) {
  return readTabRecords(deps, auth, spreadsheetId, AREA_AUDITS_TAB, AREA_AUDITS_COLUMNS, rowToAreaAudit);
}

export async function readAuditTemplates(deps, auth, spreadsheetId) {
  return readTabRecords(
    deps,
    auth,
    spreadsheetId,
    AUDIT_TEMPLATES_TAB,
    AUDIT_TEMPLATES_COLUMNS,
    rowToAuditTemplate,
  );
}

function rowToAuditTemplateTranslation(row) {
  const bertTemplateId = String(row["BERT Template ID"] || "").trim();
  if (!bertTemplateId) return null;
  return {
    bertTemplateId,
    language: String(row.Language || "").trim(),
    translationStatus: String(row["Translation Status"] || "").trim(),
    title: String(row.Title || "").trim(),
    description: String(row.Description || "").trim(),
    questionsJson: String(row["Questions JSON"] || "").trim(),
  };
}

export async function readAuditTemplateTranslations(deps, auth, spreadsheetId) {
  try {
    return await readTabRecords(
      deps,
      auth,
      spreadsheetId,
      AUDIT_TEMPLATE_TRANSLATIONS_TAB,
      AUDIT_TEMPLATE_TRANSLATIONS_COLUMNS,
      rowToAuditTemplateTranslation,
    );
  } catch {
    return [];
  }
}

async function readUserAreaAccess(deps, auth, spreadsheetId) {
  return readTabRecords(
    deps,
    auth,
    spreadsheetId,
    USER_AREA_ACCESS_TAB,
    USER_AREA_ACCESS_COLUMNS,
    rowToUserAreaAccess,
  );
}

async function readUserAuditAccess(deps, auth, spreadsheetId) {
  return readTabRecords(
    deps,
    auth,
    spreadsheetId,
    USER_AUDIT_ACCESS_TAB,
    USER_AUDIT_ACCESS_COLUMNS,
    rowToUserAuditAccess,
  );
}

function parseScheduleRows(records) {
  return records
    .map((row) => {
      const scheduleId = String(row["Schedule ID"] || row.scheduleId || "").trim();
      const auditId = String(row["Audit ID"] || row.auditId || "").trim();
      const auditName = String(
        row["Audit Name"] || row["Template Name"] || row.auditName || row.templateName || "",
      ).trim();
      const areaName = String(row["Schedule Name"] || row.siteArea || row["Site Area"] || "").trim();
      if (!scheduleId && !auditId) return null;
      return {
        scheduleId,
        areaId: String(row["Area ID"] || row.areaId || "").trim(),
        auditId,
        auditName,
        areaName,
        frequency: String(row.Frequency || row.frequency || "").trim(),
        nextDueDate: String(row["Next Due Date"] || row["Next Due At"] || row.nextDueDate || row["Live Time"] || "").trim(),
        assignedRole: String(row["Assigned Role"] || row.assignedRole || "").trim(),
        assignedUser: String(
          row["Assigned User"] ||
            row["Assigned User Emails"] ||
            row.assignedUser ||
            row.Auditors ||
            "",
        ).trim(),
        companyFolderId: String(row["Company Folder ID"] || row.companyFolderId || "").trim(),
        status: String(row.Status || row.status || row.Lifecycle || "").trim().toLowerCase(),
      };
    })
    .filter(Boolean);
}

async function readAuditMappingSchedules(deps, authed, masterSheetId) {
  const { getTabValues, rowsToRecords } = deps;
  let canonicalRecords = [];
  let legacyRecords = [];
  try {
    canonicalRecords = rowsToRecords(await getTabValues(authed, masterSheetId, SCHEDULES_TAB));
  } catch {
    canonicalRecords = [];
  }
  try {
    legacyRecords = rowsToRecords(await getTabValues(authed, masterSheetId, LEGACY_SCHEDULE_TAB));
  } catch {
    legacyRecords = [];
  }
  const preferred = scheduleTabRecordsPreferCanonical(canonicalRecords, legacyRecords);
  return parseScheduleRows(preferred);
}

export function installCompanyAuditMappingRoutes(app, deps) {
  const { getAuthedClient, envConfigured } = deps;

  app.get("/api/company-audit-mapping/:masterSheetId", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Connect Google Workspace before loading audit mapping.",
      });
    }

    const masterSheetId = String(req.params.masterSheetId || "").trim();
    if (!masterSheetId) {
      return res.status(400).json({ ok: false, error: "masterSheetId is required." });
    }

    try {
      const [auditTemplates, areaAudits, userAreaAccess, userAuditAccess] = await Promise.all([
        readAuditTemplates(deps, authed, masterSheetId),
        readAreaAudits(deps, authed, masterSheetId),
        readUserAreaAccess(deps, authed, masterSheetId),
        readUserAuditAccess(deps, authed, masterSheetId),
      ]);

      let schedules = [];
      try {
        schedules = await readAuditMappingSchedules(deps, authed, masterSheetId);
      } catch {
        schedules = [];
      }

      return res.json({
        ok: true,
        masterSheetId,
        auditTemplates,
        areaAudits,
        userAreaAccess,
        userAuditAccess,
        schedules,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to load company audit mapping.",
      });
    }
  });

  app.put("/api/company-audit-mapping/:masterSheetId/area-audits", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Connect Google Workspace before saving area audits.",
      });
    }

    const masterSheetId = String(req.params.masterSheetId || "").trim();
    const areaId = String(req.body?.areaId || "").trim();
    const enabledAuditIds = Array.isArray(req.body?.enabledAuditIds)
      ? req.body.enabledAuditIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];

    if (!masterSheetId || !areaId) {
      return res.status(400).json({ ok: false, error: "masterSheetId and areaId are required." });
    }

    try {
      const existing = await readAreaAudits(deps, authed, masterSheetId);
      const kept = existing.filter((row) => row.areaId !== areaId);
      const nextForArea = enabledAuditIds.map((auditId) => ({
        areaId,
        auditId,
        status: "active",
        frequencyOverride: "",
        notes: "",
      }));
      const merged = [...kept, ...nextForArea];
      await writeTab(deps, authed, masterSheetId, AREA_AUDITS_TAB, AREA_AUDITS_COLUMNS, areaAuditsToRows(merged));
      return res.json({ ok: true, areaId, areaAudits: merged });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to save area audits.",
      });
    }
  });

  app.put("/api/company-audit-mapping/:masterSheetId/audit-templates", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Connect Google Workspace before saving audit templates.",
      });
    }

    const masterSheetId = String(req.params.masterSheetId || "").trim();
    const templates = Array.isArray(req.body?.templates) ? req.body.templates : [];
    if (!masterSheetId) {
      return res.status(400).json({ ok: false, error: "masterSheetId is required." });
    }

    try {
      const existingTemplates = await readAuditTemplates(deps, authed, masterSheetId);
      const existingById = new Map(existingTemplates.map((row) => [row.id, row]));
      const incomingIds = new Set();

      const normalized = templates
        .map((template) => {
          const id = String(template?.id || "").trim();
          const name = String(template?.name || "").trim();
          if (!id || !name) return null;
          incomingIds.add(id);
          const existing = existingById.get(id) || {};
          const explicitStatus = String(template?.status || "").trim().toLowerCase();
          const status =
            explicitStatus === "superseded" ||
            explicitStatus === "archived" ||
            explicitStatus === "inactive" ||
            explicitStatus === "draft"
              ? explicitStatus
              : template?.active === false
                ? "inactive"
                : "active";
          return {
            id,
            name,
            category: String(template?.category || template?.source || existing.category || "").trim(),
            status,
            defaultFrequency: String(template?.defaultFrequency || existing.defaultFrequency || "").trim(),
            createdAt: String(template?.createdAt || existing.createdAt || new Date().toISOString()).trim(),
            googleFormId: String(
              template?.googleFormId || template?.googleForm?.formId || existing.googleFormId || "",
            ).trim(),
            googleFormTemplateStatus: String(
              template?.googleFormTemplateStatus ||
                template?.googleForm?.syncStatus ||
                existing.googleFormTemplateStatus ||
                "",
            ).trim(),
            language: normalizeFormLanguage(template?.language || existing.language),
            defaultLanguage: normalizeFormLanguage(
              template?.defaultLanguage || template?.language || existing.defaultLanguage || DEFAULT_FORM_LANGUAGE,
            ),
            translationStatus: String(
              template?.translationStatus ||
                existing.translationStatus ||
                defaultTranslationStatusForLanguage(normalizeFormLanguage(template?.language || existing.language)),
            ).trim(),
            formNumber: String(template?.formNumber || template?.form_number || existing.formNumber || "").trim(),
            revisionNumber:
              Number(template?.revisionNumber || template?.revision_number || existing.revisionNumber || 1) || 1,
            revisionId: String(template?.revisionId || template?.revision_id || existing.revisionId || "").trim(),
            supersedesRevisionId: String(
              template?.supersedesRevisionId || template?.supersedes_revision_id || existing.supersedesRevisionId || "",
            ).trim(),
            supersededByRevisionId: String(
              template?.supersededByRevisionId ||
                template?.superseded_by_revision_id ||
                existing.supersededByRevisionId ||
                "",
            ).trim(),
            revisionReason: String(
              template?.revisionReason || template?.revision_reason || existing.revisionReason || "",
            ).trim(),
            copyReason: String(template?.copyReason || template?.copy_reason || existing.copyReason || "").trim(),
            archived: String(template?.archived || existing.archived || "").trim(),
            archivedAt: String(template?.archivedAt || existing.archivedAt || "").trim(),
            archivedBy: String(template?.archivedBy || existing.archivedBy || "").trim(),
            archiveReason: String(template?.archiveReason || existing.archiveReason || "").trim(),
          };
        })
        .filter(Boolean);

      // Active-list syncs must not wipe superseded/archived revisions from AuditTemplates.
      const preservedHistoric = existingTemplates.filter((row) => {
        if (incomingIds.has(row.id)) return false;
        const status = String(row.status || "").trim().toLowerCase();
        return (
          status === "superseded" ||
          status === "archived" ||
          status === "inactive" ||
          status === "obsolete" ||
          String(row.archived || "").trim().toLowerCase() === "true" ||
          Boolean(String(row.supersededByRevisionId || "").trim())
        );
      });

      const merged = [...normalized, ...preservedHistoric];
      await writeTab(
        deps,
        authed,
        masterSheetId,
        AUDIT_TEMPLATES_TAB,
        AUDIT_TEMPLATES_COLUMNS,
        auditTemplatesToRows(merged),
      );
      return res.json({ ok: true, auditTemplates: merged });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to save audit templates.",
      });
    }
  });

  app.put("/api/company-audit-mapping/:masterSheetId/user-area-access", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Connect Google Workspace before saving user area access.",
      });
    }

    const masterSheetId = String(req.params.masterSheetId || "").trim();
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!masterSheetId) {
      return res.status(400).json({ ok: false, error: "masterSheetId is required." });
    }

    try {
      const normalized = rows
        .map((row) => {
          const email = normalizeEmail(row?.email);
          const areaId = String(row?.areaId || "").trim();
          if (!email || !areaId) return null;
          return { email, areaId, access: String(row?.access || "allowed").trim().toLowerCase() };
        })
        .filter(Boolean);
      await writeTab(
        deps,
        authed,
        masterSheetId,
        USER_AREA_ACCESS_TAB,
        USER_AREA_ACCESS_COLUMNS,
        userAreaAccessToRows(normalized),
      );
      return res.json({ ok: true, userAreaAccess: normalized });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to save user area access.",
      });
    }
  });

  app.put("/api/company-audit-mapping/:masterSheetId/user-audit-access", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Connect Google Workspace before saving user audit access.",
      });
    }

    const masterSheetId = String(req.params.masterSheetId || "").trim();
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!masterSheetId) {
      return res.status(400).json({ ok: false, error: "masterSheetId is required." });
    }

    try {
      const normalized = rows
        .map((row) => {
          const email = normalizeEmail(row?.email);
          const auditId = String(row?.auditId || "").trim();
          if (!email || !auditId) return null;
          const access = uiAccessToSheet(row?.access);
          return { email, auditId, access, uiAccess: sheetAccessToUi(access) };
        })
        .filter(Boolean);
      await writeTab(
        deps,
        authed,
        masterSheetId,
        USER_AUDIT_ACCESS_TAB,
        USER_AUDIT_ACCESS_COLUMNS,
        userAuditAccessToRows(normalized),
      );
      return res.json({ ok: true, userAuditAccess: normalized });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to save user audit access.",
      });
    }
  });
}

export { sheetAccessToUi, uiAccessToSheet, normalizeAccessLevel };

export async function ensureCompanyMappingTabs(deps, auth, spreadsheetId) {
  const tabs = [
    [AUDIT_TEMPLATES_TAB, AUDIT_TEMPLATES_COLUMNS],
    [AREA_AUDITS_TAB, AREA_AUDITS_COLUMNS],
    [USER_AREA_ACCESS_TAB, USER_AREA_ACCESS_COLUMNS],
    [USER_AUDIT_ACCESS_TAB, USER_AUDIT_ACCESS_COLUMNS],
  ];
  for (const [tab, columns] of tabs) {
    await deps.ensureColumns(auth, spreadsheetId, tab, columns);
  }
}
