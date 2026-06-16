/**
 * googleFormsService — canonical alias for company Google Forms folder discovery.
 */
export {
  GOOGLE_FORMS_MIME,
  COMPANY_GOOGLE_FORMS_SYNC_COLUMNS,
  buildGoogleFormsFolderQuery,
  isCompanyFormsPermissionError,
  isCompanyFormsNotFoundError,
  isExactGoogleFormsFolderName,
  resolveCompanyGoogleFormsFolder,
  listCompanyGoogleForms,
  listGoogleFormsInFolderTree,
} from "./company-forms-service.mjs";
