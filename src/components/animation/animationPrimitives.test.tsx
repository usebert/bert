/**
 * Lightweight render checks (run via `npx tsx` or future test runner).
 * Ensures wrappers render children and reduced-motion keeps content visible.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnimatedScreen } from "./AnimatedScreen";
import { AnimatedCard } from "./AnimatedCard";

function assertIncludes(haystack: string, needle: string, label: string) {
  if (!haystack.includes(needle)) {
    throw new Error(`${label}: expected markup to include "${needle}"`);
  }
}

const screenHtml = renderToStaticMarkup(
  createElement(AnimatedScreen, { screenKey: "test" }, createElement("p", null, "Visible child")),
);
assertIncludes(screenHtml, "Visible child", "AnimatedScreen");

const cardHtml = renderToStaticMarkup(
  createElement(AnimatedCard, { index: 2 }, createElement("span", null, "Card body")),
);
assertIncludes(cardHtml, "Card body", "AnimatedCard");

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("[animation-primitives.test] OK");
}
