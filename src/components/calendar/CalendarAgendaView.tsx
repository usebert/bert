import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
        {t("calendar.noItems")}
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
