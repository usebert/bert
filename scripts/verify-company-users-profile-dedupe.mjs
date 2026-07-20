#!/usr/bin/env node
/** Phase 2A — concurrent company profile load dedupe + trusted workbook context. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAuthIndexSyncKey,
  buildCompanyProfileLoadKey,
  clearCompanyUsersProfileDedupeState,
  dedupeAuthIndexSync,
  dedupeCompanyProfileLoad,
  resolveProfileLoadDedupeKey,
} from "../server/company-users-profile-dedupe.mjs";
import { resolveTrustedWorkbookForProfiles } from "../server/company-users-foundation.mjs";
import { syncAuthIndexAfterUsersRead } from "../server/auth-index.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let caseCount = 0;
function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
}

assert(read("server/company-users-profile-dedupe.mjs").includes("company_users_dedupe"), "1: profile dedupe logs");
assert(read("server/company-users-profile-dedupe.mjs").includes("auth_index_sync_dedupe"), "2: auth-index dedupe logs");
assert(read("server/company-users-foundation.mjs").includes("dedupeCompanyProfileLoad"), "3: listCompanyProfiles uses dedupe");
assert(read("server/company-users-foundation.mjs").includes("resolveTrustedWorkbookForProfiles"), "4: trusted workbook helper");
assert(read("server/auth-index.mjs").includes("dedupeAuthIndexSync"), "5: auth-index sync dedupe");
assert(read("server/core-workflow-routes.mjs").includes("trustSessionContext"), "6: routes forward trustSessionContext");
assert(
  read("server/core-workflow-routes.mjs").includes("masterSheetId: trustSessionContext ? sessionMasterSheetId : \"\""),
  "7: routes do not trust client query masterSheetId",
);

assert(
  buildCompanyProfileLoadKey("folder-a", "sheet-1") === "folder-a:sheet-1",
  "8: profile dedupe key format",
);
assert(
  buildCompanyProfileLoadKey("folder-a", "") === "folder-a:",
  "9: unresolved profile dedupe key",
);
assert(
  resolveProfileLoadDedupeKey(
    { companyFolderId: "folder-a", trustSessionContext: true, masterSheetId: "sheet-1" },
    {},
  ) === "folder-a:sheet-1",
  "10: trusted session dedupe key",
);
assert(
  resolveProfileLoadDedupeKey(
    { companyFolderId: "folder-a", masterSheetId: "client-sheet" },
    { masterSheetCache: { getEntry: () => ({ masterSheetId: "cache-sheet" }) } },
  ) === "folder-a:cache-sheet",
  "11: cache-backed dedupe key ignores client sheet",
);
assert(
  resolveProfileLoadDedupeKey({ companyFolderId: "folder-a" }, {}) === "folder-a:",
  "12: unresolved loads share empty-sheet key",
);
assert(
  buildAuthIndexSyncKey("folder-a", "sheet-1") === "folder-a:sheet-1",
  "13: auth-index sync key format",
);

{
  clearCompanyUsersProfileDedupeState();
  let loadCount = 0;
  const loadFn = async () => {
    loadCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { ok: true, users: [{ email: "a@test.co" }] };
  };
  const key = buildCompanyProfileLoadKey("folder-a", "sheet-1");
  const [first, second] = await Promise.all([
    dedupeCompanyProfileLoad(key, loadFn, { companyFolderId: "folder-a", masterSheetId: "sheet-1" }),
    dedupeCompanyProfileLoad(key, loadFn, { companyFolderId: "folder-a", masterSheetId: "sheet-1" }),
  ]);
  assert(loadCount === 1, "14: concurrent profile loads share one underlying call");
  assert(first.users[0].email === second.users[0].email, "15: concurrent callers receive same result");
}

{
  clearCompanyUsersProfileDedupeState();
  let loadCount = 0;
  const key = buildCompanyProfileLoadKey("folder-a", "sheet-1");
  const failing = dedupeCompanyProfileLoad(key, async () => {
    loadCount += 1;
    throw new Error("load failed");
  }, { companyFolderId: "folder-a", masterSheetId: "sheet-1" });
  let failed = false;
  try {
    await failing;
  } catch {
    failed = true;
  }
  assert(failed && loadCount === 1, "16: failed profile load rejects");
  loadCount = 0;
  const retry = await dedupeCompanyProfileLoad(
    key,
    async () => {
      loadCount += 1;
      return { ok: true, users: [] };
    },
    { companyFolderId: "folder-a", masterSheetId: "sheet-1" },
  );
  assert(loadCount === 1 && retry.ok === true, "17: failed profile load can be retried");
}

{
  clearCompanyUsersProfileDedupeState();
  let loadCount = 0;
  const loadFn = async () => {
    loadCount += 1;
    return { ok: true };
  };
  await Promise.all([
    dedupeCompanyProfileLoad(buildCompanyProfileLoadKey("folder-a", "sheet-1"), loadFn),
    dedupeCompanyProfileLoad(buildCompanyProfileLoadKey("folder-b", "sheet-1"), loadFn),
  ]);
  assert(loadCount === 2, "18: different companies do not share profile promises");
}

{
  clearCompanyUsersProfileDedupeState();
  let loadCount = 0;
  const loadFn = async () => {
    loadCount += 1;
    return { ok: true };
  };
  await Promise.all([
    dedupeCompanyProfileLoad(buildCompanyProfileLoadKey("folder-a", "sheet-1"), loadFn),
    dedupeCompanyProfileLoad(buildCompanyProfileLoadKey("folder-a", "sheet-2"), loadFn),
  ]);
  assert(loadCount === 2, "19: different masterSheetIds do not share profile promises");
}

{
  const trusted = resolveTrustedWorkbookForProfiles(
    {
      companyFolderId: "folder-a",
      masterSheetId: "sheet-trusted",
      trustSessionContext: true,
      sessionActor: { companyFolderId: "folder-a" },
    },
    {},
  );
  assert(trusted.trusted === true && trusted.masterSheetId === "sheet-trusted", "20: session trusted workbook accepted");
  const rejected = resolveTrustedWorkbookForProfiles(
    { companyFolderId: "folder-a", masterSheetId: "client-sheet" },
    {},
  );
  assert(rejected.trusted === false, "21: untrusted client sheet rejected");
  const cached = resolveTrustedWorkbookForProfiles(
    { companyFolderId: "folder-a" },
    { masterSheetCache: { getEntry: () => ({ masterSheetId: "cache-sheet" }) } },
  );
  assert(cached.trusted === true && cached.masterSheetId === "cache-sheet", "22: cache-backed trusted workbook accepted");
}

{
  const foundation = read("server/company-users-foundation.mjs");
  assert(foundation.includes("skippedFolderDiscovery: true"), "23: trusted context skips folder discovery");
  assert(foundation.includes("fallbackReason: trustedWorkbook.reason"), "24: untrusted context records fallback reason");
  assert(
    foundation.includes("typeof deps?.resolveCompanyFromFolder === \"function\""),
    "25: folder resolve supports injected resolver for tests",
  );
}

{
  clearCompanyUsersProfileDedupeState();
  let syncCount = 0;
  const key = buildAuthIndexSyncKey("folder-a", "sheet-1");
  const syncFn = async () => {
    syncCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { ok: true, upserted: 1 };
  };
  const [a, b] = await Promise.all([
    dedupeAuthIndexSync(key, syncFn, { companyFolderId: "folder-a", masterSheetId: "sheet-1" }),
    dedupeAuthIndexSync(key, syncFn, { companyFolderId: "folder-a", masterSheetId: "sheet-1" }),
  ]);
  assert(syncCount === 1 && a.upserted === 1 && b.upserted === 1, "26: concurrent auth-index sync shares one call");
}

{
  clearCompanyUsersProfileDedupeState();
  let syncCount = 0;
  const key = buildAuthIndexSyncKey("folder-a", "sheet-1");
  let failed = false;
  try {
    await dedupeAuthIndexSync(key, async () => {
      syncCount += 1;
      throw new Error("sync failed");
    });
  } catch {
    failed = true;
  }
  assert(failed && syncCount === 1, "27: failed auth-index sync rejects");
  syncCount = 0;
  const retry = await syncAuthIndexAfterUsersRead(
    {},
    {
      authIndex: {
        rebuildCompanyAuthIndexFromSheet: async () => {
          syncCount += 1;
          return { ok: true, upserted: 2 };
        },
      },
    },
    { companyFolderId: "folder-a", companyId: "folder-a", masterSheetId: "sheet-1" },
  );
  assert(syncCount === 1 && retry.upserted === 2, "28: failed auth-index sync can be retried");
}

console.log(`[verify:company-users-profile-dedupe] OK — ${caseCount} cases passed`);
