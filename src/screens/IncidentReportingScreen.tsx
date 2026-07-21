import { useTranslation } from "react-i18next";
import { SafetyWorkspace } from "../safety/SafetyWorkspace";
import type { SafetyWorkspaceProps } from "../safety/types";
import { ArchiveRecordButton } from "../components/archive/ArchiveRecordButton";

export type IncidentReportingScreenProps = SafetyWorkspaceProps;

/** Safety module — Release 6 workspace shell over existing incident data and handlers. */
export function IncidentReportingScreen(props: IncidentReportingScreenProps) {
  useTranslation();
  return <SafetyWorkspace {...props} />;
}

export { ArchiveRecordButton };
