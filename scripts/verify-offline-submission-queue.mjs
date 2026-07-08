#!/usr/bin/env node
/**
 * Offline submission queue verifier — IndexedDB queue, UX copy, App wiring, and hardening guards.
 */
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
const tabletOffline = read("src/services/tabletOfflineService.ts");
const submissionQueue = read("src/services/submissionQueueService.ts");
const messages = read("src/utils/submissionQueueMessages.ts");
const bridge = read("src/utils/submissionQueueBridge.ts");
const types = read("src/types/submissionQueue.ts");
const syncCentre = read("src/screens/SyncCentreScreen.tsx");
const roleNavigation = read("src/config/roleNavigation.ts");
const permissions = read("src/permissions.ts");
const serviceWorker = read("public/service-worker.js");
const manifest = read("public/manifest.webmanifest");
const mainTsx = read("src/main.tsx");
const pkg = JSON.parse(read("package.json"));

assert(
  messages.includes(
    '"This action update was created by an older app version and cannot be synced automatically."',
  ),
  "UX: legacy action update unsyncable copy",
);
assert(messages.includes("isRetiredSheetByIdWriteError"), "SAFE: retired sheet-by-id write detector exported");
assert(messages.includes("legacyUnsyncableMessageForItem"), "SAFE: per-type legacy unsyncable message");

const complianceSync = read("src/services/complianceSyncService.ts");
const googleSheets = read("src/services/googleSheetsService.ts");
const coreWorkflow = read("server/core-workflow-routes.mjs");
const actionsService = read("server/actions-service.mjs");

const persistActionsFn = complianceSync.slice(
  complianceSync.indexOf("export async function persistActionsToSheet"),
  complianceSync.indexOf("export async function persistReportToSheet"),
);
assert(
  !persistActionsFn.includes("google-sheet-by-id"),
  "SYNC: persistActionsToSheet does not call retired sheet-by-id actions route",
);
assert(
  persistActionsFn.includes("/api/companies/${encodeURIComponent(folderId)}/actions"),
  "SYNC: action updates use folder-first company route",
);
const saveActionsFn = googleSheets.slice(
  googleSheets.indexOf("saveActions"),
  googleSheets.indexOf("appendActionComments"),
);
assert(
  saveActionsFn.includes("/api/companies/${encodeURIComponent(folderId)}/actions"),
  "SYNC: googleSheetsService.saveActions uses folder-first route",
);
assert(
  !saveActionsFn.includes("google-sheet-by-id"),
  "SYNC: saveActions not wired to sheet-by-id",
);
assert(coreWorkflow.includes('app.post("/api/companies/:companyFolderId/actions"'), "API: folder-first actions route registered");
assert(actionsService.includes("resolveCompanyScheduleContext"), "API: actions resolve folder-first workbook");
assert(actionsService.includes("writeCompanyActions"), "API: actions write delegates to workbook writer");

assert(appTsx.includes('route: "/api/companies/:companyFolderId/actions"'), "APP: action update sync logs folder-first route");
assert(appTsx.includes("legacyActionUpdateUnsyncable"), "APP: legacy action update unsyncable message");
assert(appTsx.includes("isRetiredSheetByIdWriteError"), "APP: retired sheet-by-id errors detected on action sync");
assert(appTsx.includes("legacyUnsyncableMessageForItem"), "APP: per-type legacy unsyncable messages");
assert(
  /item\.type === "actionUpdate"[\s\S]*!companyFolderId/.test(messages),
  "SAFE: action update without companyFolderId is legacy unsyncable",
);

assert(pkg.scripts["verify:offline-submission-queue"], "PKG: verify script registered");

assert(tabletOffline.includes("submissionQueue"), "IDB: submissionQueue store");
assert(tabletOffline.includes("DB_VERSION = 2"), "IDB: schema version bumped");
assert(tabletOffline.includes("offlineEvidenceBlobs"), "IDB: evidence blob store retained");

assert(submissionQueue.includes("enqueue"), "QUEUE: enqueue API");
assert(submissionQueue.includes("markSynced"), "QUEUE: markSynced after backend confirm");
assert(submissionQueue.includes("markFailed"), "QUEUE: failed sync keeps lastError");
assert(submissionQueue.includes("computeSubmissionBackoffMs"), "QUEUE: backoff retry");
assert(submissionQueue.includes("idempotencyKey"), "QUEUE: idempotency key");
assert(submissionQueue.includes("migrateLegacyQueues"), "QUEUE: legacy migration");
assert(submissionQueue.includes("filterSubmissionQueueForSession"), "QUEUE: session namespace filter");
assert(submissionQueue.includes("listActiveItemsForSession"), "QUEUE: session-scoped list");
assert(submissionQueue.includes("isSubmissionReadyForRetry"), "QUEUE: retry backoff gate");
assert(submissionQueue.includes("clearRetryBackoffForSession"), "QUEUE: reconnect backoff reset");
assert(submissionQueue.includes("markUnsyncable"), "QUEUE: legacy items marked unsyncable");
assert(submissionQueue.includes("dismissItem"), "QUEUE: user can dismiss failed item");
assert(/item\.unsyncable/.test(submissionQueue), "QUEUE: unsyncable items skip auto-retry");
assert(types.includes("unsyncable"), "TYPE: unsyncable flag on queue item");

assert(messages.includes('"Added to queue"'), "UX: Added to queue");
assert(messages.includes('"Added to queue. Syncing now…"'), "UX: online syncing copy");
assert(messages.includes('"Added to queue. This will sync when connection returns."'), "UX: offline copy");
assert(messages.includes('"Submitted successfully"'), "UX: success only after confirm");
assert(messages.includes('"Sync failed. Your item is still in the queue. Please retry."'), "UX: failure copy");
assert(messages.includes('"Evidence added"'), "UX: evidence added");
assert(messages.includes("All synced"), "UX: all synced indicator");

// Result-aware sync copy: success, failure and partial states must be distinct.
assert(messages.includes('"Item submitted successfully"'), "UX: per-item success copy");
assert(messages.includes('"All queued items synced"'), "UX: overall success copy");
assert(messages.includes('"Some items could not sync"'), "UX: partial failure copy");
assert(
  messages.includes(
    '"This queued item was created by an older app version and cannot be synced automatically."',
  ),
  "UX: legacy unsyncable copy",
);

// Safe failure reasons only — never raw errors / secrets.
assert(messages.includes("safeSyncErrorMessage"), "SAFE: error mapper exported");
assert(messages.includes('"Missing company folder"'), "SAFE: missing folder reason");
assert(messages.includes('"Audit template not found"'), "SAFE: template reason");
assert(messages.includes('"Network request failed"'), "SAFE: network reason");
assert(messages.includes('"Server rejected submission"'), "SAFE: server reason");
assert(messages.includes("isLegacyUnsyncableItem"), "SAFE: legacy item detector exported");
assert(messages.includes("syncResultToast"), "SAFE: result-aware toast builder");

assert(types.includes("auditCompletion"), "TYPE: audit/check completion");
assert(types.includes("incidentReport"), "TYPE: incident report");
assert(types.includes("briefingCreate"), "TYPE: briefing create");
assert(types.includes("briefingAck"), "TYPE: briefing ack");

assert(appTsx.includes("submissionQueueService"), "APP: submission queue service wired");
assert(appTsx.includes("enqueueOfflineSubmission"), "APP: offline submit queues immediately");
assert(appTsx.includes("refreshSubmissionQueueViews"), "APP: refresh survives reload");
assert(appTsx.includes("submissionInFlightKeysRef"), "APP: double-submit guard");
assert(appTsx.includes("queueAddedMessage"), "APP: queue feedback messages");
assert(appTsx.includes("SUBMISSION_QUEUE_MESSAGES.itemSuccess"), "APP: per-item success only after sync");
assert(appTsx.includes("syncResultToast"), "APP: result-aware sync toast (no misleading all-success)");
assert(appTsx.includes("safeSyncErrorMessage"), "APP: failures shown with safe reason");
assert(appTsx.includes("isLegacyUnsyncableItem"), "APP: legacy items detected during sync");
assert(appTsx.includes("markUnsyncable"), "APP: legacy items flagged unsyncable");
assert(appTsx.includes("onDismissItem"), "APP: dismiss failed item wired");
assert(
  !/lastError: error instanceof Error \? error\.message/.test(appTsx),
  "APP: raw error message never persisted as lastError",
);
assert(appTsx.includes("listActiveItemsForSession"), "APP: session-scoped queue hydrate");
assert(appTsx.includes("isSubmissionReadyForRetry"), "APP: respects retry backoff");
assert(appTsx.includes("offlineSubmissionToSyncQueueItem"), "APP: offline items in Sync Centre");
assert(appTsx.includes("syncCentreQueue"), "APP: merged Sync Centre queue");
assert(appTsx.includes('screen === "sync"'), "APP: sync route guard present");
assert(appTsx.includes("navLabelForItem"), "APP: sync nav label helper");
assert(appTsx.includes("syncCentreBadgeCount"), "APP: sync nav badge count");
assert(appTsx.includes('pushToast("Added to queue", queueAddedMessage({ online: false }), "warning")'), "APP: check flow immediate queue feedback");
assert(appTsx.includes("setSyncQueue([])"), "APP: logout clears in-memory sync queue");
assert(appTsx.includes("setOfflineQueue([])"), "APP: logout clears in-memory offline queue");
assert(/addEventListener\("online"/.test(appTsx), "APP: reconnect listener");
assert(appTsx.includes("clearRetryBackoffForSession"), "APP: reconnect clears retry backoff");
assert(appTsx.includes("bypassBackoff"), "APP: reconnect bypasses retry backoff");
assert(appTsx.includes("syncOfflineSubmissions({ bypassBackoff: true })"), "APP: manual reconnect sync");
assert(appTsx.includes("canCompleteAssignedCheck"), "APP: assigned-check roles can auto-sync");
assert(appTsx.includes("[submission-queue]"), "APP: dev queue debug logging");

// --- Offline audit/check queue sync loop fix (queued → synced/failed, never endless queued) ---
// 1. Offline replay uses the SAME backend route + payload as the online submit path.
assert(
  appTsx.includes("route: \"/api/companies/:companyFolderId/checks/:scheduleId/complete\""),
  "APP: offline sync logs the online completeCheck route (same route as online submit)",
);
assert(
  /completeCheck\(\{[\s\S]*?scheduleId: String\(submission\.scheduleId/.test(appTsx),
  "APP: offline queued item synced via completeCheck (online route + payload shape)",
);
// 2. Offline payload matches online required fields (answers + evidence built the same way).
assert(appTsx.includes("buildCheckAnswersPayload({"), "APP: offline sync builds answers payload like online");
assert(appTsx.includes("buildAuditEvidenceUploadPayload("), "APP: offline sync builds evidence files like online");
// 3. Malformed/legacy offline item → terminal Failed/Unsyncable, not endlessly Queued.
assert(
  appTsx.includes("Server rejected submission: missing "),
  "APP: offline item missing required fields marked unsyncable with safe reason",
);
// 4. Backend rejection surfaces the real response and moves item to Failed (never left Queued).
assert(
  /if \(!result\.ok\) \{[\s\S]*?throw new Error\(result\.error \|\| result\.message/.test(appTsx),
  "APP: backend rejection is not swallowed — item throws → markFailed",
);
// 5. Auto reconnect respects retry backoff so a just-failed item is not re-attempted forever.
assert(appTsx.includes("void syncOfflineSubmissions();"), "APP: auto reconnect sync respects retry backoff");
assert(
  appTsx.includes("no offline items ready to sync"),
  "APP: sync exits quietly when all items are backing off (no endless queued loop)",
);
// 6. clearRetryBackoffForSession no longer force-flips failed → queued (only clears the timer).
assert(
  !/status: item\.status === "failed" \? "queued" : item\.status/.test(submissionQueue),
  "QUEUE: clearRetryBackoffForSession does not reset failed items back to queued",
);

assert(bridge.includes("offlineSubmissionToQueueItem"), "BRIDGE: offline submission mapping");
assert(bridge.includes("syncQueueItemToSubmissionQueueItem"), "BRIDGE: legacy sync queue migration");
assert(bridge.includes("offlineSubmissionToSyncQueueItem"), "BRIDGE: offline to sync centre view");

assert(read("src/components/animation/OfflineSyncBanner.tsx").includes("queueIndicatorSummary"), "UI: banner uses queue indicator");
assert(syncCentre.includes("All synced"), "UI: sync centre empty state");
assert(syncCentre.includes("Retry failed"), "UI: retry failed action label");
assert(syncCentre.includes("Sync now"), "UI: sync now action for queued items");
assert(syncCentre.includes("onSyncAll"), "UI: sync all handler");
assert(syncCentre.includes("Dismiss failed item"), "UI: dismiss failed item action");
assert(syncCentre.includes("onDismissItem"), "UI: dismiss handler prop");
assert(appTsx.includes("invalidateLiveDashboardCache"), "UI: dismiss clears live dashboard sync warning cache");
assert(appTsx.includes("failedSyncCount={syncCentreFailedCount}"), "UI: Live Dashboard uses Sync Centre failed count");
assert(appTsx.includes("pendingSyncCount={syncCentreWaitingCount}"), "UI: Live Dashboard uses Sync Centre waiting count");
assert(read("src/components/dashboard/LiveOperationalDashboard.tsx").includes("applyLocalSyncStatusToLiveDashboard"), "UI: Live Dashboard prefers local queue over cached sync warning");
assert(syncCentre.includes("item.lastError"), "UI: failed item shows safe reason");
assert(syncCentre.includes("queueItemTypeLabel"), "UI: sync centre item type labels");
assert(syncCentre.includes("queueTimeLabel"), "UI: sync centre timestamps");
assert(roleNavigation.match(/MASTER_NAV[\s\S]*?id: "sync", label: "Sync Centre"/), "NAV: master sync in primary nav");
assert(roleNavigation.match(/COMPANY_ADMIN_NAV[\s\S]*?id: "sync", label: "Sync Centre"/), "NAV: company admin sync in primary nav");
assert(roleNavigation.match(/MANAGER_NAV[\s\S]*?id: "sync", label: "Sync Centre"/), "NAV: manager sync in primary nav");
assert(roleNavigation.match(/AUDITOR_NAV[\s\S]*?id: "sync", label: "Sync Centre"/), "NAV: auditor sync in primary nav");
assert(permissions.includes('if (itemId === "sync")'), "PERM: sync nav gate exists");
assert(permissions.includes('role === "Master" || role === "Admin" || role === "Manager" || role === "Auditor"'), "PERM: sync visible to main field roles");

assert(manifest.includes('"display": "standalone"'), "PWA: standalone manifest");
assert(manifest.includes("start_url"), "PWA: start_url");
assert(manifest.includes("icons"), "PWA: icons");

assert(serviceWorker.includes("install"), "SW: install handler");
assert(serviceWorker.includes("fetch"), "SW: fetch handler");
assert(serviceWorker.includes("caches.match"), "SW: cache fallback");

assert(mainTsx.includes('register("/service-worker.js")'), "SW: registration in main");

console.log(`[verify:offline-submission-queue] ${caseCount} checks OK`);
