import { useEffect, useState } from "react";
import type { NavItemId } from "../../types/navigation";
import type { LolerEquipmentSummary } from "../../types/loler";
import { fetchLolerEquipment, readCachedLolerEquipment } from "../../services/lolerService";

type Props = {
  companyFolderId: string;
  onNavigate: (screen: NavItemId) => void;
};

/**
 * Small self-loading LOLER summary — overdue + due within 30 days only.
 * Reads its own dedicated endpoint; never touches existing dashboard calculations.
 */
export function LolerSummaryCard({ companyFolderId, onNavigate }: Props) {
  const folderId = String(companyFolderId || "").trim();
  const [summary, setSummary] = useState<LolerEquipmentSummary | null>(
    () => readCachedLolerEquipment(folderId)?.summary || null,
  );
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!folderId) {
      return;
    }
    let cancelled = false;
    void fetchLolerEquipment(folderId)
      .then((result) => {
        if (!cancelled && result.summary) {
          setSummary(result.summary);
          setLoadFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [folderId]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-black text-slate-900">LOLER examinations</h2>
        <button
          type="button"
          onClick={() => onNavigate("loler")}
          className="text-sm font-semibold text-slate-700 underline-offset-2 hover:underline"
        >
          Open LOLER
        </button>
      </div>
      {summary ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-red-100 bg-red-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Overdue</p>
            <p className="mt-1 text-2xl font-black text-red-800">{summary.overdue}</p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Due within 30 days</p>
            <p className="mt-1 text-2xl font-black text-amber-800">{summary.dueSoon}</p>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">
          {loadFailed ? "LOLER summary is unavailable right now." : "Loading LOLER summary…"}
        </p>
      )}
    </section>
  );
}
