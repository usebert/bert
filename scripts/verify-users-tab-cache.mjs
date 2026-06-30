#!/usr/bin/env node
/**
 * Users tab server-side cache — login may use cached rows; password verify always runs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../server/master-auth.mjs";
import {
  clearUsersTabCache,
  getUsersTabCache,
  invalidateUsersTabCache,
  wrapGetTabValuesWithUsersTabCache,
} from "../server/users-tab-cache.mjs";
import {
  readUserAuthRowByEmail,
  verifyUserPasswordFromUsersTab,
} from "../server/user-auth-service.mjs";
import { listableProfilesFromUsersTabRecords } from "../server/users-tab-profiles.mjs";
import { writeUsersTabRecordByHeaders } from "../server/company-users.mjs";

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
const cacheModule = read("server/users-tab-cache.mjs");
const companyUsers = read("server/company-users.mjs");
const serverSource = read("server/server.mjs");
const usersTabReader = read("server/users-tab-reader.mjs");

assert(pkg.scripts["verify:users-tab-cache"], "PKG: npm script registered");
assert(cacheModule.includes("USERS_TAB_CACHE_TTL_MS"), "static: TTL constant exported");
assert(cacheModule.includes("users_tab_cache_hit"), "static: cache hit log event");
assert(cacheModule.includes("users_tab_cache_miss"), "static: cache miss log event");
assert(cacheModule.includes("users_tab_cache_set"), "static: cache set log event");
assert(cacheModule.includes("users_tab_cache_invalidate"), "static: cache invalidate log event");
assert(serverSource.includes("wrapGetTabValuesWithUsersTabCache"), "static: server wraps getTabValues");
assert(companyUsers.includes("invalidateUsersTabCache"), "static: company-users invalidates cache");
assert(usersTabReader.includes("readUsersTabValuesWithCache") || usersTabReader.includes("deps.getTabValues"), "static: users-tab-reader uses cache layer");

const masterSheetId = "sheet-cache-test-001";
const email = "cache.user@example.com";
const password = "CacheTestPass1!";
const passwordHash = hashPassword(password);

function buildUsersTabRows(store) {
  return [
    ["Email", "PasswordHash", "Status", "Role", "Name", "CompanyFolderId", "CompanyName"],
    ...[...store.entries()].map(([rowEmail, row]) => [
      rowEmail,
      row.passwordHash,
      row.status,
      row.role,
      row.name,
      row.companyFolderId,
      row.companyName,
    ]),
  ];
}

function createCachedDeps(initial = {}) {
  const store = new Map(Object.entries(initial));
  let googleReads = 0;
  const baseGetTabValues = async () => {
    googleReads += 1;
    return buildUsersTabRows(store);
  };
  const deps = {
    googleReads: () => googleReads,
    resetReads: () => {
      googleReads = 0;
    },
    store,
    getTabValues: wrapGetTabValuesWithUsersTabCache(baseGetTabValues),
    getConfig: async () => ({}),
    updateConfig: async () => null,
    ensureColumns: async () => ({ addedColumns: [] }),
    google: {
      sheets: () => ({
        spreadsheets: {
          values: {
            update: async () => null,
            append: async () => null,
          },
        },
      }),
    },
    withSheetsQuotaRetry: (fn) => fn(),
    resolveUsersTab: async () => ({ tabTitle: "Users" }),
    writeUsersTabRecordByHeaders: async (_auth, sheetId, record, writeDeps) =>
      writeUsersTabRecordByHeaders(_auth, sheetId, record, { ...deps, ...writeDeps }),
  };
  return deps;
}

async function runRuntimeTests() {
  clearUsersTabCache();

  const activeDeps = createCachedDeps({
    [email]: {
      passwordHash,
      status: "ACTIVE",
      role: "Admin",
      name: "Cache User",
      companyFolderId: "folder-cache-001",
      companyName: "Cache Co",
    },
  });

  await readUserAuthRowByEmail({}, { masterSheetId }, email, activeDeps);
  assert(activeDeps.googleReads() === 1, "runtime: first Users tab read is cache miss (Google read)");

  await readUserAuthRowByEmail({}, { masterSheetId }, email, activeDeps);
  assert(activeDeps.googleReads() === 1, "runtime: cache hit avoids second Google read");

  const verifyOk = await verifyUserPasswordFromUsersTab(
    {},
    { masterSheetId },
    email,
    password,
    activeDeps,
  );
  assert(verifyOk.ok === true, "runtime: password verified from cached Users tab row");
  assert(activeDeps.googleReads() === 1, "runtime: password verify on cache hit skips Google read");

  const wrongPassword = await verifyUserPasswordFromUsersTab(
    {},
    { masterSheetId },
    email,
    "WrongPassword99!",
    activeDeps,
  );
  assert(wrongPassword.ok === false, "runtime: wrong password rejected from cache");
  assert(wrongPassword.reason === "invalid_credentials", "runtime: wrong password reason unchanged");

  clearUsersTabCache();
  const inactiveDeps = createCachedDeps({
    [email]: {
      passwordHash,
      status: "INACTIVE",
      role: "User",
      name: "Inactive Cache User",
      companyFolderId: "folder-cache-001",
      companyName: "Cache Co",
    },
  });
  await readUserAuthRowByEmail({}, { masterSheetId }, email, inactiveDeps);
  const inactiveLogin = await verifyUserPasswordFromUsersTab(
    {},
    { masterSheetId },
    email,
    password,
    inactiveDeps,
  );
  assert(inactiveLogin.ok === false, "runtime: inactive user rejected from cache");
  assert(inactiveLogin.reason === "inactive", "runtime: inactive reason from cached row");

  clearUsersTabCache();
  const missDeps = createCachedDeps({
    [email]: {
      passwordHash,
      status: "ACTIVE",
      role: "Admin",
      name: "Miss User",
      companyFolderId: "folder-cache-001",
      companyName: "Cache Co",
    },
  });
  assert(getUsersTabCache(masterSheetId) === null, "runtime: empty cache before first read");
  await readUserAuthRowByEmail({}, { masterSheetId }, email, missDeps);
  assert(missDeps.googleReads() === 1, "runtime: cache miss falls back to Google read");
  assert(getUsersTabCache(masterSheetId)?.rows?.length > 0, "runtime: successful read populates cache");

  clearUsersTabCache();
  const writeDeps = createCachedDeps({
    [email]: {
      passwordHash,
      status: "ACTIVE",
      role: "Admin",
      name: "Write User",
      companyFolderId: "folder-cache-001",
      companyName: "Cache Co",
    },
  });
  await readUserAuthRowByEmail({}, { masterSheetId }, email, writeDeps);
  assert(getUsersTabCache(masterSheetId) !== null, "runtime: cache populated before write");
  await writeDeps.writeUsersTabRecordByHeaders(
    {},
    masterSheetId,
    { Email: email, Name: "Write User Updated", Status: "ACTIVE" },
    writeDeps,
  );
  assert(getUsersTabCache(masterSheetId) === null, "runtime: cache invalidates on Users tab write");
  writeDeps.resetReads();
  await readUserAuthRowByEmail({}, { masterSheetId }, email, writeDeps);
  assert(writeDeps.googleReads() === 1, "runtime: post-invalidate read hits Google again");

  clearUsersTabCache();
  invalidateUsersTabCache(masterSheetId);
  const staleDeps = createCachedDeps({
    [email]: {
      passwordHash,
      status: "ACTIVE",
      role: "Admin",
      name: "Stale Cache User",
      companyFolderId: "folder-cache-001",
      companyName: "Cache Co",
    },
  });
  const staleLogin = await verifyUserPasswordFromUsersTab(
    {},
    { masterSheetId },
    email,
    password,
    staleDeps,
  );
  assert(staleLogin.ok === true, "runtime: missing/stale cache does not block login");

  const profiles = listableProfilesFromUsersTabRecords(
    [
      {
        Email: email,
        Name: "Profile User",
        Role: "User",
        Status: "ACTIVE",
        PasswordHash: passwordHash,
      },
    ],
    { masterSheetId, companyFolderId: "folder-cache-001" },
  );
  const profileJson = JSON.stringify(profiles);
  assert(!profileJson.includes("PasswordHash"), "runtime: listable profiles omit PasswordHash");
  assert(!profileJson.includes(passwordHash), "runtime: profile JSON has no hash value");

  const frontendBundleGlobs = ["src/services/godmodeService.ts", "src/services/authService.ts"];
  for (const rel of frontendBundleGlobs) {
    const src = read(rel);
    assert(!src.includes("passwordHash:"), `static: ${rel} does not expose passwordHash field`);
    assert(!src.includes("PasswordHash"), `static: ${rel} does not reference PasswordHash`);
  }

  const foundation = read("server/company-users-foundation.mjs");
  assert(foundation.includes("Never expose PasswordHash"), "static: foundation documents hash exclusion");
  assert(foundation.includes("listCompanyProfiles"), "static: user list endpoint foundation present");
}

await runRuntimeTests();
console.log(`verify:users-tab-cache — ${caseCount} checks passed`);
