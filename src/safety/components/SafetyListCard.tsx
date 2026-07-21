import type { SafetyListItem } from "../types";
import { SafetyStatusBadge } from "./SafetyStatusBadge";

type Props = {
  item: SafetyListItem;
  onSelect: (id: string) => void;
  onInvestigate?: (id: string, startInvestigation: boolean) => void;
  showInvestigate?: boolean;
};

export function SafetyListCard({ item, onSelect, onInvestigate, showInvestigate }: Props) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(item.id)}
        className="w-full min-h-[4.75rem] rounded-[var(--ui-radius-md)] border border-[var(--ui-border)] bg-[var(--ui-bg-surface)] p-4 text-left shadow-[var(--ui-shadow-sm)] transition hover:border-slate-300"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{item.reference}</p>
            <p className="mt-0.5 line-clamp-2 text-sm font-semibold text-slate-900">{item.title}</p>
            <p className="mt-1 text-xs text-slate-600">
              {item.type} · {item.site}
              {item.area ? ` / ${item.area}` : ""}
            </p>
          </div>
          <SafetyStatusBadge status={item.status} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>{item.dateReported}</span>
          <span>{item.severity}</span>
          <span>{item.actionsRaised} action(s)</span>
        </div>
        {showInvestigate && onInvestigate && item.raw.status !== "Closed" ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onInvestigate(item.id, item.raw.status === "Open");
            }}
            className="bert-btn-interactive mt-3 min-h-[2.75rem] rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
          >
            {item.raw.status === "Open" ? "Start investigation" : "Continue"}
          </button>
        ) : null}
      </button>
    </li>
  );
}
