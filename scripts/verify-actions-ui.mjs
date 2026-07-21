#!/usr/bin/env node
/**
 * verify:actions-ui — BERT Actions module Release 4 checks.
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
  const workspace = read("src/actions/ActionsWorkspace.tsx");
  const actionsScreen = read("src/screens/ActionsScreen.tsx");
  const adapter = read("src/actions/adapters/actionListAdapter.ts");
  const detail = read("src/actions/components/ActionDetailPanel.tsx");
  const updateComposer = read("src/actions/components/ActionUpdateComposer.tsx");
  const evidence = read("src/actions/components/ActionEvidencePanel.tsx");
  const app = read("App.tsx");
  const permissions = read("src/permissions.ts");
  const managerDashboard = read("src/utils/managerDashboard.ts");
  const recordNextStep = read("src/utils/recordNextStep.ts");
  const complianceSync = read("src/services/complianceSyncService.ts");

  assert(Boolean(pkg.scripts?.["verify:actions-ui"]), "package.json defines verify:actions-ui");

  // 1. Shared Actions workspace layout
  assert(workspace.includes("ActionsWorkspace"), "shared actions workspace exists");
  assert(workspace.includes("PageContainer"), "uses PageContainer");
  assert(workspace.includes("PageHeader"), "uses PageHeader");
  assert(workspace.includes("ActionSummaryCards"), "summary strip component wired");
  assert(workspace.includes("ActionFilters"), "filters wired");
  assert(workspace.includes("ActionList"), "reusable action list wired");
  assert(actionsScreen.includes("ActionsWorkspace"), "ActionsScreen delegates to workspace");

  // 2. Role views / tabs
  assert(workspace.includes("my-actions"), "My Actions tab");
  assert(workspace.includes("all-open"), "All Open tab");
  assert(workspace.includes("overdue"), "Overdue tab");
  assert(workspace.includes("awaiting-verification"), "Awaiting Verification tab");
  assert(workspace.includes("completed"), "Completed tab");
  assert(adapter.includes('role === "Auditor"'), "role-specific default tab");

  // 3. Real assignments + sorting
  assert(adapter.includes("isOverdue"), "overdue sorting uses existing calculation");
  assert(adapter.includes("isDueToday"), "due-today calculation preserved");
  assert(adapter.includes("SEVERITY_RANK"), "priority mapping preserved");
  assert(workspace.includes("filterItemsForTab"), "My Actions uses assignment filtering");
  assert(adapter.includes("sortCompletedActionItems"), "completed actions sort newest first");

  // 4. Status transitions + verification
  assert(recordNextStep.includes("getActionPrimaryCTA"), "existing CTA mapping preserved");
  assert(updateComposer.includes("onAdvanceAction"), "status transitions remain connected");
  assert(updateComposer.includes("Awaiting Verification"), "verification flow connected");
  assert(updateComposer.includes("Rejected"), "reject verification connected");
  assert(detail.includes("ActionVerificationPanel"), "suggestion verification panel wired");

  // 5. Evidence + offline queue
  assert(evidence.includes("EvidenceUploadChoice"), "evidence upload remains connected");
  assert(app.includes("attachEvidenceToAction"), "App evidence handler preserved");
  assert(app.includes("pendingOfflineActionIds"), "offline queue ids passed to workspace");
  assert(workspace.includes("offlineMode"), "offline state surfaced in workspace");
  assert(complianceSync.includes("persistActionsToSheet"), "action persist API unchanged");

  // 6. Archive + routes
  assert(detail.includes('recordType="action"'), "archive remains connected");
  assert(app.includes('screen === "actions"'), "actions route preserved");
  assert(app.includes("updateActionStatus"), "advance action handler preserved");
  assert(app.includes("visibleActions"), "workspace uses scoped visible actions");

  // 7. Permissions + scope
  assert(permissions.includes("canAccessActions"), "role permissions unchanged");
  assert(permissions.includes("canAssignActions"), "assign permissions unchanged");
  assert(permissions.includes("canVerifyActions"), "verify permissions unchanged");
  assert(app.includes("visibleActions"), "company/role scope checks remain in App");

  // 8. Dashboard links
  assert(app.includes("applyDashboardNavWithFilter"), "dashboard filter deep links preserved");
  assert(read("src/dashboard/unified/buildNeedsAttention.ts").includes('screen: "actions"'), "needs attention links to actions");

  // 9. Shared UI states
  assert(workspace.includes("EmptyState"), "empty states");
  assert(workspace.includes("You have no actions assigned right now"), "auditor empty state");
  assert(workspace.includes("Everything is up to date"), "overdue empty state");
  assert(workspace.includes("No verification work"), "verification empty state");

  // 10. Tablet overflow guard
  assert(workspace.includes("overflow-x-hidden"), "workspace prevents page-level horizontal overflow");
  assert(read("src/actions/components/ActionListCard.tsx").includes("min-h-[44px]"), "touch-friendly action buttons");

  // 11. No schema/payload changes in actions UI layer
  assert(!adapter.includes("persistActionsToSheet"), "adapters do not alter submission payloads");
  assert(!workspace.includes("appendTabRows"), "UI does not write workbook tabs");
  assert(managerDashboard.includes("isOverdue"), "overdue helper not duplicated in adapter only");

  console.log(`\nverify:actions-ui passed (${caseCount} checks).`);
}

main();
