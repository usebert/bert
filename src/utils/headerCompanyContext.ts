import type { Role } from "../permissions";
import { getAccountRoleDetail, getAccountRoleLabel } from "./uxDeclutter";

export type HeaderWorkingOnInput = {
  role: Role;
  companyName?: string;
  companyFolderId?: string;
};

export type HeaderWorkingOnResult = {
  /** Company display name when linked/selected; empty when none. */
  companyLabel: string;
  /** Full "Working on: …" line (includes fallback copy when no company). */
  workingOnLine: string;
  hasCompany: boolean;
};

/** Resolve visible header company context for any signed-in role. */
export function resolveHeaderWorkingOn(input: HeaderWorkingOnInput): HeaderWorkingOnResult {
  const companyName = String(input.companyName || "").trim();
  const companyFolderId = String(input.companyFolderId || "").trim();
  const hasCompany = Boolean(companyFolderId && companyName);

  if (hasCompany) {
    return {
      companyLabel: companyName,
      workingOnLine: `Working on: ${companyName}`,
      hasCompany: true,
    };
  }

  if (input.role === "Master") {
    return {
      companyLabel: "",
      workingOnLine: "Working on: No company selected",
      hasCompany: false,
    };
  }

  return {
    companyLabel: "",
    workingOnLine: "Your account is not linked to a company",
    hasCompany: false,
  };
}

export function resolveHeaderRoleLabel(role: Role): string {
  if (role === "Master") {
    return getAccountRoleDetail(role);
  }
  return getAccountRoleLabel(role);
}
