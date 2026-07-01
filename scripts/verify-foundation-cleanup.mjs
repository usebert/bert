#!/usr/bin/env node
/**
 * Static guards for foundation-verify Users tab cleanup route (live Render API).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FOUNDATION_VERIFY_PROTECTED_EMAILS,
  FOUNDATION_VERIFY_USER_NAME,
  isFoundationVerifyPollutionTarget,
} from "../shared/foundation-verify-users.mjs";
import {
  findFoundationVerifyPollutionTargets,
  foundationCleanupRouteEnabled,
  isFoundationCleanupSecretAuthorized,
  parseFoundationCleanupApplyFlag,
} from "../server/foundation-verify-cleanup.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;

function log(line) {
  console.log(`[verify:foundation-cleanup] ${line}`);
}

function fail(message) {
  console.error(`FAIL [${caseCount}]: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    fail(message);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const serverMain = read("server/server.mjs");
const cleanupModule = read("server/foundation-verify-cleanup.mjs");
const sharedModule = read("shared/foundation-verify-users.mjs");
const guardModule = read("scripts/lib/live-verify-write-guard.mjs");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:foundation-cleanup"], "npm script registered");
assert(serverMain.includes("installFoundationVerifyCleanupRoutes"), "server installs cleanup routes");
assert(
  cleanupModule.includes('"/api/admin/cleanup/foundation-verify-users"'),
  "cleanup route path registered",
);
assert(cleanupModule.includes("foundationCleanupRouteEnabled"), "route gated on BERT_ENABLE_FOUNDATION_CLEANUP");
assert(cleanupModule.includes("BERT_CLEANUP_SECRET"), "cleanup secret env supported");
assert(cleanupModule.includes("isFoundationCleanupSecretAuthorized"), "secret auth helper present");
assert(cleanupModule.includes("requireFoundationCleanupAuth"), "auth middleware present");
assert(cleanupModule.includes("requireMasterOnlyActor"), "master session auth fallback");
assert(cleanupModule.includes("parseFoundationCleanupApplyFlag"), "apply flag parser present");
assert(cleanupModule.includes("dryRun: !apply"), "dry-run is default response mode");
assert(cleanupModule.includes("isFoundationVerifyPollutionTarget"), "shared matching imported");
assert(cleanupModule.includes("FOUNDATION_VERIFY_PROTECTED_EMAILS"), "protected emails respected");
assert(cleanupModule.includes("readCompanyUsers"), "uses users-tab reader");
assert(cleanupModule.includes("patchTabRowByHeader"), "uses patchTabRowByHeader not physical delete");
assert(cleanupModule.includes('Status: "DELETED"'), "marks rows DELETED not removed");
assert(cleanupModule.includes("matchedEmails"), "safe email list in response");
assert(!cleanupModule.includes("PasswordHash"), "no password hash in cleanup module responses");
assert(sharedModule.includes("isFoundationVerifyPollutionTarget"), "shared matcher exists");
assert(guardModule.includes("BERT_ALLOW_LIVE_VERIFY_WRITES"), "live verify write guard unchanged");

assert(
  foundationCleanupRouteEnabled({ BERT_ENABLE_FOUNDATION_CLEANUP: "true" }),
  "route enabled when env true",
);
assert(!foundationCleanupRouteEnabled({ BERT_ENABLE_FOUNDATION_CLEANUP: "false" }), "route disabled by default");

assert(
  isFoundationCleanupSecretAuthorized(
    { headers: { "x-bert-cleanup-secret": "abc" }, query: {}, body: {} },
    { BERT_CLEANUP_SECRET: "abc" },
  ),
  "secret header auth works",
);
assert(
  !isFoundationCleanupSecretAuthorized(
    { headers: {}, query: { cleanupSecret: "wrong" }, body: {} },
    { BERT_CLEANUP_SECRET: "abc" },
  ),
  "wrong secret rejected",
);

assert(!parseFoundationCleanupApplyFlag(undefined), "apply defaults false");
assert(parseFoundationCleanupApplyFlag("true"), "apply=true accepted");
assert(!parseFoundationCleanupApplyFlag("false"), "apply=false rejected");

assert(
  isFoundationVerifyPollutionTarget("verify.foundation+test@usebert.co.uk", ""),
  "verify.foundation email matches",
);
assert(
  !isFoundationVerifyPollutionTarget("admin@usebert.co.uk", "Normal User"),
  "normal users never match",
);
assert(
  !isFoundationVerifyPollutionTarget("dovecotestudio@icloud.com", FOUNDATION_VERIFY_USER_NAME),
  "protected dovecotestudio never matches via shared module",
);

const targets = findFoundationVerifyPollutionTargets(
  [
    { Email: "verify.foundation+a@usebert.co.uk", Name: FOUNDATION_VERIFY_USER_NAME, Status: "ACTIVE" },
    { Email: "admin@usebert.co.uk", Name: "Real Admin", Status: "ACTIVE" },
    { Email: "dovecotestudio@icloud.com", Name: FOUNDATION_VERIFY_USER_NAME, Status: "ACTIVE" },
    { Email: "verify.foundation+b@usebert.co.uk", Name: "Other", Status: "DELETED" },
  ],
  { companyFolderId: "folder-a" },
);
assert(targets.length === 2, "matcher finds only foundation verify rows");
assert(
  targets.every((row) => row.email.startsWith("verify.foundation+")),
  "matched emails are foundation verify only",
);
assert(
  !targets.some((row) => FOUNDATION_VERIFY_PROTECTED_EMAILS.has(row.email)),
  "protected emails excluded from targets",
);

log(`OK — ${caseCount} static guard cases passed`);
