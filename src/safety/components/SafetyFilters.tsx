import { SearchInput } from "../../components/ui/FormField";
import type { IncidentSeverity, IncidentStatus } from "../../types/incidentsScreenProps";
import type { SafetyFilterState } from "../types";

type Props = {
  filters: SafetyFilterState;
  departments: string[];
  onChange: (patch: Partial<SafetyFilterState>) => void;
};

export function SafetyFilters({ filters, departments, onChange }: Props) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
      <SearchInput
        value={filters.query}
        onChange={(event) => onChange({ query: event.target.value })}
        placeholder="Search reference, title, site…"
        aria-label="Search incidents"
        className="min-h-[2.75rem] sm:col-span-2"
      />
      <select
        value={filters.status}
        onChange={(event) => onChange({ status: event.target.value as IncidentStatus | "" })}
        className="min-h-[2.75rem] rounded-xl border border-slate-200 bg-white px-3 text-sm"
        aria-label="Filter by status"
      >
        <option value="">All statuses</option>
        <option value="Open">Open</option>
        <option value="Under Investigation">Under Investigation</option>
        <option value="Closed">Closed</option>
      </select>
      <select
        value={filters.severity}
        onChange={(event) => onChange({ severity: event.target.value as IncidentSeverity | "" })}
        className="min-h-[2.75rem] rounded-xl border border-slate-200 bg-white px-3 text-sm"
        aria-label="Filter by severity"
      >
        <option value="">All severity</option>
        <option value="Minor">Minor</option>
        <option value="Medical Treatment">Medical Treatment</option>
        <option value="Lost Time Injury">Lost Time Injury</option>
        <option value="Major Incident">Major Incident</option>
        <option value="Fatality">Fatality</option>
      </select>
      <select
        value={filters.site}
        onChange={(event) => onChange({ site: event.target.value })}
        className="min-h-[2.75rem] rounded-xl border border-slate-200 bg-white px-3 text-sm"
        aria-label="Filter by site"
      >
        <option value="">All sites / departments</option>
        {departments.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      <input
        type="date"
        value={filters.fromDate}
        onChange={(event) => onChange({ fromDate: event.target.value })}
        className="min-h-[2.75rem] rounded-xl border border-slate-200 bg-white px-3 text-sm"
        aria-label="From date"
      />
      <input
        type="date"
        value={filters.toDate}
        onChange={(event) => onChange({ toDate: event.target.value })}
        className="min-h-[2.75rem] rounded-xl border border-slate-200 bg-white px-3 text-sm"
        aria-label="To date"
      />
      <label className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm">
        <input
          type="checkbox"
          checked={filters.actionsOutstanding}
          onChange={(event) => onChange({ actionsOutstanding: event.target.checked })}
          className="h-4 w-4"
        />
        Actions outstanding
      </label>
    </div>
  );
}
