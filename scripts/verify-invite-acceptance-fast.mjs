#!/usr/bin/env node
/** Invite acceptance must return within seconds — no blocking setup/cache rebuild. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LiveHttpClient, assertNoPasswordHash } from "./lib/live-http-client.mjs";

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
const inviteCompletion = read("src/screens/AppHostedOnboardingCompletion.tsx");
const sheetFlow = read("server/company-user-sheet-flow.mjs");

function extractCompanyUserCompletionBlock(source) {
  const start = source.indexOf("let usersWriteOk = false;");
  const end = source.indexOf("} catch (completionErr)", start);
  assert(start >= 0 && end > start, "company_user completion block found");
  return source.slice(start, end);
}

const completionBlock = extractCompanyUserCompletionBlock(serverMain);

/** 1: Blocking path writes Users tab then marks invite used. */
assert(completionBlock.includes("completeInviteToUserRow"), "1: uses completeInviteToUserRow");
assert(
  completionBlock.indexOf("completeInviteToUserRow") < completionBlock.indexOf('status: "USED"'),
  "1b: sheet write before invite marked USED",
);

/** 2: Returns fast response contract before any slow setup. */
assert(completionBlock.includes("accountCreated: true"), "2: accountCreated in response");
assert(completionBlock.includes('nextAction: "SIGN_IN"'), "2b: nextAction SIGN_IN");
assert(completionBlock.includes("user: responseUser"), "2c: user object in response");

/** 3: Slow work queued after response — not awaited before res.json. */
const resJsonIdx = completionBlock.indexOf("res.json({");
assert(resJsonIdx >= 0, "3: res.json present");
const beforeResponse = completionBlock.slice(0, resJsonIdx);
assert(!beforeResponse.includes("await rebuildUsersFromSheet"), "3b: no blocking rebuildUsersFromSheet");
assert(!beforeResponse.includes("await authIndexApi"), "3c: no blocking auth index rebuild");
assert(
  !beforeResponse.includes("await resolveCompanyContextFromLoginWorkbook"),
  "3d: no blocking login workbook resolver",
);
assert(!beforeResponse.includes("await enrichCompanyContextFromRegistry"), "3e: no blocking registry enrich");
assert(completionBlock.includes("setImmediate("), "3f: background work via setImmediate");

/** 4: Read-back verification stays on blocking path. */
assert(sheetFlow.includes("canLoginCompanyUser"), "4: read-back via canLoginCompanyUser");
assert(sheetFlow.includes("verifyCompanyUserPassword"), "4b: PasswordHash verified on sheet");

/** 5: Frontend waits at most 5 seconds. */
assert(inviteCompletion.includes("5_000"), "5: frontend timeout is 5 seconds");
assert(!inviteCompletion.includes("120_000"), "5b: no 2-minute frontend wait");
assert(inviteCompletion.includes("Account created. You can now sign in."), "5c: success message shown");

/** 6: PasswordHash never returned in HTTP response payload. */
assert(
  !/res\.json\([\s\S]*PasswordHash/.test(completionBlock),
  "6: no PasswordHash in res.json payload",
);

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["verify:invite-acceptance-fast"], "npm script registered");

const liveEnabled = process.env.BERT_VERIFY_LIVE === "1" || process.env.BERT_VERIFY_LIVE === "true";
if (liveEnabled) {
  const api = new LiveHttpClient();
  const masterLogin = await api.request("/api/auth/master/login", {
    method: "POST",
    body: { email: process.env.BERT_MASTER_EMAIL, password: process.env.BERT_MASTER_PASSWORD },
  });
  assert(masterLogin.status === 200 && masterLogin.json?.ok === true, "live: godmode login", masterLogin.json);

  const companies = await api.request("/api/godmode/live-companies");
  const company = (companies.json?.companies || []).find((row) => row?.masterSheetId && row?.companyFolderId);
  assert(company, "live: company with master sheet");

  const inviteEmail = `fast-invite-${Date.now()}@example.com`;
  const inviteRes = await api.request("/api/onboarding/app-invites/company-user", {
    method: "POST",
    body: {
      email: inviteEmail,
      role: "Auditor",
      companyFolderId: company.companyFolderId,
      masterSheetId: company.masterSheetId,
      companyName: company.name || company.companyName,
    },
  });
  assert(inviteRes.status === 200 && inviteRes.json?.ok === true, "live: invite created", inviteRes.json);
  const token = String(inviteRes.json?.tokenId || "").trim();
  assert(token, "live: invite token");

  const started = Date.now();
  const complete = await api.request(`/api/invites/company-user/${encodeURIComponent(token)}/complete`, {
    method: "POST",
    body: { fullName: "Fast Verify", password: "VerifyLive1!", confirmPassword: "VerifyLive1!" },
  });
  const elapsedMs = Date.now() - started;
  assert(complete.status === 200 && complete.json?.ok === true, "live: invite complete", complete.json);
  assert(complete.json?.accountCreated === true, "live: accountCreated true", complete.json);
  assert(complete.json?.nextAction === "SIGN_IN", "live: nextAction SIGN_IN", complete.json);
  assert(elapsedMs < 15_000, `live: invite complete under 15s (was ${elapsedMs}ms)`, { elapsedMs });
  assertNoPasswordHash(complete.json, "live invite complete");
  console.log(`[verify:invite-acceptance-fast] live OK (${elapsedMs}ms)`);
}

console.log("[verify:invite-acceptance-fast] OK: invite acceptance fast-path contract passed");
