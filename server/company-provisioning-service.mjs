/**
 * Automated company creation — Master/Godmode only.
 * Staged, idempotent provisioning keyed by operationId.
 */
import { randomBytes } from "node:crypto";
import { inviteAccessLevelForRole } from "../shared/schedule-assignees.mjs";
import { DOCUMENT_MODULE_REQUIRED_TABS } from "../shared/document-schema.mjs";
import { HEALTH_SAFETY_REQUIRED_TABS } from "../shared/health-safety.mjs";
import { RISK_ASSESSMENT_REQUIRED_TABS } from "../shared/risk-assessments.mjs";
import { findMissingRequiredTabs, SETUP_REQUIRED_TABS } from "./ensure-required-tabs.mjs";
import {
  ensureCompanyFolderStructure,
  ensureCompanyMasterSheet,
} from "./company-folder-structure.mjs";
import { ensureRequiredTabs, ensureTabColumns } from "./workbook-service.mjs";
import { hashPassword, rebuildAuthIndexFromUsersTab } from "./user-auth-service.mjs";
import { writeUsersTabRecordByHeaders, migrateUsersTabColumns } from "./company-users.mjs";
import { repairUsersTabSchema } from "./users-tab-reader.mjs";
import { ensureCompanyRegistryRecordForWorkspace } from "./company-workspace-registry.mjs";
import { provisionDocumentFolders } from "./document-folder-service.mjs";
import { deriveUsernameFromEmail, normalizeUsername } from "../shared/login-username.mjs";
import { describeLiveCompaniesResolutionFailure } from "../shared/company-folder-placement.mjs";

const operations = new Map();

export const COMPANY_PROVISION_STAGES = [
  { id: "creating_company_folder", label: "Creating company folder" },
  { id: "creating_workbook", label: "Creating workbook" },
  { id: "preparing_workbook_tabs", label: "Preparing workbook tabs" },
  { id: "creating_first_administrator", label: "Creating first administrator" },
  { id: "creating_bert_folders", label: "Creating BERT folders" },
  { id: "creating_iso_document_structure", label: "Creating ISO 9001 document structure" },
  { id: "registering_company", label: "Registering company" },
  { id: "finishing_setup", label: "Finishing setup" },
];

/** Simple operational folders under company root (idempotent by exact name). */
export const STANDARD_BERT_OPERATIONAL_FOLDERS = [
  "Audits",
  "Audit Results",
  "Actions",
  "Incidents",
  "NCRs",
  "Briefings",
  "Schedules",
  "Reports",
];

export const COMPANY_TYPES = [
  "Construction",
  "Manufacturing",
  "Healthcare",
  "Education",
  "Hospitality",
  "Logistics",
  "Professional Services",
  "Other",
];

const PEOPLE_TAB = "People";
const PEOPLE_TAB_COLUMNS = ["PersonID", "Name", "Email", "Role", "Status", "CreatedAt"];

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return trim(value).toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function buildOperationId() {
  return `cprov-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

function hasCompleted(state, stageId) {
  return (state.completedStages || []).includes(stageId);
}

function markCompleted(state, stageId) {
  if (!hasCompleted(state, stageId)) {
    state.completedStages = [...(state.completedStages || []), stageId];
  }
  state.updatedAt = nowIso();
  operations.set(state.operationId, state);
}

function logStageTiming(operationId, stageId, startedAt, extra = {}) {
  console.info("company_provision_stage_timings", {
    operationId,
    stage: stageId,
    durationMs: Date.now() - startedAt,
    ...extra,
  });
}

export function getCompanyProvisionOperation(operationId) {
  return operations.get(trim(operationId)) || null;
}

export function validateCompanyProvisionInput(input = {}) {
  const companyName = trim(input.companyName);
  const adminName = trim(input.adminName || input.firstAdminName);
  const adminEmail = normalizeEmail(input.adminEmail || input.firstAdminEmail);
  const adminUsername = normalizeUsername(input.adminUsername || input.firstAdminUsername || deriveUsernameFromEmail(adminEmail));
  const password = String(input.adminPassword || input.password || "");
  const confirmPassword = String(input.confirmPassword || input.adminPasswordConfirm || "");
  const companyType = trim(input.companyType);
  const errors = [];

  if (!companyName) errors.push("Company name is required.");
  if (!adminName) errors.push("First admin name is required.");
  if (!adminEmail || !adminEmail.includes("@")) errors.push("A valid first admin email is required.");
  if (!adminUsername) errors.push("First admin username is required.");
  if (!password || password.length < 8) errors.push("Password must be at least 8 characters.");
  if (password !== confirmPassword) errors.push("Passwords do not match.");
  if (companyType && !COMPANY_TYPES.includes(companyType)) errors.push("Company type is not valid.");

  return {
    ok: errors.length === 0,
    errors,
    value: {
      companyName,
      companyType,
      adminName,
      adminEmail,
      adminUsername,
      password,
      logoDataUrl: trim(input.logoDataUrl || ""),
      logoFileName: trim(input.logoFileName || "company-logo"),
      operationId: trim(input.operationId),
    },
  };
}

async function ensureNamedFolder(drive, name, parentId) {
  const safeName = String(name || "").replace(/'/g, "\\'");
  const listed = await drive.files.list({
    q: `'${parentId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const existing = listed?.data?.files?.[0];
  if (existing?.id) {
    return { id: existing.id, name: existing.name, created: false };
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
  return { id: created.data.id, name: created.data.name, created: true };
}

async function findCompanyFolderByName(drive, parentId, companyName) {
  const safeName = String(companyName || "").replace(/'/g, "\\'");
  const listed = await drive.files.list({
    q: `'${parentId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return listed?.data?.files?.[0] || null;
}

async function uploadLogoIfPresent(drive, companyFolderId, logoDataUrl, logoFileName) {
  const raw = trim(logoDataUrl);
  if (!raw.startsWith("data:")) {
    return null;
  }
  const match = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) {
    return null;
  }
  const { Readable } = await import("node:stream");
  const buffer = Buffer.from(match[2], "base64");
  const created = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: logoFileName || "company-logo",
      parents: [companyFolderId],
      mimeType: match[1],
    },
    media: {
      mimeType: match[1],
      body: Readable.from(buffer),
    },
    fields: "id,name",
  });
  return created.data;
}

async function seedAdminUser(auth, deps, state, admin) {
  if (state.adminSeeded) {
    return { ok: true, skipped: true };
  }
  const masterSheetId = state.masterSheetId;
  const companyFolderId = state.companyFolderId;
  const companyName = state.companyName;
  const userDeps = typeof deps.getCompanyUsersDeps === "function" ? deps.getCompanyUsersDeps() : deps;
  const companyContext = {
    companyFolderId,
    companyId: companyFolderId,
    companyName,
  };
  await repairUsersTabSchema(auth, masterSheetId, userDeps, { companyContext }).catch(() => null);
  await migrateUsersTabColumns(auth, masterSheetId, userDeps, { companyContext }).catch(() => null);

  const timestamp = nowIso();
  const record = {
    "User ID": `admin-${admin.adminUsername}`,
    "Company ID": companyFolderId,
    Company: companyName,
    CompanyId: companyFolderId,
    CompanyFolderId: companyFolderId,
    "Full Name": admin.adminName,
    Name: admin.adminName,
    Email: admin.adminEmail,
    Username: admin.adminUsername,
    Role: "Admin",
    AccessLevel: inviteAccessLevelForRole("Admin"),
    Status: "ACTIVE",
    PasswordHash: hashPassword(admin.password),
    PasswordUpdatedAt: timestamp,
    CreatedAt: timestamp,
    UpdatedAt: timestamp,
    InvitedAt: timestamp,
    "Created By": "BERT Godmode",
    "Updated By": "BERT Godmode",
    "Sync Status": "Synced",
    "Schema Version": trim(deps.currentSchemaVersion || "3.0.0"),
  };

  const writeResult = await writeUsersTabRecordByHeaders(auth, masterSheetId, record, userDeps, { companyContext });
  if (!writeResult.ok) {
    return { ok: false, error: writeResult.reason || "admin_write_failed" };
  }

  await ensureTabColumns(auth, deps, masterSheetId, PEOPLE_TAB, PEOPLE_TAB_COLUMNS);
  const { appendTabRows, readTabRecords } = await import("./workbook-service.mjs");
  if (!state.personSeeded) {
    const people = await readTabRecords(auth, deps, masterSheetId, PEOPLE_TAB, {
      expectedHeaders: PEOPLE_TAB_COLUMNS,
    }).catch(() => ({ records: [] }));
    const emailNorm = normalizeEmail(admin.adminEmail);
    const already = (people.records || []).some(
      (row) => normalizeEmail(row.Email || row.email) === emailNorm,
    );
    if (!already) {
      await appendTabRows(auth, deps, masterSheetId, PEOPLE_TAB, PEOPLE_TAB_COLUMNS, [
        {
          PersonID: `person-${admin.adminUsername}`,
          Name: admin.adminName,
          Email: admin.adminEmail,
          Role: "Admin",
          Status: "ACTIVE",
          CreatedAt: timestamp,
        },
      ]).catch(() => null);
    }
    state.personSeeded = true;
  }

  state.adminSeeded = true;
  return { ok: true, updated: Boolean(writeResult.updated), appended: Boolean(writeResult.appended) };
}

/**
 * @param {(event: object) => void | Promise<void>} onProgress
 */
export async function provisionCompanyWorkspace(auth, deps, input = {}, onProgress = async () => {}) {
  const validated = validateCompanyProvisionInput(input);
  if (!validated.ok) {
    return { ok: false, code: "PROVISION_VALIDATION", errors: validated.errors, httpStatus: 400 };
  }

  const admin = validated.value;
  let state = admin.operationId ? getCompanyProvisionOperation(admin.operationId) : null;
  if (!state) {
    state = {
      operationId: admin.operationId || buildOperationId(),
      companyName: admin.companyName,
      companyType: admin.companyType,
      adminEmail: admin.adminEmail,
      adminUsername: admin.adminUsername,
      adminName: admin.adminName,
      completedStages: [],
      companyFolderId: "",
      masterSheetId: "",
      adminSeeded: false,
      personSeeded: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    operations.set(state.operationId, state);
  } else {
    state.companyName = admin.companyName || state.companyName;
    state.companyType = admin.companyType || state.companyType;
    state.adminEmail = admin.adminEmail || state.adminEmail;
    state.adminUsername = admin.adminUsername || state.adminUsername;
    state.adminName = admin.adminName || state.adminName;
  }

  const emit = async (stageId, status, extra = {}) => {
    const stage = COMPANY_PROVISION_STAGES.find((entry) => entry.id === stageId);
    await onProgress({
      type: "stage",
      operationId: state.operationId,
      stage: stageId,
      label: stage?.label || stageId,
      status,
      companyFolderId: state.companyFolderId || undefined,
      masterSheetId: state.masterSheetId || undefined,
      ...extra,
    });
  };

  const drive = deps.google.drive({ version: "v3", auth });
  const overallStarted = Date.now();

  try {
    // 1. Company folder
    if (!hasCompleted(state, "creating_company_folder")) {
      const started = Date.now();
      await emit("creating_company_folder", "running");
      const live = await deps.resolveLiveCompaniesFolder(auth, deps);
      const parentId = live?.liveCompaniesFolder?.id;
      if (!parentId) {
        const failure = describeLiveCompaniesResolutionFailure(live, {
          sharedDriveId: deps.sharedDriveId,
        });
        throw Object.assign(new Error(failure.message || "Live Companies folder not found. Check platform setup."), {
          stage: "creating_company_folder",
          reasonCode: failure.reasonCode,
          diagnostics: failure.diagnostics,
          setupHint: failure.setupHint,
        });
      }
      if (!state.companyFolderId) {
        const existing = await findCompanyFolderByName(drive, parentId, state.companyName);
        if (existing?.id) {
          state.companyFolderId = existing.id;
        } else {
          const created = await ensureNamedFolder(drive, state.companyName, parentId);
          state.companyFolderId = created.id;
        }
      }
      if (admin.logoDataUrl) {
        await uploadLogoIfPresent(drive, state.companyFolderId, admin.logoDataUrl, admin.logoFileName).catch(() => null);
      }
      markCompleted(state, "creating_company_folder");
      logStageTiming(state.operationId, "creating_company_folder", started, { companyFolderId: state.companyFolderId });
      await emit("creating_company_folder", "done");
    }

    // 2. Workbook
    if (!hasCompleted(state, "creating_workbook")) {
      const started = Date.now();
      await emit("creating_workbook", "running");
      const sheet = await ensureCompanyMasterSheet(drive, {
        companyName: state.companyName,
        workbookFolderId: state.companyFolderId,
      });
      state.masterSheetId = sheet.masterSheetId;
      markCompleted(state, "creating_workbook");
      logStageTiming(state.operationId, "creating_workbook", started, { masterSheetId: state.masterSheetId });
      await emit("creating_workbook", "done");
    }

    // 3. Tabs
    if (!hasCompleted(state, "preparing_workbook_tabs")) {
      const started = Date.now();
      await emit("preparing_workbook_tabs", "running");
      const requiredTabs = [...new Set([...SETUP_REQUIRED_TABS, ...DOCUMENT_MODULE_REQUIRED_TABS, PEOPLE_TAB, "Incidents", ...HEALTH_SAFETY_REQUIRED_TABS, ...RISK_ASSESSMENT_REQUIRED_TABS])];
      const tabResult = await ensureRequiredTabs(auth, { ...deps, requiredTabs }, state.masterSheetId);
      await ensureTabColumns(auth, deps, state.masterSheetId, PEOPLE_TAB, PEOPLE_TAB_COLUMNS);
      if (typeof deps.ensureTabsAndColumns === "function") {
        await deps.ensureTabsAndColumns(auth, state.masterSheetId, {
          companyId: state.companyFolderId,
          companyName: state.companyName,
        });
      }
      markCompleted(state, "preparing_workbook_tabs");
      logStageTiming(state.operationId, "preparing_workbook_tabs", started, {
        tabsAdded: tabResult?.tabsAdded || [],
      });
      await emit("preparing_workbook_tabs", "done", { tabsAdded: tabResult?.tabsAdded || [] });
    }

    // 4. Admin
    if (!hasCompleted(state, "creating_first_administrator")) {
      const started = Date.now();
      await emit("creating_first_administrator", "running");
      const seeded = await seedAdminUser(auth, deps, state, admin);
      if (!seeded.ok) {
        throw Object.assign(new Error("Could not create the first administrator."), {
          stage: "creating_first_administrator",
          details: seeded.error,
        });
      }
      markCompleted(state, "creating_first_administrator");
      logStageTiming(state.operationId, "creating_first_administrator", started, { skipped: Boolean(seeded.skipped) });
      await emit("creating_first_administrator", "done");
    }

    // 5. BERT folders
    if (!hasCompleted(state, "creating_bert_folders")) {
      const started = Date.now();
      await emit("creating_bert_folders", "running");
      const structureDeps = {
        google: deps.google,
        ensureTabExists: deps.ensureTabExists,
        ensureColumns: deps.ensureColumns,
        getWorkbook: deps.getWorkbook,
        getTabValues: deps.getTabValues,
        withSheetsQuotaRetry: deps.withSheetsQuotaRetry,
        safeLower: deps.safeLower,
      };
      await ensureCompanyFolderStructure(structureDeps, auth, {
        companyName: state.companyName,
        companyRootFolderId: state.companyFolderId,
        masterSheetId: state.masterSheetId,
        syncWorkbookTab: true,
        placeFiles: true,
      });
      for (const folderName of STANDARD_BERT_OPERATIONAL_FOLDERS) {
        await ensureNamedFolder(drive, folderName, state.companyFolderId);
      }
      markCompleted(state, "creating_bert_folders");
      logStageTiming(state.operationId, "creating_bert_folders", started);
      await emit("creating_bert_folders", "done");
    }

    // 6. ISO Controlled Documents
    if (!hasCompleted(state, "creating_iso_document_structure")) {
      const started = Date.now();
      await emit("creating_iso_document_structure", "running");
      const provisioned = await provisionDocumentFolders(
        auth,
        deps,
        {
          companyFolderId: state.companyFolderId,
          companyId: state.companyFolderId,
          masterSheetId: state.masterSheetId,
          companyName: state.companyName,
        },
        drive,
      );
      if (!provisioned.ok) {
        throw Object.assign(new Error(provisioned.error || "Could not provision document folders."), {
          stage: "creating_iso_document_structure",
        });
      }
      markCompleted(state, "creating_iso_document_structure");
      logStageTiming(state.operationId, "creating_iso_document_structure", started, {
        folderCount: provisioned.summary?.registryRows,
      });
      await emit("creating_iso_document_structure", "done", { summary: provisioned.summary });
    }

    // 7. Registry
    if (!hasCompleted(state, "registering_company")) {
      const started = Date.now();
      await emit("registering_company", "running");
      const registryDeps =
        typeof deps.getCompanyWorkspaceRegistryDeps === "function" ? deps.getCompanyWorkspaceRegistryDeps() : deps;
      await ensureCompanyRegistryRecordForWorkspace(auth, { ...deps, ...registryDeps }, {
        companyId: state.companyFolderId,
        companyFolderId: state.companyFolderId,
        rootFolderId: state.companyFolderId,
        masterSheetId: state.masterSheetId,
        companyName: state.companyName,
      });
      if (typeof deps.updateConfig === "function" && typeof deps.getConfig === "function") {
        const cfg = await deps.getConfig(auth, state.masterSheetId);
        await deps.updateConfig(auth, state.masterSheetId, {
          ...cfg,
          companyName: state.companyName,
          companyType: state.companyType || cfg.companyType || "",
          companyFolderId: state.companyFolderId,
          provisionedAt: nowIso(),
        });
      }
      markCompleted(state, "registering_company");
      logStageTiming(state.operationId, "registering_company", started);
      await emit("registering_company", "done");
    }

    // 8. Finish
    if (!hasCompleted(state, "finishing_setup")) {
      const started = Date.now();
      await emit("finishing_setup", "running");
      if (deps.authIndex) {
        await rebuildAuthIndexFromUsersTab(
          auth,
          deps,
          {
            companyFolderId: state.companyFolderId,
            companyId: state.companyFolderId,
            companyName: state.companyName,
            masterSheetId: state.masterSheetId,
          },
          deps.authIndex,
          state.adminEmail,
        ).catch((error) => {
          console.warn("[company-provisioning] auth index rebuild failed (non-blocking)", {
            operationId: state.operationId,
            error: error instanceof Error ? error.message : error,
          });
        });
      }
      markCompleted(state, "finishing_setup");
      logStageTiming(state.operationId, "finishing_setup", started);
      await emit("finishing_setup", "done");
    }

    state.status = "complete";
    operations.set(state.operationId, state);
    console.info("company_provision_timings", {
      operationId: state.operationId,
      companyFolderId: state.companyFolderId,
      masterSheetId: state.masterSheetId,
      totalMs: Date.now() - overallStarted,
      completedStages: state.completedStages,
    });

    const company = {
      companyId: state.companyFolderId,
      companyFolderId: state.companyFolderId,
      companyName: state.companyName,
      masterSheetId: state.masterSheetId,
      workbookId: state.masterSheetId,
      adminUsername: state.adminUsername,
      adminEmail: state.adminEmail,
      adminName: state.adminName,
      status: "usable",
    };

    await onProgress({ type: "complete", operationId: state.operationId, company });

    return {
      ok: true,
      operationId: state.operationId,
      company,
      completedStages: state.completedStages,
    };
  } catch (error) {
    const stage = error?.stage || "unknown";
    const message = error instanceof Error ? error.message : String(error);
    state.status = "failed";
    state.failedStage = stage;
    state.lastError = message;
    operations.set(state.operationId, state);
    await onProgress({
      type: "error",
      operationId: state.operationId,
      stage,
      label: COMPANY_PROVISION_STAGES.find((entry) => entry.id === stage)?.label || stage,
      error: message,
      companyFolderId: state.companyFolderId || undefined,
      masterSheetId: state.masterSheetId || undefined,
    });
    return {
      ok: false,
      code: "PROVISION_FAILED",
      error: message,
      failedStage: stage,
      reasonCode: error?.reasonCode || undefined,
      diagnostics: error?.diagnostics || undefined,
      setupHint: error?.setupHint || undefined,
      operationId: state.operationId,
      companyFolderId: state.companyFolderId || undefined,
      masterSheetId: state.masterSheetId || undefined,
      completedStages: state.completedStages || [],
      httpStatus: 500,
    };
  }
}

export function assertProvisionTabsCoverRequirements() {
  const required = [...SETUP_REQUIRED_TABS, ...DOCUMENT_MODULE_REQUIRED_TABS, PEOPLE_TAB, "Incidents", ...HEALTH_SAFETY_REQUIRED_TABS, ...RISK_ASSESSMENT_REQUIRED_TABS];
  return findMissingRequiredTabs([], required);
}
