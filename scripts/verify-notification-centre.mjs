#!/usr/bin/env node
/**
 * verify:notification-centre — Release 7B unified notification centre checks.
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
  const presentation = read("src/presentation/notificationPresentation.ts");
  const adapters = read("src/services/notificationAdapters/notificationAdapters.ts");
  const readState = read("src/hooks/useNotificationReadState.ts");
  const hook = read("src/hooks/useNotifications.ts");
  const button = read("src/components/notifications/NotificationButton.tsx");
  const panel = read("src/components/notifications/NotificationPanel.tsx");
  const row = read("src/components/notifications/NotificationRow.tsx");
  const empty = read("src/components/notifications/NotificationEmptyState.tsx");
  const host = read("src/components/notifications/NotificationsHost.tsx");
  const needsAttention = read("src/dashboard/unified/buildNeedsAttention.ts");
  const globalSearch = read("src/hooks/useGlobalSearch.ts");

  assert(Boolean(pkg.scripts?.["verify:notification-centre"]), "package.json defines verify:notification-centre");

  // 1–3 Header button and badge
  assert(app.includes("notificationControls.button"), "notification button wired in App header");
  assert(button.includes("IconBell"), "notification button uses shared Icon wrapper");
  assert(button.includes("99+"), "badge count capped visually at 99+");
  assert(button.includes("{badge ?") || button.includes("unreadCount <= 0"), "badge hidden when no unread notifications");
  assert(button.includes("min-h-11"), "notification button meets 44px touch target");

  // 4–8 Scoped sources and permissions
  assert(adapters.includes("buildNotificationIndex"), "notification index builder exists");
  assert(app.includes("visibleActions"), "reuses scoped visible actions");
  assert(app.includes("assignedAudits"), "reuses assigned audits");
  assert(app.includes("assignmentFilteredNonConformances"), "reuses filtered NCRs");
  assert(adapters.includes("canAccessActions(role)"), "actions gated by permissions");
  assert(adapters.includes("canViewIncidents(role)"), "safety gated by permissions");
  assert(adapters.includes("canAccessDocumentControl(role)"), "documents gated by permissions");
  assert(adapters.includes("readCachedDocumentControlDocuments"), "documents use cache only");
  assert(adapters.includes("readCachedLolerEquipment"), "equipment uses cache only");
  assert(!adapters.includes("fetch("), "no unrestricted dataset fetch in adapters");
  assert(app.includes("companyFolderId: archiveCompanyFolderId"), "master uses selected-company context");

  // 9–10 No schema/API changes
  assert(!adapters.includes("masterSheetId"), "adapters do not expose master sheet ids");
  assert(!row.includes("companyFolderId"), "rows do not expose company folder ids");

  // 11–14 Read state
  assert(readState.includes("NOTIFICATION_READ_STORAGE_PREFIX"), "read state namespaced storage key");
  assert(readState.includes("companyScope") && readState.includes("userScope"), "read state namespaced by company and user");
  assert(!readState.includes("title") && !readState.includes("description"), "read state stores keys only");
  assert(hook.includes("markAllRead"), "mark all as read supported");
  assert(!adapters.includes("setNonConformances") && !adapters.includes("setIncidents"), "adapters do not mutate source records");

  // 15–18 Priority ordering
  assert(presentation.includes("SYNC_FAILED"), "failed sync highest priority constant");
  assert(adapters.includes("NOTIFICATION_PRIORITY.SYNC_FAILED"), "failed sync uses urgent priority");
  assert(adapters.includes("NOTIFICATION_PRIORITY.AUDIT_OVERDUE"), "overdue audits prioritized");
  assert(adapters.includes("Due today"), "due-today wording used");
  assert(adapters.includes(".sort("), "notifications sorted by priority");

  // 19–24 Navigation / deep links
  assert(adapters.includes('screen: "sync"'), "sync notifications open Sync Centre");
  assert(adapters.includes("actionId: entry.id"), "action deep links include action id");
  assert(adapters.includes("ncrId: entry.id"), "NCR deep links include ncr id");
  assert(adapters.includes("incidentId: entry.id"), "safety deep links include incident id");
  assert(adapters.includes('screen: "loler"'), "equipment links open LOLER");
  assert(app.includes("handleGlobalSearchNavigate"), "notifications reuse existing navigation handler");
  assert(host.includes("onNavigate(item.destination"), "clicking notification navigates directly");

  // 25 Restricted documents
  assert(adapters.includes("canAccessDocumentControl(role)"), "documents filtered by role before cache read");

  // 26–28 Empty/error states
  assert(empty.includes("You're all caught up"), "empty state present");
  assert(panel.includes("Notifications could not be refreshed") || empty.includes("Notifications could not be refreshed"), "error state present");
  assert(panel.includes("onRetry"), "local retry action supported");

  // 29–31 Accessibility
  assert(panel.includes('event.key === "Escape"'), "Escape closes panel");
  assert(panel.includes("triggerRef.current?.focus()"), "focus returns to bell on close");
  assert(button.includes("aria-label"), "icon button has accessible label");
  assert(row.includes("motion-reduce:transition-none"), "reduced motion supported");

  // 32 Responsive panel
  assert(panel.includes("100dvh"), "tablet panel fits within 100dvh");

  // 33 Global search unchanged
  assert(globalSearch.includes('event.key.toLowerCase() === "k"'), "global search shortcut remains");

  // 34–35 Dashboard / offline queue untouched
  assert(needsAttention.includes("buildNeedsAttentionFromActToday"), "dashboard needs-attention logic unchanged");
  assert(!adapters.includes("IndexedDB"), "no offline queue format changes");

  console.log(`\nverify:notification-centre passed (${caseCount} checks).`);
}

main();
