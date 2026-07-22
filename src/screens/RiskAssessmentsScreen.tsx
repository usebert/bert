import { RiskAssessmentsWorkspace, type RiskAssessmentsWorkspaceProps } from "../health-safety/RiskAssessmentsWorkspace";

export type RiskAssessmentsScreenProps = RiskAssessmentsWorkspaceProps;

export function RiskAssessmentsScreen(props: RiskAssessmentsScreenProps) {
  return <RiskAssessmentsWorkspace {...props} />;
}
