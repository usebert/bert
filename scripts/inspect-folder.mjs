import fs from "node:fs";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const folderId = process.argv[2];

if (!folderId) {
  console.error("Usage: node scripts/inspect-folder.mjs <folderId>");
  process.exit(1);
}

const session = JSON.parse(fs.readFileSync(".sessions/google-session.json", "utf8"));
const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials(session.tokens);

const drive = google.drive({ version: "v3", auth });
const sheets = google.sheets({ version: "v4", auth });

const safeLower = (value = "") => String(value || "").trim().toLowerCase();
const normalizeFolderName = (value = "") =>
  safeLower(value)
    .replace(/^\d+\s*/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const folderResponse = await drive.files.get({
  fileId: folderId,
  supportsAllDrives: true,
  fields: "id,name,mimeType,createdTime",
});

const childrenResponse = await drive.files.list({
  includeItemsFromAllDrives: true,
  supportsAllDrives: true,
  q: `'${folderId}' in parents and trashed = false`,
  fields: "files(id,name,mimeType)",
  pageSize: 200,
});

const children = childrenResponse.data.files || [];
const findNamedFolder = (...names) => {
  const expected = names.map((name) => normalizeFolderName(name));
  return (
    children.find(
      (file) =>
        file.mimeType === "application/vnd.google-apps.folder" &&
        expected.includes(normalizeFolderName(file.name)),
    ) || null
  );
};

const auditFormsFolder = findNamedFolder("02 Audit Forms", "Audit Forms", "Audits", "Audit Form Folder");
const masterDataFolder = findNamedFolder("03 Master Data Sheet", "Master Data Sheet", "Company Master Sheet", "Master Sheet");
const evidenceFolder = findNamedFolder("04 Evidence", "Evidence", "Evidence Folder");
const exportsFolder = findNamedFolder("05 Exports", "Exports", "Export Folder");
const adminNotesFolder = findNamedFolder("06 Admin Notes", "Admin Notes", "Notes");

let auditFolderContents = [];
if (auditFormsFolder) {
  const response = await drive.files.list({
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    q: `'${auditFormsFolder.id}' in parents and trashed = false`,
    fields: "files(id,name,mimeType)",
    pageSize: 200,
  });
  auditFolderContents = response.data.files || [];
}

let masterDataContents = [];
if (masterDataFolder) {
  const response = await drive.files.list({
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    q: `'${masterDataFolder.id}' in parents and trashed = false`,
    fields: "files(id,name,mimeType)",
    pageSize: 200,
  });
  masterDataContents = response.data.files || [];
}

const masterSheet =
  masterDataContents.find((file) => file.mimeType === "application/vnd.google-apps.spreadsheet") ||
  children.find((file) => file.mimeType === "application/vnd.google-apps.spreadsheet") ||
  null;

let masterSheetTabs = [];
if (masterSheet?.id) {
  const workbook = await sheets.spreadsheets.get({
    spreadsheetId: masterSheet.id,
    fields: "sheets(properties(title))",
  });

  masterSheetTabs =
    workbook.data.sheets?.map((sheet) => sheet.properties?.title).filter(Boolean) || [];
}

console.log(
  JSON.stringify(
    {
      folder: folderResponse.data,
      children,
      checks: {
        auditFormsFolder: Boolean(auditFormsFolder),
        masterDataFolder: Boolean(masterDataFolder),
        masterSheet: Boolean(masterSheet),
        evidenceFolder: Boolean(evidenceFolder),
        exportsFolder: Boolean(exportsFolder),
        adminNotesFolder: Boolean(adminNotesFolder),
      },
      matched: {
        auditFormsFolder,
        masterDataFolder,
        evidenceFolder,
        exportsFolder,
        adminNotesFolder,
        masterSheet,
        masterSheetTabs,
      },
      auditForms: auditFolderContents.filter((file) => file.mimeType === "application/vnd.google-apps.form"),
      masterDataContents,
    },
    null,
    2,
  ),
);
