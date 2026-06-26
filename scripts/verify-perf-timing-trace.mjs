#!/usr/bin/env node
/**
 * Performance timing trace — safe server/client timing hooks on core paths.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { safePerfMeta } from "../server/perf-timing.mjs";

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

const pkg = JSON.parse(read("package.json"));
const perfTiming = read("server/perf-timing.mjs");
const userAuth = read("server/user-auth-service.mjs");
const scheduleService = read("server/schedule-service.mjs");
const completionService = read("server/completion-service.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");
const authService = read("server/auth-service.mjs");
const appTsx = read("App.tsx");

assert(pkg.scripts["verify:perf-timing-trace"], "PKG: npm script registered");
assert(perfTiming.includes("safePerfMeta"), "1: perf-timing exports safePerfMeta");
assert(perfTiming.includes("logPerfPhase"), "2: perf-timing exports logPerfPhase");
assert(perfTiming.includes("passwordhash"), "3: perf-timing blocks password meta keys");

assert(authService.includes("[login]"), "4: login timing logs present");
assert(userAuth.includes('createPerfTimer("users-tab-auth"'), "5: users-tab-auth timing scope");
assert(userAuth.includes("upsertAuthIndexFromVerifiedLoginRow"), "6: fast login auth index upsert");
assert(
  !/authenticateCompanyUserLogin[\s\S]{0,5000}await rebuildAuthIndexFromUsersTab/.test(userAuth),
  "7: login hot path does not await full auth index rebuild",
);

assert(scheduleService.includes('logPerfPhase("assigned-checks"'), "8: assigned-checks server timing log");
assert(scheduleService.includes('logPerfPhase("schedules-read"'), "9: schedules-read server timing log");
assert(completionService.includes("[complete-check]"), "10: completion phase logs");
assert(completionService.includes("timingMs"), "11: completion returns timingMs");
assert(coreRoutes.includes('logPerfPhase("my-checks-route", "route_complete"'), "12: assigned-checks route timing");
assert(coreRoutes.includes('logPerfPhase("complete-check", "route_complete"'), "13: complete-check route timing");
assert(coreRoutes.includes("timingMs: result.timingMs"), "14: complete route returns timingMs");
assert(appTsx.includes("[post-submit-refresh]"), "15: post-submit refresh client timing log");

const safe = safePerfMeta({
  companyId: "folder-1",
  password: "secret",
  passwordHash: "scrypt$abc",
  answers: { q1: "yes" },
  scheduleCount: 3,
});
assert(!safe.password && !safe.passwordHash && !safe.answers, "16: safePerfMeta strips secrets");
assert(safe.companyId === "folder-1" && safe.scheduleCount === 3, "17: safePerfMeta keeps safe fields");

console.log(`[verify:perf-timing-trace] OK — ${caseCount} cases passed`);
