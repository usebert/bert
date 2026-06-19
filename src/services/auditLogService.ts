import { localDatabaseService } from "./localDatabaseService";

export type AuditLogEntry = {
  id: string;
  companyId: string;
  entityType: string;
  entityId: string;
  eventType: string;
  message: string;
  createdAt: string;
  actor: string;
  details?: Record<string, unknown>;
};

export const auditLogService = {
  load() {
    return localDatabaseService.loadCollection<AuditLogEntry[]>("auditLogs") || [];
  },
  append(entry: Omit<AuditLogEntry, "createdAt" | "id"> & { createdAt?: string; id?: string }) {
    const nextEntry: AuditLogEntry = {
      ...entry,
      id: entry.id || `audit-log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: entry.createdAt || new Date().toISOString(),
    };
    const current = this.load();
    localDatabaseService.saveCollection("auditLogs", [nextEntry, ...current]);
    return nextEntry;
  },
};
