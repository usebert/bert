import { CoshhWorkspace, type CoshhWorkspaceProps } from "../health-safety/CoshhWorkspace";

export type CoshhScreenProps = CoshhWorkspaceProps;

/** COSHH module — thin screen wrapper over the workspace. */
export function CoshhScreen(props: CoshhScreenProps) {
  return <CoshhWorkspace {...props} />;
}
