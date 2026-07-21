import { useEffect, useRef } from "react";
import { Dialog, DialogBody } from "../ui/Dialog";
import { GlobalSearchInput } from "./GlobalSearchInput";
import { GlobalSearchResults } from "./GlobalSearchResults";
import type { SearchResultItem } from "../../presentation/searchPresentation";
import type { SearchResultGroup } from "../../presentation/searchPresentation";

type Props = {
  open: boolean;
  query: string;
  groups: SearchResultGroup[];
  flatResults: SearchResultItem[];
  activeIndex: number;
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onSelectIndex: (index: number) => void;
  onHoverIndex: (index: number) => void;
  onMoveActive: (delta: number) => void;
  onActivate: (item: SearchResultItem) => void;
};

export function GlobalSearchDialog({
  open,
  query,
  groups,
  flatResults,
  activeIndex,
  onQueryChange,
  onClose,
  onSelectIndex,
  onHoverIndex,
  onMoveActive,
  onActivate,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onMoveActive(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onMoveActive(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = flatResults[activeIndex];
      if (item) onActivate(item);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="xl" className="max-w-2xl" labelledBy="global-search-title">
      <p id="global-search-title" className="sr-only">
        Global search
      </p>
      <GlobalSearchInput
        value={query}
        onChange={onQueryChange}
        onKeyDown={handleKeyDown}
        inputRef={inputRef}
      />
      <DialogBody className="max-h-[min(60dvh,520px)] py-3">
        <GlobalSearchResults
          groups={groups}
          activeIndex={activeIndex}
          onSelect={onSelectIndex}
          onHover={onHoverIndex}
          emptyLabel={query.trim() ? "No matching records" : "Start typing to search your workspace"}
        />
      </DialogBody>
      <div className="border-t border-[var(--ui-border)] px-4 py-2 text-[11px] text-[var(--ui-text-muted)] sm:px-5">
        <span className="mr-3">↑↓ Navigate</span>
        <span className="mr-3">↵ Open</span>
        <span>Esc Close</span>
      </div>
    </Dialog>
  );
}
