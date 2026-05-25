import { useMemo } from "react";
import { SectionHeader } from "../dashboard/DashboardPrimitives";
import {
  SINGLE_WORKSPACE_AREA_ID,
  enabledAuditIdsForArea,
  resolveEffectiveAreaId,
} from "../../utils/areaAuditMapping";
import { activeAreas, isSingleWorkspaceMode } from "../../utils/companyAreas";
import type { Site } from "../../types/adminScreenProps";
import type { AuditTemplate } from "../../types/reportsScreenProps";
import type { AreaAuditMapping } from "../../utils/areaAuditMapping";

type AreaAuditsSectionProps = {
  sites: Site[];
  areaRestrictionsEnabled: boolean;
  templates: AuditTemplate[];
  areaAudits: AreaAuditMapping[];
  mappingSyncLoading?: boolean;
  mappingSyncError?: string | null;
  selectedAreaId?: string;
  variant?: "light" | "dark";
  surfaceClass?: string;
  onSelectArea?: (areaId: string) => void;
  onToggleAreaAudit: (areaId: string, auditId: string, enabled: boolean) => void;
};

export function AreaAuditsSection({
  sites,
  areaRestrictionsEnabled,
  templates,
  areaAudits,
  mappingSyncLoading = false,
  mappingSyncError = null,
  selectedAreaId = "",
  variant = "light",
  surfaceClass = "",
  onSelectArea,
  onToggleAreaAudit,
}: AreaAuditsSectionProps) {
  const isDark = variant === "dark";
  const active = useMemo(() => activeAreas(sites), [sites]);
  const singleWorkspace = isSingleWorkspaceMode(areaRestrictionsEnabled, sites);
  const workspaceAreaId = resolveEffectiveAreaId(areaRestrictionsEnabled, sites) || SINGLE_WORKSPACE_AREA_ID;

  const selectableAreas = useMemo(() => {
    if (singleWorkspace || active.length === 0) {
      return [{ id: workspaceAreaId, name: "Whole workspace" }];
    }
    return active;
  }, [singleWorkspace, active, workspaceAreaId]);

  const effectiveAreaId = selectedAreaId || selectableAreas[0]?.id || workspaceAreaId;
  const enabledIds = useMemo(
    () => new Set(enabledAuditIdsForArea(areaAudits, effectiveAreaId)),
    [areaAudits, effectiveAreaId],
  );

  const activeTemplates = useMemo(
    () => templates.filter((template) => template.active),
    [templates],
  );

  const chipBase = isDark
    ? "rounded-full border px-3 py-1.5 text-sm font-semibold transition"
    : "rounded-full border px-3 py-1.5 text-sm font-semibold transition";
  const chipIdle = isDark
    ? "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600"
    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300";
  const chipActive = isDark
    ? "border-[var(--bert-signal-orange)] bg-[rgba(249,115,22,0.14)] text-white"
    : "border-sky-200 bg-sky-50 text-sky-900";

  return (
    <section className={surfaceClass}>
      <SectionHeader
        icon="checklist"
        eyebrow="Area audits"
        title="Area audits"
        subtitle="Choose which checks apply to each area."
      />
      <p className={`mt-2 text-sm leading-6 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
        <span className={`font-semibold ${isDark ? "text-white" : "text-slate-800"}`}>Audit access</span> controls which
        checks a user can open.{" "}
        <span className={`font-semibold ${isDark ? "text-white" : "text-slate-800"}`}>Area access</span> controls where
        they work when area restrictions are on.{" "}
        <span className={`font-semibold ${isDark ? "text-white" : "text-slate-800"}`}>Schedules</span> control when checks
        are due.
      </p>

      {mappingSyncError ? (
        <p
          className={`mt-3 rounded-2xl border px-3 py-2 text-sm ${isDark ? "border-amber-500/40 bg-amber-950/30 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-900"}`}
        >
          {mappingSyncError}
        </p>
      ) : null}

      {mappingSyncLoading ? (
        <p className={`mt-3 text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>Syncing area audits…</p>
      ) : null}

      <div className={`mt-4 space-y-4`}>
        {selectableAreas.length > 1 && onSelectArea ? (
          <div>
            <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Select area
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {selectableAreas.map((area) => (
                <button
                  key={area.id}
                  type="button"
                  onClick={() => onSelectArea(area.id)}
                  className={[chipBase, effectiveAreaId === area.id ? chipActive : chipIdle].join(" ")}
                >
                  {area.name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className={`text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>
            {singleWorkspace
              ? "Single-workspace mode — checks below apply to the whole company workspace."
              : `Configuring checks for ${selectableAreas.find((a) => a.id === effectiveAreaId)?.name || "this area"}.`}
          </p>
        )}

        {activeTemplates.length === 0 ? (
          <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Add active audit templates first, then choose which areas they apply to.
          </p>
        ) : (
          <div className="space-y-2">
            {activeTemplates.map((template) => {
              const checked = enabledIds.has(template.id);
              return (
                <label
                  key={`${effectiveAreaId}-${template.id}`}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${isDark ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white"}`}
                >
                  <div className="min-w-0">
                    <p className={`truncate text-sm font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>
                      {template.name}
                    </p>
                    {template.source ? (
                      <p className={`mt-0.5 truncate text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        {template.source}
                      </p>
                    ) : null}
                  </div>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleAreaAudit(effectiveAreaId, template.id, !checked)}
                    className="h-4 w-4 shrink-0 rounded border-slate-300 text-sky-600"
                  />
                </label>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
