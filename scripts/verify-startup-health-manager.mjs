#!/usr/bin/env node
/**
 * Static wiring checks for startup health manager and /api/system/health route.
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

const pkg = JSON.parse(read("package.json"));
const server = read("server/server.mjs");
const manager = read("server/startup-health-manager.mjs");

assert(pkg.scripts["verify:startup-boot-gate-tests"], "verify:startup-boot-gate-tests registered");
assert(fs.existsSync(path.join(root, "server/startup-health-manager.mjs")), "startup-health-manager module exists");
assert(manager.includes("runStartupHealthChecks"), "manager exports startup check runner");
assert(manager.includes("createStartupHealthService"), "manager exports startup health service");
assert(server.includes('app.get("/api/system/health"'), "/api/system/health route registered");
assert(server.includes("requireMasterOnlyActor"), "/api/system/health is master-protected");
assert(server.includes("formatStartupVerificationReport"), "startup verification banner wired");
assert(server.includes("executeBootSequence"), "boot gate executeBootSequence wired");
assert(server.includes("bootApiServer"), "async bootApiServer entrypoint wired");
assert(server.includes("runCriticalBootChecks"), "critical boot checks run before listen");
assert(!server.includes("backgroundJobs.startProcessor();\n\nstartupHealthService"), "processor not started before health service");
assert(manager.includes("runCriticalBootChecks"), "manager exports critical boot checks");
assert(manager.includes("runDeferredReadinessChecks"), "manager exports deferred readiness checks");
assert(fs.existsSync(path.join(root, "server/startup-boot-gate.mjs")), "startup-boot-gate module exists");
assert(!manager.includes("passwordHash"), "startup manager does not log password hashes");

console.log(`PASS: verify-startup-health-manager (${caseCount} cases)`);
