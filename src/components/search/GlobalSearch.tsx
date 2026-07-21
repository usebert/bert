import { useCallback, useMemo } from "react";
import { GlobalSearchDialog } from "./GlobalSearchDialog";
import { useGlobalSearch, useGlobalSearchShortcut } from "../../hooks/useGlobalSearch";
import type { SearchNavigateTarget, SearchResultItem } from "../../presentation/searchPresentation";
import type { GlobalSearchSources } from "../../services/searchAdapters/globalSearchAdapters";

type Props = {
  sources: GlobalSearchSources;
  onNavigate: (target: SearchNavigateTarget, item: SearchResultItem) => void;
};

export function GlobalSearchHost({ sources, onNavigate }: Props) {
  const search = useGlobalSearch(sources);
  useGlobalSearchShortcut(search.openSearch, search.closeSearch, search.open);

  const handleActivate = useCallback(
    (item: SearchResultItem) => {
      search.rememberRecent(item);
      onNavigate(item.navigate, item);
      search.closeSearch();
    },
    [onNavigate, search],
  );

  const handleSelectIndex = useCallback(
    (index: number) => {
      const item = search.flatResults[index];
      if (item) handleActivate(item);
    },
    [handleActivate, search.flatResults],
  );

  return (
    <GlobalSearchDialog
      open={search.open}
      query={search.query}
      groups={search.groups}
      flatResults={search.flatResults}
      activeIndex={search.activeIndex}
      onQueryChange={search.setQuery}
      onClose={search.closeSearch}
      onSelectIndex={handleSelectIndex}
      onHoverIndex={search.setActiveIndex}
      onMoveActive={search.moveActive}
      onActivate={handleActivate}
    />
  );
}

export function useGlobalSearchControls(sources: GlobalSearchSources, onNavigate: (target: SearchNavigateTarget, item: SearchResultItem) => void) {
  const search = useGlobalSearch(sources);
  useGlobalSearchShortcut(search.openSearch, search.closeSearch, search.open);

  const activate = useCallback(
    (item: SearchResultItem) => {
      search.rememberRecent(item);
      onNavigate(item.navigate, item);
      search.closeSearch();
    },
    [onNavigate, search],
  );

  return useMemo(
    () => ({
      openSearch: search.openSearch,
      dialog: (
        <GlobalSearchDialog
          open={search.open}
          query={search.query}
          groups={search.groups}
          flatResults={search.flatResults}
          activeIndex={search.activeIndex}
          onQueryChange={search.setQuery}
          onClose={search.closeSearch}
          onSelectIndex={(index) => {
            const item = search.flatResults[index];
            if (item) activate(item);
          }}
          onHoverIndex={search.setActiveIndex}
          onMoveActive={search.moveActive}
          onActivate={activate}
        />
      ),
    }),
    [activate, search],
  );
}
