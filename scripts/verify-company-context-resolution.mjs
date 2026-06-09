#!/usr/bin/env node
/** Static checks for company context resolution after login and invite completion. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

const serverSrc = read("server/server.mjs");
const companyUsersSrc = read("server/company-users.mjs");
const appSrc = read("App.tsx");
const applyCtxSrc = read("src/utils/applyLinkedCompanyContext.ts");
const companyContextServiceSrc = read("src/services/companyContextService.ts");

assert(
  companyUsersSrc.includes("resolveCompanyContextForUser"),
  "1: resolveCompanyContextForUser exists in company-users.mjs",
);
assert(
  companyUsersSrc.includes("readCanonicalCompanyWorkspaceRegistryMap") &&
    companyUsersSrc.includes("isCompanyRegistryLive"),
  "2: resolveCompanyContextForUser searches LIVE main + fallback registry",
);
assert(companyUsersSrc.includes('"Company ID"'), "3: Users tab stores Company ID column");
assert(
  serverSrc.includes("buildCompanySessionPayload") && serverSrc.includes("companyName"),
  "4: invite/login session payload includes companyName",
);
assert(
  serverSrc.includes("resolveCompanyContextForUser") &&
    serverSrc.includes("getCompanyContextResolutionDeps"),
  "5: company login resolves context when sheet id is missing",
);
assert(
  applyCtxSrc.includes("applyLinkedCompanyContext") && appSrc.includes("applyLinkedCompanyContext"),
  "6: frontend applies linked company context after login/session restore",
);
assert(
  companyContextServiceSrc.includes("resolveActiveCompanyContext") && appSrc.includes("resolveActiveCompanyContext"),
  "6b: frontend resolves company context from single service",
);
assert(
  appSrc.includes("linkedCompanyContext") && appSrc.includes("activeCompanyContext"),
  "6c: session-linked context feeds active company resolver",
);
assert(
  appSrc.includes("COMPANY_USER_NO_COMPANY_MESSAGE") &&
    appSrc.includes("currentUser?.role === \"Master\"") &&
    appSrc.includes("Link a company before creating schedules."),
  "7: company users see account-linked message; Master keeps manual link prompt",
);

console.log("[verify:company-context-resolution] OK");
