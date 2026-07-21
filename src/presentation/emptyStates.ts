/** Shared empty-state copy for major workspaces. */
export const EMPTY_STATE_COPY = {
  audits: {
    title: "No audits have been created yet.",
    description: "Create a template or schedule to start assigning checks to your team.",
    action: "Create audit",
  },
  actions: {
    title: "No actions require attention.",
    description: "Corrective actions from audits and incidents will appear here when they need follow-up.",
  },
  documents: {
    title: "Upload your first controlled document.",
    description: "Add policies, procedures and forms with revision control and approvals.",
    action: "Add document",
  },
  documentLibrary: {
    title: "No documents in the library yet.",
    description: "Upload reference files your team can access from the field.",
    action: "Upload document",
  },
  incidents: {
    title: "No incidents have been recorded.",
    description: "Report incidents and near misses so your team can investigate and learn.",
  },
  ncrs: {
    title: "No NCRs have been raised.",
    description: "Non-conformances from audits and inspections will appear here.",
  },
  equipment: {
    title: "No equipment registered yet.",
    description: "Add lifting equipment and inspection records to stay compliant.",
    action: "Add equipment",
  },
  briefings: {
    title: "No briefings published yet.",
    description: "Create a briefing to share updates and collect acknowledgements.",
    action: "Create briefing",
  },
  schedules: {
    title: "No schedules created yet.",
    description: "Create a schedule to assign recurring checks to your team.",
    action: "Create schedule",
  },
  people: {
    title: "No people added yet.",
    description: "Invite colleagues so they can sign in and complete assigned work.",
    action: "Invite user",
  },
} as const;
