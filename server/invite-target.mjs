import { google } from "googleapis";

export const INVITE_COMPANY_LINK_MISSING_CODE = "INVITE_COMPANY_LINK_MISSING";
export const COMPANY_MASTER_SHEET_UNAVAILABLE_CODE = "COMPANY_MASTER_SHEET_UNAVAILABLE";
export const USER_SETUP_FAILED_CODE = "USER_SETUP_FAILED";

export const INVITE_COMPANY_LINK_MISSING_MESSAGE =
  "This invite is no longer valid. Ask your administrator to send a fresh invite.";

export const COMPANY_MASTER_SHEET_UNAVAILABLE_MESSAGE =
  "BERT is temporarily unavailable. Please try again shortly.";

export const USER_SETUP_FAILED_MESSAGE =
  "We couldn't finish setting up your account. Ask your administrator to check your invite.";

/** @deprecated Use INVITE_COMPANY_LINK_MISSING_MESSAGE for customer-facing copy. */
export const STALE_INVITE_CUSTOMER_MESSAGE = INVITE_COMPANY_LINK_MISSING_MESSAGE;

/** Strip numeric prefixes and punctuation so "99 Archive" and "Archive" match. */
export function normalizeWorkspaceFolderLabel(name = "") {
  return String(name || "")
    .toLowerCase()
    .replace(/^\d+\s*/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Archive containers and archived company folders are not live invite targets. */
export function isArchiveOrNonLiveWorkspaceName(name) {
  const normalized = normalizeWorkspaceFolderLabel(name);
  return normalized === "archive" || normalized === "archived";
}

/** Reserved platform folder labels — not valid company areas/sites. */
export function isReservedWorkspaceAreaName(name) {
  const normalized = normalizeWorkspaceFolderLabel(name);
  if (isArchiveOrNonLiveWorkspaceName(name)) {
    return true;
  }
  return (
    normalized === "live companies" ||
    normalized === "master control" ||
    normalized === "companies" ||
    normalized === "company"
  );
}

export function isGoogleNotFoundError(err) {
  const status = err?.code ?? err?.response?.status ?? err?.status;
  if (status === 404 || status === 410) {
    return true;
  }
  const message = String(err?.message || err?.response?.data?.error?.message || "");
  return /not found/i.test(message) || /requested entity was not found/i.test(message);
}

export function isGoogleAccessDeniedError(err) {
  const status = err?.code ?? err?.response?.status ?? err?.status;
  if (status === 403 || status === 401) {
    return true;
  }
  const message = String(err?.message || err?.response?.data?.error?.message || "");
  return /permission|forbidden|insufficient|access denied/i.test(message);
}

export function mapInviteTargetCodeForCustomer(code) {
  const normalized = String(code || "").trim();
  switch (normalized) {
    case "stale_invite_target":
    case INVITE_COMPANY_LINK_MISSING_CODE:
      return INVITE_COMPANY_LINK_MISSING_CODE;
    case "google_api_error":
    case "google_access_denied":
    case "google_not_connected":
      return COMPANY_MASTER_SHEET_UNAVAILABLE_CODE;
    case USER_SETUP_FAILED_CODE:
    case "setup_failed":
      return USER_SETUP_FAILED_CODE;
    default:
      return normalized;
  }
}

export function customerMessageForInviteTargetCode(code) {
  const mapped = mapInviteTargetCodeForCustomer(code);
  switch (mapped) {
    case INVITE_COMPANY_LINK_MISSING_CODE:
      return INVITE_COMPANY_LINK_MISSING_MESSAGE;
    case COMPANY_MASTER_SHEET_UNAVAILABLE_CODE:
      return COMPANY_MASTER_SHEET_UNAVAILABLE_MESSAGE;
    case USER_SETUP_FAILED_CODE:
      return USER_SETUP_FAILED_MESSAGE;
    default:
      return "";
  }
}

function staleTargetResult({ message, companyLabel, masterSheetIdPresent, code = "stale_invite_target" }) {
  return {
    ok: false,
    code,
    message,
    httpStatus: 409,
    masterSheetIdPresent: Boolean(masterSheetIdPresent),
    companyLabel: companyLabel || "",
  };
}

/**
 * Validates company-user invite targets before create/complete/retry.
 * Does not weaken auth — requires an authenticated Google client.
 */
export async function validateCompanyUserInviteTarget(auth, target = {}) {
  const companyFolderId = String(target.companyFolderId || "").trim();
  const masterSheetId = String(target.masterSheetId || "").trim();
  const companyName = String(target.companyName || "").trim();
  const masterSheetIdPresent = Boolean(masterSheetId);
  const companyLabel = companyName || companyFolderId;

  if (!auth) {
    return {
      ok: false,
      code: "google_not_connected",
      message: COMPANY_MASTER_SHEET_UNAVAILABLE_MESSAGE,
      httpStatus: 401,
      masterSheetIdPresent,
      companyLabel,
    };
  }

  if (!companyFolderId || !masterSheetId) {
    return staleTargetResult({
      code: INVITE_COMPANY_LINK_MISSING_CODE,
      message: INVITE_COMPANY_LINK_MISSING_MESSAGE,
      companyLabel,
      masterSheetIdPresent,
    });
  }

  if (isArchiveOrNonLiveWorkspaceName(companyName)) {
    return staleTargetResult({
      code: INVITE_COMPANY_LINK_MISSING_CODE,
      message: INVITE_COMPANY_LINK_MISSING_MESSAGE,
      companyLabel: companyName,
      masterSheetIdPresent: true,
    });
  }

  const drive = google.drive({ version: "v3", auth });

  let folderName = companyName;
  try {
    const folderResponse = await drive.files.get({
      fileId: companyFolderId,
      supportsAllDrives: true,
      fields: "id,name,mimeType,trashed",
    });
    const folder = folderResponse.data;
    if (folder.trashed) {
      return staleTargetResult({
        code: INVITE_COMPANY_LINK_MISSING_CODE,
        message: INVITE_COMPANY_LINK_MISSING_MESSAGE,
        companyLabel: folder.name || companyLabel,
        masterSheetIdPresent: true,
      });
    }
    if (folder.mimeType !== "application/vnd.google-apps.folder") {
      return staleTargetResult({
        code: INVITE_COMPANY_LINK_MISSING_CODE,
        message: INVITE_COMPANY_LINK_MISSING_MESSAGE,
        companyLabel: folder.name || companyLabel,
        masterSheetIdPresent: true,
      });
    }
    folderName = String(folder.name || "").trim() || folderName;
    if (isArchiveOrNonLiveWorkspaceName(folderName)) {
      return staleTargetResult({
        code: INVITE_COMPANY_LINK_MISSING_CODE,
        message: INVITE_COMPANY_LINK_MISSING_MESSAGE,
        companyLabel: folderName,
        masterSheetIdPresent: true,
      });
    }
  } catch (err) {
    if (isGoogleNotFoundError(err)) {
      return staleTargetResult({
        code: INVITE_COMPANY_LINK_MISSING_CODE,
        message: INVITE_COMPANY_LINK_MISSING_MESSAGE,
        companyLabel,
        masterSheetIdPresent: true,
      });
    }
    return {
      ok: false,
      code: "google_api_error",
      message: COMPANY_MASTER_SHEET_UNAVAILABLE_MESSAGE,
      httpStatus: 503,
      masterSheetIdPresent: true,
      companyLabel,
    };
  }

  const sheets = google.sheets({ version: "v4", auth });
  try {
    await sheets.spreadsheets.get({
      spreadsheetId: masterSheetId,
      fields: "spreadsheetId",
    });
  } catch (err) {
    if (isGoogleNotFoundError(err)) {
      return staleTargetResult({
        code: INVITE_COMPANY_LINK_MISSING_CODE,
        message: INVITE_COMPANY_LINK_MISSING_MESSAGE,
        companyLabel: folderName || companyLabel,
        masterSheetIdPresent: true,
      });
    }
    if (isGoogleAccessDeniedError(err)) {
      return {
        ok: false,
        code: "google_access_denied",
        message: COMPANY_MASTER_SHEET_UNAVAILABLE_MESSAGE,
        httpStatus: 403,
        masterSheetIdPresent: true,
        companyLabel: folderName || companyLabel,
      };
    }
    return {
      ok: false,
      code: "google_api_error",
      message: COMPANY_MASTER_SHEET_UNAVAILABLE_MESSAGE,
      httpStatus: 503,
      masterSheetIdPresent: true,
      companyLabel: folderName || companyLabel,
    };
  }

  return {
    ok: true,
    masterSheetIdPresent: true,
    companyLabel: folderName || companyLabel,
  };
}

export function logInviteCompleteFailure({
  code,
  email,
  tokenId,
  company,
  masterSheetIdPresent,
  diagnostics = [],
}) {
  const diagnosticText = Array.isArray(diagnostics) && diagnostics.length ? diagnostics.join(",") : "";
  console.warn(
    `[invite] complete failed code=${code || "unknown"} email=${email || ""} tokenId=${tokenId || ""} company=${company || ""} masterSheetIdPresent=${masterSheetIdPresent ? "true" : "false"}${diagnosticText ? ` diagnostics=${diagnosticText}` : ""}`,
  );
}
