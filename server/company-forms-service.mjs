/**
 * company-forms-service — backward-compatible re-exports for googleFormsService.
 */
export {
  GOOGLE_FORMS_MIME,
  GOOGLE_FORMS_FOLDER_LOOKUP_FAILED,
  COMPANY_GOOGLE_FORMS_SYNC_COLUMNS,
  GOOGLE_FORM_TEMPLATES_SYNC_COLUMNS,
  buildGoogleFormsFolderQuery,
  isCompanyFormsPermissionError,
  isCompanyFormsNotFoundError,
  isExactGoogleFormsFolderName,
  resolveCompanyGoogleFormsFolder,
  resolveGoogleFormsFolder,
  listGoogleFormsInFolder,
  listGoogleFormsInFolderTree,
  listCompanyGoogleFormsFromDrive,
  listCompanyGoogleForms,
  readGoogleFormTemplatesFromTab,
  syncGoogleFormTemplatesToTab,
  handleCompanyGoogleFormsGet,
  handleCompanyGoogleFormsSyncPost,
  installCompanyFormsRoutes,
} from "./google-forms-service.mjs";
