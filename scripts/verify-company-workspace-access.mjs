#!/usr/bin/env node
/** Company workspace switcher must only expose server-backed authorized memberships. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  dedupeAuthorizedWorkspaces,
  toCompanySwitcherWorkspace,
  workspaceAccessKey,
} from "../shared/company-workspace-access.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;

function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
  console.log(`ok ${caseCount}: ${message}`);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const appTsx = read("App.tsx");
const serverMain = read("server/server.mjs");
const companyUsers = read("server/company-users.mjs");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:company-workspace-access"], "PKG: npm script registered");

assert(serverMain.includes('app.get("/api/auth/company/workspaces"'), "1: authorized workspace list route");
assert(serverMain.includes('app.post("/api/auth/company/workspace-select"'), "1b: workspace select route validates membership");
assert(serverMain.includes("listAuthorizedCompanyWorkspacesForUser"), "1c: server uses Users-tab membership resolver");
assert(serverMain.includes("WORKSPACE_FORBIDDEN"), "1d: unauthorized workspace select rejected");

assert(companyUsers.includes("export async function listAuthorizedCompanyWorkspacesForUser"), "2: membership list exported");
assert(companyUsers.includes('String(rec.status || "").toUpperCase() !== "ACTIVE"'), "2b: only ACTIVE Users-tab rows");
assert(companyUsers.includes("rec.passwordHash"), "2c: login-ready membership requires password hash");
assert(companyUsers.includes("resolveCompanyContextForUser"), "2d: login resolver reuses authorized list");

assert(appTsx.includes("loadAuthorizedCompanyWorkspaces"), "3: App loads authorized workspaces for company users");
assert(appTsx.includes("fetchAuthorizedCompanyWorkspaces"), "3b: App calls authorized workspace API");
assert(appTsx.includes("selectAuthorizedCompanyWorkspace"), "3c: App revalidates membership on switch");
assert(!/loadGoogleStatus[\s\S]*?setFolders\(visibleCompanies\)/.test(appTsx), "3d: google status does not populate company-user switcher");
assert(
  /currentUser\?\.role === "Master"[\s\S]*selectableGodmodeFolders/.test(appTsx),
  "3e: Master switcher still uses godmode live folders",
);

const deduped = dedupeAuthorizedWorkspaces([
  { companyFolderId: "folder-a", masterSheetId: "sheet-1", companyName: "Dovecote Manufacturing Ltd" },
  { companyFolderId: "folder-a", masterSheetId: "sheet-1", companyName: "Dovecote Manufacturing Ltd" },
  { companyFolderId: "folder-a", masterSheetId: "sheet-1", companyName: "Dovecote Studio" },
]);
assert(deduped.length === 1, "4: duplicate registry rows collapse to one option");
assert(workspaceAccessKey(deduped[0]) === "folder-a::sheet-1", "4b: dedupe key uses folder + master sheet");

const switcher = toCompanySwitcherWorkspace({
  companyFolderId: "folder-a",
  companyName: "Dovecote Manufacturing Ltd",
  masterSheetId: "sheet-1",
});
assert(switcher?.companyFolderId === "folder-a", "5: switcher payload exposes folder id");
assert(switcher?.companyName === "Dovecote Manufacturing Ltd", "5b: switcher payload exposes company name");
assert(!("masterSheetId" in (switcher || {})), "5c: switcher payload omits master sheet id");

console.log(`[verify:company-workspace-access] ${caseCount} checks OK`);
