#!/usr/bin/env node
/** Ten background job cases — setup, invites, schedules, godmode diagnostics, retry. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BACKGROUND_INVITE_CREATED_MESSAGE,
  BACKGROUND_JOB_STATUSES,
  BACKGROUND_JOB_TYPES,
  BACKGROUND_SCHEDULE_SAVED_MESSAGE,
  BACKGROUND_SETUP_USER_MESSAGE,
  backgroundJobStatusBadge,
} from "../shared/background-jobs.mjs";

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

const shared = read("shared/background-jobs.mjs");
const service = read("server/background-jobs-service.mjs");
const registryActions = read("server/godmode-registry-actions.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");
const serverMain = read("server/server.mjs");
const panel = read("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx");
const jobsPanel = read("src/components/godmode/GodmodeBackgroundJobsPanel.tsx");
const appTsx = read("App.tsx");
const pkg = JSON.parse(read("package.json"));

/** 1: Job types + statuses defined in shared module. */
assert(shared.includes("COMPLETE_COMPANY_SETUP"), "1: COMPLETE_COMPANY_SETUP type");
assert(shared.includes("VERIFY_COMPANY_HEALTH"), "1b: VERIFY_COMPANY_HEALTH type");
assert(shared.includes("SEND_INVITE_EMAIL"), "1c: SEND_INVITE_EMAIL type");
assert(shared.includes("SYNC_SCHEDULES"), "1d: SYNC_SCHEDULES type");
assert(shared.includes("QUEUED"), "1e: QUEUED status");
assert(shared.includes("NEEDS_ATTENTION"), "1f: NEEDS_ATTENTION status");

/** 2: Persistent storage in session dir. */
assert(service.includes('path.join(sessionDir, "background-jobs.json")'), "2: jobs JSON in session dir");
assert(service.includes("schedule-pending"), "2b: local schedule pending dir");

/** 3: Make-usable queues setup + health and returns quickly with background message. */
assert(registryActions.includes("queueCompanySetupJobs"), "3: make-usable queues setup jobs");
assert(registryActions.includes("BACKGROUND_SETUP_USER_MESSAGE"), "3b: make-usable background user message");
assert(!registryActions.includes("ensureRequiredTabs"), "3c: Users tab moved out of sync make-usable");

/** 4: Invites return token before email send (background queue). */
assert(serverMain.indexOf("createInviteRecord(") < serverMain.indexOf("queueInviteEmailJob"), "4: token before email job");
assert(serverMain.includes("emailPending: true"), "4b: invite response marks email pending");
assert(serverMain.includes("BACKGROUND_INVITE_CREATED_MESSAGE"), "4c: invite created message");

/** 5: Schedule save persists locally and queues sync. */
assert(coreRoutes.includes("queueScheduleSyncJob"), "5: schedule route queues sync");
assert(coreRoutes.includes("BACKGROUND_SCHEDULE_SAVED_MESSAGE"), "5b: schedule saved message");
assert(coreRoutes.includes("savedLocally: true"), "5c: schedule save returns local ack");

/** 6: Godmode-only background job API routes. */
assert(service.includes("/api/godmode/background-jobs"), "6: godmode jobs route");
assert(service.includes("/api/companies/:companyId/background-jobs"), "6b: company-scoped godmode jobs route");
assert(service.includes("requireMasterOnlyActor"), "6c: jobs routes master-only");

/** 7: Retry/backoff for Google timeouts; max attempts → NEEDS_ATTENTION. */
assert(service.includes("BACKGROUND_JOB_MAX_ATTEMPTS"), "7: max attempts constant");
assert(service.includes("computeNextRetryAt"), "7b: retry backoff helper");
assert(service.includes("NEEDS_ATTENTION"), "7c: terminal needs attention state");

/** 8: Health failures do not downgrade LIVE (needsAttention only). */
assert(service.includes("needsAttention: true"), "8: health job uses needsAttention");
assert(service.includes("evaluateCompanyWorkspaceReadiness"), "8b: health uses readiness evaluator");
assert(!registryActions.includes("ensureCompanyFolderStructure"), "8c: make-usable no folder downgrade");

/** 9: Frontend hides long waits — background UX messages + godmode diagnostics panel. */
assert(appTsx.includes("BACKGROUND_SETUP_USER_MESSAGE"), "9: App uses setup background message");
assert(appTsx.includes("BACKGROUND_INVITE_CREATED_MESSAGE"), "9b: App uses invite background message");
assert(appTsx.includes("BACKGROUND_SCHEDULE_SAVED_MESSAGE"), "9c: App uses schedule background message");
assert(panel.includes("GodmodeBackgroundJobsPanel"), "9d: godmode workspace panel shows jobs");
assert(jobsPanel.includes("Background jobs"), "9e: dedicated jobs panel");

/** 10: Status badges + package script wired. */
assert(
  backgroundJobStatusBadge({ type: BACKGROUND_JOB_TYPES.COMPLETE_COMPANY_SETUP, status: BACKGROUND_JOB_STATUSES.RUNNING }) ===
    "Finishing setup",
  "10: finishing setup badge",
);
assert(
  backgroundJobStatusBadge({ type: BACKGROUND_JOB_TYPES.SEND_INVITE_EMAIL, status: BACKGROUND_JOB_STATUSES.QUEUED }) ===
    "Email sending",
  "10b: email sending badge",
);
assert(
  backgroundJobStatusBadge({ status: BACKGROUND_JOB_STATUSES.NEEDS_ATTENTION }) === "Needs attention",
  "10c: needs attention badge",
);
assert(pkg.scripts["verify:background-jobs"], "10d: verify:background-jobs script");
assert(BACKGROUND_SETUP_USER_MESSAGE.includes("background setup"), "10e: setup UX message");
assert(BACKGROUND_INVITE_CREATED_MESSAGE.includes("Email is being sent"), "10f: invite UX message");
assert(BACKGROUND_SCHEDULE_SAVED_MESSAGE.includes("syncing"), "10g: schedule UX message");

console.log("OK: verify-background-jobs — 10 cases passed");
