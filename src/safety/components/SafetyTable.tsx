import { DataTable } from "../../components/ui/Table";
import type { SafetyListItem } from "../types";
import { SafetyStatusBadge } from "./SafetyStatusBadge";

type Props = {
  items: SafetyListItem[];
  onSelect: (id: string) => void;
  onInvestigate?: (id: string, startInvestigation: boolean) => void;
  showInvestigate?: boolean;
};

export function SafetyTable({ items, onSelect, onInvestigate, showInvestigate }: Props) {
  return (
    <DataTable>
      <thead>
        <tr>
          <th>Reference</th>
          <th>Type</th>
          <th>Title</th>
          <th>Site</th>
          <th>Reported by</th>
          <th>Date</th>
          <th>Severity</th>
          <th>Investigation</th>
          <th>Actions</th>
          <th>Status</th>
          {showInvestigate ? <th>Action</th> : null}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} onClick={() => onSelect(item.id)} className="bert-row-interactive cursor-pointer">
            <td className="font-semibold">{item.reference}</td>
            <td>{item.type}</td>
            <td className="max-w-[12rem] truncate">{item.title}</td>
            <td>{item.site}</td>
            <td>{item.reportedBy}</td>
            <td>{item.dateReported}</td>
            <td>{item.severity}</td>
            <td>{item.investigationStatus}</td>
            <td>{item.actionsRaised}</td>
            <td>
              <SafetyStatusBadge status={item.status} />
            </td>
            {showInvestigate && onInvestigate ? (
              <td onClick={(event) => event.stopPropagation()}>
                {item.raw.status !== "Closed" ? (
                  <button
                    type="button"
                    onClick={() => onInvestigate(item.id, item.raw.status === "Open")}
                    className="bert-btn-interactive rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white"
                  >
                    {item.raw.status === "Open" ? "Start" : "Continue"}
                  </button>
                ) : null}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
