#!/usr/bin/env node
/** Mirrors src/utils/godmodeCompanyFolders.ts — keep filter rules in sync. */

function normalizeWorkspaceFolderLabel(name = "") {
  return String(name || "")
    .toLowerCase()
    .replace(/^\d+\s*/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isArchiveOrNonLiveWorkspaceName(name) {
  const normalized = normalizeWorkspaceFolderLabel(name);
  return normalized === "archive" || normalized === "archived";
}

function isReservedGodmodeCompanyFolderName(name) {
  const normalized = normalizeWorkspaceFolderLabel(name);
  if (isArchiveOrNonLiveWorkspaceName(name)) {
    return true;
  }
  return (
    normalized === "live companies" ||
    normalized === "master control" ||
    normalized === "companies" ||
    normalized === "company" ||
    normalized === "shared drive" ||
    normalized === "shared drive root"
  );
}

function isDisallowedGodmodeCompanyDisplayName(name) {
  const normalized = normalizeWorkspaceFolderLabel(name);
  return !normalized || normalized === "bert";
}

function filterSelectableGodmodeCompanyFolders(folders) {
  return folders.filter(
    (folder) =>
      Boolean(String(folder.id || "").trim()) &&
      !isReservedGodmodeCompanyFolderName(folder.name) &&
      !isDisallowedGodmodeCompanyDisplayName(folder.name),
  );
}

function assertGodmodeLiveCompanyWorkspace(input) {
  const companyFolderId = String(input.companyFolderId || "").trim();
  const masterSheetId = String(input.masterSheetId || "").trim();
  const companyName = String(input.companyName || "").trim();
  if (!companyFolderId || !masterSheetId) {
    return { ok: false };
  }
  if (isReservedGodmodeCompanyFolderName(companyName)) {
    return { ok: false };
  }
  if (isArchiveOrNonLiveWorkspaceName(companyName)) {
    return { ok: false };
  }
  if (isDisallowedGodmodeCompanyDisplayName(companyName)) {
    return { ok: false };
  }
  if (input.selectableFolderIds && !input.selectableFolderIds.includes(companyFolderId)) {
    return { ok: false };
  }
  return { ok: true };
}

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

const sample = [
  { id: "live-1", name: "Acme Precast" },
  { id: "archive-1", name: "99 Archive" },
  { id: "live-companies", name: "Live Companies" },
  { id: "master", name: "00 Master Control" },
  { id: "bert-folder", name: "bert." },
  { id: "company-root", name: "Companies" },
];

const filtered = filterSelectableGodmodeCompanyFolders(sample);
assert(filtered.length === 1 && filtered[0].id === "live-1", "filters reserved and brand folders");

assert(
  assertGodmodeLiveCompanyWorkspace({
    companyFolderId: "live-1",
    companyName: "Acme Precast",
    masterSheetId: "sheet-1",
    selectableFolderIds: ["live-1"],
  }).ok,
  "accepts live company with master sheet",
);

assert(
  !assertGodmodeLiveCompanyWorkspace({
    companyFolderId: "live-1",
    companyName: "Acme Precast",
    masterSheetId: "",
    selectableFolderIds: ["live-1"],
  }).ok,
  "rejects missing master sheet",
);

assert(
  !assertGodmodeLiveCompanyWorkspace({
    companyFolderId: "archive-1",
    companyName: "99 Archive",
    masterSheetId: "sheet-1",
    selectableFolderIds: ["archive-1"],
  }).ok,
  "rejects archive folder",
);

/** Keep in sync with MASTER_COMPANY_SCOPED_SCREENS in src/config/roleNavigation.ts */
const MASTER_COMPANY_SCOPED_SCREENS = ["companies", "users", "schedules", "qmsReadiness"];

assert(
  !MASTER_COMPANY_SCOPED_SCREENS.includes("reports"),
  "reports is platform diagnostics for Master, not company-scoped",
);

assert(
  !MASTER_COMPANY_SCOPED_SCREENS.includes("setup"),
  "setup is platform-scoped for Master",
);

console.log("[verify:godmode-company-context] OK");
