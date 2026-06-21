#!/usr/bin/env node
/** Godmode company selector + dashboard header — backend session is source of truth. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;

function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const appTsx = read("App.tsx");
const godmodeStart = read("src/screens/GodmodeStartScreen.tsx");
const godmodeCtx = read("src/utils/godmodeCompanyContext.ts");
const godmodeService = read("src/services/godmodeService.ts");
const companyService = read("src/services/companyService.ts");
const applyLinked = read("src/utils/applyLinkedCompanyContext.ts");
const authClient = read("src/services/authService.ts");
const masterAuth = read("server/master-auth.mjs");
const folderResolver = read("server/company-folder-resolver.mjs");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:godmode-company-wiring"], "PKG: npm script registered");

assert(godmodeService.includes("listGodmodeLiveCompanies"), "1: godmode service lists live companies");
assert(godmodeService.includes("resolveGodmodeCompanyFromFolder"), "1b: godmode service resolves from folder");
assert(godmodeService.includes("mergeGodmodeLiveCompanyFolders"), "1c: godmode service merges live + local folders");
assert(godmodeService.includes("isGodmodeCompanyPickerReady"), "1d: godmode service exposes picker-ready helper");
assert(companyService.includes("/resolve-from-folder"), "1e: company service calls resolve-from-folder API");
assert(godmodeCtx.includes("resolveAndSyncMasterCompanySelection"), "1f: resolve + session sync helper");
assert(godmodeCtx.includes("/api/auth/master/company-context"), "1g: session sync posts master company-context");

assert(appTsx.includes("listGodmodeLiveCompanies"), "2: App loads companies via godmode service");
assert(appTsx.includes("resolveAndSyncMasterCompanySelection"), "2b: App selects company via backend resolve");
assert(!appTsx.includes("readGodmodeSelectedCompanyFolderId"), "2c: App does not restore godmode folder from localStorage");
assert(!appTsx.includes("writeGodmodeSelectedCompanyFolderId"), "2d: App does not persist godmode folder to localStorage");
assert(
  /handleSelectFolder[\s\S]*?clearCompanyWorkspaceLocalStateForGodmodeSwitch/.test(appTsx),
  "2e: company switch clears previous godmode workspace state",
);
assert(
  /handleSelectFolder[\s\S]*?setLinkedCompanyContext\(null\)/.test(appTsx),
  "2f: company switch clears linked context before new selection",
);
assert(
  /handleSelectFolder[\s\S]*?skipLoginHint:\s*true/.test(appTsx),
  "2g: godmode selection skips company login hint localStorage",
);

assert(authClient.includes("normalizeMasterSessionCompany"), "3: session client restores master company");
assert(authClient.includes("fetchAppSession"), "3b: bootstrap uses GET /api/session");
assert(masterAuth.includes("/api/auth/master/company-context"), "3c: backend persists master selected company");

assert(applyLinked.includes("skipLoginHint"), "4: linked context supports skipLoginHint for Godmode");
assert(applyLinked.includes("resolveGodmodeCompanySetupStatus"), "4a: linked context restores folder-first setup status");
assert(appTsx.includes("activeCompanyContext.companyName"), "4b: header/account use activeCompanyContext");
assert(appTsx.includes("resolveHeaderWorkingOn"), "4c: header working-on resolver wired");
assert(appTsx.includes("setHydratedCompanyFolderId"), "4d: refresh tracks hydrated company folder id");
assert(appTsx.includes("isGodmodeCompanyPickerReady"), "4e: App uses folder-first picker readiness");

assert(!/PasswordHash/.test(authClient), "5: client auth service omits PasswordHash");
assert(!/PasswordHash/.test(companyService), "5b: company service omits PasswordHash");

assert(godmodeStart.includes("!isGodmodeCompanyPickerReady"), "5c: Godmode picker gates Continue/Repair with picker-ready helper");
assert(
  /handleGodmodeCompanyFolderConnected[\s\S]*?loadGodmodeLiveCompanies/.test(appTsx),
  "5d: connect-folder triggers live-companies merge reload",
);
assert(
  /handlePickCompany[\s\S]*?await onSelectCompany\(folderId\)[\s\S]*?openHub\(\)/.test(godmodeStart),
  "5e: Godmode picker awaits company selection before opening hub",
);
assert(appTsx.includes("resolveListedGodmodeMasterSheetId"), "5f: App applies listed folder-first masterSheetId on pick");
assert(appTsx.includes("resolveMasterGodmodeCompanyMasterSheetId"), "5g: App readiness accepts listed masterSheetId before hydration");
assert(
  /rejectInvalidCompanyFolder[\s\S]*?!masterSheetId/.test(masterAuth),
  "5h: master session sync skips placement rejection when masterSheetId is present",
);
assert(folderResolver.includes("masterSheetId: masterSheetIdHint"), "5i: resolve-from-folder forwards listed masterSheetId hint");
assert(folderResolver.includes("skipFolderPlacementCheck: true"), "5j: resolve-from-folder skips placement gate for Godmode pick");

/** Mirrors src/services/godmodeService.ts — keep picker helpers in sync. */
const GODMODE_PICKER_READY_LABELS = new Set(["ready", "usable", "live"]);

function isGodmodeCompanyPickerReady(input = {}) {
  if (input.setupStatus === "ready") {
    return true;
  }
  const status = String(input.status || "").trim().toLowerCase();
  if (status === "usable") {
    return true;
  }
  const label = String(input.setupStatusLabel || "").trim().toLowerCase();
  if (GODMODE_PICKER_READY_LABELS.has(label)) {
    return Boolean(String(input.masterSheetId || "").trim());
  }
  return Boolean(String(input.masterSheetId || "").trim()) && input.setupStatus !== "incomplete";
}

function resolveGodmodeCompanySetupStatus(input = {}) {
  const masterSheetId = String(input.masterSheetId || "").trim();
  const ready = isGodmodeCompanyPickerReady({ ...input, masterSheetId });
  if (ready && masterSheetId) {
    return { setupStatus: "ready", setupStatusLabel: "Ready" };
  }
  const rawLabel = String(input.setupStatusLabel || "").trim();
  return {
    setupStatus: masterSheetId ? "incomplete" : "incomplete",
    setupStatusLabel: rawLabel || (masterSheetId ? "Setup in progress" : "Setup in progress"),
  };
}

function resolveListedGodmodeMasterSheetId(folder = {}) {
  const masterSheetId = String(folder.masterSheetId || folder.responseSheetId || "").trim();
  if (!masterSheetId) {
    return "";
  }
  if (
    !isGodmodeCompanyPickerReady({
      setupStatus: folder.setupStatus,
      setupStatusLabel: folder.setupStatusLabel,
      status: folder.status,
      masterSheetId,
    })
  ) {
    return "";
  }
  return masterSheetId;
}

function resolveMasterGodmodeCompanyMasterSheetId(input = {}) {
  const hydrated = String(input.activeCompanyMasterSheetId || "").trim();
  if (hydrated) {
    return hydrated;
  }
  if (!input.selectedFolder) {
    return "";
  }
  return resolveListedGodmodeMasterSheetId(input.selectedFolder);
}

function mapGodmodeLiveCompanyToWorkspaceFolder(company) {
  const id = String(company.id || company.folderId || "").trim();
  const masterSheetId = String(company.masterSheetId || company.sheetId || "").trim();
  const setup = resolveGodmodeCompanySetupStatus({
    setupStatus: company.setupStatus,
    setupStatusLabel: company.setupStatusLabel,
    status: company.status,
    masterSheetId,
  });
  return {
    id,
    name: String(company.name || "").trim(),
    masterSheetId: masterSheetId || undefined,
    responseSheetId: masterSheetId || undefined,
    setupStatus: setup.setupStatus,
    setupStatusLabel: setup.setupStatusLabel,
    linkedAt: new Date().toISOString(),
    onboardingVerified: Boolean(masterSheetId),
    responseSheetVerified: Boolean(masterSheetId),
  };
}

function mergeGodmodeLiveCompanyFolder(existing, live) {
  const masterSheetId =
    live.masterSheetId ||
    live.responseSheetId ||
    existing.masterSheetId ||
    existing.responseSheetId ||
    "";
  const setup = resolveGodmodeCompanySetupStatus({
    setupStatus: existing.setupStatus === "ready" || live.setupStatus === "ready" ? "ready" : live.setupStatus || existing.setupStatus,
    setupStatusLabel: live.setupStatusLabel || existing.setupStatusLabel,
    masterSheetId,
  });
  return {
    ...existing,
    ...live,
    masterSheetId: masterSheetId || undefined,
    responseSheetId: masterSheetId || existing.responseSheetId,
    linkedAt: existing.linkedAt || live.linkedAt,
    onboardingVerified: existing.onboardingVerified || live.onboardingVerified || Boolean(masterSheetId),
    responseSheetVerified: existing.responseSheetVerified || live.responseSheetVerified || Boolean(masterSheetId),
    setupStatus: setup.setupStatus,
    setupStatusLabel: setup.setupStatusLabel,
    registryStatus: live.registryStatus || existing.registryStatus,
  };
}

function mergeGodmodeLiveCompanyFolders(existingFolders, liveFolders) {
  const liveById = new Map(liveFolders.map((folder) => [folder.id, folder]));
  const mergedById = new Map();

  for (const folder of existingFolders) {
    const id = String(folder.id || "").trim();
    if (!id) {
      continue;
    }
    const live = liveById.get(id);
    mergedById.set(id, live ? mergeGodmodeLiveCompanyFolder(folder, live) : folder);
  }

  for (const folder of liveFolders) {
    const id = String(folder.id || "").trim();
    if (!id || mergedById.has(id)) {
      continue;
    }
    mergedById.set(id, folder);
  }

  const orderedIds = [];
  for (const folder of existingFolders) {
    const id = String(folder.id || "").trim();
    if (id && mergedById.has(id) && !orderedIds.includes(id)) {
      orderedIds.push(id);
    }
  }
  for (const folder of liveFolders) {
    const id = String(folder.id || "").trim();
    if (id && !orderedIds.includes(id)) {
      orderedIds.push(id);
    }
  }

  return orderedIds.map((id) => mergedById.get(id)).filter(Boolean);
}

const localFolderFirst = [
  {
    id: "folder-first-1",
    name: "Folder First Co",
    masterSheetId: "sheet-local-1",
    setupStatus: "ready",
    setupStatusLabel: "Ready",
    linkedAt: "2026-06-19T10:00:00.000Z",
  },
];
const mergedAfterReload = mergeGodmodeLiveCompanyFolders(localFolderFirst, []);
assert(
  mergedAfterReload.length === 1 && mergedAfterReload[0].id === "folder-first-1",
  "6: merge preserves local folder-first company when live-companies reload is empty",
);

const liveOnly = [
  mapGodmodeLiveCompanyToWorkspaceFolder({
    id: "drive-1",
    name: "Drive Listed Co",
    masterSheetId: "sheet-drive-1",
    registryStatus: "Setup in progress",
  }),
];
const mergedWithLive = mergeGodmodeLiveCompanyFolders(localFolderFirst, liveOnly);
assert(
  mergedWithLive.length === 2 &&
    mergedWithLive[0].id === "folder-first-1" &&
    mergedWithLive.some((folder) => folder.id === "drive-1"),
  "6b: merge keeps local folder-first rows and appends live-companies rows",
);

assert(
  isGodmodeCompanyPickerReady({ status: "usable", masterSheetId: "sheet-1" }),
  "7: status usable is picker-ready when masterSheetId exists",
);
assert(
  isGodmodeCompanyPickerReady({ setupStatusLabel: "Usable", masterSheetId: "sheet-1" }),
  "7b: setupStatusLabel Usable is picker-ready when masterSheetId exists",
);
assert(
  !isGodmodeCompanyPickerReady({ setupStatusLabel: "Usable", masterSheetId: "" }),
  "7c: Usable label without masterSheetId is not picker-ready",
);

const normalizedReady = resolveGodmodeCompanySetupStatus({
  setupStatusLabel: "Usable",
  status: "usable",
  masterSheetId: "sheet-1",
});
assert(
  normalizedReady.setupStatus === "ready" && normalizedReady.setupStatusLabel === "Ready",
  "8: resolveGodmodeCompanySetupStatus normalizes folder-first ready labels",
);

const listedFolderFirstRow = {
  id: "folder-first-open-1",
  name: "Folder First Open Co",
  masterSheetId: "sheet-listed-1",
  setupStatus: "ready",
  setupStatusLabel: "Ready",
};
assert(
  resolveListedGodmodeMasterSheetId(listedFolderFirstRow) === "sheet-listed-1",
  "9: listed folder-first row exposes picker-ready masterSheetId",
);
assert(
  resolveListedGodmodeMasterSheetId({ ...listedFolderFirstRow, masterSheetId: "" }) === "",
  "9b: missing masterSheetId blocks listed open path",
);
assert(
  resolveMasterGodmodeCompanyMasterSheetId({
    activeCompanyMasterSheetId: "",
    selectedFolder: listedFolderFirstRow,
  }) === "sheet-listed-1",
  "9c: readiness guard accepts listed masterSheetId before hydration",
);
assert(
  resolveMasterGodmodeCompanyMasterSheetId({
    activeCompanyMasterSheetId: "sheet-hydrated-1",
    selectedFolder: listedFolderFirstRow,
  }) === "sheet-hydrated-1",
  "9d: hydrated masterSheetId still wins when present",
);
assert(
  resolveListedGodmodeMasterSheetId({
    ...listedFolderFirstRow,
    setupStatus: "incomplete",
    setupStatusLabel: "Setup in progress",
    masterSheetId: "",
  }) === "",
  "9e: incomplete listed row without masterSheetId stays blocked",
);
assert(
  !applyLinked.includes('folderPlacementOk === false') ||
    /skipLoginHint[\s\S]*folderPlacementOk/.test(applyLinked),
  "9f: linked context only blocks when folderPlacementOk is explicitly false",
);

console.log(`[verify:godmode-company-wiring] OK — ${caseCount} cases passed`);
