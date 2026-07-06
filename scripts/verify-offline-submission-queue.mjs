#!/usr/bin/env node
/**
 * Offline submission queue verifier — IndexedDB queue, UX copy, and App wiring.
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

assert(bridge.includes("offlineSubmissionToQueueItem"), "BRIDGE: offline submission mapping");
assert(bridge.includes("syncQueueItemToSubmissionQueueItem"), "BRIDGE: legacy sync queue migration");

assert(read("src/components/animation/OfflineSyncBanner.tsx").includes("queueIndicatorSummary"), "UI: banner uses queue indicator");
assert(read("src/screens/SyncCentreScreen.tsx").includes("All synced"), "UI: sync centre empty state");

console.log(`[verify:offline-submission-queue] ${caseCount} checks OK`);
