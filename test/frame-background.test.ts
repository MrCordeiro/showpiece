import { describe, expect, it } from "vitest";
import { renderBackgroundSvg } from "../src/frame/background.js";

describe("renderBackgroundSvg", () => {
  it("renders a flat rect for a solid color", () => {
    const svg = renderBackgroundSvg("#101010");
    expect(svg).toContain('fill="#101010"');
    expect(svg).not.toContain("linearGradient");
  });

  it("renders a two-stop linear gradient for a color pair", () => {
    const svg = renderBackgroundSvg(["#1a1a2e", "#16213e"]);
    expect(svg).toContain("linearGradient");
    expect(svg).toContain('stop-color="#1a1a2e"');
    expect(svg).toContain('stop-color="#16213e"');
  });

  it("sizes the background to the full output canvas", () => {
    const svg = renderBackgroundSvg("#101010");
    expect(svg).toContain('width="1080"');
    expect(svg).toContain('height="1920"');
  });
});
