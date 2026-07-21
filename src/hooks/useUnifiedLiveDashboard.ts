import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shouldRenderLiveOperationalDashboard, type Role } from "../permissions";
import {
  invalidateLiveDashboardCache,
  loadLiveDashboardCached,
} from "../services/appDataCacheService";
import {
  applyLocalSyncStatusToLiveDashboard,
  emptyLiveDashboardPayload,
} from "../services/liveDashboardService";
import type { LiveDashboardPayload } from "../types/liveDashboard";

type UseUnifiedLiveDashboardInput = {
  companyFolderId?: string;
  masterSheetId?: string;
  companyName?: string;
  userEmail?: string;
  role: Role;
  pendingSyncCount?: number;
  failedSyncCount?: number;
  enabled?: boolean;
};

export function useUnifiedLiveDashboard({
  companyFolderId = "",
  masterSheetId = "",
  companyName = "",
  userEmail = "",
  role,
  pendingSyncCount = 0,
  failedSyncCount = 0,
  enabled = true,
}: UseUnifiedLiveDashboardInput) {
  const [payload, setPayload] = useState<LiveDashboardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestSeq = useRef(0);

  const contextReady = Boolean(enabled && companyFolderId && masterSheetId && shouldRenderLiveOperationalDashboard(role));

  const load = useCallback(
    async (mode: "initial" | "manual" | "background") => {
      if (!contextReady) {
        return;
      }
      const seq = ++requestSeq.current;
      if (mode === "initial" && !payload) {
        setLoading(true);
      }
      try {
        const result = await loadLiveDashboardCached(
          { companyFolderId, masterSheetId, companyName, userEmail },
          {
            manualRefresh: mode === "manual",
            query: { syncQueued: pendingSyncCount, syncFailed: failedSyncCount },
          },
        );
        if (seq !== requestSeq.current) {
          return;
        }
        setPayload(result.data);
        setError(result.refreshWarning || "");
        if (result.revalidatePromise) {
          void result.revalidatePromise.then((fresh) => {
            if (seq === requestSeq.current && fresh) {
              setPayload(fresh as LiveDashboardPayload);
            }
          });
        }
      } catch (loadError) {
        if (seq === requestSeq.current) {
          setError(loadError instanceof Error ? loadError.message : "Could not load live dashboard data.");
        }
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
        }
      }
    },
    [companyFolderId, masterSheetId, companyName, userEmail, pendingSyncCount, failedSyncCount, contextReady, payload],
  );

  useEffect(() => {
    if (!contextReady) {
      setPayload(null);
      setLoading(false);
      setError("");
      return;
    }
    void load("initial");
  }, [companyFolderId, masterSheetId, userEmail, contextReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!contextReady) {
      return;
    }
    invalidateLiveDashboardCache({ companyFolderId, userEmail });
  }, [companyFolderId, userEmail, pendingSyncCount, failedSyncCount, contextReady]);

  const view = useMemo(
    () =>
      applyLocalSyncStatusToLiveDashboard(payload ?? emptyLiveDashboardPayload(), {
        queued: pendingSyncCount,
        failed: failedSyncCount,
      }),
    [payload, pendingSyncCount, failedSyncCount],
  );

  return {
    enabled: contextReady,
    payload: contextReady ? view : null,
    loading: contextReady ? loading && !payload : false,
    error: contextReady ? error : "",
    retry: () => void load("manual"),
  };
}
