import { RiddorWorkspace, type RiddorWorkspaceProps } from "../health-safety/RiddorWorkspace";

export type RiddorScreenProps = RiddorWorkspaceProps;

/** RIDDOR module — thin screen wrapper over the workspace. */
export function RiddorScreen(props: RiddorScreenProps) {
  return <RiddorWorkspace {...props} />;
}
