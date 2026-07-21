import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RECENT_SEARCHES_KEY,
  RECENT_SEARCHES_MAX,
  type SearchResultGroup,
  type SearchResultItem,
  type StoredRecentSearch,
} from "../presentation/searchPresentation";
import {
  buildGlobalSearchIndex,
  filterSearchResults,
  groupSearchResults,
  type GlobalSearchSources,
} from "../services/searchAdapters/globalSearchAdapters";

function readRecentSearches(): StoredRecentSearch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredRecentSearch[];
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_SEARCHES_MAX) : [];
  } catch {
    return [];
  }
}

function writeRecentSearches(items: StoredRecentSearch[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(items.slice(0, RECENT_SEARCHES_MAX)));
}

export function useGlobalSearch(sources: GlobalSearchSources) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentSearches, setRecentSearches] = useState<StoredRecentSearch[]>(() => readRecentSearches());

  const index = useMemo(() => buildGlobalSearchIndex(sources), [sources]);

  const filtered = useMemo(() => filterSearchResults(index, query), [index, query]);

  const recentItems = useMemo<SearchResultItem[]>(
    () =>
      recentSearches.map((item) => ({
        ...item,
        searchText: [item.title, item.typeLabel, item.status, item.site, item.description].filter(Boolean).join(" "),
      })),
    [recentSearches],
  );

  const groups = useMemo<SearchResultGroup[]>(() => {
    if (!query.trim()) {
      if (recentItems.length === 0) return [];
      return [{ id: "recent", label: "Recent", items: recentItems }];
    }
    return groupSearchResults(filtered);
  }, [filtered, query, recentItems]);

  const flatResults = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const rememberRecent = useCallback((item: SearchResultItem) => {
    const next: StoredRecentSearch = {
      id: item.id,
      kind: item.kind,
      title: item.title,
      typeLabel: item.typeLabel,
      status: item.status,
      site: item.site,
      description: item.description,
      navigate: item.navigate,
    };
    setRecentSearches((current) => {
      const without = current.filter((entry) => entry.id !== next.id);
      const merged = [next, ...without].slice(0, RECENT_SEARCHES_MAX);
      writeRecentSearches(merged);
      return merged;
    });
  }, []);

  const openSearch = useCallback(() => setOpen(true), []);
  const closeSearch = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);

  const moveActive = useCallback(
    (delta: number) => {
      if (flatResults.length === 0) return;
      setActiveIndex((current) => {
        const next = current + delta;
        if (next < 0) return flatResults.length - 1;
        if (next >= flatResults.length) return 0;
        return next;
      });
    },
    [flatResults.length],
  );

  return {
    open,
    query,
    setQuery,
    groups,
    flatResults,
    activeIndex,
    setActiveIndex,
    openSearch,
    closeSearch,
    moveActive,
    rememberRecent,
  };
}

export function useGlobalSearchShortcut(openSearch: () => void, closeSearch: () => void, open: boolean) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMetaK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isMetaK) {
        event.preventDefault();
        if (open) {
          closeSearch();
        } else {
          openSearch();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeSearch, open, openSearch]);
}
