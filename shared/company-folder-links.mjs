/** Build a shareable Google Drive folder URL from a folder id. */
export function buildCompanyFolderUrl(folderId = "") {
  const id = String(folderId || "").trim();
  return id ? `https://drive.google.com/drive/folders/${id}` : "";
}

/**
 * Operator hint for sharing a company folder with the API Google connection.
 * @param {{ companyFolderId?: string; googleConnectedEmail?: string }} input
 */
export function buildShareCompanyFolderHint(input = {}) {
  const folderUrl = buildCompanyFolderUrl(input.companyFolderId);
  const googleEmail = String(input.googleConnectedEmail || "").trim().toLowerCase();
  if (!folderUrl) {
    return "";
  }
  const shareTarget = googleEmail || "the Google account connected in BERT Platform Setup (Connect Google)";
  return `Share this folder with ${shareTarget}: ${folderUrl}`;
}
