import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearDashboardLayoutPreferences,
  defaultDashboardLayoutPreferences,
  hideDashboardCard,
  readDashboardLayoutPreferences,
  reorderDashboardCards,
  restoreDashboardCard,
  visibleDashboardCardIds,
  writeDashboardLayoutPreferences,
} from "../dashboard-layout/preferences";
import { cardLabel, getDashboardCardCatalog } from "../dashboard-layout/cardDefinitions";
import type { DashboardLayoutCatalogId, DashboardLayoutPreferences } from "../dashboard-layout/types";

type Options = {
  catalogId: DashboardLayoutCatalogId;
  companyFolderId: string;
  userIdentity: string;
  enabled?: boolean;
};

export function useDashboardLayoutPreferences({
  catalogId,
  companyFolderId,
  userIdentity,
  enabled = true,
}: Options) {
  const scoped = Boolean(enabled && companyFolderId.trim() && userIdentity.trim());
  const [editMode, setEditMode] = useState(false);
  const [showHiddenPanel, setShowHiddenPanel] = useState(false);
  const [prefs, setPrefs] = useState<DashboardLayoutPreferences>(() =>
    scoped
      ? readDashboardLayoutPreferences(catalogId, companyFolderId, userIdentity)
      : defaultDashboardLayoutPreferences(catalogId),
  );

  useEffect(() => {
    if (!scoped) {
      setPrefs(defaultDashboardLayoutPreferences(catalogId));
      setEditMode(false);
      setShowHiddenPanel(false);
      return;
    }
    setPrefs(readDashboardLayoutPreferences(catalogId, companyFolderId, userIdentity));
  }, [catalogId, companyFolderId, userIdentity, scoped]);

  const persist = useCallback(
    (next: DashboardLayoutPreferences) => {
      setPrefs(next);
      if (scoped) {
        writeDashboardLayoutPreferences(catalogId, companyFolderId, userIdentity, next);
      }
    },
    [catalogId, companyFolderId, userIdentity, scoped],
  );

  const visibleCardIds = useMemo(() => visibleDashboardCardIds(prefs), [prefs]);

  const hiddenCards = useMemo(
    () =>
      prefs.hidden.map((id) => ({
        id,
        label: cardLabel(catalogId, id),
      })),
    [prefs.hidden, catalogId],
  );

  const catalog = useMemo(() => getDashboardCardCatalog(catalogId), [catalogId]);

  const enterEditMode = useCallback(() => {
    setEditMode(true);
  }, []);

  const exitEditMode = useCallback(() => {
    setEditMode(false);
    setShowHiddenPanel(false);
    if (scoped) {
      writeDashboardLayoutPreferences(catalogId, companyFolderId, userIdentity, prefs);
    }
  }, [catalogId, companyFolderId, userIdentity, prefs, scoped]);

  const resetLayout = useCallback(() => {
    const defaults = defaultDashboardLayoutPreferences(catalogId);
    setPrefs(defaults);
    if (scoped) {
      clearDashboardLayoutPreferences(catalogId, companyFolderId, userIdentity);
    }
    setShowHiddenPanel(false);
  }, [catalogId, companyFolderId, userIdentity, scoped]);

  const reorder = useCallback(
    (activeId: string, overId: string) => {
      if (!editMode) {
        return;
      }
      persist({
        ...prefs,
        order: reorderDashboardCards(prefs.order, activeId, overId),
      });
    },
    [editMode, prefs, persist],
  );

  const hideCard = useCallback(
    (cardId: string) => {
      if (!editMode) {
        return;
      }
      persist(hideDashboardCard(catalogId, prefs, cardId));
    },
    [editMode, catalogId, prefs, persist],
  );

  const restoreCard = useCallback(
    (cardId: string) => {
      persist(restoreDashboardCard(catalogId, prefs, cardId));
    },
    [catalogId, prefs, persist],
  );

  const isHideable = useCallback(
    (cardId: string) => catalog.find((card) => card.id === cardId)?.hideable === true,
    [catalog],
  );

  return {
    editMode,
    showHiddenPanel,
    setShowHiddenPanel,
    prefs,
    visibleCardIds,
    hiddenCards,
    enterEditMode,
    exitEditMode,
    resetLayout,
    reorder,
    hideCard,
    restoreCard,
    isHideable,
    layoutEnabled: scoped,
  };
}
