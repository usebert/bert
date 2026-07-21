import { useTranslation } from "react-i18next";
import { NcrWorkspace } from "../ncrs/NcrWorkspace";
import type { NcrWorkspaceProps } from "../ncrs/types";
import { ArchiveRecordButton } from "../components/archive/ArchiveRecordButton";

export type NonConformanceScreenProps = NcrWorkspaceProps;

/** NCR module — Release 6 workspace shell over existing NCR data and handlers. */
export function NonConformanceScreen(props: NonConformanceScreenProps) {
  useTranslation();
  return <NcrWorkspace {...props} />;
}

export { ArchiveRecordButton };
