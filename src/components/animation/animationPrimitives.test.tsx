/**
 * Render checks for motion wrappers — excluded from tsc -b (see tsconfig.app.json).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnimatedScreen } from "./AnimatedScreen";
import { AnimatedCard } from "./AnimatedCard";

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
});
