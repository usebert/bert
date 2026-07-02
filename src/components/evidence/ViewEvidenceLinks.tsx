import type { MouseEvent } from "react";
import type { ViewableEvidenceLink } from "../../utils/driveEvidenceLinks";

const linkButtonClass =
  "inline-flex items-center rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800";

const openLinkClass =
  "shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[0.7rem] font-semibold text-slate-800 hover:bg-slate-50";

type ViewEvidenceLinksProps = {
  items: ViewableEvidenceLink[];
  triggerLabel?: string;
  onActivate?: (event: MouseEvent) => void;
};

export function ViewEvidenceLinks({
  items,
  triggerLabel = "View evidence",
  onActivate,
}: ViewEvidenceLinksProps) {
  const viewable = items.filter((item) => item.url);
  if (viewable.length === 0) {
    return null;
  }

  const stopRowClick = (event: MouseEvent) => {
    event.stopPropagation();
    onActivate?.(event);
  };

  if (viewable.length === 1) {
    const item = viewable[0];
    return (
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={stopRowClick}
        className={linkButtonClass}
      >
        {triggerLabel}
      </a>
    );
  }

  return (
    <div className="space-y-1.5" onClick={stopRowClick} role="presentation">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {triggerLabel}
      </p>
      <ul className="space-y-1">
        {viewable.map((item) => (
          <li
            key={`${item.id}-${item.url}`}
            className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5"
          >
            <div className="min-w-0">
              {item.subtitle ? (
                <p className="truncate text-[0.65rem] font-medium text-slate-500">{item.subtitle}</p>
              ) : null}
              <p className="truncate text-xs font-medium text-slate-800">{item.name}</p>
            </div>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className={openLinkClass}
            >
              Open
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
