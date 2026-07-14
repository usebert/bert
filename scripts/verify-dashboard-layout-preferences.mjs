#!/usr/bin/env node
/**
 * Verify dashboard layout preference parsing, isolation, and catalog rules.
 * No auth/backend files involved.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;

function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`[verify:dashboard-layout-preferences] FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
}

const prefsUrl = pathToFileURL(path.join(root, "src/dashboard-layout/preferences.ts")).href;
// preferences.ts is TypeScript — load compiled via node? Project has no ts-node.
// Re-implement verification against the source text + a small ESM copy of logic by dynamic import of .mjs shim.

async function main() {
  // Import via vite-node unavailable; duplicate-import through tsx not installed.
  // Compile-free: use Node with strip? Prefer rewriting prefs as .mjs for shared verify — keep TS as source of truth
  // and assert via a thin JS mirror by evaluating using `tsc` output isn't ready.
  // Instead: run assertions against exported API by spawning `npx tsc` is heavy.
  // Load TypeScript via dynamic transpile with typescript package (devDependency).
  const ts = await import("typescript");
  const source = fs.readFileSync(path.join(root, "src/dashboard-layout/preferences.ts"), "utf8");
  const cardsSource = fs.readFileSync(path.join(root, "src/dashboard-layout/cardDefinitions.ts"), "utf8");
  const typesSource = fs.readFileSync(path.join(root, "src/dashboard-layout/types.ts"), "utf8");
  const transpile = (code) =>
    ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;

  const tmpDir = path.join(root, ".tmp-dashboard-layout-verify");
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "types.mjs"), transpile(typesSource));
  fs.writeFileSync(
    path.join(tmpDir, "cardDefinitions.mjs"),
    transpile(cardsSource).replaceAll("./types", "./types.mjs"),
  );
  fs.writeFileSync(
    path.join(tmpDir, "preferences.mjs"),
    transpile(source).replaceAll("./cardDefinitions", "./cardDefinitions.mjs").replaceAll("./types", "./types.mjs"),
  );

  const {
    parseDashboardLayoutPreferencesJson,
    normalizeDashboardLayoutPreferences,
    defaultDashboardLayoutPreferences,
    buildDashboardLayoutStorageKey,
    visibleDashboardCardIds,
    reorderDashboardCards,
    hideDashboardCard,
    restoreDashboardCard,
    writeDashboardLayoutPreferences,
    readDashboardLayoutPreferences,
    clearDashboardLayoutPreferences,
  } = await import(pathToFileURL(path.join(tmpDir, "preferences.mjs")).href);

  const catalogId = "manager-role";
  const defaults = defaultDashboardLayoutPreferences(catalogId);

  // 1. Default when no prefs
  assert(defaults.order.includes("things-to-do"), "default includes things-to-do");
  assert(defaults.hidden.length === 0, "default has no hidden cards");
  assert(visibleDashboardCardIds(defaults).join(",") === defaults.order.join(","), "all default cards visible");

  // 2. Saved order applied
  const reordered = normalizeDashboardLayoutPreferences(catalogId, {
    version: 1,
    order: ["open-ncrs", "things-to-do", "summary-metrics", "open-actions"],
    hidden: [],
  });
  assert(reordered.order[0] === "open-ncrs", "saved order applied");

  // 3. Hidden excluded in normal mode
  const withHidden = normalizeDashboardLayoutPreferences(catalogId, {
    version: 1,
    order: defaults.order,
    hidden: ["open-actions"],
  });
  assert(!visibleDashboardCardIds(withHidden).includes("open-actions"), "hidden cards excluded");
  assert(visibleDashboardCardIds(withHidden).includes("things-to-do"), "essential card still visible");

  // 4. Restore
  const restored = restoreDashboardCard(catalogId, withHidden, "open-actions");
  assert(visibleDashboardCardIds(restored).includes("open-actions"), "restored card visible");

  // 5. Reset via clear + default
  const memory = new Map();
  const storage = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, v),
    removeItem: (k) => memory.delete(k),
  };
  writeDashboardLayoutPreferences(catalogId, "co1", "u1@x.com", withHidden, storage);
  clearDashboardLayoutPreferences(catalogId, "co1", "u1@x.com", storage);
  const afterReset = readDashboardLayoutPreferences(catalogId, "co1", "u1@x.com", storage);
  assert(afterReset.hidden.length === 0, "reset clears hidden");
  assert(afterReset.order.join(",") === defaults.order.join(","), "reset restores default order");

  // 6. Unknown IDs ignored
  const unknown = normalizeDashboardLayoutPreferences(catalogId, {
    version: 1,
    order: ["things-to-do", "not-a-real-card", "open-actions"],
    hidden: ["ghost"],
  });
  assert(!unknown.order.includes("not-a-real-card"), "unknown order id ignored");
  assert(!unknown.hidden.includes("ghost"), "unknown hidden id ignored");

  // 7. New cards appended
  const olderMissing = normalizeDashboardLayoutPreferences(catalogId, {
    version: 1,
    order: ["things-to-do"],
    hidden: [],
  });
  assert(olderMissing.order.includes("summary-metrics"), "missing catalog cards appended");
  assert(olderMissing.order.includes("open-ncrs"), "missing open-ncrs appended");

  // 8. Duplicates
  const dupes = normalizeDashboardLayoutPreferences(catalogId, {
    version: 1,
    order: ["things-to-do", "things-to-do", "open-actions", "open-actions"],
    hidden: ["summary-metrics", "summary-metrics"],
  });
  assert(dupes.order.filter((id) => id === "things-to-do").length === 1, "duplicate order removed");
  assert(dupes.hidden.filter((id) => id === "summary-metrics").length === 1, "duplicate hidden removed");

  // 9. Invalid JSON
  const invalid = parseDashboardLayoutPreferencesJson(catalogId, "{not-json");
  assert(invalid.order.join(",") === defaults.order.join(","), "invalid JSON falls back");

  // Unsupported version
  const badVersion = normalizeDashboardLayoutPreferences(catalogId, {
    version: 99,
    order: ["open-ncrs"],
    hidden: [],
  });
  assert(badVersion.order.join(",") === defaults.order.join(","), "unsupported version falls back");

  // Non-hideable cannot hide
  const cannotHide = hideDashboardCard(catalogId, defaults, "things-to-do");
  assert(!cannotHide.hidden.includes("things-to-do"), "non-hideable stays visible");

  // 10. Isolation by user/company
  const keyA = buildDashboardLayoutStorageKey({
    catalogId,
    companyFolderId: "company-a",
    userIdentity: "alice@example.com",
  });
  const keyB = buildDashboardLayoutStorageKey({
    catalogId,
    companyFolderId: "company-a",
    userIdentity: "bob@example.com",
  });
  const keyC = buildDashboardLayoutStorageKey({
    catalogId,
    companyFolderId: "company-b",
    userIdentity: "alice@example.com",
  });
  assert(keyA !== keyB, "users isolated");
  assert(keyA !== keyC, "companies isolated");
  assert(keyA.includes("bert:dashboard-layout:"), "namespaced key");

  writeDashboardLayoutPreferences(catalogId, "company-a", "alice@example.com", withHidden, storage);
  writeDashboardLayoutPreferences(
    catalogId,
    "company-a",
    "bob@example.com",
    defaults,
    storage,
  );
  const alice = readDashboardLayoutPreferences(catalogId, "company-a", "alice@example.com", storage);
  const bob = readDashboardLayoutPreferences(catalogId, "company-a", "bob@example.com", storage);
  assert(alice.hidden.includes("open-actions"), "alice prefs retained");
  assert(bob.hidden.length === 0, "bob unaffected");

  // 11. Reorder helper (drag result)
  const moved = reorderDashboardCards(["a", "b", "c"], "c", "a");
  assert(moved.join(",") === "c,a,b", "reorder moves active before over");

  // 12. Source isolation — no auth files changed expected by this feature exists as modules
  const board = fs.readFileSync(path.join(root, "src/components/dashboard-layout/DashboardLayoutBoard.tsx"), "utf8");
  assert(board.includes("activationConstraint"), "edit-mode drag sensors configured");
  assert(board.includes("editMode"), "edit mode gates drag");

  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert(pkg.dependencies["@dnd-kit/core"], "dnd-kit core installed");
  assert(pkg.dependencies["@dnd-kit/sortable"], "dnd-kit sortable installed");

  // Forbidden: preferences module must not import auth/server
  assert(!source.includes("auth-service"), "prefs does not import auth-service");
  assert(!source.includes("password"), "prefs does not mention password");

  console.log(`[verify:dashboard-layout-preferences] OK — ${caseCount} cases passed`);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
