import type { CompanyGoogleForm, CompanyGoogleFormsLoadStatus } from "../services/companyFormsService";

export type GoogleFormsScreenProps = {
  forms: CompanyGoogleForm[];
  loading: boolean;
  loadError?: string;
  status: CompanyGoogleFormsLoadStatus;
  syncing: boolean;
  syncError?: string;
  syncMessage?: string;
  googleConnected: boolean;
  canSync: boolean;
  onSync: () => void;
  canCreateBertCheck?: boolean;
  creatingBertCheckFormId?: string | null;
  bertCheckCreatedFormIds?: string[];
  onCreateBertCheck?: (form: CompanyGoogleForm) => void | Promise<void>;
  onBackToAuditCentre?: () => void;
};
