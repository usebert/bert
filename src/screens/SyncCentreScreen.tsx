import { useTranslation } from "react-i18next";
import type { Role } from "../permissions";
import { getRolePermissions } from "../permissions";
import { translateSyncItemType, translateSyncQueueStatus } from "../i18n/statusLabels";
import type { SyncQueueItem, SyncStatus } from "../types/sync";
import { EmptyPanel, MiniMetric } from "../components/dashboard/DashboardPrimitives";
import { darkPanelBody, darkPanelEyebrow, darkPanelShell, darkPanelTitleLg } from "../styles/darkPanel";
import { AnimatedButton } from "../components/animation/AnimatedButton";
import { StatusPulse, type SyncVisualState } from "../components/animation/StatusPulse";
import { slatePrimaryCtaInteract } from "../styles/interactions";
import { formatUkDateTime } from "../utils/ukDateTime";

function queueItemVisualState(status: SyncStatus): SyncVisualState {
  if (status === "Syncing") return "syncing";
  if (status === "Synced") return "synced";
  if (status === "Failed" || status === "Conflict") return "failed";
  if (status === "Pending Sync") return "waiting";
  return "idle";
}

function queueTimeLabel(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return formatUkDateTime(parsed);
}

function SyncCentreAppIcon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  const shared = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  };
  if (name === "sync") {
    return (
      <svg {...shared}>
        <path d="M3 12a8 8 0 0 1 13.66-5.66L19 8" />
        <path d="M21 12a8 8 0 0 1-13.66 5.66L5 16" />
        <path d="M19 3v5h-5" />
        <path d="M5 21v-5h5" />
      </svg>
    );
  }
  return null;
}

export function SyncCentreScreen({
  currentUser,
  syncQueue,
  offlineQueueCount,
  onRetryItem,
  onForceSyncItem,
  onDismissItem,
  onSyncAll,
  syncingAll,
}: {
  currentUser: { username: string; password: string; role: Role; name: string };
  syncQueue: SyncQueueItem[];
  offlineQueueCount: number;
  onRetryItem: (localId: string) => void;
  onForceSyncItem: (localId: string) => void;
  onDismissItem?: (localId: string) => void;
  onSyncAll?: () => void;
  syncingAll?: boolean;
}) {
  const { t } = useTranslation();
  const permissions = getRolePermissions(currentUser.role);
  const waitingCount = syncQueue.filter((item) => item.status === "Pending Sync" || item.status === "Syncing").length;
  const failedCount = syncQueue.filter((item) => item.status === "Failed" || item.status === "Conflict").length;
  const hasWaitingWork = waitingCount > 0 || offlineQueueCount > 0;
  const hasRetryableWork = hasWaitingWork || failedCount > 0;

  return (
    <div className="space-y-4">
      <section className={darkPanelShell}>
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white">
            <SyncCentreAppIcon name="sync" className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className={darkPanelEyebrow}>{t("syncCentre.operationalTrust")}</p>
            <h2 className={darkPanelTitleLg}>{t("syncCentre.title")}</h2>
            <p className={["mt-2", darkPanelBody].join(" ")}>
              Field work, evidence, and admin edits stay visible here until they reach your company sheet in Google Drive—so you always know what still needs the network.
            </p>
            <p className="mt-1 text-xs text-slate-400">{t("syncCentre.timesUk")}</p>
            {hasRetryableWork && onSyncAll ? (
              <AnimatedButton
                type="button"
                onClick={onSyncAll}
                disabled={syncingAll}
                className={`mt-4 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 ${slatePrimaryCtaInteract}`}
              >
                {syncingAll
                  ? t("syncCentre.syncing")
                  : failedCount > 0 && waitingCount === 0
                    ? t("syncCentre.retryAll")
                    : t("syncCentre.syncNow")}
              </AnimatedButton>
            ) : null}
          </div>
        </div>
      </section>
      <section className="grid grid-cols-2 gap-3">
        <MiniMetric label={t("syncCentre.waiting")} value={String(waitingCount)} />
        <MiniMetric label={t("syncCentre.failed")} value={String(failedCount)} />
      </section>
      {syncQueue.length === 0 ? (
        <EmptyPanel title={t("syncCentre.allSynced")} text={t("syncCentre.allSyncedBody")} />
      ) : (
        <div className="space-y-3">
          {syncQueue.map((item) => (
            <section key={item.id} className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{translateSyncItemType(t, item.itemType)}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {t("syncCentre.created")} {queueTimeLabel(item.createdAt)}
                    {item.attemptedAt ? ` · ${t("syncCentre.lastAttempt")} ${queueTimeLabel(item.attemptedAt)}` : ""} · {t("syncCentre.updated")}{" "}
                    {queueTimeLabel(item.updatedAt)}
                  </p>
                  {item.lastError ? <p className="mt-2 text-xs font-semibold text-rose-600">{item.lastError}</p> : null}
                </div>
                <StatusPulse state={queueItemVisualState(item.status)} label={translateSyncQueueStatus(t, item.status)} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <div className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
                  {t("syncCentre.retries", { count: item.retryCount })}
                </div>
                {item.status === "Pending Sync" && (
                  <AnimatedButton type="button" onClick={() => onRetryItem(item.localId)} className={`rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white ${slatePrimaryCtaInteract}`}>
                    {t("syncCentre.syncNow")}
                  </AnimatedButton>
                )}
                {(item.status === "Failed" || item.status === "Conflict") && (
                  <AnimatedButton type="button" onClick={() => onRetryItem(item.localId)} className={`rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white ${slatePrimaryCtaInteract}`}>
                    {t("syncCentre.retryFailed")}
                  </AnimatedButton>
                )}
                {(item.status === "Failed" || item.status === "Conflict") && onDismissItem && (
                  <button
                    type="button"
                    onClick={() => onDismissItem(item.localId)}
                    className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
                  >
                    {t("syncCentre.dismissFailed")}
                  </button>
                )}
                {permissions.canRepairWorkspace && (
                  <button onClick={() => onForceSyncItem(item.localId)} className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">
                    {t("syncCentre.forceSync")}
                  </button>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
