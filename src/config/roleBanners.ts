import type { Role } from "../permissions";

export type RoleBannerCopy = {
  headline: string;
  detail: string;
};

export function getRoleBannerCopy(role: Role, workspaceName: string): RoleBannerCopy {
  const workspace = workspaceName.trim() || "your company workspace";

  if (role === "Master") {
    return {
      headline: "Signed in as BERT Platform Owner.",
      detail: "You can manage platform setup, companies, onboarding, and diagnostics.",
    };
  }
  if (role === "Admin") {
    return {
      headline: `Signed in as Company Admin for ${workspace}.`,
      detail: "You can manage users, invites, forms, and company reports.",
    };
  }
  if (role === "Manager") {
    return {
      headline: `Signed in as Manager for ${workspace}.`,
      detail: "You can manage day-to-day work, forms, and reports.",
    };
  }
  return {
    headline: `Signed in as Auditor for ${workspace}.`,
    detail: "You can complete assigned checks and submit records.",
  };
}
