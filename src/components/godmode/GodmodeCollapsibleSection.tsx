import { useState, type ReactNode } from "react";
import { BERT_LIGHT_SURFACE } from "../../styles/bertText";

type Props = {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  openLabel?: string;
  closeLabel?: string;
  surfaceClass?: string;
  children: ReactNode;
};

export function GodmodeCollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  openLabel = "Show",
  closeLabel = "Hide",
  surfaceClass = BERT_LIGHT_SURFACE,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={surfaceClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold tracking-tight text-slate-900">{title}</h3>
          {summary && !open ? <p className="mt-1 text-sm leading-relaxed text-slate-600">{summary}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-white"
        >
          {open ? closeLabel : openLabel}
        </button>
      </div>
      {open ? <div className="mt-4 border-t border-slate-100 pt-4">{children}</div> : null}
    </section>
  );
}
