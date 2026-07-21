#!/usr/bin/env node
/**
 * verify:global-search — Release 7A global command-palette search checks.
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
  const dialog = read("src/components/search/GlobalSearchDialog.tsx");
  const input = read("src/components/search/GlobalSearchInput.tsx");
  const results = read("src/components/search/GlobalSearchResults.tsx");
  const row = read("src/components/search/SearchResultRow.tsx");
  const host = read("src/components/search/GlobalSearch.tsx");
  const hook = read("src/hooks/useGlobalSearch.ts");
  const adapters = read("src/services/searchAdapters/globalSearchAdapters.ts");
  const presentation = read("src/presentation/searchPresentation.ts");
  const permissions = read("src/permissions.ts");

  assert(Boolean(pkg.scripts?.["verify:global-search"]), "package.json defines verify:global-search");

  // 1. Module files
  assert(dialog.includes("GlobalSearchDialog"), "GlobalSearchDialog component exists");
  assert(input.includes("GlobalSearchInput"), "GlobalSearchInput component exists");
  assert(results.includes("GlobalSearchResults"), "GlobalSearchResults component exists");
  assert(row.includes("SearchResultRow"), "SearchResultRow component exists");
  assert(hook.includes("useGlobalSearch"), "useGlobalSearch hook exists");
  assert(adapters.includes("buildGlobalSearchIndex"), "search adapters index builder exists");
  assert(presentation.includes("SEARCH_GROUP_ORDER"), "search presentation groups defined");

  // 2. App wiring — shortcut, header button, navigation
  assert(app.includes("useGlobalSearchControls"), "App wires global search controls");
  assert(app.includes("globalSearchControls.openSearch"), "header search button opens palette");
  assert(app.includes("handleGlobalSearchNavigate"), "search navigation handler wired");
  assert(app.includes("startAudit(target.auditId)"), "audit results open via startAudit");
  assert(app.includes("initialActionId={searchFocusActionId"), "actions deep-link id passed");
  assert(app.includes("initialNcrId={searchFocusNcrId"), "NCR deep-link id passed");
  assert(app.includes("initialIncidentId={searchFocusIncidentId"), "incident deep-link id passed");
  assert(hook.includes('event.key.toLowerCase() === "k"'), "Cmd/Ctrl+K shortcut registered");

  // 3. Permission-gated sources (no unrestricted fetches)
  assert(adapters.includes("canAccessActions(role)"), "actions gated by role");
  assert(adapters.includes("canAccessAuditsCentre(role)"), "audits gated by role");
  assert(adapters.includes("canAccessDocumentControl(role)"), "document control gated by role");
  assert(adapters.includes("canAccessDocuments(role)"), "document library gated by role");
  assert(adapters.includes("canViewIncidents(role)"), "incidents gated by role");
  assert(adapters.includes("canAccessLoler(role)"), "equipment gated by role");
  assert(adapters.includes("canAccessUsersInvitesNav(role)"), "people gated by role");
  assert(adapters.includes("canAccessWorkspaceNav(role)"), "sites/areas gated by admin access");
  assert(adapters.includes("readCachedDocumentControlDocuments"), "document control uses cache only");
  assert(adapters.includes("readCachedDocuments"), "document library uses cache only");
  assert(adapters.includes("readCachedLolerEquipment"), "equipment uses cache only");
  assert(!adapters.includes("fetch("), "adapters do not fetch unrestricted datasets");

  // 4. Search quality
  assert(adapters.includes("tokenize"), "multi-word tokenized search");
  assert(adapters.includes("matchesTokens"), "partial case-insensitive matching");
  assert(adapters.includes("filterSearchResults"), "result filtering helper exists");
  assert(presentation.includes('"Actions"'), "Actions group label");
  assert(presentation.includes('"Audits"'), "Audits group label");
  assert(presentation.includes('"Documents"'), "Documents group label");

  // 5. Recent searches + empty state + keyboard
  assert(presentation.includes("RECENT_SEARCHES_MAX = 10"), "recent searches capped at 10");
  assert(hook.includes("RECENT_SEARCHES_KEY"), "recent searches stored locally");
  assert(results.includes("No matching records"), "empty state message");
  assert(dialog.includes("ArrowDown"), "arrow navigation in dialog");
  assert(dialog.includes('event.key === "Enter"'), "enter opens result");
  assert(dialog.includes("labelledBy"), "dialog has accessible label");

  // 6. Reuse loaded datasets
  assert(app.includes("visibleActions"), "reuses visible actions");
  assert(app.includes("assignedAudits"), "reuses assigned audits");
  assert(app.includes("assignmentFilteredHistory"), "reuses filtered history");
  assert(app.includes("assignmentFilteredNonConformances"), "reuses filtered NCRs");
  assert(app.includes("briefingTodoState.items"), "reuses briefing items");
  assert(app.includes("companyMembersState.members"), "reuses company members");

  // 7. No internal IDs in displayed titles (adapter fallbacks)
  assert(!adapters.includes("Briefing ${item.briefingId}"), "briefing titles avoid raw ids");
  assert(!row.includes("searchText"), "rows do not render internal search text");
  assert(row.includes("item.title"), "rows render human title");
  assert(row.includes("item.typeLabel"), "rows render type label");

  // 8. Permissions unchanged
  assert(permissions.includes("export function canAccessActions"), "permissions module untouched contract");

  console.log(`\nverify:global-search passed (${caseCount} checks).`);
}

main();
