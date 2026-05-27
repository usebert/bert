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

/** Keep in sync with src/config/roleNavigation.ts */
const MASTER_PLATFORM_GLOBAL_SCREENS = ["dashboard", "godmodeHome", "setup", "setupInitial", "reports", "onboarding"];
const MASTER_COMPANY_SCOPED_SCREENS = ["companies", "users", "invites", "admin", "schedules", "qmsReadiness"];

assert(
  !MASTER_COMPANY_SCOPED_SCREENS.includes("reports"),
  "reports is platform diagnostics for Master, not company-scoped",
);

assert(
  !MASTER_COMPANY_SCOPED_SCREENS.includes("setup"),
  "setup is platform-scoped for Master",
);

assert(
  !MASTER_COMPANY_SCOPED_SCREENS.includes("onboarding"),
  "onboarding must remain reachable for new and incomplete companies",
);

function isMasterCompanyScopedScreen(screen) {
  return MASTER_COMPANY_SCOPED_SCREENS.includes(screen);
}

function isMasterCompanyContextExemptScreen(screen) {
  return MASTER_PLATFORM_GLOBAL_SCREENS.includes(screen);
}

function isMasterCompanyContextBlocked(input) {
  return (
    isMasterCompanyScopedScreen(input.targetScreen) &&
    !isMasterCompanyContextExemptScreen(input.targetScreen) &&
    !input.companyReady &&
    !input.incompleteCompanySetup
  );
}

function resolveMasterNavTarget(input) {
  return input.targetScreen;
}

function applyMasterScreenTransition(input) {
  const blocked = isMasterCompanyContextBlocked({
    targetScreen: input.nextScreen,
    companyReady: input.companyReady,
    incompleteCompanySetup: input.incompleteCompanySetup,
  });
  if (blocked) {
    return { finalScreen: input.nextScreen, blocked: true };
  }
  return { finalScreen: input.nextScreen, blocked: false };
}

assert(
  resolveMasterNavTarget({
    targetScreen: "godmodeHome",
    companyReady: false,
    incompleteCompanySetup: false,
  }) === "godmodeHome",
  "Godmode home does not bounce when no company is selected",
);

assert(
  resolveMasterNavTarget({
    targetScreen: "onboarding",
    companyReady: false,
    incompleteCompanySetup: false,
  }) === "onboarding",
  "Create company opens onboarding without bounce-back",
);

assert(
  resolveMasterNavTarget({
    targetScreen: "setup",
    companyReady: false,
    incompleteCompanySetup: false,
  }) === "setup",
  "Platform setup remains reachable without selected company",
);

assert(
  resolveMasterNavTarget({
    targetScreen: "reports",
    companyReady: false,
    incompleteCompanySetup: false,
  }) === "reports",
  "Diagnostics remains reachable without selected company",
);

for (const nextScreen of ["setup", "setupInitial", "reports", "godmodeHome", "onboarding"]) {
  const transition = applyMasterScreenTransition({
    currentScreen: "godmodeHome",
    nextScreen,
    companyReady: false,
    incompleteCompanySetup: false,
  });
  assert(
    transition.finalScreen === nextScreen,
    `${nextScreen} transition remains on target without bounce home`,
  );
}

for (const nextScreen of ["companies", "users", "schedules", "qmsReadiness"]) {
  const transition = applyMasterScreenTransition({
    currentScreen: "godmodeHome",
    nextScreen,
    companyReady: false,
    incompleteCompanySetup: false,
  });
  assert(
    transition.finalScreen === nextScreen && transition.blocked,
    `${nextScreen} is blocked inline without forced redirect`,
  );
}

assert(
  resolveMasterNavTarget({
    targetScreen: "onboarding",
    companyReady: false,
    incompleteCompanySetup: true,
  }) === "onboarding",
  "Continue setup stays on onboarding for incomplete company",
);

assert(
  isMasterCompanyContextBlocked({
    targetScreen: "users",
    companyReady: false,
    incompleteCompanySetup: false,
  }),
  "Company-scoped screens are blocked without forcing a redirect",
);

assert(
  resolveMasterNavTarget({
    targetScreen: "users",
    companyReady: false,
    incompleteCompanySetup: false,
  }) !== "godmodeHome",
  "Blocked screens do not force a return to godmodeHome",
);

assert(
  !isMasterCompanyContextBlocked({
    targetScreen: "onboarding",
    companyReady: false,
    incompleteCompanySetup: true,
  }),
  "Incomplete setup onboarding stays reachable without a master sheet",
);

assert(
  !isMasterCompanyContextBlocked({
    targetScreen: "reports",
    companyReady: false,
    incompleteCompanySetup: false,
  }),
  "Diagnostics stays reachable without selected company",
);

console.log("[verify:godmode-company-context] OK");
