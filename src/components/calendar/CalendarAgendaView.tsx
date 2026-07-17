import type { CalendarItem } from "../../types/calendar";
import { CalendarItemDetails } from "./CalendarItemDetails";

type Props = {
  items: CalendarItem[];
  canManage: boolean;
  userEmail: string;
  saving: boolean;
  onEdit: (item: CalendarItem) => void;
  onComplete: (item: CalendarItem) => void;
  onArchive: (item: CalendarItem) => void;
};

export function CalendarAgendaView({ items, canManage, userEmail, saving, onEdit, onComplete, onArchive }: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
        No calendar items match the current filters.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <CalendarItemDetails
          key={item.id}
          item={item}
          canManage={canManage}
          userEmail={userEmail}
          saving={saving}
          onEdit={onEdit}
          onComplete={onComplete}
          onArchive={onArchive}
        />
      ))}
    </div>
  );
}
