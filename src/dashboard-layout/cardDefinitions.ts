import type { DashboardCardDefinition, DashboardLayoutCatalogId } from "./types";

/** Manager role home — unified core sections are always visible above this board. */
export const MANAGER_ROLE_DASHBOARD_CARDS: DashboardCardDefinition[] = [
  { id: "needs-attention", label: "Needs attention", defaultOrder: 0, hideable: false },
  { id: "todays-work", label: "Today's work", defaultOrder: 1, hideable: false },
  { id: "summary-metrics", label: "Summary metrics", defaultOrder: 1, hideable: true },
  { id: "open-actions", label: "Open actions", defaultOrder: 2, hideable: true },
  { id: "open-ncrs", label: "Open NCRs", defaultOrder: 3, hideable: true },
  { id: "loler-summary", label: "LOLER examinations", defaultOrder: 4, hideable: true },
  { id: "health-safety-summary", label: "Health & Safety", defaultOrder: 5, hideable: true },
  { id: "calendar-summary", label: "Calendar", defaultOrder: 6, hideable: true },
];

/** Auditor home — unified core sections are always visible above this board. */
export const AUDITOR_TASK_DASHBOARD_CARDS: DashboardCardDefinition[] = [
  { id: "needs-attention", label: "Needs attention", defaultOrder: 0, hideable: false },
  { id: "todays-work", label: "Today's work", defaultOrder: 1, hideable: false },
];

/** Company Admin home — unified core sections are always visible above this board. */
export const COMPANY_ADMIN_DASHBOARD_CARDS: DashboardCardDefinition[] = [
  { id: "needs-attention", label: "Needs attention", defaultOrder: 0, hideable: false },
  { id: "todays-work", label: "Today's work", defaultOrder: 1, hideable: false },
  { id: "next-steps", label: "Next steps", defaultOrder: 1, hideable: true },
  { id: "today-panel", label: "Today", defaultOrder: 2, hideable: true },
  { id: "qms-summary", label: "QMS readiness", defaultOrder: 3, hideable: true },
  { id: "loler-summary", label: "LOLER examinations", defaultOrder: 4, hideable: true },
  { id: "health-safety-summary", label: "Health & Safety", defaultOrder: 5, hideable: true },
  { id: "calendar-summary", label: "Calendar", defaultOrder: 6, hideable: true },
];

/** Live operations panel (Manager). Act today + current incidents stay unhideable. */
export const LIVE_OPERATIONS_DASHBOARD_CARDS: DashboardCardDefinition[] = [
  { id: "kpi-metrics", label: "KPI metrics", defaultOrder: 0, hideable: true },
  { id: "act-today", label: "Act today", defaultOrder: 1, hideable: false },
  { id: "compliance-score", label: "Compliance score", defaultOrder: 2, hideable: true },
  { id: "risk-by-area", label: "Risk by area", defaultOrder: 3, hideable: true },
  { id: "overdue-inspections", label: "Overdue inspections", defaultOrder: 4, hideable: true },
  { id: "outstanding-actions", label: "Outstanding actions", defaultOrder: 5, hideable: true },
  { id: "current-incidents", label: "Current incidents", defaultOrder: 6, hideable: false },
  { id: "briefings", label: "Briefings", defaultOrder: 7, hideable: true },
  { id: "sync-status", label: "Sync status", defaultOrder: 8, hideable: true },
];

const CATALOGS: Record<DashboardLayoutCatalogId, DashboardCardDefinition[]> = {
  "manager-role": MANAGER_ROLE_DASHBOARD_CARDS,
  "auditor-task": AUDITOR_TASK_DASHBOARD_CARDS,
  "company-admin": COMPANY_ADMIN_DASHBOARD_CARDS,
  "live-operations": LIVE_OPERATIONS_DASHBOARD_CARDS,
};

export function getDashboardCardCatalog(catalogId: DashboardLayoutCatalogId): DashboardCardDefinition[] {
  return CATALOGS[catalogId] ?? [];
}

export function defaultOrderForCatalog(catalogId: DashboardLayoutCatalogId): string[] {
  return [...getDashboardCardCatalog(catalogId)]
    .sort((a, b) => a.defaultOrder - b.defaultOrder)
    .map((card) => card.id);
}

export function hideableCardIds(catalogId: DashboardLayoutCatalogId): Set<string> {
  return new Set(getDashboardCardCatalog(catalogId).filter((card) => card.hideable).map((card) => card.id));
}

export function cardLabel(catalogId: DashboardLayoutCatalogId, cardId: string): string {
  return getDashboardCardCatalog(catalogId).find((card) => card.id === cardId)?.label || cardId;
}
