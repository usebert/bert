import type { ReactNode } from "react";
import { isDebugUiAllowed } from "../../utils/debugUiVisibility";
import { getPlainEnglishSyncStatus } from "../../utils/plainEnglishSync";
import { StatusChip } from "../ui/StatusChip";

export type OperationalAttentionRow = {
  id: string;
  title: string;
  subtitle: string;
  chip: "overdue" | "none";
  onActivate: () => void;
};

export type OperationalDueRow = {
  id: string;
  title: string;
  subtitle: string;
  chip: "dueSoon" | "none";
  onActivate: () => void;
};

export type OperationalAwaitingRow = {
  id: string;
  title: string;
  subtitle: string;
  onActivate: () => void;
};

export type OperationalInProgressRow = {
  id: string;
  title: string;
  subtitle: string;
  chip: "open" | "inProgress";
  onActivate: () => void;
};

export type OperationalCompletionRow = {
  id: string;
  title: string;
  subtitle: string;
  chip: "verified" | "closed";
  onActivate: () => void;
};

export type OperationalAttentionSummary = {
  overdueActions: number;
  escalatedItems: number;
  stuckActions: number;
  overdueAudits: number;
};

export type OperationalTodayStripRow = {
  id: string;
  title: string;
  chip: "dueSoon" | "none";
  onActivate: () => void;
};

const primaryRowBtn =
  "min-h-[44px] w-full rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

const secondaryLinkBtn =
  "text-xs font-semibold text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 rounded-sm";

function CardShell({
  icon,
  title,
  footer,
  children,
  iconTint,
}: {
  icon: ReactNode;
  title: string;
  footer: ReactNode;
  children: ReactNode;
  iconTint: string;
}) {
  return (
    <section className="flex h-full min-h-[12rem] flex-col rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconTint}`}>{icon}</div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h3>
        </div>
      </div>
      <div className="mt-3 min-h-0 flex-1 space-y-2">{children}</div>
      <div className="mt-3 border-t border-slate-100 pt-3">{footer}</div>
    </section>
  );
}

function CardFooterActions({
  primaryLabel,
  onPrimary,
  onViewAll,
  viewAllLabel = "See full list",
}: {
  primaryLabel: string;
  onPrimary: () => void;
  onViewAll: () => void;
  viewAllLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={onPrimary} className={primaryRowBtn}>
        {primaryLabel}
      </button>
      <button type="button" onClick={onViewAll} className={`w-full text-center ${secondaryLinkBtn}`}>
        {viewAllLabel}
      </button>
    </div>
  );
}

function AlertIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.85} aria-hidden>
      <path d="M12 4.75 20.25 19.25H3.75L12 4.75z" strokeLinejoin="round" />
      <path d="M12 9.5v4.5" strokeLinecap="round" />
      <circle cx="12" cy="16.35" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CalendarIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.85} aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 11h18" strokeLinecap="round" />
    </svg>
  );
}

function ShieldCheckIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.85} aria-hidden>
      <path d="M12 3 20 6v6c0 4.5-2.8 8.2-8 10-5.2-1.8-8-5.5-8-10V6l8-3Z" strokeLinejoin="round" />
      <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlayIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.85} aria-hidden>
      <path d="M9.5 7.5v9l7.5-4.5-7.5-4.5Z" strokeLinejoin="round" />
    </svg>
  );
}

function CheckCircleIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.85} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.2 2.3 2.2 4.7-4.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AttentionSummaryBody({
  summary,
  onViewAllNeedsAttention,
}: {
  summary: OperationalAttentionSummary;
  onViewAllNeedsAttention: () => void;
}) {
  const rows: Array<{
    key: string;
    label: string;
    count: number;
    chip: ReactNode;
    onClick: () => void;
  }> = [
    {
      key: "overdue-actions",
      label: `overdue action${summary.overdueActions === 1 ? "" : "s"}`,
      count: summary.overdueActions,
      chip: <StatusChip variant={summary.overdueActions > 0 ? "overdue" : "none"}>{summary.overdueActions > 0 ? "OVERDUE" : "NONE"}</StatusChip>,
      onClick: onViewAllNeedsAttention,
    },
    {
      key: "escalated",
      label: `escalated item${summary.escalatedItems === 1 ? "" : "s"}`,
      count: summary.escalatedItems,
      chip: <StatusChip variant={summary.escalatedItems > 0 ? "escalated" : "none"}>{summary.escalatedItems > 0 ? "ESCALATED" : "NONE"}</StatusChip>,
      onClick: onViewAllNeedsAttention,
    },
    {
      key: "stuck",
      label: `stuck action${summary.stuckActions === 1 ? "" : "s"}`,
      count: summary.stuckActions,
      chip: (
        <StatusChip variant={summary.stuckActions > 0 ? "dueSoon" : "none"}>
          {summary.stuckActions > 0 ? "STUCK" : "NONE"}
        </StatusChip>
      ),
      onClick: onViewAllNeedsAttention,
    },
    {
      key: "overdue-audits",
      label: `overdue audit${summary.overdueAudits === 1 ? "" : "s"}`,
      count: summary.overdueAudits,
      chip: <StatusChip variant={summary.overdueAudits > 0 ? "overdue" : "none"}>{summary.overdueAudits > 0 ? "OVERDUE" : "NONE"}</StatusChip>,
      onClick: onViewAllNeedsAttention,
    },
  ];

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <button
          key={row.key}
          type="button"
          onClick={row.onClick}
          className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/90 px-3 py-2.5 text-left transition hover:border-slate-200 hover:bg-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
        >
          <span className="min-w-0 text-sm font-semibold text-slate-900">
            <span className="text-slate-600">{row.count}</span> {row.label}
          </span>
          {row.chip}
        </button>
      ))}
    </div>
  );
}

export function OperationalDashboardCards({
  needsAttentionRows,
  needsAttentionSummary,
  dueTodayRows,
  todayStripRows,
  awaitingRows,
  inProgressRows,
  completionRows,
  onViewAllNeedsAttention,
  onViewAllDueToday,
  onViewAllAwaiting,
  onViewAllInProgress,
  onViewAllCompletions,
  devPreviewFill,
}: {
  needsAttentionRows: OperationalAttentionRow[];
  /** When set, replaces detailed “Needs attention” rows with aggregate chips. */
  needsAttentionSummary?: OperationalAttentionSummary;
  dueTodayRows: OperationalDueRow[];
  /** When non-empty, drives the “Today” card instead of `dueTodayRows`. */
  todayStripRows?: OperationalTodayStripRow[];
  awaitingRows: OperationalAwaitingRow[];
  inProgressRows: OperationalInProgressRow[];
  completionRows: OperationalCompletionRow[];
  onViewAllNeedsAttention: () => void;
  onViewAllDueToday: () => void;
  onViewAllAwaiting: () => void;
  onViewAllInProgress: () => void;
  onViewAllCompletions: () => void;
  /** When true and debug UI is allowed, show subtle empty-state hints (no fabricated rows). */
  devPreviewFill?: boolean;
}) {
  const dev = isDebugUiAllowed() && devPreviewFill;
  const useTodayStrip = todayStripRows !== undefined;

  const hasAttentionContent = needsAttentionSummary
    ? needsAttentionSummary.overdueActions +
        needsAttentionSummary.escalatedItems +
        needsAttentionSummary.stuckActions +
        needsAttentionSummary.overdueAudits >
      0
    : needsAttentionRows.length > 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <CardShell
        title="Needs attention"
        iconTint="bg-rose-50 text-rose-600 ring-1 ring-rose-100"
        icon={<AlertIcon />}
        footer={
          <CardFooterActions
            primaryLabel="Review overdue work"
            onPrimary={onViewAllNeedsAttention}
            onViewAll={onViewAllNeedsAttention}
          />
        }
      >
        {!hasAttentionContent ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-3 py-3 text-xs leading-relaxed text-slate-600">
            <span className="font-semibold text-slate-800">You are caught up on urgent risk.</span> When audits slip or actions go overdue, they will appear here with owners and due dates so you can respond calmly.
            {dev ? <span className="mt-2 block text-[10px] text-slate-400">Dev: connect data or load sample data from Admin tools to populate rows.</span> : null}
          </p>
        ) : needsAttentionSummary ? (
          <AttentionSummaryBody summary={needsAttentionSummary} onViewAllNeedsAttention={onViewAllNeedsAttention} />
        ) : (
          needsAttentionRows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={row.onActivate}
              className="flex min-h-[44px] w-full items-start justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/90 px-3 py-2.5 text-left transition hover:border-slate-200 hover:bg-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{row.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{row.subtitle}</p>
              </div>
              <StatusChip variant={row.chip === "overdue" ? "overdue" : "none"} />
            </button>
          ))
        )}
      </CardShell>

      <CardShell
        title="Due today"
        iconTint="bg-orange-50 text-orange-600 ring-1 ring-orange-100"
        icon={<CalendarIcon />}
        footer={
          <CardFooterActions primaryLabel="Start today’s work" onPrimary={onViewAllDueToday} onViewAll={onViewAllDueToday} />
        }
      >
        {useTodayStrip ? (
          todayStripRows!.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-3 py-3 text-xs leading-relaxed text-slate-600">
              <span className="font-semibold text-slate-800">Nothing needs finishing today.</span> Audits, actions, and incident follow-ups due today will line up here so the team knows what must ship before close of play.
              {dev ? <span className="mt-2 block text-[10px] text-slate-400">Dev: empty dataset — no sample rows shown in production builds.</span> : null}
            </p>
          ) : (
            todayStripRows!.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={row.onActivate}
                className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/90 px-3 py-2.5 text-left transition hover:border-slate-200 hover:bg-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
              >
                <span className="min-w-0 text-sm font-semibold text-slate-900">{row.title}</span>
                <StatusChip variant={row.chip === "dueSoon" ? "dueSoon" : "none"}>{row.chip === "dueSoon" ? "Due soon" : "On track"}</StatusChip>
              </button>
            ))
          )
        ) : dueTodayRows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-3 py-3 text-xs leading-relaxed text-slate-600">
            <span className="font-semibold text-slate-800">No deadlines today.</span> Your schedule looks clear. When audits or actions are due within twenty-four hours, they will line up here.
            {dev ? <span className="mt-2 block text-[10px] text-slate-400">Dev: empty dataset — no sample rows shown in production builds.</span> : null}
          </p>
        ) : (
          dueTodayRows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={row.onActivate}
              className="flex min-h-[44px] w-full items-start justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/90 px-3 py-2.5 text-left transition hover:border-slate-200 hover:bg-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{row.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{row.subtitle}</p>
              </div>
              <StatusChip variant={row.chip === "dueSoon" ? "dueSoon" : "none"}>{row.chip === "dueSoon" ? "Due soon" : "Scheduled"}</StatusChip>
            </button>
          ))
        )}
      </CardShell>

      <CardShell
        title="Awaiting verification"
        iconTint="bg-sky-50 text-sky-700 ring-1 ring-sky-100"
        icon={<ShieldCheckIcon />}
        footer={
          <CardFooterActions primaryLabel="Review evidence" onPrimary={onViewAllAwaiting} onViewAll={onViewAllAwaiting} />
        }
      >
        {awaitingRows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-3 py-3 text-xs leading-relaxed text-slate-600">
            <span className="font-semibold text-slate-800">Nothing waiting on you.</span> When field teams submit evidence for review, those actions will queue here for a calm verification pass.
            {dev ? <span className="mt-2 block text-[10px] text-slate-400">Dev: advance an action to Awaiting Verification to see this list.</span> : null}
          </p>
        ) : (
          awaitingRows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={row.onActivate}
              className="flex min-h-[44px] w-full items-start justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/90 px-3 py-2.5 text-left transition hover:border-slate-200 hover:bg-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{row.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{row.subtitle}</p>
              </div>
              <StatusChip variant="awaitingVerification">Awaiting verification</StatusChip>
            </button>
          ))
        )}
      </CardShell>

      <CardShell
        title="In progress"
        iconTint="bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100"
        icon={<PlayIcon />}
        footer={
          <CardFooterActions primaryLabel="Continue open work" onPrimary={onViewAllInProgress} onViewAll={onViewAllInProgress} />
        }
      >
        {inProgressRows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-3 py-3 text-xs leading-relaxed text-slate-600">
            <span className="font-semibold text-slate-800">No actions in flight.</span> Open or in-progress work will appear here with owners so you can nudge or take over without hunting through lists.
            {dev ? <span className="mt-2 block text-[10px] text-slate-400">Dev: start an action to populate this lane.</span> : null}
          </p>
        ) : (
          inProgressRows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={row.onActivate}
              className="flex min-h-[44px] w-full items-start justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/90 px-3 py-2.5 text-left transition hover:border-slate-200 hover:bg-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{row.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{row.subtitle}</p>
              </div>
              <StatusChip variant={row.chip === "inProgress" ? "awaitingVerification" : "draft"}>
                {row.chip === "inProgress" ? "In progress" : "Open"}
              </StatusChip>
            </button>
          ))
        )}
      </CardShell>

      <CardShell
        title="Completed & reporting"
        iconTint="bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
        icon={<CheckCircleIcon />}
        footer={
          <CardFooterActions primaryLabel="View completed work" onPrimary={onViewAllCompletions} onViewAll={onViewAllCompletions} />
        }
      >
        {completionRows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-3 py-3 text-xs leading-relaxed text-slate-600">
            <span className="font-semibold text-slate-800">No completions yet.</span> Finished audits will appear here once work is submitted — useful for handovers, assurance, and weekly reporting.
            {dev ? <span className="mt-2 block text-[10px] text-slate-400">Dev: complete an audit or close an action to populate history.</span> : null}
          </p>
        ) : (
          completionRows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={row.onActivate}
              className="flex min-h-[44px] w-full items-start justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/90 px-3 py-2.5 text-left transition hover:border-slate-200 hover:bg-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{row.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{row.subtitle}</p>
              </div>
              <StatusChip variant={row.chip === "closed" ? "closed" : "verified"}>{row.chip === "closed" ? "Closed" : "Verified"}</StatusChip>
            </button>
          ))
        )}
      </CardShell>
    </div>
  );
}

export function SyncSavedStateSummary({
  offlineQueueCount,
  pendingSyncCount,
  failedSyncCount,
  lastSyncedAt,
  onOpenSyncCentre,
}: {
  offlineQueueCount: number;
  pendingSyncCount: number;
  failedSyncCount: number;
  lastSyncedAt?: string | null;
  onOpenSyncCentre: () => void;
}) {
  const { detail, tone } = getPlainEnglishSyncStatus({
    offlineQueueCount,
    pendingSyncCount,
    failedSyncCount,
    lastSyncedAt: lastSyncedAt ?? undefined,
  });
  const toneClass = tone === "ok" ? "text-emerald-800" : tone === "waiting" ? "text-amber-900" : "text-rose-900";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/90 bg-white px-4 py-3 shadow-[0_8px_22px_rgba(15,23,42,0.05)]">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Saved to Bert and the cloud</p>
        <p className={`mt-1 text-sm font-medium leading-snug ${toneClass}`}>{detail}</p>
      </div>
      <button
        type="button"
        onClick={onOpenSyncCentre}
        className="min-h-[44px] shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
      >
        View sync details
      </button>
    </div>
  );
}
