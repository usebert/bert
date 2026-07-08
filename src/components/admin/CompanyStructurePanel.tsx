import { useEffect, useMemo, useState } from "react";
import type { Role } from "../../permissions";
import { SectionHeader } from "../dashboard/DashboardPrimitives";
import {
  archiveCompanyDepartment,
  archiveCompanySite,
  archiveCompanyStructureArea,
  createCompanyDepartment,
  createCompanySite,
  createCompanyStructureArea,
  fetchCompanyStructure,
  type StructureEntity,
} from "../../services/companyStructureService";
import { canManageCompanyStructure } from "../../utils/companyStructureAccess";

type CompanyStructurePanelProps = {
  currentUserRole: Role;
  companyFolderId: string;
  masterSheetId: string;
  surfaceClass?: string;
  nestedClass?: string;
  onStructureChange?: (structure: {
    sites: StructureEntity[];
    departments: StructureEntity[];
    areas: StructureEntity[];
  }) => void;
};

function StructureList({
  title,
  items,
  onAdd,
  onArchive,
  addLabel,
  canManage,
  busy,
}: {
  title: string;
  items: StructureEntity[];
  onAdd: (name: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
  addLabel: string;
  canManage: boolean;
  busy: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const active = items.filter((item) => item.active !== false && item.status !== "inactive");

  const submit = async () => {
    const name = draft.trim();
    if (!name) {
      setError(`${title.slice(0, -1)} name is required.`);
      return;
    }
    setError(null);
    try {
      await onAdd(name);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not add ${title.toLowerCase()}.`);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p>
        <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-600">
          {active.length} active
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {active.length === 0 ? (
          <li className="text-sm text-slate-500">None yet.</li>
        ) : (
          active.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
            >
              <span className="truncate text-sm font-medium text-slate-800">{item.name}</span>
              {canManage ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onArchive(item.id)}
                  className="h-9 shrink-0 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                >
                  Archive
                </button>
              ) : null}
            </li>
          ))
        )}
      </ul>
      {canManage ? (
        <div className="mt-3 space-y-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`New ${title.slice(0, -1).toLowerCase()} name`}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
          />
          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() => void submit()}
            className="h-11 w-full rounded-xl bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
          >
            {addLabel}
          </button>
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function CompanyStructurePanel({
  currentUserRole,
  companyFolderId,
  masterSheetId,
  surfaceClass = "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm",
  nestedClass = "",
  onStructureChange,
}: CompanyStructurePanelProps) {
  const canManage = canManageCompanyStructure(currentUserRole);
  const [sites, setSites] = useState<StructureEntity[]>([]);
  const [departments, setDepartments] = useState<StructureEntity[]>([]);
  const [areas, setAreas] = useState<StructureEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [areaDraft, setAreaDraft] = useState({ name: "", siteId: "", departmentId: "" });
  const [areaError, setAreaError] = useState<string | null>(null);

  const activeSites = useMemo(
    () => sites.filter((item) => item.active !== false && item.status !== "inactive"),
    [sites],
  );
  const activeDepartments = useMemo(
    () => departments.filter((item) => item.active !== false && item.status !== "inactive"),
    [departments],
  );

  const publish = (next: {
    sites: StructureEntity[];
    departments: StructureEntity[];
    areas: StructureEntity[];
  }) => {
    setSites(next.sites);
    setDepartments(next.departments);
    setAreas(next.areas);
    onStructureChange?.(next);
  };

  const reload = async () => {
    if (!companyFolderId) {
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchCompanyStructure(companyFolderId, masterSheetId);
      publish({
        sites: data.sites || [],
        departments: data.departments || [],
        areas: data.areas || [],
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load company structure.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyFolderId, masterSheetId]);

  if (!canManage && sites.length === 0 && departments.length === 0 && areas.length === 0 && !loading) {
    return null;
  }

  return (
    <section className={surfaceClass}>
      <SectionHeader
        icon="grid"
        eyebrow="Company"
        title="Company Structure"
        subtitle="Sites, departments, and areas control where people can work. Role still controls what they can do."
        tone="onLight"
      />

      {loadError ? (
        <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {loadError}
        </p>
      ) : null}
      {loading ? <p className="mt-3 text-sm text-slate-500">Loading structure…</p> : null}

      <div className={`mt-4 grid gap-4 lg:grid-cols-3 ${nestedClass}`}>
        <StructureList
          title="Sites"
          items={sites}
          canManage={canManage}
          busy={busy}
          addLabel="Add site"
          onAdd={async (name) => {
            setBusy(true);
            try {
              const result = await createCompanySite(companyFolderId, { name, masterSheetId });
              publish({
                sites: result.sites || [...sites, result.site!].filter(Boolean),
                departments,
                areas,
              });
            } finally {
              setBusy(false);
            }
          }}
          onArchive={async (id) => {
            setBusy(true);
            try {
              const result = await archiveCompanySite(companyFolderId, id, { masterSheetId });
              publish({ sites: result.sites || sites, departments, areas });
            } finally {
              setBusy(false);
            }
          }}
        />

        <StructureList
          title="Departments"
          items={departments}
          canManage={canManage}
          busy={busy}
          addLabel="Add department"
          onAdd={async (name) => {
            setBusy(true);
            try {
              const result = await createCompanyDepartment(companyFolderId, { name, masterSheetId });
              publish({
                sites,
                departments: result.departments || [...departments, result.department!].filter(Boolean),
                areas,
              });
            } finally {
              setBusy(false);
            }
          }}
          onArchive={async (id) => {
            setBusy(true);
            try {
              const result = await archiveCompanyDepartment(companyFolderId, id, { masterSheetId });
              publish({ sites, departments: result.departments || departments, areas });
            } finally {
              setBusy(false);
            }
          }}
        />

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Areas</p>
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-600">
              {areas.filter((item) => item.active !== false && item.status !== "inactive").length} active
            </span>
          </div>
          <ul className="mt-3 space-y-2">
            {areas.filter((item) => item.active !== false && item.status !== "inactive").length === 0 ? (
              <li className="text-sm text-slate-500">None yet.</li>
            ) : (
              areas
                .filter((item) => item.active !== false && item.status !== "inactive")
                .map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{item.name}</p>
                      {(item.siteId || item.departmentId) && (
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {[
                            activeSites.find((site) => site.id === item.siteId)?.name,
                            activeDepartments.find((dept) => dept.id === item.departmentId)?.name,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                    {canManage ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setBusy(true);
                          void archiveCompanyStructureArea(companyFolderId, item.id, { masterSheetId })
                            .then((result) => {
                              publish({ sites, departments, areas: result.areas || areas });
                            })
                            .finally(() => setBusy(false));
                        }}
                        className="h-9 shrink-0 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                      >
                        Archive
                      </button>
                    ) : null}
                  </li>
                ))
            )}
          </ul>
          {canManage ? (
            <div className="mt-3 space-y-2">
              <input
                value={areaDraft.name}
                onChange={(event) => setAreaDraft((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="New area name"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
              />
              <select
                value={areaDraft.siteId}
                onChange={(event) => setAreaDraft((prev) => ({ ...prev, siteId: event.target.value }))}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
              >
                <option value="">Site (optional)</option>
                {activeSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
              <select
                value={areaDraft.departmentId}
                onChange={(event) =>
                  setAreaDraft((prev) => ({ ...prev, departmentId: event.target.value }))
                }
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
              >
                <option value="">Department (optional)</option>
                {activeDepartments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !areaDraft.name.trim()}
                onClick={() => {
                  const name = areaDraft.name.trim();
                  if (!name) {
                    setAreaError("Area name is required.");
                    return;
                  }
                  setAreaError(null);
                  setBusy(true);
                  void createCompanyStructureArea(companyFolderId, {
                    name,
                    siteId: areaDraft.siteId || undefined,
                    departmentId: areaDraft.departmentId || undefined,
                    masterSheetId,
                  })
                    .then((result) => {
                      publish({
                        sites,
                        departments,
                        areas: result.areas || [...areas, result.area!].filter(Boolean),
                      });
                      setAreaDraft({ name: "", siteId: "", departmentId: "" });
                    })
                    .catch((error) => {
                      setAreaError(error instanceof Error ? error.message : "Could not add area.");
                    })
                    .finally(() => setBusy(false));
                }}
                className="h-11 w-full rounded-xl bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
              >
                Add area
              </button>
              {areaError ? <p className="text-sm text-rose-700">{areaError}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
