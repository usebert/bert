import { BertLogo } from "../BertLogo";

type Props = {
  collapsed?: boolean;
  variant?: "mark" | "wordmark";
};

export function AppBrand({ collapsed = false, variant = "wordmark" }: Props) {
  return (
    <BertLogo
      variant={collapsed ? "mark" : variant}
      tone="onDark"
      size="sm"
      className={collapsed ? "scale-90" : ""}
    />
  );
}
