import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AUDIT_TEMPLATES_TAB,
  AUDIT_TEMPLATES_COLUMNS,
  readAuditTemplateTranslations,
} from "./company-audit-mapping.mjs";
import {
  AUDIT_TEMPLATE_TRANSLATIONS_COLUMNS,
  AUDIT_TEMPLATE_TRANSLATIONS_TAB,
  DEFAULT_FORM_LANGUAGE,
  defaultTranslationStatusForLanguage,
} from "./template-languages.mjs";
import { parseChecklistText } from "./audit-builder-parser.mjs";

const STORE_DIR = "audit-builder";
const STORE_FILE = "workspaces.json";

const COMPLIANCE_FAIL = "Non-compliant";
const COMPLIANCE_PASS = "Compliant";
const COMPLIANCE_NA = "Not applicable";

function storePath(sessionDir) {
  return path.join(sessionDir, STORE_DIR, STORE_FILE);
}

function readStore(sessionDir) {
  const filePath = storePath(sessionDir);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") {
      return { version: 1, workspaces: {} };
    }
    return { version: 1, workspaces: data.workspaces || {} };
  } catch {
    return { version: 1, workspaces: {} };
  }
}

function writeStore(sessionDir, store) {
  const dir = path.join(sessionDir, STORE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(storePath(sessionDir), JSON.stringify(store, null, 2), "utf8");
}

function workspaceKey(masterSheetId) {
  return String(masterSheetId || "local").trim() || "local";
}

function getWorkspaceStore(sessionDir, masterSheetId) {
  const store = readStore(sessionDir);
  const key = workspaceKey(masterSheetId);
  if (!store.workspaces[key]) {
    store.workspaces[key] = { templates: {}, instances: {}, answers: {}, actions: {} };
  }
  return { store, bucket: store.workspaces[key], key };
}

function persistWorkspace(sessionDir, store, key, bucket) {
  store.workspaces[key] = bucket;
  writeStore(sessionDir, store);
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function normalizeTemplatePayload(body = {}) {
  const templateName = String(body.template_name || body.name || "").trim();
  const description = String(body.description || "").trim();
  const category = String(body.category || "Audits").trim();
  const sections = Array.isArray(body.sections) ? body.sections : [];

  const normalizedSections = sections
    .map((section) => {
      const name = String(section?.name || "General").trim() || "General";
      const questions = Array.isArray(section?.questions)
        ? section.questions
            .map((question) => {
              const questionText = String(question?.question_text || question?.text || "").trim();
              if (!questionText) return null;
              const answerType = String(question?.answer_type || "compliance").trim() || "compliance";
              const defaultOptions =
                answerType === "yes_no"
                  ? ["Yes", "No"]
                  : ["Compliant", "Non-compliant", "Not applicable"];
              const promptRules = Array.isArray(question?.prompt_rules)
                ? question.prompt_rules
                    .map((rule) => {
                      const triggerValue = String(rule?.when?.value || "").trim();
                      if (!triggerValue) return null;
                      const actions = Array.isArray(rule?.actions)
                        ? rule.actions
                            .map((action) => {
                              const type = String(action?.type || "").trim();
                              if (type === "instruction") {
                                const text = String(action?.text || "").trim();
                                return text ? { type, text } : null;
                              }
                              if (type === "followUpQuestion") {
                                const label = String(action?.label || "").trim();
                                if (!label) return null;
                                return {
                                  type,
                                  id: String(action?.id || "").trim() || `follow-up-${Date.now()}`,
                                  label,
                                  inputType: String(action?.inputType || "text").trim() || "text",
                                  unit: String(action?.unit || "").trim() || undefined,
                                  required: action?.required !== false,
                                };
                              }
                              if (type === "escalate") {
                                const message = String(action?.message || "").trim();
                                if (!message) return null;
                                const safeMin = Number(action?.safeMin);
                                const safeMax = Number(action?.safeMax);
                                return {
                                  type,
                                  message,
                                  managerReview: Boolean(action?.managerReview),
                                  evidenceRequired: Boolean(action?.evidenceRequired),
                                  followUpId: String(action?.followUpId || "").trim() || undefined,
                                  safeMin: Number.isFinite(safeMin) ? safeMin : undefined,
                                  safeMax: Number.isFinite(safeMax) ? safeMax : undefined,
                                };
                              }
                              return null;
                            })
                            .filter(Boolean)
                        : [];
                      if (actions.length === 0) return null;
                      return {
                        when: { operator: "equals", value: triggerValue },
                        actions,
                      };
                    })
                    .filter(Boolean)
                : undefined;
              return {
                question_text: questionText,
                answer_type: answerType,
                options: Array.isArray(question?.options) && question.options.length > 0
                  ? question.options.map((option) => String(option).trim()).filter(Boolean)
                  : defaultOptions,
                requires_comment_on_failure: question?.requires_comment_on_failure !== false,
                requires_action_on_failure: question?.requires_action_on_failure !== false,
                allows_photo_evidence: question?.allows_photo_evidence !== false,
                ...(promptRules && promptRules.length > 0 ? { prompt_rules: promptRules } : {}),
              };
            })
            .filter(Boolean)
        : [];
      if (questions.length === 0) return null;
      return { name, questions };
    })
    .filter(Boolean);

  const questionCount = normalizedSections.reduce((sum, section) => sum + section.questions.length, 0);
  if (!templateName) {
    throw new Error("Template name is required.");
  }
  if (questionCount === 0) {
    throw new Error("Template must include at least one question.");
  }

  return {
    template_name: templateName,
    description,
    category,
    sections: normalizedSections,
  };
}

function flattenTemplateQuestions(sections) {
  const flat = [];
  let index = 0;
  for (const section of sections) {
    for (const question of section.questions) {
      index += 1;
      flat.push({
        id: `q-${index}`,
        section: section.name,
        ...question,
      });
    }
  }
  return flat;
}

function normalizeTemplateStatus(status = "active") {
  const value = String(status || "active").trim().toLowerCase();
  if (value === "inactive" || value === "archived") {
    return value;
  }
  return "active";
}

function templateToApiRecord(templateId, payload, actorEmail, extras = {}) {
  const now = new Date().toISOString();
  return {
    id: templateId,
    template_name: payload.template_name,
    description: payload.description,
    category: payload.category,
    sections: payload.sections,
    created_at: extras.created_at || now,
    updated_at: now,
    created_by: actorEmail,
    question_count: flattenTemplateQuestions(payload.sections).length,
    version: Number(extras.version) > 0 ? Number(extras.version) : 1,
    parent_template_id: extras.parent_template_id || null,
    status: normalizeTemplateStatus(extras.status || payload.status || "active"),
  };
}

function templateIsUsed(bucket, templateId) {
  return Object.values(bucket.instances || {}).some((instance) => instance.template_id === templateId);
}

function enrichTemplate(template, bucket) {
  if (!template) return null;
  return {
    ...template,
    version: Number(template.version) > 0 ? Number(template.version) : 1,
    parent_template_id: template.parent_template_id || null,
    status: normalizeTemplateStatus(template.status),
    is_used: templateIsUsed(bucket, template.id),
  };
}

function resolveActor(req, parseBertActorFromRequest) {
  const actor = parseBertActorFromRequest?.(req);
  if (actor?.email) {
    return {
      email: String(actor.email).trim().toLowerCase(),
      role: String(actor.role || "").trim(),
      masterSheetId: String(actor.masterSheetId || req.body?.masterSheetId || req.query?.masterSheetId || "").trim(),
    };
  }
  if (process.env.NODE_ENV !== "production") {
    const devEmail = String(req.headers["x-bert-dev-user-email"] || "dev@local.test")
      .trim()
      .toLowerCase();
    if (devEmail.includes("@")) {
      return {
        email: devEmail,
        role: String(req.headers["x-bert-dev-user-role"] || "Admin").trim(),
        masterSheetId: String(req.body?.masterSheetId || req.query?.masterSheetId || "local-dev").trim(),
      };
    }
  }
  return null;
}

function requireAuditBuilderActor(req, res, next, parseBertActorFromRequest) {
  const actor = resolveActor(req, parseBertActorFromRequest);
  if (!actor) {
    return res.status(401).json({ ok: false, error: "Sign in to use Audit Builder." });
  }
  const role = actor.role === "Master" ? "Master" : actor.role;
  if (!["Master", "Admin", "Manager"].includes(role)) {
    return res.status(403).json({ ok: false, error: "Only Admin or Manager roles can manage audit templates." });
  }
  req.auditBuilderActor = actor;
  return next();
}

async function writeAuditTemplateTranslations(deps, auth, spreadsheetId, templateId, payload, actorEmail) {
  const { ensureColumns, getTabValues, rowsToRecords, withSheetsQuotaRetry, google } = deps;
  await ensureColumns(auth, spreadsheetId, AUDIT_TEMPLATE_TRANSLATIONS_TAB, AUDIT_TEMPLATE_TRANSLATIONS_COLUMNS);
  const sheets = google.sheets({ version: "v4", auth });
  const rows = rowsToRecords(await getTabValues(auth, spreadsheetId, AUDIT_TEMPLATE_TRANSLATIONS_TAB));
  const kept = rows.filter((row) => String(row["BERT Template ID"] || "").trim() !== templateId);
  const sectionJson = JSON.stringify(payload.sections.map((section) => section.name));
  const questionsJson = JSON.stringify(flattenTemplateQuestions(payload.sections));
  const optionsJson = JSON.stringify(["Compliant", "Non-compliant", "Not applicable"]);
  const nextRow = [
    templateId,
    DEFAULT_FORM_LANGUAGE,
    defaultTranslationStatusForLanguage(DEFAULT_FORM_LANGUAGE),
    payload.template_name,
    payload.description,
    sectionJson,
    questionsJson,
    optionsJson,
    "",
    new Date().toISOString(),
    actorEmail,
  ];
  const dataRows = kept.map((row) =>
    AUDIT_TEMPLATE_TRANSLATIONS_COLUMNS.map((column) => String(row[column] || "")),
  );
  dataRows.push(nextRow);
  const lastCol = String.fromCharCode(64 + AUDIT_TEMPLATE_TRANSLATIONS_COLUMNS.length);
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${AUDIT_TEMPLATE_TRANSLATIONS_TAB}!A:${lastCol}`,
    }),
  );
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${AUDIT_TEMPLATE_TRANSLATIONS_TAB}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [AUDIT_TEMPLATE_TRANSLATIONS_COLUMNS, ...dataRows],
      },
    }),
  );
}

function sheetStatusForTemplate(templateRecord) {
  const status = normalizeTemplateStatus(templateRecord.status);
  return status === "active" ? "active" : "inactive";
}

async function writeAuditTemplateMetadata(deps, auth, spreadsheetId, templateRecord) {
  const { ensureColumns, getTabValues, rowsToRecords, withSheetsQuotaRetry, google } = deps;
  await ensureColumns(auth, spreadsheetId, AUDIT_TEMPLATES_TAB, AUDIT_TEMPLATES_COLUMNS);
  const sheets = google.sheets({ version: "v4", auth });
  const rows = rowsToRecords(await getTabValues(auth, spreadsheetId, AUDIT_TEMPLATES_TAB));
  const kept = rows.filter((row) => String(row["Audit ID"] || "").trim() !== templateRecord.id);
  const nextRow = [
    templateRecord.id,
    templateRecord.template_name,
    templateRecord.category,
    sheetStatusForTemplate(templateRecord),
    "",
    templateRecord.created_at,
    String(templateRecord.googleFormId || "").trim(),
    String(templateRecord.googleFormTemplateStatus || "Audit Builder").trim(),
    DEFAULT_FORM_LANGUAGE,
    DEFAULT_FORM_LANGUAGE,
    defaultTranslationStatusForLanguage(DEFAULT_FORM_LANGUAGE),
  ];
  const dataRows = kept.map((row) => AUDIT_TEMPLATES_COLUMNS.map((column) => String(row[column] || "")));
  dataRows.push(nextRow);
  const lastCol = String.fromCharCode(64 + AUDIT_TEMPLATES_COLUMNS.length);
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${AUDIT_TEMPLATES_TAB}!A:${lastCol}`,
    }),
  );
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${AUDIT_TEMPLATES_TAB}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [AUDIT_TEMPLATES_COLUMNS, ...dataRows],
      },
    }),
  );
}

async function syncTemplateToSheets(sheetDeps, authed, masterSheetId, templateId, payload, templateRecord, actorEmail) {
  await writeAuditTemplateMetadata(sheetDeps, authed, masterSheetId, templateRecord);
  await writeAuditTemplateTranslations(sheetDeps, authed, masterSheetId, templateId, payload, actorEmail);
}

function createTemplateVersionRecord(sourceTemplate, payload, actorEmail, newTemplateId) {
  const nextVersion = (Number(sourceTemplate.version) > 0 ? Number(sourceTemplate.version) : 1) + 1;
  const parentId = sourceTemplate.parent_template_id || sourceTemplate.id;
  return templateToApiRecord(newTemplateId, payload, actorEmail, {
    created_at: new Date().toISOString(),
    version: nextVersion,
    parent_template_id: parentId,
    status: "active",
  });
}

function sectionsFromQuestionsJson(questionsJson) {
  if (!questionsJson) {
    return [{ name: "General", questions: [] }];
  }
  try {
    const parsedQuestions = JSON.parse(questionsJson);
    const grouped = new Map();
    for (const item of Array.isArray(parsedQuestions) ? parsedQuestions : []) {
      const sectionName = String(item.section || "General").trim() || "General";
      if (!grouped.has(sectionName)) {
        grouped.set(sectionName, []);
      }
      grouped.get(sectionName).push({
        question_text: String(item.question_text || item.text || "").trim(),
        answer_type: String(item.answer_type || "compliance"),
        options: Array.isArray(item.options) ? item.options : ["Compliant", "Non-compliant", "Not applicable"],
        requires_comment_on_failure: item.requires_comment_on_failure !== false,
        requires_action_on_failure: item.requires_action_on_failure !== false,
        allows_photo_evidence: item.allows_photo_evidence !== false,
      });
    }
    const sections = [...grouped.entries()]
      .map(([name, questions]) => ({ name, questions: questions.filter((question) => question.question_text) }))
      .filter((section) => section.questions.length > 0);
    return sections.length > 0 ? sections : [{ name: "General", questions: [] }];
  } catch {
    return [{ name: "General", questions: [] }];
  }
}

async function loadTemplatesFromSheets(deps, auth, spreadsheetId, sessionDir) {
  const { readAuditTemplates } = await import("./company-audit-mapping.mjs");
  const sheetTemplates = await readAuditTemplates(deps, auth, spreadsheetId);
  const translations = await readAuditTemplateTranslations(deps, auth, spreadsheetId);
  const translationById = new Map(translations.map((row) => [row.bertTemplateId, row]));
  const { bucket, store, key } = getWorkspaceStore(sessionDir, spreadsheetId);

  for (const row of sheetTemplates) {
    const templateStatus = String(row.googleFormTemplateStatus || "").trim();
    const isAuditBuilder = templateStatus === "Audit Builder";
    const isGoogleFormImport = templateStatus === GOOGLE_FORM_IMPORT_STATUS;
    if (!isAuditBuilder && !isGoogleFormImport && !bucket.templates[row.id]) {
      continue;
    }
    const translation = translationById.get(row.id);
    const sections = sectionsFromQuestionsJson(translation?.questionsJson);
    const existing = bucket.templates[row.id] || {};
    const sheetStatus = String(row.status || "active").trim().toLowerCase();
    bucket.templates[row.id] = {
      id: row.id,
      template_name: row.name,
      description: translation?.description || existing.description || "",
      category: row.category || existing.category || "Audits",
      sections: existing.sections?.length ? existing.sections : sections,
      created_at: existing.created_at || row.createdAt || new Date().toISOString(),
      updated_at: existing.updated_at || row.createdAt || new Date().toISOString(),
      created_by: existing.created_by || "",
      question_count: (existing.sections || sections).reduce((sum, section) => sum + section.questions.length, 0),
      version: existing.version || 1,
      parent_template_id: existing.parent_template_id || null,
      status:
        existing.status ||
        (sheetStatus === "inactive" ? "inactive" : sheetStatus === "archived" ? "archived" : "active"),
    };
  }
  persistWorkspace(sessionDir, store, key, bucket);
  return Object.values(bucket.templates);
}

function evaluateCompletion(instance, answers, actions) {
  const answerList = Object.values(answers || {});
  const hasNonCompliant = answerList.some((answer) => answer.answer === COMPLIANCE_FAIL);
  const openActions = (actions || []).filter((action) => action.status !== "Closed");
  if (hasNonCompliant) {
    return { result: "Fail", reason: "One or more answers are Non-compliant." };
  }
  if (openActions.length > 0) {
    return { result: "Pass with actions", reason: "Pass with open corrective actions." };
  }
  const allPassOrNa = answerList.every(
    (answer) => answer.answer === COMPLIANCE_PASS || answer.answer === COMPLIANCE_NA,
  );
  if (allPassOrNa) {
    return { result: "Pass", reason: "All answers are Compliant or Not applicable with no open actions." };
  }
  return { result: "Fail", reason: "Audit answers are incomplete." };
}

export const GOOGLE_FORM_IMPORT_STATUS = "Google Form Import";

export function buildGoogleFormImportTemplatePayload(googleForm = {}) {
  const templateName = String(googleForm.name || "Google Form check").trim() || "Google Form check";
  const webViewLink = String(googleForm.webViewLink || "").trim();
  const description = webViewLink
    ? `Imported from Google Form. Complete the linked form: ${webViewLink}`
    : "Imported from Google Form.";
  const questionText = webViewLink
    ? `Complete linked Google Form (${webViewLink})`
    : "Complete linked Google Form";

  return {
    template_name: templateName,
    description,
    category: "Google Forms",
    sections: [
      {
        name: "Google Form",
        questions: [
          {
            question_text: questionText,
            answer_type: "compliance",
            options: ["Compliant", "Non-compliant", "Not applicable"],
            requires_comment_on_failure: true,
            requires_action_on_failure: true,
            allows_photo_evidence: true,
          },
        ],
      },
    ],
  };
}

export function mapImportedBertCheckForClient(templateRecord, googleForm = {}) {
  const webViewLink = String(googleForm.webViewLink || "").trim();
  const formId = String(googleForm.formId || googleForm.driveFileId || templateRecord.googleFormId || "").trim();
  const driveFileId = String(googleForm.driveFileId || formId).trim();
  const payload = buildGoogleFormImportTemplatePayload({ ...googleForm, name: templateRecord.template_name });
  const questions = flattenTemplateQuestions(payload.sections).map((question, index) => ({
    id: `${templateRecord.id}-q${index + 1}`,
    text: question.question_text,
    riskLevel: "Medium",
    riskCategory: "Quality",
    autoActionRequired: question.requires_action_on_failure !== false,
    requiresPhotoEvidence: question.allows_photo_evidence !== false,
    requiresManagerReview: false,
  }));

  return {
    id: templateRecord.id,
    name: templateRecord.template_name,
    active: normalizeTemplateStatus(templateRecord.status) === "active",
    source: "Google Drive",
    category: templateRecord.category || "Google Forms",
    language: DEFAULT_FORM_LANGUAGE,
    defaultLanguage: DEFAULT_FORM_LANGUAGE,
    translationStatus: defaultTranslationStatusForLanguage(DEFAULT_FORM_LANGUAGE),
    questions,
    googleForm: formId
      ? {
          formId,
          driveFileId,
          responderUrl: webViewLink,
          syncStatus: GOOGLE_FORM_IMPORT_STATUS,
          notes: payload.description,
        }
      : undefined,
  };
}

export async function createBertCheckFromSyncedGoogleForm({
  sessionDir,
  sheetDeps,
  authed,
  masterSheetId,
  actorEmail,
  googleForm,
}) {
  const sheetId = String(masterSheetId || "").trim();
  if (!sheetId) {
    throw new Error("masterSheetId is required to create a BERT check template.");
  }
  const formId = String(googleForm?.formId || googleForm?.driveFileId || "").trim();
  if (!formId) {
    throw new Error("Google Form ID is required.");
  }

  const { readAuditTemplates } = await import("./company-audit-mapping.mjs");
  const existingTemplates = await readAuditTemplates(sheetDeps, authed, sheetId);
  const duplicate = existingTemplates.find((row) => String(row.googleFormId || "").trim() === formId);
  if (duplicate) {
    const { bucket } = getWorkspaceStore(sessionDir, sheetId);
    const existingRecord = bucket.templates[duplicate.id] || {
      id: duplicate.id,
      template_name: duplicate.name,
      category: duplicate.category || "Google Forms",
      status: duplicate.status || "active",
      googleFormId: duplicate.googleFormId,
      googleFormTemplateStatus: duplicate.googleFormTemplateStatus || GOOGLE_FORM_IMPORT_STATUS,
    };
    return {
      ok: true,
      alreadyExists: true,
      template: mapImportedBertCheckForClient(existingRecord, googleForm),
    };
  }

  const payload = buildGoogleFormImportTemplatePayload(googleForm);
  const templateId = newId("gf-check");
  const { store, bucket, key } = getWorkspaceStore(sessionDir, sheetId);
  const record = templateToApiRecord(templateId, payload, actorEmail, { status: "active" });
  record.googleFormId = formId;
  record.googleFormTemplateStatus = GOOGLE_FORM_IMPORT_STATUS;
  bucket.templates[templateId] = record;
  persistWorkspace(sessionDir, store, key, bucket);

  await writeAuditTemplateMetadata(sheetDeps, authed, sheetId, record);
  await writeAuditTemplateTranslations(sheetDeps, authed, sheetId, templateId, payload, actorEmail);

  return {
    ok: true,
    alreadyExists: false,
    template: mapImportedBertCheckForClient(record, googleForm),
  };
}

export function installAuditBuilderRoutes(app, deps) {
  const {
    sessionDir,
    parseBertActorFromRequest,
    getAuthedClient,
    envConfigured,
    ensureColumns,
    getTabValues,
    rowsToRecords,
    withSheetsQuotaRetry,
    google,
    appendRowObjects,
  } = deps;

  const sheetDeps = {
    google,
    ensureColumns,
    getTabValues,
    rowsToRecords,
    withSheetsQuotaRetry,
  };

  const requireActor = (req, res, next) => requireAuditBuilderActor(req, res, next, parseBertActorFromRequest);

  app.post("/api/audits/templates/generate-from-text", requireActor, (req, res) => {
    try {
      const text = String(req.body?.text || "").trim();
      if (!text) {
        return res.status(400).json({ ok: false, error: "Checklist text is required." });
      }
      const template = parseChecklistText(text);
      return res.json({ ok: true, template });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to parse checklist text.",
      });
    }
  });

  app.get("/api/audits/templates", requireActor, async (req, res) => {
    try {
      const actor = req.auditBuilderActor;
      const masterSheetId = String(req.query?.masterSheetId || actor.masterSheetId || "").trim();
      const authed = getAuthedClient?.();
      if (envConfigured?.() && authed && masterSheetId && masterSheetId !== "local-dev") {
        await loadTemplatesFromSheets(sheetDeps, authed, masterSheetId, sessionDir);
        const { bucket } = getWorkspaceStore(sessionDir, masterSheetId);
        const templates = Object.values(bucket.templates)
          .map((template) => enrichTemplate(template, bucket))
          .filter((template) => template.status !== "archived");
        return res.json({ ok: true, templates });
      }
      const { bucket } = getWorkspaceStore(sessionDir, masterSheetId || "local-dev");
      const templates = Object.values(bucket.templates)
        .map((template) => enrichTemplate(template, bucket))
        .filter((template) => template.status !== "archived");
      return res.json({ ok: true, templates });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to list audit templates.",
      });
    }
  });

  app.get("/api/audits/templates/:id", requireActor, async (req, res) => {
    try {
      const actor = req.auditBuilderActor;
      const masterSheetId = String(req.query?.masterSheetId || actor.masterSheetId || "").trim() || "local-dev";
      const templateId = String(req.params.id || "").trim();
      const authed = getAuthedClient?.();
      if (envConfigured?.() && authed && masterSheetId && masterSheetId !== "local-dev") {
        await loadTemplatesFromSheets(sheetDeps, authed, masterSheetId, sessionDir);
      }
      const { bucket } = getWorkspaceStore(sessionDir, masterSheetId);
      const template = enrichTemplate(bucket.templates[templateId], bucket);
      if (!template) {
        return res.status(404).json({ ok: false, error: "Audit template not found." });
      }
      return res.json({ ok: true, template });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to load audit template.",
      });
    }
  });

  app.post("/api/audits/templates", requireActor, async (req, res) => {
    try {
      const actor = req.auditBuilderActor;
      const masterSheetId = String(req.body?.masterSheetId || actor.masterSheetId || "").trim() || "local-dev";
      const payload = normalizeTemplatePayload(req.body);
      const templateId = String(req.body?.id || "").trim() || newId("ab-template");
      const { store, bucket, key } = getWorkspaceStore(sessionDir, masterSheetId);
      const record = templateToApiRecord(templateId, payload, actor.email, {
        status: req.body?.status,
      });
      bucket.templates[templateId] = record;
      persistWorkspace(sessionDir, store, key, bucket);

      const authed = getAuthedClient?.();
      if (envConfigured?.() && authed && masterSheetId && masterSheetId !== "local-dev") {
        await syncTemplateToSheets(sheetDeps, authed, masterSheetId, templateId, payload, record, actor.email);
      }

      return res.json({ ok: true, template: enrichTemplate(record, bucket) });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to save audit template.",
      });
    }
  });

  app.patch("/api/audits/templates/:id", requireActor, async (req, res) => {
    try {
      const actor = req.auditBuilderActor;
      const masterSheetId = String(req.body?.masterSheetId || actor.masterSheetId || "").trim() || "local-dev";
      const templateId = String(req.params.id || "").trim();
      const createNewVersion = Boolean(req.body?.create_new_version);
      const payload = normalizeTemplatePayload(req.body);
      const requestedStatus = normalizeTemplateStatus(req.body?.status);

      const { store, bucket, key } = getWorkspaceStore(sessionDir, masterSheetId);
      const existing = bucket.templates[templateId];
      if (!existing) {
        return res.status(404).json({ ok: false, error: "Audit template not found." });
      }

      const isUsed = templateIsUsed(bucket, templateId);
      if (isUsed && !createNewVersion) {
        return res.status(409).json({
          ok: false,
          error:
            "This template has already been used. Saving changes will create a new version for future audits. Existing audit records will not be changed.",
          is_used: true,
          requires_new_version: true,
        });
      }

      let record;
      let targetTemplateId = templateId;
      if (isUsed && createNewVersion) {
        targetTemplateId = newId("ab-template");
        record = createTemplateVersionRecord(existing, { ...payload, status: "active" }, actor.email, targetTemplateId);
        bucket.templates[targetTemplateId] = record;
        const archivedPrevious = {
          ...existing,
          status: "archived",
          updated_at: new Date().toISOString(),
        };
        bucket.templates[templateId] = archivedPrevious;
      } else {
        record = templateToApiRecord(templateId, { ...payload, status: requestedStatus }, actor.email, {
          created_at: existing.created_at,
          version: existing.version || 1,
          parent_template_id: existing.parent_template_id || null,
          status: requestedStatus,
        });
        bucket.templates[templateId] = record;
      }
      persistWorkspace(sessionDir, store, key, bucket);

      const authed = getAuthedClient?.();
      if (envConfigured?.() && authed && masterSheetId && masterSheetId !== "local-dev") {
        if (isUsed && createNewVersion) {
          await writeAuditTemplateMetadata(sheetDeps, authed, masterSheetId, bucket.templates[templateId]);
          await syncTemplateToSheets(sheetDeps, authed, masterSheetId, targetTemplateId, payload, record, actor.email);
        } else {
          await syncTemplateToSheets(sheetDeps, authed, masterSheetId, targetTemplateId, payload, record, actor.email);
        }
      }

      return res.json({ ok: true, template: enrichTemplate(record, bucket) });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to update audit template.",
      });
    }
  });

  app.post("/api/audits/templates/:id/new-version", requireActor, async (req, res) => {
    try {
      const actor = req.auditBuilderActor;
      const masterSheetId = String(req.body?.masterSheetId || actor.masterSheetId || "").trim() || "local-dev";
      const templateId = String(req.params.id || "").trim();
      const payload = normalizeTemplatePayload(req.body);
      const requestedStatus = normalizeTemplateStatus(req.body?.status || "active");

      const { store, bucket, key } = getWorkspaceStore(sessionDir, masterSheetId);
      const existing = bucket.templates[templateId];
      if (!existing) {
        return res.status(404).json({ ok: false, error: "Audit template not found." });
      }

      const newTemplateId = newId("ab-template");
      const record = createTemplateVersionRecord(
        existing,
        { ...payload, status: requestedStatus },
        actor.email,
        newTemplateId,
      );
      bucket.templates[newTemplateId] = record;
      bucket.templates[templateId] = {
        ...existing,
        status: "archived",
        updated_at: new Date().toISOString(),
      };
      persistWorkspace(sessionDir, store, key, bucket);

      const authed = getAuthedClient?.();
      if (envConfigured?.() && authed && masterSheetId && masterSheetId !== "local-dev") {
        await writeAuditTemplateMetadata(sheetDeps, authed, masterSheetId, bucket.templates[templateId]);
        await syncTemplateToSheets(sheetDeps, authed, masterSheetId, newTemplateId, payload, record, actor.email);
      }

      return res.json({ ok: true, template: enrichTemplate(record, bucket) });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to create template version.",
      });
    }
  });

  app.post("/api/audits/templates/:id/duplicate", requireActor, async (req, res) => {
    try {
      const actor = req.auditBuilderActor;
      const masterSheetId = String(req.body?.masterSheetId || actor.masterSheetId || "").trim() || "local-dev";
      const templateId = String(req.params.id || "").trim();

      const { store, bucket, key } = getWorkspaceStore(sessionDir, masterSheetId);
      const existing = bucket.templates[templateId];
      if (!existing) {
        return res.status(404).json({ ok: false, error: "Audit template not found." });
      }

      const duplicateId = newId("ab-template");
      const payload = {
        template_name: `${existing.template_name} (Copy)`,
        description: existing.description || "",
        category: existing.category || "Audits",
        sections: existing.sections,
        status: "active",
      };
      const record = templateToApiRecord(duplicateId, payload, actor.email, {
        version: 1,
        parent_template_id: null,
        status: "active",
      });
      bucket.templates[duplicateId] = record;
      persistWorkspace(sessionDir, store, key, bucket);

      const authed = getAuthedClient?.();
      if (envConfigured?.() && authed && masterSheetId && masterSheetId !== "local-dev") {
        await syncTemplateToSheets(sheetDeps, authed, masterSheetId, duplicateId, payload, record, actor.email);
      }

      return res.json({ ok: true, template: enrichTemplate(record, bucket) });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to duplicate audit template.",
      });
    }
  });

  app.post("/api/audits/templates/:id/archive", requireActor, async (req, res) => {
    try {
      const actor = req.auditBuilderActor;
      const masterSheetId = String(req.body?.masterSheetId || actor.masterSheetId || "").trim() || "local-dev";
      const templateId = String(req.params.id || "").trim();

      const { store, bucket, key } = getWorkspaceStore(sessionDir, masterSheetId);
      const existing = bucket.templates[templateId];
      if (!existing) {
        return res.status(404).json({ ok: false, error: "Audit template not found." });
      }

      const record = {
        ...existing,
        status: "archived",
        updated_at: new Date().toISOString(),
      };
      bucket.templates[templateId] = record;
      persistWorkspace(sessionDir, store, key, bucket);

      const authed = getAuthedClient?.();
      if (envConfigured?.() && authed && masterSheetId && masterSheetId !== "local-dev") {
        await writeAuditTemplateMetadata(sheetDeps, authed, masterSheetId, record);
      }

      return res.json({ ok: true, template: enrichTemplate(record, bucket) });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to archive audit template.",
      });
    }
  });

  app.post("/api/audits/templates/:id/start", requireActor, (req, res) => {
    try {
      const actor = req.auditBuilderActor;
      const masterSheetId = String(req.body?.masterSheetId || actor.masterSheetId || "").trim() || "local-dev";
      const templateId = String(req.params.id || "").trim();
      const { store, bucket, key } = getWorkspaceStore(sessionDir, masterSheetId);
      const template = bucket.templates[templateId];
      if (!template) {
        return res.status(404).json({ ok: false, error: "Audit template not found." });
      }
      const instanceId = newId("ab-instance");
      const instance = {
        id: instanceId,
        template_id: templateId,
        template_name: template.template_name,
        status: "in_progress",
        started_at: new Date().toISOString(),
        started_by: actor.email,
        master_sheet_id: masterSheetId,
      };
      bucket.instances[instanceId] = instance;
      bucket.answers[instanceId] = {};
      bucket.actions[instanceId] = [];
      persistWorkspace(sessionDir, store, key, bucket);
      return res.json({ ok: true, instance, template });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to start audit instance.",
      });
    }
  });

  app.post("/api/audits/:id/answers", requireActor, (req, res) => {
    try {
      const actor = req.auditBuilderActor;
      const masterSheetId = String(req.body?.masterSheetId || actor.masterSheetId || "").trim() || "local-dev";
      const instanceId = String(req.params.id || "").trim();
      const questionId = String(req.body?.question_id || req.body?.questionId || "").trim();
      const answer = String(req.body?.answer || "").trim();
      const comment = String(req.body?.comment || "").trim();
      const photoEvidence = Boolean(req.body?.photo_evidence || req.body?.photoEvidence);

      if (!questionId || !answer) {
        return res.status(400).json({ ok: false, error: "question_id and answer are required." });
      }

      const { store, bucket, key } = getWorkspaceStore(sessionDir, masterSheetId);
      const instance = bucket.instances[instanceId];
      if (!instance) {
        return res.status(404).json({ ok: false, error: "Audit instance not found." });
      }
      const template = bucket.templates[instance.template_id];
      const flatQuestions = template ? flattenTemplateQuestions(template.sections) : [];
      const question = flatQuestions.find((item) => item.id === questionId);

      if (!bucket.answers[instanceId]) {
        bucket.answers[instanceId] = {};
      }
      bucket.answers[instanceId][questionId] = {
        question_id: questionId,
        answer,
        comment,
        photo_evidence: photoEvidence,
        updated_at: new Date().toISOString(),
        updated_by: actor.email,
      };

      if (!bucket.actions[instanceId]) {
        bucket.actions[instanceId] = [];
      }

      let createdAction = null;
      if (answer === COMPLIANCE_FAIL && question?.requires_action_on_failure !== false) {
        const existing = bucket.actions[instanceId].find(
          (action) => action.question_id === questionId && action.status !== "Closed",
        );
        if (!existing) {
          createdAction = {
            id: newId("ab-action"),
            audit_instance_id: instanceId,
            question_id: questionId,
            question_text: question?.question_text || questionId,
            status: "Open",
            created_at: new Date().toISOString(),
            created_by: actor.email,
            requires_comment: question?.requires_comment_on_failure !== false,
            requires_photo: question?.allows_photo_evidence !== false,
          };
          bucket.actions[instanceId].push(createdAction);
        }
      }

      persistWorkspace(sessionDir, store, key, bucket);
      return res.json({
        ok: true,
        answer: bucket.answers[instanceId][questionId],
        action: createdAction,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to save audit answer.",
      });
    }
  });

  app.post("/api/audits/:id/complete", requireActor, async (req, res) => {
    try {
      const actor = req.auditBuilderActor;
      const masterSheetId = String(req.body?.masterSheetId || actor.masterSheetId || "").trim() || "local-dev";
      const instanceId = String(req.params.id || "").trim();
      const { store, bucket, key } = getWorkspaceStore(sessionDir, masterSheetId);
      const instance = bucket.instances[instanceId];
      if (!instance) {
        return res.status(404).json({ ok: false, error: "Audit instance not found." });
      }

      const answers = bucket.answers[instanceId] || {};
      const actions = bucket.actions[instanceId] || [];
      const evaluation = evaluateCompletion(instance, answers, actions);
      instance.status = "completed";
      instance.completed_at = new Date().toISOString();
      instance.completed_by = actor.email;
      instance.result = evaluation.result;
      instance.result_reason = evaluation.reason;
      bucket.instances[instanceId] = instance;
      persistWorkspace(sessionDir, store, key, bucket);

      const authed = getAuthedClient?.();
      if (envConfigured?.() && authed && masterSheetId && masterSheetId !== "local-dev" && appendRowObjects) {
        const answersJson = JSON.stringify(Object.values(answers));
        await appendRowObjects(authed, masterSheetId, "AuditResults", [
          {
            "Result ID": newId("result"),
            "Local Submission ID": instanceId,
            "Audit ID": instance.template_id,
            "Area ID": "area-main",
            "Company ID": masterSheetId,
            "Audit Name": instance.template_name,
            "Completed By": actor.email,
            "Completed At": instance.completed_at,
            Status: evaluation.result,
            "Answers JSON": answersJson,
            "Created At": instance.completed_at,
            "Updated At": instance.completed_at,
            "Created By": actor.email,
            "Updated By": actor.email,
            "Sync Status": "synced",
          },
        ]);
        const openActions = actions.filter((action) => action.status !== "Closed");
        if (openActions.length > 0) {
          await appendRowObjects(authed, masterSheetId, "Actions", openActions.map((action) => ({
            "Action ID": action.id,
            "Company ID": masterSheetId,
            "Source Audit ID": instance.template_id,
            "Source Audit Name": instance.template_name,
            "Source Question ID": action.question_id,
            "Source Question Text": action.question_text,
            "Source Answer": COMPLIANCE_FAIL,
            Status: "Open",
            "Assigned To Name": "",
            "Created By User ID": actor.email,
            "Created At": action.created_at,
            "Updated At": action.created_at,
            Comments: action.requires_comment ? "Comment required on non-compliance." : "",
            "Sync Status": "synced",
          })));
        }
      }

      return res.json({ ok: true, instance, evaluation });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to complete audit.",
      });
    }
  });
}
