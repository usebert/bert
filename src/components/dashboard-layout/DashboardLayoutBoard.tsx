import { useMemo, type ReactNode } from "react";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SortableDashboardCard } from "./SortableDashboardCard";
import { HiddenDashboardCards } from "./HiddenDashboardCards";
import { DashboardEditToolbar } from "./DashboardEditToolbar";
import { useDashboardLayoutPreferences } from "../../hooks/useDashboardLayoutPreferences";
import type { DashboardLayoutCatalogId } from "../../dashboard-layout/types";

type Props = {
  catalogId: DashboardLayoutCatalogId;
  companyFolderId: string;
  userIdentity: string;
  cards: Record<string, ReactNode | null | undefined>;
  /** Optional wrapper class for the card list. */
  listClassName?: string;
  /** When false, renders cards in default order with no edit UI (missing company/user). */
  enabled?: boolean;
};

/**
 * Renders a catalog of dashboard cards with optional per-user order/hide preferences.
 * Drag is handle-activated in edit mode only (PointerSensor distance + TouchSensor delay).
 */
export function DashboardLayoutBoard({
  catalogId,
  companyFolderId,
  userIdentity,
  cards,
  listClassName = "space-y-4",
  enabled = true,
}: Props) {
  const layout = useDashboardLayoutPreferences({
    catalogId,
    companyFolderId,
    userIdentity,
    enabled,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const orderedVisible = useMemo(() => {
    return layout.visibleCardIds.filter((id) => cards[id] != null);
  }, [layout.visibleCardIds, cards]);

  const onDragEnd = (event: DragEndEvent) => {
    if (!layout.editMode) {
      return;
    }
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    layout.reorder(String(active.id), String(over.id));
  };

  const list = (
    <div className={listClassName}>
      {orderedVisible.map((id) => (
        <SortableDashboardCard
          key={id}
          id={id}
          editMode={layout.editMode}
          hideable={layout.isHideable(id)}
          onHide={() => layout.hideCard(id)}
        >
          {cards[id]}
        </SortableDashboardCard>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <DashboardEditToolbar
        editMode={layout.editMode}
        hiddenCount={layout.hiddenCards.length}
        showHiddenPanel={layout.showHiddenPanel}
        onEdit={layout.enterEditMode}
        onDone={layout.exitEditMode}
        onReset={layout.resetLayout}
        onToggleHidden={() => layout.setShowHiddenPanel((open) => !open)}
        disabled={!layout.layoutEnabled}
      />
      <HiddenDashboardCards
        open={layout.editMode && layout.showHiddenPanel}
        cards={layout.hiddenCards}
        onRestore={layout.restoreCard}
      />
      {layout.editMode ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={orderedVisible} strategy={verticalListSortingStrategy}>
            {list}
          </SortableContext>
        </DndContext>
      ) : (
        list
      )}
    </div>
  );
}
