import type { ComposeFrameInput } from "../../../src/frame/compositor.js";

export type GoldenCase = Omit<ComposeFrameInput, "raw"> & { name: string };

/** Read by test/frame-golden.test.ts and scripts/generate-golden-fixtures.mjs, so the two cannot drift apart. */
export const GOLDEN_CASES: GoldenCase[] = [
  {
    name: "gradient",
    template: "gradient",
    background: ["#1a1a2e", "#16213e"],
    textColor: "#ffffff",
    caption: "All your money, one glance",
    subtitle: "Net worth and cash flow the second you open it",
    font: "Metropolis",
  },
  {
    name: "solid-light",
    template: "solid",
    background: "#3ccf91",
    textColor: "#1a1a1a",
    caption: "All your money, one glance",
    subtitle: "Net worth and cash flow the second you open it",
    font: "Metropolis",
  },
  {
    name: "solid-dark",
    template: "solid",
    background: "#000000",
    textColor: "#ffffff",
    caption: "Dark mode for 1 AM audits",
    subtitle: "Same numbers, easier on the eyes",
    font: "Metropolis",
  },
  {
    name: "minimal-no-subtitle",
    template: "minimal",
    background: ["#1a1a2e", "#16213e"],
    textColor: "#ffffff",
    caption: "Track everything in one place",
    font: "Metropolis",
  },
];
