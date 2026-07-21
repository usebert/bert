import type { AuditFilterState } from "../types";
import { SearchInput } from "../../components/ui/FormField";
import { Select } from "../../components/ui/FormField";
import { Toolbar } from "../../components/ui/PageLayout";

export function AuditFilters({
  filters,
  sites,
  onChange,
}: {
  filters: AuditFilterState;
  sites: string[];
  onChange: (next: AuditFilterState) => void;
}) {
  return (
    <Toolbar className="gap-3">
      <SearchInput
        value={filters.query}
        onChange={(event) => onChange({ ...filters, query: event.target.value })}
        placeholder="Search audits, sites, assignees…"
        className="min-w-0 flex-1"
        aria-label="Search audits"
      />
      <Select
        value={filters.status}
        onChange={(event) => onChange({ ...filters, status: event.target.value })}
        aria-label="Filter by status"
        className="min-w-[9rem]"
      >
        <option value="">All statuses</option>
        <option value="Overdue">Overdue</option>
        <option value="Due today">Due today</option>
        <option value="In progress">In progress</option>
        <option value="Completed">Completed</option>
        <option value="Awaiting sync">Awaiting sync</option>
      </Select>
      <Select
        value={filters.site}
        onChange={(event) => onChange({ ...filters, site: event.target.value })}
        aria-label="Filter by site"
        className="min-w-[9rem]"
      >
        <option value="">All sites</option>
        {sites.map((site) => (
          <option key={site} value={site}>
            {site}
          </option>
        ))}
      </Select>
      <Select
        value={filters.sync}
        onChange={(event) => onChange({ ...filters, sync: event.target.value })}
        aria-label="Filter by sync state"
        className="min-w-[9rem]"
      >
        <option value="">All sync states</option>
        <option value="queued">Awaiting sync</option>
        <option value="synced">Synced</option>
      </Select>
    </Toolbar>
  );
}
