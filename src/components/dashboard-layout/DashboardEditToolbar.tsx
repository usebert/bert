type Props = {
  editMode: boolean;
  hiddenCount: number;
  showHiddenPanel: boolean;
  onEdit: () => void;
  onDone: () => void;
  onReset: () => void;
  onToggleHidden: () => void;
  disabled?: boolean;
};

export function DashboardEditToolbar({
  editMode,
  hiddenCount,
  showHiddenPanel,
  onEdit,
  onDone,
  onReset,
  onToggleHidden,
  disabled = false,
}: Props) {
  if (disabled) {
    return null;
  }

  if (!editMode) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm"
        >
          Edit dashboard
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-2xl border border-sky-300 bg-sky-50 px-3 py-2"
      role="status"
      aria-live="polite"
    >
      <span className="text-xs font-bold uppercase tracking-wide text-sky-800">Editing layout</span>
      <button
        type="button"
        onClick={onDone}
        className="inline-flex min-h-11 items-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white"
      >
        Done
      </button>
      <button
        type="button"
        onClick={onReset}
        className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800"
      >
        Reset layout
      </button>
      <button
        type="button"
        onClick={onToggleHidden}
        className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800"
      >
        {showHiddenPanel ? "Hide restore list" : `Show hidden cards${hiddenCount ? ` (${hiddenCount})` : ""}`}
      </button>
    </div>
  );
}
