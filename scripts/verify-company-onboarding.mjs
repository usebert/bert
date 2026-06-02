#!/usr/bin/env node
/**
 * Static checks for app-hosted COMPANY_ONBOARDING flow.
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

assert(serverOnboarding.includes("COMPANY_ONBOARDING"), "invite type constant");
assert(serverOnboarding.includes("installCompanyOnboardingRoutes"), "route installer");
assert(serverOnboarding.includes("hashCompanyOnboardingToken"), "token hashing");
assert(serverOnboarding.includes("OnboardingInvites"), "platform registry tab");
assert(serverOnboarding.includes("provisionNewCompanyWorkspace"), "reuses provision");

assert(serverMain.includes("installCompanyOnboardingRoutes"), "server wires onboarding routes");
assert(serverMain.includes("company-onboarding-invites.json"), "dedicated invite store");

assert(appTsx.includes("company-onboarding"), "App routes onboarding query param");
assert(appTsx.includes("CompanyOnboardingFormScreen"), "form screen mounted");
assert(appTsx.includes("/api/onboarding/company-onboarding/invites"), "Godmode create invite API");

assert(formScreen.includes("mainNeeds"), "form collects main needs");
assert(panel.includes("Send company onboarding invite"), "Godmode panel label");

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["verify:company-onboarding"], "npm script registered");

console.log("OK: verify-company-onboarding");
