/**
 * Render checks for motion wrappers — excluded from tsc -b (see tsconfig.app.json).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnimatedScreen } from "./AnimatedScreen";
import { AnimatedCard } from "./AnimatedCard";
import { AnimatedButton } from "./AnimatedButton";
import { AnimatedCount } from "./AnimatedCount";
import { SubmitResultBanner } from "./SubmitResultBanner";
import { OfflineSyncBanner } from "./OfflineSyncBanner";

vi.mock("./usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => false,
}));

describe("animation primitives", () => {
  it("renders AnimatedScreen children", () => {
    render(
      <AnimatedScreen screenKey="test">
        <div>Screen content</div>
      </AnimatedScreen>,
    );
    expect(screen.getByText("Screen content")).toBeInTheDocument();
  });

  it("renders AnimatedCard children", () => {
    render(
      <AnimatedCard index={0}>
        <div>Card content</div>
      </AnimatedCard>,
    );
    expect(screen.getByText("Card content")).toBeInTheDocument();
  });

  it("renders AnimatedButton with pressable class", () => {
    render(<AnimatedButton type="button">Submit</AnimatedButton>);
    expect(screen.getByRole("button", { name: "Submit" })).toHaveClass("bert-pressable");
  });

  it("renders AnimatedCount starting at zero", () => {
    render(<AnimatedCount value={12} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("shows online submit success copy", () => {
    render(<SubmitResultBanner online title="Daily line check" subtitle="Check saved successfully." />);
    expect(screen.getByText("Submitted")).toBeInTheDocument();
    expect(screen.getByText("Check saved successfully.")).toBeInTheDocument();
  });

  it("shows offline saved copy and queue count", () => {
    render(
      <SubmitResultBanner online={false} title="Daily line check" subtitle="Saved on this device" queuedCount={2} />,
    );
    expect(screen.getByText("Saved on this tablet")).toBeInTheDocument();
    expect(screen.getByText(/2 checks queued/)).toBeInTheDocument();
  });

  it("shows offline sync progress and retry failed", () => {
    render(
      <OfflineSyncBanner
        offlineMode={false}
        queuedCount={3}
        waitingCount={3}
        hasFailed
        syncing
        syncProgress={{ current: 1, total: 3 }}
        onRetryFailed={() => undefined}
      />,
    );
    expect(screen.getByText("Retry failed")).toBeInTheDocument();
    expect(screen.getByText(/Syncing saved checks/)).toBeInTheDocument();
    expect(screen.getByText(/1 of 3 synced/)).toBeInTheDocument();
  });
});
