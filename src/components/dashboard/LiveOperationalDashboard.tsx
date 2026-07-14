import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shouldRenderLiveOperationalDashboard, type Role } from "../../permissions";
import {
  invalidateLiveDashboardCache,
  loadLiveDashboardCached,
} from "../../services/appDataCacheService";
import {
  applyLocalSyncStatusToLiveDashboard,
  emptyLiveDashboardPayload,
} from "../../services/liveDashboardService";
import type {
  LiveDashboardPayload,
  LiveRiskArea,
  LiveRiskLevel,
} from "../../types/liveDashboard";
import { EmptyPanel, MiniMetric, SectionHeader } from "./DashboardPrimitives";
import { DashboardLayoutBoard } from "../dashboard-layout/DashboardLayoutBoard";

type Props = {
  companyFolderId: string;
  masterSheetId: string;
  companyName: string;
  userEmail: string;
  role: Role;
  pendingSyncCount?: number;
  failedSyncCount?: number;
  onOpenActions?: () => void;
  onOpenIncidents?: () => void;
  onOpenBriefings?: () => void;
  onOpenSchedules?: () => void;
  onOpenSync?: () => void;
};

const CARD = "rounded-[1.6rem] border border-sky-200/80 bg-white p-4 shadow-[0_14px_30px_rgba(15,23,42,0.06)]";

const RISK_STYLE: Record<LiveRiskLevel, { chip: string; row: string; dot: string }> = {
  Critical: { chip: "bg-rose-600 text-white", row: "bg-rose-50 border-rose-200", dot: "bg-rose-600" },
  High: { chip: "bg-orange-500 text-white", row: "bg-orange-50 border-orange-200", dot: "bg-orange-500" },
  Medium: { chip: "bg-amber-400 text-amber-950", row: "bg-amber-50 border-amber-200", dot: "bg-amber-400" },
  Low: { chip: "bg-blue-500 text-white", row: "bg-blue-50 border-blue-200", dot: "bg-blue-500" },
};

function priorityChip(level: LiveRiskLevel) {
  return RISK_STYLE[level]?.chip ?? RISK_STYLE.Low.chip;
}

function formatTime(iso: string): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function complianceTone(label: string): string {
  if (label === "Critical") return "text-rose-700 bg-rose-500/12 ring-rose-500/30";
  if (label === "Needs attention") return "text-amber-700 bg-amber-500/12 ring-amber-500/30";
  return "text-blue-800 bg-blue-500/12 ring-blue-500/30";
}

export function LiveOperationalDashboard({
  companyFolderId,
  masterSheetId,
  companyName,
  userEmail,
  role,
  pendingSyncCount = 0,
  failedSyncCount = 0,
  onOpenActions,
  onOpenIncidents,
  onOpenBriefings,
  onOpenSchedules,
  onOpenSync,
}: Props) {
  const [payload, setPayload] = useState<LiveDashboardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const requestSeq = useRef(0);

  const contextReady = Boolean(companyFolderId && masterSheetId);

  const load = useCallback(
    async (mode: "initial" | "manual" | "background") => {
      if (!contextReady) {
        return;
      }
      const seq = ++requestSeq.current;
      if (mode === "manual") {
        setRefreshing(true);
      }
      try {
        const result = await loadLiveDashboardCached(
          { companyFolderId, masterSheetId, companyName, userEmail },
          {
            manualRefresh: mode === "manual",
            query: { syncQueued: pendingSyncCount, syncFailed: failedSyncCount },
          },
        );
        if (seq !== requestSeq.current) {
          return;
        }
        setPayload(result.data);
        setLoadError(result.refreshWarning || "");
        if (!result.fromCache) {
          setLastRefreshed(Date.now());
        } else if (lastRefreshed === null) {
          setLastRefreshed(Date.now());
        }
        // Await a stale-while-revalidate background refresh if one started.
        if (result.revalidatePromise) {
          void result.revalidatePromise.then((fresh) => {
            if (seq === requestSeq.current && fresh) {
              setPayload(fresh as LiveDashboardPayload);
              setLastRefreshed(Date.now());
            }
          });
        }
      } catch (error) {
        if (seq === requestSeq.current && !payload) {
          setLoadError(error instanceof Error ? error.message : "Could not load the live dashboard right now. Try again.");
        }
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companyFolderId, masterSheetId, companyName, userEmail, pendingSyncCount, failedSyncCount, contextReady],
  );

  useEffect(() => {
    if (!contextReady) {
      return;
    }
    if (!payload) {
      setLoading(true);
    }
    void load("initial");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyFolderId, masterSheetId, userEmail]);

  // Queue dismissals / retries change client-local counts; drop cached sync warnings immediately.
  useEffect(() => {
    if (!contextReady) {
      return;
    }
    invalidateLiveDashboardCache({ companyFolderId, userEmail });
  }, [companyFolderId, userEmail, pendingSyncCount, failedSyncCount, contextReady]);

  const view = useMemo(
    () =>
      applyLocalSyncStatusToLiveDashboard(payload ?? emptyLiveDashboardPayload(), {
        queued: pendingSyncCount,
        failed: failedSyncCount,
      }),
    [payload, pendingSyncCount, failedSyncCount],
  );

  if (!contextReady) {
    return null;
  }

  if (!shouldRenderLiveOperationalDashboard(role)) {
    return null;
  }

  const metrics = view.metrics;
  const showFullLoading = loading && !payload;

  return (
    <section aria-label="Live operational dashboard" className="space-y-4">
      <div className="rounded-[1.75rem] border border-slate-800/70 bg-gradient-to-r from-slate-950 via-[#0c1f36] to-slate-950 px-5 py-4 text-white shadow-[0_16px_36px_rgba(2,6,23,0.32)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-300">Live operations</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Where do we need to act today?</h2>
            <p className="mt-1 text-sm text-slate-300">
              {view.today.dateLabel ? `Today ${view.today.dateLabel}` : "Live company operations"}
              {companyName ? ` • ${companyName}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <button
              type="button"
              onClick={() => void load("manual")}
              disabled={refreshing}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/12 px-4 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <p className="text-[11px] text-slate-400">
              {lastRefreshed ? `Updated ${new Date(lastRefreshed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Loading…"}
              {view.cached ? " • cached" : ""}
            </p>
          </div>
        </div>
        {view.sync?.hasIssue ? (
          <button
            type="button"
            onClick={onOpenSync}
            className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-amber-400/40 bg-amber-400/15 px-3 py-2 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-amber-100">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
              {view.sync.message}
            </span>
            {onOpenSync ? <span className="text-xs font-semibold text-amber-200">Open Sync Centre →</span> : null}
          </button>
        ) : null}
      </div>

      {loadError && !payload ? (
        <div className={CARD}>
          <EmptyPanel title="Could not load the live dashboard" text={loadError} />
          <button
            type="button"
            onClick={() => void load("manual")}
            className="mt-3 inline-flex h-10 items-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </div>
      ) : null}

      {showFullLoading ? (
        <div className={CARD}>
          <p className="text-sm text-slate-500">Loading live operations…</p>
        </div>
      ) : null}

      <DashboardLayoutBoard
        catalogId="live-operations"
        companyFolderId={companyFolderId}
        userIdentity={userEmail}
        listClassName="space-y-4"
        cards={{
          "kpi-metrics": (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <MiniMetric label="DUE TODAY" value={String(metrics.todayDue)} icon="clock" tone="sky" />
        <MiniMetric label="COMPLETED TODAY" value={String(metrics.todayCompleted)} icon="check" tone="green" />
        <MiniMetric label="OUTSTANDING" value={String(metrics.todayOutstanding)} icon="checklist" tone={metrics.todayOutstanding ? "amber" : "green"} />
        <MiniMetric label="OVERDUE INSPECTIONS" value={String(metrics.overdueInspections)} icon="warningTriangle" tone={metrics.overdueInspections ? "red" : "green"} />
        <MiniMetric label="OPEN ACTIONS" value={String(metrics.openActions)} icon="clipboard" tone={metrics.openActions ? "amber" : "green"} />
        <MiniMetric label="OVERDUE ACTIONS" value={String(metrics.overdueActions)} icon="warningTriangle" tone={metrics.overdueActions ? "red" : "green"} />
        <MiniMetric label="CURRENT INCIDENTS" value={String(metrics.currentIncidents)} icon="shield" tone={metrics.currentIncidents ? "red" : "green"} />
        <MiniMetric label="PENDING BRIEFINGS" value={String(metrics.pendingBriefings)} icon="note" tone={metrics.pendingBriefings ? "amber" : "green"} />
      </div>
          ),
          "act-today": (
        <div className={CARD}>
          <SectionHeader icon="warningTriangle" eyebrow="Priority" title="Act today" subtitle="Ranked by urgency — overdue and high risk first." />
          {view.actToday.length === 0 ? (
            <EmptyPanel title="Nothing needs action right now" text="New due checks, overdue actions, incidents, and briefings will appear here." />
          ) : (
            <ol className="space-y-2">
              {view.actToday.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3"
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                    {item.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${priorityChip(item.priority)}`}>
                        {item.priority}
                      </span>
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{item.dueLabel}</span>
                    </div>
                    <p className="mt-1 truncate text-sm font-semibold text-slate-900">{item.title}</p>
                    {item.subtitle ? <p className="truncate text-xs text-slate-500">{item.subtitle}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
          ),
          "compliance-score": (
        <div className={CARD}>
          <SectionHeader icon="shield" eyebrow="Score" title="Operational compliance score" subtitle="100 minus penalties for open risk items." />
          <div className="flex items-center gap-4">
            <div className={`flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-full ring-4 ${complianceTone(view.compliance.label)}`}>
              <span className="text-3xl font-bold">{view.compliance.score}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide">/ 100</span>
            </div>
            <div className="min-w-0">
              <p className={`inline-flex rounded-full px-3 py-1 text-sm font-bold ring-1 ${complianceTone(view.compliance.label)}`}>
                {view.compliance.label}
              </p>
              {view.compliance.reductions.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">No penalties — nothing reducing the score.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {view.compliance.reductions.map((reduction) => (
                    <li key={reduction.key} className="flex items-center justify-between gap-3 text-xs text-slate-600">
                      <span className="truncate">{reduction.label} ({reduction.count})</span>
                      <span className="font-semibold text-rose-600">-{reduction.points}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
          ),
          "risk-by-area": (
        <div className={CARD}>
          <SectionHeader icon="grid" eyebrow="Hotspots" title="Highest-risk sites / departments" subtitle="Ranked by open risk. Colour shows severity." />
          {view.riskByArea.length === 0 ? (
            <EmptyPanel title="No hotspots yet" text={view.riskEmptyMessage || "No site/department data yet."} />
          ) : (
            <div className="space-y-2">
              {view.riskByArea.map((area: LiveRiskArea) => {
                const style = RISK_STYLE[area.level] ?? RISK_STYLE.Low;
                return (
                  <div key={area.area} className={`flex items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 ${style.row}`}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{area.area}</p>
                      <p className="truncate text-xs text-slate-600">
                        {area.overdueInspections} overdue • {area.openActions} actions • {area.incidents} incidents • {area.criticalFindings} critical
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold ${style.chip}`}>{area.level}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
          ),
          "overdue-inspections": (
        <div className={CARD}>
          <div className="mb-1 flex items-center justify-between">
            <SectionHeader icon="clock" eyebrow="Late" title="Overdue inspections" subtitle="How late, where, and who owns it." />
            {onOpenSchedules ? (
              <button type="button" onClick={onOpenSchedules} className="text-xs font-semibold text-sky-700">View all →</button>
            ) : null}
          </div>
          {view.sections.overdueInspections.length === 0 ? (
            <EmptyPanel title="No overdue inspections" text="Scheduled checks that miss their window will list here." />
          ) : (
            <ul className="space-y-2">
              {view.sections.overdueInspections.slice(0, 6).map((item) => (
                <li key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
                  <p className="truncate text-xs text-slate-500">{item.subtitle}{item.owner ? ` • ${item.owner}` : ""}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
          ),
          "outstanding-actions": (
        <div className={CARD}>
          <div className="mb-1 flex items-center justify-between">
            <SectionHeader icon="clipboard" eyebrow="Work" title="Outstanding actions" subtitle="Open, overdue and high-risk actions." />
            {onOpenActions ? (
              <button type="button" onClick={onOpenActions} className="text-xs font-semibold text-sky-700">View all →</button>
            ) : null}
          </div>
          {view.sections.outstandingActions.length === 0 ? (
            <EmptyPanel title="No outstanding actions" text="Corrective actions needing progress will appear here." />
          ) : (
            <ul className="space-y-2">
              {view.sections.outstandingActions.slice(0, 6).map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
                    <p className="truncate text-xs text-slate-500">{item.subtitle}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${priorityChip(item.severity)}`}>{item.dueLabel}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
          ),
          "current-incidents": (
        <div className={CARD}>
          <div className="mb-1 flex items-center justify-between">
            <SectionHeader icon="warningTriangle" eyebrow="Safety" title="Current incidents" subtitle="Open incidents and near misses." />
            {onOpenIncidents ? (
              <button type="button" onClick={onOpenIncidents} className="text-xs font-semibold text-sky-700">View all →</button>
            ) : null}
          </div>
          {view.sections.currentIncidents.length === 0 ? (
            <EmptyPanel title="No open incidents" text="Open incidents and near misses will appear here." />
          ) : (
            <ul className="space-y-2">
              {view.sections.currentIncidents.slice(0, 6).map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
                    <p className="truncate text-xs text-slate-500">{item.subtitle}{item.owner ? ` • ${item.owner}` : ""} • {item.status}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${priorityChip(item.severity)}`}>{item.severity}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
          ),
          "briefings": (
        <div className={CARD}>
          <div className="mb-1 flex items-center justify-between">
            <SectionHeader icon="note" eyebrow="Sign-off" title="Briefings needing attention" subtitle="Unread, unacknowledged, or unsigned." />
            {onOpenBriefings ? (
              <button type="button" onClick={onOpenBriefings} className="text-xs font-semibold text-sky-700">View all →</button>
            ) : null}
          </div>
          {view.sections.briefings.length === 0 ? (
            <EmptyPanel title="No briefings pending" text="Briefings awaiting read, acknowledgement or signature will list here." />
          ) : (
            <ul className="space-y-2">
              {view.sections.briefings.slice(0, 6).map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
                    <p className="truncate text-xs text-slate-500">{item.subtitle}{item.mandatory ? " • mandatory" : ""}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${priorityChip(item.priority)}`}>{item.dueLabel}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
          ),
          "sync-status": (
        <div className={CARD}>
          <SectionHeader icon="sync" eyebrow="Offline" title="Sync status" subtitle="Queued and failed items waiting to reach the workbook." />
          <div className="grid grid-cols-2 gap-3">
            <MiniMetric label="QUEUED" value={String(view.sync?.queued ?? 0)} icon="sync" tone={view.sync?.queued ? "amber" : "green"} />
            <MiniMetric label="FAILED" value={String(view.sync?.failed ?? 0)} icon="warningTriangle" tone={view.sync?.failed ? "red" : "green"} />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {view.sync?.message || "All work is synced."}
            {view.sync?.lastSyncAt ? ` • last sync ${formatTime(view.sync.lastSyncAt)}` : ""}
          </p>
          {onOpenSync ? (
            <button type="button" onClick={onOpenSync} className="mt-2 text-xs font-semibold text-sky-700">Open Sync Centre →</button>
          ) : null}
        </div>
          ),
        }}
      />
    </section>
  );
}
