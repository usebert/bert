/** Keep in sync with `shared/system-template-company.mjs` (server + verify scripts). */

const BLANK_COMPANY_NAMES = new Set([
  "blank company",
  "blank company - bert folder structure",
]);

export type SystemTemplateCompanyInput = {
  name?: string;
  companyName?: string;
  displayName?: string;
  isTemplate?: boolean;
  isSystem?: boolean;
  type?: string;
  workspaceType?: string;
  status?: string;
  registryStatus?: string;
};

export function isSystemTemplateCompany(company: SystemTemplateCompanyInput | null | undefined): boolean {
  if (!company || typeof company !== "object") {
    return false;
  }
  const name = String(company.name || company.companyName || company.displayName || "")
    .trim()
    .toLowerCase();
  const status = String(company.status || company.registryStatus || "")
    .trim()
    .toUpperCase();
  const type = String(company.type || company.workspaceType || "")
    .trim()
    .toUpperCase();
  return (
    company.isTemplate === true ||
    company.isSystem === true ||
    type === "TEMPLATE" ||
    status === "TEMPLATE" ||
    BLANK_COMPANY_NAMES.has(name)
  );
}

export function filterCustomerFacingCompanies<T extends SystemTemplateCompanyInput>(companies: T[] | null | undefined): T[] {
  return (Array.isArray(companies) ? companies : []).filter((company) => !isSystemTemplateCompany(company));
}

export function findSystemTemplateCompany<T extends SystemTemplateCompanyInput>(
  companies: T[] | null | undefined,
): T | null {
  return (Array.isArray(companies) ? companies : []).find((company) => isSystemTemplateCompany(company)) || null;
}
