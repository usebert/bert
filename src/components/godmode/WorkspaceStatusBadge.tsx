import {
  getCompanySetupNextAction,
  resolveCompanySetupStatus,
  resolveCompanyWorkspaceStatus,
  workspaceStatusBadgeClass,
  simpleSetupStatusBadgeClass,
  type CompanySetupStatusLabel,
  type SimpleCompanySetupStatus,
} from "../../utils/companyWorkspaceStatus";

/** @deprecated Use CompanySetupStatusLabel */
export type CompanyWorkspaceStatusLabel = CompanySetupStatusLabel;

export function WorkspaceStatusBadge({
  status,
  displayAsSimple = false,
}: {
  status: CompanySetupStatusLabel | SimpleCompanySetupStatus;
  displayAsSimple?: boolean;
}) {
  const badgeClass = displayAsSimple
    ? simpleSetupStatusBadgeClass(status as SimpleCompanySetupStatus)
    : workspaceStatusBadgeClass(status as CompanySetupStatusLabel);

  return (
    <span
      className={[
        "inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        badgeClass,
      ].join(" ")}
    >
      {status}
    </span>
  );
}

export {
  resolveCompanyWorkspaceStatus,
  resolveCompanySetupStatus,
  getCompanySetupNextAction,
  type CompanySetupStatusLabel,
};
