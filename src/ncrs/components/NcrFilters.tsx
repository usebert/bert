import { SearchInput } from "../../components/ui/FormField";
import type { NcrFilterState } from "../types";

export function NcrFilters({
  filters,
  onChange,
}: {
  filters: NcrFilterState;
  onChange: (patch: Partial<NcrFilterState>) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <SearchInput
        value={filters.query}
        onChange={(event) => onChange({ query: event.target.value })}
        placeholder="Search NCR reference, issue, site…"
        aria-label="Search NCRs"
        className="min-h-[2.75rem] sm:col-span-2"
      />
      <input
        value={filters.site}
        onChange={(event) => onChange({ site: event.target.value })}
        placeholder="Filter by site"
        className="min-h-[2.75rem] rounded-xl border border-slate-200 bg-white px-3 text-sm"
      />
    </div>
  );
}
