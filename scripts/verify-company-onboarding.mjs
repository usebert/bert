#!/usr/bin/env node
/**
 * Static checks for app-hosted COMPANY_ONBOARDING flow and invite gates.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const serverOnboarding = read("server/company-onboarding.mjs");
const serverMain = read("server/server.mjs");
const appTsx = read("App.tsx");
const formScreen = read("src/screens/CompanyOnboardingFormScreen.tsx");
const panel = read("src/components/admin/CompanyOnboardingInvitePanel.tsx");
const adminScreen = read("src/screens/AdminScreen.tsx");
const usersPanel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
const folderStructure = read("server/company-folder-structure.mjs");
const companySchema = read("src/schema/companySchema.ts");
const inviteMessages = read("src/utils/inviteCompletionMessages.ts");

assert(serverOnboarding.includes("COMPANY_ONBOARDING"), "invite type constant");
assert(serverOnboarding.includes("installCompanyOnboardingRoutes"), "route installer");
assert(serverOnboarding.includes("hashCompanyOnboardingToken"), "token hashing");
assert(serverOnboarding.includes("OnboardingInvites"), "platform registry tab");
assert(serverOnboarding.includes("provisionNewCompanyWorkspace"), "reuses provision");
assert(serverOnboarding.includes("runHeadlessInviteProvisioning"), "godmode headless reprovision");
assert(serverOnboarding.includes("COMPANY_WORKSPACE_STATUS"), "onboarding status constants");
assert(serverOnboarding.includes("assertCompanyWorkspaceAcceptsUserInvite"), "live gate helper");
assert(serverOnboarding.includes("ensureCompanyWorkspaceLiveIfReady"), "auto live promotion helper");
assert(serverOnboarding.includes("readOnboardingRegistryMasterSheetForFolder"), "registry master sheet lookup");
assert(serverOnboarding.includes("companyOnboardingStatus"), "config status field");
assert(serverOnboarding.includes("onboarding_provisioning"), "provisioning status");
assert(serverOnboarding.includes("setup_failed"), "setup failed status");
assert(serverOnboarding.includes("runWithInviteLock"), "per-invite lock for idempotency");
assert(serverOnboarding.includes("COMPANY_ONBOARDING_SETUP_FAILED_MESSAGE"), "customer setup failed message");
assert(serverOnboarding.includes("mapInviteStatusCode"), "canonical onboarding status codes");
assert(serverOnboarding.includes("iso_9001"), "ISO main need options");
assert(serverOnboarding.includes("/invites/:inviteId/repair"), "godmode repair endpoint");
assert(serverOnboarding.includes("addressLine1"), "extended address fields on submit");
assert(serverOnboarding.includes("adminFirstName"), "admin first name on submit");

const inviteGetHandler = serverOnboarding.slice(
  serverOnboarding.indexOf('app.get("/api/onboarding/company-onboarding/invite/:tokenParam"'),
  serverOnboarding.indexOf('app.post("/api/onboarding/company-onboarding/invite/:tokenParam/start"'),
);
assert(!inviteGetHandler.includes("validateCompanyUserInviteTarget"), "no master sheet check on onboarding page load");
assert(!inviteGetHandler.includes("prepareCompanyUserInviteTarget"), "no invite target prep on onboarding load");
assert(inviteGetHandler.includes("verifyInviteToken"), "token-only validation on onboarding load");

assert(serverMain.includes("installCompanyOnboardingRoutes"), "server wires onboarding routes");
assert(serverMain.includes("company-onboarding-invites.json"), "dedicated invite store");
assert(serverMain.includes("assertCompanyWorkspaceAcceptsUserInvite"), "company-user live gate wired");
assert(serverMain.includes("deprecated_onboarding_path"), "google form new-company retired");
assert(serverOnboarding.includes("company_not_live"), "company_not_live error code");
assert(serverMain.includes("repairCompanyInviteTarget"), "repair helper wired for onboarding");

assert(appTsx.includes("company-onboarding"), "App routes onboarding query param");
assert(appTsx.includes("CompanyOnboardingFormScreen"), "form screen mounted");
assert(appTsx.includes("/api/onboarding/company-onboarding/invites"), "Godmode create invite API");
assert(appTsx.includes("COMPANY_NOT_LIVE_INVITE_MESSAGE"), "client live gate message");

assert(formScreen.includes("Complete your BERT company setup"), "form heading");
assert(formScreen.includes("mainNeeds"), "form collects main needs");
assert(formScreen.includes("companyName"), "form collects company name");
assert(formScreen.includes("adminFirstName"), "form collects admin first name");
assert(formScreen.includes("adminLastName"), "form collects admin last name");
assert(formScreen.includes("addressLine1"), "form collects address line 1");
assert(formScreen.includes("town"), "form collects town");
assert(formScreen.includes("postcode"), "form collects postcode");
assert(formScreen.includes("password"), "form collects password");
assert(formScreen.includes("sitesCount"), "form collects sites count");
assert(formScreen.includes("usersCount"), "form collects users count");
assert(formScreen.includes("Create workspace"), "create workspace submit label");
assert(formScreen.includes("iso_9001"), "form ISO main need labels");
assert(
  formScreen.includes("We couldn't finish setting up your workspace"),
  "customer setup failed message on form",
);
assert(
  !formScreen.includes("verify the company master sheet"),
  "no master sheet verification copy on onboarding form",
);

assert(panel.includes("Send company onboarding invite"), "Godmode panel label");
assert(panel.includes("Retry setup"), "godmode retry setup");
assert(panel.includes("Repair"), "godmode repair action");
assert(panel.includes("Open folder"), "godmode open folder link");
assert(panel.includes("Open sheet"), "godmode open sheet link");
assert(panel.includes("provisionStage"), "godmode shows failure stage");

assert(adminScreen.includes("CompanyOnboardingInvitePanel"), "godmode onboarding panel");
assert(adminScreen.includes('const canInviteNewCompany = currentUser.role === "Master"'), "godmode-only company invite");
assert(adminScreen.includes("!godmodeNewCompanyOnboarding"), "hide manual setup on new company");
assert(adminScreen.includes("const godModeFirstUserInvite = false"), "no first-admin shortcut");
assert(!adminScreen.includes("Invite new company"), "no legacy invite new company label");

assert(usersPanel.includes("COMPANY_NOT_LIVE_INVITE_MESSAGE"), "users panel live gate copy");
assert(!usersPanel.includes("Admin (first company user)"), "no first company user invite label");

assert(folderStructure.includes("ensureCompanyFolderStructure"), "folder structure helper");
assert(folderStructure.includes("ensureCompanyMasterSheet"), "master sheet helper");
assert(folderStructure.includes("writeCompanyFoldersTab"), "CompanyFolders tab write");
assert(folderStructure.includes('COMPANY_FOLDERS_COLUMNS'), "CompanyFolders A:H columns");
assert(folderStructure.includes('"Status"'), "CompanyFolders status column");

assert(companySchema.includes("CompanyFolders"), "schema includes CompanyFolders tab");

assert(
  inviteMessages.includes("We couldn't finish setting up your workspace"),
  "shared setup failed customer message",
);

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["verify:company-onboarding"], "npm script registered");

console.log("OK: verify-company-onboarding");
