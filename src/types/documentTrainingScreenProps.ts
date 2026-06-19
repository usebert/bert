import type { Role } from "../permissions";
import type { Site } from "./adminScreenProps";
import type { DocumentDistribution, DocumentRecipientSource, ExternalEmployee } from "./documentTraining";

export type OnboardedRecipientOption = {
  id: string;
  email: string;
  name: string;
  role: Role;
  siteIds: string[];
  department: string;
};

export type DocumentTrainingScreenProps = {
  workspaceId: string;
  currentUserName: string;
  sites: Site[];
  onboardedRecipients: OnboardedRecipientOption[];
  externalEmployees: ExternalEmployee[];
  distributions: DocumentDistribution[];
  onSaveExternalEmployees: (employees: ExternalEmployee[]) => Promise<void>;
  onSendDistribution: (input: {
    title: string;
    fileName: string;
    pdfBase64: string;
    recipients: Array<{ email: string; name: string; source: DocumentRecipientSource }>;
  }) => Promise<{ ok: boolean; error?: string; emailErrors?: Array<{ email: string; error: string }> }>;
  onRefreshFromServer: () => Promise<void>;
};
