/**
 * Backend Google Form template copies for BERT check templates.
 * Server-side only — uses workspace OAuth; never exposes tokens to clients.
 */

export const GOOGLE_FORM_TEMPLATES_TAB = "GoogleFormTemplates";

export const GOOGLE_FORM_TEMPLATES_COLUMNS = [
  "BERT Template ID",
  "Template Name",
  "Source Company ID",
  "Source Company Name",
  "Category",
  "Google Form ID",
  "Google Form Drive File ID",
  "Google Form Edit URL",
  "Google Form Responder URL",
  "Parent Drive Folder ID",
  "Parent Drive Folder Name",
  "Current Drive Folder ID",
  "Current Drive Folder Name",
  "Created By",
  "Created At",
  "Last Synced At",
  "Sync Status",
  "Reusable Template",
  "Notes",
];

export const MASTER_TEMPLATES_ROOT_NAME = "BERT Master Templates";
export const REGISTRY_SPREADSHEET_NAME = "BERT Google Form Templates Registry";

export const TEMPLATE_CATEGORY_FOLDERS = [
  "Google Forms",
  "ISO 9001",
  "ISO 14001",
  "ISO 45001",
  "Health & Safety",
  "COSHH",
  "Risk Assessments",
  "Audits",
  "General",
];

/** Category subfolders created under a configured master templates folder. */
export const CONFIGURED_TEMPLATE_CATEGORY_FOLDERS = [
  "ISO 9001",
  "ISO 14001",
  "ISO 45001",
  "Health & Safety",
  "COSHH",
  "Risk Assessments",
  "Audits",
  "General",
];

export function getConfiguredGoogleFormTemplatesFolderId() {
  return String(process.env.BERT_GOOGLE_FORM_TEMPLATES_FOLDER_ID || "").trim();
}

export const GOOGLE_FORMS_BODY_SCOPE = "https://www.googleapis.com/auth/forms.body";

const CATEGORY_ALIASES = {
  "iso9001": "ISO 9001",
  "iso 9001": "ISO 9001",
  "iso14001": "ISO 14001",
  "iso 14001": "ISO 14001",
  "iso45001": "ISO 45001",
  "iso 45001": "ISO 45001",
  "health and safety": "Health & Safety",
  "health & safety": "Health & Safety",
  "h&s": "Health & Safety",
  coshh: "COSHH",
  "risk assessment": "Risk Assessments",
  "risk assessments": "Risk Assessments",
  audit: "Audits",
  audits: "Audits",
  general: "General",
};

function safeLower(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTemplateCategory(category = "") {
  const raw = String(category || "").trim();
  if (!raw) return "General";
  const key = safeLower(raw);
  if (CATEGORY_ALIASES[key]) return CATEGORY_ALIASES[key];
  const match = TEMPLATE_CATEGORY_FOLDERS.find((name) => safeLower(name) === key);
  if (match) return match;
  const partial = TEMPLATE_CATEGORY_FOLDERS.find((name) => key.includes(safeLower(name)) || safeLower(name).includes(key));
  return partial || "General";
}

function buildFormEditUrl(formId) {
  const clean = String(formId || "").trim();
  if (!clean) return "";
  return `https://docs.google.com/forms/d/${clean}/edit`;
}

function buildFormResponderUrl(formId) {
  const clean = String(formId || "").trim();
  if (!clean) return "";
  if (clean.startsWith("1FAIpQL")) {
    return `https://docs.google.com/forms/d/e/${clean}/viewform`;
  }
  return `https://docs.google.com/forms/d/${clean}/viewform`;
}

export function isGoogleFormsPermissionError(error) {
  if (!error) return false;
  const status = error.code ?? error.response?.status ?? error.status;
  if (status === 403 || status === 401) return true;
  const msg = String(error.message || error.response?.data?.error?.message || "");
  return /insufficient|scope|permission|forms\.body|access not configured/i.test(msg);
}

function recordsFromRows(headers, rows) {
  if (!headers.length) return [];
  return rows.map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[String(header || "").trim()] = row[index] ?? "";
    });
    return record;
  });
}

function rowToGoogleFormTemplate(record) {
  const templateId = String(record["BERT Template ID"] || "").trim();
  if (!templateId) return null;
  return {
    bertTemplateId: templateId,
    templateName: String(record["Template Name"] || "").trim(),
    sourceCompanyId: String(record["Source Company ID"] || "").trim(),
    sourceCompanyName: String(record["Source Company Name"] || "").trim(),
    category: String(record.Category || "").trim(),
    googleFormId: String(record["Google Form ID"] || "").trim(),
    googleFormDriveFileId: String(record["Google Form Drive File ID"] || "").trim(),
    googleFormEditUrl: String(record["Google Form Edit URL"] || "").trim(),
    googleFormResponderUrl: String(record["Google Form Responder URL"] || "").trim(),
    parentDriveFolderId: String(record["Parent Drive Folder ID"] || "").trim(),
    parentDriveFolderName: String(record["Parent Drive Folder Name"] || "").trim(),
    currentDriveFolderId: String(record["Current Drive Folder ID"] || "").trim(),
    currentDriveFolderName: String(record["Current Drive Folder Name"] || "").trim(),
    createdBy: String(record["Created By"] || "").trim(),
    createdAt: String(record["Created At"] || "").trim(),
    lastSyncedAt: String(record["Last Synced At"] || "").trim(),
    syncStatus: String(record["Sync Status"] || "").trim(),
    reusableTemplate: String(record["Reusable Template"] || "").trim(),
    notes: String(record.Notes || "").trim(),
  };
}

function templateToSheetRow(template) {
  return [
    template.bertTemplateId,
    template.templateName,
    template.sourceCompanyId,
    template.sourceCompanyName,
    template.category,
    template.googleFormId,
    template.googleFormDriveFileId,
    template.googleFormEditUrl,
    template.googleFormResponderUrl,
    template.parentDriveFolderId,
    template.parentDriveFolderName,
    template.currentDriveFolderId,
    template.currentDriveFolderName,
    template.createdBy,
    template.createdAt,
    template.lastSyncedAt,
    template.syncStatus,
    template.reusableTemplate,
    template.notes,
  ];
}

function mapBertQuestionToFormRequest(question, index) {
  const title = String(question?.text || question?.label || "").trim() || `Question ${index + 1}`;
  const fieldType = String(question?.fieldType || question?.type || "").trim();
  const normalized = safeLower(fieldType);

  if (normalized.includes("paragraph") || normalized === "text note") {
    return {
      createItem: {
        item: {
          title,
          questionItem: {
            question: {
              required: false,
              textQuestion: { paragraph: true },
            },
          },
        },
        location: { index },
      },
    };
  }

  if (normalized.includes("date")) {
    return {
      createItem: {
        item: {
          title,
          questionItem: {
            question: {
              required: false,
              dateQuestion: { includeTime: false, includeYear: true },
            },
          },
        },
        location: { index },
      },
    };
  }

  if (normalized.includes("number")) {
    return {
      createItem: {
        item: {
          title,
          questionItem: {
            question: {
              required: false,
              textQuestion: { paragraph: false },
            },
          },
        },
        location: { index },
      },
    };
  }

  if (
    normalized.includes("multiple") ||
    normalized.includes("checkbox") ||
    (Array.isArray(question?.options) && question.options.length > 1 && normalized.includes("choice"))
  ) {
    const options = (question.options || ["Option 1", "Option 2"]).map((value) => ({
      value: String(value),
    }));
    return {
      createItem: {
        item: {
          title,
          questionItem: {
            question: {
              required: false,
              choiceQuestion: {
                type: "CHECKBOX",
                options,
              },
            },
          },
        },
        location: { index },
      },
    };
  }

  if (
    normalized.includes("traffic") ||
    normalized.includes("pass") ||
    normalized.includes("fail") ||
    normalized.includes("yes") ||
    normalized.includes("single") ||
    normalized.includes("choice") ||
    normalized.includes("radio")
  ) {
    let options = [];
    if (normalized.includes("traffic")) {
      options = [{ value: "Pass" }, { value: "NC" }, { value: "Fail" }];
    } else if (normalized.includes("pass") && normalized.includes("fail")) {
      options = [{ value: "Pass" }, { value: "Fail" }];
    } else if (Array.isArray(question?.options) && question.options.length > 0) {
      options = question.options.map((value) => ({ value: String(value) }));
    } else {
      options = [{ value: "Yes" }, { value: "No" }];
    }
    return {
      createItem: {
        item: {
          title,
          questionItem: {
            question: {
              required: false,
              choiceQuestion: {
                type: "RADIO",
                options,
              },
            },
          },
        },
        location: { index },
      },
    };
  }

  if (normalized.includes("photo") || normalized.includes("evidence") || normalized.includes("signature")) {
    return null;
  }

  return {
    createItem: {
      item: {
        title,
        questionItem: {
          question: {
            required: false,
            textQuestion: { paragraph: false },
          },
        },
      },
      location: { index },
    },
  };
}

export function buildGoogleFormBatchRequests(questions = []) {
  const skipped = [];
  const requests = [];
  let index = 0;
  for (const question of questions) {
    const mapped = mapBertQuestionToFormRequest(question, index);
    if (!mapped) {
      skipped.push(String(question?.text || question?.id || `Question ${index + 1}`));
      continue;
    }
    requests.push(mapped);
    index += 1;
  }
  return { requests, skipped };
}

async function listChildFolders(drive, parentId) {
  const response = await drive.files.list({
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 200,
    orderBy: "name_natural",
  });
  return response.data.files || [];
}

async function findFolderByName(drive, parentId, name) {
  const folders = await listChildFolders(drive, parentId);
  const target = safeLower(name);
  return folders.find((folder) => safeLower(folder.name) === target) || null;
}

async function ensureFolder(drive, name, parentId) {
  const existing = await findFolderByName(drive, parentId, name);
  if (existing?.id) {
    return existing;
  }
  const created = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id,name",
  });
  return created.data;
}

async function getDriveFolderById(drive, folderId) {
  const folder = await drive.files.get({
    fileId: folderId,
    supportsAllDrives: true,
    fields: "id,name",
  });
  return folder.data;
}

async function findMasterTemplatesRoot(drive, sharedDriveId) {
  const configuredRoot = String(process.env.BERT_MASTER_TEMPLATES_FOLDER_ID || "").trim();
  if (configuredRoot) {
    try {
      return await getDriveFolderById(drive, configuredRoot);
    } catch {
      /* fall through to discovery */
    }
  }

  const search = await drive.files.list({
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    q: `'${sharedDriveId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 200,
  });
  const files = search.data.files || [];
  return (
    files.find((file) => safeLower(file.name) === safeLower(MASTER_TEMPLATES_ROOT_NAME)) ||
    files.find((file) => safeLower(file.name).includes("bert master templates")) ||
    null
  );
}

async function resolveConfiguredGoogleFormTemplatesRoot(drive) {
  const configuredId = getConfiguredGoogleFormTemplatesFolderId();
  if (!configuredId) return null;
  try {
    return await getDriveFolderById(drive, configuredId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Configured folder not found";
    throw new Error(`BERT_GOOGLE_FORM_TEMPLATES_FOLDER_ID is invalid or inaccessible: ${message}`);
  }
}

async function ensureConfiguredCategorySubfolders(drive, rootId) {
  for (const name of CONFIGURED_TEMPLATE_CATEGORY_FOLDERS) {
    await ensureFolder(drive, name, rootId);
  }
}

/**
 * Resolves the parent folder for Google Form template copies.
 * When BERT_GOOGLE_FORM_TEMPLATES_FOLDER_ID is set, uses that folder and does not create BERT Master Templates.
 */
export async function resolveGoogleFormTemplatesRoot(drive, sharedDriveId) {
  const configured = await resolveConfiguredGoogleFormTemplatesRoot(drive);
  if (configured?.id) {
    return { root: configured, usesConfiguredRoot: true };
  }

  if (!sharedDriveId) {
    throw new Error("GOOGLE_SHARED_DRIVE_ID is not configured.");
  }

  const discovered =
    (await findMasterTemplatesRoot(drive, sharedDriveId)) ||
    (await ensureFolder(drive, MASTER_TEMPLATES_ROOT_NAME, sharedDriveId));
  return {
    root: discovered,
    usesConfiguredRoot: false,
  };
}

export async function ensureGoogleFormTemplateFolders(auth, category, { sharedDriveId, drive }) {
  const driveApi = drive || auth;
  const { root, usesConfiguredRoot } = await resolveGoogleFormTemplatesRoot(driveApi, sharedDriveId);

  if (usesConfiguredRoot) {
    await ensureConfiguredCategorySubfolders(driveApi, root.id);
  }

  const categoryName = normalizeTemplateCategory(category);
  const categoryFolder = await ensureFolder(driveApi, categoryName, root.id);
  return {
    rootId: root.id,
    rootName: root.name || (usesConfiguredRoot ? root.id : MASTER_TEMPLATES_ROOT_NAME),
    parentDriveFolderId: root.id,
    parentDriveFolderName: root.name || (usesConfiguredRoot ? "" : MASTER_TEMPLATES_ROOT_NAME),
    categoryFolderId: categoryFolder.id,
    categoryFolderName: categoryFolder.name || categoryName,
  };
}

export function createGoogleFormTemplatesApi({ google, getAuthedClient, envConfigured, withSheetsQuotaRetry, requiredEnv }) {
  function driveClient(auth) {
    return google.drive({ version: "v3", auth });
  }

  function formsClient(auth) {
    return google.forms({ version: "v1", auth });
  }

  function sheetsClient(auth) {
    return google.sheets({ version: "v4", auth });
  }

  async function resolveRegistrySpreadsheetId(auth) {
    const configured = String(process.env.BERT_GOOGLE_FORM_TEMPLATES_SHEET_ID || "").trim();
    if (configured) return configured;

    const drive = driveClient(auth);
    const sharedDriveId = requiredEnv.GOOGLE_SHARED_DRIVE_ID;
    const { root } = await resolveGoogleFormTemplatesRoot(drive, sharedDriveId);
    if (!root?.id) {
      throw new Error("Unable to resolve Google Form templates root folder.");
    }

    const children = await drive.files.list({
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      q: `'${root.id}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
      fields: "files(id,name)",
      pageSize: 50,
    });
    const files = children.data.files || [];
    const existing =
      files.find((file) => safeLower(file.name) === safeLower(REGISTRY_SPREADSHEET_NAME)) ||
      files.find((file) => safeLower(file.name).includes("google form templates registry"));
    if (existing?.id) return existing.id;

    const created = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: REGISTRY_SPREADSHEET_NAME,
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [root.id],
      },
      fields: "id,name",
    });
    return created.data.id;
  }

  async function ensureRegistryTab(auth, spreadsheetId) {
    const sheets = sheetsClient(auth);
    const workbook = await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets(properties(title))",
      }),
    );
    const titles = (workbook.data.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean);
    if (!titles.includes(GOOGLE_FORM_TEMPLATES_TAB)) {
      await withSheetsQuotaRetry(() =>
        sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{ addSheet: { properties: { title: GOOGLE_FORM_TEMPLATES_TAB } } }],
          },
        }),
      );
    }
    await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${GOOGLE_FORM_TEMPLATES_TAB}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [GOOGLE_FORM_TEMPLATES_COLUMNS] },
      }),
    );
  }

  async function readRegistryRows(auth, spreadsheetId) {
    await ensureRegistryTab(auth, spreadsheetId);
    const sheets = sheetsClient(auth);
    const response = await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${GOOGLE_FORM_TEMPLATES_TAB}!A1:ZZ2000`,
      }),
    );
    const values = response.data.values || [];
    const [headers = [], ...rows] = values;
    return recordsFromRows(headers.map((h) => String(h)), rows).map(rowToGoogleFormTemplate).filter(Boolean);
  }

  async function writeRegistryRows(auth, spreadsheetId, templates) {
    await ensureRegistryTab(auth, spreadsheetId);
    const sheets = sheetsClient(auth);
    const lastCol = String.fromCharCode(64 + GOOGLE_FORM_TEMPLATES_COLUMNS.length);
    await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${GOOGLE_FORM_TEMPLATES_TAB}!A:${lastCol}`,
      }),
    );
    await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${GOOGLE_FORM_TEMPLATES_TAB}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [GOOGLE_FORM_TEMPLATES_COLUMNS, ...templates.map(templateToSheetRow)],
        },
      }),
    );
  }

  async function upsertRegistryRow(auth, spreadsheetId, row) {
    const existing = await readRegistryRows(auth, spreadsheetId);
    const next = existing.filter((item) => item.bertTemplateId !== row.bertTemplateId);
    next.unshift(row);
    await writeRegistryRows(auth, spreadsheetId, next);
    return row;
  }

  async function createGoogleFormFromBertTemplate(template) {
    const auth = getAuthedClient();
    if (!envConfigured() || !auth) {
      return {
        ok: false,
        permissionRequired: true,
        error: "Google Forms permission is not connected yet.",
        scopeHint: GOOGLE_FORMS_BODY_SCOPE,
      };
    }

    const drive = driveClient(auth);

    const bertTemplateId = String(template?.id || template?.bertTemplateId || "").trim();
    const templateName = String(template?.name || template?.templateName || "BERT Template").trim();
    const category = normalizeTemplateCategory(template?.category || template?.source || "");
    const questions = Array.isArray(template?.questions) ? template.questions : [];
    const createdBy = String(template?.createdBy || "BERT").trim();
    const sourceCompanyId = String(template?.sourceCompanyId || "").trim();
    const sourceCompanyName = String(template?.sourceCompanyName || "").trim();
    const now = new Date().toISOString();

    if (!bertTemplateId) {
      return { ok: false, error: "BERT template id is required." };
    }

    try {
      const registrySpreadsheetId = await resolveRegistrySpreadsheetId(auth);
      const folders = await ensureGoogleFormTemplateFolders(auth, category, {
        sharedDriveId: requiredEnv.GOOGLE_SHARED_DRIVE_ID,
        drive,
      });

      const forms = formsClient(auth);
      const createdForm = await forms.forms.create({
        requestBody: {
          info: {
            title: templateName,
            documentTitle: templateName,
          },
        },
      });

      const formId = String(createdForm.data.formId || "").trim();
      const { requests, skipped } = buildGoogleFormBatchRequests(questions);
      if (requests.length > 0) {
        await forms.forms.batchUpdate({
          formId,
          requestBody: { requests },
        });
      }

      const formFileId = formId;

      let syncStatus = skipped.length > 0 ? "Created with skipped fields" : "Created";
      let notes = skipped.length > 0 ? `Skipped BERT-only fields: ${skipped.join("; ")}` : "";

      if (formFileId) {
        try {
          await moveGoogleFormToTemplateFolder(auth, formFileId, folders.categoryFolderId, { drive });
          syncStatus = skipped.length > 0 ? "Created with skipped fields" : "Created";
        } catch (moveError) {
          syncStatus = "Created - move failed";
          notes = [notes, moveError instanceof Error ? moveError.message : "Move failed"].filter(Boolean).join(" | ");
        }
      } else {
        syncStatus = "Created - drive file not resolved";
        notes = [notes, "Could not resolve Drive file id for created form."].filter(Boolean).join(" | ");
      }

      const record = {
        bertTemplateId,
        templateName,
        sourceCompanyId,
        sourceCompanyName,
        category,
        googleFormId: formId,
        googleFormDriveFileId: formFileId,
        googleFormEditUrl: buildFormEditUrl(formId),
        googleFormResponderUrl: buildFormResponderUrl(formId),
        parentDriveFolderId: folders.parentDriveFolderId,
        parentDriveFolderName: folders.parentDriveFolderName,
        currentDriveFolderId: folders.categoryFolderId,
        currentDriveFolderName: folders.categoryFolderName,
        createdBy,
        createdAt: now,
        lastSyncedAt: now,
        syncStatus,
        reusableTemplate: "yes",
        notes,
      };

      await upsertRegistryRow(auth, registrySpreadsheetId, record);

      return {
        ok: true,
        bertTemplateCreated: true,
        googleForm: record,
        registrySpreadsheetId,
        skippedFields: skipped,
      };
    } catch (error) {
      if (isGoogleFormsPermissionError(error)) {
        return {
          ok: false,
          permissionRequired: true,
          error: "Google Forms permission is not connected yet.",
          scopeHint: GOOGLE_FORMS_BODY_SCOPE,
          bertTemplateCreated: true,
        };
      }
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Google Form creation failed",
        syncStatus: "Google Form creation failed",
        bertTemplateCreated: true,
      };
    }
  }

  async function moveGoogleFormToTemplateFolder(auth, formFileId, folderId, options = {}) {
    const drive = options.drive || driveClient(auth);
    const fileId = String(formFileId || "").trim();
    const targetFolderId = String(folderId || "").trim();
    if (!fileId || !targetFolderId) {
      throw new Error("formFileId and folderId are required.");
    }
    const current = await drive.files.get({
      fileId,
      supportsAllDrives: true,
      fields: "id,parents",
    });
    const previousParents = (current.data.parents || []).join(",");
    await drive.files.update({
      fileId,
      supportsAllDrives: true,
      addParents: targetFolderId,
      removeParents: previousParents || undefined,
      fields: "id,parents",
    });
    const folder = await drive.files.get({
      fileId: targetFolderId,
      supportsAllDrives: true,
      fields: "id,name",
    });
    return {
      formFileId: fileId,
      folderId: targetFolderId,
      folderName: folder.data.name || "",
    };
  }

  async function copyGoogleFormTemplateToCompany(formTemplateId, targetCompanyFolderId) {
    const auth = getAuthedClient();
    if (!envConfigured() || !auth) {
      return { ok: false, error: "Google connection required." };
    }
    const drive = driveClient(auth);
    const registrySpreadsheetId = await resolveRegistrySpreadsheetId(auth);
    const rows = await readRegistryRows(auth, registrySpreadsheetId);
    const source = rows.find((row) => row.bertTemplateId === String(formTemplateId || "").trim());
    if (!source?.googleFormDriveFileId) {
      return { ok: false, error: "Google Form template not found in registry." };
    }

    const copied = await drive.files.copy({
      fileId: source.googleFormDriveFileId,
      supportsAllDrives: true,
      requestBody: {
        name: `${source.templateName} (company copy)`,
        parents: [String(targetCompanyFolderId || "").trim()],
      },
      fields: "id,name",
    });

    const copiedFileId = String(copied.data.id || "").trim();
    let copiedFormId = source.googleFormId;
    try {
      const meta = await drive.files.get({
        fileId: copiedFileId,
        supportsAllDrives: true,
        fields: "id,name,mimeType",
      });
      if (meta.data.mimeType === "application/vnd.google-apps.form") {
        const forms = formsClient(auth);
        const formMeta = await forms.forms.get({ formId: copiedFileId });
        copiedFormId = String(formMeta.data.formId || copiedFileId).trim();
      }
    } catch {
      /* keep source form id */
    }

    return {
      ok: true,
      sourceTemplateId: source.bertTemplateId,
      companyFolderId: targetCompanyFolderId,
      googleFormDriveFileId: copiedFileId,
      googleFormId: copiedFormId,
      googleFormEditUrl: buildFormEditUrl(copiedFormId),
      googleFormResponderUrl: buildFormResponderUrl(copiedFormId),
    };
  }

  async function listGoogleFormTemplates() {
    const auth = getAuthedClient();
    if (!envConfigured() || !auth) {
      return { ok: false, error: "Google connection required.", templates: [] };
    }
    const registrySpreadsheetId = await resolveRegistrySpreadsheetId(auth);
    const templates = await readRegistryRows(auth, registrySpreadsheetId);
    return { ok: true, registrySpreadsheetId, templates };
  }

  async function getGoogleFormTemplateLinks(templateId) {
    const auth = getAuthedClient();
    if (!envConfigured() || !auth) {
      return { ok: false, error: "Google connection required." };
    }
    const registrySpreadsheetId = await resolveRegistrySpreadsheetId(auth);
    const templates = await readRegistryRows(auth, registrySpreadsheetId);
    const match = templates.find((row) => row.bertTemplateId === String(templateId || "").trim());
    if (!match) {
      return { ok: false, error: "Template not found in Google Form registry." };
    }
    return { ok: true, template: match };
  }

  async function ensureTemplateFolders(auth, category) {
    const drive = driveClient(auth);
    return ensureGoogleFormTemplateFolders(auth, category, {
      sharedDriveId: requiredEnv.GOOGLE_SHARED_DRIVE_ID,
      drive,
    });
  }

  return {
    createGoogleFormFromBertTemplate,
    ensureGoogleFormTemplateFolders: ensureTemplateFolders,
    moveGoogleFormToTemplateFolder,
    copyGoogleFormTemplateToCompany,
    listGoogleFormTemplates,
    getGoogleFormTemplateLinks,
    resolveRegistrySpreadsheetId,
    upsertRegistryRow,
    readRegistryRows,
  };
}

export function installGoogleFormTemplateRoutes(app, deps) {
  const { requireGoogleWorkspaceSession } = deps;
  const api = createGoogleFormTemplatesApi(deps);

  app.get("/api/google-form-templates", requireGoogleWorkspaceSession, async (_req, res) => {
    try {
      const payload = await api.listGoogleFormTemplates();
      return res.json(payload);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to list Google Form templates.",
        templates: [],
      });
    }
  });

  app.get("/api/google-form-templates/:templateId/links", requireGoogleWorkspaceSession, async (req, res) => {
    try {
      const payload = await api.getGoogleFormTemplateLinks(req.params.templateId);
      return res.status(payload.ok ? 200 : 404).json(payload);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to load Google Form template links.",
      });
    }
  });

  app.post("/api/google-form-templates/create-from-bert", requireGoogleWorkspaceSession, async (req, res) => {
    try {
      const payload = await api.createGoogleFormFromBertTemplate(req.body?.template || req.body || {});
      const status = payload.ok ? 200 : payload.permissionRequired ? 403 : 502;
      return res.status(status).json(payload);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to create Google Form template.",
        syncStatus: "Google Form creation failed",
        bertTemplateCreated: true,
      });
    }
  });

  app.post("/api/google-form-templates/:templateId/move", requireGoogleWorkspaceSession, async (req, res) => {
    const auth = deps.getAuthedClient();
    if (!auth) {
      return res.status(401).json({ ok: false, error: "Google connection required." });
    }
    try {
      const templateId = String(req.params.templateId || "").trim();
      const category = normalizeTemplateCategory(req.body?.category || "");
      const folders = await api.ensureGoogleFormTemplateFolders(auth, category);
      const links = await api.getGoogleFormTemplateLinks(templateId);
      if (!links.ok || !links.template?.googleFormDriveFileId) {
        return res.status(404).json({ ok: false, error: links.error || "Template not found." });
      }
      const folderId = String(req.body?.folderId || folders.categoryFolderId).trim();
      const moved = await api.moveGoogleFormToTemplateFolder(auth, links.template.googleFormDriveFileId, folderId);
      const registrySpreadsheetId = await api.resolveRegistrySpreadsheetId(auth);
      const updated = {
        ...links.template,
        parentDriveFolderId: folders.parentDriveFolderId,
        parentDriveFolderName: folders.parentDriveFolderName,
        currentDriveFolderId: moved.folderId,
        currentDriveFolderName: moved.folderName,
        lastSyncedAt: new Date().toISOString(),
        syncStatus: "Moved",
      };
      await api.upsertRegistryRow(auth, registrySpreadsheetId, updated);
      return res.json({ ok: true, template: updated, moved });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to move Google Form template.",
        syncStatus: "Created - move failed",
      });
    }
  });

  app.post("/api/google-form-templates/:templateId/copy-to-company", requireGoogleWorkspaceSession, async (req, res) => {
    try {
      const targetCompanyFolderId = String(req.body?.targetCompanyFolderId || "").trim();
      if (!targetCompanyFolderId) {
        return res.status(400).json({ ok: false, error: "targetCompanyFolderId is required." });
      }
      const payload = await api.copyGoogleFormTemplateToCompany(req.params.templateId, targetCompanyFolderId);
      return res.status(payload.ok ? 200 : 404).json(payload);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to copy Google Form template to company folder.",
      });
    }
  });
}
