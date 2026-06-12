/**
 * Company service — folder-first source of truth.
 * companyFolderId === companyId; workbook in folder is the database.
 */
import { resolveCompanyFromFolder } from "./company-folder-resolver.mjs";

export { resolveCompanyFromFolder };

/** Alias used by context layer and routes. */
export async function resolveCompanyContextFromFolder(auth, deps, companyFolderId, options = {}) {
  return resolveCompanyFromFolder(auth, deps, companyFolderId, options);
}
