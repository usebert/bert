#!/usr/bin/env node
/** Login must survive background job queue failures and never require Google session on company login. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../server/master-auth.mjs";
import { createAuthIndexApi } from "../server/auth-index.mjs";
import {
  performCompanyLogin,
  queueCompanyLoginBackgroundJobs,
  safeEnqueueBackgroundJob,
} from "../server/auth-service.mjs";

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

function queueCompanyLoginBackgroundJobsBody(source) {
  const start = source.indexOf("export function queueCompanyLoginBackgroundJobs");
  const next = source.indexOf("export ", start + 12);
  return source.slice(start, next > start ? next : undefined);
}

const authService = read("server/auth-service.mjs");
const serverMain = read("server/server.mjs");
const pkg = JSON.parse(read("package.json"));
const queueBgFn = queueCompanyLoginBackgroundJobsBody(authService);

const companyLoginBlock = serverMain.slice(
  serverMain.indexOf('app.post("/api/auth/company/login"'),
  serverMain.indexOf('app.post("/api/auth/company/logout"'),
);

assert(pkg.scripts["verify:login-background-jobs"], "PKG: npm script registered");
assert(authService.includes("safeEnqueueBackgroundJob"), "1: safe enqueue helper exported");
assert(!/enqueueBackgroundJob\([^)]*\)\s*\.catch/.test(queueBgFn), "1b: no .catch chained on enqueueBackgroundJob");
assert(queueBgFn.includes("safeEnqueueBackgroundJob"), "1c: post-login queue uses safeEnqueueBackgroundJob");
assert(!companyLoginBlock.includes("requireGoogleWorkspaceSession"), "2: company login does not require Google workspace session");
assert(!/queueLoginBackgroundJobs[\s\S]{0,400}\.catch/.test(companyLoginBlock), "3: login route does not .catch enqueueJob");
assert(companyLoginBlock.includes("post-response background job queue failed"), "4: post-login queue wrapped in try/catch");

let warnLogs = [];
const originalWarn = console.warn;
console.warn = (...args) => {
  warnLogs.push(args.map(String).join(" "));
  originalWarn(...args);
};

let enqueueCalls = 0;
const nonPromiseEnqueue = () => {
  enqueueCalls += 1;
  return { jobId: "sync-job" };
};
safeEnqueueBackgroundJob(nonPromiseEnqueue, {
  type: "VERIFY_AUTH_INDEX",
  companyId: "folder-1",
  requestedBy: "test@usebert.co.uk",
  payload: { email: "test@usebert.co.uk", masterSheetId: "sheet-1", companyFolderId: "folder-1" },
});
assert(enqueueCalls === 1, "5: non-Promise enqueueJob does not crash safeEnqueue");

enqueueCalls = 0;
safeEnqueueBackgroundJob(
  () => {
    enqueueCalls += 1;
    throw new Error("queue exploded");
  },
  {
    type: "VERIFY_AUTH_INDEX",
    companyId: "folder-1",
    requestedBy: "test@usebert.co.uk",
    payload: { email: "test@usebert.co.uk", masterSheetId: "sheet-1", companyFolderId: "folder-1" },
  },
);
assert(enqueueCalls === 1, "6: throwing enqueueJob is caught by safeEnqueue");

warnLogs = [];
safeEnqueueBackgroundJob(nonPromiseEnqueue, {
  type: "REBUILD_AUTH_INDEX",
  companyId: "",
  requestedBy: "missing@usebert.co.uk",
  payload: { email: "missing@usebert.co.uk", masterSheetId: "sheet-only", reason: "index_missing" },
});
assert(
  warnLogs.some((line) => line.includes("skip REBUILD_AUTH_INDEX")),
  "7: REBUILD_AUTH_INDEX skipped when companyFolderId missing",
);

const sessionDir = fs.mkdtempSync(path.join(root, ".tmp-login-bg-jobs-"));
try {
  const authIndexPath = path.join(sessionDir, "auth-index.json");
  const authIndex = createAuthIndexApi(authIndexPath);
  const testPassword = "bg-jobs-test-password-12";
  const testEmail = "bg-jobs-admin@usebert.co.uk";

  authIndex.upsertEntry({
    email: testEmail,
    name: "BG Jobs Admin",
    role: "Admin",
    accessLevel: "Company Admin",
    companyId: "bg-jobs-company-folder",
    companyFolderId: "bg-jobs-company-folder",
    companyName: "BG Jobs Co",
    masterSheetId: "bg-jobs-master-sheet",
    status: "ACTIVE",
    passwordHash: hashPassword(testPassword),
    updatedAt: new Date().toISOString(),
    companyAreas: [],
  });

  const valid = await performCompanyLogin(null, {
    authIndex,
    email: testEmail,
    password: testPassword,
  });
  assert(valid.ok === true, "8: valid login succeeds without background job deps");

  let postLoginEnqueueCalls = 0;
  queueCompanyLoginBackgroundJobs(
    {
      enqueueBackgroundJob: () => {
        postLoginEnqueueCalls += 1;
        throw new Error("post-login queue failed");
      },
    },
    {
      ...valid.backgroundJobs,
      indexStale: true,
      validateLiveCompany: true,
    },
  );
  assert(postLoginEnqueueCalls >= 1, "9: post-login queue attempted background jobs");

  const unknown = await performCompanyLogin(null, {
    authIndex,
    email: "nobody-bg-jobs@usebert.co.uk",
    password: "wrong-password",
    masterSheetId: "requested-sheet-without-folder",
  });
  assert(unknown.ok === false && unknown.httpStatus === 401, "10: unknown email returns 401 INVALID_CREDENTIALS");
  assert(unknown.code === "INVALID_CREDENTIALS", "10b: unknown email uses INVALID_CREDENTIALS code");
} finally {
  console.warn = originalWarn;
  fs.rmSync(sessionDir, { recursive: true, force: true });
}

console.log(`[verify:login-background-jobs] OK — ${caseCount} cases passed`);
