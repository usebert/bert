import { useTranslation } from "react-i18next";
import type { AuditsScreenProps } from "../types/auditsScreenProps";
import { AuditsWorkspace } from "../audits/AuditsWorkspace";
import { AssignedCheckActionRow } from "../components/checks/AssignedCheckActionRow";

export type { AuditsScreenProps };

/** Audits module — Release 3 workspace shell over existing audit data and handlers. */
export function AuditsScreen(props: AuditsScreenProps & { offlineMode?: boolean; onNavigateToResults?: () => void }) {
  useTranslation();
  return <AuditsWorkspace {...props} />;
}

export { AssignedCheckActionRow };
