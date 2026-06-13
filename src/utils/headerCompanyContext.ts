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
    workingOnLine: "Working on: No company linked",
    hasCompany: false,
  };
}

export function resolveHeaderRoleLabel(role: Role): string {
  if (role === "Master") {
    return getAccountRoleDetail(role);
  }
  return getAccountRoleLabel(role);
}

export type DocumentTitleInput = {
  /** Product brand from `VITE_APP_NAME` (defaults to bert.). */
  appDisplayName: string;
  signedIn?: boolean;
  role?: Role;
  companyName?: string;
  companyFolderId?: string;
};

/** Strip trailing period so titles read "bert · Company" not "bert. · Company". */
export function normalizeAppBrandForTitle(appDisplayName: string): string {
  const trimmed = String(appDisplayName || "").trim();
  if (!trimmed) {
    return "bert";
  }
  return trimmed.replace(/\.+$/, "") || "bert";
}

/** Browser tab title — same company source as header "Working on". Never localStorage hints. */
export function resolveDocumentTitle(input: DocumentTitleInput): string {
  const appBrand = normalizeAppBrandForTitle(input.appDisplayName);
  if (!input.signedIn) {
    return appBrand;
  }

  const role = input.role;
  if (!role) {
    return appBrand;
  }

  const workingOn = resolveHeaderWorkingOn({
    role,
    companyName: input.companyName,
    companyFolderId: input.companyFolderId,
  });

  if (workingOn.hasCompany) {
    return `${appBrand} · ${workingOn.companyLabel}`;
  }

  if (role === "Master") {
    return `${appBrand} · No company selected`;
  }

  return `${appBrand} · No company linked`;
}
