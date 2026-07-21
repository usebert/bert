#!/usr/bin/env node
/**
 * verify:dashboard-ui — Release 2 unified navigation and operational dashboard checks.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  return readFileSync(path.join(root, relPath), "utf8");
}

function main() {
  const pkg = JSON.parse(read("package.json"));
  const app = read("App.tsx");
  const unified = read("src/components/dashboard/unified/UnifiedOperationalDashboard.tsx");
  const roleUnified = read("src/components/dashboard/unified/RoleUnifiedDashboard.tsx");
  const builders = read("src/dashboard/unified/buildUnifiedDashboardSections.ts");
  const needsAttention = read("src/dashboard/unified/buildNeedsAttention.ts");
  const todaysWork = read("src/dashboard/unified/buildTodaysWork.ts");
  const performance = read("src/dashboard/unified/buildPerformanceKpis.ts");
  const recent = read("src/dashboard/unified/buildRecentActivity.ts");
  const liveHook = read("src/hooks/useUnifiedLiveDashboard.ts");
  const navPresentation = read("src/config/navPresentation.ts");
  const roleNavigation = read("src/config/roleNavigation.ts");
  const cardDefinitions = read("src/dashboard-layout/cardDefinitions.ts");
  const managerDash = read("src/components/dashboard/ManagerRoleDashboard.tsx");
  const adminDash = read("src/components/dashboard/CompanyAdminDashboard.tsx");
  const auditorDash = read("src/components/dashboard/AuditorTaskDashboard.tsx");
  const masterDash = read("src/components/dashboard/MasterPlatformDashboard.tsx");
  const liveDashboard = read("shared/live-dashboard.mjs");

  assert(Boolean(pkg.scripts?.["verify:dashboard-ui"]), "package.json defines verify:dashboard-ui");

  // 1. Shared layout across roles
  assert(unified.includes("Needs attention"), "unified dashboard renders Needs attention");
  assert(unified.includes("Today's work"), "unified dashboard renders Today's work");
  assert(unified.includes("Performance"), "unified dashboard renders Performance");
  assert(unified.includes("Recent activity"), "unified dashboard renders Recent activity");
  assert(managerDash.includes("RoleUnifiedDashboard"), "manager dashboard uses shared layout");
  assert(adminDash.includes("RoleUnifiedDashboard"), "admin dashboard uses shared layout");
  assert(auditorDash.includes("RoleUnifiedDashboard"), "auditor dashboard uses shared layout");
  assert(masterDash.includes("RoleUnifiedDashboard"), "master dashboard uses shared layout");

  // 2. Release 1 UI primitives
  assert(unified.includes("PageContainer"), "uses PageContainer");
  assert(unified.includes("PageHeader"), "uses PageHeader");
  assert(unified.includes("Section"), "uses Section");
  assert(unified.includes("StatusBadge"), "uses StatusBadge");
  assert(unified.includes("EmptyState"), "uses EmptyState");
  assert(unified.includes("SkeletonCard"), "uses skeleton loading");

  // 3. Live data reuse — act today / compliance untouched server-side
  assert(builders.includes("buildNeedsAttentionFromActToday"), "needs attention reuses actToday payload");
  assert(performance.includes("livePayload?.compliance?.score"), "performance uses live compliance score");
  assert(liveHook.includes("loadLiveDashboardCached"), "live hook reuses cached live dashboard service");
  assert(!needsAttention.includes("computeComplianceScore"), "needs attention does not duplicate compliance formula");
  assert(liveDashboard.includes("export function computeComplianceScore"), "compliance formula remains in shared live-dashboard");

  // 4. Today's work from real assigned data
  assert(todaysWork.includes("buildDashboardToDoItems"), "today's work uses assigned-check todo builder");

  // 5. Non-hideable core cards in preference catalogs
  assert(cardDefinitions.includes('id: "needs-attention"') && cardDefinitions.includes("hideable: false"), "needs attention catalog non-hideable");
  assert(cardDefinitions.includes('id: "todays-work"') && cardDefinitions.includes("hideable: false"), "today's work catalog non-hideable");

  // 6. Navigation refresh
  assert(navPresentation.includes('dashboard: "Home"'), "nav presentation maps dashboard to Home");
  assert(navPresentation.includes('sync: "Sync Centre"'), "nav presentation friendly sync label");
  assert(roleNavigation.includes('label: "Audits"'), "role navigation uses Audits label");
  assert(roleNavigation.includes('label: "Equipment"'), "role navigation uses Equipment label");
  assert(app.includes("groupPresentedNav"), "App sidebar uses grouped navigation");

  // 7. Duplicate live dashboard panel removed from App shell
  assert(!app.includes("<LiveOperationalDashboard"), "App no longer mounts separate LiveOperationalDashboard blocks");

  // 8. Section-level retry / progressive loading
  assert(unified.includes("Try again"), "sections expose local retry");
  assert(unified.includes("live.loading"), "live section progressive loading");

  // 9. Recent activity aggregation
  assert(recent.includes("buildRecentActivityFromHistory"), "recent activity aggregates history entries");

  // 10. Tablet touch targets
  assert(unified.includes("min-h-[44px]"), "dashboard actions meet tablet touch target");

  console.log(`\nverify:dashboard-ui passed (${caseCount} checks).`);
}

main();
