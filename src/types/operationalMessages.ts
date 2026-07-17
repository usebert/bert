/** Operational messages — client types (LOLER-linked first). */

export type OperationalMessageStatus = "unread" | "read" | "archived";

export type OperationalMessage = {
  messageId: string;
  companyFolderId?: string;
  recipientPersonId?: string;
  recipientName?: string;
  recipientEmail?: string;
  senderPersonId?: string;
  senderName?: string;
  senderEmail?: string;
  subject: string;
  messageBody: string;
  relatedModule: string;
  relatedRecordId?: string;
  relatedEquipmentId?: string;
  relatedExaminationId?: string;
  relatedScheduleId?: string;
  sentAt: string;
  readAt?: string;
  status: OperationalMessageStatus;
  archivedAt?: string;
  archivedBy?: string;
  needsAction?: boolean;
};

export type OperationalMessagesSummary = {
  total: number;
  unread: number;
  archived: number;
};

export type OperationalMessageInput = {
  recipientPersonId?: string;
  recipientName?: string;
  recipientEmail?: string;
  subject: string;
  messageBody: string;
  relatedModule?: string;
  relatedRecordId?: string;
  relatedEquipmentId?: string;
  relatedExaminationId?: string;
  relatedScheduleId?: string;
};
