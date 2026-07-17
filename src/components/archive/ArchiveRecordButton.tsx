import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ARCHIVE_OFFLINE_MESSAGE, archiveCompanyRecord } from "../../services/archiveService";
import type { ClientArchiveRecordType } from "../../utils/archivePermissions";
import { ArchiveConfirmDialog } from "./ArchiveConfirmDialog";

type Props = {
  recordType: ClientArchiveRecordType;
  recordId: string;
  companyFolderId: string;
  masterSheetId?: string;
  offlineMode?: boolean;
  canArchive?: boolean;
  label?: string;
  className?: string;
  extraMessage?: string;
  onArchived: () => void | Promise<void>;
  onError?: (message: string) => void;
  onSuccess?: () => void;
};

export function ArchiveRecordButton({
  recordType,
  recordId,
  companyFolderId,
  masterSheetId,
  offlineMode = false,
  canArchive = true,
  label,
  className = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:border-slate-300",
  extraMessage,
  onArchived,
  onError,
  onSuccess,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!canArchive || !recordId.trim()) {
    return null;
  }

  const handleConfirm = async (reason: string) => {
    if (offlineMode) {
      onError?.(ARCHIVE_OFFLINE_MESSAGE);
      return;
    }
    if (!companyFolderId.trim()) {
      onError?.("Company workbook is not linked.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await archiveCompanyRecord(companyFolderId, {
        type: recordType,
        id: recordId,
        reason: reason || undefined,
        masterSheetId,
      });
      if (!result.ok) {
        onError?.(result.message || result.error || "Could not archive item. Try again.");
        return;
      }
      await onArchived();
      onSuccess?.();
      setOpen(false);
    } catch {
      onError?.("Could not archive item. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={offlineMode}
        title={offlineMode ? ARCHIVE_OFFLINE_MESSAGE : undefined}
        onClick={() => {
          if (offlineMode) {
            onError?.(ARCHIVE_OFFLINE_MESSAGE);
            return;
          }
          setOpen(true);
        }}
        className={[className, offlineMode ? "cursor-not-allowed opacity-60" : ""].join(" ")}
      >
        {label ?? t("nav.archive")}
      </button>
      <ArchiveConfirmDialog
        open={open}
        extraMessage={extraMessage}
        submitting={submitting}
        onCancel={() => {
          if (!submitting) {
            setOpen(false);
          }
        }}
        onConfirm={handleConfirm}
      />
    </>
  );
}
