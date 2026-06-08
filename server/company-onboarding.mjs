/**
 * BERT company onboarding (COMPANY_ONBOARDING): Godmode invite → customer form → provision workspace.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isPlatformOwnerEmail } from "../shared/platform-owner.mjs";
import { isSystemTemplateCompany } from "../shared/system-template-company.mjs";
import {
  COMPANIES_WORKSPACE_COLUMNS,
  REGISTRY_SPREADSHEET_NAME,
  REGISTRY_TAB_COMPANIES,
  persistCompanyWorkspaceSetup,
  recordCompanyWorkspaceHealthCheck,
  upsertCompanyWorkspaceRegistryRecords,
} from "./company-workspace-registry.mjs";

export const COMPANY_ONBOARDING_INVITE_TYPE = "COMPANY_ONBOARDING";

/** Config `companyOnboardingStatus` values — gates COMPANY_USER invites until `live`. */
export const COMPANY_WORKSPACE_STATUS = {
  SUBMITTED: "onboarding_submitted",
  PROVISIONING: "onboarding_provisioning",
  LIVE: "live",
  SETUP_FAILED: "setup_failed",
};

/** Customer-visible lifecycle on the invite record. */
export const COMPANY_ONBOARDING_STATUSES = new Set([
  "invited",
  "started",
  "submitted",
  "live",
  "failed",
  "setup_failed",
]);

const REGISTRY_TAB_ONBOARDING = "OnboardingInvites";

const ONBOARDING_INVITE_COLUMNS = [
  "Invite ID",
  "Type",
  "Status",
  "Contact Email",
  "Contact Name",
  "Provisional Company",
  "Notes",
  "Invited By",
  "Created At",
  "Expires At",
  "Started At",
  "Submitted At",
  "Live At",
  "Company Folder ID",
  "Master Sheet ID",
  "Provision Error",
];

/** @deprecated Use COMPANIES_WORKSPACE_COLUMNS from company-workspace-registry.mjs */
const COMPANIES_REGISTRY_COLUMNS = COMPANIES_WORKSPACE_COLUMNS;

export const COMPANY_ONBOARDING_SETUP_FAILED_MESSAGE =
  "We couldn't finish setting up your workspace. Your details have been saved and the BERT team can finish setup.";

const MAIN_NEED_OPTIONS = [
  "iso_9001",
  "iso_14001",
  "iso_45001",
  "health_safety",
  "risk",
  "coshh",
  "audits",
  "digital_checks",
  "other",
];

const MAIN_NEED_ALIASES = {
  iso9001: "iso_9001",
  "iso 9001": "iso_9001",
  iso14001: "iso_14001",
  "iso 14001": "iso_14001",
  iso45001: "iso_45001",
  "iso 45001": "iso_45001",
  hs: "health_safety",
  "h s": "health_safety",
  "health and safety": "health_safety",
  "health safety": "health_safety",
  digitalchecks: "digital_checks",
  "digital checks": "digital_checks",
};

function safeLower(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

export function hashCompanyOnboardingToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken || ""), "utf8").digest("hex");
}

export function generateCompanyOnboardingTokenParts() {
  const inviteId = crypto.randomBytes(12).toString("hex");
  const rawToken = crypto.randomBytes(24).toString("hex");
  return { inviteId, rawToken, tokenHash: hashCompanyOnboardingToken(rawToken) };
}

export function buildCompanyOnboardingInviteUrl(frontendUrl, inviteId, rawToken) {
  const base = String(frontendUrl || "").replace(/\/$/, "");
  const token = `${inviteId}.${rawToken}`;
  return `${base}/onboarding/company/${encodeURIComponent(token)}`;
}

export function parseCompanyOnboardingUrlToken(param) {
  const trimmed = String(param || "").trim();
  if (!trimmed) {
    return null;
  }
  const dot = trimmed.indexOf(".");
  if (dot <= 0 || dot >= trimmed.length - 1) {
    return null;
  }
  const inviteId = trimmed.slice(0, dot).trim();
  const rawToken = trimmed.slice(dot + 1).trim();
  if (!inviteId || !rawToken) {
    return null;
  }
  return { inviteId, rawToken, tokenHash: hashCompanyOnboardingToken(rawToken) };
}

export function normalizeMainNeeds(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[,;]+/)
        .map((item) => item.trim());
  const normalized = new Set();
  for (const item of list) {
    const compact = safeLower(item).replace(/[^a-z0-9]+/g, " ").trim();
    const underscored = compact.replace(/\s+/g, "_");
    const alias = MAIN_NEED_ALIASES[compact] || MAIN_NEED_ALIASES[underscored];
    const key = alias || underscored;
    if (MAIN_NEED_OPTIONS.includes(key)) {
      normalized.add(key);
    }
  }
  return Array.from(normalized);
}

function formatCompanyAddress(form = {}) {
  const legacy = String(form.address || "").trim();
  if (legacy) {
    return legacy;
  }
  return [
    form.addressLine1,
    form.addressLine2,
    form.town,
    form.county,
    form.postcode,
    form.country,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
}

function mapInviteStatusCode(record) {
  const status = safeLower(record.status);
  const provisionStatus = safeLower(record.provisionStatus);
  if (status === "live") {
    return "LIVE";
  }
  if (status === "setup_failed" || status === "failed") {
    return "SETUP_FAILED";
  }
  if (provisionStatus === "running") {
    return "PROVISIONING";
  }
  if (status === "submitted") {
    return "CUSTOMER_SUBMITTED";
  }
  if (status === "started") {
    return "CUSTOMER_STARTED";
  }
  if (status === "archived") {
    return "ARCHIVED";
  }
  return "INVITE_SENT";
}

function createInviteStoreApi(storePath) {
  function readStore() {
    try {
      const raw = fs.readFileSync(storePath, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeStore(store) {
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
  }

  return {
    readStore,
    writeStore,
    getInvite(inviteId) {
      return readStore()[inviteId] || null;
    },
    patchInvite(inviteId, partial) {
      const store = readStore();
      if (!store[inviteId]) {
        return null;
      }
      store[inviteId] = { ...store[inviteId], ...partial };
      writeStore(store);
      return store[inviteId];
    },
    createInvite(record) {
      const store = readStore();
      store[record.id] = record;
      writeStore(store);
      return record;
    },
    deleteInvite(inviteId) {
      const store = readStore();
      if (!store[inviteId]) {
        return false;
      }
      delete store[inviteId];
      writeStore(store);
      return true;
    },
    listInvites() {
      return Object.values(readStore()).sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
    },
    findMasterSheetIdsForEmail(email) {
      const target = safeLower(email);
      if (!target || isPlatformOwnerEmail(target, process.env)) {
        return [];
      }
      const matches = [];
      for (const record of Object.values(readStore())) {
        if (safeLower(record.contactEmail) !== target) {
          continue;
        }
        const sheetId = String(record.masterSheetId || record.provisionMasterSheetId || "").trim();
        if (!sheetId) {
          continue;
        }
        matches.push({ sheetId, createdAt: Number(record.createdAt) || 0 });
      }
      matches.sort((a, b) => b.createdAt - a.createdAt);
      const seen = new Set();
      const ordered = [];
      for (const { sheetId } of matches) {
        if (seen.has(sheetId)) {
          continue;
        }
        seen.add(sheetId);
        ordered.push(sheetId);
      }
      return ordered;
    },
  };
}

function mapInviteStatusLabel(record) {
  const code = mapInviteStatusCode(record);
  if (code === "LIVE") {
    return "Live";
  }
  if (code === "SETUP_FAILED") {
    return "Setup failed";
  }
  if (code === "PROVISIONING") {
    return "Provisioning";
  }
  if (code === "CUSTOMER_SUBMITTED") {
    return "Submitted";
  }
  if (code === "CUSTOMER_STARTED") {
    return "Started";
  }
  if (code === "ARCHIVED") {
    return "Archived";
  }
  return "Invite sent";
}

function publicInviteSummary(record) {
  const companyFolderId = record.companyFolderId || record.provisionDriveFolderId || "";
  const masterSheetId = record.masterSheetId || record.provisionMasterSheetId || "";
  return {
    inviteId: record.id,
    status: record.status,
    statusCode: mapInviteStatusCode(record),
    statusLabel: mapInviteStatusLabel(record),
    contactEmail: record.contactEmail,
    contactName: record.contactName || "",
    provisionalCompanyName: record.provisionalCompanyName || "",
    invitedBy: record.invitedBy || "",
    expiresAt: record.expiresAt,
    startedAt: record.startedAt ?? null,
    submittedAt: record.submittedAt ?? null,
    liveAt: record.liveAt ?? null,
    provisionStatus: record.provisionStatus || "idle",
    provisionError: record.provisionError || "",
    provisionStage: record.provisionStage || "",
    companyFolderId,
    masterSheetId,
    companyFolderUrl: companyFolderId ? `https://drive.google.com/drive/folders/${companyFolderId}` : "",
    masterSheetUrl: masterSheetId ? `https://docs.google.com/spreadsheets/d/${masterSheetId}/edit` : "",
    canRetrySetup: ["failed", "setup_failed", "submitted"].includes(safeLower(record.status)),
  };
}

function createPerInviteAsyncQueue() {
  const tails = new Map();
  return async (inviteId, fn) => {
    const prev = tails.get(inviteId) || Promise.resolve();
    let release = () => {};
    const next = new Promise((resolve) => {
      release = resolve;
    });
    tails.set(
      inviteId,
      prev.then(() => next, () => next),
    );
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

async function ensureRegistryTab(auth, sheetsApi, spreadsheetId, tabName, headers, deps) {
  const { getWorkbook, ensureTabExists, ensureColumns } = deps;
  let workbook = await getWorkbook(auth, spreadsheetId);
  const { workbook: workbookAfter } = await ensureTabExists(auth, spreadsheetId, tabName, workbook);
  workbook = workbookAfter;
  await ensureColumns(auth, spreadsheetId, tabName, headers);
  return workbook;
}

async function resolvePlatformRegistrySpreadsheetId(auth, drive, deps) {
  const configured = String(deps.platformRegistrySheetId || "").trim();
  if (configured) {
    return configured;
  }
  const sharedDriveId = String(deps.sharedDriveId || "").trim();
  if (!sharedDriveId) {
    return "";
  }
  const response = await drive.files.list({
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    corpora: "drive",
    driveId: sharedDriveId,
    q: `mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and name='${REGISTRY_SPREADSHEET_NAME.replace(/'/g, "\\'")}'`,
    fields: "files(id,name)",
    pageSize: 5,
  });
  const files = response.data.files || [];
  return files[0]?.id || "";
}

async function upsertRegistryRows(auth, sheetsApi, spreadsheetId, tabName, headers, rows, deps) {
  if (!spreadsheetId || !rows.length) {
    return;
  }
  await ensureRegistryTab(auth, sheetsApi, spreadsheetId, tabName, headers, deps);
  const existing = await deps.getTabValues(auth, spreadsheetId, tabName);
  const headerRow = existing[0] || headers;
  const idHeader = tabName === REGISTRY_TAB_ONBOARDING ? "Invite ID" : "Company Folder ID";
  const idIndex = headerRow.findIndex((h) => safeLower(h) === safeLower(idHeader));
  const dataRows = existing.length > 1 ? existing.slice(1) : [];
  const nextRows = [...dataRows];
  for (const rowObject of rows) {
    const id = String(rowObject[idHeader] || "").trim();
    if (!id) {
      continue;
    }
    const mapped = headers.map((header) => String(rowObject[header] ?? ""));
    const rowIndex = nextRows.findIndex((row) => String(row[idIndex] || "").trim() === id);
    if (rowIndex === -1) {
      nextRows.push(mapped);
    } else {
      nextRows[rowIndex] = mapped;
    }
  }
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [headers, ...nextRows] },
  });
}

function registryRowFromInvite(record) {
  return {
    "Invite ID": record.id,
    Type: COMPANY_ONBOARDING_INVITE_TYPE,
    Status: mapInviteStatusLabel(record),
    "Contact Email": record.contactEmail,
    "Contact Name": record.contactName || "",
    "Provisional Company": record.provisionalCompanyName || "",
    Notes: record.notes || "",
    "Invited By": record.invitedBy || "",
    "Created At": record.createdAtIso || nowIso(),
    "Expires At": new Date(record.expiresAt).toISOString(),
    "Started At": record.startedAt ? new Date(record.startedAt).toISOString() : "",
    "Submitted At": record.submittedAt ? new Date(record.submittedAt).toISOString() : "",
    "Live At": record.liveAt ? new Date(record.liveAt).toISOString() : "",
    "Company Folder ID": record.companyFolderId || record.provisionDriveFolderId || "",
    "Master Sheet ID": record.masterSheetId || record.provisionMasterSheetId || "",
    "Provision Error": record.provisionError || "",
  };
}

function registryRowFromCompany(record, form) {
  const companyId = record.companyFolderId || record.provisionDriveFolderId || "";
  const masterSheetId = record.masterSheetId || record.provisionMasterSheetId || "";
  const isLive = safeLower(record.status) === "live";
  return {
    companyId,
    companyName: form.companyName || record.provisionalCompanyName || "",
    status: isLive ? "Live" : "Onboarding",
    rootFolderId: companyId,
    masterSheetId,
    liveAt: record.liveAt ? new Date(record.liveAt).toISOString() : "",
    setupCompletedAt: isLive && record.liveAt ? new Date(record.liveAt).toISOString() : "",
    extraHeaders: {
      Website: form.website || "",
      Phone: form.phone || "",
      Address: formatCompanyAddress(form),
      Industry: form.industry || "",
      "Sites Count": String(form.sitesCount ?? ""),
      "Users Count": String(form.usersCount ?? ""),
      "Main Needs": (form.mainNeeds || []).join(", "),
      "Onboarding Invite ID": record.id,
      "Company Folder ID": companyId,
    },
  };
}

async function syncInviteToRegistry(auth, record, deps) {
  const drive = deps.google.drive({ version: "v3", auth });
  const sheetsApi = deps.google.sheets({ version: "v4", auth });
  const spreadsheetId = await resolvePlatformRegistrySpreadsheetId(auth, drive, deps);
  if (!spreadsheetId) {
    return { synced: false };
  }
  const form = record.formPayload || {};
  await upsertRegistryRows(auth, sheetsApi, spreadsheetId, REGISTRY_TAB_ONBOARDING, ONBOARDING_INVITE_COLUMNS, [
    registryRowFromInvite(record),
  ], deps);
  if (record.companyFolderId || record.provisionDriveFolderId) {
    const companyRow = registryRowFromCompany(record, form);
    await upsertCompanyWorkspaceRegistryRecords(auth, deps, [companyRow]);
    if (companyRow.masterSheetId) {
      const live = safeLower(record.status) === "live";
      await persistCompanyWorkspaceSetup(auth, deps, {
        ...companyRow,
        markSetupComplete: live,
        markLive: live,
        touchSetup: false,
      }).catch(() => {});
    }
  }
  return { synced: true, registrySpreadsheetId: spreadsheetId };
}

function buildConfigFromForm(form, inviteId, status = COMPANY_WORKSPACE_STATUS.LIVE) {
  const mainNeeds = normalizeMainNeeds(form.mainNeeds);
  const address = formatCompanyAddress(form);
  return {
    companyWebsite: String(form.website || "").trim(),
    companyPhone: String(form.phone || "").trim(),
    companyAddress: address,
    companyAddressLine1: String(form.addressLine1 || "").trim(),
    companyAddressLine2: String(form.addressLine2 || "").trim(),
    companyTown: String(form.town || "").trim(),
    companyCounty: String(form.county || "").trim(),
    companyPostcode: String(form.postcode || "").trim(),
    companyCountry: String(form.country || "").trim(),
    companyIndustry: String(form.industry || "").trim(),
    expectedSites: String(form.sitesCount ?? "").trim(),
    expectedUsers: String(form.usersCount ?? "").trim(),
    onboardingMainNeeds: mainNeeds.join(","),
    onboardingInviteId: inviteId,
    companyOnboardingStatus: status,
  };
}

/** Legacy workspaces without `companyOnboardingStatus` remain invite-eligible. */
export function isCompanyWorkspaceLiveForUserInvites(config = {}) {
  const status = safeLower(config.companyOnboardingStatus || "");
  if (!status || status === COMPANY_WORKSPACE_STATUS.LIVE) {
    return true;
  }
  if (status === COMPANY_WORKSPACE_STATUS.SETUP_FAILED || status.startsWith("onboarding_")) {
    return false;
  }
  return true;
}

export async function countCompanyUsersOnSheet(auth, getTabValues, masterSheetId) {
  const rows = await getTabValues(auth, masterSheetId, "Users");
  if (!rows.length) {
    return 0;
  }
  const headers = rows[0].map((cell) => safeLower(cell));
  const emailIndex = headers.findIndex((h) => h === "email");
  if (emailIndex === -1) {
    return Math.max(0, rows.length - 1);
  }
  let count = 0;
  for (const row of rows.slice(1)) {
    const email = String(row[emailIndex] || "").trim();
    if (email) {
      count += 1;
    }
  }
  return count;
}

export async function readOnboardingRegistryMasterSheetForFolder(auth, deps, companyFolderId) {
  const folderId = String(companyFolderId || "").trim();
  if (!folderId || !auth) {
    return "";
  }
  const drive = deps.google.drive({ version: "v3", auth });
  const spreadsheetId = await resolvePlatformRegistrySpreadsheetId(auth, drive, deps);
  if (!spreadsheetId) {
    return "";
  }
  const rows = await deps.getTabValues(auth, spreadsheetId, REGISTRY_TAB_ONBOARDING);
  if (!rows.length) {
    return "";
  }
  const headers = rows[0].map((cell) => safeLower(cell));
  const folderIndex = headers.findIndex((header) => header === "company folder id");
  const sheetIndex = headers.findIndex((header) => header === "master sheet id");
  if (folderIndex === -1 || sheetIndex === -1) {
    return "";
  }
  for (const row of rows.slice(1)) {
    if (String(row[folderIndex] || "").trim() !== folderId) {
      continue;
    }
    const sheetId = String(row[sheetIndex] || "").trim();
    if (sheetId) {
      return sheetId;
    }
  }
  return "";
}

export async function writeOnboardingRegistryMasterSheetForFolder(
  auth,
  deps,
  { companyFolderId, masterSheetId, companyName = "" },
) {
  const folderId = String(companyFolderId || "").trim();
  const sheetId = String(masterSheetId || "").trim();
  if (!folderId || !sheetId || !auth) {
    return { synced: false };
  }
  const drive = deps.google.drive({ version: "v3", auth });
  const sheetsApi = deps.google.sheets({ version: "v4", auth });
  const registrySpreadsheetId = await resolvePlatformRegistrySpreadsheetId(auth, drive, deps);
  if (!registrySpreadsheetId) {
    return { synced: false };
  }
  const rows = await deps.getTabValues(auth, registrySpreadsheetId, REGISTRY_TAB_ONBOARDING);
  const headerRow = rows[0] || ONBOARDING_INVITE_COLUMNS;
  const folderIndex = headerRow.findIndex((header) => safeLower(header) === "company folder id");
  const sheetIndex = headerRow.findIndex((header) => safeLower(header) === "master sheet id");
  if (folderIndex === -1 || sheetIndex === -1) {
    return { synced: false };
  }
  const dataRows = rows.length > 1 ? rows.slice(1) : [];
  let updated = false;
  const nextRows = dataRows.map((row) => {
    if (String(row[folderIndex] || "").trim() !== folderId) {
      return row;
    }
    updated = true;
    const next = [...row];
    next[sheetIndex] = sheetId;
    return next;
  });
  if (!updated) {
    const blankRow = ONBOARDING_INVITE_COLUMNS.map(() => "");
    blankRow[folderIndex] = folderId;
    blankRow[sheetIndex] = sheetId;
    const companyIndex = headerRow.findIndex((header) => safeLower(header) === "provisional company");
    if (companyIndex >= 0 && companyName) {
      blankRow[companyIndex] = companyName;
    }
    nextRows.push(blankRow);
  }
  await ensureRegistryTab(auth, sheetsApi, registrySpreadsheetId, REGISTRY_TAB_ONBOARDING, ONBOARDING_INVITE_COLUMNS, deps);
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: registrySpreadsheetId,
    range: `${REGISTRY_TAB_ONBOARDING}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [headerRow, ...nextRows] },
  });
  return { synced: true, registrySpreadsheetId };
}

/** Promote onboarding_* config to live when the sheet already has users (workspace ready). */
export async function ensureCompanyWorkspaceLiveIfReady(deps, auth, { masterSheetId, companyFolderId }) {
  const { getConfig, updateConfig, getTabValues } = deps;
  const sheetId = String(masterSheetId || "").trim();
  if (!sheetId || !auth) {
    return { promoted: false, reason: "missing_sheet" };
  }
  let cfg;
  try {
    cfg = await getConfig(auth, sheetId);
  } catch {
    return { promoted: false, reason: "config_unreadable" };
  }
  if (isCompanyWorkspaceLiveForUserInvites(cfg)) {
    return { promoted: false, alreadyLive: true };
  }
  const userCount = await countCompanyUsersOnSheet(auth, getTabValues, sheetId);
  if (userCount === 0) {
    return { promoted: false, reason: "no_users" };
  }
  const folderId = String(companyFolderId || cfg.companyId || "").trim();
  await updateConfig(auth, sheetId, {
    ...cfg,
    companyOnboardingStatus: COMPANY_WORKSPACE_STATUS.LIVE,
    ...(folderId ? { companyId: folderId } : {}),
  });
  return { promoted: true };
}

export async function assertCompanyWorkspaceAcceptsUserInvite(
  deps,
  auth,
  { masterSheetId, inviteRole, companyFolderId = "" },
) {
  const { getConfig, getTabValues } = deps;
  const sheetId = String(masterSheetId || "").trim();
  if (!sheetId) {
    return {
      ok: false,
      code: "company_not_live",
      httpStatus: 409,
      message:
        "Company workspace setup is not complete yet. Finish company onboarding before inviting users.",
    };
  }
  await ensureCompanyWorkspaceLiveIfReady(deps, auth, {
    masterSheetId: sheetId,
    companyFolderId,
  }).catch(() => {});
  const cfg = await getConfig(auth, sheetId);
  if (isSystemTemplateCompany({ companyName: cfg.companyName, name: cfg.companyName, status: cfg.companyOnboardingStatus })) {
    return {
      ok: false,
      code: "system_template_company",
      httpStatus: 403,
      message: "This workspace is a system template and cannot be used for live company access.",
    };
  }
  if (!isCompanyWorkspaceLiveForUserInvites(cfg)) {
    return {
      ok: false,
      code: "company_not_live",
      httpStatus: 409,
      message:
        "This company is not live yet. Complete company onboarding and provisioning before sending user invites.",
    };
  }
  if (inviteRole === "Admin") {
    const userCount = await countCompanyUsersOnSheet(auth, getTabValues, sheetId);
    if (userCount === 0) {
      return {
        ok: false,
        code: "first_admin_requires_onboarding",
        httpStatus: 409,
        message:
          "The first company administrator is created during company onboarding. Send a company onboarding invite from Godmode instead.",
      };
    }
  }
  return { ok: true };
}

function verifyInviteToken(record, parsed) {
  if (!record || !parsed) {
    return false;
  }
  return String(record.tokenHash || "") === String(parsed.tokenHash || "");
}

/** Token, invite type, status, and expiry only — no folder/sheet/health checks. */
export function resolveCompanyOnboardingInviteAccess(record, parsed) {
  if (!parsed) {
    return { ok: false, httpStatus: 400, code: "INVITE_INVALID", error: "Invalid onboarding link." };
  }
  if (!record) {
    return { ok: false, httpStatus: 404, code: "INVITE_INVALID", error: "This onboarding link is not valid." };
  }
  if (!verifyInviteToken(record, parsed)) {
    return { ok: false, httpStatus: 404, code: "INVITE_INVALID", error: "This onboarding link is not valid." };
  }
  const inviteType = safeLower(record.inviteType || COMPANY_ONBOARDING_INVITE_TYPE);
  if (inviteType !== safeLower(COMPANY_ONBOARDING_INVITE_TYPE)) {
    return { ok: false, httpStatus: 400, code: "INVITE_WRONG_TYPE", error: "This link is not a company onboarding invite." };
  }
  const status = safeLower(record.status);
  if (status === "archived" || status === "revoked") {
    return { ok: false, httpStatus: 410, code: "INVITE_ALREADY_USED", error: "This invite is no longer valid." };
  }
  if (Date.now() > record.expiresAt && status !== "live") {
    return { ok: false, httpStatus: 410, code: "INVITE_EXPIRED", error: "This invite has expired." };
  }
  return { ok: true, record };
}

export function installCompanyOnboardingRoutes(app, deps) {
  const {
    sessionDir,
    requiredEnv,
    appBrandName,
    emailConfigured,
    createSmtpTransport,
    getAuthedClient,
    envConfigured,
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    parseBertActorFromRequest,
    provisionNewCompanyWorkspace,
    appendRowObjects,
    getConfig,
    updateConfig,
    getSessionCookieOptions,
    companySessionCookie,
    companySessionMs,
    hashPassword,
    readCompanyUsersTabRecord,
    repairCompanyInviteTarget,
  } = deps;

  const storePath = path.join(sessionDir, "company-onboarding-invites.json");
  const store = createInviteStoreApi(storePath);
  const runWithInviteLock = createPerInviteAsyncQueue();
  const inviteTtlMs = Math.max(60 * 60 * 1000, Number(deps.onboardingInviteTtlMs || 7 * 24 * 60 * 60 * 1000));

  async function sendInviteEmail({ toEmail, invitedBy, onboardingUrl }) {
    const subject = "Set up your company on BERT";
    const textBody = [
      "Hi,",
      "",
      `You have been invited to set up your company on ${appBrandName}.`,
      "",
      "Open this secure link to submit your company details and create your administrator account:",
      onboardingUrl,
      "",
      `Invited by: ${invitedBy}`,
      "",
      "Thanks,",
      `${appBrandName} team`,
    ].join("\n");
    const htmlBody = `
      <p>Hi,</p>
      <p>You have been invited to set up your company on <strong>${appBrandName}</strong>.</p>
      <p><a href="${onboardingUrl}">Complete company onboarding</a></p>
      <p>Invited by: ${invitedBy}</p>
    `;
    if (!emailConfigured()) {
      return { sent: false, mailtoUrl: `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(textBody)}` };
    }
    const from = requiredEnv.SMTP_FROM_NAME
      ? `"${requiredEnv.SMTP_FROM_NAME}" <${requiredEnv.SMTP_FROM_EMAIL}>`
      : requiredEnv.SMTP_FROM_EMAIL;
    const transporter = createSmtpTransport();
    await transporter.sendMail({ from, to: toEmail, subject, text: textBody, html: htmlBody });
    return { sent: true };
  }

  app.get("/api/onboarding/company-onboarding/invites", requireGoogleWorkspaceSession, requireMasterOnlyActor, async (_req, res) => {
    try {
      const invites = store.listInvites().map((record) => ({
        ...publicInviteSummary(record),
        notes: record.notes || "",
        consumed: Boolean(record.liveAt),
      }));
      return res.json({ ok: true, invites });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to list invites." });
    }
  });

  app.post("/api/onboarding/company-onboarding/invites", requireGoogleWorkspaceSession, requireMasterOnlyActor, async (req, res) => {
    try {
      const actor = parseBertActorFromRequest(req);
      const contactEmail = String(req.body?.contactEmail || req.body?.email || "").trim().toLowerCase();
      const contactName = String(req.body?.contactName || "").trim();
      const provisionalCompanyName = String(req.body?.provisionalCompanyName || req.body?.companyName || "").trim();
      const notes = String(req.body?.notes || "").trim();
      const invitedBy = String(req.body?.invitedBy || actor?.name || actor?.email || appBrandName).trim();

      if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
        return res.status(400).json({ ok: false, error: "A valid contact email is required." });
      }
      if (isPlatformOwnerEmail(contactEmail, process.env)) {
        return res.status(400).json({
          ok: false,
          code: "INVITE_INVALID",
          error: "The platform owner account cannot be used for company onboarding invites.",
        });
      }

      const { inviteId, rawToken, tokenHash } = generateCompanyOnboardingTokenParts();
      const now = Date.now();
      const record = {
        id: inviteId,
        inviteType: COMPANY_ONBOARDING_INVITE_TYPE,
        status: "invited",
        contactEmail,
        contactName,
        provisionalCompanyName,
        notes,
        invitedBy,
        tokenHash,
        createdAt: now,
        createdAtIso: nowIso(),
        expiresAt: now + inviteTtlMs,
        startedAt: null,
        submittedAt: null,
        liveAt: null,
        formPayload: null,
        provisionStatus: "idle",
        provisionStartedAt: null,
        provisionFinishedAt: null,
        provisionError: null,
        provisionDriveFolderId: null,
        provisionMasterSheetId: null,
        companyFolderId: null,
        masterSheetId: null,
      };
      store.createInvite(record);

      const onboardingUrl = buildCompanyOnboardingInviteUrl(requiredEnv.FRONTEND_URL, inviteId, rawToken);
      const emailResult = await sendInviteEmail({ toEmail: contactEmail, invitedBy, onboardingUrl });

      const auth = getAuthedClient();
      if (auth) {
        await syncInviteToRegistry(auth, record, deps).catch((err) => {
          console.warn("[company-onboarding] registry sync skipped on create", err instanceof Error ? err.message : err);
        });
      }

      return res.json({
        ok: true,
        invite: publicInviteSummary(record),
        inviteUrl: onboardingUrl,
        tokenId: inviteId,
        sent: emailResult.sent === true,
        mailtoUrl: emailResult.mailtoUrl,
        senderEmail: requiredEnv.SMTP_FROM_EMAIL || "",
      });
    } catch (error) {
      console.error("[company-onboarding] create invite failed", error);
      return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to create invite." });
    }
  });

  app.post("/api/onboarding/company-onboarding/invites/:inviteId/resend", requireGoogleWorkspaceSession, requireMasterOnlyActor, async (req, res) => {
    try {
      const inviteId = String(req.params.inviteId || "").trim();
      const record = store.getInvite(inviteId);
      if (!record) {
        return res.status(404).json({ ok: false, error: "Invite not found." });
      }
      if (safeLower(record.status) === "live") {
        return res.status(409).json({ ok: false, error: "This company is already live. Send a COMPANY_USER invite instead." });
      }
      const { rawToken, tokenHash } = generateCompanyOnboardingTokenParts();
      const patched = store.patchInvite(inviteId, {
        tokenHash,
        status: "invited",
        expiresAt: Date.now() + inviteTtlMs,
        provisionError: null,
      });
      const onboardingUrl = buildCompanyOnboardingInviteUrl(requiredEnv.FRONTEND_URL, inviteId, rawToken);
      const emailResult = await sendInviteEmail({
        toEmail: record.contactEmail,
        invitedBy: record.invitedBy || appBrandName,
        onboardingUrl,
      });
      const auth = getAuthedClient();
      if (auth && patched) {
        await syncInviteToRegistry(auth, patched, deps).catch(() => {});
      }
      return res.json({
        ok: true,
        invite: publicInviteSummary(patched || record),
        inviteUrl: onboardingUrl,
        sent: emailResult.sent === true,
        mailtoUrl: emailResult.mailtoUrl,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to resend invite." });
    }
  });

  app.delete("/api/onboarding/company-onboarding/invites/:inviteId", requireGoogleWorkspaceSession, requireMasterOnlyActor, async (req, res) => {
    const inviteId = String(req.params.inviteId || "").trim();
    if (!store.deleteInvite(inviteId)) {
      return res.status(404).json({ ok: false, error: "Invite not found." });
    }
    return res.json({ ok: true, revoked: true });
  });

  async function runHeadlessInviteProvisioning(inviteId, record, options = {}) {
    const formPayload = record.formPayload;
    if (!formPayload) {
      throw new Error("No submitted form data to retry provisioning.");
    }
    const authed = getAuthedClient();
    if (!authed) {
      throw new Error("Google Workspace is not connected on the server.");
    }
    const resolvedAdminEmail = safeLower(formPayload.adminEmail || record.contactEmail);
    const adminFullName = String(formPayload.adminFullName || "").trim();
    const companyName = String(formPayload.companyName || record.provisionalCompanyName || "").trim();
    const password = String(options.password || "").trim();

    let companyFolderId = String(record.companyFolderId || record.provisionDriveFolderId || "").trim();
    let masterSheetId = String(record.masterSheetId || record.provisionMasterSheetId || "").trim();

    store.patchInvite(inviteId, {
      status: "submitted",
      provisionStatus: "running",
      provisionStartedAt: Date.now(),
      provisionFinishedAt: null,
      provisionError: null,
    });

    if (!companyFolderId || !masterSheetId) {
      if (!password || password.length < 8) {
        throw new Error(
          "Workspace folders are missing. Ask the customer to reopen their onboarding link and submit again, or resend the invite.",
        );
      }
      const result = await provisionNewCompanyWorkspace(
        authed,
        {
          companyName,
          adminEmail: resolvedAdminEmail,
          adminFullName,
          password,
        },
        async (progressPatch) => {
          store.patchInvite(inviteId, progressPatch);
        },
      );
      companyFolderId = result.companyFolderId;
      masterSheetId = result.masterSheetId;
      store.patchInvite(inviteId, {
        provisionDriveFolderId: companyFolderId,
        provisionMasterSheetId: masterSheetId,
        companyFolderId,
        masterSheetId,
      });
    } else {
      const cfg = await getConfig(authed, masterSheetId);
      await updateConfig(authed, masterSheetId, {
        ...cfg,
        ...buildConfigFromForm(formPayload, inviteId, COMPANY_WORKSPACE_STATUS.PROVISIONING),
        companyId: companyFolderId,
        companyName,
      });
      const existingUser = await readCompanyUsersTabRecord(authed, masterSheetId, resolvedAdminEmail);
      if (!existingUser && password.length >= 8) {
        await deps.writeCompanyUsers(authed, masterSheetId, companyFolderId, [
          {
            id: `app-${resolvedAdminEmail.replace(/[^a-z0-9]+/gi, "-")}`,
            email: resolvedAdminEmail,
            role: "Admin",
            name: adminFullName,
            password,
            invitedBy: record.invitedBy || appBrandName,
            senderEmail: "",
            sentAt: nowIso(),
            updatedAt: nowIso(),
            syncStatus: "Synced",
          },
        ]);
      }
    }

    const cfgAfter = await getConfig(authed, masterSheetId);
    await updateConfig(authed, masterSheetId, {
      ...cfgAfter,
      ...buildConfigFromForm(formPayload, inviteId, COMPANY_WORKSPACE_STATUS.LIVE),
      companyId: companyFolderId,
      companyName,
    });

    await appendRowObjects(authed, masterSheetId, "Onboarding", [
      {
        "Record ID": `onboarding-${inviteId}`,
        "Company ID": companyFolderId,
        "Company Name": companyName,
        "Created At": nowIso(),
        "Updated At": nowIso(),
        "Created By": resolvedAdminEmail,
        "Updated By": resolvedAdminEmail,
        "Sync Status": "Synced",
        "Sync Attempts": "0",
        "Last Sync Error": "",
        "Remote Row ID": inviteId,
        "Schema Version": deps.currentSchemaVersion || "3.0.0",
      },
    ]);

    const liveRecord = store.patchInvite(inviteId, {
      status: "live",
      liveAt: Date.now(),
      provisionStatus: "succeeded",
      provisionFinishedAt: Date.now(),
      provisionError: null,
      companyFolderId,
      masterSheetId,
      provisionDriveFolderId: companyFolderId,
      provisionMasterSheetId: masterSheetId,
    });
    await syncInviteToRegistry(authed, liveRecord, deps).catch(() => {});
    return { companyFolderId, masterSheetId, liveRecord };
  }

  app.post("/api/onboarding/company-onboarding/invites/:inviteId/repair", requireGoogleWorkspaceSession, requireMasterOnlyActor, async (req, res) => {
    try {
      const inviteId = String(req.params.inviteId || "").trim();
      const record = store.getInvite(inviteId);
      if (!record) {
        return res.status(404).json({ ok: false, error: "Invite not found." });
      }
      const authed = getAuthedClient();
      if (!authed) {
        return res.status(401).json({ ok: false, error: "Connect Google Workspace before repairing workspace links." });
      }
      const companyFolderId = String(record.companyFolderId || record.provisionDriveFolderId || "").trim();
      if (!companyFolderId) {
        return res.status(400).json({
          ok: false,
          error: "No company folder exists yet. Use Retry setup after the customer submits the form.",
        });
      }
      const repairResult = await repairCompanyInviteTarget(
        authed,
        {
          companyFolderId,
          masterSheetId: String(record.masterSheetId || record.provisionMasterSheetId || "").trim(),
          companyName: String(record.formPayload?.companyName || record.provisionalCompanyName || "").trim(),
        },
        deps.inviteTargetDeps || {},
      );
      if (repairResult.resolved?.masterSheetId || repairResult.resolved?.companyFolderId) {
        store.patchInvite(inviteId, {
          companyFolderId: repairResult.resolved.companyFolderId || companyFolderId,
          masterSheetId: repairResult.resolved.masterSheetId || record.masterSheetId,
          provisionDriveFolderId: repairResult.resolved.companyFolderId || companyFolderId,
          provisionMasterSheetId: repairResult.resolved.masterSheetId || record.masterSheetId,
        });
      }
      const updated = store.getInvite(inviteId);
      if (updated) {
        await syncInviteToRegistry(authed, updated, deps).catch(() => {});
      }
      return res.json({
        ok: repairResult.ok,
        invite: publicInviteSummary(updated || record),
        code: repairResult.code,
        message: repairResult.message,
        diagnostics: repairResult.diagnostics,
        repairedInvites: repairResult.repairedInvites,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to repair workspace link.",
      });
    }
  });

  app.post("/api/onboarding/company-onboarding/invites/:inviteId/retry", requireGoogleWorkspaceSession, requireMasterOnlyActor, async (req, res) => {
    const inviteId = String(req.params.inviteId || "").trim();
    const record = store.getInvite(inviteId);
    if (!record) {
      return res.status(404).json({ ok: false, error: "Invite not found." });
    }
    if (!record.formPayload) {
      return res.status(400).json({ ok: false, error: "No submitted form data to retry provisioning." });
    }
    if (!envConfigured() || !getAuthedClient()) {
      return res.status(503).json({ ok: false, error: "Google Workspace is not connected. Retry from Initial Setup." });
    }
    try {
      await runWithInviteLock(inviteId, async () => {
        await runHeadlessInviteProvisioning(inviteId, store.getInvite(inviteId) || record);
      });
      return res.json({ ok: true, invite: publicInviteSummary(store.getInvite(inviteId)) });
    } catch (error) {
      console.error("[company-onboarding] headless retry failed", error);
      store.patchInvite(inviteId, {
        status: "setup_failed",
        provisionStatus: "failed",
        provisionFinishedAt: Date.now(),
        provisionError: error instanceof Error ? error.message : String(error),
      });
      const failed = store.getInvite(inviteId);
      if (failed && getAuthedClient()) {
        await syncInviteToRegistry(getAuthedClient(), failed, deps).catch(() => {});
      }
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to retry provisioning.",
      });
    }
  });

  const handleCompanyOnboardingInviteGet = async (req, res) => {
    const parsed = parseCompanyOnboardingUrlToken(req.params.tokenParam);
    const record = parsed ? store.getInvite(parsed.inviteId) : null;
    const access = resolveCompanyOnboardingInviteAccess(record, parsed);
    if (!access.ok) {
      return res.status(access.httpStatus).json({
        ok: false,
        code: access.code,
        error: access.error,
      });
    }
    const inviteRecord = access.record;
    return res.json({
      ok: true,
      invite: {
        ...publicInviteSummary(inviteRecord),
        adminEmailDefault: inviteRecord.contactEmail,
        provisionalCompanyName: inviteRecord.provisionalCompanyName || "",
        mainNeedOptions: MAIN_NEED_OPTIONS,
      },
    });
  };

  app.get("/api/onboarding/company-onboarding/invite/:tokenParam", handleCompanyOnboardingInviteGet);

  app.post("/api/onboarding/company-onboarding/invite/:tokenParam/start", async (req, res) => {
    const parsed = parseCompanyOnboardingUrlToken(req.params.tokenParam);
    const record = parsed ? store.getInvite(parsed.inviteId) : null;
    const access = resolveCompanyOnboardingInviteAccess(record, parsed);
    if (!access.ok) {
      return res.status(access.httpStatus).json({
        ok: false,
        code: access.code,
        error: access.error,
      });
    }
    if (safeLower(access.record.status) === "invited") {
      store.patchInvite(parsed.inviteId, { status: "started", startedAt: Date.now() });
    }
    return res.json({ ok: true });
  });

  const handleCompanyOnboardingComplete = async (req, res) => {
    const parsed = parseCompanyOnboardingUrlToken(req.params.tokenParam);
    const inviteRecord = parsed ? store.getInvite(parsed.inviteId) : null;
    const access = resolveCompanyOnboardingInviteAccess(inviteRecord, parsed);
    if (!access.ok) {
      return res.status(access.httpStatus).json({
        ok: false,
        code: access.code,
        error: access.error,
      });
    }

    if (!envConfigured()) {
      return res.status(503).json({
        ok: false,
        code: "PROVISIONING_FAILED",
        error: COMPANY_ONBOARDING_SETUP_FAILED_MESSAGE,
      });
    }
    const authed = getAuthedClient();
    if (!authed) {
      return res.status(503).json({
        ok: false,
        code: "PROVISIONING_FAILED",
        error: COMPANY_ONBOARDING_SETUP_FAILED_MESSAGE,
      });
    }

    const password = String(req.body?.password || "");
    const confirmPassword = String(req.body?.confirmPassword || "");
    const adminFirstName = String(req.body?.adminFirstName || "").trim();
    const adminLastName = String(req.body?.adminLastName || "").trim();
    const adminFullName =
      [adminFirstName, adminLastName].filter(Boolean).join(" ") ||
      String(req.body?.adminFullName || req.body?.fullName || "").trim();
    const adminEmail = String(req.body?.adminEmail || "").trim().toLowerCase();
    const companyName = String(req.body?.companyName || "").trim();
    const website = String(req.body?.website || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const addressLine1 = String(req.body?.addressLine1 || "").trim();
    const addressLine2 = String(req.body?.addressLine2 || "").trim();
    const town = String(req.body?.town || "").trim();
    const county = String(req.body?.county || "").trim();
    const postcode = String(req.body?.postcode || "").trim();
    const country = String(req.body?.country || "").trim();
    const address = String(req.body?.address || "").trim();
    const industry = String(req.body?.industry || "").trim();
    const sitesCount = String(req.body?.sitesCount ?? req.body?.sites ?? "").trim();
    const usersCount = String(req.body?.usersCount ?? req.body?.users ?? "").trim();
    const mainNeeds = normalizeMainNeeds(req.body?.mainNeeds);

    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: "Password must be at least 8 characters." });
    }
    if (confirmPassword && confirmPassword !== password) {
      return res.status(400).json({ ok: false, error: "Password confirmation does not match." });
    }
    if (!adminFullName) {
      return res.status(400).json({ ok: false, error: "Administrator name is required." });
    }
    if (!companyName) {
      return res.status(400).json({ ok: false, error: "Company name is required." });
    }

    await runWithInviteLock(parsed.inviteId, async () => {
      let record = store.getInvite(parsed.inviteId);
      const lockedAccess = resolveCompanyOnboardingInviteAccess(record, parsed);
      if (!lockedAccess.ok) {
        res.status(lockedAccess.httpStatus).json({
          ok: false,
          code: lockedAccess.code,
          error: lockedAccess.error,
        });
        return;
      }
      record = lockedAccess.record;

      const boundEmail = safeLower(record.contactEmail);
      if (isPlatformOwnerEmail(boundEmail, process.env) || isPlatformOwnerEmail(adminEmail, process.env)) {
        res.status(400).json({
          ok: false,
          code: "INVITE_INVALID",
          error: "The platform owner account cannot be used for company onboarding.",
        });
        return;
      }
      const resolvedAdminEmail = adminEmail || boundEmail;
      if (resolvedAdminEmail !== boundEmail) {
        res.status(400).json({ ok: false, error: "Administrator email must match the invited contact email." });
        return;
      }

      const formPayload = {
        companyName,
        website,
        phone,
        address,
        addressLine1,
        addressLine2,
        town,
        county,
        postcode,
        country,
        industry,
        sitesCount,
        usersCount,
        mainNeeds,
        adminFirstName,
        adminLastName,
        adminFullName,
        adminEmail: resolvedAdminEmail,
      };

      if (safeLower(record.status) === "live" && record.masterSheetId && record.companyFolderId) {
        const probe = await probeCompanyLoginSheet(authed, record.masterSheetId, resolvedAdminEmail, password);
        if (probe.passwordVerified && probe.rec) {
          const payload = JSON.stringify({
            v: 1,
            email: resolvedAdminEmail,
            masterSheetId: record.masterSheetId,
            role: probe.rec.role,
            name: probe.rec.name,
          });
          res.cookie(companySessionCookie, payload, getSessionCookieOptions({ maxAge: companySessionMs }));
          res.json({
            ok: true,
            outcome: "company_onboarding",
            status: "live",
            masterSheetId: record.masterSheetId,
            companyFolderId: record.companyFolderId,
            sessionStarted: true,
          });
          return;
        }
      }

      if (record.provisionStatus === "running") {
        res.status(202).json({
          ok: false,
          code: "invite_in_progress",
          provisionStatus: "running",
          error: "Your company setup is already in progress. Keep this page open.",
        });
        return;
      }

      if (safeLower(record.status) === "setup_failed") {
        store.patchInvite(parsed.inviteId, {
          status: "submitted",
          provisionStatus: "idle",
          provisionError: null,
        });
      }

      store.patchInvite(parsed.inviteId, {
        status: "submitted",
        submittedAt: record.submittedAt || Date.now(),
        formPayload,
        provisionStatus: "running",
        provisionStartedAt: Date.now(),
        provisionFinishedAt: null,
        provisionError: null,
      });

      let companyFolderId = String(record.companyFolderId || record.provisionDriveFolderId || "").trim();
      let masterSheetId = String(record.masterSheetId || record.provisionMasterSheetId || "").trim();

      try {
        if (masterSheetId) {
          const cfgProvisioning = await getConfig(authed, masterSheetId);
          await updateConfig(authed, masterSheetId, {
            ...cfgProvisioning,
            ...buildConfigFromForm(formPayload, parsed.inviteId, COMPANY_WORKSPACE_STATUS.PROVISIONING),
            companyId: companyFolderId || cfgProvisioning.companyId,
            companyName,
          });
        }

        if (!companyFolderId || !masterSheetId) {
          const result = await provisionNewCompanyWorkspace(
            authed,
            {
              companyName,
              adminEmail: resolvedAdminEmail,
              adminFullName,
              password,
            },
            async (progressPatch) => {
              store.patchInvite(parsed.inviteId, progressPatch);
            },
          );
          companyFolderId = result.companyFolderId;
          masterSheetId = result.masterSheetId;
          store.patchInvite(parsed.inviteId, {
            provisionDriveFolderId: companyFolderId,
            provisionMasterSheetId: masterSheetId,
            companyFolderId,
            masterSheetId,
          });
        } else {
          const cfg = await getConfig(authed, masterSheetId);
          await updateConfig(authed, masterSheetId, {
            ...cfg,
            ...buildConfigFromForm(formPayload, parsed.inviteId),
            companyId: companyFolderId,
            companyName,
          });
          const existingUser = await readCompanyUsersTabRecord(authed, masterSheetId, resolvedAdminEmail);
          if (!existingUser) {
            await deps.writeCompanyUsers(authed, masterSheetId, companyFolderId, [
              {
                id: `app-${resolvedAdminEmail.replace(/[^a-z0-9]+/gi, "-")}`,
                email: resolvedAdminEmail,
                role: "Admin",
                name: adminFullName,
                password,
                invitedBy: record.invitedBy || appBrandName,
                senderEmail: "",
                sentAt: nowIso(),
                updatedAt: nowIso(),
                syncStatus: "Synced",
              },
            ]);
          }
        }

        const cfgAfter = await getConfig(authed, masterSheetId);
        await updateConfig(authed, masterSheetId, {
          ...cfgAfter,
          ...buildConfigFromForm(formPayload, parsed.inviteId, COMPANY_WORKSPACE_STATUS.LIVE),
          companyId: companyFolderId,
          companyName,
        });

        await appendRowObjects(authed, masterSheetId, "Onboarding", [
          {
            "Record ID": `onboarding-${parsed.inviteId}`,
            "Company ID": companyFolderId,
            "Company Name": companyName,
            "Created At": nowIso(),
            "Updated At": nowIso(),
            "Created By": resolvedAdminEmail,
            "Updated By": resolvedAdminEmail,
            "Sync Status": "Synced",
            "Sync Attempts": "0",
            "Last Sync Error": "",
            "Remote Row ID": parsed.inviteId,
            "Schema Version": deps.currentSchemaVersion || "3.0.0",
          },
        ]);

        const liveRecord = store.patchInvite(parsed.inviteId, {
          status: "live",
          liveAt: Date.now(),
          provisionStatus: "succeeded",
          provisionFinishedAt: Date.now(),
          provisionError: null,
          companyFolderId,
          masterSheetId,
          provisionDriveFolderId: companyFolderId,
          provisionMasterSheetId: masterSheetId,
        });

        await syncInviteToRegistry(authed, liveRecord, deps).catch(() => {});

        const probe = await probeCompanyLoginSheet(authed, masterSheetId, resolvedAdminEmail, password);
        if (probe.passwordVerified && probe.rec) {
          const payload = JSON.stringify({
            v: 1,
            email: resolvedAdminEmail,
            masterSheetId,
            role: probe.rec.role,
            name: probe.rec.name,
          });
          res.cookie(companySessionCookie, payload, getSessionCookieOptions({ maxAge: companySessionMs }));
        }

        res.json({
          ok: true,
          outcome: "company_onboarding",
          status: "live",
          companyFolderId,
          masterSheetId,
          sessionStarted: Boolean(probe.passwordVerified),
        });
      } catch (error) {
        console.error("[company-onboarding] provision failed", error);
        const provisionError = error instanceof Error ? error.message : String(error);
        store.patchInvite(parsed.inviteId, {
          status: "setup_failed",
          provisionStatus: "failed",
          provisionFinishedAt: Date.now(),
          provisionError,
          provisionStage: companyFolderId && masterSheetId ? "finalize" : companyFolderId ? "master_sheet" : "drive_folder",
          ...(companyFolderId ? { companyFolderId, provisionDriveFolderId: companyFolderId } : {}),
          ...(masterSheetId ? { masterSheetId, provisionMasterSheetId: masterSheetId } : {}),
        });
        const failed = store.getInvite(parsed.inviteId);
        const failedFolderId = String(failed?.companyFolderId || failed?.provisionDriveFolderId || companyFolderId || "").trim();
        const failedSheetId = String(failed?.masterSheetId || failed?.provisionMasterSheetId || masterSheetId || "").trim();
        if (failedSheetId) {
          try {
            const cfgFailed = await getConfig(authed, failedSheetId);
            await updateConfig(authed, failedSheetId, {
              ...cfgFailed,
              companyOnboardingStatus: COMPANY_WORKSPACE_STATUS.SETUP_FAILED,
              ...(failedFolderId ? { companyId: failedFolderId } : {}),
            });
          } catch {
            /* best-effort */
          }
        }
        if (failedFolderId && failedSheetId) {
          await recordCompanyWorkspaceHealthCheck(authed, deps, {
            companyId: failedFolderId,
            companyFolderId: failedFolderId,
            rootFolderId: failedFolderId,
            masterSheetId: failedSheetId,
            companyName: formPayload.companyName || companyName,
            healthOk: false,
            healthSummary: "provisioning_failed",
            unlinkReason: provisionError,
          }).catch(() => {});
        }
        if (failed) {
          await syncInviteToRegistry(authed, failed, deps).catch(() => {});
        }
        res.status(500).json({
          ok: false,
          code: "PROVISIONING_FAILED",
          error: COMPANY_ONBOARDING_SETUP_FAILED_MESSAGE,
          provisionStatus: "failed",
          canRetrySetup: true,
          companyFolderId: failedFolderId || undefined,
          masterSheetId: failedSheetId || undefined,
        });
      }
    });
  };

  app.post("/api/onboarding/company-onboarding/invite/:tokenParam/complete", handleCompanyOnboardingComplete);
  app.post("/api/onboarding/company/:tokenParam/complete", handleCompanyOnboardingComplete);
}

export { MAIN_NEED_OPTIONS, REGISTRY_TAB_ONBOARDING, createInviteStoreApi };
export { REGISTRY_SPREADSHEET_NAME, REGISTRY_TAB_COMPANIES } from "./company-workspace-registry.mjs";
