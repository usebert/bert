#!/usr/bin/env node
/**
 * verify:product-polish — Release 7D product polish checks.
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
  const contextualHelp = read("src/presentation/contextualHelp.ts");
  const helpComponent = read("src/components/help/ContextualHelp.tsx");
  const emptyStates = read("src/presentation/emptyStates.ts");
  const saveFeedback = read("src/presentation/saveFeedback.ts");
  const statusLabels = read("src/presentation/statusLabels.ts");
  const loading = read("src/components/ui/LoadingStates.tsx");
  const saveUi = read("src/components/ui/SaveFeedback.tsx");
  const ux = read("src/utils/uxDeclutter.ts");
  const audits = read("src/audits/AuditsWorkspace.tsx");
  const actions = read("src/actions/ActionsWorkspace.tsx");
  const safety = read("src/safety/SafetyWorkspace.tsx");
  const ncrs = read("src/ncrs/NcrWorkspace.tsx");
  const appShell = read("scripts/verify-app-shell.mjs");

  assert(Boolean(pkg.scripts?.["verify:product-polish"]), "package.json defines verify:product-polish");

  // Contextual help
  assert(contextualHelp.includes("getContextualHelp"), "contextual help mapping exists");
  assert(helpComponent.includes("ContextualHelp"), "contextual help component exists");
  assert(helpComponent.includes("Dismiss help"), "help panels dismissible");
  assert(helpComponent.includes("min-h-11"), "help dismiss meets touch target");
  assert(audits.includes("ContextualHelp"), "audits workspace has contextual help");
  assert(actions.includes("ContextualHelp"), "actions workspace has contextual help");
  assert(safety.includes("ContextualHelp"), "safety workspace has contextual help");
  assert(ncrs.includes("ContextualHelp"), "NCR workspace has contextual help");

  // Empty states
  assert(emptyStates.includes("No audits have been created yet"), "audits empty copy");
  assert(emptyStates.includes("No actions require attention"), "actions empty copy");
  assert(emptyStates.includes("No incidents have been recorded"), "incidents empty copy");
  assert(audits.includes("EMPTY_STATE_COPY"), "audits uses shared empty states");
  assert(actions.includes("EMPTY_STATE_COPY"), "actions uses shared empty states");

  // Loading / skeletons
  assert(loading.includes("SkeletonCard"), "skeleton cards available");
  assert(loading.includes("motion-reduce:animate-none"), "reduced motion on skeletons");
  assert(audits.includes("SkeletonCard"), "audits uses skeleton loading");

  // Save feedback
  assert(saveFeedback.includes("Saving…"), "standard saving label");
  assert(saveFeedback.includes("Saved"), "standard saved label");
  assert(saveFeedback.includes("Awaiting sync"), "standard awaiting sync label");
  assert(saveUi.includes("SaveFeedback"), "save feedback component exists");
  assert(ux.includes("awaitingSync"), "UX_STATUS includes awaiting sync");

  // Status labels
  assert(statusLabels.includes("Awaiting Verification"), "standard awaiting verification label");
  assert(statusLabels.includes("Due Today"), "standard due today label");
  assert(read("src/actions/adapters/actionListAdapter.ts").includes("displayStatus"), "actions adapter keeps display status mapping");

  // Accessibility
  assert(helpComponent.includes("aria-label"), "help has accessible labels");
  assert(loading.includes('role="status"'), "inline loading announces status");

  // No internal jargon in presentation layer
  assert(!contextualHelp.includes("masterSheetId"), "help copy avoids internal ids");
  assert(!emptyStates.includes("workbook"), "empty states avoid workbook terminology");

  // Existing verifiers remain
  assert(appShell.includes("verify:app-shell"), "app shell verifier still present");

  console.log(`[verify:product-polish] ${caseCount} checks OK`);
}

main();
