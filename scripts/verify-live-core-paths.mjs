#!/usr/bin/env node
/**
 * Live core-path verification against deployed API (https://api.usebert.co.uk).
 * Requires credentials via env or scripts/live-path-secrets.local.json (gitignored).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLivePathConfig, missingLiveCredentials } from "./lib/live-path-config.mjs";
import { LiveHttpClient, assertNoPasswordHash, redactJson } from "./lib/live-http-client.mjs";

let caseCount = 0;
const report = [];

function log(line) {
  console.log(`[verify:live-core-paths] ${line}`);
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
  return { htmlStatus: htmlRes.status, bundlePath: jsMatch?.[0] || "", buildMeta };
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

async function runPreflightAudit(config) {
  const api = new LiveHttpClient(config.apiBase, config.origin);

  const health = await api.request("/api/health");
  assert(health.status === 200 && health.json?.ok === true, "preflight: API health ok", health.json);
  note("api-health", {
    version: health.json?.version,
    gitSha: health.json?.gitSha || health.json?.commit || null,
    googleOAuthConnected: health.json?.googleOAuthConnected,
  });

  const readiness = await api.request("/api/readiness");
  assert(readiness.status === 200 && readiness.json?.ready === true, "preflight: API readiness ok", readiness.json);

  const frontendMeta = await fetchFrontendBundleMeta(config.frontendUrl);
  note("frontend-deploy", {
    htmlStatus: frontendMeta.htmlStatus,
    bundlePath: frontendMeta.bundlePath,
    gitSha: frontendMeta.buildMeta?.gitSha || null,
    shortSha: frontendMeta.buildMeta?.shortSha || null,
    builtAt: frontendMeta.buildMeta?.builtAt || null,
  });

  const localDistMetaPath = path.join(config.root, "dist/build-meta.json");
  let localDistMeta = null;
  if (fs.existsSync(localDistMetaPath)) {
    localDistMeta = JSON.parse(fs.readFileSync(localDistMetaPath, "utf8"));
    note("local-dist", {
      bundleHint: fs
        .readFileSync(path.join(config.root, "dist/index.html"), "utf8")
        .match(/\/assets\/index-[^"]+\.js/)?.[0],
      gitSha: localDistMeta?.gitSha || null,
      shortSha: localDistMeta?.shortSha || null,
    });
  }

  if (!frontendMeta.buildMeta?.gitSha) {
    log("BLOCKER: deployed frontend missing /build-meta.json — SPA not redeployed from latest build");
  } else if (config.localGitSha && frontendMeta.buildMeta.gitSha !== config.localGitSha) {
    log(
      `BLOCKER: deployed frontend git ${frontendMeta.buildMeta.shortSha} != local ${config.localGitSha.slice(0, 7)} — redeploy SPA`,
    );
  }
  if (!health.json?.gitSha && config.localGitSha) {
    log("BLOCKER: deployed API health has no gitSha — redeploy API from latest commit");
  }

  const badMaster = await api.request("/api/auth/master/login", {
    method: "POST",
    body: { email: config.masterEmail, password: "__verify_live_wrong_password__" },
  });
  assert(badMaster.status === 401, "preflight: master login rejects wrong password", {
    status: badMaster.status,
    body: badMaster.json,
  });

  const noSession = await api.request("/api/auth/master/session");
  assert(noSession.status === 401, "preflight: master session requires login", { status: noSession.status });

  const fakeInvite = await api.request("/api/invites/company-user/000000000000000000000000000000000000000000000000");
  assert(fakeInvite.status >= 400, "preflight: invalid company-user token rejected", {
    status: fakeInvite.status,
    code: fakeInvite.json?.code,
  });

  return { api, frontendMeta, localDistMeta };
}

function runStaticFinalizeGuards() {
  const companyOnboarding = fs.readFileSync(path.join(configRoot, "server/company-onboarding.mjs"), "utf8");
  const serverMain = fs.readFileSync(path.join(configRoot, "server/server.mjs"), "utf8");
  assert(
    /probeCompanyLoginSheet,\s*\n\s*repairCompanyInviteTarget/.test(companyOnboarding),
    "static: company onboarding destructures probeCompanyLoginSheet (no ReferenceError at finalize)",
  );
  assert(serverMain.includes("probeCompanyLoginSheet,"), "static: server passes probeCompanyLoginSheet to onboarding deps");
  assert(
    companyOnboarding.includes("COMPANY_ONBOARDING_INTERNAL_SETUP_ERROR_MESSAGE"),
    "static: customer-safe internal setup error message defined",
  );
  const pkg = JSON.parse(fs.readFileSync(path.join(configRoot, "package.json"), "utf8"));
  assert(pkg.scripts["verify:company-setup-finalize"], "static: verify:company-setup-finalize npm script registered");
}

const configRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const config = loadLivePathConfig();
  log(`API ${config.apiBase} | frontend ${config.frontendUrl} | local git ${config.localGitSha || "unknown"}`);

  runStaticFinalizeGuards();

  await runPreflightAudit(config);

  const missing = missingLiveCredentials(config);
  if (missing.length > 0) {
    console.error(
      [
        "[verify:live-core-paths] BLOCKER: missing live credentials — authenticated journey not run.",
        "Set env vars or create scripts/live-path-secrets.local.json:",
        ...missing.map((key) => `  - ${key}`),
        "Optional file shape:",
        '  { "masterPassword": "...", "adminEmail": "...", "adminPassword": "...", "managerPassword": "..." }',
        "",
        "Preflight audit above completed (health, readiness, deployment drift, anonymous auth gates).",
      ].join("\n"),
    );
    process.exit(1);
  }

  const api = new LiveHttpClient(config.apiBase, config.origin);
  const masterClient = new LiveHttpClient(config.apiBase, config.origin);
  const adminClient = new LiveHttpClient(config.apiBase, config.origin);
  const managerClient = new LiveHttpClient(config.apiBase, config.origin);

  if (config.requireShaMatch && config.localGitSha) {
    const health = await api.request("/api/health");
    const frontendMeta = await fetchFrontendBundleMeta(config.frontendUrl);
    const apiSha = String(health.json?.gitSha || "").trim();
    const feSha = String(frontendMeta.buildMeta?.gitSha || "").trim();
    assert(apiSha && apiSha === config.localGitSha, "deployed API gitSha matches local HEAD", { apiSha, local: config.localGitSha });
    assert(feSha && feSha === config.localGitSha, "deployed frontend gitSha matches local HEAD", { feSha, local: config.localGitSha });
  }

  // ─── 1. Godmode login ─────────────────────────────────────────────────────
  const masterLogin = await masterClient.request("/api/auth/master/login", {
    method: "POST",
    body: { email: config.masterEmail, password: config.masterPassword },
  });
  assert(masterLogin.status === 200 && masterLogin.json?.ok === true, "2: Godmode login works", {
    status: masterLogin.status,
    body: masterLogin.json,
  });
  assertNoPasswordHash(masterLogin.json, "master login");

  const masterSession = await masterClient.request("/api/auth/master/session");
  assert(
    masterSession.status === 200 &&
      String(masterSession.json?.operator?.email || "").toLowerCase() === config.masterEmail.toLowerCase(),
    "3: Godmode session shows email",
    masterSession.json,
  );
  assertNoPasswordHash(masterSession.json, "master session");
  note("godmode-login", { email: masterSession.json?.operator?.email });

  const liveCompanies = await masterClient.request("/api/godmode/live-companies");
  assert(liveCompanies.status === 200 && liveCompanies.json?.ok === true, "4: Godmode company list loads", liveCompanies.json);
  assertNoPasswordHash(liveCompanies.json, "godmode live-companies");
  const company = findCompany(liveCompanies.json?.companies, config.companyNameHint);
  assert(company?.id || company?.folderId, "5: selected company context found", { companyNameHint: config.companyNameHint, company });
  const companyFolderId = String(company.id || company.folderId || "").trim();
  const masterSheetId = String(company.masterSheetId || company.sheetId || "").trim();
  note("godmode-company", { companyFolderId, masterSheetId, name: company.name });

  // ─── 3. Company Admin login ─────────────────────────────────────────────
  const adminLogin = await adminClient.request("/api/auth/company/login", {
    method: "POST",
    body: {
      email: config.adminEmail,
      password: config.adminPassword,
      masterSheetId: masterSheetId || undefined,
    },
  });
  assert(adminLogin.status === 200 && adminLogin.json?.ok === true, "6: Company Admin login works", {
    status: adminLogin.status,
    body: adminLogin.json,
  });
  assertNoPasswordHash(adminLogin.json, "admin login");

  const adminSession = await adminClient.request("/api/auth/company/session");
  assert(adminSession.status === 200 && adminSession.json?.ok === true, "7: Company Admin session ok", adminSession.json);
  assert(
    String(adminSession.json?.user?.email || "").toLowerCase() === config.adminEmail.toLowerCase(),
    "8: account email in admin session",
    adminSession.json?.user,
  );
  assert(String(adminSession.json?.user?.role || "").trim(), "9: account role in admin session", adminSession.json?.user);
  assert(
    String(adminSession.json?.company?.companyId || adminSession.json?.company?.companyName || "").trim(),
    "10: company context exists for admin",
    adminSession.json?.company,
  );
  assertNoPasswordHash(adminSession.json, "admin session");
  note("admin-session", {
    email: adminSession.json?.user?.email,
    role: adminSession.json?.user?.role,
    company: adminSession.json?.company?.companyName || adminSession.json?.company?.companyId,
  });

  const resolvedCompanyId =
    String(adminSession.json?.company?.companyId || companyFolderId || "").trim() || companyFolderId;
  const resolvedSheetId = String(adminSession.json?.company?.masterSheetId || masterSheetId || "").trim() || masterSheetId;

  // ─── 4. Manager login ─────────────────────────────────────────────────────
  const managerLogin = await managerClient.request("/api/auth/company/login", {
    method: "POST",
    body: {
      email: config.managerEmail,
      password: config.managerPassword,
      masterSheetId: resolvedSheetId || undefined,
    },
  });
  assert(managerLogin.status === 200 && managerLogin.json?.ok === true, "11: Manager login works", {
    status: managerLogin.status,
    body: managerLogin.json,
  });
  const managerSession = await managerClient.request("/api/auth/company/session");
  assert(
    String(managerSession.json?.user?.email || "").toLowerCase() === config.managerEmail.toLowerCase(),
    "12: manager account email in session",
    managerSession.json?.user,
  );
  assertNoPasswordHash(managerSession.json, "manager session");
  note("manager-session", { email: managerSession.json?.user?.email });

  // ─── Schedule assignees ───────────────────────────────────────────────────
  const assigneesRes = await adminClient.request(
    `/api/companies/${encodeURIComponent(resolvedCompanyId)}/schedule-assignees?masterSheetId=${encodeURIComponent(resolvedSheetId)}`,
  );
  assert(assigneesRes.status === 200 && assigneesRes.json?.ok === true, "13: schedule assignees load", assigneesRes.json);
  assert(Array.isArray(assigneesRes.json?.assignees) && assigneesRes.json.assignees.length > 0, "14: active assignees returned");
  assertNoPasswordHash(assigneesRes.json, "schedule assignees");
  const activeEmails = assigneesRes.json.assignees.map((row) => String(row.email || "").toLowerCase()).filter(Boolean);
  note("schedule-assignees", { count: activeEmails.length, sample: activeEmails.slice(0, 4) });

  // ─── 5. Invite flow ───────────────────────────────────────────────────────
  const inviteEmail = `verify.live+${Date.now()}@usebert.co.uk`.toLowerCase();
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
  assert(inviteRes.status === 200 && inviteRes.json?.ok === true, "15: auditor invite creates token", inviteRes.json);
  const inviteToken = String(inviteRes.json?.tokenId || inviteRes.json?.token || "").trim();
  const inviteUrl = String(inviteRes.json?.inviteUrl || "").trim();
  assert(inviteToken, "16: invite token returned", inviteRes.json);
  assert(inviteUrl.includes("/invite/company-user/"), "17: invite URL uses company-user path", { inviteUrl });
  assert(!inviteUrl.includes("/onboarding/company/"), "18: invite URL is not company onboarding path", { inviteUrl });

  const inviteLookup = await api.request(`/api/invites/company-user/${encodeURIComponent(inviteToken)}`);
  assert(inviteLookup.status === 200 && inviteLookup.json?.type === "COMPANY_USER", "19: invite token is COMPANY_USER", inviteLookup.json);
  assertNoPasswordHash(inviteLookup.json, "invite lookup");

  const onboardingMismatch = await api.request(`/api/onboarding/company/${encodeURIComponent(inviteToken)}/complete`, {
    method: "POST",
    body: { password: "test-password-123", confirmPassword: "test-password-123" },
  });
  assert(
    onboardingMismatch.status >= 400,
    "20: company-user token cannot call workspace onboarding complete",
    { status: onboardingMismatch.status, body: onboardingMismatch.json },
  );

  const inviteComplete = await api.request(`/api/invites/company-user/${encodeURIComponent(inviteToken)}/complete`, {
    method: "POST",
    body: {
      fullName: "Live Verify Auditor",
      password: "VerifyLive1!",
      confirmPassword: "VerifyLive1!",
    },
  });
  assert(inviteComplete.status === 200 && inviteComplete.json?.ok !== false, "21: company-user invite completion works", inviteComplete.json);
  assertNoPasswordHash(inviteComplete.json, "invite complete");

  const invitedLogin = await api.request("/api/auth/company/login", {
    method: "POST",
    body: {
      email: inviteEmail,
      password: "VerifyLive1!",
      masterSheetId: resolvedSheetId,
    },
  });
  assert(invitedLogin.status === 200 && invitedLogin.json?.ok === true, "22: invited user can log in", invitedLogin.json);
  note("invite-flow", { inviteEmail, inviteUrl, outcome: inviteComplete.json?.outcome || "company_user" });

  // ─── Schedules: godmode + company list ────────────────────────────────────
  const godmodeSchedules = await masterClient.request(
    `/api/companies/${encodeURIComponent(resolvedCompanyId)}/schedules?masterSheetId=${encodeURIComponent(resolvedSheetId)}`,
  );
  assert(godmodeSchedules.status === 200 && godmodeSchedules.json?.ok === true, "23: Godmode reads company schedules", godmodeSchedules.json);
  assertNoPasswordHash(godmodeSchedules.json, "godmode schedules");

  const managerSchedules = await managerClient.request(
    `/api/companies/${encodeURIComponent(resolvedCompanyId)}/schedules?masterSheetId=${encodeURIComponent(resolvedSheetId)}`,
  );
  assert(managerSchedules.status === 200 && managerSchedules.json?.ok === true, "24: manager reads company schedules", managerSchedules.json);
  assertNoPasswordHash(managerSchedules.json, "manager schedules");

  const schedules = Array.isArray(godmodeSchedules.json?.schedules) ? godmodeSchedules.json.schedules : [];
  if (schedules.length > 0) {
    const sample = schedules[0];
    const assigned = sample.assignedUserEmails || sample.assignedUsers?.map((u) => u.email) || sample.auditors || [];
    assert(
      Array.isArray(assigned) ? assigned.length > 0 : String(assigned || "").trim().length > 0,
      "25: saved schedule exposes assignedUserEmails",
      { scheduleId: sample.id, assigned },
    );
  } else {
    log("WARN: no schedules in company — skipping assignedUserEmails on-sheet check (create schedule manually)");
  }

  log(`OK — ${caseCount} live API cases passed`);
  log("─── Live audit summary ───");
  for (const row of report) {
    log(JSON.stringify(row));
  }
}

main().catch((error) => {
  console.error("[verify:live-core-paths] Unhandled error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
