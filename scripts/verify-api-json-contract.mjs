#!/usr/bin/env node
/** API JSON contract — /api/* always returns JSON; clients parse safely. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const serverMain = read("server/server.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");
const userService = read("server/company-user-service.mjs");
const companyUserServiceTs = read("src/services/companyUserService.ts");
const fetchJsonTs = read("src/utils/fetchJson.ts");
const panel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
const pkg = JSON.parse(read("package.json"));

/** 1: Final /api/* 404 handler returns JSON — never HTML. */
assert(serverMain.includes('code: "API_ROUTE_NOT_FOUND"'), "1: API 404 JSON code");
assert(serverMain.includes("API route not found"), "1b: API 404 message");

/** 2: Express error middleware returns structured JSON for /api/* errors. */
assert(serverMain.includes('code: "INTERNAL_SERVER_ERROR"'), "2: API error middleware code");
assert(serverMain.includes("An unexpected error occurred"), "2b: API error middleware user message");
assert(!serverMain.includes("err.stack"), "2c: no stack traces sent to clients");

/** 3: Company users route returns JSON contract with diagnostics. */
assert(coreRoutes.includes('app.get("/api/companies/:companyId/users"'), "3: company users route");
assert(coreRoutes.includes("listActiveCompanyMembers"), "3b: route uses listActiveCompanyMembers");
assert(coreRoutes.includes("diagnostics: result.diagnostics"), "3c: success includes diagnostics");
assert(userService.includes("diagnostics:"), "3d: service builds diagnostics");

/** 4: Safe fetchJson helper with explicit non-JSON codes. */
assert(fetchJsonTs.includes("NON_JSON_RESPONSE"), "4: NON_JSON_RESPONSE code");
assert(fetchJsonTs.includes("INVALID_JSON_RESPONSE"), "4b: INVALID_JSON_RESPONSE code");
assert(fetchJsonTs.includes("content-type"), "4c: checks Content-Type");

/** 5: companyUserService uses fetchJson — no raw response.json(). */
assert(companyUserServiceTs.includes('from "../utils/fetchJson"'), "5: companyUserService imports fetchJson");
assert(companyUserServiceTs.includes("fetchJson<"), "5b: companyUserService calls fetchJson");
assert(!companyUserServiceTs.includes("response.json()"), "5c: no unsafe response.json()");
assert(companyUserServiceTs.includes("COMPANY_MEMBERS_USER_MESSAGE"), "5d: user-friendly load error");

/** 6: Users panel — workbook fix hint godmode-only. */
assert(panel.includes("Fix the workbook connection above, then re-sync users."), "6: godmode workbook hint exists");
assert(panel.includes("canShowTechnicalUi(currentUser.role)"), "6b: technical UI gates error detail");
assert(
  panel.includes("COMPANY_MEMBERS_USER_MESSAGE"),
  "6c: normal user message",
);

/** 7: npm script registered. */
assert(pkg.scripts["verify:api-json-contract"], "7: verify:api-json-contract npm script");

/** 8: Optional live probe — unknown /api route returns JSON when API is up. */
const apiBase = String(process.env.BERT_VERIFY_API_BASE || "http://127.0.0.1:8787").replace(/\/$/, "");
try {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  const response = await fetch(`${apiBase}/api/__verify-missing-route__`, {
    signal: controller.signal,
  });
  clearTimeout(timeoutId);
  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();
  assert(response.status === 404, "8: live missing route is 404", { status: response.status });
  assert(contentType.toLowerCase().includes("json"), "8b: live 404 content-type is JSON", { contentType });
  const parsed = JSON.parse(body);
  assert(parsed?.code === "API_ROUTE_NOT_FOUND", "8c: live 404 JSON code", parsed);
} catch (error) {
  if (error?.name === "AbortError") {
    console.log("[verify:api-json-contract] skip live probe (API not reachable within 3s)");
  } else if (error?.cause?.code === "ECONNREFUSED" || String(error).includes("fetch failed")) {
    console.log("[verify:api-json-contract] skip live probe (API not running)");
  } else {
    throw error;
  }
}

console.log("[verify:api-json-contract] OK: API JSON contract checks passed");
