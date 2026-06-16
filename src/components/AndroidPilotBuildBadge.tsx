import { getAndroidPilotBuildDetail, getAndroidPilotBuildLabel } from "../utils/androidBuildInfo";

type Props = {
  className?: string;
  showDetail?: boolean;
};

/** Native Android only — shows pilot APK build number baked in at assemble time. */
export function AndroidPilotBuildBadge({ className = "", showDetail = false }: Props) {
  const label = getAndroidPilotBuildLabel();
  if (!label) {
    return null;
  }
  const detail = showDetail ? getAndroidPilotBuildDetail() : null;
  return (
    <p className={["text-center text-[11px] font-medium tracking-wide text-slate-400", className].join(" ")}>
      {detail ?? label}
    </p>
  );
}
