import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  backgroundJobsService,
  type BackgroundJobRecord,
} from "../../services/backgroundJobsService";
import { UX_STATUS, backgroundJobsBannerForRole, canShowTechnicalUi } from "../../utils/uxDeclutter";
import type { Role } from "../../permissions";

function statusTone(status: BackgroundJobRecord["status"]) {
  if (status === "COMPLETED") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (status === "NEEDS_ATTENTION" || status === "FAILED") {
    return "bg-amber-100 text-amber-900";
  }
  if (status === "RUNNING") {
    return "bg-sky-100 text-sky-800";
  }
  return "bg-slate-100 text-slate-700";
}

export function GodmodeBackgroundJobsPanel({
  companyId,
  surfaceClass = "",
  viewerRole = "Master",
}: {
  companyId?: string;
  surfaceClass?: string;
  viewerRole?: Role;
}) {
  const { t } = useTranslation();
  const technical = canShowTechnicalUi(viewerRole);
  const [jobs, setJobs] = useState<BackgroundJobRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = companyId
        ? await backgroundJobsService.listForCompany(companyId)
        : await backgroundJobsService.listAll();
      setJobs(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load background jobs.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadJobs();
    const timer = window.setInterval(() => {
      void loadJobs();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [loadJobs]);

  const activeJobs = jobs.filter((job) => job.status === "QUEUED" || job.status === "RUNNING");
  const attentionJobs = jobs.filter((job) => job.status === "NEEDS_ATTENTION" || job.status === "FAILED");

  return (
    <div className={["space-y-3", surfaceClass].filter(Boolean).join(" ")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {technical ? t("godmode.backgroundJobs") : t("godmode.updates")}
          </p>
          <p className="text-xs text-slate-500">
            {technical
              ? "Setup, invite email, and schedule sync run here — not shown to company users."
              : UX_STATUS.workingInBackground}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadJobs()}
          disabled={loading}
          className="h-9 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-60"
        >
          {loading ? t("results.refreshing") : t("common.refresh")}
        </button>
      </div>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      {!error && jobs.length === 0 ? (
        <p className="text-sm text-slate-500">No background jobs yet for this workspace.</p>
      ) : null}

      {backgroundJobsBannerForRole(viewerRole, activeJobs.length) ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">
          {backgroundJobsBannerForRole(viewerRole, activeJobs.length)}
        </div>
      ) : null}

      {technical && attentionJobs.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          {attentionJobs.length} job(s) need attention — review advanced diagnostics below.
        </div>
      ) : null}

      {technical ? (
        <div className="space-y-2">
          {jobs.slice(0, 12).map((job) => (
            <div key={job.jobId} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-800">{job.type.replace(/_/g, " ")}</p>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusTone(job.status)}`}>
                  {job.statusBadge || job.status}
                </span>
              </div>
              {job.userMessage ? <p className="mt-1 text-xs text-slate-600">{job.userMessage}</p> : null}
              {job.technicalError ? (
                <p className="mt-1 font-mono text-[11px] text-amber-900">{job.technicalError}</p>
              ) : null}
              <p className="mt-1 text-[11px] text-slate-400">
                {job.createdAt ? new Date(job.createdAt).toLocaleString() : ""}
                {job.attempts ? ` · ${job.attempts} attempt(s)` : ""}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
