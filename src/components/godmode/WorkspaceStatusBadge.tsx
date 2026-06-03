import {
  getCompanySetupNextAction,
  resolveCompanySetupStatus,
  resolveCompanyWorkspaceStatus,
  workspaceStatusBadgeClass,
  type CompanySetupStatusLabel,
} from "../../utils/companyWorkspaceStatus";

/** @deprecated Use CompanySetupStatusLabel */
export type CompanyWorkspaceStatusLabel = CompanySetupStatusLabel;

export function WorkspaceStatusBadge({ status }: { status: CompanySetupStatusLabel }) {
  return (
    <span
      className={[
        "inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        workspaceStatusBadgeClass(status),
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
