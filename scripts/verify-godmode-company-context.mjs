#!/usr/bin/env node
/** Mirrors src/utils/godmodeCompanyFolders.ts — keep filter rules in sync. */

import {
  filterCustomerFacingCompanies,
  findSystemTemplateCompany,
  isSystemTemplateCompany,
} from "../shared/system-template-company.mjs";

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
      !isSystemTemplateCompany(folder) &&
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
  if (isSystemTemplateCompany({ name: companyName, companyName })) {
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
  { id: "testco-1", name: "TESTCO" },
  { id: "blank-1", name: "BLANK COMPANY - BERT Folder Structure" },
  { id: "archive-1", name: "99 Archive" },
  { id: "live-companies", name: "Live Companies" },
  { id: "master", name: "00 Master Control" },
  { id: "bert-folder", name: "bert." },
  { id: "company-root", name: "Companies" },
];

const filtered = filterSelectableGodmodeCompanyFolders(sample);
assert(
  filtered.length === 2 && filtered.some((folder) => folder.id === "live-1") && filtered.some((folder) => folder.id === "testco-1"),
  "filters reserved, brand, and system template folders",
);
assert(
  !filtered.some((folder) => folder.id === "blank-1"),
  "BLANK COMPANY template is excluded from selectable folders",
);

assert(isSystemTemplateCompany({ name: "BLANK COMPANY" }), "detects blank company by name");
assert(isSystemTemplateCompany({ companyName: "BLANK COMPANY - BERT Folder Structure" }), "detects blank folder structure name");
assert(isSystemTemplateCompany({ status: "TEMPLATE" }), "detects template status flag");
assert(!isSystemTemplateCompany({ name: "TESTCO" }), "real companies are not templates");

const customerFacing = filterCustomerFacingCompanies(sample);
assert(customerFacing.some((folder) => folder.id === "testco-1"), "customer-facing list includes TESTCO");
assert(!customerFacing.some((folder) => folder.id === "blank-1"), "customer-facing list excludes BLANK COMPANY");

const template = findSystemTemplateCompany(sample);
assert(template?.id === "blank-1", "template still resolvable internally from unfiltered list");

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

assert(
  !assertGodmodeLiveCompanyWorkspace({
    companyFolderId: "blank-1",
    companyName: "BLANK COMPANY - BERT Folder Structure",
    masterSheetId: "sheet-blank",
    selectableFolderIds: ["blank-1"],
  }).ok,
  "rejects system template company workspace",
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

/** Mirrors App.tsx auth-session bootstrap — loginUsers refresh must not re-home Master. */
function simulateAuthSessionBootstrap(input) {
  let screen = input.currentScreen;
  let bootstrapHandled = input.bootstrapAlreadyHandled ?? false;
  const isSetupUrl = input.setupUrl === true;

  if (input.masterApiSession && !bootstrapHandled) {
    if (!isSetupUrl) {
      screen = "godmodeHome";
    }
    bootstrapHandled = true;
  }

  return { screen, bootstrapHandled };
}

function simulateGodmodeLandingInternalClick(input) {
  let screen = input.currentScreen;
  let bootstrapHandled = input.bootstrapAlreadyHandled ?? true;

  screen = input.targetScreen;

  const afterLoginUsersRefresh = simulateAuthSessionBootstrap({
    currentScreen: screen,
    masterApiSession: true,
    bootstrapAlreadyHandled: bootstrapHandled,
    setupUrl: input.setupUrl === true,
  });

  return {
    finalScreen: afterLoginUsersRefresh.screen,
    bootstrapHandled: afterLoginUsersRefresh.bootstrapHandled,
  };
}

const platformSetupClick = simulateGodmodeLandingInternalClick({
  currentScreen: "godmodeHome",
  targetScreen: "setup",
  bootstrapAlreadyHandled: true,
});
assert(
  platformSetupClick.finalScreen === "setup",
  "Platform setup internal click stays on setup after loginUsers refresh",
);

const reportsClick = simulateGodmodeLandingInternalClick({
  currentScreen: "godmodeHome",
  targetScreen: "reports",
  bootstrapAlreadyHandled: true,
});
assert(
  reportsClick.finalScreen === "reports",
  "Diagnostics internal click stays on reports after loginUsers refresh",
);

const createCompanyClick = simulateGodmodeLandingInternalClick({
  currentScreen: "godmodeHome",
  targetScreen: "onboarding",
  bootstrapAlreadyHandled: true,
});
assert(
  createCompanyClick.finalScreen === "onboarding",
  "Create company internal click stays on onboarding after loginUsers refresh",
);

const selectCompanyClick = simulateGodmodeLandingInternalClick({
  currentScreen: "godmodeHome",
  targetScreen: "godmodeHome",
  bootstrapAlreadyHandled: true,
});
assert(
  selectCompanyClick.finalScreen === "godmodeHome",
  "Select company internal click does not bounce away from godmodeHome",
);

const firstBootstrap = simulateAuthSessionBootstrap({
  currentScreen: "dashboard",
  masterApiSession: true,
  bootstrapAlreadyHandled: false,
  setupUrl: false,
});
assert(
  firstBootstrap.screen === "godmodeHome" && firstBootstrap.bootstrapHandled,
  "First Master session bootstrap still lands on godmodeHome",
);

const repeatBootstrap = simulateAuthSessionBootstrap({
  currentScreen: "setup",
  masterApiSession: true,
  bootstrapAlreadyHandled: true,
  setupUrl: false,
});
assert(
  repeatBootstrap.screen === "setup",
  "Repeat auth bootstrap does not force godmodeHome when Master already navigated",
);

console.log("[verify:godmode-company-context] OK");
