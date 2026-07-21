import { useMemo, useState } from "react";
import { Icon } from "../ui/Icon";

export type CompanySwitcherOption = {
  id: string;
  name: string;
};

type Props = {
  companyName: string;
  showSwitcher: boolean;
  options: CompanySwitcherOption[];
  selectedId: string;
  loading?: boolean;
  error?: string | null;
  onSelect: (companyId: string) => void;
  onRetry?: () => void;
  platformScope?: boolean;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "B";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

export function CompanyContextButton({
  companyName,
  showSwitcher,
  options,
  selectedId,
  loading = false,
  error = null,
  onSelect,
  onRetry,
  platformScope = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.name.toLowerCase().includes(q));
  }, [options, query]);

  const label = platformScope ? "All workspaces" : companyName || "No company selected";

  if (!showSwitcher) {
    return (
      <div className="hidden min-w-0 max-w-[10rem] items-center gap-2 sm:flex" title={label}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ui-bg-muted)] text-xs font-semibold text-[var(--ui-text-secondary)]">
          {initials(label)}
        </span>
        <span className="truncate text-xs font-semibold text-[var(--ui-text-secondary)]">{label}</span>
      </div>
    );
  }

  return (
    <div className="relative hidden min-w-0 sm:block">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex min-h-11 max-w-[12rem] items-center gap-2 rounded-full border border-[var(--ui-border)] bg-[var(--ui-bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ui-text-primary)]"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Switch company, current: ${label}`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ui-bg-muted)] text-[10px] font-bold">
          {initials(label)}
        </span>
        <span className="truncate">{label}</span>
        <Icon size="sm" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </Icon>
      </button>
      {open ? (
        <>
          <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close company switcher" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-surface)] p-3 shadow-xl"
            role="listbox"
            aria-label="Switch company"
          >
            <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ui-text-muted)]">Switch company</p>
            {options.length > 6 ? (
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search companies"
                className="mb-2 min-h-11 w-full rounded-xl border border-[var(--ui-border)] px-3 text-sm"
              />
            ) : null}
            {loading ? <p className="px-2 py-3 text-sm text-[var(--ui-text-secondary)]">Loading companies…</p> : null}
            {error ? (
              <div className="space-y-2 px-2 py-2">
                <p className="text-sm text-[var(--ui-text-primary)]">Companies could not be loaded.</p>
                {onRetry ? (
                  <button type="button" onClick={onRetry} className="min-h-11 rounded-lg px-2 text-sm font-semibold underline">
                    Retry
                  </button>
                ) : null}
              </div>
            ) : null}
            {!loading && !error ? (
              <div className="max-h-[min(50dvh,18rem)] space-y-1 overflow-y-auto">
                {filtered.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={option.id === selectedId}
                    onClick={() => {
                      onSelect(option.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={[
                      "flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium",
                      option.id === selectedId
                        ? "bg-[var(--ui-accent-subtle)] text-[var(--ui-text-primary)]"
                        : "hover:bg-[var(--ui-bg-muted)]",
                    ].join(" ")}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ui-bg-muted)] text-[10px] font-bold">
                      {initials(option.name)}
                    </span>
                    <span className="truncate">{option.name}</span>
                  </button>
                ))}
                {filtered.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-[var(--ui-text-secondary)]">No companies match your search.</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
