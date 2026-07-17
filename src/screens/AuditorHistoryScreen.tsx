import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { HistoryEntry } from "../types/reportsScreenProps";
import type { IncidentRecord } from "../types/incidentsScreenProps";
import { EmptyPanel } from "../components/dashboard/DashboardPrimitives";
import { SECTION_INTROS } from "../config/sectionIntros";
import { SectionIntro } from "../components/SectionIntro";

export type AuditorHistoryScreenProps = {
  currentUserName: string;
  history: HistoryEntry[];
  incidents: IncidentRecord[];
  unsyncedAuditIds: Set<string>;
  syncSummary: string;
  syncNeedsAttention: boolean;
};

type SyncTone = "synced" | "pending" | "needsAttention";

function formatDisplayDate(isoOrDisplay: string): string {
  const parsed = Date.parse(isoOrDisplay);
  if (Number.isNaN(parsed)) {
    return isoOrDisplay;
  }
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(parsed));
  } catch {
    return isoOrDisplay;
  }
}

function submissionSyncTone(auditId: string, unsyncedAuditIds: Set<string>): SyncTone {
  if (!unsyncedAuditIds.has(auditId)) {
    return "synced";
  }
  return "pending";
}

function incidentSyncTone(status: string): SyncTone {
  if (status === "Failed" || status.includes("fail")) {
    return "needsAttention";
  }
  if (status === "Pending" || status === "Queued") {
    return "pending";
  }
  return "synced";
}

function syncLabel(t: TFunction, tone: SyncTone): string {
  if (tone === "synced") return t("common.synced");
  if (tone === "needsAttention") return t("common.needsAttention");
  return t("status.pending");
}

function syncBadgeClasses(tone: SyncTone): string {
  if (tone === "synced") return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (tone === "needsAttention") return "bg-rose-50 text-rose-800 ring-rose-200";
  return "bg-amber-50 text-amber-900 ring-amber-200";
}

export function AuditorHistoryScreen({
  currentUserName,
  history,
  incidents,
  unsyncedAuditIds,
  syncSummary,
  syncNeedsAttention,
}: AuditorHistoryScreenProps) {
  const { t } = useTranslation();
  const myHistory = useMemo(
    () =>
      history
        .filter((entry) => entry.completedBy === currentUserName)
        .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt)),
    [history, currentUserName],
  );

  const myIncidents = useMemo(
    () =>
      incidents
        .filter(
          (item) =>
            item.reporterName === currentUserName ||
            item.createdBy === currentUserName,
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [incidents, currentUserName],
  );

  const hasSubmissions = myHistory.length > 0 || myIncidents.length > 0;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-violet-200/80 bg-violet-50/60 px-4 py-4 shadow-sm">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{t("audits.history")}</h2>
        <SectionIntro text={SECTION_INTROS.auditorHistory} className="mt-2" role="Auditor" />
      </section>

      <section
        className={[
          "rounded-2xl border px-4 py-3.5 shadow-sm",
          syncNeedsAttention ? "border-rose-200 bg-rose-50/80" : "border-slate-200/90 bg-white",
        ].join(" ")}
      >
        <p className="text-sm font-semibold text-slate-900">{t("audits.sendingStatus")}</p>
        <p className="mt-1 text-sm text-slate-600">{syncSummary}</p>
      </section>

      {!hasSubmissions ? (
        <EmptyPanel
          title={t("audits.noSubmissionsYet")}
          text={t("audits.noSubmissionsBody")}
        />
      ) : (
        <div className="space-y-4">
          {myHistory.length > 0 ? (
            <section className="space-y-3">
              <p className="text-sm font-semibold text-slate-900">{t("audits.completedChecks")}</p>
              <ul className="space-y-2">
                {myHistory.map((entry) => {
                  const tone = submissionSyncTone(entry.auditId, unsyncedAuditIds);
                  return (
                    <li
                      key={entry.id}
                      className="rounded-2xl border border-slate-200/90 bg-white px-4 py-3.5 shadow-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-base font-semibold text-slate-900">{entry.auditName}</p>
                          <p className="mt-1 text-sm text-slate-500">{formatDisplayDate(entry.completedAt)}</p>
                        </div>
                        <span
                          className={[
                            "shrink-0 rounded-full px-3 py-1 text-xs font-semibold ring-1",
                            syncBadgeClasses(tone),
                          ].join(" ")}
                        >
                          {syncLabel(t, tone)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {myIncidents.length > 0 ? (
            <section className="space-y-3">
              <p className="text-sm font-semibold text-slate-900">{t("audits.incidentReports")}</p>
              <ul className="space-y-2">
                {myIncidents.map((item) => {
                  const tone = incidentSyncTone(item.notificationStatus || "Synced");
                  return (
                    <li
                      key={item.id}
                      className="rounded-2xl border border-slate-200/90 bg-white px-4 py-3.5 shadow-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-base font-semibold text-slate-900">
                            {item.incidentType} · {item.incidentId}
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            {item.incidentDate} {item.incidentTime} · {item.status}
                          </p>
                        </div>
                        <span
                          className={[
                            "shrink-0 rounded-full px-3 py-1 text-xs font-semibold ring-1",
                            syncBadgeClasses(tone),
                          ].join(" ")}
                        >
                          {syncLabel(t, tone)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      )}

      <p className="text-sm text-slate-500">
        {t("audits.historyHelpBefore")}{" "}
        <span className="font-semibold text-slate-700">{t("common.help")}</span>{" "}
        {t("audits.historyHelpAfter")}
      </p>
    </div>
  );
}
