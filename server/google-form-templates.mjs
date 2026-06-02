/**
 * Backend Google Form template copies for BERT check templates.
 * Server-side only — uses workspace OAuth; never exposes tokens to clients.
 */

import {
  AUDITS_GOOGLE_FORMS_FOLDER_KEY,
  COMPANY_GOOGLE_FORM_STORAGE_PATH,
  ensureCompanyFolderStructure,
} from "./company-folder-structure.mjs";

export const GOOGLE_FORM_TEMPLATES_TAB = "GoogleFormTemplates";

export const GOOGLE_FORM_PLACEMENT_MASTER = "master";
export const GOOGLE_FORM_PLACEMENT_COMPANY = "company";

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
  "Scope",
  "Type",
  "Current Folder Path",
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
    scope: String(record.Scope || "").trim(),
    type: String(record.Type || "").trim(),
    currentFolderPath: String(record["Current Folder Path"] || "").trim(),
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
    template.scope || "",
    template.type || "",
    template.currentFolderPath || "",
  ];
}

function normalizeGoogleFormPlacement(value = "") {
  const normalized = safeLower(value);
  if (normalized === GOOGLE_FORM_PLACEMENT_COMPANY || normalized === "company") {
    return GOOGLE_FORM_PLACEMENT_COMPANY;
  }
  return GOOGLE_FORM_PLACEMENT_MASTER;
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

/**
 * Master/Godmode reusable templates: central BERT_GOOGLE_FORM_TEMPLATES_FOLDER_ID + category subfolders.
 */
export async function ensureMasterGoogleFormTemplateFolders(auth, category, options = {}) {
  return ensureGoogleFormTemplateFolders(auth, category, options);
}

/**
 * Company Admin Forms & Checks copies: 08 - Audits / Google Forms (AUDITS_GOOGLE_FORMS).
 */
export async function resolveCompanyGoogleFormAuditFolder(deps, auth, input = {}) {
  const companyRootFolderId = String(input.companyRootFolderId || "").trim();
  if (!companyRootFolderId) {
    throw new Error("Company folder ID is required to store Google Form copies.");
  }
  if (!deps?.companyFolderStructureDeps) {
    throw new Error("Company folder structure is not configured on the API server.");
  }

  const structure = await ensureCompanyFolderStructure(deps.companyFolderStructureDeps, auth, {
    companyName: String(input.companyName || "").trim(),
    companyRootFolderId,
    masterSheetId: String(input.masterSheetId || "").trim(),
    syncWorkbookTab: Boolean(String(input.masterSheetId || "").trim()),
    placeFiles: false,
  });
  const folderId = structure.folderIds[AUDITS_GOOGLE_FORMS_FOLDER_KEY] || "";
  if (!folderId) {
    throw new Error("Unable to resolve the company Google Forms audit folder.");
  }
  return {
    folderId,
    folderName: "Google Forms",
    folderPath: COMPANY_GOOGLE_FORM_STORAGE_PATH,
    parentDriveFolderId: structure.folderIds.AUDITS || "",
    parentDriveFolderName: "08 - Audits",
  };
}

function isDrivePermissionError(error) {
  if (!error) return false;
  const status = error.code ?? error.response?.status ?? error.status;
  if (status === 403 || status === 404) return true;
  const msg = String(error.message || error.response?.data?.error?.message || "");
  return /permission|forbidden|not found|insufficient/i.test(msg);
}

async function readFormsScopeConnected(auth, google) {
  const scope = String(auth?.credentials?.scope || "").toLowerCase();
  if (scope.includes("forms.body")) {
    return true;
  }
  try {
    const token = String(auth?.credentials?.access_token || "").trim();
    if (!token) {
      return false;
    }
    const oauth2 = google.oauth2({ version: "v2", auth });
    const { data } = await oauth2.tokeninfo({ access_token: token });
    return String(data.scope || "")
      .toLowerCase()
      .includes("forms.body");
  } catch {
    return false;
  }
}

async function countConfiguredCategorySubfolders(drive, rootId) {
  const children = await listChildFolders(drive, rootId);
  const existingNames = new Set(children.map((folder) => safeLower(folder.name)));
  const present = CONFIGURED_TEMPLATE_CATEGORY_FOLDERS.filter((name) => existingNames.has(safeLower(name)));
  return {
    subfolderCount: present.length,
    expectedSubfolderCount: CONFIGURED_TEMPLATE_CATEGORY_FOLDERS.length,
    categoryFolders: present,
  };
}

async function inspectConfiguredTemplateFolder(drive, folderId) {
  const folder = await getDriveFolderById(drive, folderId);
  const meta = await drive.files.get({
    fileId: folderId,
    supportsAllDrives: true,
    fields: "id,name,capabilities",
  });
  const canEditFolder = meta.data.capabilities?.canEdit !== false;
  const counts = await countConfiguredCategorySubfolders(drive, folderId);
  return {
    folderId,
    folderName: String(folder.name || "").trim(),
    canAccessFolder: true,
    canEditFolder,
    ...counts,
  };
}

function buildTemplateFolderStatusPayload(input) {
  const folderId = getConfiguredGoogleFormTemplatesFolderId();
  const folderConfigured = Boolean(folderId);
  let status = "missing";
  if (input.canAccessFolder && input.canEditFolder && input.formsScopeConnected) {
    status = "connected";
  } else if (folderConfigured && (input.canAccessFolder === false || input.canEditFolder === false)) {
    status = "permission_issue";
  } else if (!folderConfigured) {
    status = "missing";
  } else if (!input.googleConnected) {
    status = "missing";
  }

  return {
    ok: true,
    folderConfigured,
    folderId: folderConfigured ? folderId : "",
    folderName: input.folderName || "",
    status,
    googleConnected: input.googleConnected === true,
    formsScopeConnected: input.formsScopeConnected === true,
    canAccessFolder: input.canAccessFolder === true,
    canEditFolder: input.canEditFolder === true,
    subfolderCount: input.subfolderCount ?? 0,
    expectedSubfolderCount: CONFIGURED_TEMPLATE_CATEGORY_FOLDERS.length,
    categoryFolders: input.categoryFolders || [],
    verifyError: input.verifyError || undefined,
    usesConfiguredRoot: folderConfigured,
  };
}

export function createGoogleFormTemplateFolderSetupApi(deps) {
  const { google, getAuthedClient, envConfigured } = deps;

  async function getFolderStatus() {
    const folderId = getConfiguredGoogleFormTemplatesFolderId();
    const folderConfigured = Boolean(folderId);
    if (!folderConfigured) {
      return buildTemplateFolderStatusPayload({
        googleConnected: Boolean(getAuthedClient()),
        formsScopeConnected: false,
        canAccessFolder: false,
        canEditFolder: false,
        verifyError:
          "BERT_GOOGLE_FORM_TEMPLATES_FOLDER_ID is not set on the API server. Set it on the Render API service, then redeploy.",
      });
    }

    if (!envConfigured()) {
      return buildTemplateFolderStatusPayload({
        googleConnected: false,
        formsScopeConnected: false,
        canAccessFolder: false,
        canEditFolder: false,
        verifyError: "Google Workspace is not configured on the API server.",
      });
    }

    const auth = getAuthedClient();
    if (!auth) {
      return buildTemplateFolderStatusPayload({
        googleConnected: false,
        formsScopeConnected: false,
        canAccessFolder: false,
        canEditFolder: false,
        verifyError: "Connect Google Workspace to verify template folder access.",
      });
    }

    const formsScopeConnected = await readFormsScopeConnected(auth, google);
    const drive = google.drive({ version: "v3", auth });
    try {
      const inspected = await inspectConfiguredTemplateFolder(drive, folderId);
      return buildTemplateFolderStatusPayload({
        googleConnected: true,
        formsScopeConnected,
        canAccessFolder: true,
        canEditFolder: inspected.canEditFolder,
        folderName: inspected.folderName,
        subfolderCount: inspected.subfolderCount,
        categoryFolders: inspected.categoryFolders,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to access the configured Google Form template folder.";
      return buildTemplateFolderStatusPayload({
        googleConnected: true,
        formsScopeConnected,
        canAccessFolder: !isDrivePermissionError(error),
        canEditFolder: false,
        verifyError: message,
      });
    }
  }

  async function verifyFolder() {
    const status = await getFolderStatus();
    if (!status.folderConfigured) {
      return { ok: false, ...status, verified: false, error: status.verifyError };
    }
    if (!status.googleConnected) {
      return {
        ok: false,
        ...status,
        verified: false,
        error: "Connect Google Workspace before verifying the template folder.",
      };
    }
    if (!status.canAccessFolder) {
      return {
        ok: false,
        ...status,
        verified: false,
        error: status.verifyError || "Unable to access the configured Google Form template folder.",
      };
    }
    if (!status.canEditFolder) {
      return {
        ok: false,
        ...status,
        verified: false,
        error: "BERT cannot edit the Google Form template folder.",
      };
    }
    return { ok: true, ...status, verified: status.status === "connected" };
  }

  async function ensureFolderStructure() {
    const folderId = getConfiguredGoogleFormTemplatesFolderId();
    if (!folderId) {
      return {
        ok: false,
        error:
          "BERT_GOOGLE_FORM_TEMPLATES_FOLDER_ID is not set on the API server. Set it on the Render API service, then redeploy.",
      };
    }
    const auth = getAuthedClient();
    if (!envConfigured() || !auth) {
      return { ok: false, error: "Connect Google Workspace before repairing the template folder structure." };
    }

    const drive = google.drive({ version: "v3", auth });
    await ensureConfiguredCategorySubfolders(drive, folderId);
    const inspected = await inspectConfiguredTemplateFolder(drive, folderId);
    const formsScopeConnected = await readFormsScopeConnected(auth, google);
    return buildTemplateFolderStatusPayload({
      googleConnected: true,
      formsScopeConnected,
      canAccessFolder: true,
      canEditFolder: inspected.canEditFolder,
      folderName: inspected.folderName,
      subfolderCount: inspected.subfolderCount,
      categoryFolders: inspected.categoryFolders,
      repaired: true,
    });
  }

  return {
    getFolderStatus,
    verifyFolder,
    ensureFolderStructure,
  };
}

async function createGoogleFormBody(forms, templateName, questions) {
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
  return { formId, formFileId: formId, skipped };
}

export async function createMasterGoogleFormTemplateCopy(apiContext, template) {
  const { auth, drive, forms, registrySpreadsheetId, requiredEnv } = apiContext;
  const bertTemplateId = String(template?.id || template?.bertTemplateId || "").trim();
  const templateName = String(template?.name || template?.templateName || "BERT Template").trim();
  const category = normalizeTemplateCategory(template?.category || template?.source || "");
  const questions = Array.isArray(template?.questions) ? template.questions : [];
  const createdBy = String(template?.createdBy || "BERT").trim();
  const sourceCompanyId = String(template?.sourceCompanyId || "").trim();
  const sourceCompanyName = String(template?.sourceCompanyName || "").trim();
  const now = new Date().toISOString();

  const folders = await ensureMasterGoogleFormTemplateFolders(auth, category, {
    sharedDriveId: requiredEnv.GOOGLE_SHARED_DRIVE_ID,
    drive,
  });

  const { formId, formFileId, skipped } = await createGoogleFormBody(forms, templateName, questions);

  let syncStatus = skipped.length > 0 ? "Created with skipped fields" : "Created";
  let notes = skipped.length > 0 ? `Skipped BERT-only fields: ${skipped.join("; ")}` : "";
  let folderPlacementFailed = false;

  if (formFileId) {
    try {
      await moveGoogleFormToDriveFolder(drive, formFileId, folders.categoryFolderId);
      syncStatus = skipped.length > 0 ? "Created with skipped fields" : "Created";
    } catch (moveError) {
      syncStatus = "Created - move failed";
      folderPlacementFailed = true;
      notes = [notes, moveError instanceof Error ? moveError.message : "Move failed"].filter(Boolean).join(" | ");
    }
  } else {
    syncStatus = "Created - drive file not resolved";
    notes = [notes, "Could not resolve Drive file id for created form."].filter(Boolean).join(" | ");
  }

  const currentFolderPath = folders.categoryFolderName
    ? `${folders.parentDriveFolderName || "BERT Master Templates"} / ${folders.categoryFolderName}`
    : folders.parentDriveFolderName || "BERT Master Templates";

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
    scope: "Master",
    type: "Reusable Template",
    currentFolderPath,
  };

  await apiContext.upsertRegistryRow(auth, registrySpreadsheetId, record);

  return {
    ok: true,
    placement: GOOGLE_FORM_PLACEMENT_MASTER,
    bertTemplateCreated: true,
    googleForm: record,
    registrySpreadsheetId,
    skippedFields: skipped,
    folderPlacementFailed,
    storedFolderPath: currentFolderPath,
  };
}

export async function createCompanyGoogleFormCopy(apiDeps, template) {
  const apiContext = apiDeps.api;
  const { auth, drive, forms, registrySpreadsheetId } = apiContext;
  const bertTemplateId = String(template?.id || template?.bertTemplateId || "").trim();
  const templateName = String(template?.name || template?.templateName || "BERT Template").trim();
  const category = normalizeTemplateCategory(template?.category || template?.source || "");
  const questions = Array.isArray(template?.questions) ? template.questions : [];
  const createdBy = String(template?.createdBy || "BERT").trim();
  const sourceCompanyId = String(template?.sourceCompanyId || template?.companyRootFolderId || "").trim();
  const sourceCompanyName = String(template?.sourceCompanyName || "").trim();
  const masterSheetId = String(template?.masterSheetId || "").trim();
  const now = new Date().toISOString();

  let folders;
  try {
    folders = await resolveCompanyGoogleFormAuditFolder(apiDeps, auth, {
      companyRootFolderId: sourceCompanyId,
      companyName: sourceCompanyName,
      masterSheetId,
    });
  } catch (folderError) {
    return {
      ok: false,
      placement: GOOGLE_FORM_PLACEMENT_COMPANY,
      bertTemplateCreated: true,
      folderPlacementFailed: true,
      error:
        folderError instanceof Error
          ? folderError.message
          : "BERT template created. Google Form copy could not be stored in the company audit folder.",
      userMessage: "BERT template created. Google Form copy could not be stored in the company audit folder.",
    };
  }

  const { formId, formFileId, skipped } = await createGoogleFormBody(forms, templateName, questions);

  let syncStatus = skipped.length > 0 ? "Created with skipped fields" : "Created";
  let notes = skipped.length > 0 ? `Skipped BERT-only fields: ${skipped.join("; ")}` : "";
  let folderPlacementFailed = false;

  if (formFileId) {
    try {
      await moveGoogleFormToDriveFolder(drive, formFileId, folders.folderId);
      syncStatus = skipped.length > 0 ? "Created with skipped fields" : "Created";
    } catch (moveError) {
      syncStatus = "Created - move failed";
      folderPlacementFailed = true;
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
    currentDriveFolderId: folders.folderId,
    currentDriveFolderName: folders.folderName,
    createdBy,
    createdAt: now,
    lastSyncedAt: now,
    syncStatus,
    reusableTemplate: "no",
    notes,
    scope: "Company",
    type: "Company",
    currentFolderPath: folders.folderPath,
  };

  await apiContext.upsertRegistryRow(auth, registrySpreadsheetId, record);

  return {
    ok: true,
    placement: GOOGLE_FORM_PLACEMENT_COMPANY,
    bertTemplateCreated: true,
    googleForm: record,
    registrySpreadsheetId,
    skippedFields: skipped,
    folderPlacementFailed,
    storedFolderPath: folders.folderPath,
    userMessage: folderPlacementFailed
      ? "BERT template created. Google Form copy was created but could not be moved into the company audit folder."
      : undefined,
  };
}

async function moveGoogleFormToDriveFolder(drive, formFileId, folderId) {
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
}

export function createGoogleFormTemplatesApi({
  google,
  getAuthedClient,
  envConfigured,
  withSheetsQuotaRetry,
  requiredEnv,
  companyFolderStructureDeps,
  getCompanyFolderStructureDeps,
}) {
  function resolveCompanyFolderStructureDeps() {
    if (companyFolderStructureDeps) return companyFolderStructureDeps;
    if (typeof getCompanyFolderStructureDeps === "function") {
      return getCompanyFolderStructureDeps();
    }
    return null;
  }
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

  async function createGoogleFormFromBertTemplate(template, options = {}) {
    const auth = getAuthedClient();
    if (!envConfigured() || !auth) {
      return {
        ok: false,
        permissionRequired: true,
        error: "Google Forms permission is not connected yet.",
        scopeHint: GOOGLE_FORMS_BODY_SCOPE,
      };
    }

    const bertTemplateId = String(template?.id || template?.bertTemplateId || "").trim();
    if (!bertTemplateId) {
      return { ok: false, error: "BERT template id is required." };
    }

    const placement = normalizeGoogleFormPlacement(options.placement || template?.placement || "");
    const drive = driveClient(auth);
    const forms = formsClient(auth);

    try {
      const registrySpreadsheetId = await resolveRegistrySpreadsheetId(auth);
      const apiContext = {
        auth,
        drive,
        forms,
        registrySpreadsheetId,
        requiredEnv,
        upsertRegistryRow,
      };
      const apiDeps = { api: apiContext, companyFolderStructureDeps: resolveCompanyFolderStructureDeps() };

      if (placement === GOOGLE_FORM_PLACEMENT_COMPANY) {
        return await createCompanyGoogleFormCopy(apiDeps, template);
      }
      return await createMasterGoogleFormTemplateCopy(apiContext, template);
    } catch (error) {
      if (isGoogleFormsPermissionError(error)) {
        return {
          ok: false,
          permissionRequired: true,
          error: "Google Forms permission is not connected yet.",
          scopeHint: GOOGLE_FORMS_BODY_SCOPE,
          bertTemplateCreated: true,
          placement,
        };
      }
      const companyPlacement = placement === GOOGLE_FORM_PLACEMENT_COMPANY;
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : companyPlacement
              ? "BERT template created. Google Form copy could not be stored in the company audit folder."
              : "Google Form creation failed",
        syncStatus: "Google Form creation failed",
        bertTemplateCreated: true,
        placement,
        userMessage: companyPlacement
          ? "BERT template created. Google Form copy could not be stored in the company audit folder."
          : undefined,
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
    await moveGoogleFormToDriveFolder(drive, fileId, targetFolderId);
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
    ensureMasterGoogleFormTemplateFolders: ensureTemplateFolders,
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
  const { requireGoogleWorkspaceSession, requireMasterOnlyActor } = deps;
  const api = createGoogleFormTemplatesApi(deps);
  const folderSetup = createGoogleFormTemplateFolderSetupApi(deps);
  const requireGodmodeActor = requireMasterOnlyActor || ((_req, _res, next) => next());

  app.get(
    "/api/google-form-templates/folder/status",
    requireGodmodeActor,
    async (_req, res) => {
      try {
        const payload = await folderSetup.getFolderStatus();
        return res.json(payload);
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error instanceof Error ? error.message : "Unable to load Google Form template folder status.",
        });
      }
    },
  );

  app.post(
    "/api/google-form-templates/folder/verify",
    requireGodmodeActor,
    requireGoogleWorkspaceSession,
    async (_req, res) => {
      try {
        const payload = await folderSetup.verifyFolder();
        return res.status(payload.ok ? 200 : 400).json(payload);
      } catch (error) {
        return res.status(500).json({
          ok: false,
          verified: false,
          error: error instanceof Error ? error.message : "Unable to verify Google Form template folder.",
        });
      }
    },
  );

  app.post(
    "/api/google-form-templates/folder/ensure-structure",
    requireGodmodeActor,
    requireGoogleWorkspaceSession,
    async (_req, res) => {
      try {
        const payload = await folderSetup.ensureFolderStructure();
        return res.status(payload.ok === false ? 400 : 200).json(payload);
      } catch (error) {
        const permissionRequired = isDrivePermissionError(error);
        return res.status(permissionRequired ? 403 : 500).json({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Unable to repair Google Form template folder structure.",
        });
      }
    },
  );

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
      const template = req.body?.template || req.body || {};
      const placement = normalizeGoogleFormPlacement(req.body?.placement || template?.placement || "");
      const payload = await api.createGoogleFormFromBertTemplate(template, { placement });
      const status = payload.ok ? 200 : payload.permissionRequired ? 403 : payload.bertTemplateCreated ? 200 : 502;
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
