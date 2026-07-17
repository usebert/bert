import { useMemo } from "react";
import type { CalendarItem } from "../../types/calendar";
import { buildCalendarMonthCells, calendarMonthLabel } from "./calendarPresentation";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Props = {
  cursorYear: number;
  cursorMonth: number;
  itemsByDate: Map<string, CalendarItem[]>;
  selectedDateKey: string;
  onShiftMonth: (delta: number) => void;
  onSelectDate: (dateKey: string) => void;
  onCreateAt: (dateKey: string) => void;
};

export function CalendarMonthView({
  cursorYear,
  cursorMonth,
  itemsByDate,
  selectedDateKey,
  onShiftMonth,
  onSelectDate,
  onCreateAt,
}: Props) {
  const monthCells = useMemo(() => buildCalendarMonthCells(cursorYear, cursorMonth), [cursorYear, cursorMonth]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          onClick={() => onShiftMonth(-1)}
        >
          Previous
        </button>
        <h2 className="text-base font-semibold text-slate-900">{calendarMonthLabel(cursorYear, cursorMonth)}</h2>
        <button
          type="button"
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          onClick={() => onShiftMonth(1)}
        >
          Next
        </button>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
        {WEEKDAYS.map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {monthCells.map((cell) => {
          const dayItems = itemsByDate.get(cell.dateKey) || [];
          const selected = selectedDateKey === cell.dateKey;
          return (
            <button
              key={cell.dateKey}
              type="button"
              className={`min-h-20 rounded-md border p-1 text-left ${
                cell.inMonth ? "border-slate-200 bg-white" : "border-transparent bg-slate-50 text-slate-400"
              } ${selected ? "ring-2 ring-slate-900" : ""}`}
              onClick={() => onSelectDate(cell.dateKey)}
              onDoubleClick={() => onCreateAt(cell.dateKey)}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">{cell.day}</span>
                {dayItems.length > 0 ? (
                  <span className="rounded-full bg-slate-900 px-1.5 text-[10px] text-white">{dayItems.length}</span>
                ) : null}
              </div>
              <div className="mt-1 space-y-0.5">
                {dayItems.slice(0, 2).map((item) => (
                  <div
                    key={item.id}
                    className={`truncate rounded px-1 text-[10px] ${
                      item.itemType === "reminder" ? "bg-amber-50 text-amber-900" : "bg-sky-50 text-sky-900"
                    }`}
                  >
                    {item.title}
                  </div>
                ))}
                {dayItems.length > 2 ? (
                  <div className="text-[10px] text-slate-500">+{dayItems.length - 2} more</div>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
