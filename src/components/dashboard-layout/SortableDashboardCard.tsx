import type { ReactNode, CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Props = {
  id: string;
  editMode: boolean;
  hideable: boolean;
  onHide?: () => void;
  children: ReactNode;
  className?: string;
};

function DragHandleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
      <circle cx="9" cy="7" r="1.5" />
      <circle cx="15" cy="7" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="17" r="1.5" />
      <circle cx="15" cy="17" r="1.5" />
    </svg>
  );
}

export function SortableDashboardCard({ id, editMode, hideable, onHide, children, className = "" }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !editMode,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
    zIndex: isDragging ? 20 : undefined,
  };

  if (!editMode) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        className,
        "relative rounded-2xl ring-2 ring-sky-300/80 ring-offset-2",
        isDragging ? "shadow-lg" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
        {hideable && onHide ? (
          <button
            type="button"
            onClick={onHide}
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm"
          >
            Hide
          </button>
        ) : null}
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 touch-none items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 shadow-sm"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <DragHandleIcon />
        </button>
      </div>
      <div className={isDragging ? "pointer-events-none" : undefined}>{children}</div>
    </div>
  );
}
