/**
 * companyService — folder-first company discovery and workbook resolution.
 * companyFolderId === companyId; workbook inside folder is the database.
 */
import { resolveCompanyFromFolder } from "./company-folder-resolver.mjs";
import {
  discoverCompanyMasterSheetInFolder,
  ensureCompanyMasterSheet,
  findCompanyWorkbook,
  ensureCompanyWorkbook,
} from "./company-folder-structure.mjs";
import { ensureRequiredTabs } from "./ensure-required-tabs.mjs";

export { resolveCompanyFromFolder };
export {
  discoverCompanyMasterSheetInFolder,
  ensureCompanyMasterSheet,
  findCompanyWorkbook,
  ensureCompanyWorkbook,
  ensureRequiredTabs,
};

/** Alias used by context layer and routes. */
export async function resolveCompanyContextFromFolder(auth, deps, companyFolderId, options = {}) {
  return resolveCompanyFromFolder(auth, deps, companyFolderId, options);
}
