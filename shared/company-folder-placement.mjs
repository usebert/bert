/**
 * Company folders must live under the canonical Live Companies parent in the workspace Drive.
 */

export const FOLDER_NOT_IN_COMPANIES_ROOT = "FOLDER_NOT_IN_COMPANIES_ROOT";

export const LIVE_COMPANIES_FOLDER_LABEL = "Live Companies";

export const FOLDER_NOT_IN_COMPANIES_ROOT_MESSAGE =
  "This company is not set up in BERT. Contact your administrator.";

export const FOLDER_PLACEMENT_USER_MESSAGE = FOLDER_NOT_IN_COMPANIES_ROOT_MESSAGE;

export const FOLDER_PLACEMENT_LOGIN_MESSAGE = FOLDER_NOT_IN_COMPANIES_ROOT_MESSAGE;

function safeLower(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/** Normalize Drive folder names for Live Companies matching (01 Live Companies, etc.). */
export function normalizeLiveCompaniesFolderName(name = "") {
  return safeLower(name)
    .replace(/^\d+\s*/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isLiveCompaniesFolderName(name = "") {
  const normalized = normalizeLiveCompaniesFolderName(name);
  return normalized === "live companies" || normalized === "companies";
}

/** True when companyFolderId is a direct or indirect child of the Live Companies folder. */
export function isFolderUnderLiveCompanies(companyFolderId, liveCompaniesFolderId, ancestorParentIds = []) {
  const folderId = String(companyFolderId || "").trim();
  const liveId = String(liveCompaniesFolderId || "").trim();
  if (!folderId || !liveId || folderId === liveId) {
    return false;
  }
  return (ancestorParentIds || []).map((entry) => String(entry || "").trim()).includes(liveId);
}

export const LIVE_COMPANIES_FAILURE_REASON = {
  MISSING_SHARED_DRIVE_ID: "missing_shared_drive_id",
  WORKSPACE_ROOT_INACCESSIBLE: "workspace_root_inaccessible",
  SHARED_DRIVE_ID_IS_COMPANY_FOLDER: "shared_drive_id_is_company_folder",
  LIVE_COMPANIES_FOLDER_NOT_FOUND: "live_companies_folder_not_found",
};

function trimId(value) {
  return String(value || "").trim();
}

function normalizeFolderLabel(name = "") {
  return safeLower(name)
    .replace(/^\d+\s*/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function looksLikeCompanyWorkspaceRoot(topLevelFolderNames = []) {
  const normalizedNames = topLevelFolderNames.map((name) => normalizeFolderLabel(name));
  const hasLiveCompanies = topLevelFolderNames.some((name) => isLiveCompaniesFolderName(name));
  const hasMasterControl = normalizedNames.some((name) => name === "master control");
  if (hasLiveCompanies || hasMasterControl) {
    return false;
  }
  return normalizedNames.some(
    (name) =>
      name.includes("bert system files") ||
      name.includes("forms checks") ||
      name.includes("iso compliance") ||
      name.includes("health safety"),
  );
}

/** Operator-facing setup steps when Live Companies cannot be resolved. */
export function formatLiveCompaniesSetupHint(reasonCode = "") {
  const lines = [
    "Platform workspace setup:",
    "1. Set GOOGLE_SHARED_DRIVE_ID in .env to the BERT workspace root (Shared Drive or top-level folder such as Master Folder), not a company folder id.",
    "2. Connect Google OAuth for the provisioning account (.sessions/google-oauth-token.json for scripts, or Master → Platform Setup → Connect Google in the app).",
    "3. Under that workspace root in Google Drive, ensure a top-level folder named Live Companies or 01 Live Companies exists (Companies is also accepted).",
    "4. Verify: sign in as Master → Platform Setup → verify Drive root, or POST /api/google/verify-shared-drive while the API is running.",
    "5. Re-run: DEMO_COMPANY_SEED_CONFIRM=yes BERT_DEMO_DEFAULT_PASSWORD='...' npm run create:demo-company -- --live",
  ];
  if (reasonCode === LIVE_COMPANIES_FAILURE_REASON.SHARED_DRIVE_ID_IS_COMPANY_FOLDER) {
    lines.splice(
      1,
      0,
      "GOOGLE_SHARED_DRIVE_ID currently resolves to a company folder (for example Dovecote Studio), not the platform workspace root.",
    );
  }
  return lines.join("\n");
}

/**
 * Turn resolveLiveCompaniesFolder() output into a structured failure for operators/scripts.
 * Configuration source: GOOGLE_SHARED_DRIVE_ID (.env) → Google Drive lookup (not registry or .sessions manifest).
 */
export function describeLiveCompaniesResolutionFailure(resolution = {}, options = {}) {
  const sharedDriveId = trimId(options.sharedDriveId);
  const companyFolderId = trimId(options.companyFolderId);
  const topLevelFolderNames = (resolution.topLevelFolders || [])
    .map((entry) => trimId(entry?.name))
    .filter(Boolean);
  const workspaceRoot = resolution.workspaceRoot || {};
  const diagnostics = {
    configurationSource: "GOOGLE_SHARED_DRIVE_ID",
    sharedDriveIdConfigured: Boolean(sharedDriveId),
    sharedDriveIdPrefix: sharedDriveId ? `${sharedDriveId.slice(0, 8)}...` : "",
    workspaceRootAccessible: workspaceRoot.ok === true,
    workspaceRootKind: trimId(workspaceRoot.kind) || undefined,
    workspaceRootName: trimId(workspaceRoot.name) || undefined,
    workspaceRootError: trimId(workspaceRoot.error) || trimId(resolution.warning) || undefined,
    liveCompaniesMissing: resolution.liveCompaniesMissing !== false,
    liveCompaniesFolderId: trimId(resolution.liveCompaniesFolderId) || undefined,
    liveCompaniesFolderName: trimId(resolution.liveCompaniesFolder?.name) || undefined,
    topLevelFolderNames,
    expectedLiveCompaniesFolderNames: [LIVE_COMPANIES_FOLDER_LABEL, "01 Live Companies", "Companies"],
  };

  if (!sharedDriveId) {
    return {
      ok: false,
      reasonCode: LIVE_COMPANIES_FAILURE_REASON.MISSING_SHARED_DRIVE_ID,
      message: "GOOGLE_SHARED_DRIVE_ID is not configured. Live Companies is resolved by listing top-level folders under this workspace root in Google Drive.",
      diagnostics,
      setupHint: formatLiveCompaniesSetupHint(LIVE_COMPANIES_FAILURE_REASON.MISSING_SHARED_DRIVE_ID),
    };
  }

  if (!workspaceRoot.ok) {
    return {
      ok: false,
      reasonCode: LIVE_COMPANIES_FAILURE_REASON.WORKSPACE_ROOT_INACCESSIBLE,
      message:
        diagnostics.workspaceRootError ||
        "BERT Google account cannot access GOOGLE_SHARED_DRIVE_ID. Connect Google OAuth for an account with access to the workspace root.",
      diagnostics,
      setupHint: formatLiveCompaniesSetupHint(LIVE_COMPANIES_FAILURE_REASON.WORKSPACE_ROOT_INACCESSIBLE),
    };
  }

  if (!resolution.liveCompaniesMissing && trimId(resolution.liveCompaniesFolderId)) {
    return { ok: true, reasonCode: "", message: "", diagnostics };
  }

  const sharedDriveMatchesCompanyFolder =
    Boolean(companyFolderId) && sharedDriveId === companyFolderId;
  const rootLooksLikeCompany = looksLikeCompanyWorkspaceRoot(topLevelFolderNames);

  if (sharedDriveMatchesCompanyFolder || rootLooksLikeCompany) {
    return {
      ok: false,
      reasonCode: LIVE_COMPANIES_FAILURE_REASON.SHARED_DRIVE_ID_IS_COMPANY_FOLDER,
      message: `GOOGLE_SHARED_DRIVE_ID resolves to "${diagnostics.workspaceRootName || sharedDriveId}", which looks like a company folder (children: ${topLevelFolderNames.join(", ") || "none"}). Point it at the platform workspace root that contains Archive, Live Companies, and Master Control.`,
      diagnostics: {
        ...diagnostics,
        misconfiguration: sharedDriveMatchesCompanyFolder
          ? "GOOGLE_SHARED_DRIVE_ID equals a configured company folder id"
          : "workspace root children match a company folder layout, not platform containers",
      },
      setupHint: formatLiveCompaniesSetupHint(LIVE_COMPANIES_FAILURE_REASON.SHARED_DRIVE_ID_IS_COMPANY_FOLDER),
    };
  }

  return {
    ok: false,
    reasonCode: LIVE_COMPANIES_FAILURE_REASON.LIVE_COMPANIES_FOLDER_NOT_FOUND,
    message: `${LIVE_COMPANIES_FOLDER_LABEL} folder not found under workspace root "${diagnostics.workspaceRootName || sharedDriveId}". Top-level folders: ${topLevelFolderNames.join(", ") || "(none)"}.`,
    diagnostics,
    setupHint: formatLiveCompaniesSetupHint(LIVE_COMPANIES_FAILURE_REASON.LIVE_COMPANIES_FOLDER_NOT_FOUND),
  };
}
