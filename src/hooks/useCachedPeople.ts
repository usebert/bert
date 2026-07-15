import { useEffect, useRef, useState } from "react";
import {
  loadCompanyMembersCached,
  loadScheduleAssigneesCached,
  readPeopleCache,
  peopleCacheStorageKey,
  companyMembersPeopleScope,
  scheduleAssigneesPeopleScope,
  type CompanyMembersCachedPayload,
  type PeopleSwrOptions,
  type ScheduleAssigneesCachedPayload,
} from "../services/peopleCache";
import type { CompanyScheduleContext } from "../services/scheduleService";

/**
 * Optional hook for People/assignee screens that need local SWR state.
 * App.tsx remains the primary owner for shared dashboard-wide people state.
 */
export function useCachedCompanyMembers(input: {
  enabled: boolean;
  apiUrl: (path: string) => string;
  companyId: string;
  masterSheetId?: string;
  companyName?: string;
  options?: PeopleSwrOptions;
}) {
  const cached = input.companyId
    ? readPeopleCache<CompanyMembersCachedPayload>(
        peopleCacheStorageKey(input.companyId, companyMembersPeopleScope()),
      )
    : null;
  const [members, setMembers] = useState(cached?.data.members || []);
  const [loading, setLoading] = useState(!cached?.data.members?.length);
  const [refreshWarning, setRefreshWarning] = useState<string | undefined>();
  const optionsRef = useRef(input.options);
  optionsRef.current = input.options;

  useEffect(() => {
    if (!input.enabled || !input.companyId) {
      setMembers([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const seed = readPeopleCache<CompanyMembersCachedPayload>(
      peopleCacheStorageKey(input.companyId, companyMembersPeopleScope()),
    );
    if (seed?.data.members?.length) {
      setMembers(seed.data.members);
      setLoading(false);
    } else {
      setLoading(true);
    }

    void (async () => {
      try {
        const result = await loadCompanyMembersCached(
          input.apiUrl,
          {
            companyId: input.companyId,
            masterSheetId: input.masterSheetId,
            companyName: input.companyName,
          },
          optionsRef.current,
        );
        if (cancelled) {
          return;
        }
        setMembers(result.data.members);
        setRefreshWarning(result.refreshWarning);
        setLoading(false);
        if (result.revalidatePromise) {
          const fresh = await result.revalidatePromise;
          if (!cancelled && fresh && "members" in fresh) {
            setMembers(fresh.members);
            setRefreshWarning(undefined);
          }
        }
      } catch {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [input.enabled, input.apiUrl, input.companyId, input.masterSheetId, input.companyName]);

  return { members, loading, refreshWarning };
}

export function useCachedScheduleAssignees(input: {
  enabled: boolean;
  companyContext: CompanyScheduleContext;
  selectedArea?: string;
  includeDiagnostics?: boolean;
  options?: PeopleSwrOptions;
}) {
  const companyFolderId = String(
    input.companyContext.companyFolderId || input.companyContext.companyId || "",
  ).trim();
  const selectedArea = String(input.selectedArea || "").trim();
  const cached = companyFolderId
    ? readPeopleCache<ScheduleAssigneesCachedPayload>(
        peopleCacheStorageKey(companyFolderId, scheduleAssigneesPeopleScope(selectedArea)),
      )
    : null;
  const [assignees, setAssignees] = useState(cached?.data.assignees || []);
  const [loading, setLoading] = useState(!cached?.data.assignees?.length);
  const [refreshWarning, setRefreshWarning] = useState<string | undefined>();

  useEffect(() => {
    if (!input.enabled || !companyFolderId) {
      setAssignees([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const seed = readPeopleCache<ScheduleAssigneesCachedPayload>(
      peopleCacheStorageKey(companyFolderId, scheduleAssigneesPeopleScope(selectedArea)),
    );
    if (seed?.data.assignees?.length) {
      setAssignees(seed.data.assignees);
      setLoading(false);
    } else {
      setLoading(true);
    }

    void (async () => {
      try {
        const result = await loadScheduleAssigneesCached(input.companyContext, {
          ...input.options,
          selectedArea,
          includeDiagnostics: input.includeDiagnostics,
        });
        if (cancelled) {
          return;
        }
        setAssignees(result.data.assignees);
        setRefreshWarning(result.refreshWarning);
        setLoading(false);
        if (result.revalidatePromise) {
          const fresh = await result.revalidatePromise;
          if (!cancelled && fresh && "assignees" in fresh) {
            setAssignees(fresh.assignees);
            setRefreshWarning(undefined);
          }
        }
      } catch {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    input.enabled,
    companyFolderId,
    selectedArea,
    input.includeDiagnostics,
    input.companyContext.companyFolderId,
    input.companyContext.companyId,
    input.companyContext.masterSheetId,
    input.companyContext.companyName,
  ]);

  return { assignees, loading, refreshWarning };
}
