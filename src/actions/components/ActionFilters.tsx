import type { ActionFilterState } from "../types";
import type { RiskLevel } from "../../types/reportsScreenProps";
import { SearchInput, Select } from "../../components/ui/FormField";
import { Toolbar } from "../../components/ui/PageLayout";

export function ActionFilters({
  filters,
  sites,
  sources,
  onChange,
}: {
  filters: ActionFilterState;
  sites: string[];
  sources: string[];
  onChange: (next: ActionFilterState) => void;
}) {
  return (
    <Toolbar className="flex-wrap gap-3">
      <SearchInput
        value={filters.query}
        onChange={(event) => onChange({ ...filters, query: event.target.value })}
        placeholder="Search actions, sites, assignees…"
        className="min-w-0 flex-1"
        aria-label="Search actions"
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
        <option value="Awaiting verification">Awaiting verification</option>
        <option value="Completed">Completed</option>
        <option value="Awaiting sync">Awaiting sync</option>
      </Select>
      <Select
        value={filters.priority}
        onChange={(event) => onChange({ ...filters, priority: event.target.value as RiskLevel | "" })}
        aria-label="Filter by priority"
        className="min-w-[9rem]"
      >
        <option value="">All priorities</option>
        <option value="Critical">Critical</option>
        <option value="High">High</option>
        <option value="Medium">Medium</option>
        <option value="Low">Low</option>
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
        value={filters.source}
        onChange={(event) => onChange({ ...filters, source: event.target.value })}
        aria-label="Filter by source"
        className="min-w-[9rem]"
      >
        <option value="">All sources</option>
        {sources.map((source) => (
          <option key={source} value={source}>
            {source}
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
