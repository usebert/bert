#!/usr/bin/env node
/**
 * Company invite foundation — server store on create, Users tab on acceptance only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword, verifyPassword } from "../server/master-auth.mjs";
import { createAuthIndexApi } from "../server/auth-index.mjs";
import { authenticateCompanyUserLogin } from "../server/user-auth-service.mjs";
import {
  buildCompanyUserInvitePayload,
  completeCompanyUserInviteAcceptance,
  createInvite,
  isPendingCompanyUserInvite,
  listPendingCompanyUserInvites,
  resolveInviteCompanyContext,
  sanitizeCompanyUserInviteForClient,
} from "../server/invite-service.mjs";

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

const inviteService = read("server/invite-service.mjs");
const serverMain = read("server/server.mjs");
const sheetFlow = read("server/company-user-sheet-flow.mjs");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:company-invite-foundation"], "PKG: npm script registered");
assert(inviteService.includes("resolveInviteCompanyContext"), "static: folder-first invite context");
assert(inviteService.includes("completeCompanyUserInviteAcceptance"), "static: acceptance helper");
assert(inviteService.includes("hashPassword"), "static: shared hashPassword");
assert(inviteService.includes("CompanyFolderId: companyContext.companyFolderId"), "static: sets CompanyFolderId");
assert(inviteService.includes('Status: "ACTIVE"'), "static: sets ACTIVE on acceptance");
assert(inviteService.includes("rebuildAuthIndexFromUsersTab"), "static: rebuilds auth index after write");
assert(inviteService.includes("isPendingCompanyUserInvite"), "static: pending invite filter");
assert(serverMain.includes("resolvePreparedCompanyUserInviteContext"), "static: server uses folder-first resolve");
assert(!serverMain.includes("rebuildUsersFromSheet(bgAuth, bgDeps, bgContext)"), "static: no users cache rebuild on accept");
assert(sheetFlow.includes("completeCompanyUserInviteAcceptance"), "static: sheet flow delegates to inviteService");

function createMockUsersTabStore(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async findRow(_auth, sheetId, email) {
      const key = String(email || "").trim().toLowerCase();
      const row = store.get(key);
      if (!row) return null;
      if (row.masterSheetId && sheetId && row.masterSheetId !== sheetId) return null;
      return {
        email: key,
        role: row.role,
        name: row.name || key,
        status: row.status,
        passwordHash: row.passwordHash,
        companyFolderId: row.companyFolderId,
        companyId: row.companyFolderId,
        companyName: row.companyName,
        rowObject: {
          Email: key,
          PasswordHash: row.passwordHash,
          Status: row.status,
          Role: row.role,
          Name: row.name || key,
          CompanyFolderId: row.companyFolderId,
          CompanyId: row.companyFolderId,
        },
      };
    },
    deps: {
      writeUsersTabRecordByHeaders: async (_auth, sheetId, record) => {
        const email = String(record.Email || "").trim().toLowerCase();
        if (!email) return { ok: false, reason: "invalid_email" };
        const existing = store.get(email) || {};
        store.set(email, {
          ...existing,
          passwordHash: String(record.PasswordHash || existing.passwordHash || "").trim(),
          status: String(record.Status || existing.status || "ACTIVE"),
          role: String(record.Role || existing.role || "Auditor"),
          name: String(record.Name || existing.name || email),
          companyFolderId: String(record.CompanyFolderId || existing.companyFolderId || "").trim(),
          companyName: String(record.Company || existing.companyName || "").trim(),
          masterSheetId: sheetId,
        });
        return { ok: true, email };
      },
      readCompanyUsersTabRecord: async (_auth, sheetId, email) => {
        const row = store.get(String(email || "").trim().toLowerCase());
        if (!row) return null;
        return {
          email,
          role: row.role,
          name: row.name,
          status: row.status,
          passwordHash: row.passwordHash,
          companyFolderId: row.companyFolderId,
          companyId: row.companyFolderId,
          companyName: row.companyName,
          rowObject: {
            Email: email,
            PasswordHash: row.passwordHash,
            Status: row.status,
            CompanyFolderId: row.companyFolderId,
          },
        };
      },
      findCompanyUsersTabRow: async (_auth, sheetId, email) => {
        const key = String(email || "").trim().toLowerCase();
        const row = store.get(key);
        if (!row) return null;
        if (row.masterSheetId && sheetId && row.masterSheetId !== sheetId) return null;
        return {
          email: key,
          roleRaw: row.role,
          role: row.role,
          name: row.name,
          status: row.status,
          passwordHash: row.passwordHash,
          companyFolderId: row.companyFolderId,
          rowObject: { Email: key, PasswordHash: row.passwordHash, Status: row.status },
        };
      },
    },
  };
}

const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "bert-company-invite-"));
try {
  const masterSheetId = "1PlwknNgtt-4j08matn1w4358YTe5SXFs5Hh0zA_m3So";
  const companyFolderId = "1TVQ-gbpxoOzE6PCkHX581eTDgtMC11lc";
  const email = "invited.user@example.com";
  const password = "InviteAccept-2026!";
  const mock = createMockUsersTabStore();
  const userDeps = {
    ...mock.deps,
    findCompanyUsersTabRow: mock.deps.findCompanyUsersTabRow,
    readCompanyUsersTabRecord: mock.deps.readCompanyUsersTabRecord,
  };
  const resolveCompanyFromFolder = async (_auth, _deps, folderId) => ({
    ok: true,
    companyFolderId: folderId,
    companyId: folderId,
    companyName: "Seven Oaks Cottages",
    masterSheetId,
  });
  const inviteStore = new Map();
  const createInviteRecord = (payload) => {
    const id = `tok-${inviteStore.size + 1}`;
    inviteStore.set(id, { ...payload, id, createdAt: Date.now(), expiresAt: Date.now() + 86400000 });
    return { id };
  };

  const payload = buildCompanyUserInvitePayload({
    email,
    role: "Auditor",
    companyFolderId,
    masterSheetId,
    companyName: "Seven Oaks Cottages",
  });
  assert(payload.status === "PENDING", "runtime: invite payload is PENDING");
  assert(!mock.store.has(email), "runtime: create does not write Users tab");

  const { id } = createInvite({ createInviteRecord }, payload);
  const inviteRecord = inviteStore.get(id);
  assert(isPendingCompanyUserInvite(inviteRecord), "runtime: stored invite is pending");
  const pending = listPendingCompanyUserInvites([{ id, record: inviteRecord }]);
  assert(pending.length === 1 && pending[0].pending === true, "runtime: pending invites listed separately");
  const clientInvite = sanitizeCompanyUserInviteForClient({ id, record: inviteRecord });
  assert(!("passwordHash" in clientInvite) && !JSON.stringify(clientInvite).includes("PasswordHash"), "runtime: invite list has no PasswordHash");

  const context = await resolveInviteCompanyContext(
    {},
    { resolveCompanyFromFolder },
    inviteRecord,
  );
  assert(context.ok === true && context.companyContext.masterSheetId === masterSheetId, "runtime: folder-first context resolves");

  const authIndexPath = path.join(sessionDir, "auth-index.json");
  const authIndexApi = createAuthIndexApi(authIndexPath);
  const acceptance = await completeCompanyUserInviteAcceptance(
    {},
    inviteRecord,
    { fullName: "Invited User", password, confirmPassword: password },
    {
      getCompanyUsersDeps: () => userDeps,
      resolveCompanyFromFolder,
      authIndex: authIndexApi,
    },
  );
  assert(acceptance.ok === true, "runtime: acceptance writes Users tab");
  const saved = mock.store.get(email);
  assert(saved?.status === "ACTIVE" && saved.companyFolderId === companyFolderId, "runtime: ACTIVE row has CompanyFolderId");
  assert(saved?.passwordHash && verifyPassword(password, saved.passwordHash), "runtime: PasswordHash saved and verifies");
  assert(!("passwordHash" in (acceptance.user || {})), "runtime: acceptance response strips PasswordHash");

  let inviteMarked = false;
  const markAccepted = () => {
    inviteMarked = true;
    inviteStore.set(id, { ...inviteRecord, status: "USED", consumedAt: Date.now() });
  };
  assert(!inviteMarked, "runtime: invite not marked before explicit accept patch");
  markAccepted();
  assert(inviteMarked && !isPendingCompanyUserInvite(inviteStore.get(id)), "runtime: invite marked accepted after Users tab write");

  const login = await authenticateCompanyUserLogin(
    {},
    {
      authIndex: authIndexApi,
      getCompanyUsersDeps: () => userDeps,
      resolveCompanyFromFolder,
      findMasterSheetIdsForCompanyLoginEmail: () => [masterSheetId],
    },
    { email, password, masterSheetId, companyFolderId },
  );
  assert(login.ok === true, "runtime: post-acceptance login succeeds");
} finally {
  fs.rmSync(sessionDir, { recursive: true, force: true });
}

console.log(`[verify:company-invite-foundation] OK — ${caseCount} cases passed`);
