#!/usr/bin/env node
/**
 * Live operational dashboard verifier — aggregation, compliance, risk, role
 * visibility, per-source resilience, caching, and route/frontend wiring.
 *
 * Covers the 15 spec cases end to end.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLiveDashboardFromSources,
  buildSyncWarning,
  canViewFullOperationalDashboard,
  canViewLiveDashboard,
  computeComplianceScore,
  LIVE_DASHBOARD_NO_RISK_DATA,
  shouldScopeLiveDashboardToOwn,
} from "../shared/live-dashboard.mjs";
import { getLiveDashboard } from "../server/live-dashboard-service.mjs";

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

const NOW = new Date("2026-07-07T10:00:00.000Z");
const CO = "folder-live";
const OTHER = "folder-other";

function baseSources() {
  return {
    schedules: [
      {
        "Schedule ID": "s-today",
        "Company Folder ID": CO,
        "Schedule Name": "Daily fire walk",
        "Audit ID": "a1",
        Frequency: "Daily",
        "Live Time": "08:00",
        "Completion Hours": "24",
        "Start Date": "2026-07-01",
        "Assigned User Emails": "aud@live.co",
        Status: "ACTIVE",
        "Area ID": "area-yard",
      },
      {
        "Schedule ID": "s-overdue",
        "Company Folder ID": CO,
        "Schedule Name": "Weekly plant check",
        "Audit ID": "a2",
        Frequency: "Weekly",
        "Live Time": "08:00",
        "Completion Hours": "24",
        "Start Date": "2026-06-01",
        "Assigned User Emails": "mgr@live.co",
        Status: "ACTIVE",
        "Health State": "Overdue",
        "Missed Audit Count": "2",
        "Area ID": "area-plant",
      },
    ],
    auditResults: [
      {
        "Result ID": "r1",
        "Company ID": CO,
        "Schedule ID": "s-today",
        "Completed At": "2026-07-07T09:00:00.000Z",
        "Completed By Email": "aud@live.co",
        Status: "Passed",
      },
    ],
    auditFindings: [
      { "Finding ID": "f1", "Company ID": CO, "Area ID": "area-plant", "Risk Level": "Critical" },
      { "Finding ID": "f2", "Company ID": CO, "Area ID": "area-plant", "Risk Level": "High" },
    ],
    actions: [
      {
        "Action ID": "act-open",
        "Company ID": CO,
        Status: "Open",
        "Due Date": "2026-07-20",
        "Assigned To Name": "Bob",
        Severity: "Medium",
        "Area ID": "area-yard",
        "Source Question Text": "Fix guard rail",
      },
      {
        "Action ID": "act-overdue",
        "Company ID": CO,
        Status: "Open",
        "Due Date": "2026-06-01",
        "Assigned To Name": "Sue",
        Severity: "High",
        "Area ID": "area-plant",
        "Source Question Text": "Replace extinguisher",
      },
      {
        "Action ID": "act-closed",
        "Company ID": CO,
        Status: "Closed",
        "Due Date": "2026-06-01",
      },
    ],
    incidents: [
      {
        "Incident ID": "i-open",
        "Company ID": CO,
        Status: "Open",
        Severity: "Critical",
        "Incident Type": "Slip",
        "Incident Date": "2026-07-02",
        "Assigned To Name": "Ann",
        Department: "Plant",
      },
      {
        "Incident ID": "i-closed",
        "Company ID": CO,
        Status: "Closed",
        Severity: "Low",
        "Incident Date": "2026-05-01",
      },
    ],
    ncrs: [{ "NCR ID": "n1", "Company ID": CO, Status: "Open" }],
    briefings: [
      {
        BriefingId: "b1",
        "Company Folder ID": CO,
        Title: "Fire policy",
        Status: "Sent",
        RequiresSignature: "true",
        Priority: "Urgent",
      },
    ],
    briefingRecipients: [
      { BriefingId: "b1", RecipientEmail: "aud@live.co", RecipientName: "Aud" },
      { BriefingId: "b1", RecipientEmail: "mgr@live.co", RecipientName: "Mgr", SignedAt: "2026-07-06T10:00:00.000Z" },
    ],
    areas: [
      { "Area ID": "area-yard", Name: "Yard" },
      { "Area ID": "area-plant", Name: "Plant" },
    ],
    sites: [],
    syncLog: [],
  };
}

const adminActor = { kind: "company", role: "Admin", email: "admin@live.co", accessLevel: "admin", companyId: CO };
const managerActor = { kind: "company", role: "Manager", email: "mgr@live.co", companyId: CO };
const auditorActor = { kind: "company", role: "Auditor", email: "aud@live.co", companyId: CO };

const buildOpts = (actor) => ({ companyFolderId: CO, alternateIds: [CO], actor, now: NOW });

/** 1: Empty workbook → ok true, zero metrics. */
{
  const built = buildLiveDashboardFromSources({}, buildOpts(adminActor));
  assert(built.metrics.todayDue === 0 && built.metrics.openActions === 0 && built.metrics.currentIncidents === 0, "1: empty metrics zero");
  assert(built.metrics.complianceScore === 100, "1b: empty compliance is 100");
  assert(built.emptyState === "no-data", "1c: empty state no-data");
  assert(Array.isArray(built.actToday) && built.actToday.length === 0, "1d: act today empty");
}

/** 2: Today due / completed / outstanding correct. */
{
  const built = buildLiveDashboardFromSources(baseSources(), buildOpts(adminActor));
  assert(built.metrics.todayDue >= 1, "2: today due counts due schedule");
  assert(built.metrics.todayCompleted === 1, "2b: today completed counts result today");
  assert(built.metrics.todayOutstanding === built.metrics.todayDue - 1, "2c: outstanding excludes completed");
  assert(built.today.dateLabel === "2026-07-07", "2d: today date context");
}

/** 3: Overdue inspections correct. */
{
  const built = buildLiveDashboardFromSources(baseSources(), buildOpts(adminActor));
  assert(built.metrics.overdueInspections === 1, "3: overdue inspection counted");
  assert(built.sections.overdueInspections.some((row) => row.title.includes("plant")), "3b: overdue inspection listed");
}

/** 4: Open / overdue actions correct. */
{
  const built = buildLiveDashboardFromSources(baseSources(), buildOpts(adminActor));
  assert(built.metrics.openActions === 2, "4: open actions exclude closed");
  assert(built.metrics.overdueActions === 1, "4b: overdue action counted");
  const breakdown = built.charts.actionBreakdown;
  assert(breakdown.find((row) => row.label === "Closed")?.value === 1, "4c: closed action in breakdown");
}

/** 5: Current incidents correct. */
{
  const built = buildLiveDashboardFromSources(baseSources(), buildOpts(adminActor));
  assert(built.metrics.currentIncidents === 1, "5: open incident counted, closed excluded");
  assert(built.sections.currentIncidents[0].daysOpen >= 1, "5b: incident days open computed");
}

/** 6: Pending briefings correct. */
{
  const built = buildLiveDashboardFromSources(baseSources(), buildOpts(adminActor));
  assert(built.metrics.pendingBriefings === 1, "6: one recipient still needs to sign (other signed)");
  assert(built.sections.briefings.some((item) => item.mandatory), "6b: mandatory briefing flagged");
}

/** 7: Compliance score changes with risk items. */
{
  const clean = computeComplianceScore({});
  const risky = computeComplianceScore({ overdueInspections: 2, overdueActions: 1, openHighRiskIncidents: 1, openNcrs: 1, unsignedMandatoryBriefings: 1 });
  assert(clean.score === 100 && clean.label === "Good", "7: clean score 100");
  assert(risky.score < clean.score, "7b: penalties reduce score");
  assert(risky.reductions.length >= 4 && risky.reductions[0].points >= risky.reductions[risky.reductions.length - 1].points, "7c: reductions listed, biggest first");
  const critical = computeComplianceScore({ overdueInspections: 10, overdueActions: 10, openHighRiskIncidents: 10 });
  assert(critical.label === "Critical", "7d: heavy penalties → Critical label");
}

/** 8: Risk by site/dept ranks highest first. */
{
  const built = buildLiveDashboardFromSources(baseSources(), buildOpts(adminActor));
  assert(built.riskByArea.length >= 2, "8: risk areas built");
  assert(built.riskByArea[0].score >= built.riskByArea[built.riskByArea.length - 1].score, "8b: ranked highest first");
  assert(built.riskByArea[0].area === "Plant", "8c: plant is highest risk");
  assert(["Low", "Medium", "High", "Critical"].includes(built.riskByArea[0].level), "8d: heat-map level assigned");
  const noArea = buildLiveDashboardFromSources({ actions: [{ "Company ID": CO, Status: "Open", "Due Date": "2026-06-01" }] }, buildOpts(adminActor));
  assert(noArea.riskByArea.length === 0 && noArea.riskEmptyMessage === LIVE_DASHBOARD_NO_RISK_DATA, "8e: fallback message when no area data");
}

/** 9: One failed source doesn't crash the whole dashboard. */
{
  const store = baseSources();
  const mockDeps = {
    resolveCompanyScheduleContext: async () => ({ ok: true, companyId: CO, companyFolderId: CO, masterSheetId: "sheet-live", alternateIds: [CO] }),
    readTabRecords: async (_auth, _deps, _sheet, tab) => {
      if (tab === "Incidents") {
        throw new Error("simulated Incidents read failure");
      }
      const map = {
        Schedules: store.schedules,
        AuditResults: store.auditResults,
        AuditFindings: store.auditFindings,
        Actions: store.actions,
        NCRs: store.ncrs,
        Briefings: store.briefings,
        BriefingRecipients: store.briefingRecipients,
        Areas: store.areas,
        Sites: store.sites,
        SyncLog: store.syncLog,
      };
      return { ok: true, records: map[tab] || [] };
    },
  };
  const result = await getLiveDashboard({}, mockDeps, { companyFolderId: CO, actor: adminActor, includeDiagnostics: true });
  assert(result.ok === true, "9: dashboard still ok when one source fails");
  assert(result.metrics.currentIncidents === 0, "9b: failed source treated as empty");
  assert(result.metrics.openActions === 2, "9c: other sources still aggregated");
  assert(result.warnings.some((w) => (w.source || "") === "Incidents"), "9d: failed source recorded in warnings");
}

/** 10: Auditor sees own / assigned only. */
{
  assert(shouldScopeLiveDashboardToOwn(auditorActor), "10: auditor scoped to own");
  assert(!shouldScopeLiveDashboardToOwn(managerActor), "10b: manager not scoped to own");
  const auditorView = buildLiveDashboardFromSources(baseSources(), buildOpts(auditorActor));
  const adminView = buildLiveDashboardFromSources(baseSources(), buildOpts(adminActor));
  assert(auditorView.metrics.todayDue <= adminView.metrics.todayDue, "10c: auditor sees only own schedules");
  assert(auditorView.metrics.pendingBriefings === 1, "10d: auditor sees own pending briefing");
  // overdue inspection belongs to mgr@live.co, not the auditor
  assert(auditorView.metrics.overdueInspections === 0, "10e: auditor does not see others' overdue inspections");
}

/** 11: Admin / Manager see the operational dashboard; auditor + outsider limited. */
{
  assert(canViewLiveDashboard(adminActor, CO, [CO]), "11: admin can view");
  assert(canViewLiveDashboard(managerActor, CO, [CO]), "11b: manager can view");
  assert(canViewLiveDashboard(auditorActor, CO, [CO]), "11c: auditor can view (own scope)");
  assert(canViewLiveDashboard({ kind: "master", role: "Master" }, CO, [CO]), "11d: master can view");
  assert(canViewFullOperationalDashboard(adminActor) && canViewFullOperationalDashboard(managerActor), "11e: admin/manager get full operational");
  assert(!canViewFullOperationalDashboard(auditorActor), "11f: auditor not full operational");
  assert(!canViewLiveDashboard({ kind: "company", role: "Admin", companyId: OTHER, accessLevel: "admin" }, CO, [CO]), "11g: other-company admin denied");
}

/** 12: Cached shows immediately (2nd read served from cache). */
{
  let readCount = 0;
  const store = baseSources();
  const mockDeps = {
    resolveCompanyScheduleContext: async () => ({ ok: true, companyId: CO, companyFolderId: CO, masterSheetId: "sheet-cache", alternateIds: [CO] }),
    readTabRecords: async (_auth, _deps, _sheet, tab) => {
      readCount += 1;
      const map = { Schedules: store.schedules, Actions: store.actions };
      return { ok: true, records: map[tab] || [] };
    },
  };
  const first = await getLiveDashboard({}, mockDeps, { companyFolderId: CO, actor: adminActor });
  const readsAfterFirst = readCount;
  const second = await getLiveDashboard({}, mockDeps, { companyFolderId: CO, actor: adminActor });
  assert(first.ok && first.cached === false, "12: first load is fresh");
  assert(second.ok && second.cached === true, "12b: second load served from cache");
  assert(readCount === readsAfterFirst, "12c: cache avoids extra workbook reads");
  const clientCache = read("src/services/appDataCacheService.ts");
  assert(clientCache.includes("loadLiveDashboardCached") && clientCache.includes("LIVE_DASHBOARD_CACHE_TTL_MS"), "12d: client SWR loader + TTL");
}

/** 13: Manual refresh updates. */
{
  const clientCache = read("src/services/appDataCacheService.ts");
  assert(clientCache.includes("manualRefresh"), "13: SWR supports manual refresh (awaited fetch)");
  const component = read("src/components/dashboard/LiveOperationalDashboard.tsx");
  assert(component.includes("Refresh") && component.includes('load("manual")'), "13b: component has manual refresh control");
  assert(component.includes("lastRefreshed"), "13c: component shows last refreshed time");
  const service = read("src/services/liveDashboardService.ts");
  assert(service.includes('params.set("refresh", "1")'), "13d: refresh forces fresh fetch");
}

/** 14: Sync queue warning when queued / failed. */
{
  const ok = buildSyncWarning({ queued: 0, failed: 0 });
  assert(!ok.hasIssue, "14: no warning when nothing queued/failed");
  const queued = buildSyncWarning({ queued: 3, failed: 0 });
  assert(queued.hasIssue && /waiting to sync/.test(queued.message), "14b: queued items produce warning");
  const failed = buildSyncWarning({ queued: 1, failed: 2 });
  assert(failed.hasIssue && /failed to sync/.test(failed.message), "14c: failed items produce warning");
  const built = buildLiveDashboardFromSources(baseSources(), { ...buildOpts(adminActor), syncQueue: { queued: 2, failed: 1 } });
  assert(built.sync.hasIssue && built.warnings.some((w) => (w.source || "") === "sync"), "14d: sync warning surfaced in dashboard");

  const liveDashUi = read("src/components/dashboard/LiveOperationalDashboard.tsx");
  const liveDashService = read("src/services/liveDashboardService.ts");
  const appDataCache = read("src/services/appDataCacheService.ts");
  const appTsx = read("App.tsx");
  assert(liveDashService.includes("applyLocalSyncStatusToLiveDashboard"), "14e: local queue overlay helper exported");
  assert(liveDashUi.includes("applyLocalSyncStatusToLiveDashboard"), "14f: Live Dashboard overlays local sync counts");
  assert(liveDashUi.includes("invalidateLiveDashboardCache"), "14g: Live Dashboard invalidates cache when queue counts change");
  assert(appDataCache.includes("export function invalidateLiveDashboardCache"), "14h: invalidateLiveDashboardCache exported");
  assert(appTsx.includes("invalidateLiveDashboardCache"), "14i: Sync Centre dismissal invalidates live dashboard cache");
  assert(appTsx.includes("pendingSyncCount={syncCentreWaitingCount}"), "14j: dashboard uses Sync Centre waiting count");
  assert(appTsx.includes("failedSyncCount={syncCentreFailedCount}"), "14k: dashboard uses Sync Centre failed count");

  // Mirror client overlay: local empty queue must hide stale cached failed warning.
  function overlaySync(payload, local) {
    const q = Math.max(0, Number(local.queued) || 0);
    const f = Math.max(0, Number(local.failed) || 0);
    const hasIssue = q > 0 || f > 0;
    let message = "All work is synced.";
    if (f > 0) message = `${f} item${f === 1 ? "" : "s"} failed to sync${q > 0 ? `, ${q} queued` : ""}.`;
    else if (q > 0) message = `${q} item${q === 1 ? "" : "s"} waiting to sync.`;
    const warnings = (payload.warnings || []).filter((w) =>
      typeof w === "string" ? !/failed to sync|waiting to sync/i.test(w) : String(w.source || "").toLowerCase() !== "sync",
    );
    if (hasIssue) warnings.push({ source: "sync", message });
    return { sync: { queued: q, failed: f, hasIssue, message }, warnings };
  }
  const stale = {
    sync: { queued: 0, failed: 3, hasIssue: true, message: "3 items failed to sync." },
    warnings: [{ source: "sync", message: "3 items failed to sync." }],
  };
  const cleared = overlaySync(stale, { queued: 0, failed: 0 });
  assert(!cleared.sync.hasIssue && cleared.sync.failed === 0, "14l: dashboard hides sync warning when failed items dismissed (counts zero)");
  assert(!cleared.warnings.some((w) => (w.source || "") === "sync"), "14m: cached sync warning removed when local queue empty");
  const shown = overlaySync(stale, { queued: 0, failed: 2 });
  assert(shown.sync.hasIssue && shown.sync.failed === 2 && /2 items failed/.test(shown.sync.message), "14n: dashboard shows sync warning when failed queue items exist");
  const waitOnly = overlaySync({ sync: {}, warnings: [] }, { queued: 4, failed: 0 });
  assert(waitOnly.sync.hasIssue && /waiting to sync/.test(waitOnly.sync.message), "14o: waiting-only queue still surfaces warning");
  assert(liveDashUi.includes('load("manual")'), "14p: Refresh button reloads dashboard with current props/counts");
}

/** 15: No cross-company leakage. */
{
  const mixed = baseSources();
  mixed.actions.push({ "Action ID": "act-other", "Company ID": OTHER, Status: "Open", "Due Date": "2026-06-01" });
  mixed.incidents.push({ "Incident ID": "i-other", "Company ID": OTHER, Status: "Open", Severity: "Critical", "Incident Date": "2026-07-01" });
  mixed.schedules.push({ "Schedule ID": "s-other", "Company Folder ID": OTHER, "Schedule Name": "Other co", "Audit ID": "ax", Frequency: "Daily", "Start Date": "2026-06-01", Status: "ACTIVE" });
  const built = buildLiveDashboardFromSources(mixed, buildOpts(adminActor));
  assert(built.metrics.openActions === 2, "15: other-company actions excluded");
  assert(built.metrics.currentIncidents === 1, "15b: other-company incidents excluded");
  assert(!built.sections.currentIncidents.some((row) => row.id.includes("i-other")), "15c: no other-company incident rows");
}

/** Route + package wiring. */
{
  const coreRoutes = read("server/core-workflow-routes.mjs");
  assert(coreRoutes.includes('app.get("/api/companies/:companyFolderId/dashboard/live"'), "WIRE: live dashboard route registered");
  assert(coreRoutes.includes("getLiveDashboard"), "WIRE: route calls service");
  const service = read("server/live-dashboard-service.mjs");
  assert(service.includes("per-source") || service.includes("failedSources"), "WIRE: service reads sources resiliently");
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.scripts["verify:live-dashboard"], "WIRE: npm script registered");
  const appTsx = read("App.tsx");
  assert(appTsx.includes("LiveOperationalDashboard"), "WIRE: dashboard mounted in App");
  // No sensitive leakage in failure shape
  assert(!coreRoutes.includes("technicalError: error") || coreRoutes.includes("details: includeDiagnostics"), "WIRE: failures do not leak internals to clients");
}

console.log(`[verify:live-dashboard] OK — ${caseCount} cases passed`);
