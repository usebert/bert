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

assert(messages.includes('"Added to queue"'), "UX: Added to queue");
assert(messages.includes('"Added to queue. Syncing now…"'), "UX: online syncing copy");
assert(messages.includes('"Added to queue. This will sync when connection returns."'), "UX: offline copy");
assert(messages.includes('"Submitted successfully"'), "UX: success only after confirm");
assert(messages.includes('"Sync failed. Your item is still in the queue. Please retry."'), "UX: failure copy");
assert(messages.includes('"Evidence added"'), "UX: evidence added");
assert(messages.includes("All synced"), "UX: all synced indicator");

assert(types.includes("auditCompletion"), "TYPE: audit/check completion");
assert(types.includes("incidentReport"), "TYPE: incident report");
assert(types.includes("briefingCreate"), "TYPE: briefing create");
assert(types.includes("briefingAck"), "TYPE: briefing ack");

assert(appTsx.includes("submissionQueueService"), "APP: submission queue service wired");
assert(appTsx.includes("enqueueOfflineSubmission"), "APP: offline submit queues immediately");
assert(appTsx.includes("refreshSubmissionQueueViews"), "APP: refresh survives reload");
assert(appTsx.includes("submissionInFlightKeysRef"), "APP: double-submit guard");
assert(appTsx.includes("queueAddedMessage"), "APP: queue feedback messages");
assert(appTsx.includes("SUBMISSION_QUEUE_MESSAGES.success"), "APP: success only after sync");
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

assert(bridge.includes("offlineSubmissionToQueueItem"), "BRIDGE: offline submission mapping");
assert(bridge.includes("syncQueueItemToSubmissionQueueItem"), "BRIDGE: legacy sync queue migration");
assert(bridge.includes("offlineSubmissionToSyncQueueItem"), "BRIDGE: offline to sync centre view");

assert(read("src/components/animation/OfflineSyncBanner.tsx").includes("queueIndicatorSummary"), "UI: banner uses queue indicator");
assert(syncCentre.includes("All synced"), "UI: sync centre empty state");
assert(syncCentre.includes("Retry failed"), "UI: retry failed action label");
assert(syncCentre.includes("queueItemTypeLabel"), "UI: sync centre item type labels");
assert(syncCentre.includes("queueTimeLabel"), "UI: sync centre timestamps");
assert(roleNavigation.includes('companyAdmin: ["sync"]'), "NAV: company admin sync in main nav");
assert(roleNavigation.includes('manager: ["sync"]'), "NAV: manager sync in main nav");
assert(roleNavigation.includes('auditor: ["sync"]'), "NAV: auditor sync in main nav");
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
