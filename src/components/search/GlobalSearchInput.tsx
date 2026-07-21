import { useId } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
};

export function GlobalSearchInput({ value, onChange, onKeyDown, inputRef }: Props) {
  const inputId = useId();

  return (
    <div className="border-b border-[var(--ui-border)] px-4 py-3 sm:px-5">
      <label htmlFor={inputId} className="sr-only">
        Search
      </label>
      <div className="relative">
        <svg
          viewBox="0 0 24 24"
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--ui-text-muted)]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          id={inputId}
          ref={inputRef}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search..."
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-h-[3rem] w-full rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] py-3 pr-4 pl-10 text-base text-[var(--ui-text-primary)] outline-none transition focus:border-[var(--ui-border-focus)] focus:bg-[var(--ui-bg-surface)]"
        />
      </div>
    </div>
  );
}
