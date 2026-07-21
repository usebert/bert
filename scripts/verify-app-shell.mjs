#!/usr/bin/env node
/**
 * verify:app-shell — Release 7C premium application shell checks.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

let caseCount = 0;
function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
  console.log(`ok ${caseCount}: ${message}`);
}

function read(relPath) {
  return readFileSync(path.join(root, relPath), "utf8");
}

function main() {
  const pkg = JSON.parse(read("package.json"));
  const app = read("App.tsx");
  const appShell = read("src/components/app-shell/AppShell.tsx");
  const appHeader = read("src/components/app-shell/AppHeader.tsx");
  const appSidebar = read("src/components/app-shell/AppSidebar.tsx");
  const pageTitles = read("src/presentation/pageTitles.ts");
  const navPresentation = read("src/config/navPresentation.ts");
  const roleNavigation = read("src/config/roleNavigation.ts");
  const companyContext = read("src/components/app-shell/CompanyContextButton.tsx");
  const accountMenu = read("src/components/app-shell/AccountMenu.tsx");
  const connectionStatus = read("src/components/app-shell/ConnectionStatus.tsx");
  const syncStatus = read("src/components/app-shell/SyncStatusButton.tsx");
  const sidebarItem = read("src/components/app-shell/SidebarItem.tsx");
  const shellGuard = read("src/components/app-shell/shellUnsavedGuard.ts");
  const storageKeys = read("src/config/storageKeys.ts");
  const globalSearchVerify = read("scripts/verify-global-search.mjs");
  const notificationVerify = read("scripts/verify-notification-centre.mjs");
  const navigationVerify = read("scripts/verify-navigation.mjs");

  assert(Boolean(pkg.scripts?.["verify:app-shell"]), "package.json defines verify:app-shell");

  // 1–2 Shared header and sidebar
  assert(appHeader.includes("export function AppHeader"), "shared AppHeader exists");
  assert(appSidebar.includes("export function AppSidebar"), "shared AppSidebar exists");

  // 3–4 Page titles from shared mapping
  assert(pageTitles.includes("getPageTitle"), "page titles derive from shared presentation mapping");
  assert(app.includes("getPageTitle(screen"), "App uses shared page title mapping");
  assert(pageTitles.includes('documents: "Document Library"'), "Document Library title mapped");
  assert(pageTitles.includes('documentControl: "Documents"'), "Documents title mapped");
  assert(!pageTitles.includes("dashboard: \"dashboard\""), "no internal screen ids shown as titles");

  // 5–6 Global Search and Notifications wired
  assert(app.includes("<AppShell"), "AppShell composes logged-in chrome");
  assert(app.includes("HeaderSearchButton"), "global search button component used");
  assert(app.includes("globalSearchControls.openSearch"), "global search remains wired");
  assert(app.includes("notificationControls.button"), "notification centre remains wired");

  // 7 Touch targets
  assert(appHeader.includes("min-h-11"), "header controls meet 44px touch targets");
  assert(accountMenu.includes("h-11 w-11"), "account menu trigger meets touch target");

  // 8–12 Company context and switcher
  assert(!companyContext.includes("masterSheetId"), "company context does not expose internal ids");
  assert(!companyContext.includes("companyFolderId"), "company context does not expose folder ids");
  assert(companyContext.includes("if (!showSwitcher)"), "single-company users do not see false switch affordance");
  assert(companyContext.includes("showSwitcher"), "multi-company switch affordance supported");
  assert(app.includes("selectableGodmodeFolders"), "master switcher uses selected-company folder list");
  assert(app.includes("onSelectCompany={requestCompanySwitch}"), "company switch preserves existing handler chain");
  assert(app.includes("handleSelectFolder"), "company switch preserves folder selection handler");
  assert(!app.includes("buildCompanyRegistry"), "switcher does not duplicate company-registry logic");

  // 13–16 Account menu
  assert(accountMenu.includes("resolveHeaderRoleLabel"), "account menu shows role");
  assert(accountMenu.includes("companyName"), "account menu shows current company");
  assert(app.includes("onSignOut={() => handleLogout()}"), "sign out uses existing logout handler");
  assert(app.includes("isDebugUiAllowed()"), "debug tools remain gated");

  // 17–20 Connection and sync
  assert(connectionStatus.includes("Offline"), "connection status distinguishes offline");
  assert(connectionStatus.includes("sr-only"), "online state not noisy on healthy connection");
  assert(syncStatus.includes("Sync failed"), "sync status distinguishes failed");
  assert(syncStatus.includes("Awaiting sync"), "sync status distinguishes queued");
  assert(!syncStatus.includes("failedCount ? `${waitingCount}`"), "queued items are not labelled failed");
  assert(app.includes('onOpenSync={() => setScreen("sync")}'), "sync status links to Sync Centre");

  // 21–24 Sidebar navigation
  assert(app.includes("groupedSidebarNav"), "sidebar uses grouped navigation data");
  assert(roleNavigation.includes("getPresentedNavForRole"), "sidebar uses roleNavigation permissions");
  assert(navPresentation.includes("Document Library"), "document library label present");
  assert(navPresentation.includes('documentControl: "Documents"'), "documents label distinct from library");
  assert(sidebarItem.includes('aria-current={selected ? "page"'), "active item uses aria-current");

  // 25–29 Accessibility
  assert(appHeader.includes("aria-label"), "icon-only shell controls have accessible labels");
  assert(appShell.includes('href="#main-content"'), "skip link exists");
  assert(accountMenu.includes("triggerRef.current?.focus()"), "focus returns after closing account menu");
  assert(accountMenu.includes('event.key === "Escape"'), "Escape closes account menu");
  assert(appShell.includes("motion-reduce") || appSidebar.includes("motion-reduce"), "reduced motion supported");
  assert(appShell.includes("h-[100dvh]"), "mobile drawer uses 100dvh-safe layout");

  // 30–37 Compatibility guards
  assert(!appHeader.includes("masterSheetId"), "header does not expose masterSheetId");
  assert(!appHeader.includes("companyFolderId"), "header does not expose companyFolderId");
  assert(!app.includes("react-router") && !app.includes("ReactRouter"), "no new router introduced");
  assert(app.includes("searchFocusActionId") || app.includes("handleGlobalSearchNavigate"), "deep-link handling remains present");
  assert(storageKeys.includes('offlineSubmissions: "bert-offline-submissions"'), "offline queue constants unchanged");
  assert(!appShell.includes("setPassword") && !appShell.includes("hashPassword"), "authentication wiring unchanged in shell");
  assert(!appShell.includes("workbookSchema"), "no workbook schema changes in shell");
  assert(!appShell.includes("fetch(") || appShell.includes("renderNavIcon"), "shell does not add API payload fetching");

  // 38–40 Existing verifiers still present
  assert(globalSearchVerify.includes("verify:global-search"), "global search verifier still exists");
  assert(notificationVerify.includes("verify:notification-centre"), "notification centre verifier still exists");
  assert(navigationVerify.includes("verify:navigation"), "navigation verifier still exists");

  // Unsaved guard on company switch
  assert(shellGuard.includes("You have unsaved changes on this screen"), "unsaved work warning on company switch");
  assert(app.includes("requestCompanySwitch"), "requestCompanySwitch wraps company selection");

  console.log(`[verify:app-shell] ${caseCount} checks OK`);
}

main();
