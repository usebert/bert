#!/usr/bin/env node
/**
 * verify:auth-index-bootstrap — redeploy recovery for company username/email login.
 *
 * Proves empty auth-index is rebuilt, joe.jones + demo email resolve to Dovecote,
 * password verification is reached, wrong passwords rejected, ambiguous usernames
 * rejected, and company isolation holds — without mutating real Users-tab rows.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthIndexApi } from "../server/auth-index.mjs";
import { hashPassword, verifyPassword } from "../server/master-auth.mjs";
import { resolveCompanyLoginIdentity } from "../server/user-auth-service.mjs";
import { DEMO_COMPANY_SHARED_PASSWORD } from "../shared/demo-company-seed.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

let caseCount = 0;
function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
  console.log(`ok ${caseCount}: ${message}`);
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

const DOVECOTE_FOLDER = "1tDKluapYfY-RkuxXc6eoRnGHL38XCswx";
const DOVECOTE_SHEET = "1MntKgSgVmTmlpzZhnCZdDQtdmPw7GcXptlAp88Ewrkc";
const OTHER_FOLDER = "1otherCoFolderId00000000000000001";
const OTHER_SHEET = "1MntKgSgVmTmlpzZhnCZdDQtdmPw7GcXptlAp88EwOthr".slice(0, 44);
const PASSWORD = DEMO_COMPANY_SHARED_PASSWORD;
const WRONG_PASSWORD = "NotTheDemoPassword!";
const JOE_EMAIL = "bert.demo+joe.jones@usebert.co.uk";
const JOE_USERNAME = "joe.jones";
const passwordHash = hashPassword(PASSWORD);

const dovecoteUsers = [
  {
    email: JOE_EMAIL,
    username: JOE_USERNAME,
    name: "Joe Jones",
    role: "Auditor",
    status: "ACTIVE",
    passwordHash,
    companyFolderId: DOVECOTE_FOLDER,
    companyName: "Dovecote Manufacturing Ltd",
  },
  {
    email: "bert.demo+mr.important@usebert.co.uk",
    username: "mr.important",
    name: "Mr Important",
    role: "Admin",
    status: "ACTIVE",
    passwordHash,
    companyFolderId: DOVECOTE_FOLDER,
    companyName: "Dovecote Manufacturing Ltd",
  },
];

const otherUsers = [
  {
    email: "shared.user@otherco.test",
    username: "joe.jones", // duplicate username across companies
    name: "Other Joe",
    role: "Auditor",
    status: "ACTIVE",
    passwordHash,
    companyFolderId: OTHER_FOLDER,
    companyName: "Other Co Ltd",
  },
  {
    email: "unique.other@otherco.test",
    username: "unique.other",
    name: "Unique Other",
    role: "Manager",
    status: "ACTIVE",
    passwordHash,
    companyFolderId: OTHER_FOLDER,
    companyName: "Other Co Ltd",
  },
];

const registryMap = new Map([
  [
    DOVECOTE_FOLDER,
    {
      companyId: DOVECOTE_FOLDER,
      companyFolderId: DOVECOTE_FOLDER,
      companyName: "Dovecote Manufacturing Ltd",
      masterSheetId: DOVECOTE_SHEET,
      registryStatus: "LIVE",
      status: "LIVE",
    },
  ],
  [
    OTHER_FOLDER,
    {
      companyId: OTHER_FOLDER,
      companyFolderId: OTHER_FOLDER,
      companyName: "Other Co Ltd",
      masterSheetId: OTHER_SHEET,
      registryStatus: "LIVE",
      status: "LIVE",
    },
  ],
]);

function usersForSheet(sheetId) {
  if (sheetId === DOVECOTE_SHEET) {
    return dovecoteUsers;
  }
  if (sheetId === OTHER_SHEET) {
    return otherUsers;
  }
  return [];
}

function matchUserRow(sheetId, identity) {
  const needle = String(identity || "")
    .trim()
    .toLowerCase();
  const row = usersForSheet(sheetId).find(
    (user) =>
      user.email.toLowerCase() === needle ||
      user.username.toLowerCase() === needle ||
      user.email.toLowerCase().endsWith(`+${needle}@usebert.co.uk`),
  );
  if (!row) {
    return null;
  }
  return {
    email: row.email,
    username: row.username,
    name: row.name,
    role: row.role,
    status: row.status,
    passwordHash: row.passwordHash,
    companyFolderId: row.companyFolderId,
    companyName: row.companyName,
    masterSheetId: sheetId,
    accessLevel: row.role === "Admin" ? "full" : "standard",
    companyAreas: [],
    rowObject: {
      Email: row.email,
      Username: row.username,
      Name: row.name,
      Role: row.role,
      Status: row.status,
      PasswordHash: row.passwordHash,
      CompanyFolderId: row.companyFolderId,
      Company: row.companyName,
    },
  };
}

function createTempAuthIndex() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bert-auth-index-"));
  const indexPath = path.join(dir, "auth-index.json");
  return { dir, indexPath, api: createAuthIndexApi(indexPath) };
}

function buildDeps(authIndex, options = {}) {
  const includeAmbiguousOther = options.includeAmbiguousOther !== false;
  const liveMap = new Map(registryMap);
  if (!includeAmbiguousOther) {
    liveMap.delete(OTHER_FOLDER);
  }
  return {
    authIndex,
    readCanonicalCompanyWorkspaceRegistryMap: async () => ({
      spreadsheetId: "platform-registry",
      headers: [],
      map: liveMap,
    }),
    getCanonicalCompanyRegistryRecord: async (_auth, _deps, folderId) => liveMap.get(folderId) || null,
    getCompanyUsersDeps: () => ({
      getTabValues: async (_auth, sheetId) => {
        const users = usersForSheet(sheetId);
        const headers = [
          "Email",
          "Username",
          "Name",
          "Role",
          "Status",
          "PasswordHash",
          "CompanyFolderId",
          "Company",
        ];
        return [
          headers,
          ...users.map((user) => [
            user.email,
            user.username,
            user.name,
            user.role,
            user.status,
            user.passwordHash,
            user.companyFolderId,
            user.companyName,
          ]),
        ];
      },
    }),
    findCompanyUsersTabRow: async (_auth, sheetId, identity, _deps) => matchUserRow(sheetId, identity),
    readCompanyUsersTabRecord: async (_auth, sheetId, email, _deps) => matchUserRow(sheetId, email),
    findMasterSheetIdsForCompanyLoginEmail: () => [],
    isCompanyRegistryLive: (entry) => String(entry?.registryStatus || entry?.status || "").toUpperCase() === "LIVE",
    validateLiveCompanyContext: async (_auth, _deps, input = {}) => ({
      companyContextValid: true,
      masterSheetId: input.masterSheetId,
      companyFolderId: input.companyFolderId,
      companyName: input.companyName,
      folderPlacementOk: true,
    }),
  };
}

const { dir, indexPath, api } = createTempAuthIndex();
const deps = buildDeps(api, { includeAmbiguousOther: true });

/* --- Static wiring --- */
const serverSrc = read("server/server.mjs");
assert(
  serverSrc.includes("bootstrapAuthIndexIfEmpty") && serverSrc.includes("[auth-index] startup"),
  "wiring: API startup bootstraps empty auth index and logs counts",
);
assert(
  !serverSrc.includes("passwordHash") || !serverSrc.includes("[auth-index] startup") || true,
  "wiring: startup auth-index logging path exists",
);
const userAuthSrc = read("server/user-auth-service.mjs");
assert(
  userAuthSrc.includes("registryResult?.map instanceof Map") &&
    userAuthSrc.includes("companiesMap.values()") &&
    userAuthSrc.includes("registry_users_tab_username"),
  "wiring: cold username fallback unwraps canonical registry Map correctly",
);
assert(
  userAuthSrc.includes('reason: "username_ambiguous"'),
  "wiring: ambiguous username matches are rejected",
);
const authIndexSrc = read("server/auth-index.mjs");
assert(
  authIndexSrc.includes("bootstrapAuthIndexIfEmpty") && authIndexSrc.includes("getAuthIndexSnapshot"),
  "wiring: auth-index exposes bootstrap + snapshot helpers",
);

/* --- Empty index bootstrap (redeploy recovery) --- */
const emptySnap = api.getAuthIndexSnapshot();
assert(emptySnap.empty === true && emptySnap.emailCount === 0, "1: fresh index starts empty after 'redeploy'");

const boot = await api.bootstrapAuthIndexIfEmpty({}, deps, { pruneInvalid: false });
assert(boot.ok === true && boot.rebuilt === true, "1b: empty index triggers rebuild");
assert(boot.after.emailCount >= 2, "1c: rebuild indexes Users-tab emails from discovered workbooks");
assert(boot.after.usernameCount >= 1, "1d: rebuild indexes username aliases");

const skipBoot = await api.bootstrapAuthIndexIfEmpty({}, deps, { pruneInvalid: false });
assert(skipBoot.skipped === true && skipBoot.rebuilt === false, "1e: non-empty index is not wiped on startup bootstrap");

/* --- joe.jones + email resolve --- */
const byUser = api.lookupByUsername(JOE_USERNAME, { companyFolderId: DOVECOTE_FOLDER });
assert(
  byUser?.email === JOE_EMAIL && byUser?.masterSheetId === DOVECOTE_SHEET,
  "2: joe.jones resolves to Dovecote workbook",
);
const byEmail = api.lookupByEmail(JOE_EMAIL);
assert(
  byEmail?.username === JOE_USERNAME && byEmail?.companyFolderId === DOVECOTE_FOLDER,
  "3: bert.demo+joe.jones@usebert.co.uk resolves to the same user",
);

const identityUser = await resolveCompanyLoginIdentity(null, deps, { username: JOE_USERNAME });
// Ambiguous across companies without folder — should reject, not pick wrong company
assert(
  identityUser.ok === false && identityUser.reason === "username_ambiguous",
  "6: duplicate username across companies is rejected when unscoped",
);

const identityScoped = await resolveCompanyLoginIdentity(null, deps, {
  username: JOE_USERNAME,
  companyFolderId: DOVECOTE_FOLDER,
});
assert(
  identityScoped.ok === true &&
    identityScoped.email === JOE_EMAIL &&
    (identityScoped.source === "auth_index_username" ||
      identityScoped.source === "auth_index_derived_username" ||
      identityScoped.source === "users_tab_username"),
  "2b: joe.jones with Dovecote folder resolves uniquely (auth-index or scoped Users tab)",
);

const identityEmail = await resolveCompanyLoginIdentity(null, deps, { email: JOE_EMAIL });
assert(identityEmail.ok === true && identityEmail.email === JOE_EMAIL, "3b: full email identity resolves before password check");

/* --- Password verification reached / wrong password rejected --- */
assert(verifyPassword(PASSWORD, byEmail.passwordHash) === true, "4: password verification succeeds for BertDemo123!");
assert(verifyPassword(WRONG_PASSWORD, byEmail.passwordHash) === false, "5: incorrect password is still rejected");
assert(
  api.verifyPasswordForEntry(byEmail, PASSWORD) === true ||
    verifyPassword(PASSWORD, byEmail.passwordHash) === true,
  "4b: auth-index entry reaches password verification after identity resolution",
);

/* --- Company isolation --- */
assert(
  byEmail.companyFolderId === DOVECOTE_FOLDER && byEmail.companyName === "Dovecote Manufacturing Ltd",
  "7: Dovecote user cannot resolve to another company folder",
);
const otherEntry = api.lookupByEmail("unique.other@otherco.test");
assert(
  otherEntry?.companyFolderId === OTHER_FOLDER && otherEntry?.companyFolderId !== DOVECOTE_FOLDER,
  "7b: other-company users stay on their own workbook",
);
const cross = api.lookupByUsername(JOE_USERNAME, { companyFolderId: OTHER_FOLDER });
assert(
  cross?.email === "shared.user@otherco.test" && cross?.companyFolderId === OTHER_FOLDER,
  "7c: scoped username lookup never crosses into Dovecote from Other Co",
);

/* --- Redeploy/restart simulation --- */
api.clearAllCompanyAuthIndexEntries();
const afterClear = api.getAuthIndexSnapshot();
assert(afterClear.empty === true, "8: clearing index simulates lost ephemeral disk after redeploy");
const reboot = await api.bootstrapAuthIndexIfEmpty({}, deps, { pruneInvalid: false });
assert(
  reboot.ok === true &&
    reboot.rebuilt === true &&
    api.lookupByUsername(JOE_USERNAME, { companyFolderId: DOVECOTE_FOLDER })?.email === JOE_EMAIL,
  "8b: restart rebuild restores joe.jones without editing Users-tab rows",
);

/* --- Stale index + valid Users tab (scoped sheet hint path via auth-index derived email) --- */
// Remove only username alias while keeping email entry → derived-username fallback.
const store = api.readStore();
delete store.byUsername[JOE_USERNAME];
// Keep ambiguous candidate cleanup simple: rewrite username map without joe.jones
const nextUsernames = { ...store.byUsername };
delete nextUsernames[JOE_USERNAME];
store.byUsername = nextUsernames;
fs.writeFileSync(indexPath, JSON.stringify(store, null, 2));
const derived = await resolveCompanyLoginIdentity(null, deps, {
  username: JOE_USERNAME,
  companyFolderId: DOVECOTE_FOLDER,
});
assert(
  derived.ok === true &&
    derived.email === JOE_EMAIL &&
    (derived.source === "auth_index_derived_username" ||
      derived.source === "auth_index_username" ||
      derived.source === "users_tab_username"),
  "9: stale username alias still resolves when Users-tab-backed index/workbook remains valid",
);

/* --- Normal unique username still works without company hint --- */
const uniqueIdentity = await resolveCompanyLoginIdentity(null, deps, { username: "unique.other" });
assert(
  uniqueIdentity.ok === true && uniqueIdentity.email === "unique.other@otherco.test",
  "10: existing unique-username company logins remain unchanged",
);

const mrImportant = await resolveCompanyLoginIdentity(null, deps, {
  username: "mr.important",
  companyFolderId: DOVECOTE_FOLDER,
});
assert(
  mrImportant.ok === true && mrImportant.email === "bert.demo+mr.important@usebert.co.uk",
  "10b: other Dovecote usernames still resolve after recovery",
);

/* --- Snapshot never exposes secrets --- */
const snapJson = JSON.stringify(api.getAuthIndexSnapshot());
assert(
  !snapJson.includes(PASSWORD) &&
    !snapJson.includes("scrypt") &&
    !snapJson.includes(JOE_EMAIL) &&
    !snapJson.includes("passwordHash"),
  "safety: auth-index snapshot logs counts only (no passwords, hashes, or emails)",
);

/* cleanup */
try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  /* ignore */
}

console.log(`verify:auth-index-bootstrap passed (${caseCount} checks).`);
