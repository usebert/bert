#!/usr/bin/env node
import {
  buildActTodayNavigation,
  buildBertRecordLink,
  buildKpiListNavigation,
  buildActionSourceLink,
  enrichOperationalItem,
  mapUrlFilterToActionFilter,
  parseBertRouteSearch,
  searchTargetToRoute,
} from "../shared/bert-record-navigation.mjs";
import { buildLiveDashboardFromSources } from "../shared/live-dashboard.mjs";
import { isOperationalSchedule } from "../shared/production-verification-schedule.mjs";

let checks = 0;
function assert(condition, message) {
  checks += 1;
  if (!condition) {
    console.error(`FAIL [${checks}]: ${message}`);
    process.exit(1);
  }
}

const CO = "folder-nav";

// 1. Act Today item types build correct routes
const incidentNav = buildActTodayNavigation(
  { id: "incident-INC-2026-014", type: "incident", title: "Slip hazard" },
  CO,
);
assert(incidentNav.route.includes("screen=incidents"), "incident route uses incidents screen");
assert(incidentNav.route.includes("id=INC-2026-014"), "incident route includes record id");

const actionNav = buildActTodayNavigation(
  { id: "action-overdue-act-1", type: "overdue-action", title: "Fix guard" },
  CO,
);
assert(actionNav.route.includes("screen=actions"), "overdue action route uses actions screen");
assert(actionNav.route.includes("id=act-1"), "overdue action strips prefix for record id");
assert(actionNav.route.includes("filter=overdue"), "overdue action route includes filter");

const checkNav = buildActTodayNavigation(
  {
    id: "insp-overdue-s-1",
    type: "overdue-inspection",
    title: "Fire walk",
    templateId: "audit-1",
    scheduleId: "s-1",
  },
  CO,
);
assert(checkNav.navigate.openAudit === true, "assigned check opens audit");
assert(checkNav.navigate.auditId === "audit-1", "assigned check uses template id");

const briefingNav = buildActTodayNavigation(
  { id: "briefing-b-1::user@example.com", type: "briefing", title: "Toolbox talk" },
  CO,
);
assert(briefingNav.route.includes("id=b-1"), "briefing route strips recipient suffix");

// 2. KPI cards open filtered lists
const openActionsKpi = buildKpiListNavigation("open-actions", CO);
assert(openActionsKpi.route.includes("filter=open"), "open actions KPI filter");
const overdueActionsKpi = buildKpiListNavigation("overdue-actions", CO);
assert(overdueActionsKpi.route.includes("filter=overdue"), "overdue actions KPI filter");
const incidentsKpi = buildKpiListNavigation("current-incidents", CO);
assert(incidentsKpi.route.includes("filter=under-review"), "incidents KPI filter");

// 3. Action links back to incident / audit
const incidentActionLink = buildActionSourceLink(
  { incidentId: "INC-2026-014", incidentLabel: "INC-2026-014" },
  CO,
);
assert(incidentActionLink?.sourceLabel?.includes("Linked incident"), "action incident source label");
assert(incidentActionLink?.route.includes("INC-2026-014"), "action incident source route");

const auditActionLink = buildActionSourceLink({ auditId: "audit-22", auditName: "Weekly inspection" }, CO);
assert(auditActionLink?.sourceLabel?.includes("Weekly inspection"), "action audit source label");

// 4. URL filters map to action filters
assert(mapUrlFilterToActionFilter("overdue") === "Overdue", "url overdue maps to Overdue");
assert(mapUrlFilterToActionFilter("open") === "Open", "url open maps to Open");

// 5. parse route search
const parsed = parseBertRouteSearch("?screen=actions&id=act-9&filter=overdue");
assert(parsed.screen === "actions" && parsed.recordId === "act-9" && parsed.filter === "overdue", "parse route search");

// 6. search target to route round trip
const route = searchTargetToRoute({ screen: "incidents", incidentId: "INC-1" });
assert(route.includes("screen=incidents") && route.includes("id=INC-1"), "search target to route");

// 7. live dashboard enriches operational items
const payload = buildLiveDashboardFromSources(
  {
    schedules: [
      {
        "Schedule ID": "s-overdue",
        "Company Folder ID": CO,
        "Schedule Name": "Plant check",
        "Audit ID": "audit-plant",
        Frequency: "Weekly",
        "Live Time": "08:00",
        "Completion Hours": "24",
        "Start Date": "2026-06-01",
        Status: "ACTIVE",
        "Health State": "Overdue",
      },
    ],
    actions: [
      {
        "Action ID": "act-overdue",
        "Company ID": CO,
        Status: "Open",
        "Due Date": "2026-06-01",
        "Source Audit ID": "audit-1",
        "Source Audit Name": "Weekly audit",
        "Source Question Text": "Fix issue",
        Severity: "High",
      },
    ],
    incidents: [
      {
        "Incident ID": "INC-9",
        "Company ID": CO,
        Status: "Open",
        Severity: "High",
        "Incident Date": "2026-07-01",
        "Incident Type": "Near miss",
      },
    ],
    auditResults: [],
    auditFindings: [],
    ncrs: [],
    briefings: [],
    briefingRecipients: [],
    areas: [],
    sites: [],
    syncLog: [],
  },
  { companyFolderId: CO, now: new Date("2026-07-07T10:00:00.000Z") },
);

const actIncident = payload.actToday.find((item) => item.type === "incident");
assert(actIncident?.route?.includes("INC-9"), "live dashboard actToday incident route");
const actAction = payload.actToday.find((item) => item.type === "overdue-action");
assert(actAction?.route?.includes("act-overdue"), "live dashboard actToday action route");
assert(payload.sections.outstandingActions[0]?.route?.includes("screen=actions"), "section action route");

// 8. verification schedules excluded from operational dashboard metrics helper
assert(isOperationalSchedule({ id: "bert-smoke-schedule-1", verificationMarker: "verification" }) === false, "verification schedule excluded");

// 9. enrich operational item is idempotent
const enriched = enrichOperationalItem({ id: "action-open-a1", type: "open-action", title: "Test" }, CO);
const enrichedAgain = enrichOperationalItem(enriched, CO);
assert(enrichedAgain.route === enriched.route, "enrich operational item idempotent");

// 10. generic record link builder
const docLink = buildBertRecordLink({
  recordType: "document",
  recordId: "doc-1",
  companyFolderId: CO,
  filter: "awaiting-approval",
});
assert(docLink.route.includes("screen=documents"), "document route");
assert(docLink.route.includes("filter=awaiting-approval"), "document filter");

console.log(`PASS ${checks} bert record navigation checks`);
