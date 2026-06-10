#!/usr/bin/env node
/**
 * Login performance — company/master login must not block on registry health checks or /api/readiness.
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
const serverMain = read("server/server.mjs");
const pkg = JSON.parse(read("package.json"));

const companyLoginBlock = serverMain.slice(
  serverMain.indexOf('app.post("/api/auth/company/login"'),
  serverMain.indexOf('app.post("/api/auth/company/logout"'),
);

assert(pkg.scripts["verify:login-performance"], "PKG: npm script registered");
assert(!appTsx.includes("ensureCompanyLiveIfReady"), "client login does not await registry promotion");
assert(!appTsx.includes('/api/readiness"'), "client login does not call /api/readiness");
assert(!appTsx.includes('/api/health"') || !/handleLogin|tryServerCompanyLogin|tryServerMasterLogin[\s\S]{0,800}\/api\/health/.test(appTsx), "login handlers do not gate on /api/health");
assert(!companyLoginBlock.includes("ensureCompanyLiveIfReady"), "company login route does not block on ensureCompanyLiveIfReady");
assert(companyLoginBlock.includes("probeCompanyLoginSheet"), "company login probes Users tab directly");
assert(appTsx.includes("tryServerMasterLogin") && appTsx.includes("tryServerCompanyLogin"), "client uses direct auth endpoints");
assert(appTsx.includes("/api/auth/master/session") && appTsx.includes("/api/auth/company/session"), "session restore uses auth session endpoints only");
assert(!/auth-session-bootstrap[\s\S]{0,1200}\/api\/health/.test(appTsx), "session bootstrap does not call /api/health");

console.log(`[verify:login-performance] OK — ${caseCount} cases passed`);
