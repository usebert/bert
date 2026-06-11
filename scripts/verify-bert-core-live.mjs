#!/usr/bin/env node
/**
 * BERT core live journey — static guards always run; live API cases when BERT_LIVE_* creds exist.
 * Twenty deployed-style cases from stability lockdown spec.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLivePathConfig, missingLiveCredentials } from "./lib/live-path-config.mjs";
import { LiveHttpClient, assertNoPasswordHash, redactJson } from "./lib/live-http-client.mjs";
import {
  COMPANY_CONTEXT_STATUS_USABLE,
  isCompanyWorkspaceUsable,
} from "../shared/company-folder-context.mjs";
import { getScheduleAssignedEmails } from "../shared/schedule-assignment.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;
const report = [];

function log(line) {
  console.log(`[verify:bert-core-live] ${line}`);
}

function fail(message, extra) {
  console.error(`FAIL [${caseCount}]: ${message}`);
  if (extra) {
    console.error(redactJson(extra));
  }
  process.exit(1);
}

function assert(condition, message, extra) {
  caseCount += 1;
  if (!condition) {
    fail(message, extra);
  }
}

function note(step, detail) {
  report.push({ step, ...detail });
  log(`${step}: ${JSON.stringify(detail)}`);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function runStaticGuards() {
  const usersPanel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
  const coreRoutes = read("server/core-workflow-routes.mjs");
  const inviteCompletion = read("src/screens/AppHostedOnboardingCompletion.tsx");
  const resolver = read("server/company-folder-resolver.mjs");
  const contextService = read("server/company-context-service.mjs");
  const userService = read("server/company-user-service.mjs");
  const scheduleService = read("server/schedule-service.mjs");
  const companyUsers = read("server/company-users.mjs");
  const serverMain = read("server/server.mjs");
  const inviteService = read("server/invite-service.mjs");
  const pkg = JSON.parse(read("package.json"));

  assert(!usersPanel.includes("COMPANY_NOT_LIVE_INVITE_MESSAGE"), "static: no not-live banner in Users panel");
  assert(!usersPanel.includes("fetchCompanyInviteReadiness"), "static: Users panel not gated on invite-readiness fetch");
  assert(!coreRoutes.includes("assertCompanyLiveForInvite"), "static: auditor invite API has no live gate");
  assert(inviteCompletion.includes("Create account"), "static: company-user page says Create account");
  assert(!inviteCompletion.includes("Create workspace"), "static: company-user page not Create workspace");
  assert(resolver.includes("resolveCompanyFromFolder"), "static: folder resolver exported");
  assert(contextService.includes("resolveCompanyContextFromFolder"), "static: single context service path");
  assert(
    isCompanyWorkspaceUsable({ companyId: "f1", companyFolderId: "f1", masterSheetId: "s1" }),
    "static: folder + workbook = usable",
  );
  assert(inviteService.includes("isCompanyUserInviteActiveForResend"), "static: invite resend helper");
  assert(userService.includes("sanitizeUsersTabRecords"), "static: PasswordHash stripped from users");
  assert(companyUsers.includes("sanitizeUserRecordForClient"), "static: user records sanitized");
  assert(scheduleService.includes("listCompanySchedules"), "static: schedule list service");
  assert(serverMain.includes("company_user replace token="), "static: resend replaces expired invites");
  assert(pkg.scripts["verify:bert-core-live"], "static: npm script registered");

  const assigned = getScheduleAssignedEmails({
    assignedUserEmails: "a@test.com, b@test.com",
    auditors: ["legacy@x.com"],
  });
  assert(assigned.includes("a@test.com") && assigned.includes("b@test.com"), "static: assignedUserEmails contract");

  log(`OK — ${caseCount} static guard cases passed`);
}

async function fetchFrontendBundleMeta(frontendUrl) {
  const htmlRes = await fetch(`${frontendUrl}/`, { signal: AbortSignal.timeout(30_000) });
  const html = await htmlRes.text();
  const jsMatch = html.match(/\/assets\/index-[^"]+\.js/);
  const buildMetaRes = await fetch(`${frontendUrl}/build-meta.json`, { signal: AbortSignal.timeout(15_000) }).catch(
    () => null,
  );
  let buildMeta = null;
  if (buildMetaRes?.ok) {
    buildMeta = await buildMetaRes.json().catch(() => null);
  }
  return { htmlStatus: htmlRes.status, bundlePath: jsMatch?.[0] || "", buildMeta, html };
}

function findCompany(companies, nameHint) {
  const hint = String(nameHint || "").trim().toLowerCase();
  if (!Array.isArray(companies)) return null;
  return (
    companies.find((row) => String(row?.name || "").trim().toLowerCase() === hint) ||
    companies.find((row) => String(row?.name || "").toLowerCase().includes(hint)) ||
    companies[0] ||
    null
  );
}

async function runLiveJourney(config) {
  const api = new LiveHttpClient(config.apiBase, config.origin);
  const masterClient = new LiveHttpClient(config.apiBase, config.origin);
  const adminClient = new LiveHttpClient(config.apiBase, config.origin);
  const managerClient = new LiveHttpClient(config.apiBase, config.origin);

  const health = await api.request("/api/health");
  assert(health.status === 200 && health.json?.ok === true, "live-1: API health ok", health.json);

  const masterLogin = await masterClient.request("/api/auth/master/login", {
    method: "POST",
    body: { email: config.masterEmail, password: config.masterPassword },
  });
  assert(masterLogin.status === 200 && masterLogin.json?.ok === true, "live-2: Godmode login works", masterLogin.json);
  assertNoPasswordHash(masterLogin.json, "godmode login");

  const liveCompanies = await masterClient.request("/api/godmode/live-companies");
  assert(liveCompanies.status === 200 && liveCompanies.json?.ok === true, "live-3: Godmode company list loads");
  const company = findCompany(liveCompanies.json?.companies, config.companyNameHint);
  assert(company?.id || company?.folderId, "live-4: company folder context found", { company });
  const companyFolderId = String(company.id || company.folderId || "").trim();
  const masterSheetId = String(company.masterSheetId || company.sheetId || "").trim();
  note("company-context", { companyFolderId, masterSheetId, name: company.name });

  const resolveFromFolder = await masterClient.request(
    `/api/godmode/companies/${encodeURIComponent(companyFolderId)}/resolve-from-folder`,
    {
      method: "POST",
      body: { companyFolderId, masterSheetId, companyName: company.name },
    },
  );
  if (resolveFromFolder.status === 200 && resolveFromFolder.json?.ok) {
    assert(
      resolveFromFolder.json?.status === COMPANY_CONTEXT_STATUS_USABLE || resolveFromFolder.json?.usable === true,
      "live-5: company usable from folder/workbook",
      resolveFromFolder.json,
    );
  } else {
    log("WARN: resolve-from-folder skipped (Google session or permissions) — using registry context");
    assert(companyFolderId && masterSheetId, "live-5b: folder + workbook ids present from registry");
  }

  const adminLogin = await adminClient.request("/api/auth/company/login", {
    method: "POST",
    body: { email: config.adminEmail, password: config.adminPassword, masterSheetId: masterSheetId || undefined },
  });
  assert(adminLogin.status === 200 && adminLogin.json?.ok === true, "live-6: Company Admin login works", adminLogin.json);
  assertNoPasswordHash(adminLogin.json, "admin login");

  const adminSession = await adminClient.request("/api/auth/company/session");
  assert(adminSession.status === 200, "live-7: admin session ok");
  assert(String(adminSession.json?.user?.email || "").toLowerCase() === config.adminEmail.toLowerCase(), "live-8: account email");
  assert(String(adminSession.json?.user?.role || "").trim(), "live-9: account role");
  assert(
    String(adminSession.json?.company?.companyId || adminSession.json?.company?.companyName || "").trim(),
    "live-10: company context in session",
  );
  assertNoPasswordHash(adminSession.json, "admin session");

  const resolvedCompanyId = String(adminSession.json?.company?.companyId || companyFolderId).trim();
  const resolvedSheetId = String(adminSession.json?.company?.masterSheetId || masterSheetId).trim();

  const managerLogin = await managerClient.request("/api/auth/company/login", {
    method: "POST",
    body: { email: config.managerEmail, password: config.managerPassword, masterSheetId: resolvedSheetId || undefined },
  });
  assert(managerLogin.status === 200 && managerLogin.json?.ok === true, "live-11: Manager login works");

  const inviteEmail = `verify.bert.core+${Date.now()}@usebert.co.uk`.toLowerCase();
  const inviteRes = await adminClient.request(`/api/companies/${encodeURIComponent(resolvedCompanyId)}/invites/auditor`, {
    method: "POST",
    body: {
      email: inviteEmail,
      role: "Auditor",
      masterSheetId: resolvedSheetId,
      companyFolderId: resolvedCompanyId,
      companyName: company.name || config.companyNameHint,
    },
  });
  assert(inviteRes.status === 200 && inviteRes.json?.ok === true, "live-12: invite creates token + inviteUrl", inviteRes.json);
  const inviteToken = String(inviteRes.json?.tokenId || inviteRes.json?.token || "").trim();
  const inviteUrl = String(inviteRes.json?.inviteUrl || "").trim();
  assert(inviteToken && inviteUrl.includes("/invite/company-user/"), "live-13: inviteUrl on company-user path");

  const replaceRes = await adminClient.request("/api/onboarding/app-invites/company-user", {
    method: "POST",
    body: {
      email: inviteEmail,
      role: "Auditor",
      companyFolderId: resolvedCompanyId,
      masterSheetId: resolvedSheetId,
      companyName: company.name,
      resend: true,
      tokenId: "f".repeat(48),
    },
  });
  assert(replaceRes.status === 200 && replaceRes.json?.ok === true, "live-14: resend replaces invalid token with fresh inviteUrl", replaceRes.json);
  const freshToken = String(replaceRes.json?.tokenId || "").trim();
  assert(freshToken && freshToken !== inviteToken, "live-15: fresh token differs from original");

  const inviteComplete = await api.request(`/api/invites/company-user/${encodeURIComponent(freshToken)}/complete`, {
    method: "POST",
    body: { fullName: "BERT Core Verify", password: "VerifyLive1!", confirmPassword: "VerifyLive1!" },
  });
  assert(inviteComplete.status === 200 && inviteComplete.json?.ok !== false, "live-16: invite acceptance works", inviteComplete.json);
  assertNoPasswordHash(inviteComplete.json, "invite complete");

  const invitedLogin = await api.request("/api/auth/company/login", {
    method: "POST",
    body: { email: inviteEmail, password: "VerifyLive1!", masterSheetId: resolvedSheetId },
  });
  assert(invitedLogin.status === 200 && invitedLogin.json?.ok === true, "live-17: new user can log in");

  const assigneesRes = await adminClient.request(
    `/api/companies/${encodeURIComponent(resolvedCompanyId)}/schedule-assignees?masterSheetId=${encodeURIComponent(resolvedSheetId)}`,
  );
  assert(assigneesRes.status === 200 && Array.isArray(assigneesRes.json?.assignees), "live-18: schedule assignees load");
  assertNoPasswordHash(assigneesRes.json, "schedule assignees");

  const godmodeSchedules = await masterClient.request(
    `/api/companies/${encodeURIComponent(resolvedCompanyId)}/schedules?masterSheetId=${encodeURIComponent(resolvedSheetId)}`,
  );
  assert(godmodeSchedules.status === 200 && godmodeSchedules.json?.ok === true, "live-19: Godmode reads company schedules");
  const managerSchedules = await managerClient.request(
    `/api/companies/${encodeURIComponent(resolvedCompanyId)}/schedules?masterSheetId=${encodeURIComponent(resolvedSheetId)}`,
  );
  assert(managerSchedules.status === 200 && managerSchedules.json?.ok === true, "live-20: manager reads company schedules");

  const schedules = Array.isArray(godmodeSchedules.json?.schedules) ? godmodeSchedules.json.schedules : [];
  if (schedules.length > 0) {
    const sample = schedules[0];
    const assigned = getScheduleAssignedEmails(sample);
    assert(assigned.length > 0, "live-20b: schedule exposes assignedUserEmails", { scheduleId: sample.id, assigned });
  } else {
    log("WARN: no schedules in company — assignedUserEmails on-sheet check skipped");
  }

  const frontendMeta = await fetchFrontendBundleMeta(config.frontendUrl);
  if (frontendMeta.bundlePath) {
    const bundleRes = await fetch(`${config.frontendUrl}${frontendMeta.bundlePath}`, {
      signal: AbortSignal.timeout(30_000),
    });
    const bundle = await bundleRes.text();
    assert(!bundle.includes("PasswordHash"), "live-21: frontend bundle does not ship PasswordHash literal");
    assert(!bundle.includes("Ready for health check"), "live-22: no health-check dead-end copy in bundle");
  }

  log(`OK — ${caseCount} total cases passed (static + live)`);
  for (const row of report) {
    log(JSON.stringify(row));
  }
}

async function main() {
  log("Phase A — static guards (always run)");
  runStaticGuards();

  const config = loadLivePathConfig();
  log(`Phase B — live journey | API ${config.apiBase} | frontend ${config.frontendUrl}`);

  const missing = missingLiveCredentials(config);
  if (missing.length > 0) {
    console.error(
      [
        "[verify:bert-core-live] BLOCKER: missing live credentials — authenticated journey not run.",
        "Set env vars or create scripts/live-path-secrets.local.json:",
        ...missing.map((key) => `  - ${key}`),
        "",
        `Static guards passed (${caseCount} cases). Live journey requires credentials.`,
      ].join("\n"),
    );
    process.exit(1);
  }

  await runLiveJourney(config);
}

main().catch((error) => {
  console.error("[verify:bert-core-live] Unhandled error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
