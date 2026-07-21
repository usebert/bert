import type { NcrListItem } from "../types";
import { NcrStatusBadge } from "./NcrStatusBadge";

export function NcrList({
  items,
  selectedId,
  onSelect,
}: {
  items: NcrListItem[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          className={`grid min-h-[3rem] grid-cols-2 gap-2 rounded-xl border px-3 py-2 text-left sm:grid-cols-6 ${
            selectedId === item.id ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"
          }`}
        >
          <p className="text-xs font-semibold text-slate-900">{item.reference}</p>
          <p className="hidden text-xs text-slate-600 sm:block">{item.site}</p>
          <p className="hidden text-xs text-slate-600 sm:block">{item.owner}</p>
          <p className="hidden text-xs text-slate-600 sm:block">{item.dateRaised}</p>
          <NcrStatusBadge status={item.status} />
          <p className="text-xs text-slate-600">{item.correctiveActionStatus}</p>
        </button>
      ))}
    </div>
  );
}
