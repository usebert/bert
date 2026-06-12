#!/usr/bin/env node
/** Godmode company members — same Users tab read path as company admins + repair action. */
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

const godmodeService = read("server/godmode-service.mjs");
const userService = read("server/company-user-service.mjs");
const reader = read("server/users-tab-reader.mjs");
const serverMain = read("server/server.mjs");
const panel = read("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx");
const pkg = JSON.parse(read("package.json"));

/** 1: Godmode lists active users via listActiveCompanyMembers. */
{
  assert(godmodeService.includes("listGodmodeCompanyUsers"), "1: listGodmodeCompanyUsers exported");
  assert(godmodeService.includes("listActiveCompanyMembers"), "1b: same listActiveCompanyMembers path");
}

/** 2: Shared readCompanyUsers / resolveUsersTab stack. */
{
  assert(userService.includes("readCompanyUsers"), "2: shared readCompanyUsers");
  assert(reader.includes("export async function repairUsersTab"), "2b: repairUsersTab for godmode");
}

/** 3: Godmode repair-users-tab API. */
{
  assert(serverMain.includes("repair-users-tab"), "3: repair-users-tab route");
  assert(serverMain.includes("requireMasterOnlyActor"), "3b: master-only repair");
}

/** 4: Advanced diagnostics UI — repair without changing normal user copy. */
{
  assert(panel.includes("repairUsersTab"), "4: repair handler in godmode panel");
  assert(panel.includes("Advanced diagnostics"), "4b: advanced diagnostics section");
  assert(!panel.includes("Could not load company users. Try again."), "4c: no admin user-message copy in godmode panel");
}

/** 5: PasswordHash never returned from list path. */
{
  assert(userService.includes("sanitizeUsersTabRecords"), "5: sanitize on list");
  assert(reader.includes("sanitizeUsersTabRecords"), "5b: sanitize in reader");
}

assert(pkg.scripts["verify:godmode-company-members"], "6: npm script registered");

console.log("[verify:godmode-company-members] OK: all godmode company member cases passed");
