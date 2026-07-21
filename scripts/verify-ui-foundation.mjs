#!/usr/bin/env node
/**
 * verify:ui-foundation — BERT UI design system Release 1 checks.
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
  const indexCss = read("src/index.css");
  const tokensCss = read("src/styles/design-tokens.css");
  const uiFoundation = read("src/styles/ui-foundation.ts");
  const uiIndex = read("src/components/ui/index.ts");
  const button = read("src/components/ui/Button.tsx");
  const card = read("src/components/ui/Card.tsx");
  const form = read("src/components/ui/FormField.tsx");
  const badge = read("src/components/ui/StatusBadge.tsx");
  const pageLayout = read("src/components/ui/PageLayout.tsx");
  const dialog = read("src/components/ui/Dialog.tsx");
  const loading = read("src/components/ui/LoadingStates.tsx");
  const showcase = read("src/screens/UiFoundationShowcase.tsx");
  const app = read("App.tsx");
  const nav = read("src/types/navigation.ts");
  const primitives = read("src/components/dashboard/DashboardPrimitives.tsx");
  const createCompany = read("src/components/godmode/GodmodeCreateCompanyPanel.tsx");
  const addDocument = read("src/components/documents/AddDocumentDialog.tsx");

  assert(Boolean(pkg.scripts?.["verify:ui-foundation"]), "package.json defines verify:ui-foundation");
  assert(indexCss.includes('import "./styles/design-tokens.css"'), "index.css imports design tokens");

  // 1. Semantic tokens
  assert(tokensCss.includes("--ui-bg-app"), "app background token");
  assert(tokensCss.includes("--ui-bg-surface"), "surface token");
  assert(tokensCss.includes("--ui-text-primary"), "primary text token");
  assert(tokensCss.includes("--ui-accent"), "brand orange token");
  assert(tokensCss.includes("--ui-success-fg"), "success status token");
  assert(tokensCss.includes("--ui-radius-sm"), "radius token");
  assert(tokensCss.includes("--ui-control-height"), "control height token");
  assert(tokensCss.includes("--ui-z-dialog"), "dialog z-index token");
  assert(tokensCss.includes("prefers-reduced-motion"), "reduced-motion styles");

  // 2. Button variants
  assert(button.includes('"primary"'), "Button primary variant");
  assert(button.includes('"secondary"'), "Button secondary variant");
  assert(button.includes('"outline"'), "Button outline variant");
  assert(button.includes('"ghost"'), "Button ghost variant");
  assert(button.includes('"danger"'), "Button danger variant");
  assert(button.includes("loading"), "Button loading state");
  assert(button.includes("min-h-[var(--ui-control-height)]"), "Button touch-friendly height");

  // 3. Card primitives
  assert(card.includes("export function Card"), "Card component");
  assert(card.includes("CardHeader"), "CardHeader");
  assert(card.includes("CardFooter"), "CardFooter");
  assert(card.includes("interactive"), "Card interactive variant");

  // 4. Form field primitives
  assert(form.includes("export function FormField"), "FormField wrapper");
  assert(form.includes("export function Input"), "Input control");
  assert(form.includes("export function Select"), "Select control");
  assert(form.includes("export function Checkbox"), "Checkbox control");
  assert(form.includes("SearchInput"), "Search input");

  // 5. StatusBadge variants
  assert(badge.includes('"success"'), "StatusBadge success");
  assert(badge.includes('"warning"'), "StatusBadge warning");
  assert(badge.includes('"danger"'), "StatusBadge danger");
  assert(badge.includes("statusToBadgeVariant"), "BERT status mapping helper");

  // 6. Page layout primitives
  assert(pageLayout.includes("PageContainer"), "PageContainer");
  assert(pageLayout.includes("PageHeader"), "PageHeader");
  assert(pageLayout.includes("Toolbar"), "Toolbar");

  // 7–8. Dialog portal + viewport-safe body
  assert(dialog.includes("createPortal"), "Dialog uses portal");
  assert(dialog.includes("document.body"), "Dialog portals to document.body");
  assert(dialog.includes("100dvh"), "Dialog viewport-safe max height");
  assert(dialog.includes("overflow-y-auto"), "Dialog scrollable body");
  assert(dialog.includes("lockDialogScroll"), "Dialog scroll lock");

  // 9. Loading + empty states
  assert(loading.includes("Skeleton"), "Skeleton component");
  assert(loading.includes("EmptyState"), "EmptyState component");
  assert(loading.includes("InlineLoading"), "InlineLoading component");

  // 10. Reduced motion (css)
  assert(tokensCss.includes("@media (prefers-reduced-motion: reduce)"), "foundation reduced-motion block");

  // 11. No unnecessary API/business logic changes
  assert(!read("server/server.mjs").includes("ui-foundation"), "server routes unchanged");
  assert(!read("src/services/godmodeService.ts").includes("ui-foundation"), "godmode service unchanged");

  // 12. Navigation + permissions intact
  assert(nav.includes('"uiFoundation"'), "uiFoundation routed screen exists");
  assert(nav.includes("Exclude<RoutedScreen"), "NavItemId excludes showcase route");
  assert(!read("src/config/navItems.ts").includes("uiFoundation"), "showcase not in sidebar nav");
  assert(app.includes('screen === "uiFoundation" && isDebugUiAllowed()'), "showcase gated to debug UI");

  // Showcase + safe adoption
  assert(showcase.includes("UiFoundationShowcase"), "showcase screen exists");
  assert(primitives.includes("EmptyState"), "EmptyPanel delegates to EmptyState");
  assert(createCompany.includes("FormField"), "create company uses FormField");
  assert(createCompany.includes("Button"), "create company uses shared Button");
  assert(createCompany.includes("PageHeader"), "create company uses PageHeader");
  assert(uiIndex.includes("export { Button"), "ui barrel exports Button");

  // Add Document modal left intact (not migrated)
  assert(addDocument.includes("createPortal"), "Add Document dialog still portal-based");
  assert(addDocument.includes("document.body"), "Add Document still targets body");
  assert(!addDocument.includes('from "../ui/Dialog"'), "Add Document not forced onto shared Dialog yet");

  assert(uiFoundation.includes("controlBase"), "shared control classes exported");

  console.log(`\nverify:ui-foundation passed (${caseCount} checks)`);
}

main();
