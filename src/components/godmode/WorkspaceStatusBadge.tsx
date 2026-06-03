import {
  resolveCompanyWorkspaceStatus,
  workspaceStatusBadgeClass,
  type CompanyWorkspaceStatusLabel,
} from "../../utils/companyWorkspaceStatus";

export function WorkspaceStatusBadge({ status }: { status: CompanyWorkspaceStatusLabel }) {
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

export { resolveCompanyWorkspaceStatus, type CompanyWorkspaceStatusLabel };
