/**
 * Folder-first company bootstrap — connect an existing Drive folder as a BERT company.
 * companyId === companyFolderId; workbook inside folder is the database.
 */
import { cleanCompanyNameFromFolder } from "../shared/company-folder-context.mjs";
import { buildCompanyFolderUrl } from "../shared/company-folder-links.mjs";
import { inviteAccessLevelForRole } from "../shared/schedule-assignees.mjs";
import { resolveCompanyFromFolder } from "./company-folder-resolver.mjs";
import { ensureRequiredTabs, listTabTitles } from "./workbook-service.mjs";
import { hashPassword, rebuildAuthIndexFromUsersTab } from "./user-auth-service.mjs";
import { writeUsersTabRecordByHeaders } from "./company-users.mjs";
import { migrateUsersTabColumns } from "./company-users.mjs";
import { repairUsersTabSchema } from "./users-tab-reader.mjs";
import { findMissingRequiredTabs, SETUP_REQUIRED_TABS } from "./ensure-required-tabs.mjs";
import { ensureCompanyRegistryRecordForWorkspace } from "./company-workspace-registry.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return trim(value).toLowerCase();
}

function parseAdminInput(body = {}) {
  const admin = body.admin && typeof body.admin === "object" ? body.admin : {};
  const email = normalizeEmail(admin.email || body.adminEmail);
  const name = trim(admin.name || body.adminName);
  const password = trim(admin.password || body.adminPassword);
  if (!email && !password) {
    return null;
  }
  return { email, name, password };
}

async function upsertActiveAdmin(auth, deps, input = {}) {
  const { masterSheetId, companyFolderId, companyName, email, name, password } = input;
  if (!email || !password) {
    return { ok: false, skipped: true };
  }

  const userDeps = typeof deps.getCompanyUsersDeps === "function" ? deps.getCompanyUsersDeps() : deps;
  const companyContext = {
    companyFolderId,
    companyId: companyFolderId,
    companyName,
  };

  await repairUsersTabSchema(auth, masterSheetId, userDeps, { companyContext }).catch(() => null);
  await migrateUsersTabColumns(auth, masterSheetId, userDeps, { companyContext }).catch(() => null);

  const now = new Date().toISOString();
  const fullName = name || email;
  const record = {
    "User ID": `bootstrap-${email.replace(/[^a-z0-9]+/gi, "-")}`,
    "Company ID": companyFolderId,
    Company: companyName,
    CompanyId: companyFolderId,
    CompanyFolderId: companyFolderId,
    "Full Name": fullName,
    Name: fullName,
    Email: email,
    Role: "Admin",
    AccessLevel: inviteAccessLevelForRole("Admin"),
    Status: "ACTIVE",
    PasswordHash: hashPassword(password),
    PasswordUpdatedAt: now,
    CreatedAt: now,
    UpdatedAt: now,
    InvitedAt: now,
    "Created By": "BERT Godmode",
    "Updated By": "BERT Godmode",
    "Sync Status": "Synced",
    "Schema Version": trim(deps.currentSchemaVersion || "3.0.0"),
  };

  const writeResult = await writeUsersTabRecordByHeaders(auth, masterSheetId, record, userDeps, {
    companyContext,
  });
  if (!writeResult.ok) {
    return { ok: false, reason: writeResult.reason || "admin_write_failed" };
  }

  if (typeof deps.getConfig === "function" && typeof deps.updateConfig === "function") {
    const cfg = await deps.getConfig(auth, masterSheetId);
    const legacyKey = `UserAuth.${email}`;
    if (cfg[legacyKey]) {
      const next = { ...cfg };
      delete next[legacyKey];
      await deps.updateConfig(auth, masterSheetId, next).catch(() => null);
    }
  }

  return { ok: true, email, updated: Boolean(writeResult.updated), appended: Boolean(writeResult.appended) };
}

/**
 * Connect a Google Drive company folder as a usable BERT company workspace.
 */
export async function connectCompanyFolder(auth, deps, input = {}) {
  const companyFolderId = trim(input.companyFolderId);
  const companyNameHint = trim(input.companyName);
  const admin = parseAdminInput(input);

  if (!auth) {
    return {
      ok: false,
      reasonCode: "GOOGLE_NOT_CONNECTED",
      error: "Connect Google Workspace before connecting a company folder.",
    };
  }
  if (!companyFolderId) {
    return {
      ok: false,
      reasonCode: "COMPANY_FOLDER_MISSING",
      error: "Company folder ID is required.",
    };
  }
  if (admin && (!admin.email || !admin.password)) {
    return {
      ok: false,
      reasonCode: "ADMIN_INCOMPLETE",
      error: "Admin email and password are both required when supplying an admin.",
    };
  }

  const resolved = await resolveCompanyFromFolder(auth, deps, companyFolderId, {
    ensureTabsSync: false,
    createIfMissing: true,
    skipFolderPlacementCheck: true,
    requestedBy: trim(input.requestedBy || "connect-folder"),
  });

  if (!resolved.ok) {
    return {
      ok: false,
      reasonCode: resolved.reasonCode || "FOLDER_RESOLVE_FAILED",
      error: resolved.userMessage || resolved.error || "Unable to resolve company folder.",
      companyFolderId,
      companyFolderUrl: buildCompanyFolderUrl(companyFolderId),
      operatorHint: resolved.operatorHint,
    };
  }

  const masterSheetId = trim(resolved.masterSheetId);
  const companyName = companyNameHint || trim(resolved.companyName) || cleanCompanyNameFromFolder(companyNameHint);
  if (!masterSheetId) {
    return {
      ok: false,
      reasonCode: "MASTER_SHEET_MISSING",
      error: "Could not find or create the company workbook in the folder.",
      companyFolderId,
    };
  }

  const tabResult = await ensureRequiredTabs(auth, deps, masterSheetId, {
    requiredTabs: SETUP_REQUIRED_TABS,
  });
  const tabTitles = await listTabTitles(auth, deps, masterSheetId).catch(() => []);
  const missingTabs = findMissingRequiredTabs(tabTitles, SETUP_REQUIRED_TABS);

  if (typeof deps.ensureTabsAndColumns === "function") {
    await deps.ensureTabsAndColumns(auth, masterSheetId, {
      companyId: companyFolderId,
      companyName,
    }).catch(() => null);
  }

  const existingConfig =
    typeof deps.getConfig === "function" ? await deps.getConfig(auth, masterSheetId).catch(() => ({})) : {};
  const now = new Date().toISOString();
  if (typeof deps.updateConfig === "function") {
    await deps.updateConfig(auth, masterSheetId, {
      ...existingConfig,
      companyId: companyFolderId,
      companyFolderId,
      companyName,
      masterSheetId,
      schemaVersion: trim(deps.currentSchemaVersion || existingConfig.schemaVersion || "3.0.0"),
      createdAt: existingConfig.createdAt || now,
      connectedAt: now,
      lastRepairedAt: now,
      companyFolderStructureVersion: existingConfig.companyFolderStructureVersion || "1",
    });
  }

  let adminResult = null;
  if (admin) {
    adminResult = await upsertActiveAdmin(auth, deps, {
      masterSheetId,
      companyFolderId,
      companyName,
      email: admin.email,
      name: admin.name,
      password: admin.password,
    });
    if (!adminResult.ok && !adminResult.skipped) {
      return {
        ok: false,
        reasonCode: "ADMIN_UPSERT_FAILED",
        error: "Company workbook is ready but the admin user could not be saved.",
        companyFolderId,
        masterSheetId,
      };
    }
    if (adminResult.ok && deps.authIndex) {
      const companyContext = {
        companyFolderId,
        companyId: companyFolderId,
        companyName,
        masterSheetId,
      };
      await rebuildAuthIndexFromUsersTab(auth, deps, companyContext, deps.authIndex, admin.email).catch((error) => {
        console.warn("[company-folder-connect] auth index rebuild failed (non-blocking)", {
          companyFolderId,
          email: admin.email,
          error: error instanceof Error ? error.message : error,
        });
      });
    }
  }

  try {
    const registryDeps =
      typeof deps.getCompanyWorkspaceRegistryDeps === "function" ? deps.getCompanyWorkspaceRegistryDeps() : deps;
    await ensureCompanyRegistryRecordForWorkspace(auth, { ...deps, ...registryDeps }, {
      companyId: companyFolderId,
      companyFolderId,
      rootFolderId: companyFolderId,
      masterSheetId,
      companyName,
    });
  } catch (error) {
    console.warn("[company-folder-connect] registry persist failed (non-blocking)", {
      companyFolderId,
      error: error instanceof Error ? error.message : error,
    });
  }

  return {
    ok: true,
    company: {
      companyId: companyFolderId,
      companyFolderId,
      companyName,
      masterSheetId,
      workbookId: masterSheetId,
      status: "usable",
    },
    tabsEnsured: Boolean(tabResult?.ok),
    tabsAdded: tabResult?.tabsAdded || [],
    missingTabs,
    adminUpserted: Boolean(adminResult?.ok),
  };
}

export function installCompanyFolderConnectRoutes(app, deps) {
  const { getAuthedClient, envConfigured, requireGoogleWorkspaceSession, requireMasterOnlyActor } = deps;

  app.post(
    "/api/godmode/companies/connect-folder",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    async (req, res) => {
      if (!envConfigured()) {
        return res.status(503).json({
          ok: false,
          error: "Google Workspace is not configured on the server.",
        });
      }
      const authed = getAuthedClient();
      if (!authed) {
        return res.status(401).json({
          ok: false,
          error: "Connect Google Workspace before connecting a company folder.",
        });
      }

      const companyFolderId = trim(req.body?.companyFolderId);
      try {
        const result = await connectCompanyFolder(authed, deps, {
          companyFolderId,
          companyName: trim(req.body?.companyName),
          admin: req.body?.admin,
          requestedBy: trim(req.body?.requestedBy || "godmode"),
        });
        if (!result.ok) {
          const status =
            result.reasonCode === "GOOGLE_NOT_CONNECTED"
              ? 401
              : result.reasonCode === "COMPANY_FOLDER_MISSING" || result.reasonCode === "ADMIN_INCOMPLETE"
                ? 400
                : result.reasonCode === "MASTER_SHEET_MISSING" || result.reasonCode === "FOLDER_RESOLVE_FAILED"
                  ? 400
                  : 500;
          return res.status(status).json(result);
        }
        return res.json(result);
      } catch (error) {
        console.error("[company-folder-connect] connect-folder failed", error);
        const message = error instanceof Error ? error.message : "Unable to connect company folder.";
        return res.status(500).json({
          ok: false,
          companyFolderId,
          error: message,
        });
      }
    },
  );
}
