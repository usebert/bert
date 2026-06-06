import { google } from "googleapis";

export const STALE_INVITE_CUSTOMER_MESSAGE =
  "This invite is out of date. Please ask your administrator to send a fresh invite.";

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

function staleTargetResult({ message, companyLabel, masterSheetIdPresent }) {
  return {
    ok: false,
    code: "stale_invite_target",
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
      message:
        "BERT cannot finish account setup until Google Workspace is connected on the server. Ask your administrator to reconnect Google, then try again.",
      httpStatus: 401,
      masterSheetIdPresent,
      companyLabel,
    };
  }

  if (!companyFolderId || !masterSheetId) {
    return staleTargetResult({
      message: STALE_INVITE_CUSTOMER_MESSAGE,
      companyLabel,
      masterSheetIdPresent,
    });
  }

  if (isArchiveOrNonLiveWorkspaceName(companyName)) {
    return staleTargetResult({
      message:
        "This invite points to an archived company workspace that is no longer used for new users. Ask your administrator to send a new invite from your active company workspace.",
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
        message:
          "The company workspace for this invite has been removed from Google Drive. Ask your administrator to send a new invite.",
        companyLabel: folder.name || companyLabel,
        masterSheetIdPresent: true,
      });
    }
    if (folder.mimeType !== "application/vnd.google-apps.folder") {
      return staleTargetResult({
        message: "This invite does not point to a valid company folder. Ask your administrator to send a new invite.",
        companyLabel: folder.name || companyLabel,
        masterSheetIdPresent: true,
      });
    }
    folderName = String(folder.name || "").trim() || folderName;
    if (isArchiveOrNonLiveWorkspaceName(folderName)) {
      return staleTargetResult({
        message:
          "This invite points to an archived company workspace that is no longer used for new users. Ask your administrator to send a new invite from your active company workspace.",
        companyLabel: folderName,
        masterSheetIdPresent: true,
      });
    }
  } catch (err) {
    if (isGoogleNotFoundError(err)) {
      return staleTargetResult({
        message:
          "The company workspace for this invite could not be found in Google Drive. Ask your administrator to send a new invite.",
        companyLabel,
        masterSheetIdPresent: true,
      });
    }
    return {
      ok: false,
      code: "google_api_error",
      message:
        "We could not verify your company workspace with Google right now. Wait a few minutes and try again, or ask your administrator for a new invite.",
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
        message: STALE_INVITE_CUSTOMER_MESSAGE,
        companyLabel: folderName || companyLabel,
        masterSheetIdPresent: true,
      });
    }
    if (isGoogleAccessDeniedError(err)) {
      return {
        ok: false,
        code: "google_access_denied",
        message:
          "BERT cannot access the company master sheet yet. Ask your administrator to reconnect Google and repair the company workspace link.",
        httpStatus: 403,
        masterSheetIdPresent: true,
        companyLabel: folderName || companyLabel,
      };
    }
    return {
      ok: false,
      code: "google_api_error",
      message:
        "We could not verify the company master sheet with Google right now. Wait a few minutes and try again, or ask your administrator for a new invite.",
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
