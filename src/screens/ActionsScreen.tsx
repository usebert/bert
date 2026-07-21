import { useTranslation } from "react-i18next";
import { ActionsWorkspace } from "../actions/ActionsWorkspace";
import type { ActionsWorkspaceProps } from "../actions/types";
import { ArchiveRecordButton } from "../components/archive/ArchiveRecordButton";

export type ActionsScreenProps = ActionsWorkspaceProps;

/** Actions module — Release 4 workspace shell over existing action data and handlers. */
export function ActionsScreen(props: ActionsScreenProps) {
  useTranslation();
  return <ActionsWorkspace {...props} />;
}

export { ArchiveRecordButton };
