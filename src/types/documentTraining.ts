export type ExternalEmployee = {
  id: string;
  email: string;
  name: string;
  department: string;
  siteId: string;
  siteName: string;
  active: boolean;
  createdAt: string;
};

export type DocumentRecipientSource = "onboarded" | "external";

export type DocumentRecipient = {
  email: string;
  name: string;
  source: DocumentRecipientSource;
  acknowledgedAt: string | null;
};

export type DocumentDistribution = {
  id: string;
  workspaceId: string;
  title: string;
  fileName: string;
  sentAt: string;
  sentBy: string;
  sentByEmail: string;
  recipients: DocumentRecipient[];
};
