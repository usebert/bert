/**
 * System/template company workspaces — hidden from customer-facing pickers.
 * Keep in sync with `src/utils/systemTemplateCompany.ts`.
 */

const BLANK_COMPANY_NAMES = new Set([
  "blank company",
  "blank company - bert folder structure",
]);

/**
 * @param {Record<string, unknown> | null | undefined} company
 * @returns {boolean}
 */
export function isSystemTemplateCompany(company) {
  if (!company || typeof company !== "object") {
    return false;
  }
  const name = String(company.name || company.companyName || company.displayName || "")
    .trim()
    .toLowerCase();
  const status = String(company.status || company.registryStatus || "").trim().toUpperCase();
  const type = String(company.type || company.workspaceType || "").trim().toUpperCase();
  return (
    company.isTemplate === true ||
    company.isSystem === true ||
    type === "TEMPLATE" ||
    status === "TEMPLATE" ||
    BLANK_COMPANY_NAMES.has(name)
  );
}

/**
 * @template T
 * @param {T[] | null | undefined} companies
 * @returns {T[]}
 */
export function filterCustomerFacingCompanies(companies) {
  return (Array.isArray(companies) ? companies : []).filter((company) => !isSystemTemplateCompany(company));
}

/**
 * Internal provisioning/diagnostics may resolve the template workspace from an unfiltered list.
 *
 * @template T
 * @param {T[] | null | undefined} companies
 * @returns {T | null}
 */
export function findSystemTemplateCompany(companies) {
  return (Array.isArray(companies) ? companies : []).find((company) => isSystemTemplateCompany(company)) || null;
}
