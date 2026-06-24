import type { AuditResultSummary } from "../types/resultsScreenProps";
import type { ManagedSchedule } from "../types/reportsScreenProps";
import { normalizeScheduleCompletionMode } from "./scheduleCompletionMode";

export type ResultsViewFilters = {
  nameQuery: string;
  completedBy: string;
  status: string;
  fromDate: string;
  toDate: string;
};

export const EMPTY_RESULTS_FILTERS: ResultsViewFilters = {
  nameQuery: "",
  completedBy: "",
  status: "",
  fromDate: "",
  toDate: "",
};

export function defaultResultsFromDate(days = 30): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export function createInitialResultsFilters(days = 30): ResultsViewFilters {
  return {
    ...EMPTY_RESULTS_FILTERS,
    fromDate: defaultResultsFromDate(days),
  };
}

export type EnrichedAuditResult = AuditResultSummary & {
  scheduleName?: string;
  completionModeLabel?: string;
  isScheduledCheck: boolean;
  checkDisplayName: string;
};

export function formatResultsCompletionModeLabel(mode: string | undefined): string | undefined {
  const resolved = normalizeScheduleCompletionMode(mode);
  if (!resolved) {
    return undefined;
  }
  return resolved === "once-per-period" ? "Once per period" : "Repeatable";
}

export function buildScheduleLookup(schedules: ManagedSchedule[]): Map<string, ManagedSchedule> {
  const lookup = new Map<string, ManagedSchedule>();
  for (const schedule of schedules) {
    if (schedule.id) {
      lookup.set(schedule.id, schedule);
    }
  }
  return lookup;
}

export function enrichAuditResult(
  result: AuditResultSummary,
  scheduleLookup: Map<string, ManagedSchedule>,
): EnrichedAuditResult {
  const schedule = result.scheduleId ? scheduleLookup.get(result.scheduleId) : undefined;
  const scheduleName = schedule?.scheduleName?.trim() || undefined;
  const checkDisplayName =
    result.auditName?.trim() || scheduleName || result.scheduleId || "Completed check";
  const isScheduledCheck = Boolean(result.scheduleId?.trim());
  const completionModeLabel = isScheduledCheck
    ? formatResultsCompletionModeLabel(schedule?.completionMode)
    : undefined;

  return {
    ...result,
    scheduleName,
    completionModeLabel,
    isScheduledCheck,
    checkDisplayName,
  };
}

export function enrichAuditResultBasic(result: AuditResultSummary): EnrichedAuditResult {
  const checkDisplayName =
    result.auditName?.trim() || result.scheduleId?.trim() || "Completed check";
  return {
    ...result,
    isScheduledCheck: Boolean(result.scheduleId?.trim()),
    checkDisplayName,
  };
}

export function enrichAuditResults(
  results: AuditResultSummary[],
  schedules: ManagedSchedule[],
): EnrichedAuditResult[] {
  if (!schedules.length) {
    return results.map((result) => enrichAuditResultBasic(result));
  }
  const scheduleLookup = buildScheduleLookup(schedules);
  return results.map((result) => enrichAuditResult(result, scheduleLookup));
}

export function hasActiveResultsFilters(filters: ResultsViewFilters): boolean {
  return Boolean(
    filters.nameQuery.trim() ||
      filters.completedBy.trim() ||
      filters.status.trim() ||
      filters.fromDate.trim() ||
      filters.toDate.trim(),
  );
}

function completedAtMs(completedAt: string): number | null {
  const parsed = Date.parse(completedAt);
  return Number.isNaN(parsed) ? null : parsed;
}

function dateInputToStartMs(date: string): number | null {
  const parsed = Date.parse(`${date}T00:00:00`);
  return Number.isNaN(parsed) ? null : parsed;
}

function dateInputToEndMs(date: string): number | null {
  const parsed = Date.parse(`${date}T23:59:59.999`);
  return Number.isNaN(parsed) ? null : parsed;
}

export function resultMatchesNameQuery(result: EnrichedAuditResult, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const haystack = [
    result.checkDisplayName,
    result.auditName,
    result.scheduleName,
    result.scheduleId,
    result.auditId,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalized);
}

export function resultMatchesCompletedBy(result: EnrichedAuditResult, completedBy: string): boolean {
  const selected = completedBy.trim();
  if (!selected) {
    return true;
  }
  return (
    result.completedByEmail === selected ||
    result.completedByName === selected ||
    `${result.completedByName} (${result.completedByEmail})` === selected
  );
}

export function resultMatchesStatus(result: EnrichedAuditResult, status: string): boolean {
  const selected = status.trim().toLowerCase();
  if (!selected) {
    return true;
  }
  return (result.status || "completed").toLowerCase() === selected;
}

export function resultMatchesDateRange(
  result: EnrichedAuditResult,
  fromDate: string,
  toDate: string,
): boolean {
  const completedMs = completedAtMs(result.completedAt);
  if (completedMs === null) {
    return !fromDate.trim() && !toDate.trim();
  }
  if (fromDate.trim()) {
    const fromMs = dateInputToStartMs(fromDate);
    if (fromMs !== null && completedMs < fromMs) {
      return false;
    }
  }
  if (toDate.trim()) {
    const toMs = dateInputToEndMs(toDate);
    if (toMs !== null && completedMs > toMs) {
      return false;
    }
  }
  return true;
}

export function filterEnrichedResults(
  results: EnrichedAuditResult[],
  filters: ResultsViewFilters,
): EnrichedAuditResult[] {
  return results.filter(
    (result) =>
      resultMatchesNameQuery(result, filters.nameQuery) &&
      resultMatchesCompletedBy(result, filters.completedBy) &&
      resultMatchesStatus(result, filters.status) &&
      resultMatchesDateRange(result, filters.fromDate, filters.toDate),
  );
}

export function collectCompletedByOptions(results: AuditResultSummary[]): string[] {
  const seen = new Map<string, string>();
  for (const result of results) {
    const email = result.completedByEmail.trim();
    const name = result.completedByName.trim();
    if (!email && !name) {
      continue;
    }
    const key = email || name;
    const label = name && email && name !== email ? `${name} (${email})` : name || email;
    seen.set(key, label);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

export function collectStatusOptions(results: AuditResultSummary[]): string[] {
  const seen = new Set<string>();
  for (const result of results) {
    const status = (result.status || "completed").trim();
    if (status) {
      seen.add(status);
    }
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

export function sortResultsByCompletedAtDesc<T extends Pick<AuditResultSummary, "completedAt">>(
  results: T[],
): T[] {
  return [...results].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
}
