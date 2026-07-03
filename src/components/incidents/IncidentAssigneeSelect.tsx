import { memo } from "react";
import type { IncidentReassignTarget, IncidentRecord } from "../../types/incidentsScreenProps";
import {
  formatIncidentAssignee,
  incidentAssigneeSelectValue,
} from "../../utils/incidentAssignment";

type IncidentAssigneeSelectProps = {
  incident: IncidentRecord;
  targets: IncidentReassignTarget[];
  targetsLoading?: boolean;
  canEdit: boolean;
  /** Optimistic override while reassign modal is open; cleared after confirm/cancel. */
  pendingEmail?: string;
  onSelectPerson: (email: string) => void;
  className?: string;
};

function IncidentAssigneeSelectComponent({
  incident,
  targets,
  targetsLoading = false,
  canEdit,
  pendingEmail,
  onSelectPerson,
  className = "",
}: IncidentAssigneeSelectProps) {
  if (!canEdit) {
    return <span className={className}>{formatIncidentAssignee(incident)}</span>;
  }

  const resolvedEmail = pendingEmail ?? incidentAssigneeSelectValue(incident, targets);
  const selectClassName = [
    "max-w-[11rem] truncate rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-800",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const showLoading = targetsLoading && targets.length === 0;

  if (showLoading) {
    return (
      <select disabled className={selectClassName} aria-label="Assigned handler">
        <option>Loading...</option>
      </select>
    );
  }

  if (targets.length === 0) {
    return (
      <select disabled className={selectClassName} aria-label="Assigned handler">
        <option>No eligible handlers</option>
      </select>
    );
  }

  return (
    <select
      value={resolvedEmail}
      onChange={(event) => {
        const nextEmail = event.target.value;
        if (!nextEmail || nextEmail === resolvedEmail) {
          return;
        }
        onSelectPerson(nextEmail);
      }}
      onClick={(event) => event.stopPropagation()}
      className={selectClassName}
      aria-label={`Assign handler for ${incident.incidentId}`}
    >
      <option value="">Unassigned</option>
      {targets.map((target) => (
        <option key={target.email} value={target.email}>
          {target.name}
        </option>
      ))}
    </select>
  );
}

export const IncidentAssigneeSelect = memo(IncidentAssigneeSelectComponent);
