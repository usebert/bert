/**
 * Parse, validate, and persist dashboard layout preferences.
 * Corrupt or unknown data always falls back to the catalog default.
 */

import {
  defaultOrderForCatalog,
  getDashboardCardCatalog,
  hideableCardIds,
} from "./cardDefinitions";
import {
  DASHBOARD_LAYOUT_PREFS_VERSION,
  type DashboardLayoutCatalogId,
  type DashboardLayoutPreferences,
} from "./types";

export function buildDashboardLayoutStorageKey(input: {
  catalogId: DashboardLayoutCatalogId;
  companyFolderId: string;
  userIdentity: string;
}): string {
  const company = String(input.companyFolderId || "").trim() || "unknown-company";
  const user = String(input.userIdentity || "").trim().toLowerCase() || "unknown-user";
  return `bert:dashboard-layout:${input.catalogId}:${company}:${user}`;
}

export function defaultDashboardLayoutPreferences(
  catalogId: DashboardLayoutCatalogId,
): DashboardLayoutPreferences {
  return {
    version: DASHBOARD_LAYOUT_PREFS_VERSION,
    order: defaultOrderForCatalog(catalogId),
    hidden: [],
  };
}

function dedupeIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of ids) {
    const id = String(raw || "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
 * Merge saved prefs with the current catalog:
 * - drop unknown IDs
 * - append new cards missing from saved order
 * - strip non-hideable cards from hidden
 * - dedupe
 */
export function normalizeDashboardLayoutPreferences(
  catalogId: DashboardLayoutCatalogId,
  raw: unknown,
): DashboardLayoutPreferences {
  const defaults = defaultDashboardLayoutPreferences(catalogId);
  const knownIds = new Set(getDashboardCardCatalog(catalogId).map((card) => card.id));
  const hideable = hideableCardIds(catalogId);

  if (!raw || typeof raw !== "object") {
    return defaults;
  }

  const candidate = raw as Partial<DashboardLayoutPreferences>;
  if (candidate.version !== DASHBOARD_LAYOUT_PREFS_VERSION) {
    return defaults;
  }
  if (!Array.isArray(candidate.order) || !Array.isArray(candidate.hidden)) {
    return defaults;
  }

  const savedOrder = dedupeIds(candidate.order.map((id) => String(id))).filter((id) => knownIds.has(id));
  const missing = defaults.order.filter((id) => !savedOrder.includes(id));
  const order = [...savedOrder, ...missing];

  const hidden = dedupeIds(candidate.hidden.map((id) => String(id))).filter(
    (id) => knownIds.has(id) && hideable.has(id),
  );

  return {
    version: DASHBOARD_LAYOUT_PREFS_VERSION,
    order,
    hidden,
  };
}

export function parseDashboardLayoutPreferencesJson(
  catalogId: DashboardLayoutCatalogId,
  json: string | null | undefined,
): DashboardLayoutPreferences {
  if (!json) {
    return defaultDashboardLayoutPreferences(catalogId);
  }
  try {
    return normalizeDashboardLayoutPreferences(catalogId, JSON.parse(json));
  } catch {
    return defaultDashboardLayoutPreferences(catalogId);
  }
}

export function visibleDashboardCardIds(prefs: DashboardLayoutPreferences): string[] {
  const hidden = new Set(prefs.hidden);
  return prefs.order.filter((id) => !hidden.has(id));
}

export function readDashboardLayoutPreferences(
  catalogId: DashboardLayoutCatalogId,
  companyFolderId: string,
  userIdentity: string,
  storage: Pick<Storage, "getItem"> = typeof window !== "undefined" ? window.localStorage : { getItem: () => null },
): DashboardLayoutPreferences {
  const key = buildDashboardLayoutStorageKey({ catalogId, companyFolderId, userIdentity });
  try {
    return parseDashboardLayoutPreferencesJson(catalogId, storage.getItem(key));
  } catch {
    return defaultDashboardLayoutPreferences(catalogId);
  }
}

export function writeDashboardLayoutPreferences(
  catalogId: DashboardLayoutCatalogId,
  companyFolderId: string,
  userIdentity: string,
  prefs: DashboardLayoutPreferences,
  storage: Pick<Storage, "setItem"> = typeof window !== "undefined" ? window.localStorage : { setItem: () => undefined },
): void {
  const key = buildDashboardLayoutStorageKey({ catalogId, companyFolderId, userIdentity });
  const normalized = normalizeDashboardLayoutPreferences(catalogId, prefs);
  try {
    storage.setItem(key, JSON.stringify(normalized));
  } catch {
    /* private mode / quota — ignore */
  }
}

export function clearDashboardLayoutPreferences(
  catalogId: DashboardLayoutCatalogId,
  companyFolderId: string,
  userIdentity: string,
  storage: Pick<Storage, "removeItem"> = typeof window !== "undefined"
    ? window.localStorage
    : { removeItem: () => undefined },
): void {
  const key = buildDashboardLayoutStorageKey({ catalogId, companyFolderId, userIdentity });
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function reorderDashboardCards(
  order: string[],
  activeId: string,
  overId: string,
): string[] {
  const next = [...order];
  const from = next.indexOf(activeId);
  const to = next.indexOf(overId);
  if (from < 0 || to < 0 || from === to) {
    return order;
  }
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}

export function hideDashboardCard(
  catalogId: DashboardLayoutCatalogId,
  prefs: DashboardLayoutPreferences,
  cardId: string,
): DashboardLayoutPreferences {
  const hideable = hideableCardIds(catalogId);
  if (!hideable.has(cardId)) {
    return prefs;
  }
  return normalizeDashboardLayoutPreferences(catalogId, {
    ...prefs,
    hidden: [...prefs.hidden, cardId],
  });
}

export function restoreDashboardCard(
  catalogId: DashboardLayoutCatalogId,
  prefs: DashboardLayoutPreferences,
  cardId: string,
): DashboardLayoutPreferences {
  return normalizeDashboardLayoutPreferences(catalogId, {
    ...prefs,
    hidden: prefs.hidden.filter((id) => id !== cardId),
  });
}
