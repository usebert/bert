#!/usr/bin/env node
/**
 * Smoke test for reset-demo-user-password.mjs — import wiring and Config deps.
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

const script = read("scripts/reset-demo-user-password.mjs");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["reset:demo-user-password"], "PKG: reset:demo-user-password registered");
assert(pkg.scripts["verify:reset-demo-user-password"], "PKG: verify:reset-demo-user-password registered");
assert(!script.includes("getConfig") || !script.includes('getConfig,\n  updateConfig,\n} from "../server/workbook-service.mjs"'), "getConfig is not imported from workbook-service");
assert(script.includes("buildCompanyProvisionScriptDeps"), "script uses buildCompanyProvisionScriptDeps");
assert(script.includes("shared/demo-environment.mjs"), "script uses Midlands demo-environment helpers");
assert(script.includes("setCompanyUserPasswordHash"), "script still uses setCompanyUserPasswordHash");
assert(script.includes("verifyPassword"), "script verifies password hash after write");
assert(script.includes("createAuthIndexApi"), "script updates auth index");

const { buildCompanyProvisionScriptDeps } = await import("./lib/demo-environment-script-utils.mjs");
const deps = buildCompanyProvisionScriptDeps({ sessionDir: path.join(root, ".sessions") });
assert(typeof deps.getConfig === "function", "provision script deps expose getConfig");
assert(typeof deps.updateConfig === "function", "provision script deps expose updateConfig");
assert(typeof deps.getTabValues === "function", "provision script deps expose getTabValues");

const { execFileSync } = await import("node:child_process");
execFileSync(process.execPath, ["--check", path.join(root, "scripts/reset-demo-user-password.mjs")], {
  stdio: "pipe",
});

console.log(`PASS: verify-reset-demo-user-password (${caseCount} cases)`);
