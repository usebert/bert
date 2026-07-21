import type { SearchResultItem, SearchResultKind } from "../../presentation/searchPresentation";

function SearchResultIcon({ kind }: { kind: SearchResultKind }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--ui-bg-muted)] text-[var(--ui-text-secondary)]">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        {kind === "action" || kind === "audit" || kind === "completed-audit" ? (
          <path d="M9 12l2 2 4-4M9 5h6a2 2 0 012 2v12H7V7a2 2 0 012-2z" strokeLinecap="round" strokeLinejoin="round" />
        ) : kind === "document" || kind === "document-library" ? (
          <path d="M7 4h7l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2z" strokeLinecap="round" strokeLinejoin="round" />
        ) : kind === "equipment" ? (
          <path d="M12 6v12M8 10h8M6 18h12" strokeLinecap="round" strokeLinejoin="round" />
        ) : kind === "person" ? (
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" strokeLinecap="round" strokeLinejoin="round" />
        ) : kind === "briefing" ? (
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" />
        ) : kind === "schedule" ? (
          <path d="M8 7V3m8 4V3M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </span>
  );
}

type Props = {
  item: SearchResultItem;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
};

export function SearchResultRow({ item, active, onSelect, onHover }: Props) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={onHover}
      className={[
        "flex w-full min-h-[3.5rem] items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition motion-reduce:transition-none",
        active
          ? "bg-[var(--ui-accent-subtle)] ring-1 ring-[color-mix(in_srgb,var(--ui-accent)_35%,var(--ui-border))]"
          : "hover:bg-[var(--ui-bg-muted)]",
      ].join(" ")}
    >
      <SearchResultIcon kind={item.kind} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-semibold text-[var(--ui-text-primary)]">{item.title}</span>
          <span className="rounded-full bg-[var(--ui-bg-muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ui-text-secondary)]">
            {item.typeLabel}
          </span>
          {item.status ? (
            <span className="text-[11px] font-medium text-[var(--ui-text-secondary)]">{item.status}</span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs text-[var(--ui-text-secondary)]">
          {[item.site, item.description].filter(Boolean).join(" · ")}
        </span>
      </span>
    </button>
  );
}
