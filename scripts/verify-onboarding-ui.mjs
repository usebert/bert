#!/usr/bin/env node
/**
 * verify:onboarding-ui — Release 7D guided onboarding checks.
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
  const checklist = read("src/onboarding/onboardingChecklist.ts");
  const host = read("src/components/onboarding/OnboardingHost.tsx");
  const card = read("src/components/onboarding/OnboardingChecklistCard.tsx");
  const hook = read("src/hooks/useOnboardingChecklist.ts");
  const dismiss = read("src/hooks/useDismissiblePanel.ts");

  assert(Boolean(pkg.scripts?.["verify:onboarding-ui"]), "package.json defines verify:onboarding-ui");
  assert(checklist.includes("buildOnboardingSteps"), "onboarding steps builder exists");
  assert(checklist.includes("readCachedDocumentControlDocuments"), "documents step uses real cached data");
  assert(checklist.includes("readCachedLolerEquipment"), "equipment step uses real cached data");
  assert(checklist.includes("optional: true"), "LOLER step marked optional");
  assert(host.includes('role === "Admin"'), "onboarding visible to Admin");
  assert(host.includes('role === "Master"'), "onboarding visible to Master");
  assert(host.includes("setupOnlyShell"), "setup users can see onboarding");
  assert(card.includes("onDismiss"), "onboarding checklist dismissible");
  assert(dismiss.includes("localStorage"), "onboarding dismissal persisted");
  assert(hook.includes("onboardingProgress"), "onboarding progress computed");
  assert(app.includes("OnboardingHost"), "App wires onboarding host");
  assert(app.includes("onboardingSlot"), "onboarding passed to dashboards");
  assert(app.includes("companyMembersState.members.length"), "users step uses real member data");
  assert(app.includes("templates"), "templates included in onboarding input");
  assert(app.includes("managedSchedules"), "schedules included in onboarding input");
  assert(!checklist.includes("masterSheetId"), "onboarding does not expose internal ids");
  assert(checklist.includes("You have unsaved changes") === false, "onboarding does not block navigation");

  console.log(`[verify:onboarding-ui] ${caseCount} checks OK`);
}

main();
