#!/usr/bin/env node
/**
 * verify:audits-ui — BERT Audits module Release 3 checks.
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
  const workspace = read("src/audits/AuditsWorkspace.tsx");
  const auditsScreen = read("src/screens/AuditsScreen.tsx");
  const adapter = read("src/audits/adapters/auditListAdapter.ts");
  const auditList = read("src/audits/components/AuditList.tsx");
  const wizard = read("src/components/checks/CheckCompletionWizard.tsx");
  const helpers = read("src/utils/checkCompletionHelpers.ts");
  const questionControls = read("src/components/checks/CheckQuestionControls.tsx");
  const review = read("src/components/checks/CheckCompletionReview.tsx");
  const assignedRow = read("src/components/checks/AssignedCheckActionRow.tsx");
  const app = read("App.tsx");

  assert(Boolean(pkg.scripts?.["verify:audits-ui"]), "package.json defines verify:audits-ui");

  // 1. Shared Audits workspace layout
  assert(workspace.includes("AuditsWorkspace"), "shared audits workspace exists");
  assert(workspace.includes("PageContainer"), "uses PageContainer");
  assert(workspace.includes("PageHeader"), "uses PageHeader");
  assert(workspace.includes("AuditSummaryCards"), "summary strip component wired");
  assert(workspace.includes("AuditFilters"), "filters wired");
  assert(workspace.includes("AuditList"), "reusable audit list wired");
  assert(auditsScreen.includes("AuditsWorkspace"), "AuditsScreen delegates to workspace");

  // 2. Role views / tabs
  assert(workspace.includes("my-audits"), "My Audits tab");
  assert(workspace.includes("scheduled"), "Scheduled tab");
  assert(workspace.includes("in-progress"), "In progress tab");
  assert(workspace.includes("completed"), "Completed tab");
  assert(adapter.includes('role === "Auditor"'), "role-specific default tab");

  // 3. Real assignments + sorting
  assert(adapter.includes("sortAssignedChecksForAction"), "uses assigned check sort order");
  assert(adapter.includes("rankAuditorAudit"), "overdue prioritisation preserved");
  assert(workspace.includes("myAssignedChecks"), "My Audits uses assigned checks prop");
  assert(assignedRow.includes('"Continue check"'), "draft shows Continue not Start");
  assert(assignedRow.includes("inProgress ? \"Continue check\""), "Continue when draft exists");

  // 4. Rapid audit + answer mappings unchanged
  assert(wizard.includes("handleAnswerChange"), "rapid answer handler preserved");
  assert(wizard.includes("rapidAnswerLockRef"), "double-tap lock preserved");
  assert(wizard.includes('answer === "fail"'), "fail stays on question");
  assert(helpers.includes("canRapidAdvanceAfterAnswer"), "rapid advance helper intact");
  assert(helpers.includes("requiresPhotoEvidence"), "required-photo pass rule intact");

  // 5. Autosave + offline queue
  assert(app.includes("questionIndex"), "draft question index in App state");
  assert(app.includes("completeAuditModeFlow"), "assigned completion flow intact");
  assert(app.includes("submissionQueueService"), "offline queue service connected");
  assert(review.includes("offline"), "review shows offline queued messaging");

  // 6. Evidence + validation
  assert(questionControls.includes("EvidencePanel"), "EvidencePanel remains on questions");
  assert(review.includes("canSubmit"), "review uses existing submit validation");
  assert(review.includes("Submit check"), "completion review submit action");

  // 7. Completion UX components
  assert(wizard.includes("AuditProgress"), "progress component in wizard");
  assert(wizard.includes("AuditQuestionNavigator"), "question navigator in wizard");
  assert(read("src/audits/components/AuditCompletionReview.tsx").includes("CheckCompletionReview"), "completion review wrapper");

  // 8. Routes preserved
  assert(app.includes('screen === "complete"'), "complete screen route preserved");
  assert(app.includes("isCompleteWorkListScreen"), "audits list route gate preserved");
  assert(app.includes("CheckCompletionWizard"), "wizard still mounted from App");

  // 9. Shared UI states
  assert(workspace.includes("EmptyState"), "empty states");
  assert(workspace.includes("SkeletonCard"), "skeleton loading");
  assert(workspace.includes("assignedChecksLoadError"), "section error handling");

  // 10. Tablet overflow guard
  assert(workspace.includes("overflow-x-hidden"), "workspace prevents page-level horizontal overflow");
  assert(wizard.includes("min-h-[56px]"), "large touch targets in wizard footer");

  // 11. No schema/payload changes in audits UI layer
  assert(!adapter.includes("buildAuditSubmissionBundle"), "adapters do not alter submission payloads");
  assert(!workspace.includes("appendTabRows"), "UI does not write workbook tabs");

  console.log(`\nverify:audits-ui passed (${caseCount} checks).`);
}

main();
