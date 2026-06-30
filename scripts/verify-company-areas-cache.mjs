#!/usr/bin/env node
/**
 * Company areas cache — miss/hit behaviour, invalidation, auth safety unchanged.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  companyAreasCacheKey,
  getCompanyAreasCacheEntry,
  getCompanyAreasCacheTtlMs,
  invalidateCompanyAreasCache,
  setCompanyAreasCacheEntry,
} from "../server/company-areas-cache.mjs";
import {
  getCompanyContextHint,
  getCompanyContextHintCacheTtlMs,
  setCompanyContextHint,
} from "../server/company-context-hint-cache.mjs";
import { API_TIMING_PREFIX } from "../server/api-timing.mjs";
import { buildCompanySessionApiResponse } from "../server/auth-service.mjs";

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
assert(pkg.scripts["verify:company-areas-cache"], "PKG: npm script registered");

const companyAreasRoute = read("server/company-areas.mjs");
const companyAreasCache = read("server/company-areas-cache.mjs");
const contextHintCache = read("server/company-context-hint-cache.mjs");
const auditMapping = read("server/company-audit-mapping.mjs");
const authService = read("server/auth-service.mjs");
const userAuth = read("server/user-auth-service.mjs");

assert(companyAreasCache.includes("DEFAULT_TTL_MS"), "static: company-areas-cache has TTL");
assert(getCompanyAreasCacheTtlMs() === 60_000, "runtime: default company areas TTL is 60s");
assert(getCompanyContextHintCacheTtlMs() === 60_000, "runtime: default context hint TTL is 60s");

assert(companyAreasRoute.includes("getCompanyAreasCacheEntry"), "static: GET uses cache lookup");
assert(companyAreasRoute.includes("setCompanyAreasCacheEntry"), "static: GET stores cache on miss");
assert(companyAreasRoute.includes('trace.mark("cache_hit"'), "static: logs cache_hit");
assert(companyAreasRoute.includes('trace.mark("cache_miss"'), "static: logs cache_miss");
assert(companyAreasRoute.includes('trace.mark("route_start"'), "static: logs route_start");
assert(companyAreasRoute.includes('trace.mark("sheets_read_start"'), "static: logs sheets_read_start");
assert(companyAreasRoute.includes('trace.phase("sheets_read_end"'), "static: logs sheets_read_end");
assert(companyAreasRoute.includes('trace.phase("resolve_company_context"'), "static: logs resolve_company_context");
assert(companyAreasRoute.includes('trace.phase("parse_rows"'), "static: logs parse_rows");
assert(companyAreasRoute.includes('trace.mark("response_ready"'), "static: logs response_ready");
assert(companyAreasRoute.includes("invalidateAreasCacheForWrite"), "static: write routes invalidate cache");

for (const writeRoute of [
  "default-form-language",
  'app.post("/api/company-areas/:masterSheetId"',
  'app.patch("/api/company-areas/:masterSheetId/:areaId"',
  "config/restrictions",
]) {
  assert(companyAreasRoute.includes(writeRoute), `static: company-areas includes ${writeRoute}`);
}

assert(auditMapping.includes("invalidateCompanyAreasCache"), "static: audit-mapping invalidates areas cache");
for (const mappingWrite of ["area-audits", "audit-templates", "user-area-access", "user-audit-access"]) {
  assert(auditMapping.includes(mappingWrite), `static: audit-mapping has ${mappingWrite} route`);
}

assert(companyAreasRoute.includes("getConfig(authed, masterSheetId)"), "static: miss path still reads Config tab");
assert(companyAreasRoute.includes("readAreasTab(deps, authed, masterSheetId)"), "static: miss path still reads Areas tab");
assert(!companyAreasCache.includes("password"), "static: cache module has no password fields");
assert(!companyAreasCache.includes("PasswordHash"), "static: cache module has no PasswordHash");

const sessionResponse = buildCompanySessionApiResponse({
  email: "areas-cache@usebert.co.uk",
  companyFolderId: "folder-cache",
  companyId: "folder-cache",
  companyName: "Cache Co",
  masterSheetId: "sheet-cache",
  role: "Admin",
  name: "Cache User",
});
assert(sessionResponse.ok === true, "static: session API ok");
assert(!Object.prototype.hasOwnProperty.call(sessionResponse, "PasswordHash"), "static: session API omits PasswordHash");
assert(!JSON.stringify(sessionResponse).match(/passwordhash/i), "static: session JSON has no passwordhash");

assert(userAuth.includes("inactive"), "static: user-auth still handles inactive users");
assert(authService.includes("performCompanyLogin"), "static: auth-service login preserved");

invalidateCompanyAreasCache();
const sheetA = "sheet-alpha";
const folderA = "folder-alpha";
const folderB = "folder-beta";
const payloadA = {
  areaRestrictionsEnabled: false,
  defaultFormLanguage: "en-GB",
  areas: [{ id: "area-1", name: "Bay 1", active: true, status: "active" }],
};

assert(getCompanyAreasCacheEntry(sheetA, folderA) === null, "runtime: empty cache returns null");

setCompanyAreasCacheEntry(sheetA, folderA, {
  ...payloadA,
  masterSheetId: sheetA,
  companyFolderId: folderA,
});
const hitA = getCompanyAreasCacheEntry(sheetA, folderA);
assert(hitA?.areas?.length === 1, "runtime: cache hit returns stored areas");
assert(hitA?.defaultFormLanguage === "en-GB", "runtime: cache hit returns config fields");
assert(getCompanyAreasCacheEntry(sheetA, folderB) === null, "runtime: cache key is per company folder");

setCompanyAreasCacheEntry("sheet-beta", folderB, {
  areaRestrictionsEnabled: true,
  defaultFormLanguage: "cy-GB",
  areas: [{ id: "area-2", name: "Bay 2", active: true, status: "active" }],
});
assert(
  companyAreasCacheKey("sheet-beta", folderB) !== companyAreasCacheKey(sheetA, folderA),
  "runtime: cache keys differ per masterSheetId/folder",
);
assert(getCompanyAreasCacheEntry("sheet-beta", folderB)?.areas?.[0]?.name === "Bay 2", "runtime: second company isolated");

invalidateCompanyAreasCache(sheetA, folderA);
assert(getCompanyAreasCacheEntry(sheetA, folderA) === null, "runtime: invalidate clears sheet+folder entry");
assert(getCompanyAreasCacheEntry("sheet-beta", folderB) !== null, "runtime: invalidate does not clear unrelated company");

setCompanyContextHint(folderA, { masterSheetId: sheetA, companyName: "Hint Co" });
const hint = getCompanyContextHint(folderA);
assert(hint?.masterSheetId === sheetA, "runtime: context hint stores masterSheetId");
assert(hint?.companyName === "Hint Co", "runtime: context hint stores companyName");

invalidateCompanyAreasCache();

const captured = [];
const originalInfo = console.info;
console.info = (...args) => {
  captured.push(args.map((part) => String(part)).join(" "));
};
try {
  const { createApiTimingTrace } = await import("../server/api-timing.mjs");
  const trace = createApiTimingTrace({ route: "company-areas-verify", masterSheetId: "sheet-timing" });
  trace.mark("route_start");
  trace.mark("cache_miss");
  trace.mark("sheets_read_start");
  trace.phase("sheets_read_end", Date.now() - 12, { tabs: ["Config", "Areas"] });
  trace.phase("resolve_company_context", Date.now() - 2, { contextSource: "query" });
  trace.phase("parse_rows", Date.now() - 1, { areaCount: 1 });
  trace.mark("response_ready", { cached: false });
} finally {
  console.info = originalInfo;
}

for (const line of captured) {
  assert(line.includes(API_TIMING_PREFIX), `runtime: api timing prefix (${line})`);
  assert(!/password=|passwordHash=|\"password\":/i.test(line), `runtime: no password leak (${line})`);
}
assert(captured.some((line) => line.includes("cache_miss")), "runtime: cache_miss logged");
assert(captured.some((line) => line.includes("sheets_read_end")), "runtime: sheets_read_end logged");

console.log(`[verify:company-areas-cache] OK — ${caseCount} cases passed`);
