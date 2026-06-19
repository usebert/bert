import { EmptyPanel } from "../components/dashboard/DashboardPrimitives";
import { SectionIntro } from "../components/SectionIntro";
import {
  COMPANY_GOOGLE_FORMS_LOADING_MESSAGE,
  COMPANY_GOOGLE_FORMS_SYNCING_MESSAGE,
} from "../services/companyFormsService";
import type { GoogleFormsScreenProps } from "../types/googleFormsScreenProps";

function GoogleFormsScreenIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

function formatModifiedTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return iso || "—";
  }
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(parsed));
  } catch {
    return iso;
  }
}

export function GoogleFormsScreen({
  forms,
  loading,
  loadError,
  status,
  syncing,
  syncError,
  syncMessage,
  googleConnected,
  canSync,
  onSync,
}: GoogleFormsScreenProps) {
  const sortedForms = [...forms].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <GoogleFormsScreenIcon />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Google Forms</h1>
            <p className="text-sm text-slate-500">Live forms stored in this company&apos;s Google Forms folder.</p>
          </div>
        </div>
        {canSync ? (
          <button
            type="button"
            onClick={onSync}
            disabled={loading || syncing || !googleConnected}
            className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {syncing ? "Syncing…" : "Sync to workbook"}
          </button>
        ) : (
          <p className="max-w-xs text-sm text-slate-500">Sync is available to company admins when Google is connected.</p>
        )}
      </div>

      <SectionIntro text="Forms are read from your company Google Forms folder. Sync writes them to the GoogleFormTemplates tab in your company workbook." />

      {!googleConnected ? (
        <EmptyPanel
          title="Connect Google first"
          text="Connect Google in Account settings, then return here to load forms from your company folder."
        />
      ) : loading ? (
        <EmptyPanel title={COMPANY_GOOGLE_FORMS_LOADING_MESSAGE} text="Reading forms from your company folder…" />
      ) : loadError ? (
        <EmptyPanel title="Could not load Google Forms" text={loadError} />
      ) : status === "empty" ? (
        <EmptyPanel
          title="No Google Forms found"
          text="This company folder has a Google Forms folder, but it does not contain any forms yet."
        />
      ) : sortedForms.length === 0 ? (
        <EmptyPanel title="No Google Forms to show" text="Try syncing again after adding forms to your company folder." />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {sortedForms.length} form{sortedForms.length === 1 ? "" : "s"} in this company workspace.
          </p>
          {sortedForms.map((form) => (
            <div
              key={form.driveFileId || form.formId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[1.35rem] border border-slate-200/80 bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{form.name}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {form.modifiedTime ? `Updated ${formatModifiedTime(form.modifiedTime)}` : "Google Form"}
                </p>
              </div>
              {form.webViewLink ? (
                <a
                  href={form.webViewLink}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-200"
                >
                  Open form
                </a>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {syncing ? (
        <EmptyPanel title={COMPANY_GOOGLE_FORMS_SYNCING_MESSAGE} text="Updating GoogleFormTemplates in your company workbook…" />
      ) : null}
      {syncError ? <EmptyPanel title="Sync failed" text={syncError} /> : null}
      {syncMessage && !syncError ? (
        <p className="text-sm font-medium text-emerald-800">{syncMessage}</p>
      ) : null}
    </div>
  );
}
