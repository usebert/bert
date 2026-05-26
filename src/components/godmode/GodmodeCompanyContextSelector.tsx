import type { CompanyFolder } from "../../types/dashboardScreenProps";

type Props = {
  folders: CompanyFolder[];
  selectedFolderId: string;
  selectedFolderName?: string;
  onSelectFolder: (folderId: string) => void;
  onNewCompany: () => void;
  themeMode?: "light" | "dark";
};

export function GodmodeCompanyContextSelector({
  folders,
  selectedFolderId,
  selectedFolderName,
  onSelectFolder,
  onNewCompany,
  themeMode = "light",
}: Props) {
  const onDark = themeMode === "dark";
  const shellClass = onDark
    ? "border-white/10 bg-slate-900/50"
    : "border-slate-200 bg-gradient-to-b from-white to-slate-50";
  const labelClass = onDark ? "text-slate-400" : "text-slate-500";
  const bodyClass = onDark ? "text-slate-200" : "text-slate-700";
  const selectClass = onDark
    ? "border-slate-600 bg-slate-950 text-white"
    : "border-slate-200 bg-white text-slate-900";
  const ctaClass = onDark
    ? "border-orange-400/60 bg-orange-500/15 text-orange-100 hover:bg-orange-500/25"
    : "border-orange-300 bg-orange-50 text-orange-900 hover:bg-orange-100";

  if (folders.length === 0 && !selectedFolderId) {
    return (
      <section className={`mb-4 rounded-2xl border px-4 py-3 ${shellClass}`}>
        <p className={`text-sm ${bodyClass}`}>
          Select a company to work on, or create a new company workspace.
        </p>
        <button
          type="button"
          onClick={onNewCompany}
          className={`mt-3 inline-flex h-10 items-center rounded-xl border px-4 text-sm font-semibold ${ctaClass}`}
        >
          + New company
        </button>
      </section>
    );
  }

  return (
    <section className={`mb-4 rounded-2xl border px-4 py-3 ${shellClass}`}>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <span className={`text-xs font-semibold uppercase tracking-[0.18em] ${labelClass}`}>Working on:</span>
        <select
          value={selectedFolderId}
          onChange={(event) => onSelectFolder(event.target.value)}
          className={`h-10 min-w-[12rem] max-w-full flex-1 rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-orange-200 ${selectClass}`}
          aria-label="Select company workspace"
        >
          <option value="">Select a company…</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onNewCompany}
          className={`inline-flex h-10 shrink-0 items-center rounded-xl border px-4 text-sm font-semibold ${ctaClass}`}
        >
          + New company
        </button>
      </div>
      {selectedFolderId && selectedFolderName ? (
        <p className={`mt-2 text-sm ${bodyClass}`}>
          Currently working on: <span className="font-semibold">{selectedFolderName}</span>
        </p>
      ) : (
        <p className={`mt-2 text-sm ${bodyClass}`}>
          Select a company to work on, or create a new company workspace.
        </p>
      )}
    </section>
  );
}
